/**
 * Compliance Analyzer - Claude-powered synthesis of compliance research
 *
 * Takes search results from Tavily and uses Claude to extract structured
 * compliance requirements, screening tools, reporting platforms, etc.
 */

import { generateObject } from 'ai';
import { z } from 'zod';
import { getDeepSeekModel } from '../ai/provider';
import type { ResearchContext } from './query-generator';
import type { ComplianceSearchOutput } from './tavily-client';

// --- Zod Schemas ---

const stateRequirementSchema = z.object({
  requirement: z.string().describe('Name or title of the requirement'),
  description: z.string().describe('Description of what is required'),
  source_url: z.string().nullable().describe('URL where this requirement was found'),
  category: z.string().describe('Category: documentation, billing, clinical, administrative'),
});

const screeningToolSchema = z.object({
  name: z.string().describe('Name of the screening tool or assessment'),
  description: z.string().describe('What it screens for and how it is used'),
  when_required: z.string().describe('When this tool must be used (e.g., intake, annual review)'),
  source_url: z.string().nullable().describe('URL where this requirement was found'),
});

const reportingPlatformSchema = z.object({
  name: z.string().describe('Name of the reporting platform or system'),
  description: z.string().describe('What it does and who uses it'),
  url: z.string().nullable().describe('URL of the platform itself'),
  state: z.string().describe('State that requires this platform'),
  source_url: z.string().nullable().describe('URL where this requirement was found'),
});

const licensingRequirementSchema = z.object({
  requirement: z.string().describe('Name of the license or certification'),
  issuing_body: z.string().describe('Organization that issues this license'),
  description: z.string().describe('What is required to obtain and maintain'),
  source_url: z.string().nullable().describe('URL where this requirement was found'),
});

const payorRequirementSchema = z.object({
  payor: z.string().describe('Name of the payor (e.g., Medicaid, Medicare, BlueCross)'),
  requirements: z.array(z.string()).describe('Specific compliance requirements for this payor'),
  source_url: z.string().nullable().describe('URL where this requirement was found'),
});

const documentationStandardSchema = z.object({
  standard: z.string().describe('Name of the documentation standard'),
  description: z.string().describe('What must be documented and how'),
  applies_to: z.string().describe('What services or situations this applies to'),
  source_url: z.string().nullable().describe('URL where this requirement was found'),
});

const accreditationInfoSchema = z.object({
  body: z.string().describe('Accreditation body (e.g., CARF, JCAHO, state agency)'),
  requirement: z.string().describe('Specific accreditation requirement'),
  description: z.string().describe('Details about the requirement'),
  source_url: z.string().nullable().describe('URL where this requirement was found'),
});

export const complianceAnalysisSchema = z.object({
  state_requirements: z.array(stateRequirementSchema)
    .describe('State-specific regulatory requirements for behavioral health'),
  screening_tools: z.array(screeningToolSchema)
    .describe('Required or recommended screening tools and assessments'),
  reporting_platforms: z.array(reportingPlatformSchema)
    .describe('State reporting platforms and systems'),
  licensing_requirements: z.array(licensingRequirementSchema)
    .describe('Licensing and certification requirements'),
  payor_requirements: z.array(payorRequirementSchema)
    .describe('Payor-specific compliance requirements'),
  documentation_standards: z.array(documentationStandardSchema)
    .describe('Documentation and treatment plan standards'),
  accreditation_info: z.array(accreditationInfoSchema)
    .describe('Accreditation requirements and standards'),
  executive_summary: z.string()
    .describe('2-3 paragraph overview of compliance landscape for the sales team'),
  key_talking_points: z.array(z.string())
    .describe('5-10 bullet points the sales team can use in conversations with this prospect'),
  confidence_score: z.number().min(0).max(1)
    .describe('Confidence in research quality: 1.0=comprehensive, 0.5=partial, 0.1=sparse'),
});

export type ComplianceAnalysis = z.infer<typeof complianceAnalysisSchema>;

const SYSTEM_PROMPT = `You are a compliance research analyst specializing in behavioral health regulations.

You are synthesizing web search results into structured compliance intelligence for a sales team
that sells EHR (Electronic Health Records) software to behavioral health providers.

IMPORTANT RULES:
1. Only include findings that are directly supported by the search results provided.
2. Always cite source URLs when available. If a finding has no source URL, set source_url to null.
3. Focus specifically on behavioral health, substance abuse treatment, and mental health contexts.
4. Prioritize actionable, specific requirements over generic advice.
5. If information may be outdated, note this in the description (e.g., "as of 2024, verify current status").
6. Do NOT fabricate requirements or URLs that aren't in the search results.
7. For the executive summary, write 2-3 paragraphs that a salesperson could quickly read before a call.
8. For key talking points, write them as things the salesperson would SAY to the prospect,
   demonstrating domain knowledge (e.g., "We know Alaska requires the AST screening tool...").

For confidence_score:
- 1.0 = Comprehensive results with multiple authoritative sources
- 0.7-0.9 = Good coverage but some areas sparse
- 0.4-0.6 = Partial coverage, significant gaps
- 0.1-0.3 = Very limited results, mostly generic
- 0.0 = No useful compliance information found`;

/**
 * Analyze search results and synthesize structured compliance data.
 */
export async function analyzeComplianceResearch(
  context: ResearchContext,
  searchOutput: ComplianceSearchOutput
): Promise<ComplianceAnalysis> {
  // Build the search results content for the prompt
  const searchContent = searchOutput.searches
    .map((s) => {
      const resultsText = s.results
        .map((r) => `  - [${r.title}](${r.url})\n    ${r.content}`)
        .join('\n');
      const answerText = s.answer ? `  AI Summary: ${s.answer}` : '';
      return `Query: "${s.query}"\n${answerText}\n  Results:\n${resultsText}`;
    })
    .join('\n\n');

  const { object } = await generateObject({
    model: getDeepSeekModel(),
    schema: complianceAnalysisSchema,
    system: SYSTEM_PROMPT,
    prompt: `Analyze the following search results and extract structured compliance requirements
for a behavioral health provider in ${context.state}.

Company Context:
- State: ${context.state}
- Services: ${context.services.join(', ') || 'General behavioral health'}
- Specialties: ${context.specialties.join(', ') || 'Not specified'}
- Locations: ${context.locations.join(', ')}
- Company: ${context.companyName || 'Unknown'}

Search Results:
${searchContent}

Extract all relevant compliance requirements, screening tools, reporting platforms,
licensing requirements, payor rules, documentation standards, and accreditation info.
Generate an executive summary and key talking points for the sales team.`,
  });

  return object;
}
