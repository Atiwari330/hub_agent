/**
 * Domain Enrichment Pipeline
 *
 * Orchestrates the full enrichment flow:
 * 1. Extract domain from email
 * 2. Filter free providers
 * 3. Scrape website via Jina Reader
 * 4. Analyze with Claude
 * 5. Store in Supabase
 */

import { createServiceClient } from '../supabase/client';
import { extractDomain, isFreeEmailProvider } from './domain-utils';
import { scrapeWebsite, scrapePages, type ScrapeResult } from './website-scraper';
import { analyzeCompany, type CompanyAnalysis } from './company-analyzer';
import { discoverSubpages } from './page-discovery';

export interface EnrichmentResult {
  domain: string;
  status: 'success' | 'failed' | 'parked' | 'unreachable' | 'skipped' | 'already_enriched';
  analysis?: CompanyAnalysis;
  scrapeResult?: ScrapeResult;
  error?: string;
  skipReason?: string;
}

export interface EnrichmentOptions {
  /** Skip Supabase storage (for dry runs) */
  dryRun?: boolean;
  /** Print verbose output */
  verbose?: boolean;
  /** Force re-enrichment even if domain exists */
  force?: boolean;
}

/**
 * Enrich a single domain from an email address.
 */
export async function enrichFromEmail(
  email: string,
  options: EnrichmentOptions = {}
): Promise<EnrichmentResult> {
  const domain = extractDomain(email);
  if (!domain) {
    return {
      domain: email,
      status: 'skipped',
      skipReason: 'Invalid email address',
    };
  }

  if (isFreeEmailProvider(domain)) {
    return {
      domain,
      status: 'skipped',
      skipReason: `Free email provider: ${domain}`,
    };
  }

  return enrichDomain(domain, { ...options, sourceEmail: email });
}

/**
 * Enrich a single domain. Core pipeline function.
 */
export async function enrichDomain(
  domain: string,
  options: EnrichmentOptions & { sourceEmail?: string } = {}
): Promise<EnrichmentResult> {
  const { dryRun, verbose, force, sourceEmail } = options;

  // Check if already enriched (unless force flag)
  if (!dryRun && !force) {
    const existing = await getExistingEnrichment(domain);
    if (existing) {
      if (verbose) {
        console.log(`  Already enriched: ${domain} (status: ${existing.status})`);
      }
      // Append new source email if provided
      if (sourceEmail && !existing.source_emails?.includes(sourceEmail)) {
        await appendSourceEmail(domain, sourceEmail);
      }
      return {
        domain,
        status: 'already_enriched',
        analysis: existing.company_name ? {
          company_name: existing.company_name,
          company_overview: existing.company_overview,
          services: existing.services || [],
          specialties: existing.specialties || [],
          team_members: existing.team_members || [],
          community_events: existing.community_events || [],
          locations: existing.locations || [],
          is_parked_domain: existing.status === 'parked',
          confidence_score: existing.confidence_score ?? 0,
        } : undefined,
      };
    }
  }

  // Step 1: Scrape website
  if (verbose) console.log(`  Scraping ${domain}...`);
  const scrapeResult = await scrapeWebsite(domain);

  if (scrapeResult.status !== 'success') {
    const result: EnrichmentResult = {
      domain,
      status: scrapeResult.status === 'timeout' || scrapeResult.status === 'unreachable'
        ? 'unreachable'
        : 'failed',
      scrapeResult,
      error: scrapeResult.error,
    };

    if (!dryRun) {
      await storeEnrichment(domain, result, scrapeResult, null, sourceEmail);
    }

    return result;
  }

  if (verbose) {
    console.log(`  Scraped ${scrapeResult.markdown.length} chars from ${scrapeResult.url}`);
  }

  // Step 2: Discover and scrape additional pages (team/about) via tiered fallback
  const allPageUrls: string[] = [scrapeResult.url];
  let combinedMarkdown = scrapeResult.markdown;

  const discoveredPages = await discoverSubpages(scrapeResult.markdown, domain, { verbose });

  if (discoveredPages.length > 0) {
    if (verbose) {
      console.log(`  Discovered ${discoveredPages.length} relevant page(s) via ${discoveredPages[0].source}:`);
      for (const page of discoveredPages) {
        console.log(`    - [${page.score}] ${page.url} (${page.label})`);
      }
    }

    const additionalUrls = discoveredPages.map((p) => p.url);
    const additionalResults = await scrapePages(additionalUrls);

    const successfulPages = additionalResults.filter((r) => r.status === 'success');

    if (verbose) {
      console.log(`  Scraped ${successfulPages.length}/${additionalUrls.length} additional page(s)`);
    }

    for (const page of successfulPages) {
      allPageUrls.push(page.url);
    }

    combinedMarkdown = combineMarkdown(scrapeResult, successfulPages);
  } else if (verbose) {
    console.log('  No relevant team/about links discovered (all tiers exhausted)');
  }

  // Step 3: Analyze with Claude
  if (verbose) console.log(`  Analyzing with Claude (${combinedMarkdown.length} chars across ${allPageUrls.length} page(s))...`);

  if (dryRun) {
    return {
      domain,
      status: 'success',
      scrapeResult,
      error: 'Dry run - skipped AI analysis and storage',
    };
  }

  const analysis = await analyzeCompany(combinedMarkdown, domain);

  if (verbose) {
    console.log(`  Analysis complete (confidence: ${analysis.confidence_score})`);
  }

  // Determine final status
  const status = analysis.is_parked_domain ? 'parked' : 'success';

  const result: EnrichmentResult = {
    domain,
    status,
    analysis,
    scrapeResult,
  };

  // Step 4: Store in Supabase
  await storeEnrichment(domain, result, scrapeResult, analysis, sourceEmail, {
    allPageUrls,
    combinedMarkdown,
  });

  return result;
}

/**
 * Enrich all contacts associated with a HubSpot deal.
 */
export async function enrichDeal(
  dealId: string,
  options: EnrichmentOptions = {}
): Promise<{ dealId: string; results: EnrichmentResult[] }> {
  // Dynamic import to avoid circular dependencies
  const { getContactEmailsByDealId } = await import('../hubspot/contacts');

  const emails = await getContactEmailsByDealId(dealId);

  if (options.verbose) {
    console.log(`Found ${emails.length} contact email(s) for deal ${dealId}`);
  }

  // Deduplicate by domain
  const seenDomains = new Set<string>();
  const results: EnrichmentResult[] = [];

  for (const email of emails) {
    const domain = extractDomain(email);
    if (!domain || seenDomains.has(domain)) continue;
    seenDomains.add(domain);

    if (options.verbose) {
      console.log(`\nProcessing: ${email} -> ${domain}`);
    }

    const result = await enrichFromEmail(email, options);
    results.push(result);
  }

  return { dealId, results };
}

// ===== Supabase Helpers =====

async function getExistingEnrichment(domain: string) {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('domain_enrichments')
    .select('domain, status, source_emails, website_url, company_name, company_overview, services, specialties, team_members, community_events, locations, confidence_score')
    .eq('domain', domain)
    .single();

  return data;
}

async function appendSourceEmail(domain: string, email: string) {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('domain_enrichments')
    .select('source_emails')
    .eq('domain', domain)
    .single();

  const emails: string[] = data?.source_emails || [];
  if (!emails.includes(email)) {
    emails.push(email);
    await supabase
      .from('domain_enrichments')
      .update({ source_emails: emails, updated_at: new Date().toISOString() })
      .eq('domain', domain);
  }
}

async function storeEnrichment(
  domain: string,
  result: EnrichmentResult,
  scrapeResult: ScrapeResult | null,
  analysis: CompanyAnalysis | null,
  sourceEmail?: string,
  multiPage?: { allPageUrls: string[]; combinedMarkdown: string }
) {
  const supabase = createServiceClient();
  const now = new Date().toISOString();

  const row = {
    domain,
    website_url: scrapeResult?.url || null,
    status: result.status === 'already_enriched' ? 'success' : result.status,
    raw_markdown: multiPage?.combinedMarkdown ?? scrapeResult?.markdown ?? null,
    pages_scraped: multiPage?.allPageUrls ?? (scrapeResult?.url ? [scrapeResult.url] : null),
    company_name: analysis?.company_name || null,
    company_overview: analysis?.company_overview || null,
    services: analysis?.services || null,
    specialties: analysis?.specialties || null,
    team_members: analysis?.team_members || null,
    community_events: analysis?.community_events || null,
    locations: analysis?.locations || null,
    source_emails: sourceEmail ? [sourceEmail] : null,
    error_message: result.error || null,
    confidence_score: analysis?.confidence_score ?? null,
    enriched_at: analysis ? now : null,
    updated_at: now,
  };

  const { error } = await supabase
    .from('domain_enrichments')
    .upsert(row, { onConflict: 'domain' });

  if (error) {
    console.error(`Failed to store enrichment for ${domain}:`, error.message);
  }
}

// ===== Multi-page Helpers =====

const TOTAL_MARKDOWN_BUDGET = 200_000;

/**
 * Combine homepage markdown with additional scraped pages.
 * Homepage gets full priority; additional pages fill remaining budget.
 */
function combineMarkdown(
  homepage: ScrapeResult,
  additionalPages: ScrapeResult[]
): string {
  if (additionalPages.length === 0) return homepage.markdown;

  let combined = homepage.markdown;
  let remaining = TOTAL_MARKDOWN_BUDGET - combined.length;

  for (const page of additionalPages) {
    if (remaining <= 0) break;

    const header = `\n\n---\n\n## Additional Page: ${page.url}\n\n`;
    const headerLen = header.length;

    if (remaining <= headerLen) break;

    const contentBudget = remaining - headerLen;
    const content =
      page.markdown.length > contentBudget
        ? page.markdown.slice(0, contentBudget) + '\n\n[Content truncated]'
        : page.markdown;

    combined += header + content;
    remaining = TOTAL_MARKDOWN_BUDGET - combined.length;
  }

  return combined;
}
