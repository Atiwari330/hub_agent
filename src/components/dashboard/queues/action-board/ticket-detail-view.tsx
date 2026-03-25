'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { getHubSpotTicketUrl } from '@/lib/hubspot/urls';
import {
  ResponseClock,
  ConnectionIndicator,
  TemperatureBadge,
  EscalationRiskBadge,
  AlertSeverityBadge,
  PriorityBadge,
  WhoBadge,
  AnalyzedTimestamp,
  LinearBadge,
  computeLiveHours,
} from './badges';
import { ActionItemCard } from './action-item-card';
import { TicketTimeline } from './ticket-timeline';
import type { SingleTicketResponse } from '@/app/api/queues/support-action-board/[ticketId]/route';
import type { ActionBoardTicket, LiveActionItem, ProgressNoteInfo } from '@/app/api/queues/support-action-board/route';
import type { AlertRecord } from '@/lib/ai/intelligence/alert-utils';
import type { ActionItem, RelatedTicketInfo } from '@/app/api/queues/support-action-board/analyze/analyze-core';
import { useRealtimeSubscription } from '@/hooks/use-realtime-subscription';

// --- Types ---

interface Props {
  ticketId: string;
  userRole: string;
  canAnalyzeTicket: boolean;
}

// --- Skeleton Components ---

function SkeletonBlock({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-slate-800 rounded ${className || ''}`} />;
}

function DetailSkeleton() {
  return (
    <div className="h-full flex flex-col bg-slate-950 text-white">
      {/* Header skeleton */}
      <div className="border-b border-slate-800 px-6 py-4">
        <div className="flex items-center gap-3">
          <SkeletonBlock className="w-32 h-4" />
          <SkeletonBlock className="w-64 h-5" />
        </div>
        <SkeletonBlock className="w-96 h-4 mt-2" />
      </div>

      {/* Body skeleton */}
      <div className="flex-1 overflow-auto px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 max-w-7xl">
          {/* Left column */}
          <div className="lg:col-span-2 space-y-4">
            {/* Situation */}
            <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
              <SkeletonBlock className="w-20 h-3 mb-3" />
              <SkeletonBlock className="w-full h-4 mb-2" />
              <SkeletonBlock className="w-full h-4 mb-2" />
              <SkeletonBlock className="w-3/4 h-4" />
            </div>
            {/* Action items */}
            <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
              <SkeletonBlock className="w-32 h-3 mb-3" />
              <SkeletonBlock className="w-full h-12 mb-2" />
              <SkeletonBlock className="w-full h-12 mb-2" />
              <SkeletonBlock className="w-full h-12" />
            </div>
          </div>
          {/* Right column */}
          <div className="space-y-4">
            <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
              <SkeletonBlock className="w-24 h-3 mb-3" />
              <SkeletonBlock className="w-full h-4 mb-2" />
              <SkeletonBlock className="w-full h-4 mb-2" />
              <SkeletonBlock className="w-full h-4 mb-2" />
              <SkeletonBlock className="w-full h-4" />
            </div>
            <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
              <SkeletonBlock className="w-32 h-3 mb-3" />
              <SkeletonBlock className="w-full h-4 mb-2" />
              <SkeletonBlock className="w-full h-4 mb-2" />
              <SkeletonBlock className="w-full h-4" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Collapsible Section ---

function CollapsibleSection({
  title,
  children,
  defaultOpen = false,
  badge,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  badge?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between text-xs font-semibold text-gray-400 uppercase tracking-wider"
      >
        <span className="flex items-center gap-2">
          {title}
          {badge}
        </span>
        <svg
          className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}

// --- Main Component ---

export function TicketDetailView({ ticketId, canAnalyzeTicket }: Props) {
  const router = useRouter();
  const [ticket, setTicket] = useState<ActionBoardTicket | null>(null);
  const [userId, setUserId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  // Progress note state
  const [isWritingNote, setIsWritingNote] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [submittingNote, setSubmittingNote] = useState(false);

  const [showExpiredItems, setShowExpiredItems] = useState(false);
  const [showCompletedItems, setShowCompletedItems] = useState(false);

  // --- Data Fetching ---

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/queues/support-action-board/${ticketId}`);
      if (!res.ok) {
        if (res.status === 404) {
          setError('Ticket not found');
        } else {
          setError('Failed to load ticket');
        }
        return;
      }
      const json: SingleTicketResponse = await res.json();
      setTicket(json.ticket);
      setUserId(json.userId);
    } catch (err) {
      console.error('Failed to fetch ticket:', err);
      setError('Failed to load ticket');
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // --- Keyboard Shortcuts ---

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isWritingNote) {
        router.back();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [router, isWritingNote]);

  // --- Realtime Subscriptions ---

  const handleAnalysisChange = useCallback((payload: { new: Record<string, unknown> }) => {
    const row = payload.new;
    if (!row || row.hubspot_ticket_id !== ticketId) return;

    setTicket((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        analysis: {
          hubspot_ticket_id: row.hubspot_ticket_id as string,
          situation_summary: row.situation_summary as string,
          action_items: (row.action_items || []) as ActionItem[],
          customer_temperature: row.customer_temperature as string,
          temperature_reason: row.temperature_reason as string,
          response_guidance: row.response_guidance as string,
          response_draft: row.response_draft as string,
          context_snapshot: row.context_snapshot as string,
          related_tickets: (row.related_tickets || []) as RelatedTicketInfo[],
          hours_since_customer_waiting: row.hours_since_customer_waiting as number,
          hours_since_last_outbound: row.hours_since_last_outbound as number,
          hours_since_last_activity: row.hours_since_last_activity as number,
          status_tags: (row.status_tags || []) as string[],
          confidence: parseFloat(row.confidence as string),
          knowledge_used: row.knowledge_used as string,
          ticket_subject: row.ticket_subject as string,
          company_name: row.company_name as string,
          assigned_rep: row.assigned_rep as string,
          age_days: row.age_days as number,
          is_closed: row.is_closed as boolean,
          has_linear: row.has_linear as boolean,
          linear_state: row.linear_state as string,
          analyzed_at: row.analyzed_at as string,
        },
      };
    });
  }, [ticketId]);

  const handleCompletionInsert = useCallback((payload: { new: Record<string, unknown> }) => {
    const row = payload.new;
    if (!row || row.hubspot_ticket_id !== ticketId) return;

    setTicket((prev) => {
      if (!prev) return prev;
      if (prev.completions.some((c) => c.id === row.id)) return prev;
      return {
        ...prev,
        completions: [
          ...prev.completions,
          {
            id: row.id as string,
            actionItemId: row.action_item_id as string,
            actionDescription: row.action_description as string,
            completedBy: row.completed_by as string,
            completedByName: 'You',
            completedAt: row.completed_at as string,
            verified: row.verified as boolean | null,
            verificationNote: row.verification_note as string | null,
          },
        ],
      };
    });
  }, [ticketId]);

  const handleNoteChange = useCallback((payload: { new: Record<string, unknown> }) => {
    const row = payload.new;
    if (!row || row.hubspot_ticket_id !== ticketId) return;

    setTicket((prev) => {
      if (!prev) return prev;
      if (prev.progressNotes.some((n) => n.id === row.id)) return prev;
      return {
        ...prev,
        progressNotes: [...prev.progressNotes, {
          id: row.id as string,
          userId: row.user_id as string,
          userName: 'Unknown',
          noteText: row.note_text as string,
          createdAt: row.created_at as string,
        }],
        currentUserHasNote: prev.currentUserHasNote || row.user_id === userId,
      };
    });
  }, [ticketId, userId]);

  const handleActionItemChange = useCallback((payload: { new: Record<string, unknown> }) => {
    const row = payload.new;
    if (!row || row.hubspot_ticket_id !== ticketId) return;

    setTicket((prev) => {
      if (!prev) return prev;
      const updatedItem: LiveActionItem = {
        id: row.id as string,
        ticketId: row.hubspot_ticket_id as string,
        description: row.description as string,
        who: row.who as string,
        priority: row.priority as string,
        status: row.status as LiveActionItem['status'],
        statusTags: (row.status_tags || []) as string[],
        createdAt: row.created_at as string,
        createdByPass: row.created_by_pass as string | null,
        completedAt: row.completed_at as string | null,
        completedBy: row.completed_by as string | null,
        completedByName: null,
        completedMethod: row.completed_method as string | null,
        supersededAt: row.superseded_at as string | null,
        supersededBy: row.superseded_by as string | null,
        expiredAt: row.expired_at as string | null,
        expiredReason: row.expired_reason as string | null,
        verified: row.verified as boolean | null,
        verificationNote: row.verification_note as string | null,
        sortOrder: row.sort_order as number,
      };
      const existingIdx = prev.actionItems.findIndex((ai) => ai.id === updatedItem.id);
      const newItems = [...prev.actionItems];
      if (existingIdx >= 0) {
        newItems[existingIdx] = updatedItem;
      } else {
        newItems.push(updatedItem);
      }
      return { ...prev, actionItems: newItems };
    });
  }, [ticketId]);

  const handleTicketUpdate = useCallback((payload: { new: Record<string, unknown> }) => {
    const row = payload.new;
    if (!row || row.hubspot_ticket_id !== ticketId) return;

    setTicket((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        subject: (row.subject as string) ?? prev.subject,
        priority: (row.priority as string) ?? prev.priority,
        ballInCourt: (row.ball_in_court as string) ?? prev.ballInCourt,
        software: (row.software as string) ?? prev.software,
        companyName: (row.hs_primary_company_name as string) ?? prev.companyName,
        isCoDestiny: (row.is_co_destiny as boolean) ?? prev.isCoDestiny,
        isClosed: (row.is_closed as boolean) ?? prev.isClosed,
        lastCustomerMessageAt: (row.last_customer_message_at as string) ?? prev.lastCustomerMessageAt,
        lastAgentMessageAt: (row.last_agent_message_at as string) ?? prev.lastAgentMessageAt,
        escalationRiskScore: row.escalation_risk_score != null ? parseFloat(row.escalation_risk_score as string) : prev.escalationRiskScore,
      };
    });
  }, [ticketId]);

  const handleAlertChange = useCallback((payload: { new: Record<string, unknown> }) => {
    const row = payload.new;
    if (!row || row.hubspot_ticket_id !== ticketId) return;

    if (row.resolved_at) {
      setTicket((prev) => {
        if (!prev) return prev;
        return { ...prev, alerts: prev.alerts.filter((a) => a.id !== row.id) };
      });
      return;
    }

    const newAlert: AlertRecord = {
      id: row.id as string,
      ticketId: row.hubspot_ticket_id as string,
      alertType: row.alert_type as string,
      severity: row.severity as string,
      title: row.title as string,
      description: row.description as string,
      metadata: (row.metadata || {}) as Record<string, unknown>,
      acknowledgedBy: row.acknowledged_by as string | null,
      acknowledgedAt: row.acknowledged_at as string | null,
      createdAt: row.created_at as string,
      expiresAt: row.expires_at as string | null,
    };

    setTicket((prev) => {
      if (!prev) return prev;
      const existingIdx = prev.alerts.findIndex((a) => a.id === newAlert.id);
      const newAlerts = [...prev.alerts];
      if (existingIdx >= 0) {
        newAlerts[existingIdx] = newAlert;
      } else {
        newAlerts.unshift(newAlert);
      }
      return { ...prev, alerts: newAlerts };
    });
  }, [ticketId]);

  const realtimeSubscriptions = useMemo(() => [
    { table: 'ticket_action_board_analyses', event: '*' as const, onPayload: handleAnalysisChange },
    { table: 'action_item_completions', event: 'INSERT' as const, onPayload: handleCompletionInsert },
    { table: 'progress_notes', event: '*' as const, onPayload: handleNoteChange },
    { table: 'action_items', event: '*' as const, onPayload: handleActionItemChange },
    { table: 'support_tickets', event: 'UPDATE' as const, onPayload: handleTicketUpdate },
    { table: 'ticket_alerts', event: '*' as const, onPayload: handleAlertChange },
  ], [handleAnalysisChange, handleCompletionInsert, handleNoteChange, handleActionItemChange, handleTicketUpdate, handleAlertChange]);

  const { status: realtimeStatus } = useRealtimeSubscription({
    channelName: `ticket-detail-${ticketId}`,
    subscriptions: realtimeSubscriptions,
    enabled: !!ticket,
  });

  // --- Live Timing Recalculation (every 60s) ---

  useEffect(() => {
    const interval = setInterval(() => {
      setTicket((prev) => (prev ? { ...prev } : prev));
    }, 60_000);
    return () => clearInterval(interval);
  }, []);

  // --- Actions ---

  const handleAnalyze = async () => {
    setAnalyzing(true);
    try {
      const res = await fetch('/api/queues/support-action-board/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId }),
      });
      if (res.ok && realtimeStatus !== 'connected') {
        await fetchData();
      }
    } catch (err) {
      console.error('Analyze error:', err);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleCompleteAction = async (actionItem: LiveActionItem) => {
    const prevTicket = ticket;
    setTicket((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        actionItems: prev.actionItems.map((ai) =>
          ai.id === actionItem.id
            ? { ...ai, status: 'completed' as const, completedAt: new Date().toISOString(), completedMethod: 'manual', completedByName: 'You' }
            : ai
        ),
        completions: [...prev.completions, {
          id: `optimistic-${Date.now()}`,
          actionItemId: actionItem.id,
          actionDescription: actionItem.description,
          completedBy: userId,
          completedByName: 'You',
          completedAt: new Date().toISOString(),
          verified: null,
          verificationNote: null,
        }],
      };
    });

    try {
      const res = await fetch('/api/queues/support-action-board/complete-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticketId,
          actionItemId: actionItem.id,
          actionDescription: actionItem.description,
        }),
      });
      if (!res.ok) setTicket(prevTicket);
    } catch (err) {
      console.error('Complete action error:', err);
      setTicket(prevTicket);
    }
  };

  const handleSubmitNote = async () => {
    if (noteText.trim().length < 10) return;
    setSubmittingNote(true);

    const savedNoteText = noteText.trim();
    const prevTicket = ticket;

    setIsWritingNote(false);
    setNoteText('');

    setTicket((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        progressNotes: [...prev.progressNotes, {
          id: `optimistic-${Date.now()}`,
          userId,
          userName: 'You',
          noteText: savedNoteText,
          createdAt: new Date().toISOString(),
        }],
        currentUserHasNote: true,
      };
    });

    try {
      const res = await fetch('/api/queues/support-action-board/progress-note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId, noteText: savedNoteText }),
      });
      if (!res.ok) {
        setTicket(prevTicket);
        setIsWritingNote(true);
        setNoteText(savedNoteText);
      }
    } catch (err) {
      console.error('Submit note error:', err);
      setTicket(prevTicket);
      setIsWritingNote(true);
      setNoteText(savedNoteText);
    } finally {
      setSubmittingNote(false);
    }
  };

  const handleAcknowledgeAlert = async (alertId: string) => {
    setTicket((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        alerts: prev.alerts.map((a) =>
          a.id === alertId ? { ...a, acknowledgedBy: userId, acknowledgedAt: new Date().toISOString() } : a
        ),
      };
    });

    try {
      await fetch('/api/queues/support-action-board/acknowledge-alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alertId }),
      });
    } catch (err) {
      console.error('Acknowledge alert error:', err);
    }
  };

  // --- Derived State ---

  const a = ticket?.analysis;
  const customerWaitHours = ticket
    ? computeLiveHours(ticket.lastCustomerMessageAt, ticket.lastAgentMessageAt) ?? a?.hours_since_customer_waiting ?? null
    : null;

  const activeItems = ticket?.actionItems.filter((ai) => ai.status === 'active') || [];
  const completedItems = ticket?.actionItems.filter((ai) => ai.status === 'completed') || [];
  const supersededItems = ticket?.actionItems.filter((ai) => ai.status === 'superseded') || [];
  const expiredItems = ticket?.actionItems.filter((ai) => ai.status === 'expired') || [];
  const hasLivingItems = (ticket?.actionItems.length || 0) > 0;
  const legacyCompletedIds = new Set(ticket?.completions.map((c) => c.actionItemId) || []);

  // --- Render ---

  if (loading) return <DetailSkeleton />;

  if (error || !ticket) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-slate-950 text-white gap-4">
        <p className="text-red-400 text-lg">{error || 'Ticket not found'}</p>
        <button
          onClick={() => router.back()}
          className="px-4 py-2 text-sm bg-slate-800 text-gray-300 rounded hover:bg-slate-700"
        >
          Back to Action Board
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-slate-950 text-white">
      {/* Header */}
      <div className="border-b border-slate-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 min-w-0">
            <button
              onClick={() => router.back()}
              className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition-colors flex-shrink-0"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back
            </button>

            <div className="h-5 w-px bg-slate-700 flex-shrink-0" />

            <div className="flex items-center gap-2 min-w-0">
              {ticket.isCoDestiny && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 flex-shrink-0">
                  VIP
                </span>
              )}
              <span className="text-sm font-medium text-gray-200 truncate">
                {ticket.companyName || 'Unknown Company'}
              </span>
              <span className="text-gray-600 flex-shrink-0">·</span>
              <span className="text-sm text-gray-400 truncate">
                {ticket.subject || 'No subject'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-shrink-0">
            {a && <TemperatureBadge temp={a.customer_temperature} />}
            <EscalationRiskBadge score={ticket.escalationRiskScore} />
            <ConnectionIndicator status={realtimeStatus} />

            {/* External links */}
            <a
              href={getHubSpotTicketUrl(ticket.ticketId)}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 text-xs bg-orange-600 text-white rounded hover:bg-orange-700"
            >
              HubSpot
            </a>
            {ticket.linearTask && (
              <a
                href={ticket.linearTask.startsWith('http') ? ticket.linearTask : `https://linear.app/issue/${ticket.linearTask}`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 text-xs bg-purple-600 text-white rounded hover:bg-purple-700 flex items-center gap-1"
              >
                Linear {a?.linear_state && <LinearBadge state={a.linear_state} />}
              </a>
            )}

            {/* Re-analyze */}
            {canAnalyzeTicket && (
              <button
                onClick={handleAnalyze}
                disabled={analyzing}
                className="px-3 py-1.5 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
              >
                {analyzing ? 'Analyzing...' : a ? 'Re-analyze' : 'Analyze'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 max-w-7xl">
          {/* Left Column — Analysis */}
          <div className="lg:col-span-2 space-y-4">
            {/* Situation Summary */}
            {a ? (
              <div className="bg-slate-900 border border-slate-700 rounded-lg p-5">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Situation</h3>
                <p className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">{a.situation_summary}</p>
              </div>
            ) : (
              <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 text-center">
                <p className="text-gray-400 mb-3">This ticket has not been analyzed yet.</p>
                {canAnalyzeTicket && (
                  <button
                    onClick={handleAnalyze}
                    disabled={analyzing}
                    className="px-4 py-2 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {analyzing ? 'Analyzing...' : 'Analyze Now'}
                  </button>
                )}
              </div>
            )}

            {/* Action Items */}
            {(hasLivingItems || (a && a.action_items.length > 0)) && (
              <div className="bg-slate-900 border border-slate-700 rounded-lg p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    Action Items
                    {hasLivingItems && (
                      <span className="ml-2 text-gray-500 font-normal normal-case">
                        {activeItems.length} active
                        {completedItems.length > 0 && `, ${completedItems.length} done`}
                        {supersededItems.length > 0 && `, ${supersededItems.length} replaced`}
                      </span>
                    )}
                  </h3>
                  <div className="flex items-center gap-3">
                    {completedItems.length > 0 && (
                      <button
                        onClick={() => setShowCompletedItems(!showCompletedItems)}
                        className="text-[10px] text-gray-500 hover:text-gray-300"
                      >
                        {showCompletedItems ? 'Hide completed' : `Show ${completedItems.length} completed`}
                      </button>
                    )}
                    {expiredItems.length > 0 && (
                      <button
                        onClick={() => setShowExpiredItems(!showExpiredItems)}
                        className="text-[10px] text-gray-500 hover:text-gray-300"
                      >
                        {showExpiredItems ? 'Hide expired' : `Show ${expiredItems.length} expired`}
                      </button>
                    )}
                  </div>
                </div>
                <div className="space-y-3">
                  {hasLivingItems ? (
                    <>
                      {activeItems.map((item) => (
                        <ActionItemCard
                          key={item.id}
                          item={item}
                          onComplete={() => handleCompleteAction(item)}
                        />
                      ))}

                      {showCompletedItems && completedItems.map((item) => (
                        <ActionItemCard key={item.id} item={item} />
                      ))}

                      {/* Superseded items always shown (they provide context) */}
                      {supersededItems.map((item) => (
                        <ActionItemCard key={item.id} item={item} />
                      ))}

                      {showExpiredItems && expiredItems.map((item) => (
                        <ActionItemCard key={item.id} item={item} />
                      ))}

                      {activeItems.length === 0 && completedItems.length === 0 && (
                        <p className="text-sm text-gray-500">No active action items.</p>
                      )}
                    </>
                  ) : a ? (
                    <>
                      {/* Legacy fallback: render from analysis JSONB (pre-migration) */}
                      {a.action_items.map((item) => {
                        const isCompleted = legacyCompletedIds.has(item.id);
                        const completion = ticket.completions.find((c) => c.actionItemId === item.id);
                        return (
                          <div
                            key={item.id}
                            className={`flex items-start gap-3 p-3 rounded-lg ${isCompleted ? 'bg-emerald-950/30 border border-emerald-900' : 'bg-slate-800'}`}
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <PriorityBadge priority={item.priority} />
                                <WhoBadge who={item.who} />
                              </div>
                              <p className={`text-sm ${isCompleted ? 'line-through text-gray-500' : 'text-gray-200'}`}>{item.description}</p>
                              {isCompleted && completion && (
                                <p className="text-xs text-gray-500 mt-1">Completed by {completion.completedByName}</p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                      {a.action_items.length === 0 && (
                        <p className="text-sm text-gray-500">No action items extracted.</p>
                      )}
                    </>
                  ) : null}
                </div>
              </div>
            )}

            {/* Customer Temperature */}
            {a && (
              <div className="bg-slate-900 border border-slate-700 rounded-lg p-5">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Customer Temperature</h3>
                <div className="flex items-center gap-3">
                  <TemperatureBadge temp={a.customer_temperature} />
                  <EscalationRiskBadge score={ticket.escalationRiskScore} />
                  {a.temperature_reason && (
                    <span className="text-sm text-gray-300">{a.temperature_reason}</span>
                  )}
                </div>
              </div>
            )}

            {/* Active Alerts */}
            {ticket.alerts && ticket.alerts.length > 0 && (
              <div className="bg-slate-900 border border-slate-700 rounded-lg p-5">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                  Alerts ({ticket.alerts.length})
                </h3>
                <div className="space-y-2">
                  {ticket.alerts.map((alert) => (
                    <div
                      key={alert.id}
                      className={`flex items-start justify-between p-3 rounded-lg ${
                        alert.severity === 'critical' ? 'bg-red-950/30 border border-red-900' :
                        alert.severity === 'warning' ? 'bg-orange-950/30 border border-orange-900' :
                        'bg-blue-950/30 border border-blue-900'
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <AlertSeverityBadge severity={alert.severity} label={alert.title} />
                          <span className="text-[10px] text-gray-500">
                            <AnalyzedTimestamp dateStr={alert.createdAt} />
                          </span>
                        </div>
                        <p className="text-sm text-gray-300">{alert.description}</p>
                      </div>
                      {!alert.acknowledgedBy && (
                        <button
                          onClick={() => handleAcknowledgeAlert(alert.id)}
                          className="ml-2 text-[10px] text-gray-500 hover:text-gray-300 whitespace-nowrap"
                          title="Dismiss this alert for yourself"
                        >
                          Dismiss
                        </button>
                      )}
                      {alert.acknowledgedBy && (
                        <span className="ml-2 text-[10px] text-gray-600 whitespace-nowrap">Dismissed</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Context Snapshot (collapsed) */}
            {a?.context_snapshot && (
              <CollapsibleSection title="Context">
                <p className="text-sm text-gray-300 whitespace-pre-wrap">{a.context_snapshot}</p>
              </CollapsibleSection>
            )}

            {/* Related Tickets (collapsed) */}
            {a && a.related_tickets.length > 0 && (
              <CollapsibleSection
                title="Related Tickets"
                badge={<span className="text-[10px] text-amber-400 font-normal normal-case">Same Company</span>}
              >
                <div className="space-y-1">
                  {a.related_tickets.map((rt) => (
                    <div key={rt.ticketId} className="text-sm text-gray-300">
                      <span className="font-mono text-amber-400">#{rt.ticketId}</span> — {rt.subject}
                    </div>
                  ))}
                </div>
              </CollapsibleSection>
            )}

            {/* Ticket Timeline (collapsed, lazy-loaded) */}
            <TicketTimeline ticketId={ticket.ticketId} />

            {/* Knowledge Used */}
            {a?.knowledge_used && a.knowledge_used !== 'none' && (
              <div className="text-xs text-gray-500 italic px-1">
                Knowledge: {a.knowledge_used}
              </div>
            )}
          </div>

          {/* Right Column — Metadata & Actions (sticky) */}
          <div className="space-y-4 lg:self-start lg:sticky lg:top-6">
            {/* Ticket Metadata */}
            <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Ticket Details</h3>
              <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-sm">
                <span className="text-gray-500">Subject</span>
                <span className="text-gray-200 truncate" title={ticket.subject || undefined}>{ticket.subject || 'N/A'}</span>
                <span className="text-gray-500">Rep</span>
                <span className="text-gray-200">{ticket.assignedRep || 'Unassigned'}</span>
                <span className="text-gray-500">Source</span>
                <span className="text-gray-200">{ticket.sourceType || 'N/A'}</span>
                <span className="text-gray-500">Priority</span>
                <span className="text-gray-200">{ticket.priority || 'N/A'}</span>
                <span className="text-gray-500">Software</span>
                <span className="text-gray-200">{ticket.software || 'N/A'}</span>
                <span className="text-gray-500">Ball In Court</span>
                <span className="text-gray-200">{ticket.ballInCourt || 'N/A'}</span>
                <span className="text-gray-500">Age</span>
                <span className="text-gray-200 font-mono">{ticket.ageDays}d</span>
                {a && (
                  <>
                    <span className="text-gray-500">Confidence</span>
                    <span className="text-gray-200">{Math.round(a.confidence * 100)}%</span>
                  </>
                )}
                {ticket.isCoDestiny && (
                  <>
                    <span className="text-gray-500">Status</span>
                    <span className="text-amber-400 font-semibold">Co-Destiny (VIP)</span>
                  </>
                )}
              </div>
            </div>

            {/* Response Clocks */}
            <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Response Clocks</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Customer waiting</span>
                  <ResponseClock hours={customerWaitHours} />
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Last outbound</span>
                  <ResponseClock hours={a?.hours_since_last_outbound ?? null} />
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Last activity</span>
                  <ResponseClock hours={a?.hours_since_last_activity ?? null} />
                </div>
              </div>
            </div>

            {/* Progress Note */}
            <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Progress Note</h3>

              {isWritingNote ? (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1.5">
                      What&apos;s the current status of this ticket and what, if anything, did you do on it this shift?
                    </label>
                    <textarea
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      placeholder="Describe what you did or the current status..."
                      rows={4}
                      className="w-full bg-slate-800 text-sm text-white rounded px-3 py-2 border border-slate-600 resize-none focus:border-indigo-500 focus:outline-none"
                      autoFocus
                    />
                    {noteText.trim().length > 0 && noteText.trim().length < 10 && (
                      <p className="text-xs text-red-400 mt-1">Minimum 10 characters</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleSubmitNote}
                      disabled={submittingNote || noteText.trim().length < 10}
                      className="flex-1 px-3 py-1.5 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {submittingNote ? 'Saving...' : 'Save Note'}
                    </button>
                    <button
                      onClick={() => { setIsWritingNote(false); setNoteText(''); }}
                      className="px-3 py-1.5 text-xs text-gray-400 hover:text-white"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : ticket.currentUserHasNote ? (
                <div>
                  <div className="flex items-center gap-2 text-emerald-400 text-sm mb-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Note submitted
                  </div>
                  <button
                    onClick={() => {
                      const existingNote = ticket.progressNotes.find((n) => n.userId === userId);
                      setIsWritingNote(true);
                      setNoteText(existingNote?.noteText || '');
                    }}
                    className="text-xs text-indigo-400 hover:text-indigo-300"
                  >
                    Edit note
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setIsWritingNote(true)}
                  className="w-full px-3 py-2 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700"
                >
                  Write Progress Note
                </button>
              )}
            </div>

            {/* Today's Progress Notes */}
            {ticket.progressNotes.length > 0 && (
              <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                  Today&apos;s Notes ({ticket.progressNotes.length})
                </h3>
                <div className="space-y-3">
                  {ticket.progressNotes.map((note: ProgressNoteInfo) => (
                    <div key={note.id} className="text-xs">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-gray-300">
                          {note.userId === userId ? 'You' : note.userName}
                        </span>
                        <span className="text-gray-600">
                          {new Date(note.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="text-gray-400 pl-2 border-l border-slate-700 whitespace-pre-wrap">{note.noteText}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
