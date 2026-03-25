import { createServiceClient } from '@/lib/supabase/client';

export type AlertType = 'escalation_risk' | 'sla_warning' | 'pattern' | 'workload' | 'stale';
export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface CreateAlertParams {
  ticketId: string;
  alertType: AlertType;
  severity: AlertSeverity;
  title: string;
  description: string;
  metadata?: Record<string, unknown>;
  expiresAt?: string;
}

/**
 * Creates a new alert, or updates an existing active alert of the same type for the same ticket.
 * Returns the alert ID.
 */
export async function upsertAlert(params: CreateAlertParams): Promise<string> {
  const supabase = createServiceClient();

  // Check for existing active alert of same type on same ticket
  const { data: existing } = await supabase
    .from('ticket_alerts')
    .select('id, severity')
    .eq('hubspot_ticket_id', params.ticketId)
    .eq('alert_type', params.alertType)
    .is('resolved_at', null)
    .limit(1)
    .single();

  if (existing) {
    // Update existing alert (severity may have changed)
    await supabase
      .from('ticket_alerts')
      .update({
        severity: params.severity,
        title: params.title,
        description: params.description,
        metadata: params.metadata || {},
        expires_at: params.expiresAt || null,
      })
      .eq('id', existing.id);
    return existing.id;
  }

  // Create new alert
  const { data, error } = await supabase
    .from('ticket_alerts')
    .insert({
      hubspot_ticket_id: params.ticketId,
      alert_type: params.alertType,
      severity: params.severity,
      title: params.title,
      description: params.description,
      metadata: params.metadata || {},
      expires_at: params.expiresAt || null,
    })
    .select('id')
    .single();

  if (error) {
    console.error('[alert-utils] Failed to create alert:', error);
    return '';
  }

  return data.id;
}

/**
 * Resolves all active alerts of a given type for a ticket.
 */
export async function resolveAlerts(ticketId: string, alertType: AlertType): Promise<number> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('ticket_alerts')
    .update({ resolved_at: new Date().toISOString() })
    .eq('hubspot_ticket_id', ticketId)
    .eq('alert_type', alertType)
    .is('resolved_at', null)
    .select('id');

  return data?.length || 0;
}

/**
 * Resolves all active alerts of any type for a ticket (e.g., on ticket close).
 */
export async function resolveAllAlerts(ticketId: string): Promise<number> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('ticket_alerts')
    .update({ resolved_at: new Date().toISOString() })
    .eq('hubspot_ticket_id', ticketId)
    .is('resolved_at', null)
    .select('id');

  return data?.length || 0;
}

/**
 * Acknowledge an alert (user dismisses it for themselves).
 */
export async function acknowledgeAlert(alertId: string, userId: string): Promise<void> {
  const supabase = createServiceClient();
  await supabase
    .from('ticket_alerts')
    .update({
      acknowledged_by: userId,
      acknowledged_at: new Date().toISOString(),
    })
    .eq('id', alertId);
}

/**
 * Get active alerts for a set of ticket IDs.
 */
export async function getActiveAlerts(ticketIds: string[]): Promise<Record<string, AlertRecord[]>> {
  if (ticketIds.length === 0) return {};

  const supabase = createServiceClient();
  const result: Record<string, AlertRecord[]> = {};

  const batchSize = 500;
  for (let i = 0; i < ticketIds.length; i += batchSize) {
    const batch = ticketIds.slice(i, i + batchSize);
    const { data } = await supabase
      .from('ticket_alerts')
      .select('*')
      .in('hubspot_ticket_id', batch)
      .is('resolved_at', null)
      .order('created_at', { ascending: false });

    for (const row of data || []) {
      if (!result[row.hubspot_ticket_id]) {
        result[row.hubspot_ticket_id] = [];
      }
      result[row.hubspot_ticket_id].push({
        id: row.id,
        ticketId: row.hubspot_ticket_id,
        alertType: row.alert_type,
        severity: row.severity,
        title: row.title,
        description: row.description,
        metadata: row.metadata || {},
        acknowledgedBy: row.acknowledged_by,
        acknowledgedAt: row.acknowledged_at,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
      });
    }
  }

  return result;
}

/**
 * Get active detected patterns (global).
 */
export async function getActivePatterns(): Promise<PatternRecord[]> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('detected_patterns')
    .select('*')
    .eq('resolved', false)
    .order('created_at', { ascending: false });

  return (data || []).map((row) => ({
    id: row.id,
    patternType: row.pattern_type,
    description: row.description,
    affectedTicketIds: row.affected_ticket_ids,
    recommendedAction: row.recommended_action,
    confidence: parseFloat(row.confidence),
    createdAt: row.created_at,
  }));
}

export interface AlertRecord {
  id: string;
  ticketId: string;
  alertType: string;
  severity: string;
  title: string;
  description: string;
  metadata: Record<string, unknown>;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  createdAt: string;
  expiresAt: string | null;
}

export interface PatternRecord {
  id: string;
  patternType: string;
  description: string;
  affectedTicketIds: string[];
  recommendedAction: string | null;
  confidence: number;
  createdAt: string;
}
