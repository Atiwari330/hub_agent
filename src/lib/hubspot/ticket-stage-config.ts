// Support Pipeline configuration — stage IDs as source of truth for open/closed

export const SUPPORT_PIPELINE_ID = '0';

export const OPEN_TICKET_STAGE_IDS = new Set([
  '1',           // New
  '2',           // Waiting on contact
  '3',           // Waiting on reply
  '157435739',   // Escalated Internal
  '1114430626',  // Escalated to Vendor Support
  '166957201',   // Custom Work Request
  '1287545348',  // AI Processing
  '1287545349',  // Human Handoff
  '1287666465',  // Human Handling
]);

export function isOpenTicketStage(stageId: string | null): boolean {
  return OPEN_TICKET_STAGE_IDS.has(stageId || '');
}
