/**
 * Shared types for Q2 Goal Tracker dashboard.
 */

export interface HistoricalRates {
  avgDealSize: number;
  demoToWonRate: number;       // 0-1
  createToDemoRate: number;    // 0-1
  medianCycleTime: number;     // days, create → close
  medianDemoToClose: number;   // days, demo → close
  medianCreateToDemo: number;  // days, create → demo
}

export interface LeadSourceRate {
  source: string;
  createToDemoRate: number; // 0-1
  dealsCreated: number;     // historical count
  demosCompleted: number;   // historical count
}

export interface AEData {
  name: string;
  email: string;
  ownerId: string | null;
  q2Target: number;
  bestQuarterARR: number;
  bestQuarterLabel: string;
  allTimeWonARR: number;
  allTimeWonCount: number;
  personalDemoToWon: number;     // 0-1
  personalCreateToDemo: number;  // 0-1
}

export interface PipelineDeal {
  dealName: string;
  ownerName: string;
  stage: string;
  amount: number;
  daysInPipeline: number;
}

export interface WeeklyActual {
  weekNumber: number;
  weekStart: string; // YYYY-MM-DD
  weekEnd: string;
  closedWonARR: number;
  closedWonCount: number;
}

export interface PipelineCredit {
  postDemoRawARR: number;
  postDemoCount: number;
  preDemoRawARR: number;
  preDemoCount: number;
  teamForecastARR: number;       // Sum of deals team confirmed "likely to close in Q2"
  teamForecastCount: number;
  teamForecastByAE: { name: string; arr: number; count: number }[];
  topDeals: PipelineDeal[];
}

export interface RateSet {
  label: string;           // e.g., "Q1 2026" or "Q1-Q4 2025"
  description: string;     // e.g., "13 closed-won deals, $241K ARR"
  rates: HistoricalRates;
  sampleSize: number;      // number of closed-won deals
  totalARR: number;
}

export interface Q2GoalTrackerApiResponse {
  quarter: {
    year: number;
    quarter: number;
    label: string;
    startDate: string;
    endDate: string;
  };
  progress: {
    daysElapsed: number;
    totalDays: number;
    percentComplete: number;
    currentWeek: number;
    totalWeeks: number;
  };
  rateSets: RateSet[];     // multiple cohort options, first is default
  historicalRates: HistoricalRates; // kept for backward compat (= first rateSet)
  leadSourceRates: LeadSourceRate[];
  aeData: AEData[];
  weeklyActuals: WeeklyActual[];
  pipelineCredit: PipelineCredit;
  teamTarget: number;
}
