import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { getDealWithNextStepHistory } from '@/lib/hubspot/deals';
import { analyzeNextStep } from '@/lib/ai/analyze-next-step';
import type { NextStepAnalysisResult } from '@/types/next-step-analysis';

interface RouteParams {
  params: Promise<{ ownerId: string; dealId: string }>;
}

/**
 * POST /api/ae/[ownerId]/deals/[dealId]/analyze-next-step
 *
 * Analyze the next step field of a deal using LLM extraction.
 * Fetches fresh data from HubSpot, runs analysis, and stores results.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { ownerId, dealId } = await params;
    const supabase = await createServerSupabaseClient();

    // Verify owner exists
    const { data: owner, error: ownerError } = await supabase
      .from('owners')
      .select('id, hubspot_owner_id')
      .eq('id', ownerId)
      .single();

    if (ownerError || !owner) {
      return NextResponse.json({ error: 'Owner not found' }, { status: 404 });
    }

    // Find the deal in our database
    const { data: dbDeal, error: dbDealError } = await supabase
      .from('deals')
      .select('id, hubspot_deal_id, deal_name, owner_id')
      .eq('id', dealId)
      .single();

    if (dbDealError || !dbDeal) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    }

    // Verify the deal belongs to this owner
    if (dbDeal.owner_id !== ownerId) {
      return NextResponse.json(
        { error: 'Deal does not belong to this owner' },
        { status: 403 }
      );
    }

    // Fetch fresh deal data from HubSpot with next step history
    const hubspotResult = await getDealWithNextStepHistory(dbDeal.hubspot_deal_id);

    if (!hubspotResult) {
      return NextResponse.json(
        { error: 'Failed to fetch deal from HubSpot' },
        { status: 502 }
      );
    }

    const { nextStepValue, nextStepUpdatedAt } = hubspotResult;

    // Run LLM analysis on the next step
    const analysis = await analyzeNextStep({
      nextStepText: nextStepValue,
      referenceDate: new Date(),
    });

    const analyzedAt = new Date().toISOString();

    // Store the analysis results in the database
    const { error: updateError } = await supabase
      .from('deals')
      .update({
        next_step: nextStepValue, // Update with fresh value from HubSpot
        next_step_due_date: analysis.dueDate,
        next_step_action_type: analysis.actionType,
        next_step_status: analysis.status,
        next_step_confidence: analysis.confidence,
        next_step_display_message: analysis.displayMessage,
        next_step_analyzed_at: analyzedAt,
        next_step_analyzed_value: nextStepValue,
        next_step_last_updated_at: nextStepUpdatedAt,
        updated_at: analyzedAt,
      })
      .eq('id', dealId);

    if (updateError) {
      console.error('Error updating deal with analysis:', updateError);
      // Continue anyway - the analysis was successful, just storage failed
    }

    // Build the response
    const result: NextStepAnalysisResult = {
      dealId: dbDeal.id,
      dealName: dbDeal.deal_name,
      nextStep: nextStepValue,
      nextStepUpdatedAt,
      analysis,
      analyzedAt,
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error('Analyze next step API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/ae/[ownerId]/deals/[dealId]/analyze-next-step
 *
 * Get the current analysis for a deal's next step (from cache).
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { ownerId, dealId } = await params;
    const supabase = await createServerSupabaseClient();

    // Verify owner exists
    const { data: owner, error: ownerError } = await supabase
      .from('owners')
      .select('id')
      .eq('id', ownerId)
      .single();

    if (ownerError || !owner) {
      return NextResponse.json({ error: 'Owner not found' }, { status: 404 });
    }

    // Get the deal with analysis data
    const { data: deal, error: dealError } = await supabase
      .from('deals')
      .select(
        `
        id,
        deal_name,
        owner_id,
        next_step,
        next_step_due_date,
        next_step_action_type,
        next_step_status,
        next_step_confidence,
        next_step_display_message,
        next_step_analyzed_at,
        next_step_last_updated_at
      `
      )
      .eq('id', dealId)
      .single();

    if (dealError || !deal) {
      return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    }

    // Verify the deal belongs to this owner
    if (deal.owner_id !== ownerId) {
      return NextResponse.json(
        { error: 'Deal does not belong to this owner' },
        { status: 403 }
      );
    }

    // If no analysis has been run yet
    if (!deal.next_step_analyzed_at) {
      return NextResponse.json({
        dealId: deal.id,
        dealName: deal.deal_name,
        nextStep: deal.next_step,
        nextStepUpdatedAt: deal.next_step_last_updated_at,
        analysis: null,
        analyzedAt: null,
        message: 'No analysis has been run for this deal yet',
      });
    }

    // Return the cached analysis
    const result: NextStepAnalysisResult = {
      dealId: deal.id,
      dealName: deal.deal_name,
      nextStep: deal.next_step,
      nextStepUpdatedAt: deal.next_step_last_updated_at,
      analysis: {
        status: deal.next_step_status,
        dueDate: deal.next_step_due_date,
        confidence: deal.next_step_confidence,
        displayMessage: deal.next_step_display_message || 'No message',
        actionType: deal.next_step_action_type,
      },
      analyzedAt: deal.next_step_analyzed_at,
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error('Get next step analysis API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
