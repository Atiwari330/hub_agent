/**
 * Touch counter utility for PPL Sequence compliance tracking
 *
 * Counts "touches" (calls + outbound emails) within a date range.
 * Used to measure Week 1 compliance for Paid Per Lead deals.
 *
 * Touch definition:
 * - All calls count (including attempted calls, voicemails, no-answers)
 * - Only OUTBOUND emails count (emails sent BY the AE to the prospect)
 * - Inbound emails (replies from prospect) are NOT counted
 */

import type { HubSpotCall, HubSpotEmail, HubSpotMeeting } from '@/lib/hubspot/engagements';
import { addBusinessDays } from './business-days';

export interface TouchCounts {
  calls: number;
  emails: number;
  total: number;
  lastTouchDate: string | null;
}

export interface Week1TouchAnalysis {
  touches: TouchCounts;
  target: number;
  gap: number;
  status: 'on_track' | 'behind' | 'critical';
  week1EndDate: string;
  isInWeek1: boolean;
  meetingBooked: boolean;
  meetingBookedDate: string | null;
}

/**
 * Count touches (calls + outbound emails) within a date range
 *
 * @param calls - Array of HubSpot calls
 * @param emails - Array of HubSpot emails
 * @param startDate - Start of the range (inclusive)
 * @param endDate - End of the range (inclusive)
 * @returns Touch counts with breakdown
 */
export function countTouchesInRange(
  calls: HubSpotCall[],
  emails: HubSpotEmail[],
  startDate: Date,
  endDate: Date
): TouchCounts {
  const startMs = startDate.getTime();
  const endMs = endDate.getTime();

  // Count calls in range
  const callsInRange = calls.filter((call) => {
    if (!call.properties.hs_timestamp) return false;
    const timestamp = new Date(call.properties.hs_timestamp).getTime();
    return timestamp >= startMs && timestamp <= endMs;
  });

  // Count outbound emails in range
  const emailsInRange = emails.filter((email) => {
    if (!email.timestamp) return false;
    // Only count OUTBOUND emails (sent by AE to prospect)
    // Some HubSpot emails have direction 'EMAIL' instead of 'OUTGOING_EMAIL',
    // so we also check if the sender is from our company domain
    const isOutbound =
      email.direction === 'OUTGOING_EMAIL' ||
      (email.direction === 'EMAIL' && email.fromEmail?.endsWith('@opusbehavioral.com'));
    if (!isOutbound) return false;
    const timestamp = new Date(email.timestamp).getTime();
    return timestamp >= startMs && timestamp <= endMs;
  });

  // Find the most recent touch date
  let lastTouchDate: string | null = null;
  const allTouchDates: Date[] = [];

  for (const call of callsInRange) {
    if (call.properties.hs_timestamp) {
      allTouchDates.push(new Date(call.properties.hs_timestamp));
    }
  }
  for (const email of emailsInRange) {
    if (email.timestamp) {
      allTouchDates.push(new Date(email.timestamp));
    }
  }

  if (allTouchDates.length > 0) {
    const mostRecent = allTouchDates.reduce((a, b) => (a > b ? a : b));
    lastTouchDate = mostRecent.toISOString();
  }

  return {
    calls: callsInRange.length,
    emails: emailsInRange.length,
    total: callsInRange.length + emailsInRange.length,
    lastTouchDate,
  };
}

/**
 * Calculate Week 1 touch compliance for a deal
 *
 * Week 1 = first 5 business days after deal creation
 * Target = 6 touches (configurable)
 *
 * @param calls - Array of HubSpot calls for the deal
 * @param emails - Array of HubSpot emails for the deal
 * @param dealCreatedAt - When the deal was created in HubSpot
 * @param target - Target number of touches (default: 6)
 * @returns Week 1 touch analysis with status
 */
export function analyzeWeek1Touches(
  calls: HubSpotCall[],
  emails: HubSpotEmail[],
  dealCreatedAt: string,
  target: number = 6,
  meetings?: HubSpotMeeting[]
): Week1TouchAnalysis {
  const createdDate = new Date(dealCreatedAt);
  createdDate.setHours(0, 0, 0, 0);

  // Week 1 = 5 business days from creation
  const week1EndDate = addBusinessDays(createdDate, 5);
  week1EndDate.setHours(23, 59, 59, 999);

  const now = new Date();
  const isInWeek1 = now <= week1EndDate;

  // Count touches within Week 1
  const touches = countTouchesInRange(calls, emails, createdDate, week1EndDate);

  // Calculate gap and status
  const gap = target - touches.total;

  let status: 'on_track' | 'behind' | 'critical';
  if (touches.total >= target) {
    status = 'on_track';
  } else if (isInWeek1) {
    // Still in Week 1 - check if they're on pace
    // Give some grace: if gap <= 3, they're "behind" but recoverable
    status = gap <= 3 ? 'behind' : 'critical';
  } else {
    // Week 1 is over - check final compliance
    if (gap <= 2) {
      status = 'behind';
    } else {
      status = 'critical';
    }
  }

  // Check if a meeting was booked during Week 1
  let meetingBooked = false;
  let meetingBookedDate: string | null = null;

  if (meetings && meetings.length > 0) {
    const startMs = createdDate.getTime();
    const endMs = week1EndDate.getTime();

    // Find meetings booked (hs_createdate) within Week 1
    const week1Meetings = meetings.filter((m) => {
      if (!m.properties.hs_createdate) return false;
      const bookedMs = new Date(m.properties.hs_createdate).getTime();
      return bookedMs >= startMs && bookedMs <= endMs;
    });

    if (week1Meetings.length > 0) {
      meetingBooked = true;
      // Find the earliest meeting booked in Week 1
      const earliest = week1Meetings.reduce((a, b) => {
        const timeA = new Date(a.properties.hs_createdate!).getTime();
        const timeB = new Date(b.properties.hs_createdate!).getTime();
        return timeA <= timeB ? a : b;
      });
      meetingBookedDate = earliest.properties.hs_createdate;

      // Meeting booked = auto-compliance (mission accomplished)
      status = 'on_track';
    }
  }

  return {
    touches,
    target,
    gap: meetingBooked ? 0 : Math.max(0, gap),
    status,
    week1EndDate: week1EndDate.toISOString(),
    isInWeek1,
    meetingBooked,
    meetingBookedDate,
  };
}
