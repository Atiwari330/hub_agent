import { NextRequest, NextResponse } from 'next/server';
import { createNextStepTask } from '@/lib/hubspot/tasks';
import { createServerSupabaseClient } from '@/lib/supabase/client';

interface CreateNextStepTaskRequest {
  dealId: string;
  hubspotDealId: string;
  hubspotOwnerId: string;
  dealName: string;
  taskType: 'missing' | 'overdue';
  nextStepText?: string | null;
  daysOverdue?: number | null;
}

export async function POST(request: NextRequest) {
  try {
    const body: CreateNextStepTaskRequest = await request.json();

    // Validate required fields
    if (!body.dealId || !body.hubspotDealId || !body.hubspotOwnerId || !body.dealName || !body.taskType) {
      return NextResponse.json(
        { error: 'Missing required fields: dealId, hubspotDealId, hubspotOwnerId, dealName, taskType' },
        { status: 400 }
      );
    }

    if (body.taskType !== 'missing' && body.taskType !== 'overdue') {
      return NextResponse.json(
        { error: 'taskType must be "missing" or "overdue"' },
        { status: 400 }
      );
    }

    // Create the HubSpot task
    const result = await createNextStepTask({
      hubspotDealId: body.hubspotDealId,
      hubspotOwnerId: body.hubspotOwnerId,
      dealName: body.dealName,
      taskType: body.taskType,
      nextStepText: body.nextStepText,
      daysOverdue: body.daysOverdue,
    });

    // Save record in Supabase for tracking
    const supabase = await createServerSupabaseClient();
    const { error: dbError } = await supabase.from('next_step_tasks').insert({
      deal_id: body.dealId,
      hubspot_deal_id: body.hubspotDealId,
      hubspot_task_id: result.taskId,
      task_type: body.taskType,
      next_step_text: body.nextStepText || null,
      days_overdue: body.daysOverdue || null,
    });

    if (dbError) {
      // Log the error but don't fail the request - the HubSpot task was created successfully
      console.error('Error saving next step task record to Supabase:', dbError);
    }

    return NextResponse.json({
      success: true,
      taskId: result.taskId,
      message: `Task created successfully for deal: ${body.dealName}`,
    });
  } catch (error) {
    console.error('Error creating next step HubSpot task:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create task' },
      { status: 500 }
    );
  }
}
