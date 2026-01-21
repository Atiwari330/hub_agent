/**
 * Centralized configuration for HubSpot sync job
 *
 * This controls what data gets synced from HubSpot to Supabase.
 * Only deals matching these criteria will be cached locally.
 */

export const SYNC_CONFIG = {
  // Target AE emails - only sync owners matching these emails
  TARGET_AE_EMAILS: [
    'aboyd@opusbehavioral.com',
    'cgarraffa@opusbehavioral.com',
    'jrice@opusbehavioral.com',
    'atiwari@opusbehavioral.com',
  ],

  // Only sync deals from Sales Pipeline
  TARGET_PIPELINE_ID: '1c27e5a3-5e5e-4403-ab0f-d356bf268cf3',

  // Only sync deals created or closing on/after this date
  MIN_DATE: '2025-01-01',

  // Batch size for database upsert operations
  DB_BATCH_SIZE: 500,

  // Task assignment overrides: tasks for deals owned by key email are assigned to value email
  // Adi Tiwari's deal tasks get assigned to Gabriel Lacap
  TASK_ASSIGNMENT_OVERRIDES: {
    'atiwari@opusbehavioral.com': 'glacap@opusbehavioral.com',
  } as Record<string, string>,
} as const;

export type SyncConfig = typeof SYNC_CONFIG;
