/**
 * Quarter utility functions for fiscal period calculations
 *
 * IMPORTANT: All date boundaries are calculated in EST (Eastern Standard Time)
 * to match HubSpot's date display behavior. HubSpot stores dates in UTC but
 * displays them to users in their local timezone (EST for this account).
 *
 * This ensures deals closing on "March 31 EST" are included in Q1, even if
 * the UTC timestamp shows "April 1".
 */

// EST offset from UTC (5 hours). Note: We use fixed EST, not EDT, for consistency.
const EST_OFFSET_HOURS = 5;

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
 * Get the current fiscal quarter info
 */
export function getCurrentQuarter(): QuarterInfo {
  const now = new Date();
  return getQuarterFromDate(now);
}

/**
 * Get quarter info for a specific date
 *
 * Interprets the date in EST context to determine which quarter it belongs to.
 * This ensures consistency with HubSpot's date display behavior.
 */
export function getQuarterFromDate(date: Date): QuarterInfo {
  // Convert the UTC date to EST by subtracting the offset
  // This gives us the "EST view" of when this date occurs
  const estDate = new Date(date.getTime() - EST_OFFSET_HOURS * 60 * 60 * 1000);

  const year = estDate.getUTCFullYear();
  const month = estDate.getUTCMonth(); // 0-11
  const quarter = Math.floor(month / 3) + 1;

  // Use getQuarterInfo to get consistent EST-aware boundaries
  return getQuarterInfo(year, quarter);
}

/**
 * Get progress through the current quarter
 */
export function getQuarterProgress(quarterInfo?: QuarterInfo): QuarterProgress {
  const quarter = quarterInfo || getCurrentQuarter();
  const now = new Date();

  // Clamp to quarter bounds
  const effectiveDate = new Date(
    Math.max(quarter.startDate.getTime(), Math.min(now.getTime(), quarter.endDate.getTime()))
  );

  const totalMs = quarter.endDate.getTime() - quarter.startDate.getTime();
  const elapsedMs = effectiveDate.getTime() - quarter.startDate.getTime();

  const totalDays = Math.ceil(totalMs / (1000 * 60 * 60 * 24)) + 1; // +1 to include end date
  const daysElapsed = Math.ceil(elapsedMs / (1000 * 60 * 60 * 24)) + 1; // +1 to include start date

  const percentComplete = Math.min(100, Math.max(0, (daysElapsed / totalDays) * 100));

  return {
    daysElapsed,
    totalDays,
    percentComplete,
  };
}

/**
 * Format a quarter label string
 */
export function formatQuarterLabel(year: number, quarter: number): string {
  return `Q${quarter} ${year}`;
}

/**
 * Parse a quarter label string (e.g., "Q1 2025") into year and quarter
 */
export function parseQuarterLabel(label: string): { year: number; quarter: number } | null {
  const match = label.match(/^Q([1-4])\s+(\d{4})$/);
  if (!match) return null;

  return {
    quarter: parseInt(match[1], 10),
    year: parseInt(match[2], 10),
  };
}

/**
 * Check if a date falls within a specific quarter
 */
export function isDateInQuarter(date: Date, quarterInfo: QuarterInfo): boolean {
  const timestamp = date.getTime();
  return timestamp >= quarterInfo.startDate.getTime() && timestamp <= quarterInfo.endDate.getTime();
}

/**
 * Get quarter info for a specific fiscal year and quarter
 *
 * Date boundaries are EST-aware to match HubSpot's display behavior:
 * - Q1 starts Jan 1 00:00:00 EST = Jan 1 05:00:00 UTC
 * - Q1 ends Mar 31 23:59:59 EST = Apr 1 04:59:59 UTC
 */
export function getQuarterInfo(year: number, quarter: number): QuarterInfo {
  if (quarter < 1 || quarter > 4) {
    throw new Error('Quarter must be between 1 and 4');
  }

  const startMonth = (quarter - 1) * 3;

  // Create dates that represent EST boundaries in UTC
  // Start: First day of quarter at 00:00:00 EST = 05:00:00 UTC
  const startDate = new Date(Date.UTC(year, startMonth, 1, EST_OFFSET_HOURS, 0, 0, 0));

  // End: Last day of quarter at 23:59:59.999 EST = next day 04:59:59.999 UTC
  // startMonth + 3 gives us the first month of next quarter, day 1 at 05:00 UTC
  // Subtract 1ms to get the last moment of the previous quarter in EST
  const endDate = new Date(Date.UTC(year, startMonth + 3, 1, EST_OFFSET_HOURS, 0, 0, 0) - 1);

  return {
    year,
    quarter,
    startDate,
    endDate,
    label: `Q${quarter} ${year}`,
  };
}
