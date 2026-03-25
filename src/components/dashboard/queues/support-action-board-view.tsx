'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { ActionBoardResponse, ActionBoardTicket, LiveActionItem } from '@/app/api/queues/support-action-board/route';
import type { ActionItem } from '@/app/api/queues/support-action-board/analyze/analyze-core';
import { useRealtimeSubscription } from '@/hooks/use-realtime-subscription';
import type { AlertRecord } from '@/lib/ai/intelligence/alert-utils';
import type { ProgressNoteInfo } from '@/app/api/queues/support-action-board/route';
import {
  ResponseClock,
  ConnectionIndicator,
  TemperatureBadge,
  EscalationRiskBadge,
  AnalyzedTimestamp,
  computeLiveHours,
} from './action-board/badges';
import { PatternSummaryBar } from './action-board/pattern-summary-bar';

// --- Types ---

type StatusFilter = 'all' | 'reply_needed' | 'update_due' | 'engineering_ping' | 'internal_action' | 'waiting_on_customer' | 'unnoted';
type SortColumn = 'responseWait' | 'companyName' | 'ageDays' | 'temperature' | 'analyzedAt';
type SortDirection = 'asc' | 'desc';

interface Props {
  userRole: string;
  canAnalyzeTicket: boolean;
}

// --- Main Component ---

export function SupportActionBoardView({ canAnalyzeTicket }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Initialize from URL params
  const [data, setData] = useState<ActionBoardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(
    (searchParams.get('filter') as StatusFilter) || 'all'
  );
  const [vipFilter, setVipFilter] = useState(searchParams.get('vip') === '1');
  const [sortColumn, setSortColumn] = useState<SortColumn>(
    (searchParams.get('sort') as SortColumn) || 'responseWait'
  );
  const [sortDirection, setSortDirection] = useState<SortDirection>(
    (searchParams.get('dir') as SortDirection) || 'desc'
  );
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [batchAnalyzing, setBatchAnalyzing] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number; subject: string } | null>(null);

  // --- Sync filter/sort to URL ---

  useEffect(() => {
    const params = new URLSearchParams();
    if (statusFilter !== 'all') params.set('filter', statusFilter);
    if (vipFilter) params.set('vip', '1');
    if (sortColumn !== 'responseWait') params.set('sort', sortColumn);
    if (sortDirection !== 'desc') params.set('dir', sortDirection);
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : '?', { scroll: false });
  }, [statusFilter, vipFilter, sortColumn, sortDirection, router]);

  // --- Data Fetching ---

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/queues/support-action-board');
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (err) {
      console.error('Failed to fetch action board data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // --- Realtime Subscriptions ---

  const handleAnalysisChange = useCallback((payload: { new: Record<string, unknown> }) => {
    const row = payload.new;
    if (!row || !row.hubspot_ticket_id) return;
    const ticketId = row.hubspot_ticket_id as string;

    setData((prev) => {
      if (!prev) return prev;
      const updatedTickets = prev.tickets.map((t) => {
        if (t.ticketId !== ticketId) return t;
        return {
          ...t,
          analysis: {
            hubspot_ticket_id: row.hubspot_ticket_id as string,
            situation_summary: row.situation_summary as string,
            action_items: (row.action_items || []) as ActionItem[],
            customer_temperature: row.customer_temperature as string,
            temperature_reason: row.temperature_reason as string,
            response_guidance: row.response_guidance as string,
            response_draft: row.response_draft as string,
            context_snapshot: row.context_snapshot as string,
            related_tickets: (row.related_tickets || []) as import('@/app/api/queues/support-action-board/analyze/analyze-core').RelatedTicketInfo[],
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
      return { ...prev, tickets: updatedTickets };
    });
  }, []);

  const handleCompletionInsert = useCallback((payload: { new: Record<string, unknown> }) => {
    const row = payload.new;
    if (!row || !row.hubspot_ticket_id) return;
    const ticketId = row.hubspot_ticket_id as string;

    setData((prev) => {
      if (!prev) return prev;
      const updatedTickets = prev.tickets.map((t) => {
        if (t.ticketId !== ticketId) return t;
        if (t.completions.some((c) => c.id === row.id)) return t;
        return {
          ...t,
          completions: [
            ...t.completions,
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
      return { ...prev, tickets: updatedTickets };
    });
  }, []);

  const handleNoteChange = useCallback((payload: { new: Record<string, unknown> }) => {
    const row = payload.new;
    if (!row || !row.hubspot_ticket_id) return;
    const ticketId = row.hubspot_ticket_id as string;

    setData((prev) => {
      if (!prev) return prev;
      const updatedTickets = prev.tickets.map((t) => {
        if (t.ticketId !== ticketId) return t;
        if (t.progressNotes.some((n) => n.id === row.id)) return t;
        const newNote: ProgressNoteInfo = {
          id: row.id as string,
          userId: row.user_id as string,
          userName: 'Unknown',
          noteText: row.note_text as string,
          createdAt: row.created_at as string,
        };
        return {
          ...t,
          progressNotes: [...t.progressNotes, newNote],
          currentUserHasNote: t.currentUserHasNote || row.user_id === prev.userId,
        };
      });
      return { ...prev, tickets: updatedTickets };
    });
  }, []);

  const handleActionItemChange = useCallback((payload: { new: Record<string, unknown> }) => {
    const row = payload.new;
    if (!row || !row.hubspot_ticket_id) return;
    const ticketId = row.hubspot_ticket_id as string;

    setData((prev) => {
      if (!prev) return prev;
      const updatedTickets = prev.tickets.map((t) => {
        if (t.ticketId !== ticketId) return t;
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
        const existingIdx = t.actionItems.findIndex((ai) => ai.id === updatedItem.id);
        const newItems = [...t.actionItems];
        if (existingIdx >= 0) {
          newItems[existingIdx] = updatedItem;
        } else {
          newItems.push(updatedItem);
        }
        return { ...t, actionItems: newItems };
      });
      return { ...prev, tickets: updatedTickets };
    });
  }, []);

  const handleTicketUpdate = useCallback((payload: { new: Record<string, unknown> }) => {
    const row = payload.new;
    if (!row || !row.hubspot_ticket_id) return;
    const ticketId = row.hubspot_ticket_id as string;

    setData((prev) => {
      if (!prev) return prev;
      const updatedTickets = prev.tickets.map((t) => {
        if (t.ticketId !== ticketId) return t;
        return {
          ...t,
          subject: (row.subject as string) ?? t.subject,
          priority: (row.priority as string) ?? t.priority,
          ballInCourt: (row.ball_in_court as string) ?? t.ballInCourt,
          software: (row.software as string) ?? t.software,
          companyName: (row.hs_primary_company_name as string) ?? t.companyName,
          isCoDestiny: (row.is_co_destiny as boolean) ?? t.isCoDestiny,
          isClosed: (row.is_closed as boolean) ?? t.isClosed,
          lastCustomerMessageAt: (row.last_customer_message_at as string) ?? t.lastCustomerMessageAt,
          lastAgentMessageAt: (row.last_agent_message_at as string) ?? t.lastAgentMessageAt,
          escalationRiskScore: row.escalation_risk_score != null ? parseFloat(row.escalation_risk_score as string) : t.escalationRiskScore,
        };
      });
      return { ...prev, tickets: updatedTickets };
    });
  }, []);

  const handleAlertChange = useCallback((payload: { new: Record<string, unknown> }) => {
    const row = payload.new;
    if (!row || !row.hubspot_ticket_id) return;
    const ticketId = row.hubspot_ticket_id as string;

    if (row.resolved_at) {
      setData((prev) => {
        if (!prev) return prev;
        const updatedTickets = prev.tickets.map((t) => {
          if (t.ticketId !== ticketId) return t;
          return { ...t, alerts: t.alerts.filter((a) => a.id !== row.id) };
        });
        return { ...prev, tickets: updatedTickets };
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

    setData((prev) => {
      if (!prev) return prev;
      const updatedTickets = prev.tickets.map((t) => {
        if (t.ticketId !== ticketId) return t;
        const existingIdx = t.alerts.findIndex((a) => a.id === newAlert.id);
        const newAlerts = [...t.alerts];
        if (existingIdx >= 0) {
          newAlerts[existingIdx] = newAlert;
        } else {
          newAlerts.unshift(newAlert);
        }
        return { ...t, alerts: newAlerts };
      });
      return { ...prev, tickets: updatedTickets };
    });
  }, []);

  const realtimeSubscriptions = useMemo(() => [
    { table: 'ticket_action_board_analyses', event: '*' as const, onPayload: handleAnalysisChange },
    { table: 'action_item_completions', event: 'INSERT' as const, onPayload: handleCompletionInsert },
    { table: 'progress_notes', event: '*' as const, onPayload: handleNoteChange },
    { table: 'action_items', event: '*' as const, onPayload: handleActionItemChange },
    { table: 'support_tickets', event: 'UPDATE' as const, onPayload: handleTicketUpdate },
    { table: 'ticket_alerts', event: '*' as const, onPayload: handleAlertChange },
  ], [handleAnalysisChange, handleCompletionInsert, handleNoteChange, handleActionItemChange, handleTicketUpdate, handleAlertChange]);

  const { status: realtimeStatus } = useRealtimeSubscription({
    channelName: 'action-board-live',
    subscriptions: realtimeSubscriptions,
    enabled: !!data,
  });

  // --- Live Timing Recalculation (every 60s) ---

  useEffect(() => {
    const interval = setInterval(() => {
      setData((prev) => {
        if (!prev) return prev;
        return { ...prev, tickets: [...prev.tickets] };
      });
    }, 60_000);
    return () => clearInterval(interval);
  }, []);

  // --- Actions ---

  const handleAnalyze = async (ticketId: string) => {
    setAnalyzing(ticketId);
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
      setAnalyzing(null);
    }
  };

  const handleBatchAnalyze = async (ticketIds: string[]) => {
    setBatchAnalyzing(true);
    setBatchProgress({ current: 0, total: ticketIds.length, subject: '' });

    try {
      const res = await fetch('/api/queues/support-action-board/batch-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketIds }),
      });

      if (!res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value);
        const lines = text.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const event = JSON.parse(line.slice(6));
            if (event.type === 'progress') {
              setBatchProgress({ current: event.index, total: event.total, subject: event.ticketSubject });
            } else if (event.type === 'done') {
              setBatchProgress(null);
            }
          }
        }
      }

      await fetchData();
    } catch (err) {
      console.error('Batch analyze error:', err);
    } finally {
      setBatchAnalyzing(false);
      setBatchProgress(null);
    }
  };

  // --- Filtering and Sorting ---

  const filteredTickets = useMemo(() => {
    if (!data) return [];
    let tickets = data.tickets;

    if (vipFilter) {
      tickets = tickets.filter((t) => t.isCoDestiny);
    }

    if (statusFilter === 'unnoted') {
      tickets = tickets.filter((t) => !t.currentUserHasNote);
    } else if (statusFilter !== 'all') {
      tickets = tickets.filter(
        (t) => t.analysis && t.analysis.status_tags.includes(statusFilter)
      );
    }

    const tempOrder: Record<string, number> = { angry: 0, escalating: 1, frustrated: 2, calm: 3 };

    tickets = [...tickets].sort((a, b) => {
      const dir = sortDirection === 'asc' ? 1 : -1;

      switch (sortColumn) {
        case 'responseWait': {
          const aWait = computeLiveHours(a.lastCustomerMessageAt, a.lastAgentMessageAt) ?? a.analysis?.hours_since_customer_waiting ?? 0;
          const bWait = computeLiveHours(b.lastCustomerMessageAt, b.lastAgentMessageAt) ?? b.analysis?.hours_since_customer_waiting ?? 0;
          return (aWait - bWait) * dir;
        }
        case 'companyName':
          return ((a.companyName || '').localeCompare(b.companyName || '')) * dir;
        case 'ageDays':
          return (a.ageDays - b.ageDays) * dir;
        case 'temperature': {
          const aTemp = tempOrder[a.analysis?.customer_temperature ?? 'calm'] ?? 4;
          const bTemp = tempOrder[b.analysis?.customer_temperature ?? 'calm'] ?? 4;
          return (aTemp - bTemp) * dir;
        }
        case 'analyzedAt': {
          const aTime = a.analysis ? new Date(a.analysis.analyzed_at).getTime() : 0;
          const bTime = b.analysis ? new Date(b.analysis.analyzed_at).getTime() : 0;
          return (aTime - bTime) * dir;
        }
        default:
          return 0;
      }
    });

    return tickets;
  }, [data, statusFilter, vipFilter, sortColumn, sortDirection]);

  const handleSort = (col: SortColumn) => {
    if (sortColumn === col) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(col);
      setSortDirection(col === 'responseWait' ? 'desc' : 'asc');
    }
  };

  const sortArrow = (col: SortColumn) => {
    if (sortColumn !== col) return '';
    return sortDirection === 'asc' ? ' ↑' : ' ↓';
  };

  // --- Row Click Navigation ---

  const handleRowClick = (ticketId: string) => {
    router.push(`/dashboard/queues/support-action-board/${ticketId}`);
  };

  // --- Render ---

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">Loading Action Board...</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-red-400">Failed to load Action Board data.</div>
      </div>
    );
  }

  const unanalyzedIds = data.tickets.filter((t) => !t.analysis).map((t) => t.ticketId);
  const analyzedIds = data.tickets.filter((t) => t.analysis).map((t) => t.ticketId);
  const allTicketIds = data.tickets.map((t) => t.ticketId);
  const changedIds = data.changedTicketIds || [];
  const vipCount = data.tickets.filter((t) => t.isCoDestiny).length;

  return (
    <div className="h-full flex flex-col bg-slate-950 text-white">
      {/* Header */}
      <div className="border-b border-slate-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-semibold">Support Action Board</h1>
              <ConnectionIndicator status={realtimeStatus} />
            </div>
            <p className="text-sm text-gray-400 mt-0.5">
              {data.counts.total} open tickets · {data.counts.analyzed} analyzed · {data.counts.unanalyzed} pending
            </p>
          </div>
          <div className="flex items-center gap-2">
            {canAnalyzeTicket && unanalyzedIds.length > 0 && (
              <button
                onClick={() => handleBatchAnalyze(unanalyzedIds)}
                disabled={batchAnalyzing}
                className="px-3 py-1.5 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
              >
                Analyze New ({unanalyzedIds.length})
              </button>
            )}
            {canAnalyzeTicket && analyzedIds.length > 0 && (
              <button
                onClick={() => handleBatchAnalyze(analyzedIds)}
                disabled={batchAnalyzing}
                className="px-3 py-1.5 text-xs border border-slate-600 text-slate-300 rounded hover:bg-slate-800 disabled:opacity-50"
              >
                Re-analyze All ({analyzedIds.length})
              </button>
            )}
            {canAnalyzeTicket && allTicketIds.length > 0 && (
              <button
                onClick={() => handleBatchAnalyze(allTicketIds)}
                disabled={batchAnalyzing}
                className="px-3 py-1.5 text-xs border border-slate-600 text-slate-300 rounded hover:bg-slate-800 disabled:opacity-50"
              >
                Analyze Everything ({allTicketIds.length})
              </button>
            )}
            {canAnalyzeTicket && changedIds.length > 0 && (
              <button
                onClick={() => handleBatchAnalyze(changedIds)}
                disabled={batchAnalyzing}
                className="px-3 py-1.5 text-xs border border-amber-600 text-amber-300 rounded hover:bg-amber-900/30 disabled:opacity-50"
              >
                Analyze Changed ({changedIds.length})
              </button>
            )}
            <button
              onClick={() => { setLoading(true); fetchData(); }}
              className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-slate-800"
              title="Refresh"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        </div>

        {/* Batch progress */}
        {batchProgress && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
              <span>Analyzing {batchProgress.current}/{batchProgress.total}</span>
              <span className="truncate ml-2">{batchProgress.subject}</span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-1.5">
              <div
                className="bg-indigo-500 h-1.5 rounded-full transition-all"
                style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Note Progress Banner */}
      <div className="border-b border-slate-800 px-6 py-3 bg-slate-900">
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-300">
            Progress Notes: <strong className="text-white">{data.noteProgress.noted}</strong> of <strong className="text-white">{data.noteProgress.total}</strong> tickets
          </span>
          <div className="w-48 bg-slate-800 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all ${
                data.noteProgress.noted === data.noteProgress.total
                  ? 'bg-emerald-500'
                  : 'bg-indigo-500'
              }`}
              style={{ width: `${data.noteProgress.total > 0 ? (data.noteProgress.noted / data.noteProgress.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="px-6 py-3 flex items-center gap-2 flex-wrap">
        {(['all', 'reply_needed', 'update_due', 'engineering_ping', 'internal_action', 'waiting_on_customer', 'unnoted'] as StatusFilter[]).map((filter) => {
          const labels: Record<StatusFilter, string> = {
            all: `All (${data.counts.total})`,
            reply_needed: `Reply Needed (${data.counts.byStatus.reply_needed || 0})`,
            update_due: `Update Due (${data.counts.byStatus.update_due || 0})`,
            engineering_ping: `Eng Ping (${data.counts.byStatus.engineering_ping || 0})`,
            internal_action: `Internal (${data.counts.byStatus.internal_action || 0})`,
            waiting_on_customer: `Waiting (${data.counts.byStatus.waiting_on_customer || 0})`,
            unnoted: `Unnoted (${data.noteProgress.total - data.noteProgress.noted})`,
          };
          return (
            <button
              key={filter}
              onClick={() => setStatusFilter(filter)}
              className={`px-3 py-1 text-xs rounded-full transition-colors ${
                statusFilter === filter
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-800 text-gray-400 hover:bg-slate-700'
              }`}
            >
              {labels[filter]}
            </button>
          );
        })}
        {/* VIP Filter Toggle */}
        <button
          onClick={() => setVipFilter((v) => !v)}
          className={`px-3 py-1 text-xs rounded-full transition-colors ${
            vipFilter
              ? 'bg-amber-600 text-white'
              : 'bg-slate-800 text-amber-400 hover:bg-slate-700'
          }`}
        >
          VIP ({vipCount})
        </button>
      </div>

      {/* Pattern Summary Bar (collapsed by default) */}
      <PatternSummaryBar patterns={data.patterns || []} />

      {/* Global Alert Summary */}
      {(() => {
        const allAlerts = data.tickets.flatMap((t) => t.alerts || []);
        const criticalCount = allAlerts.filter((a) => a.severity === 'critical').length;
        const warningCount = allAlerts.filter((a) => a.severity === 'warning').length;
        if (criticalCount === 0 && warningCount === 0) return null;
        return (
          <div className="px-6 py-2">
            <div className="flex items-center gap-3 text-xs">
              {criticalCount > 0 && (
                <span className="flex items-center gap-1 text-red-400">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  {criticalCount} critical alert{criticalCount !== 1 ? 's' : ''}
                </span>
              )}
              {warningCount > 0 && (
                <span className="flex items-center gap-1 text-orange-400">
                  <span className="w-2 h-2 rounded-full bg-orange-500" />
                  {warningCount} warning{warningCount !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>
        );
      })()}

      {/* Ticket List */}
      <div className="flex-1 overflow-auto px-6">
        {/* Column Headers */}
        <div className="flex items-center gap-3 py-2 text-[10px] font-medium text-gray-500 uppercase tracking-wider border-b border-slate-800 sticky top-0 bg-slate-950 z-10">
          <div className="w-20">
            <button onClick={() => handleSort('responseWait')} className="hover:text-gray-300">
              Wait{sortArrow('responseWait')}
            </button>
          </div>
          <div className="w-8">Tags</div>
          <div className="w-40">
            <button onClick={() => handleSort('companyName')} className="hover:text-gray-300">
              Company{sortArrow('companyName')}
            </button>
          </div>
          <div className="flex-1">Summary</div>
          <div className="w-12">
            <button onClick={() => handleSort('ageDays')} className="hover:text-gray-300">
              Age{sortArrow('ageDays')}
            </button>
          </div>
          <div className="w-16">
            <button onClick={() => handleSort('temperature')} className="hover:text-gray-300">
              Temp{sortArrow('temperature')}
            </button>
          </div>
          <div className="w-20">Notes</div>
          <div className="w-6">You</div>
          <div className="w-16">
            <button onClick={() => handleSort('analyzedAt')} className="hover:text-gray-300">
              Analyzed{sortArrow('analyzedAt')}
            </button>
          </div>
          <div className="w-20" />
        </div>

        {/* Ticket Rows */}
        {filteredTickets.map((ticket) => (
          <TicketRow
            key={ticket.ticketId}
            ticket={ticket}
            onRowClick={() => handleRowClick(ticket.ticketId)}
            onAnalyze={() => handleAnalyze(ticket.ticketId)}
            analyzing={analyzing === ticket.ticketId}
            canAnalyze={canAnalyzeTicket}
          />
        ))}

        {filteredTickets.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            No tickets match the current filter.
          </div>
        )}
      </div>
    </div>
  );
}

// --- Ticket Row Component (list-only, no expansion) ---

interface TicketRowProps {
  ticket: ActionBoardTicket;
  onRowClick: () => void;
  onAnalyze: () => void;
  analyzing: boolean;
  canAnalyze: boolean;
}

function TicketRow({
  ticket,
  onRowClick,
  onAnalyze,
  analyzing,
  canAnalyze,
}: TicketRowProps) {
  const a = ticket.analysis;
  const customerWaitHours = computeLiveHours(ticket.lastCustomerMessageAt, ticket.lastAgentMessageAt) ?? a?.hours_since_customer_waiting ?? null;

  return (
    <div className={`border-b border-slate-800 ${!ticket.currentUserHasNote ? 'border-l-2 border-l-indigo-500' : ''}`}>
      <div
        className="flex items-center gap-3 py-3 cursor-pointer hover:bg-slate-900 transition-colors"
        onClick={onRowClick}
      >
        {/* Response Clock */}
        <div className="w-20">
          <ResponseClock hours={customerWaitHours} />
        </div>

        {/* Status Tags + Alert Indicators */}
        <div className="w-8 flex flex-wrap gap-0.5">
          {(a?.status_tags || []).slice(0, 2).map((tag) => (
            <div
              key={tag}
              className={`w-2 h-2 rounded-full ${
                tag === 'reply_needed' ? 'bg-red-500' :
                tag === 'update_due' ? 'bg-yellow-400' :
                tag === 'engineering_ping' ? 'bg-purple-500' :
                tag === 'internal_action' ? 'bg-blue-500' :
                'bg-gray-400'
              }`}
              title={tag}
            />
          ))}
          {(ticket.alerts || []).some((al) => al.alertType === 'sla_warning' && al.severity === 'critical') && (
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" title="SLA Critical" />
          )}
          {(ticket.alerts || []).some((al) => al.alertType === 'stale' && al.severity !== 'info') && (
            <div className="w-2 h-2 rounded-full bg-gray-400 animate-pulse" title="Stale" />
          )}
        </div>

        {/* Company */}
        <div className="w-40 flex items-center gap-1.5 truncate text-sm font-medium">
          {ticket.isCoDestiny && (
            <span className="inline-flex items-center px-1 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30" title="Co-Destiny (VIP)">VIP</span>
          )}
          <span className="truncate">{ticket.companyName || 'Unknown'}</span>
        </div>

        {/* Summary */}
        <div className="flex-1 truncate text-sm text-gray-400">
          {a?.situation_summary || ticket.subject || 'Not analyzed'}
        </div>

        {/* Age */}
        <div className="w-12 text-right text-xs text-gray-400 font-mono">{ticket.ageDays}d</div>

        {/* Temperature + Escalation Risk */}
        <div className="w-16 flex flex-col gap-0.5">
          {a ? <TemperatureBadge temp={a.customer_temperature} /> : <span className="text-xs text-gray-500">--</span>}
          <EscalationRiskBadge score={ticket.escalationRiskScore} />
        </div>

        {/* Notes count */}
        <div className="w-20 text-xs text-gray-400">
          {ticket.progressNotes.length > 0 ? (
            <span>{ticket.progressNotes.length} note{ticket.progressNotes.length !== 1 ? 's' : ''}</span>
          ) : (
            <span className="text-gray-600">0 notes</span>
          )}
        </div>

        {/* Your note status */}
        <div className="w-6 text-center">
          {ticket.currentUserHasNote ? (
            <svg className="w-4 h-4 text-emerald-500 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <div className="w-3 h-3 rounded-full border border-gray-600 inline-block" />
          )}
        </div>

        {/* Analyzed */}
        <div className="w-16">
          {a ? <AnalyzedTimestamp dateStr={a.analyzed_at} /> : <span className="text-xs text-gray-600">--</span>}
        </div>

        {/* Actions */}
        <div className="w-20 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {canAnalyze && (
            <button
              onClick={onAnalyze}
              disabled={analyzing}
              className="px-2 py-1 text-[10px] bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
            >
              {analyzing ? '...' : a ? '↻' : 'Analyze'}
            </button>
          )}
          {/* Navigate arrow */}
          <svg
            className="w-4 h-4 text-gray-500"
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </div>
    </div>
  );
}
