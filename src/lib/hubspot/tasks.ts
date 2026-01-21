import { AssociationSpecAssociationCategoryEnum } from '@hubspot/api-client/lib/codegen/crm/objects/tasks';
import { getHubSpotClient } from './client';
import { getOwnerById, getOwnerByEmail } from './owners';
import { SYNC_CONFIG } from './sync-config';

// Task to Deal association type ID (discovered via API)
const TASK_TO_DEAL_ASSOCIATION_TYPE_ID = 216;

/**
 * Resolves the actual task assignee based on override configuration.
 * If the deal owner has an override configured (e.g., Adi Tiwari -> D. Lacap),
 * returns the override assignee's HubSpot owner ID.
 * Otherwise, returns the original owner ID.
 */
export async function resolveTaskAssignee(hubspotOwnerId: string): Promise<string> {
  // Look up the owner to get their email
  const owner = await getOwnerById(hubspotOwnerId);
  if (!owner?.email) {
    // Can't look up owner, fall back to original ID
    return hubspotOwnerId;
  }

  // Check if there's an override for this owner
  const overrideEmail = SYNC_CONFIG.TASK_ASSIGNMENT_OVERRIDES[owner.email.toLowerCase()];
  if (!overrideEmail) {
    // No override configured
    return hubspotOwnerId;
  }

  // Look up the override assignee
  const overrideOwner = await getOwnerByEmail(overrideEmail);
  if (!overrideOwner) {
    console.warn(`Task assignment override configured for ${owner.email} -> ${overrideEmail}, but override owner not found in HubSpot`);
    return hubspotOwnerId;
  }

  console.log(`Task assignment override: ${owner.email} -> ${overrideEmail} (HubSpot ID: ${hubspotOwnerId} -> ${overrideOwner.id})`);
  return overrideOwner.id;
}

interface CreateHygieneTaskParams {
  hubspotDealId: string;
  hubspotOwnerId: string;
  dealName: string;
  missingFields: string[];
}

interface CreateTaskResult {
  taskId: string;
  success: boolean;
}

/**
 * Creates a HubSpot task for deal hygiene and associates it with the deal.
 * The task will be assigned based on override configuration (or to the deal's owner if no override).
 */
export async function createHygieneTask(params: CreateHygieneTaskParams): Promise<CreateTaskResult> {
  const { hubspotDealId, hubspotOwnerId, dealName, missingFields } = params;
  const client = getHubSpotClient();

  // Resolve the actual task assignee (may be overridden)
  const assigneeOwnerId = await resolveTaskAssignee(hubspotOwnerId);

  // Build task body with missing fields
  const missingFieldsList = missingFields.map((f) => `• ${f}`).join('\n');
  const taskBody = `Please update the following missing fields for this deal:\n\n${missingFieldsList}\n\nThis helps ensure accurate pipeline reporting and forecasting.`;

  // Create the task
  const taskResponse = await client.crm.objects.tasks.basicApi.create({
    properties: {
      hs_task_subject: `Deal Hygiene: ${dealName}`,
      hs_task_body: taskBody,
      hs_task_status: 'NOT_STARTED',
      hs_task_priority: 'MEDIUM',
      hs_task_type: 'TODO',
      hubspot_owner_id: assigneeOwnerId,
      // Set due date to tomorrow
      hs_timestamp: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    },
    associations: [
      {
        to: { id: hubspotDealId },
        types: [
          {
            associationCategory: AssociationSpecAssociationCategoryEnum.HubspotDefined,
            associationTypeId: TASK_TO_DEAL_ASSOCIATION_TYPE_ID,
          },
        ],
      },
    ],
  });

  return {
    taskId: taskResponse.id,
    success: true,
  };
}

/**
 * Creates multiple hygiene tasks in batch.
 * Returns results for each task creation attempt.
 */
export async function createHygieneTasksBatch(
  tasks: CreateHygieneTaskParams[]
): Promise<{ results: CreateTaskResult[]; errors: { index: number; error: string }[] }> {
  const results: CreateTaskResult[] = [];
  const errors: { index: number; error: string }[] = [];

  for (let i = 0; i < tasks.length; i++) {
    try {
      const result = await createHygieneTask(tasks[i]);
      results.push(result);
    } catch (err) {
      errors.push({
        index: i,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return { results, errors };
}

interface CreateNextStepTaskParams {
  hubspotDealId: string;
  hubspotOwnerId: string;
  dealName: string;
  taskType: 'missing' | 'overdue';
  nextStepText?: string | null;
  daysOverdue?: number | null;
}

/**
 * Creates a HubSpot task for next step issues (missing or overdue).
 * The task will be assigned based on override configuration (or to the deal's owner if no override).
 */
export async function createNextStepTask(params: CreateNextStepTaskParams): Promise<CreateTaskResult> {
  const { hubspotDealId, hubspotOwnerId, dealName, taskType, nextStepText, daysOverdue } = params;
  const client = getHubSpotClient();

  // Resolve the actual task assignee (may be overridden)
  const assigneeOwnerId = await resolveTaskAssignee(hubspotOwnerId);

  // Build task body based on type
  let taskSubject: string;
  let taskBody: string;

  if (taskType === 'missing') {
    taskSubject = `Next Step Required: ${dealName}`;
    taskBody = `This deal is missing a defined next step.\n\nPlease add a next step with a due date to keep this deal progressing through the pipeline.\n\nGood next steps are specific and actionable (e.g., "Send proposal by Friday", "Schedule follow-up call").`;
  } else {
    taskSubject = `Overdue Next Step: ${dealName}`;
    taskBody = `The next step for this deal is overdue by ${daysOverdue || 0} day${daysOverdue !== 1 ? 's' : ''}.\n\nOriginal next step: "${nextStepText || 'Not specified'}"\n\nPlease complete this next step or update it with a new action and due date.`;
  }

  // Create the task
  const taskResponse = await client.crm.objects.tasks.basicApi.create({
    properties: {
      hs_task_subject: taskSubject,
      hs_task_body: taskBody,
      hs_task_status: 'NOT_STARTED',
      hs_task_priority: taskType === 'overdue' ? 'HIGH' : 'MEDIUM',
      hs_task_type: 'TODO',
      hubspot_owner_id: assigneeOwnerId,
      // Set due date to tomorrow
      hs_timestamp: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    },
    associations: [
      {
        to: { id: hubspotDealId },
        types: [
          {
            associationCategory: AssociationSpecAssociationCategoryEnum.HubspotDefined,
            associationTypeId: TASK_TO_DEAL_ASSOCIATION_TYPE_ID,
          },
        ],
      },
    ],
  });

  return {
    taskId: taskResponse.id,
    success: true,
  };
}
