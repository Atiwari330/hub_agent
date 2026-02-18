import type { Week1TouchAnalysis } from '@/lib/utils/touch-counter';
import { ALL_OPEN_STAGE_IDS } from '@/lib/hubspot/stage-config';

// Re-export for backwards compatibility with consumers that import from this file
export const ACTIVE_DEAL_STAGES = ALL_OPEN_STAGE_IDS;

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
