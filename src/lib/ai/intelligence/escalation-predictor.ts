import { createServiceClient } from '@/lib/supabase/client';
import { generateText } from 'ai';
import { getModelForPass } from '@/lib/ai/passes/models';
import { upsertAlert, resolveAlerts } from './alert-utils';

/**
 * Escalation Predictor — Phase 6, Proactive Intelligence
 *
 * Two-stage approach:
 *   Stage 1 (no LLM): Score based on signals (temperature, wait time, message count, VIP, etc.)
 *   Stage 2 (LLM, only if Stage 1 score > 0.5): Quick focused check on conversation tone trend
 *
 * Output: escalation_risk_score (0.00 – 1.00) + reason
 * Writes to: support_tickets.escalation_risk_score + ticket_alerts if score > threshold
 */

const ALERT_THRESHOLD = 0.60;   // Create info alert
const WARNING_THRESHOLD = 0.75; // Upgrade to warning
const CRITICAL_THRESHOLD = 0.90; // Upgrade to critical

export interface EscalationResult {
  ticketId: string;
  riskScore: number;
  reason: string;
  stage: 'heuristic' | 'llm_refined';
  alertCreated: boolean;
}

/**
 * Predict escalation risk for a single ticket.
 * Can be called after a temperature pass or as part of the 30-minute sweep.
 */
export async function predictEscalation(
  ticketId: string,
  /** If we already have analysis data, pass it to avoid re-fetching */
  preloadedData?: {
    temperature?: string;
    temperatureReason?: string;
    hoursSinceCustomerWaiting?: number;
    conversationText?: string;
    messageCount?: number;
    isCoDestiny?: boolean;
    ageDays?: number;
  }
): Promise<EscalationResult> {
  const supabase = createServiceClient();

  // Fetch ticket data if not preloaded
  let ticketData = preloadedData;
  if (!ticketData) {
    const { data: ticket } = await supabase
      .from('support_tickets')
      .select('*')
      .eq('hubspot_ticket_id', ticketId)
      .single();

    const { data: analysis } = await supabase
      .from('ticket_action_board_analyses')
      .select('customer_temperature, temperature_reason, hours_since_customer_waiting')
      .eq('hubspot_ticket_id', ticketId)
      .single();

    if (!ticket) {
      return { ticketId, riskScore: 0, reason: 'Ticket not found', stage: 'heuristic', alertCreated: false };
    }

    // Count conversation messages
    let messageCount = 0;
    try {
      const { count } = await supabase
        .from('action_item_completions')
        .select('id', { count: 'exact', head: true })
        .eq('hubspot_ticket_id', ticketId);
      // Rough proxy — real count from engagement timeline would be better
      // but we can estimate from last_customer/agent message timestamps
      messageCount = count || 0;
    } catch {
      // ignore
    }

    // Estimate message count from ticket age and activity
    const createdAt = ticket.hubspot_created_at ? new Date(ticket.hubspot_created_at) : new Date();
    const ageDays = Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24));

    ticketData = {
      temperature: analysis?.customer_temperature || undefined,
      temperatureReason: analysis?.temperature_reason || undefined,
      hoursSinceCustomerWaiting: analysis?.hours_since_customer_waiting || computeWaitHours(ticket),
      isCoDestiny: ticket.is_co_destiny || false,
      ageDays,
      messageCount,
    };
  }

  // --- Stage 1: Heuristic scoring ---
  let score = 0;
  const factors: string[] = [];

  // Temperature signal
  if (ticketData.temperature === 'angry') {
    score += 0.5;
    factors.push('customer is angry');
  } else if (ticketData.temperature === 'escalating') {
    score += 0.3;
    factors.push('customer tone is escalating');
  } else if (ticketData.temperature === 'frustrated') {
    score += 0.15;
    factors.push('customer is frustrated');
  }

  // Wait time signal
  const waitHours = ticketData.hoursSinceCustomerWaiting || 0;
  if (waitHours > 8) {
    score += 0.25;
    factors.push(`customer waiting ${Math.round(waitHours)}h`);
  } else if (waitHours > 4) {
    score += 0.15;
    factors.push(`customer waiting ${Math.round(waitHours)}h`);
  } else if (waitHours > 2) {
    score += 0.1;
    factors.push(`customer waiting ${Math.round(waitHours)}h`);
  }

  // VIP signal (lower threshold)
  if (ticketData.isCoDestiny) {
    score += 0.15;
    factors.push('VIP (Co-Destiny) account');
  }

  // Ticket age relative to complexity — old unresolved tickets are riskier
  const ageDays = ticketData.ageDays || 0;
  if (ageDays > 14) {
    score += 0.15;
    factors.push(`ticket is ${ageDays} days old`);
  } else if (ageDays > 7) {
    score += 0.1;
    factors.push(`ticket is ${ageDays} days old`);
  }

  // Cap at 1.0
  score = Math.min(score, 1.0);

  let reason = factors.length > 0 ? factors.join('; ') : 'Low risk — no concerning signals';
  let stage: 'heuristic' | 'llm_refined' = 'heuristic';

  // --- Stage 2: LLM refinement (only if heuristic score suggests risk) ---
  if (score > 0.5 && ticketData.temperatureReason) {
    try {
      const llmResult = await runLlmEscalationCheck(ticketId, ticketData, score, factors);
      score = llmResult.refinedScore;
      reason = llmResult.reason;
      stage = 'llm_refined';
    } catch (err) {
      console.error(`[escalation-predictor] LLM check failed for ${ticketId}:`, err);
      // Fall back to heuristic score
    }
  }

  // Round to 2 decimal places
  score = Math.round(score * 100) / 100;

  // --- Write results ---
  // Update ticket's escalation_risk_score
  await supabase
    .from('support_tickets')
    .update({ escalation_risk_score: score })
    .eq('hubspot_ticket_id', ticketId);

  // Create/update/resolve alert based on score
  let alertCreated = false;
  if (score >= ALERT_THRESHOLD) {
    const severity = score >= CRITICAL_THRESHOLD ? 'critical'
      : score >= WARNING_THRESHOLD ? 'warning'
      : 'info';

    await upsertAlert({
      ticketId,
      alertType: 'escalation_risk',
      severity,
      title: `Escalation risk: ${severity === 'critical' ? 'Critical' : severity === 'warning' ? 'High' : 'Elevated'}`,
      description: reason,
      metadata: { risk_score: score, factors, stage },
    });
    alertCreated = true;
  } else {
    // Resolve any existing escalation alert if risk has dropped
    await resolveAlerts(ticketId, 'escalation_risk');
  }

  return { ticketId, riskScore: score, reason, stage, alertCreated };
}

/**
 * Run escalation prediction across all open tickets (30-minute sweep).
 */
export async function runEscalationSweep(): Promise<{
  ticketsChecked: number;
  alertsCreated: number;
  highRiskTickets: string[];
  errors: string[];
}> {
  const supabase = createServiceClient();

  // Get all open tickets with analyses
  const { data: tickets, error } = await supabase
    .from('support_tickets')
    .select('hubspot_ticket_id')
    .eq('is_closed', false);

  if (error || !tickets) {
    return { ticketsChecked: 0, alertsCreated: 0, highRiskTickets: [], errors: [error?.message || 'No tickets'] };
  }

  const results = {
    ticketsChecked: 0,
    alertsCreated: 0,
    highRiskTickets: [] as string[],
    errors: [] as string[],
  };

  for (const ticket of tickets) {
    try {
      const result = await predictEscalation(ticket.hubspot_ticket_id);
      results.ticketsChecked++;
      if (result.alertCreated) results.alertsCreated++;
      if (result.riskScore >= WARNING_THRESHOLD) {
        results.highRiskTickets.push(ticket.hubspot_ticket_id);
      }
    } catch (err) {
      results.errors.push(`${ticket.hubspot_ticket_id}: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  return results;
}

// --- Helpers ---

function computeWaitHours(ticket: Record<string, unknown>): number {
  const lastCustomer = ticket.last_customer_message_at as string | null;
  const lastAgent = ticket.last_agent_message_at as string | null;
  if (!lastCustomer) return 0;
  const customerTime = new Date(lastCustomer).getTime();
  const agentTime = lastAgent ? new Date(lastAgent).getTime() : 0;
  if (agentTime >= customerTime) return 0;
  return (Date.now() - customerTime) / (1000 * 60 * 60);
}

async function runLlmEscalationCheck(
  ticketId: string,
  data: NonNullable<Parameters<typeof predictEscalation>[1]>,
  heuristicScore: number,
  factors: string[]
): Promise<{ refinedScore: number; reason: string }> {
  // Use DeepSeek for this lightweight check (same as temperature pass)
  const model = getModelForPass('temperature');

  const result = await generateText({
    model,
    system: `You are an escalation risk analyst for a healthcare SaaS support team.

Given the signals below, estimate the probability (0.00–1.00) that this ticket will escalate in the next 1-2 interactions. Consider:
- Is the customer's patience wearing thin?
- Are there signs of executive involvement or CC escalation?
- Is the issue blocking their operations?
- Has the response time been acceptable for the issue severity?

Output EXACTLY two fields:
RISK_SCORE: <number 0.00 to 1.00>
RISK_REASON: <one sentence explaining the trajectory>`,
    prompt: `TICKET: ${ticketId}
CURRENT TEMPERATURE: ${data.temperature || 'unknown'}
TEMPERATURE REASON: ${data.temperatureReason || 'none'}
HOURS WAITING: ${data.hoursSinceCustomerWaiting || 0}
VIP ACCOUNT: ${data.isCoDestiny ? 'YES' : 'No'}
TICKET AGE: ${data.ageDays || 0} days
HEURISTIC SIGNALS: ${factors.join(', ')}
HEURISTIC SCORE: ${heuristicScore.toFixed(2)}`,
  });

  const text = result.text || '';
  const scoreMatch = text.match(/RISK_SCORE:\s*([\d.]+)/i);
  const reasonMatch = text.match(/RISK_REASON:\s*(.+?)(?=\n[A-Z_]+:|\n\n|$)/is);

  const refinedScore = scoreMatch ? Math.min(parseFloat(scoreMatch[1]), 1.0) : heuristicScore;
  const reason = reasonMatch?.[1]?.trim() || factors.join('; ');

  return { refinedScore: isNaN(refinedScore) ? heuristicScore : refinedScore, reason };
}
