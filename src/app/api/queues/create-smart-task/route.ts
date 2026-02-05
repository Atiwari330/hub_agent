import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSmartTask } from '@/lib/hubspot/tasks';

// Request schema
const RequestSchema = z.object({
  hubspotDealId: z.string().optional(),
  hubspotCompanyId: z.string().optional(),
  hubspotOwnerId: z.string().min(1, 'Owner ID is required'),
  title: z.string().min(1, 'Title is required'),
  description: z.string().min(1, 'Description is required'),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
}).refine(
  (data) => data.hubspotDealId || data.hubspotCompanyId,
  { message: 'Either hubspotDealId or hubspotCompanyId is required' }
);

export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Validate request body
    const parseResult = RequestSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parseResult.error.issues },
        { status: 400 }
      );
    }

    const input = parseResult.data;

    // Create the task in HubSpot
    const result = await createSmartTask({
      hubspotDealId: input.hubspotDealId,
      hubspotCompanyId: input.hubspotCompanyId,
      hubspotOwnerId: input.hubspotOwnerId,
      title: input.title,
      description: input.description,
      priority: input.priority,
    });

    return NextResponse.json({
      success: true,
      taskId: result.taskId,
    });
  } catch (error) {
    console.error('Error creating smart task:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create task' },
      { status: 500 }
    );
  }
}
