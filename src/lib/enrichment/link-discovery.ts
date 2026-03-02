/**
 * Link Discovery - Extract and score internal links from scraped markdown
 *
 * Finds team/about pages by analyzing homepage navigation links.
 * Pure string matching — no AI calls needed.
 */

export interface DiscoveredLink {
  url: string;
  text: string;
  score: number;
  matchReason: string;
}

// URL path keywords with score weights
export const URL_KEYWORDS_HIGH: string[] = [
  'team', 'our-team', 'meet-the-team', 'staff', 'our-staff',
  'people', 'leadership', 'about/team', 'about/staff',
];

export const URL_KEYWORDS_MED: string[] = [
  'about', 'about-us', 'who-we-are', 'our-story', 'company',
  'contact', 'contact-us', 'locations', 'location',
];

export const URL_KEYWORDS_LOW: string[] = [
  'careers', 'providers', 'clinicians', 'therapists',
  'find-us', 'offices', 'directions',
];

// Link text keywords (case-insensitive matching)
export const TEXT_KEYWORDS: string[] = [
  'team', 'staff', 'people', 'leadership', 'about',
  'meet', 'providers', 'founders', 'board', 'management',
  'contact', 'location', 'locations', 'offices',
];

// File extensions to reject
const REJECTED_EXTENSIONS = /\.(pdf|jpg|jpeg|png|gif|svg|webp|mp4|mp3|doc|docx|xls|xlsx|zip|css|js)$/i;

/**
 * Discover relevant internal links (team/about pages) from homepage markdown.
 */
export function discoverRelevantLinks(
  markdown: string,
  domain: string,
  options?: { maxLinks?: number }
): DiscoveredLink[] {
  const maxLinks = options?.maxLinks ?? 2;
  const normalizedDomain = domain.toLowerCase().replace(/^www\./, '');

  // Step 1: Extract all markdown links
  const linkRegex = /\[([^\]]*)\]\(([^)]+)\)/g;
  const rawLinks: { text: string; href: string }[] = [];
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(markdown)) !== null) {
    rawLinks.push({ text: match[1].trim(), href: match[2].trim() });
  }

  // Step 2: Filter to internal links only
  const internalLinks = rawLinks.filter(({ href }) => {
    // Reject mailto, tel, anchors
    if (/^(mailto:|tel:|#)/.test(href)) return false;

    // Reject file extensions
    if (REJECTED_EXTENSIONS.test(href)) return false;

    // Accept relative URLs (they're internal)
    if (href.startsWith('/') && !href.startsWith('//')) return true;

    // Check if absolute URL is on the same domain
    try {
      const url = new URL(href);
      const linkDomain = url.hostname.toLowerCase().replace(/^www\./, '');
      return linkDomain === normalizedDomain;
    } catch {
      // If URL parsing fails, skip it
      return false;
    }
  });

  // Step 3: Score each link
  const scored: DiscoveredLink[] = internalLinks.map(({ text, href }) => {
    let score = 0;
    const reasons: string[] = [];

    // Normalize URL for scoring
    const urlPath = extractPath(href).toLowerCase();

    // Score URL path keywords
    for (const keyword of URL_KEYWORDS_HIGH) {
      if (pathContainsKeyword(urlPath, keyword)) {
        score += 10;
        reasons.push(`url:${keyword}`);
      }
    }

    for (const keyword of URL_KEYWORDS_MED) {
      if (pathContainsKeyword(urlPath, keyword)) {
        score += 5;
        reasons.push(`url:${keyword}`);
      }
    }

    for (const keyword of URL_KEYWORDS_LOW) {
      if (pathContainsKeyword(urlPath, keyword)) {
        score += 2;
        reasons.push(`url:${keyword}`);
      }
    }

    // Score link text keywords
    const lowerText = text.toLowerCase();
    for (const keyword of TEXT_KEYWORDS) {
      if (lowerText.includes(keyword)) {
        score += 3;
        reasons.push(`text:${keyword}`);
      }
    }

    // Resolve full URL
    const fullUrl = resolveUrl(href, normalizedDomain);

    return {
      url: fullUrl,
      text,
      score,
      matchReason: reasons.join(', '),
    };
  });

  // Step 4: Deduplicate by normalized URL
  const seen = new Set<string>();
  const deduped = scored.filter((link) => {
    const key = normalizeUrl(link.url);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Step 5: Filter by minimum score and return top N
  return deduped
    .filter((link) => link.score >= 5)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxLinks);
}

/** Extract the path portion from a URL or relative href */
function extractPath(href: string): string {
  if (href.startsWith('/')) return href;
  try {
    return new URL(href).pathname;
  } catch {
    return href;
  }
}

/** Check if a URL path contains a keyword as a path segment */
export function pathContainsKeyword(path: string, keyword: string): boolean {
  // Split both path and keyword into segments for matching
  const pathSegments = path.split('/').filter(Boolean);
  const keywordSegments = keyword.split('/').filter(Boolean);

  if (keywordSegments.length === 1) {
    // Single-segment keyword: match any segment
    return pathSegments.some((seg) => seg === keywordSegments[0]);
  }

  // Multi-segment keyword (e.g., "about/team"): match consecutive segments
  for (let i = 0; i <= pathSegments.length - keywordSegments.length; i++) {
    const match = keywordSegments.every(
      (kw, j) => pathSegments[i + j] === kw
    );
    if (match) return true;
  }
  return false;
}

/** Resolve a potentially relative URL to an absolute URL */
export function resolveUrl(href: string, domain: string): string {
  if (href.startsWith('http://') || href.startsWith('https://')) {
    return href;
  }
  const path = href.startsWith('/') ? href : `/${href}`;
  return `https://${domain}${path}`;
}

/** Normalize URL for deduplication (lowercase, strip trailing slash) */
export function normalizeUrl(url: string): string {
  return url.toLowerCase().replace(/\/+$/, '');
}
