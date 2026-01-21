import { NextRequest, NextResponse } from 'next/server';
import { createOverdueTaskReminder } from '@/lib/hubspot/tasks';
import { createServerSupabaseClient } from '@/lib/supabase/client';

interface OverdueTaskDetail {
  subject: string;
  daysOverdue: number;
}

interface CreateOverdueReminderRequest {
  dealId: string;
  hubspotDealId: string;
  hubspotOwnerId: string;
  dealName: string;
  overdueTasks: OverdueTaskDetail[];
  oldestOverdueDays: number;
}

export async function POST(request: NextRequest) {
  try {
    const body: CreateOverdueReminderRequest = await request.json();

    // Validate required fields
    if (!body.dealId || !body.hubspotDealId || !body.hubspotOwnerId || !body.dealName || !body.overdueTasks) {
      return NextResponse.json(
        { error: 'Missing required fields: dealId, hubspotDealId, hubspotOwnerId, dealName, overdueTasks' },
        { status: 400 }
      );
    }

    if (!Array.isArray(body.overdueTasks) || body.overdueTasks.length === 0) {
      return NextResponse.json(
        { error: 'overdueTasks must be a non-empty array' },
        { status: 400 }
      );
    }

    // Create the HubSpot task
    const result = await createOverdueTaskReminder({
      hubspotDealId: body.hubspotDealId,
      hubspotOwnerId: body.hubspotOwnerId,
      dealName: body.dealName,
      overdueTasks: body.overdueTasks,
    });

    // Save record in Supabase for tracking
    const supabase = await createServerSupabaseClient();
    const { error: dbError } = await supabase.from('overdue_task_reminders').insert({
      deal_id: body.dealId,
      hubspot_deal_id: body.hubspotDealId,
      hubspot_task_id: result.taskId,
      overdue_task_count: body.overdueTasks.length,
      oldest_overdue_days: body.oldestOverdueDays || 0,
    });

    if (dbError) {
      // Log the error but don't fail the request - the HubSpot task was created successfully
      console.error('Error saving overdue task reminder record to Supabase:', dbError);
    }

    return NextResponse.json({
      success: true,
      taskId: result.taskId,
      message: `Reminder task created successfully for deal: ${body.dealName}`,
    });
  } catch (error) {
    console.error('Error creating overdue task reminder in HubSpot:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create reminder' },
      { status: 500 }
    );
  }
}
