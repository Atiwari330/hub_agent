/**
 * Company Analyzer - Claude-powered structured extraction
 *
 * Takes scraped website markdown and uses Claude to extract
 * structured business intelligence (services, team, specialties, etc.)
 */

import { generateObject } from 'ai';
import { z } from 'zod';
import { getOpusModel } from '../ai/provider';

// Schema for the structured extraction result
export const companyAnalysisSchema = z.object({
  company_name: z.string().nullable(),
  company_overview: z
    .string()
    .nullable()
    .describe('1-2 sentence description of what the company does'),
  services: z
    .array(
      z.object({
        name: z.string(),
        description: z.string(),
      })
    )
    .describe('Services or products offered by the company'),
  specialties: z
    .array(z.string())
    .describe('Areas of expertise or specialization'),
  team_members: z
    .array(
      z.object({
        name: z.string(),
        title: z.string(),
        bio: z.string().nullable(),
      })
    )
    .describe('Key team members mentioned on the website'),
  community_events: z
    .array(
      z.object({
        name: z.string(),
        description: z.string(),
        date: z.string().nullable(),
      })
    )
    .describe('Community events, webinars, conferences mentioned'),
  locations: z
    .array(z.string())
    .describe('Physical locations (city, state), office addresses, or stated service areas. Include the state name or abbreviation.'),
  is_parked_domain: z
    .boolean()
    .describe('True if this appears to be a parked, for-sale, or placeholder domain'),
  confidence_score: z
    .number()
    .min(0)
    .max(1)
    .describe('Confidence in the extraction quality (0.0-1.0)'),
});

export type CompanyAnalysis = z.infer<typeof companyAnalysisSchema>;

const SYSTEM_PROMPT = `You are analyzing a company website to extract structured business intelligence.
The content may come from multiple pages of the same website, separated by section headers.
Extract information from ALL pages. Team members may appear on a dedicated "Team" or "About" page
rather than the homepage — include all team members found across all pages.

Extract information ONLY from what is explicitly stated on the page(s).
Do NOT fabricate, infer, or hallucinate information that isn't present.
If a category has no information on the page, return an empty array or null.

For locations, look carefully for:
- Addresses in page content, footers, or contact sections
- "Serving [city/state]" or "Located in [city/state]" language
- Phone numbers with area codes that suggest a region
- City/state pairs (e.g., "Austin, TX" or "Portland, Oregon")

For is_parked_domain, return true if the page content suggests:
- A domain parking page ("this domain is for sale", generic ads)
- A placeholder page with no real company content
- A domain registrar default page

For confidence_score:
- 1.0 = Rich, detailed company page with clear information
- 0.7-0.9 = Good content but some sections sparse
- 0.4-0.6 = Limited content, basic information only
- 0.1-0.3 = Very sparse, mostly boilerplate
- 0.0 = Parked domain or no useful content`;

/**
 * Analyze scraped website markdown and extract structured company data.
 */
export async function analyzeCompany(
  markdown: string,
  domain: string
): Promise<CompanyAnalysis> {
  const { object } = await generateObject({
    model: getOpusModel(),
    schema: companyAnalysisSchema,
    system: SYSTEM_PROMPT,
    prompt: `Analyze the following website content from ${domain} and extract structured business intelligence.\n\n${markdown}`,
  });

  return object;
}
