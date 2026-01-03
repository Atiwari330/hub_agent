/**
 * Deal Risk Assessment Utility
 *
 * Calculates risk levels for deals based on:
 * 1. Stage Age Breach - time in current stage vs expected
 * 2. Activity Drought - days since last buyer engagement
 * 3. No Next Step - missing validated next milestone
 * 4. Close Date Breach - deal is overdue
 *
 * Thresholds based on healthcare SaaS buying cycles research.
 */

export type RiskLevel = 'healthy' | 'at_risk' | 'stale';
export type RiskFactorType =
  | 'stage_age'
  | 'activity_drought'
  | 'no_next_step'
  | 'overdue'
  | 'overdue_next_step';

export interface RiskFactor {
  type: RiskFactorType;
  message: string;
}

export interface DealRiskAssessment {
  level: RiskLevel;
  factors: RiskFactor[];
  daysInStage: number | null;
  daysSinceActivity: number | null;
}

// Stage category thresholds (from healthcare SaaS research)
// Expected = typical time in stage
// At Risk = 1.5x expected (warning)
// Stale = 2x expected (action required)
// Inactivity SLA = days without buyer engagement before flagging
const STAGE_THRESHOLDS = {
  early: { expected: 21, atRisk: 32, stale: 42, inactivitySla: 7 },
  mid: { expected: 14, atRisk: 21, stale: 28, inactivitySla: 10 },
  late: { expected: 30, atRisk: 45, stale: 60, inactivitySla: 15 },
} as const;

type StageCategory = 'early' | 'mid' | 'late' | 'closed';

/**
 * Map stage name to category for threshold lookup
 */
function getStageCategory(stageName: string | null): StageCategory {
  if (!stageName) return 'early';

  const lower = stageName.toLowerCase();

  // Closed stages - no risk assessment needed
  if (
    lower.includes('closed') ||
    lower.includes('disqualified') ||
    lower.includes('lost')
  ) {
    return 'closed';
  }

  // Mid stages - demo-related
  if (lower.includes('demo')) {
    return 'mid';
  }

  // Late stages - proposal/negotiation/contract
  if (
    lower.includes('proposal') ||
    lower.includes('negotiation') ||
    lower.includes('contract') ||
    lower.includes('legal') ||
    lower.includes('procurement')
  ) {
    return 'late';
  }

  // Default to early (SQL, MQL, Discovery, Qualified, etc.)
  return 'early';
}

/**
 * Calculate days between two dates
 */
function daysBetween(from: Date, to: Date): number {
  const diffMs = to.getTime() - from.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Get the stage entry timestamp for the current stage
 */
function getStageEntryDate(
  stageName: string | null,
  sqlEnteredAt: string | null,
  demoScheduledEnteredAt: string | null,
  demoCompletedEnteredAt: string | null,
  hubspotCreatedAt: string | null
): Date | null {
  if (!stageName) {
    return hubspotCreatedAt ? new Date(hubspotCreatedAt) : null;
  }

  const lower = stageName.toLowerCase();

  // Check for specific tracked stages
  if (lower === 'sql' && sqlEnteredAt) {
    return new Date(sqlEnteredAt);
  }

  if (
    (lower.includes('demo') && lower.includes('scheduled')) &&
    demoScheduledEnteredAt
  ) {
    return new Date(demoScheduledEnteredAt);
  }

  if (
    (lower.includes('demo') && lower.includes('completed')) &&
    demoCompletedEnteredAt
  ) {
    return new Date(demoCompletedEnteredAt);
  }

  // Fallback to deal creation date for untracked stages
  return hubspotCreatedAt ? new Date(hubspotCreatedAt) : null;
}

export interface DealRiskInput {
  stageName: string | null;
  closeDate: string | null;
  lastActivityDate: string | null;
  nextActivityDate: string | null;
  nextStep: string | null;
  sqlEnteredAt: string | null;
  demoScheduledEnteredAt: string | null;
  demoCompletedEnteredAt: string | null;
  hubspotCreatedAt: string | null;
  // Next step analysis (from LLM extraction)
  nextStepDueDate?: string | null;
  nextStepStatus?: string | null;
}

/**
 * Calculate the risk assessment for a deal
 */
export function calculateDealRisk(deal: DealRiskInput): DealRiskAssessment {
  const factors: RiskFactor[] = [];
  const now = new Date();

  // Get stage category
  const stageCategory = getStageCategory(deal.stageName);

  // Skip risk assessment for closed deals
  if (stageCategory === 'closed') {
    return {
      level: 'healthy',
      factors: [],
      daysInStage: null,
      daysSinceActivity: null,
    };
  }

  const thresholds = STAGE_THRESHOLDS[stageCategory];

  // Calculate days in stage
  const stageEntryDate = getStageEntryDate(
    deal.stageName,
    deal.sqlEnteredAt,
    deal.demoScheduledEnteredAt,
    deal.demoCompletedEnteredAt,
    deal.hubspotCreatedAt
  );

  let daysInStage: number | null = null;
  if (stageEntryDate) {
    daysInStage = daysBetween(stageEntryDate, now);

    // Check stage age breach
    if (daysInStage >= thresholds.stale) {
      factors.push({
        type: 'stage_age',
        message: `In stage ${daysInStage} days (expected: ${thresholds.expected})`,
      });
    } else if (daysInStage >= thresholds.atRisk) {
      factors.push({
        type: 'stage_age',
        message: `In stage ${daysInStage} days (expected: ${thresholds.expected})`,
      });
    }
  }

  // Calculate days since last activity
  let daysSinceActivity: number | null = null;
  if (deal.lastActivityDate) {
    const lastActivity = new Date(deal.lastActivityDate);
    daysSinceActivity = daysBetween(lastActivity, now);

    // Check activity drought
    if (daysSinceActivity > thresholds.inactivitySla) {
      factors.push({
        type: 'activity_drought',
        message: `No activity in ${daysSinceActivity} days (SLA: ${thresholds.inactivitySla})`,
      });
    }
  } else {
    // No activity date at all - could indicate no notes/engagement
    // Only flag if deal is more than a week old
    if (deal.hubspotCreatedAt) {
      const created = new Date(deal.hubspotCreatedAt);
      const dealAge = daysBetween(created, now);
      if (dealAge > 7) {
        factors.push({
          type: 'activity_drought',
          message: `No activity recorded`,
        });
      }
    }
  }

  // Check for missing next step
  const hasNextStep = deal.nextStep && deal.nextStep.trim().length > 0;
  const hasNextActivity =
    deal.nextActivityDate && new Date(deal.nextActivityDate) > now;

  if (!hasNextStep && !hasNextActivity) {
    factors.push({
      type: 'no_next_step',
      message: 'No next step or activity scheduled',
    });
  }

  // Check close date breach (overdue)
  if (deal.closeDate) {
    const closeDate = new Date(deal.closeDate);
    if (closeDate < now) {
      const daysOverdue = daysBetween(closeDate, now);
      factors.push({
        type: 'overdue',
        message: `Close date passed ${daysOverdue} days ago`,
      });
    }
  }

  // Check for overdue next step (from LLM analysis)
  if (
    deal.nextStepDueDate &&
    deal.nextStepStatus &&
    (deal.nextStepStatus === 'date_found' || deal.nextStepStatus === 'date_inferred')
  ) {
    const dueDate = new Date(deal.nextStepDueDate);
    if (dueDate < now) {
      const daysOverdue = daysBetween(dueDate, now);
      factors.push({
        type: 'overdue_next_step',
        message: `Next step overdue by ${daysOverdue} day${daysOverdue !== 1 ? 's' : ''}`,
      });
    }
  }

  // Determine risk level based on factor count
  let level: RiskLevel = 'healthy';
  if (factors.length >= 2) {
    level = 'stale';
  } else if (factors.length === 1) {
    level = 'at_risk';
  }

  return {
    level,
    factors,
    daysInStage,
    daysSinceActivity,
  };
}
