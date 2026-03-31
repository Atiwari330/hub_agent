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
  topDeals: PipelineDeal[];
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
  historicalRates: HistoricalRates;
  leadSourceRates: LeadSourceRate[];
  aeData: AEData[];
  weeklyActuals: WeeklyActual[];
  pipelineCredit: PipelineCredit;
  teamTarget: number;
}
