/**
 * Tavily Search Client for compliance research
 *
 * Wraps the Tavily SDK to run multiple compliance-focused search queries
 * with rate limiting and deduplication.
 */

import { tavily, type TavilySearchResponse } from '@tavily/core';

export interface ComplianceSearchResult {
  query: string;
  answer: string | undefined;
  results: {
    title: string;
    url: string;
    content: string;
    score: number;
  }[];
}

export interface ComplianceSearchOutput {
  searches: ComplianceSearchResult[];
  allUrls: string[];
  rawResponses: TavilySearchResponse[];
}

const DELAY_BETWEEN_QUERIES_MS = 500;

function getTavilyClient() {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error('TAVILY_API_KEY is not configured');
  return tavily({ apiKey });
}

/**
 * Run multiple compliance search queries via Tavily with rate limiting.
 * Returns deduplicated results across all queries.
 */
export async function searchCompliance(
  queries: string[]
): Promise<ComplianceSearchOutput> {
  const client = getTavilyClient();
  const searches: ComplianceSearchResult[] = [];
  const rawResponses: TavilySearchResponse[] = [];
  const seenUrls = new Set<string>();

  for (let i = 0; i < queries.length; i++) {
    const query = queries[i];

    try {
      const response = await client.search(query, {
        searchDepth: 'advanced',
        maxResults: 5,
        includeAnswer: true,
      });

      rawResponses.push(response);

      const dedupedResults = response.results.filter((r) => {
        if (seenUrls.has(r.url)) return false;
        seenUrls.add(r.url);
        return true;
      });

      searches.push({
        query,
        answer: response.answer,
        results: dedupedResults.map((r) => ({
          title: r.title,
          url: r.url,
          content: r.content,
          score: r.score,
        })),
      });
    } catch (error) {
      console.error(`Tavily search failed for query "${query}":`, error);
      searches.push({
        query,
        answer: undefined,
        results: [],
      });
    }

    // Rate limit between queries
    if (i < queries.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_QUERIES_MS));
    }
  }

  return {
    searches,
    allUrls: [...seenUrls],
    rawResponses,
  };
}
