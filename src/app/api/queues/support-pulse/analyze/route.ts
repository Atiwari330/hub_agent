import { NextResponse } from 'next/server';
import { generateText } from 'ai';
import { checkApiAuth } from '@/lib/auth/api';
import { RESOURCES } from '@/lib/auth';
import { getOpusModel } from '@/lib/ai/provider';
import { fetchSupportPulseData } from '../shared';
import type { SupportPulseResponse, SupportPulseAccount } from '../shared';

// --- Company Context ---
// Edit this constant to provide team roles, escalation paths, and responsibilities.
// This is embedded in the system prompt so the LLM can assign action items to specific roles.
const COMPANY_CONTEXT = `
Team Roles & Responsibilities:
- VP of Support: Owns overall support strategy, escalation authority, SLA accountability
- Support Manager: Day-to-day ticket triage, team workload balancing, process enforcement
- Support Engineers: Front-line ticket resolution, customer communication
- Engineering Team: Bug fixes, feature requests, technical escalations (tracked via Linear)
- Customer Success Managers (CSMs): Account relationship owners, renewal risk mitigation
- Account Executives (AEs): Sales relationship, upsell/expansion conversations

Escalation Paths:
- SLA breach → Support Manager → VP of Support
- Engineering escalation → Linear task → Engineering Lead
- Account risk (high ARR + multiple issues) → CSM + VP of Support
- Recurring product issues → Engineering Lead + Product Manager
`.trim();

// --- Analysis Types ---

export interface SupportPulseAnalysis {
  summary: string;
  prioritizedActions: {
    priority: 'critical' | 'high' | 'medium' | 'low';
    action: string;
    owner: string;
    account: string;
    reasoning: string;
  }[];
  escalations: {
    account: string;
    reason: string;
    escalateTo: string;
  }[];
  meetingRecommendations: {
    purpose: string;
    participants: string;
    urgency: string;
  }[];
  hygieneIssues: string[];
  analyzedAt: string;
}

// --- Prompt Building ---

function buildSystemPrompt(): string {
  return `You are a support operations analyst for Opus Behavioral Health. Your job is to analyze the current state of support tickets across all accounts and produce actionable recommendations.

${COMPANY_CONTEXT}

You will receive a full snapshot of all open support tickets grouped by account, along with summary metrics. Analyze the data holistically — look for patterns across accounts, identify the highest-priority actions, and assign accountability.

Respond in the following structured format. Use the exact section headers and delimiters shown below.

===SUMMARY===
Write a 2-4 sentence executive summary of the current support situation. Highlight the most concerning patterns and overall health.

===ACTIONS===
List prioritized action items, one per line, in this format:
PRIORITY: critical|high|medium|low | ACTION: what needs to be done | OWNER: team role/name | ACCOUNT: account name | REASONING: why this matters

Order from most urgent to least. Include 5-15 action items depending on the data.

===ESCALATIONS===
List recommended escalations, one per line:
ACCOUNT: account name | REASON: why escalation is needed | ESCALATE_TO: who should be notified

Only include if there are genuine escalation-worthy situations. If none, write "None needed at this time."

===MEETINGS===
List recommended meetings, one per line:
PURPOSE: what the meeting should accomplish | PARTICIPANTS: who should attend | URGENCY: immediate|this_week|next_week

Only include meetings that would meaningfully improve the situation. If none, write "No meetings recommended."

===HYGIENE===
List ticket hygiene issues, one per line. Examples: tickets without company association, missing priorities, stale assignments, incorrect ball-in-court, etc. If none, write "No hygiene issues found."

Important guidelines:
- Be specific — reference actual account names and ticket details
- Prioritize by business impact (consider ARR, SLA status, ticket age, escalation count)
- Assign clear ownership to specific roles
- Focus on actionable items, not observations
- High-ARR accounts with issues should generally be higher priority
- SLA breaches require immediate attention
- Engineering escalations that are waiting on us need follow-up
- Tickets without company association are a hygiene concern`;
}

function buildUserPrompt(data: SupportPulseResponse): string {
  const lines: string[] = [];

  // Summary metrics
  lines.push('=== CURRENT SUPPORT SNAPSHOT ===');
  lines.push(`Total Open Tickets: ${data.summary.totalOpenTickets}`);
  lines.push(`Total SLA Breaches: ${data.summary.totalSLABreaches}`);
  lines.push(`Total Engineering Escalations: ${data.summary.totalEscalations}`);
  lines.push(
    `Avg Resolution Time (90d): ${data.summary.avgResolutionHours !== null ? `${data.summary.avgResolutionHours}h` : 'N/A'}`
  );
  lines.push('');

  // Risk distribution
  lines.push('=== RISK DISTRIBUTION ===');
  lines.push(`Critical: ${data.counts.critical} accounts`);
  lines.push(`Warning: ${data.counts.warning} accounts`);
  lines.push(`Watch: ${data.counts.watch} accounts`);
  lines.push(
    `Total accounts with open tickets: ${data.counts.total}`
  );
  lines.push('');

  // Per-account breakdown
  lines.push('=== ACCOUNT DETAILS ===');
  for (const account of data.accounts) {
    lines.push(`--- ${account.companyName || 'No Company'} ---`);
    lines.push(`  Company ID: ${account.companyId || 'N/A'}`);
    lines.push(`  ARR: ${account.arr !== null ? `$${account.arr.toLocaleString()}` : 'Unknown'}`);
    lines.push(`  Risk Level: ${account.riskLevel} (score: ${account.riskScore})`);
    lines.push(`  Open Tickets: ${account.openTicketCount}`);
    lines.push(`  SLA Breaches: ${account.slaBreachCount}`);
    lines.push(`  Oldest Ticket: ${account.oldestOpenTicketDays} days`);
    lines.push(`  Engineering Escalations: ${account.engineeringEscalations}`);
    lines.push(`  Waiting On Us: ${account.waitingOnSupport}`);
    if (account.avgTimeToCloseHours !== null) {
      lines.push(`  Avg Resolution (90d): ${account.avgTimeToCloseHours}h`);
    }
    if (account.alertReasons.length > 0) {
      lines.push(`  Alert Reasons: ${account.alertReasons.join(', ')}`);
    }

    // Per-ticket details
    lines.push('  Tickets:');
    for (const ticket of account.openTickets) {
      lines.push(
        `    - [${ticket.ticketId}] ${ticket.subject || 'No subject'}`
      );
      lines.push(
        `      Source: ${ticket.sourceType || '-'} | Age: ${ticket.ageDays}d | Priority: ${ticket.priority || '-'} | Stage: ${ticket.pipelineStage || '-'}`
      );
      lines.push(
        `      Ball In Court: ${ticket.ballInCourt || '-'} | SLA Breach: ${ticket.hasSLABreach ? 'YES' : 'No'} | Eng Escalation: ${ticket.hasLinearTask ? 'YES (Linear)' : 'No'}`
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}

// --- Response Parsing ---

function parseAnalysisResponse(text: string): Omit<SupportPulseAnalysis, 'analyzedAt'> {
  // Extract sections
  const summaryMatch = text.match(/===SUMMARY===([\s\S]*?)(?====|$)/);
  const actionsMatch = text.match(/===ACTIONS===([\s\S]*?)(?====|$)/);
  const escalationsMatch = text.match(/===ESCALATIONS===([\s\S]*?)(?====|$)/);
  const meetingsMatch = text.match(/===MEETINGS===([\s\S]*?)(?====|$)/);
  const hygieneMatch = text.match(/===HYGIENE===([\s\S]*?)(?====|$)/);

  // Parse summary
  const summary = (summaryMatch?.[1] || 'Analysis completed.').trim();

  // Parse actions
  const prioritizedActions: SupportPulseAnalysis['prioritizedActions'] = [];
  if (actionsMatch) {
    const actionLines = actionsMatch[1].trim().split('\n').filter((l) => l.trim());
    for (const line of actionLines) {
      const priorityM = line.match(/PRIORITY:\s*(critical|high|medium|low)/i);
      const actionM = line.match(/ACTION:\s*([^|]+)/i);
      const ownerM = line.match(/OWNER:\s*([^|]+)/i);
      const accountM = line.match(/ACCOUNT:\s*([^|]+)/i);
      const reasoningM = line.match(/REASONING:\s*(.+)/i);

      if (priorityM && actionM) {
        prioritizedActions.push({
          priority: priorityM[1].toLowerCase() as 'critical' | 'high' | 'medium' | 'low',
          action: actionM[1].trim(),
          owner: ownerM?.[1]?.trim() || 'Unassigned',
          account: accountM?.[1]?.trim() || 'General',
          reasoning: reasoningM?.[1]?.trim() || '',
        });
      }
    }
  }

  // Parse escalations
  const escalations: SupportPulseAnalysis['escalations'] = [];
  if (escalationsMatch) {
    const escText = escalationsMatch[1].trim();
    if (!escText.toLowerCase().includes('none needed')) {
      const escLines = escText.split('\n').filter((l) => l.trim());
      for (const line of escLines) {
        const accountM = line.match(/ACCOUNT:\s*([^|]+)/i);
        const reasonM = line.match(/REASON:\s*([^|]+)/i);
        const escalateM = line.match(/ESCALATE_TO:\s*(.+)/i);

        if (accountM && reasonM) {
          escalations.push({
            account: accountM[1].trim(),
            reason: reasonM[1].trim(),
            escalateTo: escalateM?.[1]?.trim() || 'VP of Support',
          });
        }
      }
    }
  }

  // Parse meetings
  const meetingRecommendations: SupportPulseAnalysis['meetingRecommendations'] = [];
  if (meetingsMatch) {
    const meetText = meetingsMatch[1].trim();
    if (!meetText.toLowerCase().includes('no meetings recommended')) {
      const meetLines = meetText.split('\n').filter((l) => l.trim());
      for (const line of meetLines) {
        const purposeM = line.match(/PURPOSE:\s*([^|]+)/i);
        const participantsM = line.match(/PARTICIPANTS:\s*([^|]+)/i);
        const urgencyM = line.match(/URGENCY:\s*(.+)/i);

        if (purposeM) {
          meetingRecommendations.push({
            purpose: purposeM[1].trim(),
            participants: participantsM?.[1]?.trim() || 'Support team',
            urgency: urgencyM?.[1]?.trim() || 'this_week',
          });
        }
      }
    }
  }

  // Parse hygiene issues
  let hygieneIssues: string[] = [];
  if (hygieneMatch) {
    const hygText = hygieneMatch[1].trim();
    if (!hygText.toLowerCase().includes('no hygiene issues')) {
      hygieneIssues = hygText
        .split('\n')
        .map((l) => l.replace(/^[-•]\s*/, '').trim())
        .filter((l) => l.length > 0);
    }
  }

  return {
    summary,
    prioritizedActions,
    escalations,
    meetingRecommendations,
    hygieneIssues,
  };
}

// --- Route Handler ---

export async function POST() {
  const authResult = await checkApiAuth(RESOURCES.QUEUE_SUPPORT_PULSE);
  if (authResult instanceof NextResponse) return authResult;

  try {
    // Fetch the same data the page displays
    const data = await fetchSupportPulseData();

    // Build prompts
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(data);

    // Call Opus 4.6
    const { text } = await generateText({
      model: getOpusModel(),
      system: systemPrompt,
      prompt: userPrompt,
    });

    // Parse the structured response
    const parsed = parseAnalysisResponse(text);

    const analysis: SupportPulseAnalysis = {
      ...parsed,
      analyzedAt: new Date().toISOString(),
    };

    return NextResponse.json(analysis);
  } catch (error) {
    console.error('Support pulse analysis error:', error);
    return NextResponse.json(
      {
        error: 'Failed to analyze support pulse',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
