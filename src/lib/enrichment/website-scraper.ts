/**
 * Website Scraper - Jina Reader Integration
 *
 * Uses Jina Reader API (r.jina.ai) to fetch clean markdown from websites.
 * Designed with a swappable interface for future migration to Firecrawl or other providers.
 */

export interface ScrapeResult {
  url: string;
  markdown: string;
  status: 'success' | 'error' | 'timeout' | 'blocked' | 'unreachable';
  error?: string;
}

const JINA_READER_BASE = 'https://r.jina.ai/';
const MAX_MARKDOWN_LENGTH = 200_000; // ~50K tokens
const FETCH_TIMEOUT_MS = 30_000;

/**
 * Scrape a website's homepage and return clean markdown.
 * Tries HTTPS first, falls back to HTTP.
 */
export async function scrapeWebsite(domain: string): Promise<ScrapeResult> {
  const url = `https://${domain}`;

  try {
    const result = await fetchViaJina(url);
    return result;
  } catch {
    // If HTTPS fails, try HTTP
    try {
      const httpUrl = `http://${domain}`;
      const result = await fetchViaJina(httpUrl);
      return result;
    } catch (error) {
      return {
        url,
        markdown: '',
        status: 'unreachable',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

/**
 * Scrape a single page by full URL. Public wrapper around Jina Reader.
 */
export async function scrapePage(
  url: string,
  options?: { maxChars?: number }
): Promise<ScrapeResult> {
  return fetchViaJina(url, options?.maxChars);
}

/**
 * Scrape multiple pages in parallel. Failed pages return error status (never throws).
 */
export async function scrapePages(
  urls: string[],
  options?: { perPageMaxChars?: number }
): Promise<ScrapeResult[]> {
  const maxChars = options?.perPageMaxChars ?? 50_000;

  const results = await Promise.allSettled(
    urls.map((url) => fetchViaJina(url, maxChars))
  );

  return results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    return {
      url: urls[i],
      markdown: '',
      status: 'error' as const,
      error: r.reason instanceof Error ? r.reason.message : 'Unknown error',
    };
  });
}

/**
 * Fetch a URL through Jina Reader and return clean markdown.
 */
async function fetchViaJina(
  targetUrl: string,
  maxLength?: number
): Promise<ScrapeResult> {
  const jinaUrl = `${JINA_READER_BASE}${targetUrl}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {
      Accept: 'text/markdown',
    };

    // Use Jina API key if available (higher rate limits)
    const jinaKey = process.env.JINA_API_KEY;
    if (jinaKey) {
      headers['Authorization'] = `Bearer ${jinaKey}`;
    }

    const response = await fetch(jinaUrl, {
      headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      if (response.status === 429) {
        return {
          url: targetUrl,
          markdown: '',
          status: 'blocked',
          error: 'Rate limited by Jina Reader',
        };
      }

      return {
        url: targetUrl,
        markdown: '',
        status: 'error',
        error: `Jina returned HTTP ${response.status}`,
      };
    }

    let markdown = await response.text();

    // Truncate if too large
    const limit = maxLength ?? MAX_MARKDOWN_LENGTH;
    if (markdown.length > limit) {
      markdown = markdown.slice(0, limit) + '\n\n[Content truncated]';
    }

    // Check for minimal content
    if (markdown.trim().length < 100) {
      return {
        url: targetUrl,
        markdown,
        status: 'error',
        error: 'Page returned minimal content',
      };
    }

    return {
      url: targetUrl,
      markdown,
      status: 'success',
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return {
        url: targetUrl,
        markdown: '',
        status: 'timeout',
        error: `Request timed out after ${FETCH_TIMEOUT_MS}ms`,
      };
    }

    throw error; // Re-throw for the caller to handle
  } finally {
    clearTimeout(timeout);
  }
}
