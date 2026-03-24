'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { getHubSpotTicketUrl } from '@/lib/hubspot/urls';
import type { ActionBoardResponse, ActionBoardTicket } from '@/app/api/queues/support-action-board/route';
import type { ActionItem } from '@/app/api/queues/support-action-board/analyze/analyze-core';

// --- Types ---

type StatusFilter = 'all' | 'reply_needed' | 'update_due' | 'engineering_ping' | 'internal_action' | 'waiting_on_customer' | 'unreviewed';
type SortColumn = 'responseWait' | 'companyName' | 'ageDays' | 'temperature' | 'analyzedAt';
type SortDirection = 'asc' | 'desc';

interface Props {
  userRole: string;
  canAnalyzeTicket: boolean;
}

// --- Helper Components ---

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

  const display = hours >= 24
    ? `${Math.floor(hours / 24)}d ${Math.round(hours % 24)}h`
    : hours >= 1
      ? `${Math.floor(hours)}h ${Math.round((hours % 1) * 60)}m`
      : `${Math.round(hours * 60)}m`;

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-bold ${color} ${bg}`}>
      {display}
    </span>
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

// --- Start Here Score ---

function computeStartHereScore(ticket: ActionBoardTicket): number {
  if (!ticket.analysis) return 0;
  const a = ticket.analysis;

  // Response wait time (40%)
  const waitScore = Math.min((a.hours_since_customer_waiting ?? 0) / 8, 1) * 40;

  // Customer temperature (25%)
  const tempScores: Record<string, number> = { angry: 25, escalating: 18, frustrated: 12, calm: 0 };
  const tempScore = tempScores[a.customer_temperature] ?? 0;

  // Action simplicity — agent-actionable items rank higher (20%)
  const agentActions = a.action_items.filter((i) => i.who === 'any_support_agent');
  const simplicityScore = agentActions.length > 0 ? 20 : 0;

  // Review coverage — no reviews today = boost (15%)
  const reviewScore = ticket.todayReviews.length === 0 ? 15 : 0;

  // Co-Destiny (VIP) boost — always prioritize VIP tickets
  const coDestinyBoost = ticket.isCoDestiny ? 30 : 0;

  return waitScore + tempScore + simplicityScore + reviewScore + coDestinyBoost;
}

// --- Main Component ---

export function SupportActionBoardView({ userRole, canAnalyzeTicket }: Props) {
  const [data, setData] = useState<ActionBoardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedTicket, setExpandedTicket] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortColumn, setSortColumn] = useState<SortColumn>('responseWait');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [batchAnalyzing, setBatchAnalyzing] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number; subject: string } | null>(null);
  const [copiedDraft, setCopiedDraft] = useState<string | null>(null);

  // Shift review state
  const [reviewingTicket, setReviewingTicket] = useState<string | null>(null);
  const [reviewTag, setReviewTag] = useState<string>('nothing_needed');
  const [reviewNote, setReviewNote] = useState('');
  const [reviewAttention, setReviewAttention] = useState('');
  const [reviewBlockedReason, setReviewBlockedReason] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);

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

  // --- Actions ---

  const handleAnalyze = async (ticketId: string) => {
    setAnalyzing(ticketId);
    try {
      const res = await fetch('/api/queues/support-action-board/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId }),
      });
      if (res.ok) {
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

  const handleCompleteAction = async (ticketId: string, actionItem: ActionItem) => {
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
      if (res.ok) {
        await fetchData();
      }
    } catch (err) {
      console.error('Complete action error:', err);
    }
  };

  const handleSubmitReview = async (ticketId: string) => {
    setSubmittingReview(true);
    try {
      const res = await fetch('/api/queues/support-action-board/shift-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticketId,
          acknowledgmentTag: reviewTag,
          attentionTarget: reviewTag === 'needs_attention' ? reviewAttention : null,
          blockedReason: reviewTag === 'blocked' ? reviewBlockedReason : null,
          shiftNote: reviewNote || null,
        }),
      });
      if (res.ok) {
        setReviewingTicket(null);
        setReviewTag('nothing_needed');
        setReviewNote('');
        setReviewAttention('');
        setReviewBlockedReason('');
        await fetchData();
      }
    } catch (err) {
      console.error('Submit review error:', err);
    } finally {
      setSubmittingReview(false);
    }
  };

  const handleCompleteShift = async () => {
    try {
      const res = await fetch('/api/queues/support-action-board/complete-shift', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        alert('Shift review completed! Great work.');
        await fetchData();
      }
    } catch (err) {
      console.error('Complete shift error:', err);
    }
  };

  const handleCopyDraft = (ticketId: string, draft: string) => {
    navigator.clipboard.writeText(draft);
    setCopiedDraft(ticketId);
    setTimeout(() => setCopiedDraft(null), 2000);
  };

  // --- Filtering and Sorting ---

  const filteredTickets = useMemo(() => {
    if (!data) return [];
    let tickets = data.tickets;

    if (statusFilter === 'unreviewed') {
      tickets = tickets.filter((t) => !t.currentUserReviewed);
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
          const aWait = a.analysis?.hours_since_customer_waiting ?? 0;
          const bWait = b.analysis?.hours_since_customer_waiting ?? 0;
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
  }, [data, statusFilter, sortColumn, sortDirection]);

  // Start Here ticket
  const startHereTicket = useMemo(() => {
    if (!data) return null;
    const analyzed = data.tickets.filter((t) => t.analysis && !t.currentUserReviewed);
    if (analyzed.length === 0) return null;

    let best = analyzed[0];
    let bestScore = computeStartHereScore(best);
    for (let i = 1; i < analyzed.length; i++) {
      const score = computeStartHereScore(analyzed[i]);
      if (score > bestScore) {
        best = analyzed[i];
        bestScore = score;
      }
    }
    return bestScore > 0 ? best : null;
  }, [data]);

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

  return (
    <div className="h-full flex flex-col bg-slate-950 text-white">
      {/* Header */}
      <div className="border-b border-slate-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Support Action Board</h1>
            <p className="text-sm text-gray-400 mt-0.5">
              {data.counts.total} open tickets · {data.counts.analyzed} analyzed · {data.counts.unanalyzed} pending
            </p>
          </div>
          <div className="flex items-center gap-3">
            {canAnalyzeTicket && unanalyzedIds.length > 0 && (
              <button
                onClick={() => handleBatchAnalyze(unanalyzedIds)}
                disabled={batchAnalyzing}
                className="px-3 py-1.5 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
              >
                Analyze All ({unanalyzedIds.length})
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

      {/* Shift Review Banner */}
      <div className="border-b border-slate-800 px-6 py-3 bg-slate-900">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-300">
              Your Shift Review: <strong className="text-white">{data.shiftProgress.reviewed}</strong> of <strong className="text-white">{data.shiftProgress.total}</strong> tickets
            </span>
            <div className="w-48 bg-slate-800 rounded-full h-2">
              <div
                className={`h-2 rounded-full transition-all ${
                  data.shiftProgress.reviewed === data.shiftProgress.total
                    ? 'bg-emerald-500'
                    : 'bg-indigo-500'
                }`}
                style={{ width: `${data.shiftProgress.total > 0 ? (data.shiftProgress.reviewed / data.shiftProgress.total) * 100 : 0}%` }}
              />
            </div>
          </div>
          <button
            onClick={handleCompleteShift}
            disabled={data.shiftProgress.reviewed < data.shiftProgress.total}
            className="px-3 py-1.5 text-xs bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Complete Shift Review
          </button>
        </div>
      </div>

      {/* Start Here Card */}
      {startHereTicket && startHereTicket.analysis && (
        <div
          className="mx-6 mt-4 p-4 bg-gradient-to-r from-indigo-950 to-slate-900 border border-indigo-800 rounded-lg cursor-pointer hover:border-indigo-600 transition-colors"
          onClick={() => setExpandedTicket(startHereTicket.ticketId)}
        >
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-bold text-indigo-400 uppercase tracking-wider">Start Here</span>
            <ResponseClock hours={startHereTicket.analysis.hours_since_customer_waiting} />
          </div>
          <div className="flex items-center gap-3">
            {startHereTicket.isCoDestiny && (
              <span className="inline-flex items-center px-1 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">VIP</span>
            )}
            <span className="text-sm font-medium text-white">{startHereTicket.companyName || 'Unknown'}</span>
            <span className="text-xs text-gray-400">—</span>
            <span className="text-sm text-gray-300 truncate">{startHereTicket.analysis.situation_summary}</span>
          </div>
          {startHereTicket.analysis.action_items.length > 0 && (
            <div className="mt-2 text-xs text-indigo-300">
              Top action: {startHereTicket.analysis.action_items[0].description.slice(0, 120)}
              {startHereTicket.analysis.action_items[0].description.length > 120 ? '...' : ''}
            </div>
          )}
        </div>
      )}

      {/* Filter Bar */}
      <div className="px-6 py-3 flex items-center gap-2 flex-wrap">
        {(['all', 'reply_needed', 'update_due', 'engineering_ping', 'internal_action', 'waiting_on_customer', 'unreviewed'] as StatusFilter[]).map((filter) => {
          const labels: Record<StatusFilter, string> = {
            all: `All (${data.counts.total})`,
            reply_needed: `Reply Needed (${data.counts.byStatus.reply_needed || 0})`,
            update_due: `Update Due (${data.counts.byStatus.update_due || 0})`,
            engineering_ping: `Eng Ping (${data.counts.byStatus.engineering_ping || 0})`,
            internal_action: `Internal (${data.counts.byStatus.internal_action || 0})`,
            waiting_on_customer: `Waiting (${data.counts.byStatus.waiting_on_customer || 0})`,
            unreviewed: `Unreviewed (${data.shiftProgress.total - data.shiftProgress.reviewed})`,
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
          <div className="w-20">Reviews</div>
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
            onCompleteAction={(item) => handleCompleteAction(ticket.ticketId, item)}
            analyzing={analyzing === ticket.ticketId}
            canAnalyze={canAnalyzeTicket}
            isVP={isVP}
            reviewingTicket={reviewingTicket}
            onStartReview={() => {
              setReviewingTicket(ticket.ticketId);
              setReviewTag('nothing_needed');
              setReviewNote('');
            }}
            reviewTag={reviewTag}
            reviewNote={reviewNote}
            reviewAttention={reviewAttention}
            reviewBlockedReason={reviewBlockedReason}
            onReviewTagChange={setReviewTag}
            onReviewNoteChange={setReviewNote}
            onReviewAttentionChange={setReviewAttention}
            onReviewBlockedReasonChange={setReviewBlockedReason}
            onSubmitReview={() => handleSubmitReview(ticket.ticketId)}
            submittingReview={submittingReview}
            onCopyDraft={() => {
              if (ticket.analysis?.response_draft) {
                handleCopyDraft(ticket.ticketId, ticket.analysis.response_draft);
              }
            }}
            copiedDraft={copiedDraft === ticket.ticketId}
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

// --- Ticket Row Component ---

interface TicketRowProps {
  ticket: ActionBoardTicket;
  isExpanded: boolean;
  onToggle: () => void;
  onAnalyze: () => void;
  onCompleteAction: (item: ActionItem) => void;
  analyzing: boolean;
  canAnalyze: boolean;
  isVP: boolean;
  reviewingTicket: string | null;
  onStartReview: () => void;
  reviewTag: string;
  reviewNote: string;
  reviewAttention: string;
  reviewBlockedReason: string;
  onReviewTagChange: (tag: string) => void;
  onReviewNoteChange: (note: string) => void;
  onReviewAttentionChange: (target: string) => void;
  onReviewBlockedReasonChange: (reason: string) => void;
  onSubmitReview: () => void;
  submittingReview: boolean;
  onCopyDraft: () => void;
  copiedDraft: boolean;
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
  reviewingTicket,
  onStartReview,
  reviewTag,
  reviewNote,
  reviewAttention,
  reviewBlockedReason,
  onReviewTagChange,
  onReviewNoteChange,
  onReviewAttentionChange,
  onReviewBlockedReasonChange,
  onSubmitReview,
  submittingReview,
  onCopyDraft,
  copiedDraft,
  userId,
}: TicketRowProps) {
  const a = ticket.analysis;
  const completedActionIds = new Set(ticket.completions.map((c) => c.actionItemId));
  const isReviewing = reviewingTicket === ticket.ticketId;

  return (
    <div className={`border-b border-slate-800 ${!ticket.currentUserReviewed ? 'border-l-2 border-l-indigo-500' : ''}`}>
      {/* Collapsed Row */}
      <div
        className="flex items-center gap-3 py-3 cursor-pointer hover:bg-slate-900 transition-colors"
        onClick={onToggle}
      >
        {/* Response Clock */}
        <div className="w-20">
          <ResponseClock hours={a?.hours_since_customer_waiting ?? null} />
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

        {/* Reviews */}
        <div className="w-20 text-xs text-gray-400">
          {ticket.todayReviews.length > 0 ? (
            <span>{ticket.todayReviews.length} reviewed</span>
          ) : (
            <span className="text-gray-600">0 reviewed</span>
          )}
        </div>

        {/* Your review status */}
        <div className="w-6 text-center">
          {ticket.currentUserReviewed ? (
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
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Action Items</h3>
                <div className="space-y-3">
                  {a.action_items.map((item) => {
                    const isCompleted = completedActionIds.has(item.id);
                    const completion = ticket.completions.find((c) => c.actionItemId === item.id);
                    const isUnverified = completion?.verified === false;

                    return (
                      <div
                        key={item.id}
                        className={`flex items-start gap-3 p-3 rounded-lg ${
                          isCompleted
                            ? isUnverified
                              ? 'bg-red-950/30 border border-red-900'
                              : 'bg-emerald-950/30 border border-emerald-900'
                            : 'bg-slate-800'
                        }`}
                      >
                        <button
                          onClick={(e) => { e.stopPropagation(); if (!isCompleted) onCompleteAction(item); }}
                          className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded border ${
                            isCompleted
                              ? 'bg-emerald-600 border-emerald-600'
                              : 'border-gray-500 hover:border-indigo-400'
                          } flex items-center justify-center`}
                          disabled={isCompleted}
                        >
                          {isCompleted && (
                            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </button>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <PriorityBadge priority={item.priority} />
                            <WhoBadge who={item.who} />
                            {item.status_tags.map((tag) => (
                              <StatusTag key={tag} tag={tag} />
                            ))}
                          </div>
                          <p className={`text-sm ${isCompleted ? 'line-through text-gray-500' : 'text-gray-200'}`}>
                            {item.description}
                          </p>
                          {isCompleted && completion && (
                            <p className="text-xs text-gray-500 mt-1">
                              Completed by {completion.completedByName} · <AnalyzedTimestamp dateStr={completion.completedAt} />
                              {isUnverified && (
                                <span className="text-red-400 font-medium ml-2">
                                  ⚠ Unverified — {completion.verificationNote || 'No matching activity found'}
                                </span>
                              )}
                              {completion.verified === true && (
                                <span className="text-emerald-400 ml-2">✓ Verified</span>
                              )}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {a.action_items.length === 0 && (
                    <p className="text-sm text-gray-500">No action items extracted.</p>
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

              {/* Response Guidance */}
              {a.response_guidance && (
                <div className="bg-blue-950/30 border border-blue-800 rounded-lg p-4">
                  <h3 className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-2">Response Guidance</h3>
                  <p className="text-sm text-blue-200 whitespace-pre-wrap">{a.response_guidance}</p>
                </div>
              )}

              {/* Draft Reply */}
              {a.response_draft && (
                <div className="bg-indigo-950/30 border border-indigo-800 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-semibold text-indigo-400 uppercase tracking-wider">Draft Reply</h3>
                    <button
                      onClick={(e) => { e.stopPropagation(); onCopyDraft(); }}
                      className={`px-3 py-1 text-xs rounded ${
                        copiedDraft
                          ? 'bg-emerald-600 text-white'
                          : 'bg-indigo-600 text-white hover:bg-indigo-700'
                      }`}
                    >
                      {copiedDraft ? '✓ Copied!' : 'Copy to Clipboard'}
                    </button>
                  </div>
                  <div className="bg-slate-900 rounded p-3 text-sm text-gray-200 whitespace-pre-wrap font-mono leading-relaxed">
                    {a.response_draft}
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

            {/* Right: Metadata & Accountability */}
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

              {/* Shift Review Panel */}
              <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Shift Review</h3>

                {ticket.currentUserReviewed ? (
                  <div className="flex items-center gap-2 text-emerald-400 text-sm">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Reviewed this shift
                  </div>
                ) : isReviewing ? (
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Tag</label>
                      <select
                        value={reviewTag}
                        onChange={(e) => onReviewTagChange(e.target.value)}
                        className="w-full bg-slate-800 text-sm text-white rounded px-3 py-1.5 border border-slate-600"
                      >
                        <option value="nothing_needed">Nothing needed from me</option>
                        <option value="i_can_action">I can action this</option>
                        <option value="needs_attention">Needs attention</option>
                        <option value="blocked">Blocked</option>
                      </select>
                    </div>
                    {reviewTag === 'needs_attention' && (
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">Who needs to act?</label>
                        <input
                          type="text"
                          value={reviewAttention}
                          onChange={(e) => onReviewAttentionChange(e.target.value)}
                          placeholder="Engineering, CS Manager..."
                          className="w-full bg-slate-800 text-sm text-white rounded px-3 py-1.5 border border-slate-600"
                        />
                      </div>
                    )}
                    {reviewTag === 'blocked' && (
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">What&apos;s blocking?</label>
                        <input
                          type="text"
                          value={reviewBlockedReason}
                          onChange={(e) => onReviewBlockedReasonChange(e.target.value)}
                          placeholder="Waiting on vendor response..."
                          className="w-full bg-slate-800 text-sm text-white rounded px-3 py-1.5 border border-slate-600"
                        />
                      </div>
                    )}
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Shift Note (optional)</label>
                      <input
                        type="text"
                        value={reviewNote}
                        onChange={(e) => onReviewNoteChange(e.target.value)}
                        placeholder="I pinged Marcus on Slack about this..."
                        className="w-full bg-slate-800 text-sm text-white rounded px-3 py-1.5 border border-slate-600"
                      />
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); onSubmitReview(); }}
                      disabled={submittingReview}
                      className="w-full px-3 py-1.5 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {submittingReview ? 'Submitting...' : 'Submit Review'}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={(e) => { e.stopPropagation(); onStartReview(); }}
                    className="w-full px-3 py-2 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700"
                  >
                    Acknowledge & Tag
                  </button>
                )}
              </div>

              {/* Today's Reviews */}
              {ticket.todayReviews.length > 0 && (
                <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                    Today&apos;s Reviews ({ticket.todayReviews.length})
                  </h3>
                  <div className="space-y-2">
                    {ticket.todayReviews.map((review) => {
                      const tagLabels: Record<string, string> = {
                        nothing_needed: 'Nothing needed',
                        i_can_action: 'Can action',
                        needs_attention: 'Needs attention',
                        blocked: 'Blocked',
                      };
                      const tagColors: Record<string, string> = {
                        nothing_needed: 'text-gray-400',
                        i_can_action: 'text-blue-400',
                        needs_attention: 'text-orange-400',
                        blocked: 'text-red-400',
                      };
                      return (
                        <div key={review.id} className="text-xs">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-300">
                              {review.userId === userId ? 'You' : review.userName}
                            </span>
                            <span className={tagColors[review.acknowledgmentTag] || 'text-gray-400'}>
                              {tagLabels[review.acknowledgmentTag] || review.acknowledgmentTag}
                            </span>
                            <span className="text-gray-600">
                              {new Date(review.reviewedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          {review.shiftNote && (
                            <p className="text-gray-500 mt-0.5 pl-2 border-l border-slate-700">{review.shiftNote}</p>
                          )}
                          {review.attentionTarget && (
                            <p className="text-orange-500 mt-0.5 text-[10px]">→ {review.attentionTarget}</p>
                          )}
                          {review.blockedReason && (
                            <p className="text-red-500 mt-0.5 text-[10px]">Blocked: {review.blockedReason}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Response Clocks Summary */}
              <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Response Clocks</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Customer waiting</span>
                    <ResponseClock hours={a.hours_since_customer_waiting} />
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
