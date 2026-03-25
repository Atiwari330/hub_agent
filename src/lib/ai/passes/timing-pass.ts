import type { TicketContext, TimingPassResult } from './types';

// Pure computation — no LLM needed.
// Replaces the error-prone LLM-calculated timing values.

export function runTimingPass(context: TicketContext): TimingPassResult {
  const now = Date.now();
  const lastCustomer = context.ticket.last_customer_message_at
    ? new Date(context.ticket.last_customer_message_at).getTime()
    : null;
  const lastAgent = context.ticket.last_agent_message_at
    ? new Date(context.ticket.last_agent_message_at).getTime()
    : null;

  // Customer is waiting only if their last message is more recent than agent's
  const customerWaiting =
    lastCustomer && (!lastAgent || lastCustomer > lastAgent)
      ? (now - lastCustomer) / (1000 * 60 * 60)
      : 0;

  const lastOutbound = lastAgent ? (now - lastAgent) / (1000 * 60 * 60) : null;

  // Last activity = most recent of any timestamp
  const allTimestamps = [lastCustomer, lastAgent].filter(Boolean) as number[];
  const lastActivity =
    allTimestamps.length > 0
      ? (now - Math.max(...allTimestamps)) / (1000 * 60 * 60)
      : null;

  return {
    hours_since_customer_waiting: Math.round(customerWaiting * 100) / 100,
    hours_since_last_outbound: lastOutbound ? Math.round(lastOutbound * 100) / 100 : null,
    hours_since_last_activity: lastActivity ? Math.round(lastActivity * 100) / 100 : null,
  };
}
