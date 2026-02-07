import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createServiceClient } from '@/lib/supabase/client';
import {
  getDailyScorecardData,
  getPreviousBusinessDay,
} from '@/lib/scorecard/daily-scorecard';
import { renderScorecardEmail } from '@/lib/scorecard/email-template';

function verifyCronSecret(request: Request): boolean {
  if (process.env.NODE_ENV === 'development') return true;
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return true;
  return authHeader === `Bearer ${cronSecret}`;
}

export async function GET(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const workflowId = crypto.randomUUID();

  try {
    const startTime = Date.now();

    await supabase.from('workflow_runs').insert({
      id: workflowId,
      workflow_name: 'daily-scorecard',
      status: 'running',
    });

    // Determine report date: use query param for testing, otherwise previous business day
    const url = new URL(request.url);
    const dateParam = url.searchParams.get('date');
    const reportDate = dateParam
      ? new Date(dateParam + 'T12:00:00-05:00') // Parse as noon ET to avoid timezone issues
      : getPreviousBusinessDay();

    console.log(
      `Generating SPIFF scorecard for ${reportDate.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })}`
    );

    // Fetch scorecard data
    const scorecardData = await getDailyScorecardData(reportDate);

    // Render email
    const { subject, html } = renderScorecardEmail(scorecardData);

    // Send email via Resend
    const resendApiKey = process.env.RESEND_API_KEY;
    const recipientEmail = process.env.SCORECARD_RECIPIENT_EMAIL;
    const fromEmail =
      process.env.SCORECARD_FROM_EMAIL || 'onboarding@resend.dev';

    if (!resendApiKey) {
      throw new Error('RESEND_API_KEY not configured');
    }
    if (!recipientEmail) {
      throw new Error('SCORECARD_RECIPIENT_EMAIL not configured');
    }

    const resend = new Resend(resendApiKey);

    const { data: emailResult, error: emailError } = await resend.emails.send({
      from: `SPIFF Scorecard <${fromEmail}>`,
      to: [recipientEmail],
      subject,
      html,
    });

    if (emailError) {
      throw new Error(`Resend error: ${emailError.message}`);
    }

    const duration = Date.now() - startTime;

    // Log success
    await supabase
      .from('workflow_runs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        result: {
          reportDate: reportDate.toLocaleDateString('en-CA', {
            timeZone: 'America/New_York',
          }),
          aes: scorecardData.aes.map((ae) => ({
            name: ae.name,
            calls: ae.qualifiedCalls,
            tier: ae.callTier,
            demos: ae.demosYesterday,
          })),
          emailId: emailResult?.id,
          recipientEmail,
          durationMs: duration,
        },
      })
      .eq('id', workflowId);

    console.log(`Scorecard sent in ${duration}ms to ${recipientEmail}`);

    return NextResponse.json({
      success: true,
      reportDate: reportDate.toLocaleDateString('en-CA', {
        timeZone: 'America/New_York',
      }),
      aes: scorecardData.aes.map((ae) => ({
        name: ae.name,
        calls: ae.qualifiedCalls,
        tier: ae.callTier,
        demos: ae.demosYesterday,
      })),
      emailId: emailResult?.id,
      durationMs: duration,
    });
  } catch (error) {
    console.error('Daily scorecard failed:', error);

    await supabase
      .from('workflow_runs')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        error:
          error instanceof Error ? error.message : 'Unknown error',
      })
      .eq('id', workflowId);

    return NextResponse.json(
      {
        error: 'Scorecard failed',
        details:
          error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
