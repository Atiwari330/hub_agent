// Sales Pipeline Stage IDs for tracking weekly deal progression
// These are the stage IDs from HubSpot's Sales pipeline

export const SALES_PIPELINE_ID = '1c27e5a3-5e5e-4403-ab0f-d356bf268cf3';

// Stage IDs we want to track for leading indicators
// NOTE: Qualified/Validated (1286807303), Proposal/Evaluating (59865091), and
// MSA Sent/Review (1286807304) are not tracked here yet — they need a DB migration
// to add the corresponding entered_at columns before they can be synced.
export const TRACKED_STAGES = {
  MQL: {
    id: '2030251',
    label: 'MQL',
    property: 'hs_v2_date_entered_2030251',
    dbColumn: 'mql_entered_at',
  },
  SQL: {
    id: '17915773',
    label: 'SQL (legacy - removed from pipeline)',
    property: 'hs_v2_date_entered_17915773',
    dbColumn: 'sql_entered_at',
  },
  DISCOVERY: {
    id: '138092708',
    label: 'SQL/Discovery',
    property: 'hs_v2_date_entered_138092708',
    dbColumn: 'discovery_entered_at',
  },
  DEMO_SCHEDULED: {
    id: 'baedc188-ba76-4a41-8723-5bb99fe7c5bf',
    label: 'Demo - Scheduled',
    // HubSpot replaces hyphens with underscores and appends a numeric suffix for UUID stage IDs
    property: 'hs_v2_date_entered_baedc188_ba76_4a41_8723_5bb99fe7c5bf_1220797901',
    dbColumn: 'demo_scheduled_entered_at',
  },
  DEMO_COMPLETED: {
    id: '963167283',
    label: 'Demo - Completed',
    property: 'hs_v2_date_entered_963167283',
    dbColumn: 'demo_completed_entered_at',
  },
  CLOSED_WON: {
    id: '97b2bcc6-fb34-4b56-8e6e-c349c88ef3d5',
    label: 'Closed Won',
    // HubSpot replaces hyphens with underscores and appends a numeric suffix for UUID stage IDs
    property: 'hs_v2_date_entered_97b2bcc6_fb34_4b56_8e6e_c349c88ef3d5_1208951251',
    dbColumn: 'closed_won_entered_at',
  },
  PROPOSAL: {
    id: '59865091',
    label: 'Proposal/Evaluating',
    property: 'hs_v2_date_entered_59865091',
    dbColumn: 'proposal_entered_at',
  },
} as const;

// Get all HubSpot property names for stage entry timestamps
export function getStageEntryProperties(): string[] {
  return Object.values(TRACKED_STAGES).map((stage) => stage.property);
}

// Map a HubSpot property name to the database column name
export function getDbColumnForProperty(property: string): string | null {
  const stage = Object.values(TRACKED_STAGES).find((s) => s.property === property);
  return stage?.dbColumn ?? null;
}
