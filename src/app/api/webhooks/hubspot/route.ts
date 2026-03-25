import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createServiceClient } from '@/lib/supabase/client';
import { getHubSpotClient } from '@/lib/hubspot/client';
import { routeEventSync } from '@/lib/events/event-router';
import type { TicketEventType } from '@/lib/events/event-router';

// --- HubSpot webhook payload types ---

interface HubSpotWebhookEvent {
  eventId: number;
  subscriptionId: number;
  portalId: number;
  appId: number;
  occurredAt: number; // epoch ms
  subscriptionType: string; // e.g., "ticket.propertyChange", "conversation.newMessage"
  attemptNumber: number;
  objectId: number; // ticket or conversation ID
  propertyName?: string;
  propertyValue?: string;
  changeSource?: string;
  sourceId?: string;
  messageId?: string;
  messageDirection?: string; // 'INCOMING' | 'OUTGOING'
}

const HUBSPOT_PORTAL_ID = 7358632;

// --- Signature verification ---

function verifyHubSpotSignature(
  requestBody: string,
  signature: string | null,
  timestamp: string | null,
  method: string,
  requestUrl: string
): boolean {
  // Skip verification in development
  if (process.env.NODE_ENV === 'development') return true;

  const secret = process.env.HUBSPOT_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[hubspot-webhook] HUBSPOT_WEBHOOK_SECRET not configured');
    return false;
  }

  if (!signature || !timestamp) return false;

  // HubSpot v3 signature: HMAC-SHA256(client_secret, method + url + body + timestamp)
  // The URL must match what HubSpot used to compute the signature — the public target URL,
  // not Vercel's internal request URL (which may include deployment-specific subdomains).
  const publicUrl = `https://hub-agent-oe65.vercel.app/api/webhooks/hubspot`;
  const sourceString = `${method}${publicUrl}${requestBody}${timestamp}`;
  const hash = crypto
    .createHmac('sha256', secret)
    .update(sourceString)
    .digest('base64');

  // Timing-safe comparison
  try {
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signature));
  } catch {
    return false;
  }
}

// --- Event normalization ---

interface NormalizedEvent {
  ticketId: string;
  type: TicketEventType;
  metadata: Record<string, unknown>;
}

async function normalizeHubSpotEvent(event: HubSpotWebhookEvent): Promise<NormalizedEvent | null> {
  const { subscriptionType, objectId, propertyName, propertyValue, messageDirection } = event;

  // conversation.newMessage — customer or agent message
  if (subscriptionType === 'conversation.newMessage') {
    // objectId is the conversation thread ID, not ticket ID.
    // We need to look up the ticket linked to this conversation.
    const ticketId = await findTicketForConversation(String(objectId));
    if (!ticketId) return null;

    const type: TicketEventType = messageDirection === 'INCOMING' ? 'customer_message' : 'agent_message';
    const metadata: Record<string, unknown> = { messageDirection, conversationId: objectId };

    // For agent messages, fetch the message text so auto-complete check can run
    if (type === 'agent_message' && event.messageId) {
      try {
        const messageText = await fetchMessageText(String(objectId), event.messageId);
        if (messageText) {
          metadata.messageText = messageText;
        }
      } catch (err) {
        console.warn('[hubspot-webhook] Could not fetch message text:', err);
        // Continue without message text — auto-complete check will skip
      }
    }

    return { ticketId, type, metadata };
  }

  // ticket.creation
  if (subscriptionType === 'ticket.creation') {
    return {
      ticketId: String(objectId),
      type: 'ticket_created',
      metadata: {},
    };
  }

  // ticket.deletion — we don't trigger analysis, just log
  if (subscriptionType === 'ticket.deletion') {
    return null;
  }

  // ticket.propertyChange
  if (subscriptionType === 'ticket.propertyChange') {
    // Check if the ticket was closed (pipeline stage change to a closed stage)
    if (propertyName === 'hs_pipeline_stage') {
      const isClosed = await checkIfStageClosed(propertyValue || '');
      if (isClosed) {
        return {
          ticketId: String(objectId),
          type: 'ticket_closed',
          metadata: { propertyName, propertyValue },
        };
      }
    }

    return {
      ticketId: String(objectId),
      type: 'property_change',
      metadata: { propertyName, propertyValue },
    };
  }

  console.warn(`[hubspot-webhook] Unhandled subscription type: ${subscriptionType}`);
  return null;
}

/**
 * Fetch the text content of a specific message from a HubSpot conversation thread.
 * Used to get agent message text for auto-completion detection.
 */
async function fetchMessageText(threadId: string, messageId: string): Promise<string | null> {
  try {
    const hsClient = getHubSpotClient();
    const response = await hsClient.apiRequest({
      method: 'GET',
      path: `/conversations/v3/conversations/threads/${threadId}/messages/${messageId}`,
    });
    const message = await response.json() as { text?: string; richText?: string };
    // Prefer plain text, fall back to rich text stripped of HTML
    return message.text || (message.richText ? message.richText.replace(/<[^>]*>/g, '') : null);
  } catch (err) {
    console.warn(`[hubspot-webhook] Failed to fetch message ${messageId} from thread ${threadId}:`, err);
    return null;
  }
}

/**
 * Look up which ticket a HubSpot conversation thread belongs to.
 * Falls back to checking support_tickets for a matching conversation_id.
 */
async function findTicketForConversation(conversationId: string): Promise<string | null> {
  const supabase = createServiceClient();

  // support_tickets may store the conversation thread ID
  const { data } = await supabase
    .from('support_tickets')
    .select('hubspot_ticket_id')
    .eq('hs_conversation_id', conversationId)
    .limit(1)
    .maybeSingle();

  return data?.hubspot_ticket_id || null;
}

/**
 * Check if a pipeline stage ID represents a "closed" stage.
 * Uses the support_tickets table to check known closed stages, or
 * falls back to checking if the stage name contains "closed".
 */
async function checkIfStageClosed(stageId: string): Promise<boolean> {
  // Known closed stage IDs for the support pipeline
  // These could be moved to a config, but for now we check the DB
  const supabase = createServiceClient();

  const { data } = await supabase
    .from('support_tickets')
    .select('is_closed')
    .eq('hs_pipeline_stage', stageId)
    .eq('is_closed', true)
    .limit(1)
    .maybeSingle();

  return !!data;
}

// --- Route handler ---

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get('X-HubSpot-Signature-v3');
  const timestamp = request.headers.get('X-HubSpot-Request-Timestamp');

  // Verify signature
  if (!verifyHubSpotSignature(rawBody, signature, timestamp, 'POST', request.url)) {
    console.warn('[hubspot-webhook] Invalid signature');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  // Check timestamp freshness (reject events older than 5 minutes)
  if (timestamp) {
    const eventAge = Date.now() - parseInt(timestamp, 10);
    if (eventAge > 5 * 60 * 1000) {
      console.warn('[hubspot-webhook] Stale webhook event, age:', eventAge);
      return NextResponse.json({ error: 'Stale event' }, { status: 401 });
    }
  }

  let events: HubSpotWebhookEvent[];
  try {
    events = JSON.parse(rawBody);
    // HubSpot sends an array of events
    if (!Array.isArray(events)) {
      events = [events];
    }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Verify portal ID
  const validEvents = events.filter((e) => e.portalId === HUBSPOT_PORTAL_ID);
  if (validEvents.length === 0) {
    return NextResponse.json({ error: 'No events for this portal' }, { status: 400 });
  }

  // Process each event (normalize and route)
  // Analysis runs synchronously so Vercel doesn't kill the function before it completes.
  // HubSpot allows up to 30 seconds for webhook responses.
  const results: Array<{ eventId: number; routed: boolean; type?: string }> = [];

  for (const event of validEvents) {
    try {
      const normalized = await normalizeHubSpotEvent(event);
      if (!normalized) {
        results.push({ eventId: event.eventId, routed: false });
        continue;
      }

      await routeEventSync({
        source: 'hubspot',
        type: normalized.type,
        ticketId: normalized.ticketId,
        timestamp: new Date(event.occurredAt).toISOString(),
        metadata: normalized.metadata,
        rawPayload: event,
      });

      results.push({ eventId: event.eventId, routed: true, type: normalized.type });
    } catch (err) {
      console.error(`[hubspot-webhook] Error processing event ${event.eventId}:`, err);
      results.push({ eventId: event.eventId, routed: false });
    }
  }

  // Always return 200 to prevent HubSpot retries
  return NextResponse.json({
    received: validEvents.length,
    processed: results.filter((r) => r.routed).length,
    results,
  });
}
