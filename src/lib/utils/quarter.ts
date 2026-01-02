/**
 * Quarter utility functions for fiscal period calculations
 */

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
 */
export function getQuarterFromDate(date: Date): QuarterInfo {
  const year = date.getFullYear();
  const month = date.getMonth(); // 0-11
  const quarter = Math.floor(month / 3) + 1;

  const startMonth = (quarter - 1) * 3;
  const startDate = new Date(year, startMonth, 1);

  // End date is last day of the quarter
  const endDate = new Date(year, startMonth + 3, 0);

  return {
    year,
    quarter,
    startDate,
    endDate,
    label: `Q${quarter} ${year}`,
  };
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
 */
export function getQuarterInfo(year: number, quarter: number): QuarterInfo {
  if (quarter < 1 || quarter > 4) {
    throw new Error('Quarter must be between 1 and 4');
  }

  const startMonth = (quarter - 1) * 3;
  const startDate = new Date(year, startMonth, 1);
  const endDate = new Date(year, startMonth + 3, 0);

  return {
    year,
    quarter,
    startDate,
    endDate,
    label: `Q${quarter} ${year}`,
  };
}
