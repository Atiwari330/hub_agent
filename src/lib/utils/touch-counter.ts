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

/** PPL daily call compliance requires 2 phone calls per day */
export const PPL_CALLS_PER_DAY = 2;

export interface DailyCallBreakdown {
  date: string; // YYYY-MM-DD
  callCount: number;
  compliant: boolean; // callCount >= PPL_CALLS_PER_DAY
}

export interface CallComplianceResult {
  compliantDays: number;
  totalDays: number;
  compliance: number; // compliantDays / totalDays (0-1)
  dailyBreakdown: DailyCallBreakdown[];
  lateCreation: boolean; // deal created after 5pm EST, day 0 excluded
}

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
 * Count unique calendar days with at least one touch (call or outbound email)
 * within a date range. Used for daily touch compliance calculation.
 *
 * @param calls - Array of HubSpot calls
 * @param emails - Array of HubSpot emails
 * @param startDate - Start of the range (inclusive)
 * @param endDate - End of the range (inclusive)
 * @returns Number of unique days with at least one touch
 */
export function countUniqueTouchDays(
  calls: HubSpotCall[],
  emails: HubSpotEmail[],
  startDate: Date,
  endDate: Date
): number {
  const startMs = startDate.getTime();
  const endMs = endDate.getTime();
  const touchDays = new Set<string>();

  // Collect days from calls in range
  for (const call of calls) {
    if (!call.properties.hs_timestamp) continue;
    const timestamp = new Date(call.properties.hs_timestamp).getTime();
    if (timestamp >= startMs && timestamp <= endMs) {
      touchDays.add(new Date(call.properties.hs_timestamp).toISOString().split('T')[0]);
    }
  }

  // Collect days from outbound emails in range
  for (const email of emails) {
    if (!email.timestamp) continue;
    const isOutbound =
      email.direction === 'OUTGOING_EMAIL' ||
      (email.direction === 'EMAIL' && email.fromEmail?.endsWith('@opusbehavioral.com'));
    if (!isOutbound) continue;
    const timestamp = new Date(email.timestamp).getTime();
    if (timestamp >= startMs && timestamp <= endMs) {
      touchDays.add(new Date(email.timestamp).toISOString().split('T')[0]);
    }
  }

  return touchDays.size;
}

/**
 * Calculate Week 1 touch compliance for a deal
 *
 * Week 1 = first 7 calendar days after deal creation (day 0 through day 6)
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

  // Week 1 = 7 calendar days from creation (day 0 through day 6)
  const week1EndDate = new Date(createdDate);
  week1EndDate.setDate(week1EndDate.getDate() + 6);
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

/**
 * Check if a timestamp falls after 5pm EST (Eastern Time).
 * Handles both EST (UTC-5) and EDT (UTC-4) based on date.
 */
export function isAfter5pmEST(dateStr: string): boolean {
  const d = new Date(dateStr);
  // Use Intl to get the correct EST/EDT offset for this date
  const estStr = d.toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false });
  const hour = parseInt(estStr.split(', ')[1].split(':')[0]);
  return hour >= 17;
}

/**
 * Count compliant call days for PPL daily call compliance.
 *
 * Rules:
 * - 2 phone calls per day per PPL deal for first 7 days
 * - If deal created after 5pm EST, day 0 is excluded from compliance
 * - Only counts calls (not emails)
 *
 * @param calls - Array of HubSpot calls for the deal
 * @param startDate - Start of analysis range (deal creation date, midnight UTC)
 * @param endDate - End of analysis range (capped at days elapsed)
 * @param daysElapsed - Number of full days elapsed since creation (capped at 7)
 * @param createdAtRaw - Raw deal creation timestamp (for 5pm EST check)
 * @returns Call compliance result with daily breakdown
 */
export function countCompliantCallDays(
  calls: HubSpotCall[],
  startDate: Date,
  endDate: Date,
  daysElapsed: number,
  createdAtRaw: string
): CallComplianceResult {
  const lateCreation = isAfter5pmEST(createdAtRaw);

  // Build a map of calls per calendar day (YYYY-MM-DD)
  const callsByDay = new Map<string, number>();
  const startMs = startDate.getTime();
  const endMs = endDate.getTime();

  for (const call of calls) {
    if (!call.properties.hs_timestamp) continue;
    const ts = new Date(call.properties.hs_timestamp).getTime();
    if (ts >= startMs && ts <= endMs) {
      const dayKey = new Date(call.properties.hs_timestamp).toISOString().split('T')[0];
      callsByDay.set(dayKey, (callsByDay.get(dayKey) || 0) + 1);
    }
  }

  // Build daily breakdown for each day in the range
  const dailyBreakdown: DailyCallBreakdown[] = [];
  let compliantDays = 0;
  let totalDays = 0;

  const cursor = new Date(startDate);
  for (let day = 0; day < daysElapsed; day++) {
    const dayKey = cursor.toISOString().split('T')[0];

    // Skip day 0 if late creation (after 5pm EST)
    if (day === 0 && lateCreation) {
      cursor.setDate(cursor.getDate() + 1);
      continue;
    }

    totalDays++;
    const callCount = callsByDay.get(dayKey) || 0;
    const compliant = callCount >= PPL_CALLS_PER_DAY;
    if (compliant) compliantDays++;

    dailyBreakdown.push({ date: dayKey, callCount, compliant });
    cursor.setDate(cursor.getDate() + 1);
  }

  return {
    compliantDays,
    totalDays,
    compliance: totalDays > 0 ? compliantDays / totalDays : 0,
    dailyBreakdown,
    lateCreation,
  };
}
