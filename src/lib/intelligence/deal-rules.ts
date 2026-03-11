/**
 * Deal Intelligence Rules Engine (Phase 1)
 *
 * Computes deterministic scores for all open deals using existing queue-detection utilities.
 * Runs after every HubSpot sync (fast, no LLM).
 *
 * Dimension weights: Hygiene 15%, Momentum 30%, Engagement 35%, Risk 20%
 * Grades: A=85-100, B=70-84, C=55-69, D=40-54, F=0-39
 */

import { createServiceClient } from '@/lib/supabase/client';
import {
  checkDealHygiene,
  checkDealHygieneWithConfig,
  HYGIENE_REQUIRED_FIELDS,
  UPSELL_HYGIENE_REQUIRED_FIELDS,
  EARLY_STAGE_HYGIENE_REQUIRED_FIELDS,
  checkNextStepCompliance,
  checkDealStaleness,
  type NextStepCheckInput,
  type StalledDealCheckInput,
  type HygieneCheckInput,
} from '@/lib/utils/queue-detection';
import { SALES_PIPELINE_STAGES, ALL_OPEN_STAGE_IDS, PRE_DEMO_STAGE_IDS } from '@/lib/hubspot/stage-config';
import { SYNC_CONFIG } from '@/lib/hubspot/sync-config';
import { TRACKED_STAGES } from '@/lib/hubspot/stage-mappings';

// --- Types ---

interface DealRow {
  id: string;
  hubspot_deal_id: string;
  deal_name: string | null;
  amount: number | null;
  deal_stage: string;
  pipeline: string;
  owner_id: string | null;
  close_date: string | null;
  next_step: string | null;
  next_step_due_date: string | null;
  next_step_status: string | null;
  next_step_last_updated_at: string | null;
  last_activity_date: string | null;
  next_activity_date: string | null;
  hubspot_created_at: string | null;
  deal_substage: string | null;
  lead_source: string | null;
  products: string | null;
  deal_collaborator: string | null;
  [key: string]: unknown;
}

interface Issue {
  type: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  message: string;
}

export interface DealIntelligenceRow {
  hubspot_deal_id: string;
  pipeline: string;
  overall_grade: string;
  overall_score: number;
  hygiene_score: number;
  momentum_score: number;
  engagement_score: number;
  risk_score: number;
  missing_fields: string[];
  hygiene_compliant: boolean;
  next_step_status: string | null;
  next_step_due_date: string | null;
  days_since_activity: number | null;
  has_future_activity: boolean;
  stalled_severity: string | null;
  overdue_task_count: number;
  deal_name: string | null;
  amount: number | null;
  stage_name: string | null;
  stage_id: string | null;
  days_in_stage: number | null;
  close_date: string | null;
  owner_id: string | null;
  owner_name: string | null;
  issues: Issue[];
  top_action: string | null;
  top_action_type: string | null;
  rules_computed_at: string;
  updated_at: string;
}

// --- Constants ---

const STAGE_LABEL_MAP = new Map<string, string>(
  Object.values(SALES_PIPELINE_STAGES).map((s) => [s.id, s.label])
);

const STAGE_ENTRY_COLUMNS = Object.values(TRACKED_STAGES).map((s) => ({
  dbColumn: s.dbColumn,
  label: s.label,
  stageId: s.id,
}));

const DIMENSION_WEIGHTS = {
  hygiene: 0.15,
  momentum: 0.30,
  engagement: 0.35,
  risk: 0.20,
};

// --- Grade Computation ---

function computeGrade(score: number): string {
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

function computeOverallScore(
  hygiene: number,
  momentum: number,
  engagement: number,
  risk: number
): number {
  return Math.round(
    hygiene * DIMENSION_WEIGHTS.hygiene +
    momentum * DIMENSION_WEIGHTS.momentum +
    engagement * DIMENSION_WEIGHTS.engagement +
    risk * DIMENSION_WEIGHTS.risk
  );
}

// --- Dimension Score Computation ---

function computeHygieneScore(deal: DealRow, isSalesPipeline: boolean, stageId: string): { score: number; missingFields: string[]; compliant: boolean } {
  if (isSalesPipeline) {
    // Early-stage deals (pre Demo Completed) only scored on Amount + Close Date
    if (PRE_DEMO_STAGE_IDS.includes(stageId)) {
      const result = checkDealHygieneWithConfig(deal, EARLY_STAGE_HYGIENE_REQUIRED_FIELDS);
      const totalFields = EARLY_STAGE_HYGIENE_REQUIRED_FIELDS.length;
      const filledFields = totalFields - result.missingFields.length;
      const score = Math.round((filledFields / totalFields) * 100);
      return {
        score,
        missingFields: result.missingFields.map(f => f.label),
        compliant: result.isCompliant,
      };
    }
    const result = checkDealHygiene(deal as unknown as HygieneCheckInput);
    const totalFields = HYGIENE_REQUIRED_FIELDS.length;
    const filledFields = totalFields - result.missingFields.length;
    const score = Math.round((filledFields / totalFields) * 100);
    return {
      score,
      missingFields: result.missingFields.map(f => f.label),
      compliant: result.isCompliant,
    };
  } else {
    const result = checkDealHygieneWithConfig(deal, UPSELL_HYGIENE_REQUIRED_FIELDS);
    const totalFields = UPSELL_HYGIENE_REQUIRED_FIELDS.length;
    const filledFields = totalFields - result.missingFields.length;
    const score = Math.round((filledFields / totalFields) * 100);
    return {
      score,
      missingFields: result.missingFields.map(f => f.label),
      compliant: result.isCompliant,
    };
  }
}

function computeMomentumScore(deal: DealRow): { score: number; daysSinceActivity: number | null; hasFutureActivity: boolean; stalledSeverity: string | null } {
  const stalledInput: StalledDealCheckInput = {
    last_activity_date: deal.last_activity_date,
    next_activity_date: deal.next_activity_date,
    hubspot_created_at: deal.hubspot_created_at,
    close_date: deal.close_date,
    next_step: deal.next_step,
    next_step_due_date: deal.next_step_due_date,
    next_step_status: deal.next_step_status,
    amount: deal.amount,
  };

  const stalledResult = checkDealStaleness(stalledInput);
  const hasFutureActivity = !!(deal.next_activity_date && new Date(deal.next_activity_date) > new Date());

  if (!stalledResult.isStalled) {
    // Not stalled - score based on activity recency
    if (hasFutureActivity) return { score: 95, daysSinceActivity: stalledResult.daysSinceActivity || null, hasFutureActivity, stalledSeverity: null };
    if (stalledResult.daysSinceActivity <= 3) return { score: 85, daysSinceActivity: stalledResult.daysSinceActivity, hasFutureActivity, stalledSeverity: null };
    if (stalledResult.daysSinceActivity <= 5) return { score: 75, daysSinceActivity: stalledResult.daysSinceActivity, hasFutureActivity, stalledSeverity: null };
    return { score: 65, daysSinceActivity: stalledResult.daysSinceActivity, hasFutureActivity, stalledSeverity: null };
  }

  // Stalled - score based on severity
  switch (stalledResult.severity) {
    case 'watch': return { score: 45, daysSinceActivity: stalledResult.daysSinceActivity, hasFutureActivity, stalledSeverity: 'watch' };
    case 'warning': return { score: 25, daysSinceActivity: stalledResult.daysSinceActivity, hasFutureActivity, stalledSeverity: 'warning' };
    case 'critical': return { score: 10, daysSinceActivity: stalledResult.daysSinceActivity, hasFutureActivity, stalledSeverity: 'critical' };
    default: return { score: 35, daysSinceActivity: stalledResult.daysSinceActivity, hasFutureActivity, stalledSeverity: null };
  }
}

function computeRulesEngagementScore(deal: DealRow): number {
  // Without LLM, use next step compliance as a proxy for engagement
  const nextStepInput: NextStepCheckInput = {
    next_step: deal.next_step,
    next_step_due_date: deal.next_step_due_date,
    next_step_status: deal.next_step_status,
    next_step_last_updated_at: deal.next_step_last_updated_at,
  };

  const nextStepResult = checkNextStepCompliance(nextStepInput);

  switch (nextStepResult.status) {
    case 'compliant': return 80;
    case 'stale': return 50;
    case 'overdue': return 30;
    case 'missing': return 20;
    default: return 50;
  }
}

function computeRulesRiskScore(deal: DealRow): number {
  let score = 80; // Start optimistic

  // Close date in the past is a major risk
  if (deal.close_date && new Date(deal.close_date) < new Date()) {
    score -= 30;
  }

  // Close date within 14 days adds pressure
  if (deal.close_date) {
    const daysUntilClose = Math.floor((new Date(deal.close_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (daysUntilClose > 0 && daysUntilClose <= 14) {
      score -= 10;
    }
  }

  // No next step is risky
  if (!deal.next_step || deal.next_step.trim().length === 0) {
    score -= 15;
  }

  // No amount set
  if (!deal.amount || deal.amount === 0) {
    score -= 10;
  }

  return Math.max(0, Math.min(100, score));
}

// --- Issues Building ---

function buildIssues(
  deal: DealRow,
  hygieneResult: { missingFields: string[]; compliant: boolean },
  nextStepStatus: string,
  stalledSeverity: string | null,
  daysSinceActivity: number | null,
): Issue[] {
  const issues: Issue[] = [];

  // Hygiene issues
  if (!hygieneResult.compliant) {
    const severity: Issue['severity'] = hygieneResult.missingFields.length >= 3 ? 'high' : 'medium';
    issues.push({
      type: 'hygiene',
      severity,
      message: `Missing: ${hygieneResult.missingFields.join(', ')}`,
    });
  }

  // Next step issues
  if (nextStepStatus === 'missing') {
    issues.push({
      type: 'next_step',
      severity: 'high',
      message: 'No next step defined',
    });
  } else if (nextStepStatus === 'overdue') {
    issues.push({
      type: 'next_step',
      severity: 'high',
      message: 'Next step is overdue',
    });
  } else if (nextStepStatus === 'stale') {
    issues.push({
      type: 'next_step',
      severity: 'medium',
      message: 'Next step hasn\'t been updated recently',
    });
  }

  // Stalled issues
  if (stalledSeverity) {
    const severityMap: Record<string, Issue['severity']> = {
      critical: 'critical',
      warning: 'high',
      watch: 'medium',
    };
    issues.push({
      type: 'stalled',
      severity: severityMap[stalledSeverity] || 'medium',
      message: `Deal stalled — ${daysSinceActivity ?? 0} business days since activity (${stalledSeverity})`,
    });
  }

  // Close date issues
  if (deal.close_date) {
    const daysUntilClose = Math.floor((new Date(deal.close_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (daysUntilClose < 0) {
      issues.push({
        type: 'close_date',
        severity: 'high',
        message: `Close date ${Math.abs(daysUntilClose)} days overdue`,
      });
    } else if (daysUntilClose <= 7) {
      issues.push({
        type: 'close_date',
        severity: 'medium',
        message: `Close date in ${daysUntilClose} days`,
      });
    }
  }

  // Sort: critical > high > medium > low
  const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  issues.sort((a, b) => (severityOrder[a.severity] ?? 4) - (severityOrder[b.severity] ?? 4));

  return issues;
}

function pickTopAction(issues: Issue[], nextStepStatus: string): { action: string | null; type: string | null } {
  if (issues.length === 0) return { action: null, type: null };

  // Priority: stalled critical > next step missing > hygiene > stalled warning > other
  const stalledCritical = issues.find(i => i.type === 'stalled' && i.severity === 'critical');
  if (stalledCritical) return { action: 'Re-engage immediately — deal has been inactive for 14+ business days', type: 'stalled' };

  const nextStepMissing = issues.find(i => i.type === 'next_step' && nextStepStatus === 'missing');
  if (nextStepMissing) return { action: 'Define next step to keep deal progressing', type: 'next_step' };

  const nextStepOverdue = issues.find(i => i.type === 'next_step' && nextStepStatus === 'overdue');
  if (nextStepOverdue) return { action: 'Update overdue next step', type: 'next_step' };

  const closeDateOverdue = issues.find(i => i.type === 'close_date' && i.severity === 'high');
  if (closeDateOverdue) return { action: 'Update close date — current date has passed', type: 'close_date' };

  const hygieneIssue = issues.find(i => i.type === 'hygiene');
  if (hygieneIssue) return { action: `Fill missing fields: ${hygieneIssue.message.replace('Missing: ', '')}`, type: 'hygiene' };

  return { action: issues[0].message, type: issues[0].type };
}

// --- Main Processing ---

function computeDaysInStage(deal: DealRow): number | null {
  const now = new Date();
  for (const entry of STAGE_ENTRY_COLUMNS) {
    if (entry.stageId === deal.deal_stage && deal[entry.dbColumn]) {
      const enteredAt = new Date(deal[entry.dbColumn] as string);
      return Math.floor((now.getTime() - enteredAt.getTime()) / (1000 * 60 * 60 * 24));
    }
  }
  return null;
}

function processDeal(deal: DealRow, ownerMap: Map<string, string>): DealIntelligenceRow {
  const isSalesPipeline = deal.pipeline === SYNC_CONFIG.TARGET_PIPELINE_ID;
  const stageName = STAGE_LABEL_MAP.get(deal.deal_stage) || deal.deal_stage || 'Unknown';
  const daysInStage = computeDaysInStage(deal);

  // Compute dimension scores
  const hygieneResult = computeHygieneScore(deal, isSalesPipeline, deal.deal_stage);
  const momentumResult = computeMomentumScore(deal);

  // Next step compliance
  const nextStepInput: NextStepCheckInput = {
    next_step: deal.next_step,
    next_step_due_date: deal.next_step_due_date,
    next_step_status: deal.next_step_status,
    next_step_last_updated_at: deal.next_step_last_updated_at,
  };
  const nextStepResult = checkNextStepCompliance(nextStepInput);

  // Engagement and risk (rules-based defaults, LLM overrides later)
  const engagementScore = computeRulesEngagementScore(deal);
  const riskScore = computeRulesRiskScore(deal);

  // Overall
  const overallScore = computeOverallScore(hygieneResult.score, momentumResult.score, engagementScore, riskScore);
  const overallGrade = computeGrade(overallScore);

  // Issues
  const issues = buildIssues(deal, hygieneResult, nextStepResult.status, momentumResult.stalledSeverity, momentumResult.daysSinceActivity);
  const topAction = pickTopAction(issues, nextStepResult.status);

  const now = new Date().toISOString();

  return {
    hubspot_deal_id: deal.hubspot_deal_id,
    pipeline: deal.pipeline,
    overall_grade: overallGrade,
    overall_score: overallScore,
    hygiene_score: hygieneResult.score,
    momentum_score: momentumResult.score,
    engagement_score: engagementScore,
    risk_score: riskScore,
    missing_fields: hygieneResult.missingFields,
    hygiene_compliant: hygieneResult.compliant,
    next_step_status: nextStepResult.status,
    next_step_due_date: nextStepResult.status === 'overdue' && deal.next_step_due_date ? deal.next_step_due_date : null,
    days_since_activity: momentumResult.daysSinceActivity,
    has_future_activity: momentumResult.hasFutureActivity,
    stalled_severity: momentumResult.stalledSeverity,
    overdue_task_count: 0, // Will be updated if task data is available
    deal_name: deal.deal_name,
    amount: deal.amount,
    stage_name: stageName,
    stage_id: deal.deal_stage,
    days_in_stage: daysInStage,
    close_date: deal.close_date,
    owner_id: deal.owner_id,
    owner_name: deal.owner_id ? ownerMap.get(deal.owner_id) || null : null,
    issues,
    top_action: topAction.action,
    top_action_type: topAction.type,
    rules_computed_at: now,
    updated_at: now,
  };
}

export async function computeAllDealIntelligence(): Promise<{ processed: number; errors: number }> {
  const supabase = createServiceClient();

  // Fetch all open deals from both pipelines using stage-based filtering
  const { data: salesDeals, error: salesError } = await supabase
    .from('deals')
    .select('*')
    .eq('pipeline', SYNC_CONFIG.TARGET_PIPELINE_ID)
    .in('deal_stage', ALL_OPEN_STAGE_IDS);

  if (salesError) {
    console.error('Error fetching deals for intelligence:', salesError);
    throw new Error(`Failed to fetch deals: ${salesError.message}`);
  }

  const deals = salesDeals || [];

  if (deals.length === 0) {
    return { processed: 0, errors: 0 };
  }

  // Fetch owner names
  const ownerIds = [...new Set(deals.map(d => d.owner_id).filter((id): id is string => id !== null))];
  const ownerMap = new Map<string, string>();

  if (ownerIds.length > 0) {
    const { data: owners } = await supabase
      .from('owners')
      .select('id, first_name, last_name')
      .in('id', ownerIds);

    for (const owner of owners || []) {
      const name = [owner.first_name, owner.last_name].filter(Boolean).join(' ');
      ownerMap.set(owner.id, name || 'Unknown');
    }
  }

  // Process each deal
  let errors = 0;
  const rows: DealIntelligenceRow[] = [];

  for (const deal of deals as DealRow[]) {
    try {
      const row = processDeal(deal, ownerMap);
      rows.push(row);
    } catch (err) {
      console.error(`Error processing deal ${deal.hubspot_deal_id}:`, err);
      errors++;
    }
  }

  // Batch upsert
  if (rows.length > 0) {
    const batchSize = 100;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const { error: upsertError } = await supabase
        .from('deal_intelligence')
        .upsert(batch, { onConflict: 'hubspot_deal_id' });

      if (upsertError) {
        console.error(`Error upserting deal intelligence batch ${i}:`, upsertError);
        errors += batch.length;
      }
    }
  }

  return { processed: rows.length, errors };
}

export { processDeal, computeGrade, computeOverallScore };
