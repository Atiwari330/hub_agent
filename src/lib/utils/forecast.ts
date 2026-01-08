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

// ============================================================================
// STAGE-LEVEL FORECASTS
// ============================================================================

/**
 * Conversion rates for pipeline stages
 * Based on typical B2B SaaS funnel metrics
 */
export const CONVERSION_RATES = {
  SQL_TO_DEMO: 0.33,        // 33% of SQLs become demos
  DEMO_TO_PROPOSAL: 0.60,   // 60% of demos get proposals
  PROPOSAL_TO_CLOSE: 0.50,  // 50% of proposals close
  // Combined: SQL to Close = 0.33 * 0.60 * 0.50 = ~10%
};

/**
 * Default average deal size if not provided
 * Based on HubSpot data analysis: median ARR of 138 cleaned deals = ~$15K
 */
export const DEFAULT_AVG_DEAL_SIZE = 15000;

/**
 * Stage-level weekly weights
 * SQLs are front-loaded (need them early to close deals later)
 * Demos follow SQLs with ~2 week lag
 * Proposals follow demos with ~2 week lag
 */
const STAGE_WEEKLY_WEIGHTS = {
  // SQLs: Heavy early weeks to fill pipeline
  sql: [
    0.09, // W1
    0.09, // W2
    0.09, // W3
    0.09, // W4
    0.08, // W5
    0.08, // W6
    0.08, // W7
    0.07, // W8
    0.07, // W9
    0.06, // W10
    0.05, // W11
    0.04, // W12
    0.03, // W13
  ],
  // Demos: Lag SQLs by ~2 weeks
  demo: [
    0.05, // W1
    0.06, // W2
    0.07, // W3
    0.08, // W4
    0.09, // W5
    0.09, // W6
    0.09, // W7
    0.09, // W8
    0.09, // W9
    0.08, // W10
    0.07, // W11
    0.06, // W12
    0.05, // W13 (some demos still convert to proposals for next quarter)
  ],
  // Proposals: Lag demos by ~2 weeks
  proposal: [
    0.04, // W1
    0.05, // W2
    0.06, // W3
    0.07, // W4
    0.08, // W5
    0.09, // W6
    0.09, // W7
    0.10, // W8
    0.10, // W9
    0.09, // W10
    0.08, // W11
    0.07, // W12
    0.06, // W13 (some will close next quarter)
  ],
};

export type ForecastStage = 'arr' | 'sql' | 'demo' | 'proposal';

export interface StageWeeklyForecast {
  weekNumber: number;
  weeklyTarget: number;
  cumulativeTarget: number;
}

/**
 * Calculate total stage targets needed to hit quota
 */
export function calculateStageTargets(
  quota: number,
  avgDealSize: number = DEFAULT_AVG_DEAL_SIZE
): {
  dealsNeeded: number;
  proposalsNeeded: number;
  demosNeeded: number;
  sqlsNeeded: number;
} {
  const dealsNeeded = Math.ceil(quota / avgDealSize);
  const proposalsNeeded = Math.ceil(dealsNeeded / CONVERSION_RATES.PROPOSAL_TO_CLOSE);
  const demosNeeded = Math.ceil(proposalsNeeded / CONVERSION_RATES.DEMO_TO_PROPOSAL);
  const sqlsNeeded = Math.ceil(demosNeeded / CONVERSION_RATES.SQL_TO_DEMO);

  return {
    dealsNeeded,
    proposalsNeeded,
    demosNeeded,
    sqlsNeeded,
  };
}

/**
 * Calculate weekly stage-level forecast
 */
export function calculateStageForecast(
  stage: 'sql' | 'demo' | 'proposal',
  totalNeeded: number
): StageWeeklyForecast[] {
  const weights = STAGE_WEEKLY_WEIGHTS[stage];
  const weeks: StageWeeklyForecast[] = [];
  let cumulative = 0;

  for (let i = 0; i < 13; i++) {
    const weeklyTarget = Math.round(totalNeeded * weights[i]);
    cumulative += weeklyTarget;

    weeks.push({
      weekNumber: i + 1,
      weeklyTarget,
      cumulativeTarget: cumulative,
    });
  }

  // Adjust last week to ensure we hit exact total
  const diff = totalNeeded - cumulative;
  if (diff !== 0 && weeks.length > 0) {
    weeks[12].cumulativeTarget = totalNeeded;
  }

  return weeks;
}

/**
 * Calculate all stage forecasts for a given quota
 */
export function calculateAllStageForecuts(
  quota: number,
  avgDealSize: number = DEFAULT_AVG_DEAL_SIZE
): {
  targets: {
    dealsNeeded: number;
    proposalsNeeded: number;
    demosNeeded: number;
    sqlsNeeded: number;
  };
  forecasts: {
    sql: StageWeeklyForecast[];
    demo: StageWeeklyForecast[];
    proposal: StageWeeklyForecast[];
  };
} {
  const targets = calculateStageTargets(quota, avgDealSize);

  return {
    targets,
    forecasts: {
      sql: calculateStageForecast('sql', targets.sqlsNeeded),
      demo: calculateStageForecast('demo', targets.demosNeeded),
      proposal: calculateStageForecast('proposal', targets.proposalsNeeded),
    },
  };
}
