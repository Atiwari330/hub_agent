import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createServiceClient } from '@/lib/supabase/client';
import { getCoDestinyReportData } from '@/lib/co-destiny-report/data';
import { synthesizeCompanySummaries } from '@/lib/co-destiny-report/synthesize';
import { renderCoDestinyEmail } from '@/lib/co-destiny-report/email-template';

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
      workflow_name: 'co-destiny-report',
      status: 'running',
    });

    console.log('Generating Co-Destiny VIP report...');

    // 1. Fetch report data
    const reportData = await getCoDestinyReportData();

    // 2. Run LLM synthesis (unless skipped or no flagged tickets)
    if (
      reportData.companies.length > 0 &&
      process.env.CO_DESTINY_REPORT_SKIP_SYNTHESIS !== 'true'
    ) {
      reportData.companies = await synthesizeCompanySummaries(reportData.companies);
    }

    // 3. Render email
    const { subject, html } = renderCoDestinyEmail(reportData);

    // 4. Send via Resend
    const resendApiKey = process.env.RESEND_API_KEY;
    const recipientEmails = process.env.CO_DESTINY_REPORT_EMAILS;
    const fromEmail = process.env.SCORECARD_FROM_EMAIL || 'onboarding@resend.dev';

    if (!resendApiKey) {
      throw new Error('RESEND_API_KEY not configured');
    }
    if (!recipientEmails) {
      throw new Error('CO_DESTINY_REPORT_EMAILS not configured');
    }

    const recipients = recipientEmails.split(',').map((e) => e.trim()).filter(Boolean);
    const resend = new Resend(resendApiKey);

    const { data: emailResult, error: emailError } = await resend.emails.send({
      from: `Co-Destiny Report <${fromEmail}>`,
      to: recipients,
      subject,
      html,
    });

    if (emailError) {
      throw new Error(`Resend error: ${emailError.message}`);
    }

    const duration = Date.now() - startTime;

    // 5. Log success
    await supabase
      .from('workflow_runs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        result: {
          totalCoDestinyTickets: reportData.totals.totalCoDestinyTickets,
          flaggedTickets: reportData.totals.flaggedTickets,
          companiesCount: reportData.companies.length,
          byUrgency: reportData.totals.byUrgency,
          emailId: emailResult?.id,
          recipients,
          durationMs: duration,
        },
      })
      .eq('id', workflowId);

    console.log(
      `Co-Destiny report sent in ${duration}ms to ${recipients.length} recipients ` +
      `(${reportData.totals.flaggedTickets} flagged / ${reportData.totals.totalCoDestinyTickets} total)`
    );

    return NextResponse.json({
      success: true,
      totalCoDestinyTickets: reportData.totals.totalCoDestinyTickets,
      flaggedTickets: reportData.totals.flaggedTickets,
      companiesCount: reportData.companies.length,
      emailId: emailResult?.id,
      durationMs: duration,
    });
  } catch (error) {
    console.error('Co-Destiny report failed:', error);

    await supabase
      .from('workflow_runs')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error',
      })
      .eq('id', workflowId);

    return NextResponse.json(
      {
        error: 'Co-Destiny report failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
