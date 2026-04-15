/**
 * Quarter utility functions for fiscal period calculations.
 *
 * All date boundaries are computed in America/New_York (DST-aware) to match
 * the HubSpot display behavior for this account. A deal closed Mar 31 11:30pm ET
 * belongs in Q1 even though its UTC timestamp is Apr 1 03:30.
 */

const ZONE = 'America/New_York';

export interface QuarterInfo {
  year: number;
  quarter: number; // 1-4
  startDate: Date;
  endDate: Date;
  label: string; // e.g., "Q1 2025"
}

export interface QuarterProgress {
  daysElapsed: number;
  totalDays: number;
  percentComplete: number; // 0-100
}

/**
 * Offset in ms to add to UTC to get wall-clock time in `tz` at the given instant.
 * Returns a negative number for zones west of UTC (e.g., -4h during EDT).
 */
function tzOffsetMsAt(instant: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(instant);

  const map: Record<string, string> = {};
  for (const p of parts) if (p.type !== 'literal') map[p.type] = p.value;

  const asUtcMs = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour === '24' ? '0' : map.hour),
    Number(map.minute),
    Number(map.second),
  );
  return asUtcMs - instant.getTime();
}

/**
 * Return the UTC Date that corresponds to midnight (00:00:00) on the given
 * calendar date in the given timezone. Correct across DST transitions.
 */
export function midnightInZone(year: number, month: number, day: number, tz: string = ZONE): Date {
  const naiveUtc = Date.UTC(year, month, day);
  let instant = new Date(naiveUtc);
  const offset = tzOffsetMsAt(instant, tz);
  instant = new Date(naiveUtc - offset);
  // One more pass handles DST boundary edge cases.
  const offset2 = tzOffsetMsAt(instant, tz);
  if (offset2 !== offset) {
    instant = new Date(naiveUtc - offset2);
  }
  return instant;
}

/**
 * Return the calendar year/month/day/dow for `instant` viewed in `tz`.
 * dayOfWeek: 0 = Sunday, 6 = Saturday.
 */
export function partsInZone(
  instant: Date,
  tz: string = ZONE,
): { year: number; month: number; day: number; dayOfWeek: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  });
  const map: Record<string, string> = {};
  for (const p of fmt.formatToParts(instant)) if (p.type !== 'literal') map[p.type] = p.value;

  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(map.year),
    month: Number(map.month) - 1,
    day: Number(map.day),
    dayOfWeek: dowMap[map.weekday] ?? 0,
  };
}

export function getCurrentQuarter(): QuarterInfo {
  return getQuarterFromDate(new Date());
}

export function getQuarterFromDate(date: Date): QuarterInfo {
  const { year, month } = partsInZone(date);
  const quarter = Math.floor(month / 3) + 1;
  return getQuarterInfo(year, quarter);
}

/**
 * Progress through a quarter in whole elapsed days (1-based on the quarter
 * start day). `daysElapsed` counts the current day, so on Q2 day 1 the
 * function returns 1, not 0.
 */
export function getQuarterProgress(quarterInfo?: QuarterInfo): QuarterProgress {
  const quarter = quarterInfo || getCurrentQuarter();
  const now = new Date();

  // Total calendar days in the quarter (e.g., Q2 2026 = 91).
  const totalMs = quarter.endDate.getTime() - quarter.startDate.getTime();
  const totalDays = Math.round(totalMs / 86400000);

  // Clamp to quarter bounds.
  const effective = Math.max(
    quarter.startDate.getTime(),
    Math.min(now.getTime(), quarter.endDate.getTime()),
  );
  const elapsedMs = effective - quarter.startDate.getTime();
  // `daysElapsed` is 1-based: first day of the quarter returns 1.
  const daysElapsed = Math.max(1, Math.min(totalDays, Math.floor(elapsedMs / 86400000) + 1));

  const percentComplete = Math.min(100, Math.max(0, (daysElapsed / totalDays) * 100));

  return { daysElapsed, totalDays, percentComplete };
}

export function formatQuarterLabel(year: number, quarter: number): string {
  return `Q${quarter} ${year}`;
}

export function parseQuarterLabel(label: string): { year: number; quarter: number } | null {
  const match = label.match(/^Q([1-4])\s+(\d{4})$/);
  if (!match) return null;
  return {
    quarter: parseInt(match[1], 10),
    year: parseInt(match[2], 10),
  };
}

export function isDateInQuarter(date: Date, quarterInfo: QuarterInfo): boolean {
  const t = date.getTime();
  return t >= quarterInfo.startDate.getTime() && t <= quarterInfo.endDate.getTime();
}

/**
 * Quarter boundaries anchored to midnight America/New_York, DST-aware.
 * - startDate = 00:00:00 ET on the first day of the quarter
 * - endDate   = 23:59:59.999 ET on the last day of the quarter
 */
export function getQuarterInfo(year: number, quarter: number): QuarterInfo {
  if (quarter < 1 || quarter > 4) {
    throw new Error('Quarter must be between 1 and 4');
  }

  const startMonth = (quarter - 1) * 3;
  const startDate = midnightInZone(year, startMonth, 1);
  // Midnight of the first day of the *next* quarter, minus 1 ms.
  const nextQuarterStart = midnightInZone(year, startMonth + 3, 1);
  const endDate = new Date(nextQuarterStart.getTime() - 1);

  return {
    year,
    quarter,
    startDate,
    endDate,
    label: `Q${quarter} ${year}`,
  };
}
