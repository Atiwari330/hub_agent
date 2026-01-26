import { z } from 'zod';

// Call period types
export const CallPeriodSchema = z.enum(['today', 'this_week', 'last_week', 'this_month', 'quarter']);
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

// Call contact association
export const CallContactSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  hubspotUrl: z.string(),
});

export type CallContact = z.infer<typeof CallContactSchema>;

// Call deal association
export const CallDealSchema = z.object({
  id: z.string(),
  name: z.string(),
  amount: z.number().nullable(),
  hubspotUrl: z.string(),
});

export type CallDeal = z.infer<typeof CallDealSchema>;

// Call with associations (for drill-down view)
export const CallWithAssociationsSchema = z.object({
  id: z.string(),
  timestamp: z.string(), // ISO string
  title: z.string().nullable(),
  durationMs: z.number().nullable(),
  durationFormatted: z.string(),
  outcomeId: z.string().nullable(),
  outcomeLabel: z.string(),
  hubspotUrl: z.string(),
  contacts: z.array(CallContactSchema),
  deals: z.array(CallDealSchema),
});

export type CallWithAssociations = z.infer<typeof CallWithAssociationsSchema>;

// Drill-down API response (extends CallActivityResponse with call details)
export const CallDrillDownResponseSchema = CallActivityResponseSchema.extend({
  calls: z.array(CallWithAssociationsSchema),
  filter: z.object({
    type: z.enum(['date', 'outcome']),
    value: z.string(),
    label: z.string(),
  }),
});

export type CallDrillDownResponse = z.infer<typeof CallDrillDownResponseSchema>;
