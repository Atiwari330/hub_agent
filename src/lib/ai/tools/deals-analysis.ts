import { tool } from 'ai';
import { z } from 'zod';
import { runDealsAnalysis } from '@/lib/analysis/deals-analysis';

export const dealsAnalysisTool = tool({
  description:
    'Run a comprehensive deals analysis showing conversion rates, lead source quality, AE performance, funnel metrics, and data quality issues. Use this when asked about lead quality, source effectiveness, win rates, pipeline health, or marketing ROI. Returns structured data with revenue breakdown, lead source performance table, AE comparison, funnel progression, and data quality alerts.',
  inputSchema: z.object({
    year: z
      .number()
      .optional()
      .describe('Year to analyze (default: current year). Use this to compare year-over-year.'),
  }),
  execute: async ({ year }) => {
    return await runDealsAnalysis({ year });
  },
});
