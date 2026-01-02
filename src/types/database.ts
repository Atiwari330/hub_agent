import { z } from 'zod';

// Supabase table types

export const OwnerRecordSchema = z.object({
  id: z.string().uuid(),
  hubspot_owner_id: z.string(),
  email: z.string().email(),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  synced_at: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type OwnerRecord = z.infer<typeof OwnerRecordSchema>;

export const DealRecordSchema = z.object({
  id: z.string().uuid(),
  hubspot_deal_id: z.string(),
  deal_name: z.string(),
  amount: z.number().nullable(),
  close_date: z.string().nullable(),
  pipeline: z.string().nullable(),
  deal_stage: z.string().nullable(),
  owner_id: z.string().uuid().nullable(),
  synced_at: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type DealRecord = z.infer<typeof DealRecordSchema>;

export const SentimentAnalysisSchema = z.object({
  id: z.string().uuid(),
  deal_id: z.string().uuid(),
  sentiment_score: z.enum(['positive', 'neutral', 'negative']),
  confidence: z.number().min(0).max(1),
  summary: z.string(),
  key_factors: z.array(z.string()).nullable(),
  recommendations: z.array(z.string()).nullable(),
  analyzed_at: z.string(),
  created_at: z.string(),
});

export type SentimentAnalysis = z.infer<typeof SentimentAnalysisSchema>;

export const WorkflowRunSchema = z.object({
  id: z.string().uuid(),
  workflow_name: z.string(),
  status: z.enum(['pending', 'running', 'completed', 'failed']),
  started_at: z.string(),
  completed_at: z.string().nullable(),
  result: z.record(z.string(), z.unknown()).nullable(),
  error: z.string().nullable(),
  created_at: z.string(),
});

export type WorkflowRun = z.infer<typeof WorkflowRunSchema>;

export const AgentConversationSchema = z.object({
  id: z.string().uuid(),
  prompt: z.string(),
  response: z.string(),
  tools_used: z.array(z.string()).nullable(),
  duration_ms: z.number().nullable(),
  created_at: z.string(),
});

export type AgentConversation = z.infer<typeof AgentConversationSchema>;

export const QuotaRecordSchema = z.object({
  id: z.string().uuid(),
  owner_id: z.string().uuid(),
  fiscal_year: z.number().int(),
  fiscal_quarter: z.number().int().min(1).max(4),
  quota_amount: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type QuotaRecord = z.infer<typeof QuotaRecordSchema>;
