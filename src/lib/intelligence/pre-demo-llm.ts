/**
 * Pre-Demo AE Effort LLM Analysis
 *
 * Focused LLM prompt that assesses AE effort quality on pre-demo deals:
 *   - Email personalization score (0-100)
 *   - Tactic diversity score (0-100)
 *   - Effort assessment (relentless|strong|adequate|weak|absent)
 *   - Recommended untried tactic
 *   - Reasoning
 *
 * Called after rules engine; overrides tactic_diversity and email_personalization
 * dimension scores with LLM-derived values.
 */

import { generateText } from 'ai';
import { getModel } from '@/lib/ai/provider';
import { createServiceClient } from '@/lib/supabase/client';
import type { HubSpotCall, HubSpotEmail, HubSpotMeeting } from '@/lib/hubspot/engagements';
import { getOutcomeLabel, formatCallDuration } from '@/lib/utils/call-outcomes';

// --- Types ---

export interface PreDemoLLMResult {
  email_personalization_score: number;
  tactic_diversity_score: number;
  effort_assessment: 'relentless' | 'strong' | 'adequate' | 'weak' | 'absent';
  recommended_tactic: string;
  tactics_detected: string[];
  reasoning: string;
}

interface PreDemoLLMInput {
  dealName: string;
  stageName: string;
  daysInPreDemo: number;
  calls: HubSpotCall[];
  emails: HubSpotEmail[];
  meetings: HubSpotMeeting[];
  notes: { note_body: string; note_timestamp: string; author_name: string | null }[];
}

// --- Prompt ---

function buildPreDemoEffortPrompt(input: PreDemoLLMInput): string {
  const { dealName, stageName, daysInPreDemo, calls, emails, meetings, notes } = input;

  // Build engagement summary
  const outboundEmails = emails.filter(e => e.direction === 'OUTBOUND' || e.direction === 'outbound' || e.direction === 'OUTGOING_EMAIL');

  const emailSummary = outboundEmails.slice(0, 10).map(e => {
    const ts = e.timestamp ? new Date(e.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Unknown date';
    return `  [${ts}] Subject: ${e.subject || 'No subject'}\n  Body preview: ${(e.body || '').substring(0, 300)}`;
  }).join('\n\n');

  const callSummary = calls.slice(0, 15).map(c => {
    const ts = c.properties.hs_timestamp ? new Date(c.properties.hs_timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Unknown';
    const direction = c.properties.hs_call_direction?.toUpperCase() || 'UNKNOWN';
    const outcome = getOutcomeLabel(c.properties.hs_call_disposition);
    const duration = formatCallDuration(c.properties.hs_call_duration ? Number(c.properties.hs_call_duration) : null);
    return `  [${ts}] ${direction} | ${outcome} | ${duration}`;
  }).join('\n');

  const meetingSummary = meetings.slice(0, 5).map(m => {
    const ts = m.properties.hs_timestamp ? new Date(m.properties.hs_timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Unknown';
    return `  [${ts}] ${m.properties.hs_meeting_title || 'Untitled meeting'}`;
  }).join('\n');

  const noteSummary = notes.slice(0, 5).map(n => {
    const ts = n.note_timestamp ? new Date(n.note_timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Unknown';
    return `  [${ts}] ${(n.note_body || '').substring(0, 200)}`;
  }).join('\n');

  return `You are evaluating the EFFORT and CREATIVITY of an Account Executive (AE) working a pre-demo deal.
This is NOT about deal health or buyer interest — it's about whether the AE is doing everything they can to get a demo booked.

DEAL CONTEXT:
- Deal: ${dealName}
- Stage: ${stageName}
- Days in pre-demo: ${daysInPreDemo}

OUTBOUND EMAILS (${outboundEmails.length} total, showing up to 10):
${emailSummary || '  (none)'}

CALLS (${calls.length} total, showing up to 15):
${callSummary || '  (none)'}

MEETINGS (${meetings.length}):
${meetingSummary || '  (none)'}

NOTES (${notes.length}):
${noteSummary || '  (none)'}

SCORING CRITERIA:

1. EMAIL PERSONALIZATION (0-100):
   Score how personalized and creative the AE's outbound emails are.
   - 90-100: Highly personalized (references prospect's company/industry/pain points, custom value props)
   - 70-89: Good personalization (some customization, not fully templated)
   - 50-69: Moderate (mix of template and custom)
   - 20-49: Mostly templated/generic
   - 0-19: All template or no emails sent

2. TACTIC DIVERSITY (0-100):
   Score the variety and creativity of tactics used. Look for:
   - Video messages (Loom, Vidyard, etc.)
   - Social proof / case studies
   - Blind calendar invites
   - LinkedIn touches (mentioned in notes)
   - Gifting / incentives
   - Multi-threading (reaching multiple contacts)
   - Different call times/approaches
   - Industry-specific insights
   Score: 90-100 if 5+ distinct tactics, 70-89 if 3-4, 50-69 if 2, 20-49 if 1, 0-19 if none evident

3. EFFORT ASSESSMENT:
   - relentless: AE is trying everything, high frequency, creative approaches
   - strong: Good effort with multiple channels and decent frequency
   - adequate: Minimum expected effort, nothing creative
   - weak: Below expected cadence, limited channels
   - absent: No meaningful outreach effort

4. RECOMMENDED TACTIC:
   Suggest ONE specific untried tactic the AE should try next. Be concrete and actionable.

5. TACTICS DETECTED:
   List each distinct tactic you observe (e.g., "cold_call", "personalized_email", "video_message", "linkedin_touch", "case_study", "blind_invite", "gift", "multi_thread", "voicemail_drop", "social_proof").

Respond in EXACTLY this JSON format (no markdown, no explanation outside JSON):
{
  "email_personalization_score": <number 0-100>,
  "tactic_diversity_score": <number 0-100>,
  "effort_assessment": "<relentless|strong|adequate|weak|absent>",
  "recommended_tactic": "<one specific actionable suggestion>",
  "tactics_detected": ["tactic1", "tactic2"],
  "reasoning": "<2-3 sentences explaining your assessment>"
}`;
}

// --- Main Analysis Function ---

export async function analyzePreDemoEffort(
  dealId: string,
  dealName: string,
  stageName: string,
  daysInPreDemo: number,
  calls: HubSpotCall[],
  emails: HubSpotEmail[],
  meetings: HubSpotMeeting[],
  notes: { note_body: string; note_timestamp: string; author_name: string | null }[] = []
): Promise<{ success: true; result: PreDemoLLMResult } | { success: false; error: string }> {
  try {
    const prompt = buildPreDemoEffortPrompt({
      dealName,
      stageName,
      daysInPreDemo,
      calls,
      emails,
      meetings,
      notes,
    });

    const { text } = await generateText({
      model: getModel(),
      prompt,
    });

    // Parse JSON response
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);

    const result: PreDemoLLMResult = {
      email_personalization_score: Math.max(0, Math.min(100, Math.round(parsed.email_personalization_score || 0))),
      tactic_diversity_score: Math.max(0, Math.min(100, Math.round(parsed.tactic_diversity_score || 0))),
      effort_assessment: ['relentless', 'strong', 'adequate', 'weak', 'absent'].includes(parsed.effort_assessment)
        ? parsed.effort_assessment
        : 'adequate',
      recommended_tactic: parsed.recommended_tactic || 'Try a personalized video message',
      tactics_detected: Array.isArray(parsed.tactics_detected) ? parsed.tactics_detected : [],
      reasoning: parsed.reasoning || '',
    };

    // Update deal_intelligence with LLM overrides
    const supabase = createServiceClient();
    await supabase
      .from('deal_intelligence')
      .update({
        email_personalization_score: result.email_personalization_score,
        tactic_diversity_score: result.tactic_diversity_score,
        tactics_detected: result.tactics_detected,
        recommended_action: result.recommended_tactic,
        reasoning: result.reasoning,
        llm_status: result.effort_assessment,
        llm_analyzed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('hubspot_deal_id', dealId);

    return { success: true, result };
  } catch (error) {
    console.error(`Pre-demo LLM analysis error for ${dealId}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
