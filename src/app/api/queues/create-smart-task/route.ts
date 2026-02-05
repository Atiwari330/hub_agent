import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSmartTask } from '@/lib/hubspot/tasks';
import { createServerSupabaseClient } from '@/lib/supabase/client';

// Request schema
const RequestSchema = z.object({
  hubspotDealId: z.string().optional(),
  hubspotCompanyId: z.string().optional(),
  hubspotOwnerId: z.string().min(1, 'Owner ID is required'),
  title: z.string().min(1, 'Title is required'),
  description: z.string().min(1, 'Description is required'),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
  dealId: z.string().optional(),  // Supabase deal UUID
  companyId: z.string().optional(),  // Supabase company UUID
  queueType: z.enum(['hygiene', 'next-step', 'cs-hygiene', 'other']).optional(),
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

    // Save to Supabase smart_tasks table if we have the necessary IDs
    if (input.queueType && (input.dealId || input.companyId)) {
      try {
        const supabase = await createServerSupabaseClient();
        await supabase.from('smart_tasks').insert({
          deal_id: input.dealId || null,
          company_id: input.companyId || null,
          hubspot_deal_id: input.hubspotDealId || null,
          hubspot_company_id: input.hubspotCompanyId || null,
          hubspot_task_id: result.taskId,
          title: input.title,
          description: input.description,
          priority: input.priority || 'MEDIUM',
          queue_type: input.queueType,
        });
      } catch (dbError) {
        // Log but don't fail the request - HubSpot task was created successfully
        console.error('Failed to save smart task to database:', dbError);
      }
    }

    return NextResponse.json({
      success: true,
      taskId: result.taskId,
      title: input.title,
    });
  } catch (error) {
    console.error('Error creating smart task:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create task' },
      { status: 500 }
    );
  }
}
