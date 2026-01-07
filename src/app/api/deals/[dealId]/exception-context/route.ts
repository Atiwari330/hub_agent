import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { generateExceptionContext, buildExceptionDetail } from '@/lib/ai/generate-exception-context';
import { getAllPipelines } from '@/lib/hubspot/pipelines';
import crypto from 'crypto';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const { dealId } = await params;
  const exceptionType = request.nextUrl.searchParams.get('type');

  console.log(`[exception-context] Request: dealId=${dealId}, type=${exceptionType}`);

  if (!exceptionType) {
    console.log(`[exception-context] Error: Missing type parameter`);
    return NextResponse.json(
      { error: 'Missing type parameter' },
      { status: 400 }
    );
  }

  const supabase = await createServerSupabaseClient();

  // 1. Check cache for valid (non-expired) context
  const { data: cached } = await supabase
    .from('exception_contexts')
    .select('*')
    .eq('deal_id', dealId)
    .eq('exception_type', exceptionType)
    .gt('expires_at', new Date().toISOString())
    .single();

  if (cached) {
    console.log(`[exception-context] Cache hit for ${dealId}`);
    return NextResponse.json({
      diagnosis: cached.diagnosis,
      recentActivity: cached.recent_activity,
      recommendedAction: cached.recommended_action,
      urgency: cached.urgency,
      confidence: Number(cached.confidence),
      cached: true,
      generatedAt: cached.generated_at,
    });
  }

  // 2. Gather context data
  const { data: deal, error: dealError } = await supabase
    .from('deals')
    .select('*, owner:owners(*)')
    .eq('id', dealId)
    .single();

  if (dealError || !deal) {
    console.log(`[exception-context] Error: Deal not found - ${dealId}`, dealError);
    return NextResponse.json(
      { error: 'Deal not found' },
      { status: 404 }
    );
  }

  // Get stage name from pipeline mapping
  let stageName = deal.deal_stage || 'Unknown';
  try {
    const pipelines = await getAllPipelines();
    for (const p of pipelines) {
      const stage = p.stages.find((s: { id: string }) => s.id === deal.deal_stage);
      if (stage) {
        stageName = stage.label;
        break;
      }
    }
  } catch (error) {
    console.warn('Failed to lookup stage name:', error);
  }

  // Get cached notes for this deal
  const { data: notes } = await supabase
    .from('deal_notes')
    .select('*')
    .eq('deal_id', dealId)
    .order('note_timestamp', { ascending: false })
    .limit(5);

  // Get most recent sentiment analysis
  const { data: sentiment } = await supabase
    .from('sentiment_analyses')
    .select('sentiment_score, summary')
    .eq('deal_id', dealId)
    .order('analyzed_at', { ascending: false })
    .limit(1)
    .single();

  // Calculate timing metrics
  const now = new Date();

  // Days in stage - use the appropriate stage entry timestamp
  let daysInStage = 0;
  const stageEntryDate = deal.sql_entered_at || deal.demo_scheduled_entered_at ||
    deal.demo_completed_entered_at || deal.hubspot_created_at;
  if (stageEntryDate) {
    daysInStage = Math.floor((now.getTime() - new Date(stageEntryDate).getTime()) / (1000 * 60 * 60 * 24));
  }

  // Days since last activity
  let daysSinceActivity = 999;
  if (deal.last_activity_date) {
    daysSinceActivity = Math.floor(
      (now.getTime() - new Date(deal.last_activity_date).getTime()) / (1000 * 60 * 60 * 24)
    );
  }

  // Build exception detail string
  const exceptionDetail = buildExceptionDetail(exceptionType, deal, daysSinceActivity);

  console.log(`[exception-context] Generating AI context for ${deal.deal_name}`);

  try {
    // 3. Generate AI context
    const context = await generateExceptionContext({
      deal: {
        dealName: deal.deal_name,
        amount: deal.amount,
        stageName,
        closeDate: deal.close_date,
        daysInStage,
        daysSinceActivity,
        nextStep: deal.next_step,
        nextStepDueDate: deal.next_step_due_date,
      },
      exceptionType,
      exceptionDetail,
      notes: (notes || []).map((n) => ({
        body: n.note_body || '',
        timestamp: n.note_timestamp,
        authorName: n.author_name,
      })),
      sentiment: sentiment
        ? {
            score: sentiment.sentiment_score,
            summary: sentiment.summary,
          }
        : null,
    });

    // 4. Cache for 24 hours
    const notesHash = crypto
      .createHash('md5')
      .update((notes || []).map((n) => n.hubspot_note_id).join(','))
      .digest('hex');

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const generatedAt = new Date().toISOString();

    const { error: cacheError } = await supabase.from('exception_contexts').upsert(
      {
        deal_id: dealId,
        exception_type: exceptionType,
        diagnosis: context.diagnosis,
        recent_activity: context.recentActivity,
        recommended_action: context.recommendedAction,
        urgency: context.urgency,
        confidence: context.confidence,
        generated_at: generatedAt,
        expires_at: expiresAt,
        notes_hash: notesHash,
      },
      { onConflict: 'deal_id,exception_type' }
    );

    if (cacheError) {
      console.log(`[exception-context] Cache write failed (non-blocking):`, cacheError.message);
    }

    console.log(`[exception-context] Success: ${deal.deal_name} - urgency=${context.urgency}`);

    return NextResponse.json({
      ...context,
      cached: false,
      generatedAt,
    });
  } catch (error) {
    console.error(`[exception-context] Error generating context for ${dealId}:`, error);
    return NextResponse.json(
      { error: 'Failed to generate analysis' },
      { status: 500 }
    );
  }
}
