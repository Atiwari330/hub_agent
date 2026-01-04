/**
 * Types for AI-generated exception context summaries
 */

export type ExceptionUrgency = 'critical' | 'high' | 'medium' | 'low';

export interface ExceptionContext {
  diagnosis: string;
  recentActivity: string;
  recommendedAction: string;
  urgency: ExceptionUrgency;
  confidence: number;
}

export interface ExceptionContextResponse extends ExceptionContext {
  cached: boolean;
  generatedAt: string;
}

export interface ExceptionContextInput {
  deal: {
    dealName: string;
    amount: number | null;
    stageName: string;
    closeDate: string | null;
    daysInStage: number;
    daysSinceActivity: number;
    nextStep: string | null;
    nextStepDueDate: string | null;
  };
  exceptionType: string;
  exceptionDetail: string;
  notes: Array<{
    body: string;
    timestamp: string;
    authorName: string | null;
  }>;
  sentiment: {
    score: string | null;
    summary: string | null;
  } | null;
}

export interface HubSpotNoteWithAuthor {
  id: string;
  properties: {
    hs_note_body: string | null;
    hs_timestamp: string | null;
    hubspot_owner_id: string | null;
  };
  authorName: string | null;
}
