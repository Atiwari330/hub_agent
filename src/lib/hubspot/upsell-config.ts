/**
 * Configuration for Upsell Pipeline
 *
 * This file contains stage mappings and IDs specific to the Upsells pipeline.
 */

export const UPSELL_PIPELINE_ID = '130845758';

// Active stages in the Upsell Pipeline (excludes Closed Won, Closed Lost)
export const UPSELL_ACTIVE_STAGES = [
  '226988101',   // Interested
  '226988102',   // Demo - Scheduled
  '1054253346',  // Demo - Completed
  '226986248',   // Proposal
];

// All stages in the Upsell Pipeline with labels
export const UPSELL_PIPELINE_STAGES = {
  INTERESTED: { id: '226988101', label: 'Interested' },
  DEMO_SCHEDULED: { id: '226988102', label: 'Demo - Scheduled' },
  DEMO_COMPLETED: { id: '1054253346', label: 'Demo - Completed' },
  PROPOSAL: { id: '226986248', label: 'Proposal' },
  CLOSED_WON: { id: '226986249', label: 'Closed Won' },
  CLOSED_LOST: { id: '226986250', label: 'Closed Lost' },
} as const;
