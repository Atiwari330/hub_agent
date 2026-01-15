import { AssociationSpecAssociationCategoryEnum } from '@hubspot/api-client/lib/codegen/crm/objects/tasks';
import { getHubSpotClient } from './client';

// Task to Deal association type ID (discovered via API)
const TASK_TO_DEAL_ASSOCIATION_TYPE_ID = 216;

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
 * The task will be assigned to the deal's owner.
 */
export async function createHygieneTask(params: CreateHygieneTaskParams): Promise<CreateTaskResult> {
  const { hubspotDealId, hubspotOwnerId, dealName, missingFields } = params;
  const client = getHubSpotClient();

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
      hubspot_owner_id: hubspotOwnerId,
      // Set due date to 3 days from now
      hs_timestamp: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
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
