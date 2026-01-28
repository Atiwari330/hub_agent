/**
 * Types for AI-powered deal activity check
 *
 * Used to assess whether an AE is actively re-engaging a stalled deal
 * by analyzing recent HubSpot engagements (emails, calls, notes, tasks).
 */

export type EngagementVerdict =
  | 'actively_engaging'
  | 'minimal_effort'
  | 'no_engagement'
  | 'inconclusive';

export interface ActivityEvidence {
  recentEmails: number;
  recentCalls: number;
  recentNotes: number;
  recentTasks: number;
  lastOutreachDate: string | null;
  outreachTypes: string[]; // e.g., ["email", "call"]
}

export interface ActivityCheckResult {
  verdict: EngagementVerdict;
  confidence: number; // 0-1
  summary: string; // 1-2 sentence assessment
  evidence: ActivityEvidence;
  details: string; // Longer AI paragraph with specifics
  checkedAt: string;
}

export interface ActivityCheckResponse extends ActivityCheckResult {
  cached: boolean;
}

export interface ActivityCheckInput {
  deal: {
    dealName: string;
    ownerName: string;
    amount: number | null;
    stageName: string;
    daysSinceActivity: number;
    nextStep: string | null;
    lastActivityDate: string | null;
  };
  notes: Array<{
    body: string;
    timestamp: string | null;
    authorName: string | null;
  }>;
  emails: Array<{
    subject: string;
    body: string;
    direction: string | null;
    timestamp: string | null;
    fromEmail: string | null;
  }>;
  calls: Array<{
    title: string | null;
    body: string | null;
    timestamp: string | null;
    duration: string | null;
    disposition: string | null;
  }>;
  tasks: Array<{
    subject: string | null;
    status: string | null;
    timestamp: string | null;
  }>;
}
