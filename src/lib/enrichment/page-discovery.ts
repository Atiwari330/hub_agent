/**
 * Page Discovery - Tiered fallback for finding team/about pages
 *
 * When Jina Reader strips navigation menus (which it does for <nav> elements
 * and JS-rendered menus), the markdown-based link discovery finds zero links.
 * This module provides fallback tiers:
 *
 *   Step 0: Markdown link extraction (existing, from Jina output)
 *     ↓ if 0 links
 *   Tier 1: Raw HTML fetch + Cheerio → parse <nav>/<header> <a> tags  [FREE]
 *     ↓ if still 0
 *   Tier 2: Sitemap.xml fetch + URL keyword filtering               [FREE]
 *     ↓ if still 0
 *   Tier 3: Firecrawl /map endpoint with search query                [$0.005]
 */

import * as cheerio from 'cheerio';
import {
  discoverRelevantLinks,
  URL_KEYWORDS_HIGH,
  URL_KEYWORDS_MED,
  URL_KEYWORDS_LOW,
  TEXT_KEYWORDS,
  pathContainsKeyword,
  resolveUrl,
  normalizeUrl,
} from './link-discovery';

export interface DiscoveredPage {
  url: string;
  source: 'markdown' | 'html' | 'sitemap' | 'firecrawl';
  score: number;
  label: string;
}

interface DiscoverOptions {
  maxPages?: number;
  verbose?: boolean;
}

/**
 * Discover subpages (team/about) using tiered fallback.
 * Returns scored and deduplicated URLs, highest score first.
 */
export async function discoverSubpages(
  homepageMarkdown: string,
  domain: string,
  options?: DiscoverOptions
): Promise<DiscoveredPage[]> {
  const maxPages = options?.maxPages ?? 2;
  const verbose = options?.verbose ?? false;

  // Step 0: Markdown link extraction (existing logic)
  const markdownLinks = discoverRelevantLinks(homepageMarkdown, domain, {
    maxLinks: maxPages,
  });

  if (markdownLinks.length > 0) {
    return markdownLinks.map((link) => ({
      url: link.url,
      source: 'markdown' as const,
      score: link.score,
      label: `md:${link.matchReason}`,
    }));
  }

  // Tier 1: HTML fetch + Cheerio parsing
  if (verbose) console.log('  No links in Jina markdown, trying HTML extraction...');

  const htmlPages = await discoverFromHtml(domain, maxPages, verbose);
  if (htmlPages.length > 0) {
    return htmlPages;
  }

  // Tier 2: Sitemap.xml parsing
  if (verbose) console.log('  HTML extraction found nothing, trying sitemap...');

  const sitemapPages = await discoverFromSitemap(domain, maxPages, verbose);
  if (sitemapPages.length > 0) {
    return sitemapPages;
  }

  // Tier 3: Firecrawl /map (only if API key is set)
  const firecrawlKey = process.env.FIRECRAWL_API_KEY;
  if (firecrawlKey) {
    if (verbose) console.log('  Sitemap found nothing, trying Firecrawl...');

    const firecrawlPages = await discoverFromFirecrawl(
      domain,
      firecrawlKey,
      maxPages,
      verbose
    );
    if (firecrawlPages.length > 0) {
      return firecrawlPages;
    }
  }

  return [];
}

// ===== Tier 1: HTML Link Extraction =====

const HTML_FETCH_TIMEOUT_MS = 15_000;
const REJECTED_EXTENSIONS =
  /\.(pdf|jpg|jpeg|png|gif|svg|webp|mp4|mp3|doc|docx|xls|xlsx|zip|css|js)$/i;

async function discoverFromHtml(
  domain: string,
  maxPages: number,
  verbose: boolean
): Promise<DiscoveredPage[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HTML_FETCH_TIMEOUT_MS);

    const response = await fetch(`https://${domain}`, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; RevOpsBot/1.0; +https://opusbehavioral.com)',
      },
    });

    clearTimeout(timeout);

    if (!response.ok) return [];

    const html = await response.text();
    const $ = cheerio.load(html);

    const normalizedDomain = domain.toLowerCase().replace(/^www\./, '');
    const links: DiscoveredPage[] = [];
    const seen = new Set<string>();

    // Extract links from nav, header, and footer elements (priority order)
    const selectors = ['nav a[href]', 'header a[href]', 'footer a[href]'];

    for (const selector of selectors) {
      $(selector).each((_i, el) => {
        const href = $(el).attr('href');
        if (!href) return;

        // Skip non-page links
        if (/^(mailto:|tel:|javascript:)/.test(href)) return;
        if (REJECTED_EXTENSIONS.test(href)) return;

        // Filter to internal links
        let fullUrl: string;
        let urlPath: string;

        if (href.startsWith('/') && !href.startsWith('//')) {
          fullUrl = `https://${normalizedDomain}${href}`;
          urlPath = href;
        } else if (href.startsWith('http://') || href.startsWith('https://')) {
          try {
            const parsed = new URL(href);
            const linkDomain = parsed.hostname.toLowerCase().replace(/^www\./, '');
            if (linkDomain !== normalizedDomain) return;
            fullUrl = href;
            urlPath = parsed.pathname + (parsed.hash || '');
          } catch {
            return;
          }
        } else if (href.startsWith('#')) {
          // Fragment-only anchor on homepage — skip
          return;
        } else {
          // Relative path without leading /
          fullUrl = `https://${normalizedDomain}/${href}`;
          urlPath = `/${href}`;
        }

        // Deduplicate by normalized URL (without fragment)
        const dedupeKey = normalizeUrl(fullUrl.split('#')[0]);
        if (seen.has(dedupeKey)) return;
        seen.add(dedupeKey);

        // Score the URL
        const { score, reasons } = scoreUrl(urlPath, $(el).text().trim());
        if (score === 0) return;

        links.push({
          url: fullUrl,
          source: 'html',
          score,
          label: `nav:${reasons.join(', ')}`,
        });
      });
    }

    // Sort by score descending, filter >= 5, take top N
    const results = links
      .sort((a, b) => b.score - a.score)
      .filter((l) => l.score >= 5)
      .slice(0, maxPages);

    if (verbose && links.length > 0) {
      console.log(
        `  HTML: Found ${links.length} nav/header/footer links, ${results.length} scored >= 5:`
      );
      for (const r of results) {
        console.log(`    - [${r.score}] ${r.url} (${r.label})`);
      }
    }

    return results;
  } catch {
    if (verbose) console.log('  HTML fetch failed, skipping tier 1');
    return [];
  }
}

// ===== Tier 2: Sitemap.xml Parsing =====

const SITEMAP_FETCH_TIMEOUT_MS = 10_000;

async function discoverFromSitemap(
  domain: string,
  maxPages: number,
  verbose: boolean
): Promise<DiscoveredPage[]> {
  try {
    // Try /sitemap.xml first
    let urls = await fetchSitemapUrls(`https://${domain}/sitemap.xml`);

    // If 404, check robots.txt for Sitemap directive
    if (urls.length === 0) {
      const sitemapUrl = await findSitemapInRobots(domain);
      if (sitemapUrl) {
        urls = await fetchSitemapUrls(sitemapUrl);
      }
    }

    if (urls.length === 0) return [];

    const normalizedDomain = domain.toLowerCase().replace(/^www\./, '');

    // Score each URL
    const scored: DiscoveredPage[] = [];

    for (const url of urls) {
      // Filter to same domain
      try {
        const parsed = new URL(url);
        const linkDomain = parsed.hostname.toLowerCase().replace(/^www\./, '');
        if (linkDomain !== normalizedDomain) continue;

        const urlPath = parsed.pathname;
        const { score, reasons } = scoreUrl(urlPath, '');
        if (score === 0) continue;

        scored.push({
          url,
          source: 'sitemap',
          score,
          label: `sitemap:${reasons.join(', ')}`,
        });
      } catch {
        continue;
      }
    }

    const results = scored
      .sort((a, b) => b.score - a.score)
      .filter((l) => l.score >= 5)
      .slice(0, maxPages);

    if (verbose && results.length > 0) {
      console.log(
        `  Sitemap: Found ${urls.length} URLs, ${results.length} scored >= 5:`
      );
      for (const r of results) {
        console.log(`    - [${r.score}] ${r.url} (${r.label})`);
      }
    }

    return results;
  } catch {
    if (verbose) console.log('  Sitemap fetch failed, skipping tier 2');
    return [];
  }
}

async function fetchSitemapUrls(sitemapUrl: string): Promise<string[]> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    SITEMAP_FETCH_TIMEOUT_MS
  );

  try {
    const response = await fetch(sitemapUrl, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) return [];

    const xml = await response.text();

    // Check if this is a sitemap index
    if (xml.includes('<sitemapindex')) {
      // Extract child sitemap URLs (limit 3)
      const childSitemapRegex = /<sitemap>\s*<loc>\s*([^<]+?)\s*<\/loc>/g;
      const childUrls: string[] = [];
      let match: RegExpExecArray | null;

      while (
        (match = childSitemapRegex.exec(xml)) !== null &&
        childUrls.length < 3
      ) {
        childUrls.push(match[1].trim());
      }

      // Fetch child sitemaps and combine
      const allUrls: string[] = [];
      for (const childUrl of childUrls) {
        const childPageUrls = await fetchSitemapUrls(childUrl);
        allUrls.push(...childPageUrls);
      }
      return allUrls;
    }

    // Regular sitemap — extract <loc> entries
    const locRegex = /<loc>\s*([^<]+?)\s*<\/loc>/g;
    const urls: string[] = [];
    let match: RegExpExecArray | null;

    while ((match = locRegex.exec(xml)) !== null) {
      urls.push(match[1].trim());
    }

    return urls;
  } catch {
    clearTimeout(timeout);
    return [];
  }
}

async function findSitemapInRobots(domain: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    SITEMAP_FETCH_TIMEOUT_MS
  );

  try {
    const response = await fetch(`https://${domain}/robots.txt`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) return null;

    const text = await response.text();
    const match = text.match(/^Sitemap:\s*(.+)$/im);
    return match ? match[1].trim() : null;
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

// ===== Tier 3: Firecrawl /map =====

async function discoverFromFirecrawl(
  domain: string,
  apiKey: string,
  maxPages: number,
  verbose: boolean
): Promise<DiscoveredPage[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    const response = await fetch('https://api.firecrawl.dev/v2/map', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url: `https://${domain}`,
        search: 'team about leadership staff',
        limit: 20,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      if (verbose)
        console.log(`  Firecrawl returned HTTP ${response.status}`);
      return [];
    }

    const data = await response.json();
    const urls: string[] = data.links || data.urls || [];

    if (urls.length === 0) return [];

    const normalizedDomain = domain.toLowerCase().replace(/^www\./, '');

    const scored: DiscoveredPage[] = [];
    for (const url of urls) {
      try {
        const parsed = new URL(url);
        const linkDomain = parsed.hostname.toLowerCase().replace(/^www\./, '');
        if (linkDomain !== normalizedDomain) continue;

        const urlPath = parsed.pathname;
        const { score, reasons } = scoreUrl(urlPath, '');
        if (score === 0) continue;

        scored.push({
          url,
          source: 'firecrawl',
          score,
          label: `firecrawl:${reasons.join(', ')}`,
        });
      } catch {
        continue;
      }
    }

    const results = scored
      .sort((a, b) => b.score - a.score)
      .filter((l) => l.score >= 5)
      .slice(0, maxPages);

    if (verbose && results.length > 0) {
      console.log(
        `  Firecrawl: Found ${urls.length} URLs, ${results.length} scored >= 5:`
      );
      for (const r of results) {
        console.log(`    - [${r.score}] ${r.url} (${r.label})`);
      }
    }

    return results;
  } catch {
    if (verbose) console.log('  Firecrawl request failed, skipping tier 3');
    return [];
  }
}

// ===== Shared Scoring =====

/**
 * Score a URL path (and optional anchor text) using shared keyword lists.
 * Also scores URL fragments (e.g., #our-team gets +8).
 */
function scoreUrl(
  urlPath: string,
  anchorText: string
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  // Split path and fragment
  const [pathPart, fragment] = urlPath.split('#');
  const lowerPath = pathPart.toLowerCase();

  // Score URL path keywords
  for (const keyword of URL_KEYWORDS_HIGH) {
    if (pathContainsKeyword(lowerPath, keyword)) {
      score += 10;
      reasons.push(`url:${keyword}`);
    }
  }

  for (const keyword of URL_KEYWORDS_MED) {
    if (pathContainsKeyword(lowerPath, keyword)) {
      score += 5;
      reasons.push(`url:${keyword}`);
    }
  }

  for (const keyword of URL_KEYWORDS_LOW) {
    if (pathContainsKeyword(lowerPath, keyword)) {
      score += 2;
      reasons.push(`url:${keyword}`);
    }
  }

  // Score fragment keywords (e.g., #our-team, #staff)
  if (fragment) {
    const lowerFragment = fragment.toLowerCase();
    for (const keyword of URL_KEYWORDS_HIGH) {
      const simpleKeyword = keyword.split('/').pop()!;
      if (lowerFragment.includes(simpleKeyword)) {
        score += 8;
        reasons.push(`fragment:${simpleKeyword}`);
      }
    }
  }

  // Score anchor text keywords
  if (anchorText) {
    const lowerText = anchorText.toLowerCase();
    for (const keyword of TEXT_KEYWORDS) {
      if (lowerText.includes(keyword)) {
        score += 3;
        reasons.push(`text:${keyword}`);
      }
    }
  }

  return { score, reasons };
}
