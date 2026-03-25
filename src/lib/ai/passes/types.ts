import type { TicketEngagement, TicketEngagementTimeline } from '@/lib/hubspot/ticket-engagements';
import type { LinearIssueContext } from '@/lib/linear/client';
import type { ActionItem, RelatedTicketInfo } from '@/app/api/queues/support-action-board/analyze/analyze-core';

// --- Thread message from HubSpot conversations API ---

export interface ThreadMessage {
  id: string;
  type: string;
  createdAt: string;
  text?: string;
  subject?: string;
  senders?: Array<{ name?: string; actorId?: string }>;
}

// --- Related ticket data (from DB, before LLM analysis) ---

export interface RelatedTicketData {
  hubspot_ticket_id: string;
  subject: string | null;
  situation_summary?: string | null;
}

// --- Completion data (from DB) ---

export interface CompletionData {
  id: string;
  action_item_id: string;
  action_description: string;
  completed_at: string;
  completed_by: string;
  completed_by_name: string;
  verified: boolean | null;
  verification_note: string | null;
}

// --- Shared context gathered once and passed to all passes ---

export interface TicketContext {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ticket: Record<string, any>;
  ownerName: string | null;
  conversationMessages: ThreadMessage[];
  conversationText: string;
  engagementTimeline: TicketEngagementTimeline;
  engagementTimelineText: string;
  linearContext: LinearIssueContext | null;
  customerContext: string | null;
  relatedTickets: RelatedTicketData[];
  recentCompletions: CompletionData[];
  ageDays: number | null;
}

// --- Pass result types ---

export interface SituationPassResult {
  situation_summary: string;
  context_snapshot: string;
}

export interface ActionItemPassResult {
  action_items: ActionItem[];
  status_tags: string[];
}

export interface TemperaturePassResult {
  customer_temperature: string;
  temperature_reason: string;
}

export interface TimingPassResult {
  hours_since_customer_waiting: number;
  hours_since_last_outbound: number | null;
  hours_since_last_activity: number | null;
}

export interface VerificationPassResult {
  verifications: Array<{
    completionId: string;
    actionDescription: string;
    verified: boolean;
    note: string;
  }>;
}

export interface CrossTicketPassResult {
  related_ticket_notes: string;
  related_tickets: RelatedTicketInfo[];
}

export interface ResponseDraftPassResult {
  response_draft: string;
  response_guidance: string;
}

// --- Composed pass results ---

export interface AllPassResults {
  situation: SituationPassResult | null;
  actionItems: ActionItemPassResult | null;
  temperature: TemperaturePassResult | null;
  timing: TimingPassResult;
  verification: VerificationPassResult | null;
  crossTicket: CrossTicketPassResult | null;
  responseDraft: ResponseDraftPassResult | null;
}

// --- Quality review types ---

export interface QualityIssue {
  dimension: string;
  severity: 'critical' | 'warning' | 'suggestion';
  description: string;
  affected_field: string;
  suggested_fix: string;
}

export interface QualityReviewResult {
  overall_score: number;
  dimension_scores: {
    specificity: number;
    accuracy: number;
    completeness: number;
    temperature_calibration: number;
    priority_correctness: number;
    actionability: number;
  };
  issues: QualityIssue[];
  pass_approved: boolean;
}

export interface RefinementResult {
  situation_summary?: string;
  action_items?: ActionItem[];
  customer_temperature?: string;
  temperature_reason?: string;
  response_draft?: string;
  response_guidance?: string;
}

// --- Pass type enum ---

export type PassType =
  | 'situation'
  | 'action_items'
  | 'temperature'
  | 'timing'
  | 'verification'
  | 'cross_ticket'
  | 'response_draft'
  | 'quality_review'
  | 'refinement';

export const ALL_PASSES: PassType[] = [
  'situation',
  'action_items',
  'temperature',
  'timing',
  'verification',
  'cross_ticket',
  'response_draft',
];

// Re-export for convenience
export type { ActionItem, RelatedTicketInfo };
export type { TicketEngagement, TicketEngagementTimeline };
export type { LinearIssueContext };
