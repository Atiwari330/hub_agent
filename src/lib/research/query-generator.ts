/**
 * Query Generator - Uses Claude to generate targeted compliance search queries
 *
 * Takes enriched company context (state, services, specialties) and generates
 * domain-specific Tavily search queries for compliance research.
 */

import { generateObject } from 'ai';
import { z } from 'zod';
import { getModel } from '../ai/provider';

export interface ResearchContext {
  state: string;
  services: string[];
  specialties: string[];
  locations: string[];
  companyName: string | null;
}

const querySchema = z.object({
  queries: z
    .array(z.string())
    .min(4)
    .max(8)
    .describe('4-8 targeted search queries for state-specific compliance research'),
});

const SYSTEM_PROMPT = `You are a compliance research assistant specializing in behavioral health regulations.

Given a company's state, services, and specialties, generate 4-8 highly targeted web search queries
to find state-specific compliance requirements for behavioral health practices.

Focus queries on:
1. State-specific behavioral health documentation requirements
2. State Medicaid behavioral health billing and compliance rules
3. Required screening tools and assessment instruments for the state
4. State reporting platforms and systems (e.g., AKAIMS for Alaska, DARMHA for Indiana)
5. Provider licensing and certification requirements
6. Accreditation requirements (CARF, JCAHO, state-specific)
7. Payor-specific compliance rules (Medicaid, Medicare, commercial)

Make queries specific to the state and services. Include the current year (2025 or 2026) where relevant.
DO NOT generate generic queries — each should target a specific compliance area for the given state and service mix.`;

/**
 * Generate targeted compliance search queries from enriched company context.
 */
export async function generateComplianceQueries(
  context: ResearchContext
): Promise<string[]> {
  const { object } = await generateObject({
    model: getModel(),
    schema: querySchema,
    system: SYSTEM_PROMPT,
    prompt: `Generate compliance research search queries for this behavioral health provider:

State: ${context.state}
Services: ${context.services.join(', ') || 'General behavioral health'}
Specialties: ${context.specialties.join(', ') || 'Not specified'}
Locations: ${context.locations.join(', ') || context.state}
Company Name: ${context.companyName || 'Unknown'}

Generate 4-8 specific search queries targeting compliance requirements for this state and service combination.`,
  });

  return object.queries;
}
