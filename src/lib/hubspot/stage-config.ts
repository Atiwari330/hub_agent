/**
 * Centralized Sales Pipeline stage configuration.
 *
 * Single source of truth for all stage IDs, labels, and derived arrays used
 * across queue routes, UI components, and the sync job.
 *
 * When HubSpot stages change, update SALES_PIPELINE_STAGES here and all
 * consumers pick up the change automatically.
 */

// Full stage definitions (single source of truth)
export const SALES_PIPELINE_STAGES = {
  MQL:                  { id: '2030251',                                   label: 'MQL' },
  SQL_LEGACY:           { id: '17915773',                                  label: 'SQL (legacy - removed)' },
  SQL_DISCOVERY:        { id: '138092708',                                 label: 'SQL/Discovery' },
  DEMO_SCHEDULED:       { id: 'baedc188-ba76-4a41-8723-5bb99fe7c5bf',     label: 'Demo - Scheduled' },
  DEMO_COMPLETED:       { id: '963167283',                                 label: 'Demo - Completed' },
  QUALIFIED_VALIDATED:  { id: '1286807303',                                label: 'Qualified/Validated' },
  PROPOSAL_EVALUATING:  { id: '59865091',                                  label: 'Proposal/Evaluating' },
  MSA_SENT_REVIEW:      { id: '1286807304',                                label: 'MSA Sent/Review' },
  CLOSED_WON:           { id: '97b2bcc6-fb34-4b56-8e6e-c349c88ef3d5',     label: 'Closed Won' },
  CLOSED_LOST:          { id: '4f186989-8c95-4356-aa43-f8a498d0e927',     label: 'Closed Lost' },
} as const;

const S = SALES_PIPELINE_STAGES;

// Queue routes: excludes MQL + Closed stages (active working stages only)
export const ACTIVE_STAGE_IDS: string[] = [
  S.SQL_LEGACY.id,
  S.SQL_DISCOVERY.id,
  S.DEMO_SCHEDULED.id,
  S.DEMO_COMPLETED.id,
  S.QUALIFIED_VALIDATED.id,
  S.PROPOSAL_EVALUATING.id,
  S.MSA_SENT_REVIEW.id,
];

// PPL sequence: includes MQL, excludes Closed
export const ALL_OPEN_STAGE_IDS: string[] = [
  S.MQL.id,
  S.SQL_LEGACY.id,
  S.SQL_DISCOVERY.id,
  S.DEMO_SCHEDULED.id,
  S.DEMO_COMPLETED.id,
  S.QUALIFIED_VALIDATED.id,
  S.PROPOSAL_EVALUATING.id,
  S.MSA_SENT_REVIEW.id,
];

// Pre-demo pipeline: MQL through Demo Scheduled
export const PRE_DEMO_STAGE_IDS: string[] = [
  S.MQL.id,
  S.SQL_LEGACY.id,
  S.SQL_DISCOVERY.id,
  S.DEMO_SCHEDULED.id,
];

// UI dropdown options (excludes SQL legacy since it's gone from HubSpot)
export const ACTIVE_STAGE_OPTIONS: { id: string; label: string }[] = [
  { id: S.SQL_DISCOVERY.id,       label: S.SQL_DISCOVERY.label },
  { id: S.DEMO_SCHEDULED.id,      label: S.DEMO_SCHEDULED.label },
  { id: S.DEMO_COMPLETED.id,      label: S.DEMO_COMPLETED.label },
  { id: S.QUALIFIED_VALIDATED.id,  label: S.QUALIFIED_VALIDATED.label },
  { id: S.PROPOSAL_EVALUATING.id, label: S.PROPOSAL_EVALUATING.label },
  { id: S.MSA_SENT_REVIEW.id,     label: S.MSA_SENT_REVIEW.label },
];

// Default stages pre-selected across sales pipeline queues
export const DEFAULT_QUEUE_STAGES: string[] = [
  S.DEMO_COMPLETED.label,
  S.MSA_SENT_REVIEW.label,
  S.PROPOSAL_EVALUATING.label,
  S.QUALIFIED_VALIDATED.label,
];

export const DEFAULT_QUEUE_STAGE_IDS: Set<string> = new Set([
  S.DEMO_COMPLETED.id,
  S.MSA_SENT_REVIEW.id,
  S.PROPOSAL_EVALUATING.id,
  S.QUALIFIED_VALIDATED.id,
]);

// Set of all known stage IDs (for health check comparison)
export const ALL_KNOWN_STAGE_IDS: Set<string> = new Set(
  Object.values(SALES_PIPELINE_STAGES).map((s) => s.id)
);
