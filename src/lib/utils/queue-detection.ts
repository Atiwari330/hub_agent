/**
 * Queue detection utilities
 * Logic for determining which deals belong in hygiene and next-step queues
 */

import { getBusinessDaysSinceDate, getDaysUntil, isDateInPast } from './business-days';

// ===== HYGIENE QUEUE CONFIGURATION =====

export const HYGIENE_REQUIRED_FIELDS = [
  { field: 'deal_substage', label: 'Substage' },
  { field: 'close_date', label: 'Close Date' },
  { field: 'amount', label: 'Amount' },
  { field: 'lead_source', label: 'Lead Source' },
  { field: 'products', label: 'Products' },
  { field: 'deal_collaborator', label: 'Collaborator' },
] as const;

export type HygieneField = typeof HYGIENE_REQUIRED_FIELDS[number]['field'];

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
 * Check if a deal has all required hygiene fields
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
