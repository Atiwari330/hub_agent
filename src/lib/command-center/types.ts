/**
 * Shared types for Q2 Command Center.
 * Imports from q2-goal-tracker/types.ts where shapes overlap.
 */

import type {
  HistoricalRates,
  RateSet,
  LeadSourceRate,
  AEData,
  WeeklyActual,
  PipelineCredit,
  Q2GoalTrackerApiResponse,
} from '@/lib/q2-goal-tracker/types';
import type { SourceDemoRow } from './compute-source-demos';

// Re-export for convenience
export type {
  HistoricalRates,
  RateSet,
  LeadSourceRate,
  AEData,
  WeeklyActual,
  PipelineCredit,
  Q2GoalTrackerApiResponse,
  SourceDemoRow,
};

// -- Pacing --

export interface WeeklyDealRef {
  hubspotDealId: string;
  dealName: string;
  amount: number;
  ownerName: string;
}

export interface WeeklyPacingRow {
  weekNumber: number;        // 1-13
  weekStart: string;         // YYYY-MM-DD
  weekEnd: string;
  leadsCreated: number;      // deals created this week
  demosScheduled: number;    // deals that entered demo scheduled this week
  dealsToDemo: number;       // deals that completed demo this week
  closedWonARR: number;
  closedWonCount: number;
  // Deal-level refs for drill-down
  leadsCreatedDeals: WeeklyDealRef[];
  demosScheduledDeals: WeeklyDealRef[];
  demoCompletedDeals: WeeklyDealRef[];
  closedWonDeals: WeeklyDealRef[];
}

export interface SourcePacing {
  source: string;
  totalCreated: number;      // deals created from this source in Q2
  weeklyBreakdown: number[]; // 13 weeks of deal creation counts
  requiredTotal: number;     // what's needed from this source to hit goal
  paceStatus: 'ahead' | 'on_pace' | 'behind';
}

export interface PacingData {
  weeklyRows: WeeklyPacingRow[];
  sourceBreakdown: SourcePacing[];
  totalLeadsCreated: number;
  totalLeadsRequired: number; // Reverse-engineered from the GAP (target minus weighted team-confirmed pipeline)
  totalDealsCreated: number;
  totalDealsRequired: number;
  // Gap formula context (for the helper text under the Deal Creation Pacing chart)
  teamTarget: number;           // Full Q2 ARR target
  teamForecastWeighted: number; // Team-confirmed pipeline weighted by close rate
  gap: number;                  // max(0, teamTarget - teamForecastWeighted)
}

// -- Initiatives --

export interface InitiativeStatus {
  id: string;
  name: string;
  ownerLabel: string;
  leadSourceValues: string[];
  // Targets
  q2LeadTarget: number;
  q2ArrTarget: number;
  weeklyLeadPace: number;
  // Actuals
  leadsCreated: number;       // deals from this initiative's lead sources
  arrGenerated: number;       // total amount from those deals
  closedWonARR: number;       // closed-won amount
  // Pacing
  expectedByNow: number;      // based on weekly pace x weeks elapsed
  paceStatus: 'ahead' | 'on_pace' | 'behind';
  weeklyBreakdown: number[];  // 13 weeks of creation counts
}

// -- Deal Forecast (Phase 2-3) --

export type LikelihoodTier = 'highly_likely' | 'likely' | 'possible' | 'unlikely' | 'insufficient_data';

export interface DealForecastItem {
  hubspotDealId: string;
  dealName: string;
  ownerName: string;
  ownerId: string | null;
  amount: number;
  stage: string;
  stageId: string;
  closeDate: string | null;
  leadSource: string | null;
  // Intelligence scores
  overallGrade: string;
  overallScore: number;
  hygieneScore: number;
  momentumScore: number;
  engagementScore: number;
  riskScore: number;
  // LLM assessment
  llmStatus: string | null;
  buyerSentiment: string | null;
  dealMomentum: string | null;
  keyRisk: string | null;
  recommendedAction: string | null;
  reasoning: string | null;
  // Derived
  likelihoodTier: LikelihoodTier;
  // Override (if any)
  override: {
    likelihood: string;
    amount: number | null;
    reason: string;
    overriddenBy: string;
    overriddenAt: string;
  } | null;
}

// -- AE Execution (Phase 2) --

export interface AEExecutionSummary {
  name: string;
  email: string;
  ownerId: string | null;
  q2Target: number;
  closedWonARR: number;
  pipelineARR: number;
  dealCount: number;
  avgGrade: string;
  gradeDistribution: { A: number; B: number; C: number; D: number; F: number };
  dealsNeedingAttention: number; // D + F grades
  avgScore: number;
}

// -- Forecast (Phase 3) --

export interface ForecastSummary {
  totalWeighted: number;           // Sum of (amount x likelihood weight) across all deals
  target: number;
  gap: number;                      // max(0, target - totalWeighted)
  tiers: {
    highly_likely: { count: number; rawARR: number; weightedARR: number };
    likely: { count: number; rawARR: number; weightedARR: number };
    possible: { count: number; rawARR: number; weightedARR: number };
    unlikely: { count: number; rawARR: number; weightedARR: number };
    insufficient_data: { count: number; rawARR: number; weightedARR: number };
  };
  closedWonARR: number;            // Already closed this quarter
  projectedTotal: number;          // closedWon + totalWeighted
  confidenceLevel: 'high' | 'medium' | 'low';
}

// -- Command Center API Response (Phase 1) --

export interface CommandCenterResponse {
  // From existing Q2 goal tracker
  goalTracker: Q2GoalTrackerApiResponse;
  // New pacing data
  pacing: PacingData;
  // Initiative tracking
  initiatives: InitiativeStatus[];
  // Per-lead-source demo activity in Q2
  sourceDemoBreakdown: SourceDemoRow[];
}
