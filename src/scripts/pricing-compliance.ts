import { config } from 'dotenv';
config({ path: '.env.local' });

import { getDealsByOwnerId, getDealById } from '../lib/hubspot/deals';
import { getOwnerByEmail, listAllOwners } from '../lib/hubspot/owners';
import { getAllPipelines } from '../lib/hubspot/pipelines';
import { SALES_PIPELINE_ID, TRACKED_STAGES } from '../lib/hubspot/stage-mappings';
import { SALES_PIPELINE_STAGES } from '../lib/hubspot/stage-config';
import { SYNC_CONFIG } from '../lib/hubspot/sync-config';
import { batchFetchDealEngagements } from '../lib/hubspot/batch-engagements';
import {
  getNotesByDealIdWithAuthor,
  getMeetingsByDealId,
  getEmailsByDealId,
} from '../lib/hubspot/engagements';
import { generateText } from 'ai';
import { createDeepSeek } from '@ai-sdk/deepseek';
import fs from 'fs';
import type { HubSpotDeal } from '../types/hubspot';
import type { HubSpotEmail, HubSpotMeeting } from '../lib/hubspot/engagements';
import type { HubSpotNoteWithAuthor } from '../types/exception-context';

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

function getPricingModel() {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) throw new Error('AI_GATEWAY_API_KEY is not configured');
  const deepseek = createDeepSeek({ apiKey, baseURL: 'https://ai-gateway.vercel.sh/v1' });
  return deepseek('deepseek/deepseek-v3.2');
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEMO_COMPLETED_STAGE_ID = SALES_PIPELINE_STAGES.DEMO_COMPLETED.id;
const DEMO_SCHEDULED_STAGE_ID = SALES_PIPELINE_STAGES.DEMO_SCHEDULED.id;

// Only analyze deals with demo_completed_entered_at on or after this date
const POLICY_START_DATE = '2026-03-30T00:00:00.000Z';

// 24-hour compliance window
const COMPLIANCE_WINDOW_HOURS = 24;

// Target AEs (Chris and Jack only)
const PRICING_TARGET_EMAILS = [
  'cgarraffa@opusbehavioral.com',
  'jrice@opusbehavioral.com',
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ComplianceStatus = 'COMPLIANT' | 'PENDING' | 'EXEMPT' | 'NON_COMPLIANT' | 'STALE_STAGE';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';
export type DemoDetectedVia = 'stage_move' | 'meeting_engagement';

export interface PricingComplianceContext {
  dealId: string;
  dealName: string;
  amount: number | null;
  stageName: string;
  ownerName: string;
  ownerId: string;
  demoCompletedAt: string;       // ISO timestamp of demo completion
  demoDetectedVia: DemoDetectedVia;
  emails: HubSpotEmail[];
  notes: HubSpotNoteWithAuthor[];
  meetings: HubSpotMeeting[];
}

export interface PricingComplianceResult {
  dealId: string;
  dealName: string;
  amount: number | null;
  stageName: string;
  ownerName: string;
  ownerId: string;
  demoCompletedAt: string;
  demoDetectedVia: DemoDetectedVia;
  pricingSentAt: string | null;
  hoursToPricing: number | null;
  exemptionNotedAt: string | null;
  complianceStatus: ComplianceStatus;
  pricingEvidence: string | null;
  exemptionReason: string | null;
  analysisRationale: string;
  executiveSummary: string;
  riskLevel: RiskLevel;
  error?: string;
}

// ---------------------------------------------------------------------------
// System prompts
// ---------------------------------------------------------------------------

const EVIDENCE_SYSTEM_PROMPT = `You are analyzing post-demo correspondence for a deal at a healthcare SaaS company (behavioral health EHR and RCM).

CONTEXT: The company has a policy that Account Executives must send pricing in writing within 24 hours of the first demo. If they cannot send pricing, they must add a note to the deal explaining why.

YOUR JOB: Examine all emails and notes that occurred after the demo, and determine:
1. Was pricing sent in writing (email) to the prospect?
2. Was an exemption/reason noted on the deal for why pricing was NOT sent?

WHAT COUNTS AS "PRICING SENT IN WRITING":
- An email containing specific dollar amounts, rate cards, fee schedules, or pricing tables
- An email with a proposal or quote attached (look for language like "attached proposal", "pricing proposal", "see attached quote")
- An email explicitly discussing pricing, fees, costs, rates, or subscription amounts
- An email referencing a sent pricing document (e.g., "I've sent over the pricing", "pricing is attached")
- Even a brief email like "Per our discussion, here are the rates..." counts

WHAT DOES NOT COUNT:
- A generic follow-up email with no pricing content
- An email saying "I'll send pricing soon" (that's a promise, not delivery)
- Internal notes about pricing (the pricing must be sent TO the prospect)
- Meeting confirmations or scheduling emails

WHAT COUNTS AS AN EXEMPTION NOTE:
- A note on the deal explaining why pricing was not sent (e.g., "Prospect needs census data before we can price", "Waiting on facility details to build custom quote", "Prospect requested pricing next week after board meeting")
- The note must provide a BUSINESS REASON, not just "will send later"
- The note must be written by the AE (not an automated system note)

Output EXACTLY (use these labels, one per line):
PRICING_FOUND: <YES|NO>
PRICING_EMAIL_DATE: <YYYY-MM-DDTHH:MM:SS or N/A>
PRICING_EMAIL_SUBJECT: <subject line or N/A>
PRICING_DESCRIPTION: <1 sentence describing what pricing was sent, or N/A>
EXEMPTION_FOUND: <YES|NO>
EXEMPTION_REASON: <1-2 sentence reason from the note, or N/A>
EXEMPTION_NOTE_DATE: <YYYY-MM-DDTHH:MM:SS or N/A>`;

const VERDICT_SYSTEM_PROMPT = `You are a compliance reviewer assessing whether an Account Executive followed the company's pricing policy.

THE POLICY: AEs must send pricing in writing within 24 hours of the first demo for a deal. If they cannot send pricing, they must notate a reason on the deal.

You will receive:
- The demo completion timestamp (when the demo occurred)
- The evidence extraction (whether pricing was found, whether an exemption was noted)
- The 24-hour deadline

COMPLIANCE_STATUS (exactly one):
- COMPLIANT: Pricing was sent in writing within 24 hours of the demo
- EXEMPT: Pricing was NOT sent, but a valid business reason was noted on the deal within a reasonable time
- PENDING: The 24-hour window has NOT yet elapsed and no pricing/exemption found yet — give the AE time
- NON_COMPLIANT: 24+ hours have passed, no pricing sent, and no valid exemption noted

RISK_LEVEL:
- LOW: Compliant or exempt with clear documentation
- MEDIUM: Exempt but reason is thin, or pricing sent but slightly late (24-36h)
- HIGH: Non-compliant, or pending with most of the 24h window already elapsed (20+ hours)

HOURS_TO_PRICING:
- If pricing was sent, calculate the hours between demo completion and the pricing email
- If not sent, output N/A

Be fair but firm. The policy is clear: 24 hours, in writing.

Output EXACTLY:
COMPLIANCE_STATUS: <COMPLIANT|PENDING|EXEMPT|NON_COMPLIANT>
HOURS_TO_PRICING: <number or N/A>
RISK_LEVEL: <LOW|MEDIUM|HIGH>
RATIONALE: <2-3 sentences explaining the verdict>`;

const EXEC_SUMMARY_SYSTEM_PROMPT = `Write a 1-2 sentence executive summary of this deal's pricing compliance that a CEO can scan in 3 seconds.

Include: the status, the key fact (e.g., "pricing sent in 4 hours" or "no pricing after 3 days"), and any action needed.

Be blunt and direct. "Pricing sent same day — compliant." is better than "The account executive demonstrated timely adherence to the pricing policy."

If non-compliant, say so clearly: "No pricing sent 72 hours post-demo. No reason noted."
If exempt, state the reason briefly: "Pricing deferred — waiting on census data from prospect."
If pending, state remaining time: "Demo was 6 hours ago. 18 hours remaining to send pricing."

Do NOT repeat the deal name or amount — those are displayed separately.
Do NOT use bullet points or headers. Write in plain, direct sentences.

Output ONLY the summary text, nothing else.`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(text: string | null | undefined, maxLen: number): string {
  if (!text) return '';
  const clean = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen) + '...';
}

function formatCurrency(amount: number | null): string {
  if (amount === null) return 'Not set';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);
}

function isOutboundEmail(email: HubSpotEmail): boolean {
  return (
    email.direction === 'OUTGOING_EMAIL' ||
    (email.direction === 'EMAIL' && !!email.fromEmail?.endsWith('@opusbehavioral.com'))
  );
}

function hoursBetween(a: string, b: string): number {
  return Math.abs(new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60);
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function buildEvidenceUserPrompt(ctx: PricingComplianceContext): string {
  const demoDate = new Date(ctx.demoCompletedAt);
  const deadline = new Date(demoDate.getTime() + COMPLIANCE_WINDOW_HOURS * 60 * 60 * 1000);
  const now = new Date();
  const hoursElapsed = (now.getTime() - demoDate.getTime()) / (1000 * 60 * 60);

  let prompt = `DEAL METADATA:
- Deal Name: ${ctx.dealName}
- Amount: ${formatCurrency(ctx.amount)}
- Stage: ${ctx.stageName}
- AE: ${ctx.ownerName}
- Demo Completed: ${ctx.demoCompletedAt.split('T')[0]} ${ctx.demoCompletedAt.split('T')[1]?.slice(0, 5) || ''}
- Demo Detected Via: ${ctx.demoDetectedVia}
- 24-Hour Deadline: ${deadline.toISOString().split('T')[0]} ${deadline.toISOString().split('T')[1]?.slice(0, 5)}
- Hours Since Demo: ${hoursElapsed.toFixed(1)}
- Today's Date: ${now.toISOString().split('T')[0]}`;

  // Emails (only post-demo, focus on outbound)
  const postDemoEmails = ctx.emails.filter(
    (e) => e.timestamp && new Date(e.timestamp) >= demoDate
  );
  if (postDemoEmails.length > 0) {
    prompt += `\n\nPOST-DEMO EMAILS (${postDemoEmails.length}):`;
    for (const email of postDemoEmails) {
      const date = email.timestamp?.split('T')[0] || 'unknown';
      const time = email.timestamp?.split('T')[1]?.slice(0, 5) || '';
      const dir = isOutboundEmail(email) ? 'OUTBOUND' : 'INBOUND';
      const from = email.fromEmail || 'unknown';
      const subject = email.subject || 'No subject';
      const body = truncate(email.body, 500);
      prompt += `\n[${date} ${time}] ${dir} from ${from} — "${subject}"`;
      if (body) prompt += `\n  ${body}`;
    }
  } else {
    prompt += '\n\nPOST-DEMO EMAILS: None';
  }

  // Also include recent pre-demo emails (AE might have sent pricing before moving stage)
  const preDemoEmails = ctx.emails.filter(
    (e) => e.timestamp && new Date(e.timestamp) < demoDate
  ).slice(-5); // last 5 pre-demo emails
  if (preDemoEmails.length > 0) {
    prompt += `\n\nRECENT PRE-DEMO EMAILS (${preDemoEmails.length}, for context — AE may have sent pricing before updating stage):`;
    for (const email of preDemoEmails) {
      const date = email.timestamp?.split('T')[0] || 'unknown';
      const time = email.timestamp?.split('T')[1]?.slice(0, 5) || '';
      const dir = isOutboundEmail(email) ? 'OUTBOUND' : 'INBOUND';
      const from = email.fromEmail || 'unknown';
      const subject = email.subject || 'No subject';
      const body = truncate(email.body, 300);
      prompt += `\n[${date} ${time}] ${dir} from ${from} — "${subject}"`;
      if (body) prompt += `\n  ${body}`;
    }
  }

  // Notes
  if (ctx.notes.length > 0) {
    prompt += `\n\nDEAL NOTES (${ctx.notes.length}):`;
    for (const note of ctx.notes) {
      const date = note.properties.hs_timestamp?.split('T')[0] || 'unknown';
      const time = note.properties.hs_timestamp?.split('T')[1]?.slice(0, 5) || '';
      const author = note.authorName || 'Unknown';
      const body = truncate(note.properties.hs_note_body, 500);
      prompt += `\n[${date} ${time}] by ${author}: ${body}`;
    }
  } else {
    prompt += '\n\nDEAL NOTES: None';
  }

  return prompt;
}

function buildVerdictUserPrompt(ctx: PricingComplianceContext, evidenceText: string): string {
  const demoDate = new Date(ctx.demoCompletedAt);
  const deadline = new Date(demoDate.getTime() + COMPLIANCE_WINDOW_HOURS * 60 * 60 * 1000);
  const now = new Date();
  const hoursElapsed = (now.getTime() - demoDate.getTime()) / (1000 * 60 * 60);
  const windowExpired = now > deadline;

  return `DEAL: ${ctx.dealName}
AE: ${ctx.ownerName}
Demo Completed: ${ctx.demoCompletedAt}
24-Hour Deadline: ${deadline.toISOString()}
Hours Since Demo: ${hoursElapsed.toFixed(1)}
Window Expired: ${windowExpired ? 'YES' : 'NO'}
Hours Remaining: ${windowExpired ? '0' : (COMPLIANCE_WINDOW_HOURS - hoursElapsed).toFixed(1)}

EVIDENCE EXTRACTION:
${evidenceText}`;
}

function buildExecSummaryUserPrompt(
  ctx: PricingComplianceContext,
  evidenceText: string,
  verdictText: string,
): string {
  return `DEAL: ${ctx.dealName} (${formatCurrency(ctx.amount)})
AE: ${ctx.ownerName}
Demo Completed: ${ctx.demoCompletedAt.split('T')[0]}

EVIDENCE:
${evidenceText}

VERDICT:
${verdictText}`;
}

// ---------------------------------------------------------------------------
// Result parsers
// ---------------------------------------------------------------------------

function parseEvidenceResult(text: string) {
  const get = (label: string) => {
    const m = text.match(new RegExp(`${label}:\\s*(.+)`, 'i'));
    return m?.[1]?.trim() || '';
  };
  return {
    pricingFound: get('PRICING_FOUND').toUpperCase() === 'YES',
    pricingEmailDate: get('PRICING_EMAIL_DATE') !== 'N/A' ? get('PRICING_EMAIL_DATE') : null,
    pricingEmailSubject: get('PRICING_EMAIL_SUBJECT') !== 'N/A' ? get('PRICING_EMAIL_SUBJECT') : null,
    pricingDescription: get('PRICING_DESCRIPTION') !== 'N/A' ? get('PRICING_DESCRIPTION') : null,
    exemptionFound: get('EXEMPTION_FOUND').toUpperCase() === 'YES',
    exemptionReason: get('EXEMPTION_REASON') !== 'N/A' ? get('EXEMPTION_REASON') : null,
    exemptionNoteDate: get('EXEMPTION_NOTE_DATE') !== 'N/A' ? get('EXEMPTION_NOTE_DATE') : null,
  };
}

function parseVerdictResult(text: string) {
  const get = (label: string) => {
    const m = text.match(new RegExp(`${label}:\\s*(.+)`, 'i'));
    return m?.[1]?.trim() || '';
  };
  const status = get('COMPLIANCE_STATUS') as ComplianceStatus;
  const hoursStr = get('HOURS_TO_PRICING');
  const hours = hoursStr && hoursStr !== 'N/A' ? parseFloat(hoursStr) : null;
  return {
    complianceStatus: (['COMPLIANT', 'PENDING', 'EXEMPT', 'NON_COMPLIANT', 'STALE_STAGE'].includes(status)
      ? status
      : 'NON_COMPLIANT') as ComplianceStatus,
    hoursToPricing: hours,
    riskLevel: (get('RISK_LEVEL') || 'MEDIUM') as RiskLevel,
    rationale: get('RATIONALE') || 'Unable to determine compliance.',
  };
}

// ---------------------------------------------------------------------------
// Per-deal analysis (3-pass)
// ---------------------------------------------------------------------------

export async function analyzePricingCompliance(
  ctx: PricingComplianceContext,
): Promise<PricingComplianceResult> {
  const model = getPricingModel();

  // Pass 1: Evidence Extraction
  const evidenceResult = await generateText({
    model,
    system: EVIDENCE_SYSTEM_PROMPT,
    prompt: buildEvidenceUserPrompt(ctx),
  });
  const evidenceText = evidenceResult.text;
  const evidence = parseEvidenceResult(evidenceText);

  // Pass 2: Compliance Verdict
  const verdictResult = await generateText({
    model,
    system: VERDICT_SYSTEM_PROMPT,
    prompt: buildVerdictUserPrompt(ctx, evidenceText),
  });
  const verdictText = verdictResult.text;
  const verdict = parseVerdictResult(verdictText);

  // Pass 3: Executive Summary
  const execResult = await generateText({
    model,
    system: EXEC_SUMMARY_SYSTEM_PROMPT,
    prompt: buildExecSummaryUserPrompt(ctx, evidenceText, verdictText),
  });
  const executiveSummary = execResult.text.trim();

  return {
    dealId: ctx.dealId,
    dealName: ctx.dealName,
    amount: ctx.amount,
    stageName: ctx.stageName,
    ownerName: ctx.ownerName,
    ownerId: ctx.ownerId,
    demoCompletedAt: ctx.demoCompletedAt,
    demoDetectedVia: ctx.demoDetectedVia,
    pricingSentAt: evidence.pricingEmailDate,
    hoursToPricing: verdict.hoursToPricing,
    exemptionNotedAt: evidence.exemptionNoteDate,
    complianceStatus: verdict.complianceStatus,
    pricingEvidence: evidence.pricingDescription,
    exemptionReason: evidence.exemptionReason,
    analysisRationale: verdict.rationale,
    executiveSummary,
    riskLevel: verdict.riskLevel,
  };
}

// ---------------------------------------------------------------------------
// Concurrency helper (same pattern as ppl-cadence)
// ---------------------------------------------------------------------------

export async function processWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

// ---------------------------------------------------------------------------
// Report formatting
// ---------------------------------------------------------------------------

export const STATUS_DISPLAY: Record<string, string> = {
  NON_COMPLIANT: 'Non-Compliant',
  PENDING: 'Pending',
  EXEMPT: 'Exempt',
  COMPLIANT: 'Compliant',
  STALE_STAGE: 'Stale Stage',
  UNKNOWN: 'Unknown',
};

export const STATUS_ORDER = ['NON_COMPLIANT', 'STALE_STAGE', 'PENDING', 'EXEMPT', 'COMPLIANT', 'UNKNOWN'];

export function formatReport(
  results: PricingComplianceResult[],
  verbose: boolean,
): string {
  const today = new Date().toISOString().split('T')[0];
  const successes = results.filter((r) => !r.error);
  const failures = results.filter((r) => r.error);

  const totalValue = successes.reduce((sum, r) => sum + (r.amount || 0), 0);
  const statusCounts: Record<string, number> = {};
  for (const r of successes) {
    statusCounts[r.complianceStatus] = (statusCounts[r.complianceStatus] || 0) + 1;
  }

  let report = `# Pricing Compliance Report — ${today}\n\n`;
  report += `**Policy:** Pricing must be sent in writing within 24 hours of demo completion.\n\n`;

  // Summary
  report += `## Summary\n`;
  report += `- **Total Deals:** ${successes.length}\n`;
  report += `- **Total Pipeline Value:** ${formatCurrency(totalValue)}\n`;
  for (const status of STATUS_ORDER) {
    if (statusCounts[status]) {
      report += `- **${STATUS_DISPLAY[status]}:** ${statusCounts[status]}\n`;
    }
  }

  const compliant = (statusCounts['COMPLIANT'] || 0) + (statusCounts['EXEMPT'] || 0);
  const scored = successes.filter((r) => r.complianceStatus !== 'PENDING').length;
  if (scored > 0) {
    report += `- **Compliance Rate:** ${((compliant / scored) * 100).toFixed(0)}% (${compliant}/${scored} scored deals)\n`;
  }
  report += '\n';

  // Per-status grouping
  for (const status of STATUS_ORDER) {
    const group = successes.filter((r) => r.complianceStatus === status);
    if (group.length === 0) continue;

    report += `## ${STATUS_DISPLAY[status]} (${group.length})\n\n`;
    for (const r of group) {
      report += `### ${r.dealName}\n`;
      report += `- **Amount:** ${formatCurrency(r.amount)}\n`;
      report += `- **AE:** ${r.ownerName}\n`;
      report += `- **Demo:** ${r.demoCompletedAt.split('T')[0]} (detected via ${r.demoDetectedVia})\n`;
      if (r.hoursToPricing !== null) {
        report += `- **Hours to Pricing:** ${r.hoursToPricing.toFixed(1)}\n`;
      }
      if (r.pricingEvidence) {
        report += `- **Pricing Evidence:** ${r.pricingEvidence}\n`;
      }
      if (r.exemptionReason) {
        report += `- **Exemption Reason:** ${r.exemptionReason}\n`;
      }
      report += `- **Risk Level:** ${r.riskLevel}\n`;
      report += `- **Summary:** ${r.executiveSummary}\n`;
      if (verbose) {
        report += `- **Rationale:** ${r.analysisRationale}\n`;
      }
      report += '\n';
    }
  }

  if (failures.length > 0) {
    report += `## Errors (${failures.length})\n\n`;
    for (const r of failures) {
      report += `- **${r.dealName}:** ${r.error}\n`;
    }
    report += '\n';
  }

  return report;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage: npx tsx src/scripts/pricing-compliance.ts [options]

Options:
  --owner=EMAIL          Filter to specific AE
  --deal=DEAL_ID         Analyze single deal
  --concurrency=N        Max parallel LLM analyses (default: 3)
  --verbose              Include full rationale per deal
  --output=FILE          Custom output path
  --help, -h             Show help
`);
    process.exit(0);
  }

  const ownerEmail = args.find((a) => a.startsWith('--owner='))?.split('=')[1];
  const singleDealId = args.find((a) => a.startsWith('--deal='))?.split('=')[1];
  const concurrency = parseInt(args.find((a) => a.startsWith('--concurrency='))?.split('=')[1] || '3', 10);
  const verbose = args.includes('--verbose');
  const outputFile = args.find((a) => a.startsWith('--output='))?.split('=')[1];

  const targetEmails = ownerEmail ? [ownerEmail] : PRICING_TARGET_EMAILS;

  // Resolve owners
  const allOwners = await listAllOwners();
  const ownerMap = new Map<string, string>();
  for (const o of allOwners) {
    const name = [o.firstName, o.lastName].filter(Boolean).join(' ') || o.email;
    ownerMap.set(o.id, name);
  }

  // Get stage name map
  const pipelines = await getAllPipelines();
  const stageNameMap = new Map<string, string>();
  const salesPipeline = pipelines.find((p) => p.id === SALES_PIPELINE_ID);
  if (salesPipeline) {
    for (const stage of salesPipeline.stages) {
      stageNameMap.set(stage.id, stage.label);
    }
  }

  // Collect deals
  type DealEntry = { deal: HubSpotDeal; ownerName: string; ownerId: string; demoCompletedAt: string; demoDetectedVia: DemoDetectedVia };
  let allDeals: DealEntry[] = [];

  if (singleDealId) {
    // Single deal mode
    const deal = await getDealById(singleDealId);
    if (!deal) {
      console.error(`Deal ${singleDealId} not found`);
      process.exit(1);
    }
    const ownerId = deal.properties.hubspot_owner_id || '';
    const ownerName = ownerMap.get(ownerId) || 'Unknown';
    const demoCompletedAt = deal.properties[TRACKED_STAGES.DEMO_COMPLETED.property] || null;
    if (!demoCompletedAt) {
      console.error(`Deal ${singleDealId} has no demo_completed timestamp`);
      process.exit(1);
    }
    allDeals.push({ deal, ownerName, ownerId, demoCompletedAt, demoDetectedVia: 'stage_move' });
  } else {
    // Multi-AE mode
    for (const email of targetEmails) {
      const owner = await getOwnerByEmail(email);
      if (!owner) {
        console.warn(`Owner not found: ${email}, skipping`);
        continue;
      }
      const ownerName = [owner.firstName, owner.lastName].filter(Boolean).join(' ') || email;
      console.log(`Fetching deals for ${ownerName}...`);
      const deals = await getDealsByOwnerId(owner.id);

      for (const deal of deals) {
        const props = deal.properties;
        if (props.pipeline !== SALES_PIPELINE_ID) continue;

        // Check for demo_completed timestamp
        const demoCompletedAt = props[TRACKED_STAGES.DEMO_COMPLETED.property] || null;
        if (!demoCompletedAt) continue;

        // Only deals after policy start date
        if (new Date(demoCompletedAt) < new Date(POLICY_START_DATE)) continue;

        allDeals.push({
          deal,
          ownerName,
          ownerId: owner.id,
          demoCompletedAt,
          demoDetectedVia: 'stage_move',
        });
      }

      // Secondary: deals stuck in Demo Scheduled for 48+ hours with meetings
      const stuckDeals = deals.filter((d) => {
        const props = d.properties;
        if (props.pipeline !== SALES_PIPELINE_ID) return false;
        if (props.dealstage !== DEMO_SCHEDULED_STAGE_ID) return false;
        // No demo_completed timestamp
        if (props[TRACKED_STAGES.DEMO_COMPLETED.property]) return false;
        // Check demo_scheduled timestamp
        const scheduledAt = (props as Record<string, string | undefined>)[TRACKED_STAGES.DEMO_SCHEDULED.property];
        if (!scheduledAt) return false;
        if (new Date(scheduledAt) < new Date(POLICY_START_DATE)) return false;
        // Must be 48+ hours in Demo Scheduled
        const hoursSinceScheduled = (Date.now() - new Date(scheduledAt).getTime()) / (1000 * 60 * 60);
        return hoursSinceScheduled >= 48;
      });

      // For stuck deals, check if they have completed meetings
      for (const deal of stuckDeals) {
        const meetings = await getMeetingsByDealId(deal.id);
        const completedMeeting = meetings.find((m) => {
          const meetingTs = m.properties.hs_timestamp;
          if (!meetingTs) return false;
          return new Date(meetingTs) < new Date(); // meeting date is in the past
        });
        if (completedMeeting) {
          const meetingTs = completedMeeting.properties.hs_timestamp!;
          // Don't duplicate if already in allDeals
          if (!allDeals.some((d) => d.deal.id === deal.id)) {
            allDeals.push({
              deal,
              ownerName,
              ownerId: owner.id,
              demoCompletedAt: meetingTs,
              demoDetectedVia: 'meeting_engagement',
            });
          }
        }
      }

      console.log(`  ${allDeals.length} deals with demo completion`);
    }
  }

  if (allDeals.length === 0) {
    console.log('No deals found matching criteria.');
    process.exit(0);
  }

  // Batch-fetch engagements
  console.log(`Batch-fetching engagements for ${allDeals.length} deals...`);
  const hubspotDealIds = allDeals.map((d) => d.deal.id).filter(Boolean);
  let engagementMap = new Map<string, { calls: unknown[]; emails: HubSpotEmail[]; meetings: HubSpotMeeting[] }>();
  if (hubspotDealIds.length > 0) {
    try {
      engagementMap = await batchFetchDealEngagements(hubspotDealIds);
      console.log(`  Fetched engagements for ${engagementMap.size} deals`);
    } catch {
      console.warn('  Batch engagement fetch failed, will fetch per-deal');
    }
  }

  console.log(`Analyzing ${allDeals.length} deals (concurrency: ${concurrency})...`);
  const startTime = Date.now();
  let completed = 0;

  const results = await processWithConcurrency(
    allDeals,
    concurrency,
    async ({ deal, ownerName, ownerId, demoCompletedAt, demoDetectedVia }) => {
      try {
        const dealId = deal.id;
        const props = deal.properties;
        const batchEngagements = engagementMap.get(dealId) || { calls: [], emails: [], meetings: [] };
        const [notes] = await Promise.all([
          getNotesByDealIdWithAuthor(dealId, ownerMap),
        ]);

        // If batch didn't have emails, fetch individually
        let emails = batchEngagements.emails;
        if (emails.length === 0) {
          try {
            emails = await getEmailsByDealId(dealId);
          } catch { /* empty */ }
        }

        const stageId = props.dealstage || '';
        const stageName = stageNameMap.get(stageId) || stageId;

        const ctx: PricingComplianceContext = {
          dealId,
          dealName: props.dealname || 'Unnamed Deal',
          amount: props.amount ? parseFloat(props.amount) : null,
          stageName,
          ownerName,
          ownerId,
          demoCompletedAt,
          demoDetectedVia,
          emails,
          notes,
          meetings: batchEngagements.meetings,
        };

        const result = await analyzePricingCompliance(ctx);
        completed++;
        console.log(`  [${completed}/${allDeals.length}] ${ctx.dealName} → ${result.complianceStatus} (${result.riskLevel})`);
        return result;
      } catch (err) {
        completed++;
        const errMsg = err instanceof Error ? err.message : String(err);
        console.log(`  [${completed}/${allDeals.length}] ${deal.properties.dealname} → ERROR: ${errMsg}`);
        return {
          dealId: deal.id,
          dealName: deal.properties.dealname || 'Unknown',
          amount: deal.properties.amount ? parseFloat(deal.properties.amount) : null,
          stageName: stageNameMap.get(deal.properties.dealstage || '') || 'Unknown',
          ownerName,
          ownerId,
          demoCompletedAt,
          demoDetectedVia,
          pricingSentAt: null,
          hoursToPricing: null,
          exemptionNotedAt: null,
          complianceStatus: 'NON_COMPLIANT' as ComplianceStatus,
          pricingEvidence: null,
          exemptionReason: null,
          analysisRationale: 'Analysis failed.',
          executiveSummary: 'Analysis error — review manually.',
          riskLevel: 'HIGH' as RiskLevel,
          error: errMsg,
        } as PricingComplianceResult;
      }
    },
  );

  const durationMs = Date.now() - startTime;
  console.log(`\nDone in ${(durationMs / 1000).toFixed(1)}s`);

  const report = formatReport(results, verbose);
  const filename = outputFile || `pricing-compliance-${new Date().toISOString().split('T')[0]}.md`;
  fs.writeFileSync(filename, report);
  console.log(`Report written to ${filename}`);
  console.log(report);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
