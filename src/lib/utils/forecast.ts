/**
 * Forecast calculation utilities for AE quota tracking
 *
 * Generates weekly cumulative targets based on a weighted distribution
 * that accounts for typical B2B SaaS sales cycles (~6 weeks).
 *
 * Distribution rationale:
 * - Weeks 1-4: Pipeline building phase, fewer closes expected
 * - Weeks 5-9: Active closing phase, most closes happen here
 * - Weeks 10-13: Quarter push, steady close rate
 */

// Weekly weights for a 13-week quarter (sum = 1.0)
// These represent the percentage of total quota expected to close each week
const WEEKLY_WEIGHTS = [
  0.03, // W1 - pipeline building
  0.04, // W2
  0.05, // W3
  0.06, // W4 - 18% cumulative by end of W4
  0.08, // W5 - closing phase begins
  0.09, // W6
  0.10, // W7
  0.10, // W8
  0.10, // W9 - 65% cumulative by end of W9
  0.09, // W10 - quarter push
  0.09, // W11
  0.09, // W12
  0.08, // W13 - 100% by end
];

export interface WeeklyForecast {
  weekNumber: number;
  weeklyTarget: number;      // Amount expected to close this specific week
  cumulativeTarget: number;  // Cumulative amount by end of this week
  percentOfQuota: number;    // Cumulative % of quota by end of this week
}

/**
 * Calculate weekly forecast targets from a quarterly quota
 */
export function calculateWeeklyForecast(quota: number): WeeklyForecast[] {
  const weeks: WeeklyForecast[] = [];
  let cumulative = 0;

  for (let i = 0; i < 13; i++) {
    const weeklyTarget = quota * WEEKLY_WEIGHTS[i];
    cumulative += weeklyTarget;

    weeks.push({
      weekNumber: i + 1,
      weeklyTarget: Math.round(weeklyTarget),
      cumulativeTarget: Math.round(cumulative),
      percentOfQuota: Math.round((cumulative / quota) * 100),
    });
  }

  return weeks;
}

/**
 * Get the forecast target for a specific week
 */
export function getForecastForWeek(quota: number, weekNumber: number): number {
  if (weekNumber < 1 || weekNumber > 13) return 0;

  const forecast = calculateWeeklyForecast(quota);
  return forecast[weekNumber - 1].cumulativeTarget;
}

/**
 * Determine if an AE is on track based on actual vs forecast
 * Returns true if actual is >= 80% of forecast
 */
export function isOnTrack(actual: number, forecast: number): boolean {
  if (forecast === 0) return true;
  return actual >= forecast * 0.8;
}

/**
 * Calculate variance and status
 */
export function calculateVariance(actual: number, forecast: number): {
  variance: number;
  percentOfForecast: number;
  status: 'ahead' | 'on_track' | 'behind' | 'at_risk';
} {
  const variance = actual - forecast;
  const percentOfForecast = forecast > 0 ? (actual / forecast) * 100 : 100;

  let status: 'ahead' | 'on_track' | 'behind' | 'at_risk';
  if (percentOfForecast >= 100) {
    status = 'ahead';
  } else if (percentOfForecast >= 80) {
    status = 'on_track';
  } else if (percentOfForecast >= 60) {
    status = 'behind';
  } else {
    status = 'at_risk';
  }

  return { variance, percentOfForecast, status };
}

/**
 * Get the current week number in a quarter (1-13)
 */
export function getCurrentWeekInQuarter(quarterStart: Date): number {
  const now = new Date();
  const diffMs = now.getTime() - quarterStart.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const weekNumber = Math.floor(diffDays / 7) + 1;
  return Math.min(Math.max(weekNumber, 1), 13);
}

/**
 * Get quarter start date
 */
export function getQuarterStartDate(year: number, quarter: number): Date {
  const month = (quarter - 1) * 3;
  return new Date(year, month, 1);
}

/**
 * Get all week boundaries for a quarter
 */
export function getQuarterWeeks(year: number, quarter: number): Array<{
  weekNumber: number;
  weekStart: Date;
  weekEnd: Date;
}> {
  const quarterStart = getQuarterStartDate(year, quarter);
  const weeks = [];

  for (let i = 0; i < 13; i++) {
    const weekStart = new Date(quarterStart);
    weekStart.setDate(quarterStart.getDate() + i * 7);

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);

    weeks.push({
      weekNumber: i + 1,
      weekStart,
      weekEnd,
    });
  }

  return weeks;
}
