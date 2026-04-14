/**
 * Sunday–Saturday calendar-week helper for quarter dashboards.
 *
 * Unlike the legacy "7-day slots from quarter start" approach, weeks here are
 * calendar weeks (Sun → Sat, America/New_York). The first and last weeks of
 * the quarter are clamped to the quarter's boundaries and marked `isPartial`
 * if they don't start on a Sunday and end on a Saturday respectively.
 */

import { getQuarterProgress, midnightInZone, partsInZone, type QuarterInfo } from './quarter';

const ZONE = 'America/New_York';

export interface QuarterWeek {
  weekNumber: number;       // 1-based
  weekStart: Date;          // 00:00 ET of the Sunday (or quarter start)
  weekEnd: Date;            // 23:59:59.999 ET of the Saturday (or quarter end)
  weekStartDate: string;    // YYYY-MM-DD (ET)
  weekEndDate: string;      // YYYY-MM-DD (ET)
  isPartial: boolean;       // true when the week is clipped by a quarter boundary
  isCurrent: boolean;       // current ET instant falls inside [start, end]
}

function ymdInZone(d: Date): string {
  const p = partsInZone(d, ZONE);
  const mm = String(p.month + 1).padStart(2, '0');
  const dd = String(p.day).padStart(2, '0');
  return `${p.year}-${mm}-${dd}`;
}

/**
 * Build Sun–Sat weeks for a quarter. Example: Q2 2026 (Apr 1 Wed – Jun 30 Tue)
 *   W1  Wed Apr 1 – Sat Apr 4   (partial, 4 days)
 *   W2  Sun Apr 5 – Sat Apr 11
 *   …
 *   W13 Sun Jun 21 – Sat Jun 27
 *   W14 Sun Jun 28 – Tue Jun 30 (partial, 3 days)
 */
export function getQuarterWeeksSunSat(q: QuarterInfo, now: Date = new Date()): QuarterWeek[] {
  const weeks: QuarterWeek[] = [];
  const nowMs = now.getTime();

  let weekNumber = 1;
  let cursor = q.startDate;

  while (cursor.getTime() <= q.endDate.getTime()) {
    const cursorParts = partsInZone(cursor, ZONE);
    // Days until next Saturday (6 = Saturday). If cursor is already Sat, 0 days.
    const daysToSat = (6 - cursorParts.dayOfWeek + 7) % 7;
    // Next Saturday at 00:00 ET, then move to 23:59:59.999 ET.
    const satStart = midnightInZone(
      cursorParts.year,
      cursorParts.month,
      cursorParts.day + daysToSat,
      ZONE,
    );
    const endOfSaturdayMs = satStart.getTime() + 86400000 - 1;
    const weekEndMs = Math.min(endOfSaturdayMs, q.endDate.getTime());
    const weekEnd = new Date(weekEndMs);

    // A week is partial if it doesn't cover a full Sun 00:00 → Sat 23:59:59.
    const startParts = partsInZone(cursor, ZONE);
    const isStartPartial = startParts.dayOfWeek !== 0;
    const isEndPartial = weekEndMs < endOfSaturdayMs;
    const isPartial = isStartPartial || isEndPartial;

    const isCurrent = nowMs >= cursor.getTime() && nowMs <= weekEndMs;

    weeks.push({
      weekNumber,
      weekStart: cursor,
      weekEnd,
      weekStartDate: ymdInZone(cursor),
      weekEndDate: ymdInZone(weekEnd),
      isPartial,
      isCurrent,
    });

    // Advance cursor to Sunday 00:00 ET of next week.
    const nextSundayParts = partsInZone(new Date(weekEndMs + 1), ZONE);
    cursor = midnightInZone(nextSundayParts.year, nextSundayParts.month, nextSundayParts.day, ZONE);
    weekNumber += 1;

    // Guard against pathological infinite loops.
    if (weekNumber > 20) break;
  }

  return weeks;
}

/**
 * Index of the current week in the returned array, or -1 if `now` is outside
 * the quarter. Useful for pacing calculations that need "which week is it?"
 */
export function getCurrentWeekIndex(weeks: QuarterWeek[]): number {
  return weeks.findIndex((w) => w.isCurrent);
}

/**
 * Fractional weeks elapsed through the quarter — use for pace-based "expected
 * by now" math so partial first/last weeks don't break the burn.
 * Example: 14 calendar days into a 91-day quarter → 14/91 × weeks.length.
 */
export function fractionalWeeksElapsed(q: QuarterInfo, weeks: QuarterWeek[]): number {
  const progress = getQuarterProgress(q);
  return (progress.daysElapsed / progress.totalDays) * weeks.length;
}
