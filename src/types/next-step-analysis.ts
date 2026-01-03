/**
 * Next Step Analysis Types
 *
 * Types for LLM-powered extraction of expected action dates
 * from free-text "next step" fields in deals.
 */

/**
 * Status of the next step date extraction
 */
export type NextStepStatus =
  | 'date_found' // Clear date extracted (e.g., "Demo on Jan 15th")
  | 'date_inferred' // Relative date converted (e.g., "next Tuesday" → actual date)
  | 'no_date' // No date mentioned (e.g., "Need to connect with CFO")
  | 'date_unclear' // Vague timeframe (e.g., "soon", "when ready")
  | 'awaiting_external' // Ball in someone else's court (e.g., "Waiting on their legal team")
  | 'empty' // Field is blank or whitespace only
  | 'unparseable'; // Nonsense or unrelated content

/**
 * Type of action mentioned in the next step
 */
export type NextStepActionType =
  | 'demo'
  | 'call'
  | 'email'
  | 'proposal'
  | 'meeting'
  | 'follow_up'
  | 'contract'
  | 'security_review'
  | 'other'
  | null;

/**
 * Result of analyzing a next step field
 */
export interface NextStepAnalysis {
  /** Classification of what was found in the next step text */
  status: NextStepStatus;

  /** Extracted due date in ISO format (YYYY-MM-DD), null if no date found */
  dueDate: string | null;

  /** Confidence score 0-1 (lower for inferred dates, higher for explicit) */
  confidence: number;

  /** Human-readable message for display in UI */
  displayMessage: string;

  /** Type of action if detectable */
  actionType: NextStepActionType;
}

/**
 * Full result including deal context and metadata
 */
export interface NextStepAnalysisResult {
  /** HubSpot deal ID */
  dealId: string;

  /** Deal name for display */
  dealName: string;

  /** The raw next step text that was analyzed */
  nextStep: string | null;

  /** When the next step field was last updated in HubSpot (from property history) */
  nextStepUpdatedAt: string | null;

  /** The analysis results */
  analysis: NextStepAnalysis;

  /** When this analysis was performed */
  analyzedAt: string;
}

/**
 * Input for the LLM extraction function
 */
export interface NextStepExtractionInput {
  /** The next step text to analyze */
  nextStepText: string | null;

  /** Reference date for relative date calculations (defaults to today) */
  referenceDate?: Date;
}

/**
 * Database row shape for next step analysis fields
 */
export interface NextStepAnalysisDbFields {
  next_step_due_date: string | null;
  next_step_action_type: string | null;
  next_step_status: NextStepStatus | null;
  next_step_confidence: number | null;
  next_step_display_message: string | null;
  next_step_analyzed_at: string | null;
  next_step_analyzed_value: string | null;
  next_step_last_updated_at: string | null;
}
