// Sales Pipeline Stage IDs for tracking weekly deal progression
// These are the stage IDs from HubSpot's Sales pipeline

export const SALES_PIPELINE_ID = '1c27e5a3-5e5e-4403-ab0f-d356bf268cf3';

// Stage IDs we want to track for leading indicators
export const TRACKED_STAGES = {
  SQL: {
    id: '17915773',
    label: 'SQL',
    property: 'hs_v2_date_entered_17915773',
    dbColumn: 'sql_entered_at',
  },
  DEMO_SCHEDULED: {
    id: 'baedc188-ba76-4a41-8723-5bb99fe7c5bf',
    label: 'Demo - Scheduled',
    property: 'hs_v2_date_entered_baedc188-ba76-4a41-8723-5bb99fe7c5bf',
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
    property: 'hs_v2_date_entered_97b2bcc6-fb34-4b56-8e6e-c349c88ef3d5',
    dbColumn: 'closed_won_entered_at',
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
