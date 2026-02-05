/**
 * Queue detection utilities
 * Logic for determining which deals belong in hygiene and next-step queues
 */

import { getBusinessDaysSinceDate, getDaysUntil, isDateInPast } from './business-days';

// ===== HYGIENE QUEUE CONFIGURATION =====

// Sales Pipeline required fields (5 fields)
export const HYGIENE_REQUIRED_FIELDS = [
  { field: 'deal_substage', label: 'Substage' },
  { field: 'close_date', label: 'Close Date' },
  { field: 'amount', label: 'Amount' },
  { field: 'lead_source', label: 'Lead Source' },
  { field: 'products', label: 'Products' },
] as const;

// Upsell Pipeline required fields (3 fields)
export const UPSELL_HYGIENE_REQUIRED_FIELDS = [
  { field: 'amount', label: 'Amount' },
  { field: 'close_date', label: 'Close Date' },
  { field: 'products', label: 'Products' },
] as const;

// CS Hygiene required fields for companies (6 fields)
export const CS_HYGIENE_REQUIRED_FIELDS = [
  { field: 'sentiment', label: 'Sentiment' },
  { field: 'auto_renew', label: 'Renewal' },
  { field: 'contract_end', label: 'Contract End Date' },
  { field: 'mrr', label: 'MRR' },
  { field: 'contract_status', label: 'Contract Status' },
  { field: 'qbr_notes', label: 'QBR Notes' },
] as const;

export type HygieneField = typeof HYGIENE_REQUIRED_FIELDS[number]['field'];
export type UpsellHygieneField = typeof UPSELL_HYGIENE_REQUIRED_FIELDS[number]['field'];
export type CSHygieneField = typeof CS_HYGIENE_REQUIRED_FIELDS[number]['field'];

// Generic hygiene field configuration type
export interface HygieneFieldConfig {
  field: string;
  label: string;
}

export const NEW_DEAL_THRESHOLD_BUSINESS_DAYS = 7;

// ===== TYPES =====

export interface HygieneCheckInput {
  id: string;
  hubspot_created_at: string | null;
  deal_substage: string | null;
  close_date: string | null;
  amount: number | null;
  lead_source: string | null;
  products: string | null;
  deal_collaborator: string | null;
}

export interface HygieneMissingField {
  field: HygieneField;
  label: string;
}

export interface HygieneCheckResult {
  isCompliant: boolean;
  missingFields: HygieneMissingField[];
}

export type HygieneStatus = 'compliant' | 'needs_commitment' | 'pending' | 'escalated';

export interface HygieneCommitment {
  commitment_date: string;
  status: 'pending' | 'completed' | 'escalated';
}

export interface HygieneStatusInput {
  deal: HygieneCheckInput;
  commitment: HygieneCommitment | null;
}

export interface HygieneStatusResult {
  status: HygieneStatus;
  missingFields: HygieneMissingField[];
  reason: string;
  businessDaysOld: number;
  isNewDeal: boolean;
}

// ===== NEXT STEP QUEUE TYPES =====

export interface NextStepCheckInput {
  next_step: string | null;
  next_step_due_date: string | null;
  next_step_status: string | null;
}

export type NextStepQueueStatus = 'compliant' | 'missing' | 'overdue';

export interface NextStepCheckResult {
  status: NextStepQueueStatus;
  daysOverdue: number | null;
  reason: string;
}

// ===== HYGIENE QUEUE DETECTION =====

/**
 * Generic hygiene check with configurable required fields
 * Works with any deal-like object that has the required field properties
 */
export function checkDealHygieneWithConfig<T extends Record<string, unknown>>(
  deal: T,
  requiredFields: readonly HygieneFieldConfig[]
): HygieneCheckResult {
  const missingFields: HygieneMissingField[] = [];

  for (const { field, label } of requiredFields) {
    const value = deal[field as keyof T];
    // Check for null, undefined, empty string, or zero amount
    const isEmpty = value === null || value === undefined || value === '';
    // For amount, also consider 0 as missing
    const isEmptyAmount = field === 'amount' && (isEmpty || value === 0);

    if (isEmpty || isEmptyAmount) {
      missingFields.push({ field: field as HygieneField, label });
    }
  }

  return {
    isCompliant: missingFields.length === 0,
    missingFields,
  };
}

/**
 * Check if a deal has all required hygiene fields (Sales Pipeline)
 */
export function checkDealHygiene(deal: HygieneCheckInput): HygieneCheckResult {
  const missingFields: HygieneMissingField[] = [];

  for (const { field, label } of HYGIENE_REQUIRED_FIELDS) {
    const value = deal[field];
    // Check for null, undefined, empty string, or zero amount
    const isEmpty = value === null || value === undefined || value === '';
    // For amount, also consider 0 as missing
    const isEmptyAmount = field === 'amount' && (isEmpty || value === 0);

    if (isEmpty || isEmptyAmount) {
      missingFields.push({ field, label });
    }
  }

  return {
    isCompliant: missingFields.length === 0,
    missingFields,
  };
}

/**
 * Check if a deal has all required hygiene fields (Upsell Pipeline)
 */
export function checkUpsellDealHygiene(deal: Record<string, unknown>): HygieneCheckResult {
  return checkDealHygieneWithConfig(deal, UPSELL_HYGIENE_REQUIRED_FIELDS);
}

/**
 * Check if a deal is considered "new" (within grace period)
 */
export function isNewDeal(hubspotCreatedAt: string | null): boolean {
  if (!hubspotCreatedAt) return false;
  const businessDays = getBusinessDaysSinceDate(hubspotCreatedAt);
  return businessDays <= NEW_DEAL_THRESHOLD_BUSINESS_DAYS;
}

/**
 * Determine the hygiene status for a deal
 */
export function determineHygieneStatus(input: HygieneStatusInput): HygieneStatusResult {
  const { deal, commitment } = input;
  const hygieneCheck = checkDealHygiene(deal);
  const businessDaysOld = deal.hubspot_created_at
    ? getBusinessDaysSinceDate(deal.hubspot_created_at)
    : 999; // If no created date, treat as old
  const dealIsNew = isNewDeal(deal.hubspot_created_at);

  // If all fields present, deal is compliant
  if (hygieneCheck.isCompliant) {
    return {
      status: 'compliant',
      missingFields: [],
      reason: '',
      businessDaysOld,
      isNewDeal: dealIsNew,
    };
  }

  // If no commitment exists
  if (!commitment) {
    // New deals get grace period to set commitment
    if (dealIsNew) {
      return {
        status: 'needs_commitment',
        missingFields: hygieneCheck.missingFields,
        reason: generateHygieneReason('needs_commitment', hygieneCheck.missingFields, null),
        businessDaysOld,
        isNewDeal: dealIsNew,
      };
    }
    // Older deals without commitment are escalated
    return {
      status: 'escalated',
      missingFields: hygieneCheck.missingFields,
      reason: generateHygieneReason('escalated', hygieneCheck.missingFields, null),
      businessDaysOld,
      isNewDeal: dealIsNew,
    };
  }

  // Commitment exists - check if completed
  if (commitment.status === 'completed') {
    // Re-check hygiene - if still missing fields, should be escalated
    return {
      status: 'escalated',
      missingFields: hygieneCheck.missingFields,
      reason: generateHygieneReason('escalated', hygieneCheck.missingFields, commitment),
      businessDaysOld,
      isNewDeal: dealIsNew,
    };
  }

  // Check if commitment date has passed
  if (isDateInPast(commitment.commitment_date)) {
    return {
      status: 'escalated',
      missingFields: hygieneCheck.missingFields,
      reason: generateHygieneReason('escalated', hygieneCheck.missingFields, commitment),
      businessDaysOld,
      isNewDeal: dealIsNew,
    };
  }

  // Commitment is still in the future
  return {
    status: 'pending',
    missingFields: hygieneCheck.missingFields,
    reason: generateHygieneReason('pending', hygieneCheck.missingFields, commitment),
    businessDaysOld,
    isNewDeal: dealIsNew,
  };
}

/**
 * Generate a human-readable reason for why a deal is in the hygiene queue
 */
export function generateHygieneReason(
  status: HygieneStatus,
  missingFields: HygieneMissingField[],
  commitment: HygieneCommitment | null
): string {
  const fieldList = missingFields.map((f) => f.label).join(', ');

  switch (status) {
    case 'needs_commitment':
      return `New deal missing: ${fieldList}. Please set a date to complete.`;

    case 'pending': {
      const daysLeft = commitment ? getDaysUntil(commitment.commitment_date) : 0;
      if (daysLeft === 0) {
        return `Missing: ${fieldList}. Due today.`;
      } else if (daysLeft === 1) {
        return `Missing: ${fieldList}. Due tomorrow.`;
      }
      return `Missing: ${fieldList}. Due in ${daysLeft} days.`;
    }

    case 'escalated':
      if (commitment) {
        const daysOverdue = Math.abs(getDaysUntil(commitment.commitment_date));
        return `OVERDUE by ${daysOverdue} day${daysOverdue !== 1 ? 's' : ''}: Still missing ${fieldList}.`;
      }
      return `Missing required fields: ${fieldList}. Action required.`;

    case 'compliant':
    default:
      return '';
  }
}

// ===== OVERDUE TASKS QUEUE TYPES =====

export interface OverdueTaskInfo {
  taskId: string;
  subject: string;
  dueDate: string;
  daysOverdue: number;
}

export interface OverdueTasksCheckResult {
  hasOverdueTasks: boolean;
  overdueCount: number;
  overdueTasks: OverdueTaskInfo[];
  oldestOverdueDays: number;
}

/**
 * Task input from HubSpot for checking overdue status
 */
export interface TaskCheckInput {
  id: string;
  hs_task_subject: string | null;
  hs_task_status: string | null;
  hs_timestamp: string | null; // Due date
}

/**
 * Check tasks for overdue status
 * Returns overdue tasks that have NOT_STARTED status and past due date
 */
export function checkOverdueTasks(tasks: TaskCheckInput[]): OverdueTasksCheckResult {
  const overdueTasks: OverdueTaskInfo[] = [];

  for (const task of tasks) {
    // Only check NOT_STARTED tasks
    if (task.hs_task_status !== 'NOT_STARTED') {
      continue;
    }

    // Must have a due date
    if (!task.hs_timestamp) {
      continue;
    }

    // Check if due date is in the past
    if (isDateInPast(task.hs_timestamp)) {
      const daysOverdue = Math.abs(getDaysUntil(task.hs_timestamp));
      overdueTasks.push({
        taskId: task.id,
        subject: task.hs_task_subject || 'Untitled Task',
        dueDate: task.hs_timestamp,
        daysOverdue,
      });
    }
  }

  // Sort by days overdue descending (most overdue first)
  overdueTasks.sort((a, b) => b.daysOverdue - a.daysOverdue);

  const oldestOverdueDays = overdueTasks.length > 0 ? overdueTasks[0].daysOverdue : 0;

  return {
    hasOverdueTasks: overdueTasks.length > 0,
    overdueCount: overdueTasks.length,
    overdueTasks,
    oldestOverdueDays,
  };
}

// ===== STALLED DEALS QUEUE TYPES =====

export const STALLED_THRESHOLDS = {
  WATCH: 7,      // > 7 business days without activity
  WARNING: 10,   // > 10 business days without activity
  CRITICAL: 14,  // > 14 business days without activity
  MIN_AGE: 7,    // Deal must be at least 7 business days old
  MIN_INACTIVE: 7, // Minimum inactive days before a deal is considered stalled
} as const;

export type StalledThresholds = {
  WATCH: number;
  WARNING: number;
  CRITICAL: number;
  MIN_AGE: number;
  MIN_INACTIVE: number;
};

export type StalledSeverity = 'critical' | 'warning' | 'watch';

export interface StalledDealCheckInput {
  last_activity_date: string | null;
  next_activity_date: string | null;
  hubspot_created_at: string | null;
  close_date: string | null;
  next_step: string | null;
  next_step_due_date: string | null;
  next_step_status: string | null;
  amount: number | null;
}

export interface StalledAggravatingFactors {
  closeDateInPast: boolean;
  closeDateWithin14Days: boolean;
  noNextStep: boolean;
  nextStepOverdue: boolean;
}

export interface StalledDealCheckResult {
  isStalled: boolean;
  severity: StalledSeverity | null;
  daysSinceActivity: number;
  aggravatingFactors: StalledAggravatingFactors;
}

/**
 * Check if a deal is stalled (no recent activity and no future activity scheduled).
 *
 * A deal is stalled if ALL of:
 * 1. last_activity_date > MIN_INACTIVE business days ago
 * 2. next_activity_date is NULL or in the past
 * 3. Deal is older than MIN_AGE business days
 *
 * Accepts optional threshold overrides; defaults to STALLED_THRESHOLDS.
 */
export function checkDealStaleness(
  deal: StalledDealCheckInput,
  thresholds?: Partial<StalledThresholds>,
): StalledDealCheckResult {
  const t: StalledThresholds = { ...STALLED_THRESHOLDS, ...thresholds };
  const minInactive = t.MIN_INACTIVE ?? t.WATCH; // fallback for callers not setting MIN_INACTIVE

  const notStalled: StalledDealCheckResult = {
    isStalled: false,
    severity: null,
    daysSinceActivity: 0,
    aggravatingFactors: { closeDateInPast: false, closeDateWithin14Days: false, noNextStep: false, nextStepOverdue: false },
  };

  // Must be old enough (not brand new)
  if (!deal.hubspot_created_at) return notStalled;
  const dealAge = getBusinessDaysSinceDate(deal.hubspot_created_at);
  if (dealAge <= t.MIN_AGE) return notStalled;

  // Must have a last_activity_date and it must be stale
  if (!deal.last_activity_date) {
    // No activity date at all - treat as stalled since creation
    // Use deal age as days since activity
    const daysSinceActivity = dealAge;
    if (daysSinceActivity <= minInactive) return notStalled;

    return buildStalledResult(deal, daysSinceActivity, t);
  }

  const daysSinceActivity = getBusinessDaysSinceDate(deal.last_activity_date);
  if (daysSinceActivity <= minInactive) return notStalled;

  // Must have no future activity scheduled
  if (deal.next_activity_date && !isDateInPast(deal.next_activity_date)) {
    return notStalled;
  }

  return buildStalledResult(deal, daysSinceActivity, t);
}

function buildStalledResult(
  deal: StalledDealCheckInput,
  daysSinceActivity: number,
  t: StalledThresholds,
): StalledDealCheckResult {
  let severity: StalledSeverity;
  if (daysSinceActivity > t.CRITICAL) {
    severity = 'critical';
  } else if (daysSinceActivity > t.WARNING) {
    severity = 'warning';
  } else {
    severity = 'watch';
  }

  // Calculate aggravating factors (display only)
  const closeDateInPast = deal.close_date ? isDateInPast(deal.close_date) : false;
  const closeDateWithin14Days = deal.close_date && !closeDateInPast
    ? getDaysUntil(deal.close_date) <= 14
    : false;
  const noNextStep = !deal.next_step || deal.next_step.trim().length === 0;
  const nextStepOverdue = !!(
    deal.next_step_due_date &&
    deal.next_step_status &&
    (deal.next_step_status === 'date_found' || deal.next_step_status === 'date_inferred') &&
    isDateInPast(deal.next_step_due_date)
  );

  return {
    isStalled: true,
    severity,
    daysSinceActivity,
    aggravatingFactors: {
      closeDateInPast,
      closeDateWithin14Days,
      noNextStep,
      nextStepOverdue,
    },
  };
}

// ===== NEXT STEP QUEUE DETECTION =====

/**
 * Check if a deal has next step compliance issues
 */
export function checkNextStepCompliance(deal: NextStepCheckInput): NextStepCheckResult {
  const hasNextStep = deal.next_step && deal.next_step.trim().length > 0;

  if (!hasNextStep) {
    return {
      status: 'missing',
      daysOverdue: null,
      reason: 'This deal has no next step defined. Add one to keep it moving.',
    };
  }

  // Check if next step has a due date and if it's overdue
  if (
    deal.next_step_due_date &&
    deal.next_step_status &&
    (deal.next_step_status === 'date_found' || deal.next_step_status === 'date_inferred')
  ) {
    if (isDateInPast(deal.next_step_due_date)) {
      const daysOverdue = Math.abs(getDaysUntil(deal.next_step_due_date));
      return {
        status: 'overdue',
        daysOverdue,
        reason: `Next step is ${daysOverdue} day${daysOverdue !== 1 ? 's' : ''} overdue. Update or complete it.`,
      };
    }
  }

  return {
    status: 'compliant',
    daysOverdue: null,
    reason: '',
  };
}

// ===== CS HYGIENE QUEUE DETECTION =====

export interface CSHygieneCheckInput {
  id: string;
  sentiment: string | null;
  auto_renew: string | null;
  contract_end: string | null;
  mrr: number | null;
  contract_status: string | null;
  qbr_notes: string | null;
}

export interface CSHygieneMissingField {
  field: CSHygieneField;
  label: string;
}

export interface CSHygieneCheckResult {
  isCompliant: boolean;
  missingFields: CSHygieneMissingField[];
}

/**
 * Check if a company has all required CS hygiene fields
 */
export function checkCompanyHygiene(company: CSHygieneCheckInput): CSHygieneCheckResult {
  const missingFields: CSHygieneMissingField[] = [];

  for (const { field, label } of CS_HYGIENE_REQUIRED_FIELDS) {
    const value = company[field as keyof CSHygieneCheckInput];
    // Check for null, undefined, empty string, or zero for numeric fields
    const isEmpty = value === null || value === undefined || value === '';
    // For MRR, also consider 0 as missing
    const isEmptyMrr = field === 'mrr' && (isEmpty || value === 0);

    if (isEmpty || isEmptyMrr) {
      missingFields.push({ field: field as CSHygieneField, label });
    }
  }

  return {
    isCompliant: missingFields.length === 0,
    missingFields,
  };
}

/**
 * Generate a human-readable reason for why a company is in the CS hygiene queue
 */
export function generateCSHygieneReason(missingFields: CSHygieneMissingField[]): string {
  const fieldList = missingFields.map((f) => f.label).join(', ');
  return `Missing required fields: ${fieldList}.`;
}
