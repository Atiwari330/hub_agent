'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { getHubSpotTicketUrl } from '@/lib/hubspot/urls';
import type { ActionBoardResponse, ActionBoardTicket, ProgressNoteInfo, LiveActionItem } from '@/app/api/queues/support-action-board/route';
import type { ActionItem, RelatedTicketInfo } from '@/app/api/queues/support-action-board/analyze/analyze-core';
import { useRealtimeSubscription, type ConnectionStatus } from '@/hooks/use-realtime-subscription';

// --- Types ---

type StatusFilter = 'all' | 'reply_needed' | 'update_due' | 'engineering_ping' | 'internal_action' | 'waiting_on_customer' | 'unnoted';
type SortColumn = 'responseWait' | 'companyName' | 'ageDays' | 'temperature' | 'analyzedAt';
type SortDirection = 'asc' | 'desc';

interface Props {
  userRole: string;
  canAnalyzeTicket: boolean;
}

// --- Helper Components ---

function computeLiveHours(lastCustomerMessageAt: string | null, lastAgentMessageAt: string | null): number | null {
  if (!lastCustomerMessageAt) return null;
  const customerTime = new Date(lastCustomerMessageAt).getTime();
  const agentTime = lastAgentMessageAt ? new Date(lastAgentMessageAt).getTime() : 0;
  // Only show wait time if customer message is more recent than agent response
  if (agentTime >= customerTime) return null;
  const hours = (Date.now() - customerTime) / (1000 * 60 * 60);
  return hours > 0 ? hours : null;
}

function formatHours(hours: number): string {
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${Math.round(hours % 24)}h`;
  if (hours >= 1) return `${Math.floor(hours)}h ${Math.round((hours % 1) * 60)}m`;
  return `${Math.round(hours * 60)}m`;
}

function ResponseClock({ hours }: { hours: number | null }) {
  if (hours === null || hours === 0) {
    return <span className="text-xs text-gray-400 font-mono">--</span>;
  }

  let color = 'text-gray-500';
  let bg = 'bg-gray-50';
  if (hours >= 4) {
    color = 'text-red-700';
    bg = 'bg-red-50 border border-red-200';
  } else if (hours >= 2) {
    color = 'text-orange-700';
    bg = 'bg-orange-50 border border-orange-200';
  } else if (hours >= 1) {
    color = 'text-yellow-700';
    bg = 'bg-yellow-50 border border-yellow-200';
  }

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-bold ${color} ${bg}`}>
      {formatHours(hours)}
    </span>
  );
}

function ConnectionIndicator({ status }: { status: ConnectionStatus }) {
  const config: Record<ConnectionStatus, { color: string; label: string }> = {
    connected: { color: 'bg-emerald-500', label: 'Live' },
    connecting: { color: 'bg-yellow-500 animate-pulse', label: 'Connecting...' },
    disconnected: { color: 'bg-red-500', label: 'Offline' },
  };
  const { color, label } = config[status];
  return (
    <div className="flex items-center gap-1.5" title={`Realtime: ${label}`}>
      <div className={`w-2 h-2 rounded-full ${color}`} />
      <span className="text-[10px] text-gray-400">{label}</span>
    </div>
  );
}

function StatusTag({ tag }: { tag: string }) {
  const config: Record<string, { label: string; color: string }> = {
    reply_needed: { label: 'Reply Needed', color: 'bg-red-100 text-red-700' },
    update_due: { label: 'Update Due', color: 'bg-yellow-100 text-yellow-700' },
    engineering_ping: { label: 'Eng Ping', color: 'bg-purple-100 text-purple-700' },
    internal_action: { label: 'Internal Action', color: 'bg-blue-100 text-blue-700' },
    waiting_on_customer: { label: 'Waiting', color: 'bg-gray-100 text-gray-500' },
  };
  const { label, color } = config[tag] || { label: tag, color: 'bg-gray-100 text-gray-500' };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${color}`}>
      {label}
    </span>
  );
}

function TemperatureBadge({ temp }: { temp: string }) {
  const config: Record<string, { label: string; color: string }> = {
    angry: { label: 'Angry', color: 'bg-red-100 text-red-700' },
    escalating: { label: 'Escalating', color: 'bg-orange-100 text-orange-700' },
    frustrated: { label: 'Frustrated', color: 'bg-yellow-100 text-yellow-700' },
    calm: { label: 'Calm', color: 'bg-green-100 text-green-700' },
  };
  const { label, color } = config[temp] || { label: temp, color: 'bg-gray-100 text-gray-500' };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${color}`}>
      {label}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const config: Record<string, { label: string; color: string }> = {
    now: { label: 'NOW', color: 'bg-red-600 text-white' },
    today: { label: 'TODAY', color: 'bg-orange-500 text-white' },
    this_week: { label: 'THIS WEEK', color: 'bg-blue-500 text-white' },
  };
  const { label, color } = config[priority] || { label: priority, color: 'bg-gray-500 text-white' };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold ${color}`}>
      {label}
    </span>
  );
}

function WhoBadge({ who }: { who: string }) {
  const config: Record<string, { label: string; color: string }> = {
    any_support_agent: { label: 'Support', color: 'bg-blue-50 text-blue-600' },
    engineering: { label: 'Engineering', color: 'bg-purple-50 text-purple-600' },
    cs_manager: { label: 'CS Manager', color: 'bg-orange-50 text-orange-600' },
  };
  const { label, color } = config[who] || { label: who, color: 'bg-gray-50 text-gray-600' };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${color}`}>
      {label}
    </span>
  );
}

function AnalyzedTimestamp({ dateStr }: { dateStr: string }) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  let label: string;
  if (diffDays === 0) {
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours === 0) {
      const diffMin = Math.floor(diffMs / (1000 * 60));
      label = `${diffMin}m ago`;
    } else {
      label = `${diffHours}h ago`;
    }
  } else if (diffDays === 1) {
    label = 'Yesterday';
  } else {
    label = `${diffDays}d ago`;
  }

  return <span className="text-xs text-gray-400">{label}</span>;
}

function LinearBadge({ state }: { state: string }) {
  const stateColors: Record<string, string> = {
    'In Progress': 'bg-blue-100 text-blue-700',
    'Done': 'bg-emerald-100 text-emerald-700',
    'Todo': 'bg-yellow-100 text-yellow-700',
    'Backlog': 'bg-gray-100 text-gray-600',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${stateColors[state] || 'bg-gray-100 text-gray-600'}`}>
      {state}
    </span>
  );
}

// --- Main Component ---

export function SupportActionBoardView({ userRole, canAnalyzeTicket }: Props) {
  const [data, setData] = useState<ActionBoardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedTicket, setExpandedTicket] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [vipFilter, setVipFilter] = useState(false);
  const [sortColumn, setSortColumn] = useState<SortColumn>('responseWait');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [batchAnalyzing, setBatchAnalyzing] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number; subject: string } | null>(null);

  // Progress note state
  const [noteTicketId, setNoteTicketId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  const [submittingNote, setSubmittingNote] = useState(false);

  const isVP = userRole === 'vp_revops';

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
        // Skip if we already have this completion (from optimistic update)
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
        // Skip if we already have this note (from optimistic update)
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
          completedByName: null, // Will be resolved on next full fetch
          completedMethod: row.completed_method as string | null,
          supersededAt: row.superseded_at as string | null,
          supersededBy: row.superseded_by as string | null,
          expiredAt: row.expired_at as string | null,
          expiredReason: row.expired_reason as string | null,
          verified: row.verified as boolean | null,
          verificationNote: row.verification_note as string | null,
          sortOrder: row.sort_order as number,
        };
        // Replace existing or add new
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
        };
      });
      return { ...prev, tickets: updatedTickets };
    });
  }, []);

  const realtimeSubscriptions = useMemo(() => [
    {
      table: 'ticket_action_board_analyses',
      event: '*' as const,
      onPayload: handleAnalysisChange,
    },
    {
      table: 'action_item_completions',
      event: 'INSERT' as const,
      onPayload: handleCompletionInsert,
    },
    {
      table: 'progress_notes',
      event: '*' as const,
      onPayload: handleNoteChange,
    },
    {
      table: 'action_items',
      event: '*' as const,
      onPayload: handleActionItemChange,
    },
    {
      table: 'support_tickets',
      event: 'UPDATE' as const,
      onPayload: handleTicketUpdate,
    },
  ], [handleAnalysisChange, handleCompletionInsert, handleNoteChange, handleActionItemChange, handleTicketUpdate]);

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
        // Trigger a shallow copy to force re-render with updated times
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
        // Fallback: refetch if realtime isn't connected
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

  const handleCompleteAction = async (ticketId: string, actionItem: LiveActionItem | ActionItem) => {
    // Optimistic update: mark the action item as completed in local state
    const prevData = data;
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        tickets: prev.tickets.map((t) => {
          if (t.ticketId !== ticketId) return t;
          return {
            ...t,
            actionItems: t.actionItems.map((ai) =>
              ai.id === actionItem.id
                ? { ...ai, status: 'completed' as const, completedAt: new Date().toISOString(), completedMethod: 'manual', completedByName: 'You' }
                : ai
            ),
            completions: [...t.completions, {
              id: `optimistic-${Date.now()}`,
              actionItemId: actionItem.id,
              actionDescription: actionItem.description,
              completedBy: data?.userId || '',
              completedByName: 'You',
              completedAt: new Date().toISOString(),
              verified: null,
              verificationNote: null,
            }],
          };
        }),
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
      if (!res.ok) {
        setData(prevData);
      }
      // On success, realtime subscription will update with the real row
    } catch (err) {
      console.error('Complete action error:', err);
      setData(prevData);
    }
  };

  const handleSubmitNote = async (ticketId: string) => {
    if (noteText.trim().length < 10) return;
    setSubmittingNote(true);

    // Optimistic update
    const optimisticNote: ProgressNoteInfo = {
      id: `optimistic-${Date.now()}`,
      userId: data?.userId || '',
      userName: 'You',
      noteText: noteText.trim(),
      createdAt: new Date().toISOString(),
    };

    const prevData = data;
    const savedNoteText = noteText.trim();
    setNoteTicketId(null);
    setNoteText('');

    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        tickets: prev.tickets.map((t) =>
          t.ticketId === ticketId
            ? {
                ...t,
                progressNotes: [...t.progressNotes, optimisticNote],
                currentUserHasNote: true,
              }
            : t
        ),
        noteProgress: {
          ...prev.noteProgress,
          noted: prev.tickets.find((t) => t.ticketId === ticketId)?.currentUserHasNote
            ? prev.noteProgress.noted
            : prev.noteProgress.noted + 1,
        },
      };
    });

    try {
      const res = await fetch('/api/queues/support-action-board/progress-note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId, noteText: savedNoteText }),
      });
      if (!res.ok) {
        // Revert on failure
        setData(prevData);
        setNoteTicketId(ticketId);
        setNoteText(savedNoteText);
      }
    } catch (err) {
      console.error('Submit note error:', err);
      setData(prevData);
      setNoteTicketId(ticketId);
      setNoteText(savedNoteText);
    } finally {
      setSubmittingNote(false);
    }
  };

  // --- Filtering and Sorting ---

  const filteredTickets = useMemo(() => {
    if (!data) return [];
    let tickets = data.tickets;

    // VIP filter
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
            isExpanded={expandedTicket === ticket.ticketId}
            onToggle={() => setExpandedTicket(expandedTicket === ticket.ticketId ? null : ticket.ticketId)}
            onAnalyze={() => handleAnalyze(ticket.ticketId)}
            onCompleteAction={(item: LiveActionItem) => handleCompleteAction(ticket.ticketId, item)}
            analyzing={analyzing === ticket.ticketId}
            canAnalyze={canAnalyzeTicket}
            isVP={isVP}
            noteTicketId={noteTicketId}
            noteText={noteText}
            submittingNote={submittingNote}
            onStartNote={(ticketId) => {
              // Pre-fill with existing note if user already wrote one today
              const existingNote = ticket.progressNotes.find((n) => n.userId === data?.userId);
              setNoteTicketId(ticketId);
              setNoteText(existingNote?.noteText || '');
            }}
            onNoteTextChange={setNoteText}
            onSubmitNote={() => handleSubmitNote(ticket.ticketId)}
            userId={data?.userId || ''}
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

// --- Action Item Card (lifecycle-aware) ---

function ActionItemCard({ item, onComplete }: { item: LiveActionItem; onComplete?: () => void }) {
  const isActive = item.status === 'active';
  const isCompleted = item.status === 'completed';
  const isSuperseded = item.status === 'superseded';
  const isExpired = item.status === 'expired';
  const isAutoCompleted = isCompleted && item.completedMethod === 'auto_detected';
  const isUnverified = isCompleted && item.verified === false;

  const bgClass = isCompleted
    ? isUnverified
      ? 'bg-red-950/30 border border-red-900'
      : 'bg-emerald-950/30 border border-emerald-900'
    : isSuperseded
      ? 'bg-slate-800/50 border border-slate-700 opacity-60'
      : isExpired
        ? 'bg-slate-800/30 border border-slate-700 opacity-40'
        : 'bg-slate-800';

  return (
    <div className={`flex items-start gap-3 p-3 rounded-lg ${bgClass}`}>
      {/* Checkbox (only for active items) */}
      {isActive && onComplete ? (
        <button
          onClick={(e) => { e.stopPropagation(); onComplete(); }}
          className="mt-0.5 flex-shrink-0 w-5 h-5 rounded border border-gray-500 hover:border-indigo-400 flex items-center justify-center"
        />
      ) : (
        <div className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded border flex items-center justify-center ${
          isCompleted ? 'bg-emerald-600 border-emerald-600' : 'border-gray-600'
        }`}>
          {isCompleted && (
            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          )}
          {isSuperseded && (
            <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          )}
        </div>
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <PriorityBadge priority={item.priority} />
          <WhoBadge who={item.who} />
          {item.statusTags.map((tag) => (
            <StatusTag key={tag} tag={tag} />
          ))}
          {isAutoCompleted && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium bg-emerald-900/50 text-emerald-400">
              Auto-detected
            </span>
          )}
          {/* Item age */}
          <span className="text-[10px] text-gray-500 ml-auto">
            <AnalyzedTimestamp dateStr={item.createdAt} />
          </span>
        </div>

        <p className={`text-sm ${
          isCompleted || isSuperseded ? 'line-through text-gray-500' :
          isExpired ? 'text-gray-600' : 'text-gray-200'
        }`}>
          {item.description}
        </p>

        {/* Status detail line */}
        {isCompleted && (
          <p className="text-xs text-gray-500 mt-1">
            {isAutoCompleted ? 'Auto-completed' : `Completed by ${item.completedByName || 'agent'}`}
            {item.completedAt && <> · <AnalyzedTimestamp dateStr={item.completedAt} /></>}
            {isUnverified && (
              <span className="text-red-400 font-medium ml-2">
                Unverified — {item.verificationNote || 'No matching activity found'}
              </span>
            )}
            {item.verified === true && (
              <span className="text-emerald-400 ml-2">Verified</span>
            )}
          </p>
        )}
        {isSuperseded && item.expiredReason && (
          <p className="text-xs text-gray-500 mt-1">Replaced: {item.expiredReason}</p>
        )}
        {isExpired && item.expiredReason && (
          <p className="text-xs text-gray-500 mt-1">Expired: {item.expiredReason}</p>
        )}
      </div>
    </div>
  );
}

// --- Ticket Row Component ---

interface TicketRowProps {
  ticket: ActionBoardTicket;
  isExpanded: boolean;
  onToggle: () => void;
  onAnalyze: () => void;
  onCompleteAction: (item: LiveActionItem) => void;
  analyzing: boolean;
  canAnalyze: boolean;
  isVP: boolean;
  noteTicketId: string | null;
  noteText: string;
  submittingNote: boolean;
  onStartNote: (ticketId: string) => void;
  onNoteTextChange: (text: string) => void;
  onSubmitNote: () => void;
  userId: string;
}

function TicketRow({
  ticket,
  isExpanded,
  onToggle,
  onAnalyze,
  onCompleteAction,
  analyzing,
  canAnalyze,
  noteTicketId,
  noteText,
  submittingNote,
  onStartNote,
  onNoteTextChange,
  onSubmitNote,
  userId,
}: TicketRowProps) {
  const a = ticket.analysis;
  const [showExpired, setShowExpired] = useState(false);
  const isWritingNote = noteTicketId === ticket.ticketId;

  // Separate action items by status
  const activeItems = ticket.actionItems.filter((ai) => ai.status === 'active');
  const completedItems = ticket.actionItems.filter((ai) => ai.status === 'completed');
  const supersededItems = ticket.actionItems.filter((ai) => ai.status === 'superseded');
  const expiredItems = ticket.actionItems.filter((ai) => ai.status === 'expired');
  // Fall back to analysis.action_items if no living items exist yet (pre-migration)
  const hasLivingItems = ticket.actionItems.length > 0;
  const legacyCompletedIds = new Set(ticket.completions.map((c) => c.actionItemId));

  // Use live-computed wait time if raw timestamps available, else fall back to analysis snapshot
  const liveCustomerWait = computeLiveHours(ticket.lastCustomerMessageAt, ticket.lastAgentMessageAt);
  const customerWaitHours = liveCustomerWait ?? a?.hours_since_customer_waiting ?? null;

  return (
    <div className={`border-b border-slate-800 ${!ticket.currentUserHasNote ? 'border-l-2 border-l-indigo-500' : ''}`}>
      {/* Collapsed Row */}
      <div
        className="flex items-center gap-3 py-3 cursor-pointer hover:bg-slate-900 transition-colors"
        onClick={onToggle}
      >
        {/* Response Clock */}
        <div className="w-20">
          <ResponseClock hours={customerWaitHours} />
        </div>

        {/* Status Tags */}
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

        {/* Temperature */}
        <div className="w-16">
          {a ? <TemperatureBadge temp={a.customer_temperature} /> : <span className="text-xs text-gray-500">--</span>}
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
          {/* Expand chevron */}
          <svg
            className={`w-4 h-4 text-gray-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      {/* Expanded Detail */}
      {isExpanded && a && (
        <div className="pb-6 px-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left: Analysis (2 cols) */}
            <div className="lg:col-span-2 space-y-4">
              {/* Situation Summary */}
              <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Situation</h3>
                <p className="text-sm text-gray-200 whitespace-pre-wrap">{a.situation_summary}</p>
              </div>

              {/* Action Items */}
              <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
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
                  {expiredItems.length > 0 && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowExpired(!showExpired); }}
                      className="text-[10px] text-gray-500 hover:text-gray-300"
                    >
                      {showExpired ? 'Hide expired' : `Show ${expiredItems.length} expired`}
                    </button>
                  )}
                </div>
                <div className="space-y-3">
                  {hasLivingItems ? (
                    <>
                      {/* Active items */}
                      {activeItems.map((item) => (
                        <ActionItemCard
                          key={item.id}
                          item={item}
                          onComplete={() => onCompleteAction(item)}
                        />
                      ))}

                      {/* Completed items */}
                      {completedItems.map((item) => (
                        <ActionItemCard key={item.id} item={item} />
                      ))}

                      {/* Superseded items (collapsed) */}
                      {supersededItems.map((item) => (
                        <ActionItemCard key={item.id} item={item} />
                      ))}

                      {/* Expired items (hidden by default) */}
                      {showExpired && expiredItems.map((item) => (
                        <ActionItemCard key={item.id} item={item} />
                      ))}

                      {activeItems.length === 0 && completedItems.length === 0 && (
                        <p className="text-sm text-gray-500">No active action items.</p>
                      )}
                    </>
                  ) : (
                    <>
                      {/* Fallback: render from analysis JSONB (pre-migration) */}
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
                  )}
                </div>
              </div>

              {/* Customer Temperature */}
              <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Customer Temperature</h3>
                <div className="flex items-center gap-3">
                  <TemperatureBadge temp={a.customer_temperature} />
                  {a.temperature_reason && (
                    <span className="text-sm text-gray-300">{a.temperature_reason}</span>
                  )}
                </div>
              </div>

              {/* Context Snapshot */}
              {a.context_snapshot && (
                <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Context</h3>
                  <p className="text-sm text-gray-300 whitespace-pre-wrap">{a.context_snapshot}</p>
                </div>
              )}

              {/* Related Tickets */}
              {a.related_tickets.length > 0 && (
                <div className="bg-amber-950/30 border border-amber-800 rounded-lg p-4">
                  <h3 className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-2">Related Tickets (Same Company)</h3>
                  <div className="space-y-1">
                    {a.related_tickets.map((rt) => (
                      <div key={rt.ticketId} className="text-sm text-gray-300">
                        <span className="font-mono text-amber-400">#{rt.ticketId}</span> — {rt.subject}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Knowledge Used */}
              {a.knowledge_used && a.knowledge_used !== 'none' && (
                <div className="text-xs text-gray-500 italic">
                  Knowledge: {a.knowledge_used}
                </div>
              )}
            </div>

            {/* Right: Metadata & Progress Notes */}
            <div className="space-y-4">
              {/* Ticket Metadata */}
              <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Ticket Details</h3>
                <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-sm">
                  <span className="text-gray-500">Subject</span>
                  <span className="text-gray-200 truncate">{ticket.subject || 'N/A'}</span>
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
                  <span className="text-gray-500">Confidence</span>
                  <span className="text-gray-200">{Math.round(a.confidence * 100)}%</span>
                  {ticket.isCoDestiny && (
                    <>
                      <span className="text-gray-500">Status</span>
                      <span className="text-amber-400 font-semibold">Co-Destiny (VIP)</span>
                    </>
                  )}
                </div>
              </div>

              {/* External Links */}
              <div className="flex gap-2">
                <a
                  href={getHubSpotTicketUrl(ticket.ticketId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 text-center px-3 py-2 text-xs bg-orange-600 text-white rounded hover:bg-orange-700"
                >
                  HubSpot
                </a>
                {ticket.linearTask && (
                  <a
                    href={ticket.linearTask.startsWith('http') ? ticket.linearTask : `https://linear.app/issue/${ticket.linearTask}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 text-center px-3 py-2 text-xs bg-purple-600 text-white rounded hover:bg-purple-700"
                  >
                    Linear {a.linear_state && <LinearBadge state={a.linear_state} />}
                  </a>
                )}
              </div>

              {/* Progress Note Panel */}
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
                        onChange={(e) => onNoteTextChange(e.target.value)}
                        placeholder="Describe what you did or the current status..."
                        rows={4}
                        className="w-full bg-slate-800 text-sm text-white rounded px-3 py-2 border border-slate-600 resize-none focus:border-indigo-500 focus:outline-none"
                      />
                      {noteText.trim().length > 0 && noteText.trim().length < 10 && (
                        <p className="text-xs text-red-400 mt-1">Minimum 10 characters</p>
                      )}
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); onSubmitNote(); }}
                      disabled={submittingNote || noteText.trim().length < 10}
                      className="w-full px-3 py-1.5 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {submittingNote ? 'Saving...' : 'Save Note'}
                    </button>
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
                      onClick={(e) => { e.stopPropagation(); onStartNote(ticket.ticketId); }}
                      className="text-xs text-indigo-400 hover:text-indigo-300"
                    >
                      Edit note
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={(e) => { e.stopPropagation(); onStartNote(ticket.ticketId); }}
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

              {/* Response Clocks Summary */}
              <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Response Clocks</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Customer waiting</span>
                    <ResponseClock hours={customerWaitHours} />
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Last outbound</span>
                    <ResponseClock hours={a.hours_since_last_outbound} />
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Last activity</span>
                    <ResponseClock hours={a.hours_since_last_activity} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Expanded but not analyzed */}
      {isExpanded && !a && (
        <div className="pb-6 px-4">
          <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 text-center text-gray-400">
            <p>This ticket has not been analyzed yet.</p>
            {canAnalyze && (
              <button
                onClick={(e) => { e.stopPropagation(); onAnalyze(); }}
                disabled={analyzing}
                className="mt-3 px-4 py-2 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
              >
                {analyzing ? 'Analyzing...' : 'Analyze Now'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
