import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createServiceClient } from '@/lib/supabase/client';
import { getWeeklyScorecardData } from '@/lib/scorecard/weekly-scorecard';
import { renderWeeklyScorecardEmail } from '@/lib/scorecard/weekly-email-template';

function verifyCronSecret(request: Request): boolean {
  if (process.env.NODE_ENV === 'development') return true;
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return true;
  return authHeader === `Bearer ${cronSecret}`;
}

/**
 * Get the previous Sunday (for computing "last week").
 * If today is Monday, returns yesterday (Sunday).
 * Otherwise returns the most recent Sunday.
 */
function getPreviousSunday(today: Date = new Date()): Date {
  const dayOfWeek = today.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const daysBack = dayOfWeek === 0 ? 7 : dayOfWeek;
  const prev = new Date(today);
  prev.setDate(prev.getDate() - daysBack);
  return prev;
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
      workflow_name: 'weekly-scorecard',
      status: 'running',
    });

    // Determine week-ending Sunday: use query param for testing, otherwise previous Sunday
    const url = new URL(request.url);
    const weekEndingParam = url.searchParams.get('weekEnding');
    const weekEndingSunday = weekEndingParam
      ? new Date(weekEndingParam + 'T12:00:00-05:00')
      : getPreviousSunday();

    const weekEndStr = weekEndingSunday.toLocaleDateString('en-CA', {
      timeZone: 'America/New_York',
    });

    console.log(`Generating weekly SPIFF scorecard for week ending ${weekEndStr}`);

    // Fetch scorecard data
    const scorecardData = await getWeeklyScorecardData(weekEndingSunday);

    // Render email
    const { subject, html } = renderWeeklyScorecardEmail(scorecardData);

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
          weekEnding: weekEndStr,
          aes: scorecardData.aes.map((ae) => ({
            name: ae.name,
            dailyCalls: ae.dailyCalls.map((d) => ({
              day: d.dayLabel,
              calls: d.calls,
              tier: d.tier,
            })),
            totalCalls: ae.weeklyTotalCalls,
            callTier: ae.weeklyCallTier,
            demos: ae.weeklyDemos,
            demoTier: ae.weeklyDemoTier,
          })),
          emailId: emailResult?.id,
          recipientEmail,
          durationMs: duration,
        },
      })
      .eq('id', workflowId);

    console.log(`Weekly scorecard sent in ${duration}ms to ${recipientEmail}`);

    return NextResponse.json({
      success: true,
      weekEnding: weekEndStr,
      aes: scorecardData.aes.map((ae) => ({
        name: ae.name,
        dailyCalls: ae.dailyCalls.map((d) => ({
          day: d.dayLabel,
          calls: d.calls,
          tier: d.tier,
        })),
        totalCalls: ae.weeklyTotalCalls,
        callTier: ae.weeklyCallTier,
        demos: ae.weeklyDemos,
        demoTier: ae.weeklyDemoTier,
      })),
      emailId: emailResult?.id,
      durationMs: duration,
    });
  } catch (error) {
    console.error('Weekly scorecard failed:', error);

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
        error: 'Weekly scorecard failed',
        details:
          error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
