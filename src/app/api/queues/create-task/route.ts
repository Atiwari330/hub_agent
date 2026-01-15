import { NextRequest, NextResponse } from 'next/server';
import { createHygieneTask } from '@/lib/hubspot/tasks';
import { createServerSupabaseClient } from '@/lib/supabase/client';

interface CreateTaskRequest {
  dealId: string;
  hubspotDealId: string;
  hubspotOwnerId: string;
  dealName: string;
  missingFields: string[];
}

export async function POST(request: NextRequest) {
  try {
    const body: CreateTaskRequest = await request.json();

    // Validate required fields
    if (!body.dealId || !body.hubspotDealId || !body.hubspotOwnerId || !body.dealName || !body.missingFields) {
      return NextResponse.json(
        { error: 'Missing required fields: dealId, hubspotDealId, hubspotOwnerId, dealName, missingFields' },
        { status: 400 }
      );
    }

    if (body.missingFields.length === 0) {
      return NextResponse.json(
        { error: 'No missing fields specified' },
        { status: 400 }
      );
    }

    // Create the HubSpot task
    const result = await createHygieneTask({
      hubspotDealId: body.hubspotDealId,
      hubspotOwnerId: body.hubspotOwnerId,
      dealName: body.dealName,
      missingFields: body.missingFields,
    });

    // Save record in Supabase for tracking
    const supabase = await createServerSupabaseClient();
    const { error: dbError } = await supabase.from('hygiene_tasks').insert({
      deal_id: body.dealId,
      hubspot_deal_id: body.hubspotDealId,
      hubspot_task_id: result.taskId,
      missing_fields: body.missingFields,
    });

    if (dbError) {
      // Log the error but don't fail the request - the HubSpot task was created successfully
      console.error('Error saving hygiene task record to Supabase:', dbError);
    }

    return NextResponse.json({
      success: true,
      taskId: result.taskId,
      message: `Task created successfully for deal: ${body.dealName}`,
    });
  } catch (error) {
    console.error('Error creating HubSpot task:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create task' },
      { status: 500 }
    );
  }
}
