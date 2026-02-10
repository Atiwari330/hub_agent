import type { Week1TouchAnalysis } from '@/lib/utils/touch-counter';

// Active stages (excludes Closed Won, Closed Lost)
export const ACTIVE_DEAL_STAGES = [
  '2030251',                                   // MQL
  '17915773',                                  // SQL (legacy)
  '138092708',                                 // SQL/Discovery
  'baedc188-ba76-4a41-8723-5bb99fe7c5bf',     // Demo - Scheduled
  '963167283',                                 // Demo - Completed
  '59865091',                                  // Proposal
];

export interface PplSequenceDeal {
  id: string;
  hubspotDealId: string;
  dealName: string;
  amount: number | null;
  stageName: string;
  stageId: string;
  ownerName: string;
  ownerId: string;
  closeDate: string | null;
  hubspotCreatedAt: string | null;
  // PPL sequence specific
  dealAgeDays: number;
  week1Analysis: Week1TouchAnalysis | null;
  totalTouches: number | null;
  // Meeting compliance
  meetingBooked: boolean;
  meetingBookedDate: string | null;
  // Flags
  needsActivityCheck: boolean;
}

export interface QueueResponse {
  deals: PplSequenceDeal[];
  counts: {
    on_track: number;
    behind: number;
    critical: number;
    pending: number;
    meeting_booked: number;
  };
  avgTouchesExcludingMeetings: number | null;
}
