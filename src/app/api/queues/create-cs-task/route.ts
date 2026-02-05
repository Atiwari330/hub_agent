import { NextRequest, NextResponse } from 'next/server';
import { createCSHygieneTask } from '@/lib/hubspot/tasks';
import { createServerSupabaseClient } from '@/lib/supabase/client';

interface CreateCSTaskRequest {
  companyId: string;
  hubspotCompanyId: string;
  hubspotOwnerId: string;
  companyName: string;
  missingFields: string[];
}

export async function POST(request: NextRequest) {
  try {
    const body: CreateCSTaskRequest = await request.json();

    // Validate required fields
    if (!body.companyId || !body.hubspotCompanyId || !body.hubspotOwnerId || !body.companyName || !body.missingFields) {
      return NextResponse.json(
        { error: 'Missing required fields: companyId, hubspotCompanyId, hubspotOwnerId, companyName, missingFields' },
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
    const result = await createCSHygieneTask({
      hubspotCompanyId: body.hubspotCompanyId,
      hubspotOwnerId: body.hubspotOwnerId,
      companyName: body.companyName,
      missingFields: body.missingFields,
    });

    // Save record in Supabase for tracking
    const supabase = await createServerSupabaseClient();
    const { error: dbError } = await supabase.from('cs_hygiene_tasks').insert({
      company_id: body.companyId,
      hubspot_company_id: body.hubspotCompanyId,
      hubspot_task_id: result.taskId,
      missing_fields: body.missingFields,
    });

    if (dbError) {
      // Log the error but don't fail the request - the HubSpot task was created successfully
      console.error('Error saving CS hygiene task record to Supabase:', dbError);
    }

    return NextResponse.json({
      success: true,
      taskId: result.taskId,
      message: `Task created successfully for company: ${body.companyName}`,
    });
  } catch (error) {
    console.error('Error creating HubSpot CS hygiene task:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create task' },
      { status: 500 }
    );
  }
}
