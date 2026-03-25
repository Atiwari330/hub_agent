import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createServiceClient } from '@/lib/supabase/client';
import { routeEventSync } from '@/lib/events/event-router';
import type { TicketEventType } from '@/lib/events/event-router';

// --- Linear webhook payload types ---

interface LinearWebhookPayload {
  action: 'create' | 'update' | 'remove';
  type: 'Issue' | 'Comment' | 'IssueLabel';
  data: {
    id: string;
    identifier: string; // e.g., "ENG-1234"
    title?: string;
    state?: { id: string; name: string };
    assignee?: { id: string; name: string };
  };
  updatedFrom?: Record<string, unknown>;
  createdAt: string;
  organizationId?: string;
}

// --- Signature verification ---

function verifyLinearSignature(rawBody: string, signature: string | null): boolean {
  if (process.env.NODE_ENV === 'development') return true;

  const secret = process.env.LINEAR_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[linear-webhook] LINEAR_WEBHOOK_SECRET not configured');
    return false;
  }

  if (!signature) return false;

  // Linear signs with HMAC-SHA256 of the raw body
  const hash = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signature));
  } catch {
    return false;
  }
}

// --- Find linked ticket ---

async function findTicketByLinearIssue(identifier: string): Promise<string | null> {
  const supabase = createServiceClient();

  const { data } = await supabase
    .from('support_tickets')
    .select('hubspot_ticket_id')
    .eq('linear_task', identifier)
    .eq('is_closed', false)
    .limit(1)
    .maybeSingle();

  return data?.hubspot_ticket_id || null;
}

// --- Route handler ---

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get('linear-signature');

  if (!verifyLinearSignature(rawBody, signature)) {
    console.warn('[linear-webhook] Invalid signature');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let payload: LinearWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Only handle Issue and Comment events
  if (payload.type !== 'Issue' && payload.type !== 'Comment') {
    return NextResponse.json({ ignored: true, reason: `Unhandled type: ${payload.type}` });
  }

  // Get the issue identifier
  const identifier = payload.data.identifier;
  if (!identifier) {
    return NextResponse.json({ ignored: true, reason: 'No identifier in payload' });
  }

  // Find linked ticket
  const ticketId = await findTicketByLinearIssue(identifier);
  if (!ticketId) {
    // No linked ticket — might be an issue unrelated to support
    return NextResponse.json({ ignored: true, reason: `No ticket linked to ${identifier}` });
  }

  // Determine event type
  let eventType: TicketEventType;
  if (payload.type === 'Comment') {
    eventType = 'linear_comment';
  } else if (payload.action === 'update' && payload.updatedFrom && 'state' in payload.updatedFrom) {
    eventType = 'linear_state_change';
  } else if (payload.action === 'update') {
    // Other issue updates (assignee, priority, etc.) → treat as state change
    eventType = 'linear_state_change';
  } else {
    // create/remove — less common for support context
    return NextResponse.json({ ignored: true, reason: `Unhandled action: ${payload.action}` });
  }

  // Route the event
  try {
    const result = await routeEventSync({
      source: 'linear',
      type: eventType,
      ticketId,
      timestamp: payload.createdAt || new Date().toISOString(),
      metadata: {
        linearIdentifier: identifier,
        action: payload.action,
        stateName: payload.data.state?.name,
      },
      rawPayload: payload,
    });

    return NextResponse.json({
      success: true,
      ticketId,
      eventType,
      linearIssue: identifier,
      passes: result.passes,
    });
  } catch (err) {
    console.error(`[linear-webhook] Error routing event for ${identifier}:`, err);
    // Return 200 to prevent Linear retries — error is logged in webhook_events
    return NextResponse.json({
      received: true,
      error: 'Processing failed, logged for retry',
    });
  }
}
