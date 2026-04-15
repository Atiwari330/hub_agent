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
  // Additional columns from 001_initial_schema.sql that weren't in the original type
  description: z.string().nullable().optional(),
  hubspot_owner_id: z.string().nullable().optional(),
  // Additional properties from 002_add_deal_properties.sql
  hubspot_created_at: z.string().nullable().optional(),
  lead_source: z.string().nullable().optional(),
  last_activity_date: z.string().nullable().optional(),
  next_activity_date: z.string().nullable().optional(),
  next_step: z.string().nullable().optional(),
  products: z.string().nullable().optional(),
  deal_substage: z.string().nullable().optional(),
  // Stage entry timestamps from 003_stage_timestamps.sql
  sql_entered_at: z.string().nullable().optional(),
  demo_scheduled_entered_at: z.string().nullable().optional(),
  demo_completed_entered_at: z.string().nullable().optional(),
  closed_won_entered_at: z.string().nullable().optional(),
  // Next-step analysis columns from 004_next_step_analysis.sql
  next_step_due_date: z.string().nullable().optional(),
  next_step_action_type: z.string().nullable().optional(),
  next_step_status: z.string().nullable().optional(),
  next_step_confidence: z.number().nullable().optional(),
  next_step_display_message: z.string().nullable().optional(),
  next_step_analyzed_at: z.string().nullable().optional(),
  next_step_analyzed_value: z.string().nullable().optional(),
  next_step_last_updated_at: z.string().nullable().optional(),
  // Deal collaborator from 007_hygiene_commitments.sql
  deal_collaborator: z.string().nullable().optional(),
  // Discovery stage timestamp from 017_discovery_stage_tracking.sql
  discovery_entered_at: z.string().nullable().optional(),
  // MQL stage timestamp from 018_add_mql_entered_at.sql
  mql_entered_at: z.string().nullable().optional(),
  // Hot Tracker columns from 021_hot_tracker.sql
  proposal_entered_at: z.string().nullable().optional(),
  sent_gift_or_incentive: z.boolean().nullable().optional(),
  // Lead source detail from 074_add_lead_source_detail.sql
  lead_source_detail: z.string().nullable().optional(),
});

export type DealRecord = z.infer<typeof DealRecordSchema>;
export type DealColumn = keyof DealRecord;

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

export const AeTargetRecordSchema = z.object({
  id: z.string().uuid(),
  owner_id: z.string().uuid(),
  fiscal_year: z.number().int(),
  fiscal_quarter: z.number().int().min(1).max(4),
  target_amount: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type AeTargetRecord = z.infer<typeof AeTargetRecordSchema>;

export const HygieneCommitmentRecordSchema = z.object({
  id: z.string().uuid(),
  deal_id: z.string().uuid(),
  owner_id: z.string().uuid(),
  commitment_date: z.string(),
  committed_at: z.string(),
  status: z.enum(['pending', 'completed', 'escalated']),
  resolved_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type HygieneCommitmentRecord = z.infer<typeof HygieneCommitmentRecordSchema>;
