import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/client';
import { checkDealActivity } from '@/lib/ai/check-activity';
import { getNotesByDealIdWithAuthor } from '@/lib/hubspot/engagements';
import { getEmailsByDealId } from '@/lib/hubspot/engagements';
import { getCallsByDealId } from '@/lib/hubspot/engagements';
import { getTasksByDealId } from '@/lib/hubspot/engagements';
import { getAllPipelines } from '@/lib/hubspot/pipelines';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const { dealId } = await params;

  const body = await _request.json().catch(() => ({}));
  const force = body.force === true;

  console.log(`[check-activity] Request: dealId=${dealId}, force=${force}`);

  const supabase = await createServerSupabaseClient();

  // 1. Check cache for valid (non-expired) result (skip if force=true)
  if (!force) {
    const { data: cached } = await supabase
      .from('activity_checks')
      .select('*')
      .eq('deal_id', dealId)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (cached) {
      console.log(`[check-activity] Cache hit for ${dealId}`);
      return NextResponse.json({
        verdict: cached.verdict,
        confidence: Number(cached.confidence),
        summary: cached.summary,
        details: cached.details,
        evidence: {
          recentEmails: cached.recent_emails,
          recentCalls: cached.recent_calls,
          recentNotes: cached.recent_notes,
          recentTasks: cached.recent_tasks,
          lastOutreachDate: cached.last_outreach_date,
          outreachTypes: cached.outreach_types || [],
        },
        checkedAt: cached.generated_at,
        cached: true,
      });
    }
  }

  // 2. Fetch deal from Supabase
  const { data: deal, error: dealError } = await supabase
    .from('deals')
    .select('*, owner:owners(*)')
    .eq('id', dealId)
    .single();

  if (dealError || !deal) {
    console.log(`[check-activity] Error: Deal not found - ${dealId}`, dealError);
    return NextResponse.json(
      { error: 'Deal not found' },
      { status: 404 }
    );
  }

  // Resolve stage name
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

  const hubspotDealId = deal.hubspot_deal_id;
  if (!hubspotDealId) {
    return NextResponse.json(
      { error: 'Deal has no HubSpot ID' },
      { status: 400 }
    );
  }

  // Calculate days since activity
  const now = new Date();
  let daysSinceActivity = 999;
  if (deal.last_activity_date) {
    daysSinceActivity = Math.floor(
      (now.getTime() - new Date(deal.last_activity_date).getTime()) / (1000 * 60 * 60 * 24)
    );
  }

  const ownerName = deal.owner
    ? [deal.owner.first_name, deal.owner.last_name].filter(Boolean).join(' ') || deal.owner.email || 'Unknown'
    : 'Unknown';

  // 3. Fetch all engagement types from HubSpot in parallel
  console.log(`[check-activity] Fetching engagements for ${deal.deal_name} (HubSpot ID: ${hubspotDealId})`);

  const [notes, emails, calls, tasks] = await Promise.all([
    getNotesByDealIdWithAuthor(hubspotDealId),
    getEmailsByDealId(hubspotDealId),
    getCallsByDealId(hubspotDealId),
    getTasksByDealId(hubspotDealId),
  ]);

  console.log(`[check-activity] Found: ${notes.length} notes, ${emails.length} emails, ${calls.length} calls, ${tasks.length} tasks`);

  // 4. Run AI analysis
  try {
    const result = await checkDealActivity({
      deal: {
        dealName: deal.deal_name,
        ownerName,
        amount: deal.amount,
        stageName,
        daysSinceActivity,
        nextStep: deal.next_step,
        lastActivityDate: deal.last_activity_date,
      },
      notes: notes.map((n) => ({
        body: n.properties.hs_note_body || '',
        timestamp: n.properties.hs_timestamp,
        authorName: n.authorName,
      })),
      emails: emails.map((e) => ({
        subject: e.subject,
        body: e.body,
        direction: e.direction,
        timestamp: e.timestamp,
        fromEmail: e.fromEmail,
      })),
      calls: calls.map((c) => ({
        title: c.properties.hs_call_title,
        body: c.properties.hs_call_body,
        timestamp: c.properties.hs_timestamp,
        duration: c.properties.hs_call_duration,
        disposition: c.properties.hs_call_disposition,
      })),
      tasks: tasks.map((t) => ({
        subject: t.properties.hs_task_subject,
        status: t.properties.hs_task_status,
        timestamp: t.properties.hs_timestamp,
      })),
    });

    // 5. Cache result with 12h expiry
    const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
    const generatedAt = result.checkedAt;

    const { error: cacheError } = await supabase.from('activity_checks').upsert(
      {
        deal_id: dealId,
        verdict: result.verdict,
        confidence: result.confidence,
        summary: result.summary,
        details: result.details,
        recent_emails: result.evidence.recentEmails,
        recent_calls: result.evidence.recentCalls,
        recent_notes: result.evidence.recentNotes,
        recent_tasks: result.evidence.recentTasks,
        last_outreach_date: result.evidence.lastOutreachDate,
        outreach_types: result.evidence.outreachTypes,
        generated_at: generatedAt,
        expires_at: expiresAt,
      },
      { onConflict: 'deal_id' }
    );

    if (cacheError) {
      console.log(`[check-activity] Cache write failed (non-blocking):`, cacheError.message);
    }

    console.log(`[check-activity] Success: ${deal.deal_name} - verdict=${result.verdict}`);

    return NextResponse.json({
      ...result,
      cached: false,
    });
  } catch (error) {
    console.error(`[check-activity] Error analyzing activity for ${dealId}:`, error);
    return NextResponse.json(
      { error: 'Failed to analyze activity' },
      { status: 500 }
    );
  }
}
