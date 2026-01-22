import { z } from 'zod';

// Call period types
export const CallPeriodSchema = z.enum(['today', 'this_week', 'this_month', 'quarter']);
export type CallPeriod = z.infer<typeof CallPeriodSchema>;

// Raw call data from HubSpot
export const CallDataSchema = z.object({
  id: z.string(),
  timestamp: z.date(),
  title: z.string().nullable(),
  durationMs: z.number().nullable(),
  status: z.string().nullable(),
  outcomeId: z.string().nullable(),
  body: z.string().nullable(),
});

export type CallData = z.infer<typeof CallDataSchema>;

// Outcome breakdown counts
export const OutcomeBreakdownSchema = z.object({
  connected: z.number(),
  leftVoicemail: z.number(),
  leftLiveMessage: z.number(),
  noAnswer: z.number(),
  wrongNumber: z.number(),
  busy: z.number(),
  unknown: z.number(),
});

export type OutcomeBreakdown = z.infer<typeof OutcomeBreakdownSchema>;

// Daily trend data point
export const DailyTrendPointSchema = z.object({
  date: z.string(), // YYYY-MM-DD
  calls: z.number(),
  connected: z.number(),
});

export type DailyTrendPoint = z.infer<typeof DailyTrendPointSchema>;

// Call summary metrics
export const CallSummarySchema = z.object({
  totalCalls: z.number(),
  connectedCalls: z.number(),
  connectRate: z.number(), // 0-100
  avgDurationMs: z.number(),
  avgDurationFormatted: z.string(), // e.g., "1:12"
});

export type CallSummary = z.infer<typeof CallSummarySchema>;

// Period info
export const PeriodInfoSchema = z.object({
  type: CallPeriodSchema,
  label: z.string(),
  startDate: z.string(), // ISO string
  endDate: z.string(), // ISO string
});

export type PeriodInfo = z.infer<typeof PeriodInfoSchema>;

// Owner info (subset for response)
export const CallOwnerInfoSchema = z.object({
  id: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  email: z.string(),
});

export type CallOwnerInfo = z.infer<typeof CallOwnerInfoSchema>;

// Full API response
export const CallActivityResponseSchema = z.object({
  owner: CallOwnerInfoSchema,
  period: PeriodInfoSchema,
  summary: CallSummarySchema,
  outcomeBreakdown: OutcomeBreakdownSchema,
  dailyTrend: z.array(DailyTrendPointSchema),
});

export type CallActivityResponse = z.infer<typeof CallActivityResponseSchema>;
