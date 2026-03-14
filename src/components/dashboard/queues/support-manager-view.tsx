'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getHubSpotTicketUrl } from '@/lib/hubspot/urls';
import type { SupportManagerResponse, SupportManagerTicket } from '@/app/api/queues/support-manager/route';

// --- Types ---

type ActionOwnerFilter = 'all' | 'Support Agent' | 'Engineering' | 'Customer' | 'Support Manager';
type UrgencyFilter = 'all' | 'critical' | 'high' | 'medium' | 'low';
type SortColumn = 'companyName' | 'urgency' | 'actionOwner' | 'ageDays' | 'analyzedAt';
type SortDirection = 'asc' | 'desc';

// --- Helper Components ---

function UrgencyBar({ urgency }: { urgency: string }) {
  const colors: Record<string, string> = {
    critical: 'bg-red-500',
    high: 'bg-orange-500',
    medium: 'bg-yellow-400',
    low: 'bg-gray-300',
  };
  return (
    <div className={`w-1.5 self-stretch rounded-l ${colors[urgency] || 'bg-gray-200'}`} />
  );
}

function ActionOwnerBadge({ owner }: { owner: string }) {
  const styles: Record<string, string> = {
    'Support Agent': 'bg-blue-100 text-blue-700',
    'Engineering': 'bg-purple-100 text-purple-700',
    'Customer': 'bg-gray-100 text-gray-600',
    'Support Manager': 'bg-red-100 text-red-700',
  };
  const labels: Record<string, string> = {
    'Support Agent': 'Agent',
    'Engineering': 'Engineering',
    'Customer': 'Customer',
    'Support Manager': 'Manager',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${styles[owner] || 'bg-gray-100 text-gray-600'}`}>
      {labels[owner] || owner}
    </span>
  );
}

function LinearBadge({ state }: { state: string }) {
  const stateColors: Record<string, string> = {
    'In Progress': 'bg-blue-100 text-blue-700',
    'Done': 'bg-emerald-100 text-emerald-700',
    'Todo': 'bg-yellow-100 text-yellow-700',
    'Backlog': 'bg-gray-100 text-gray-600',
    'Canceled': 'bg-gray-100 text-gray-400',
    'Cancelled': 'bg-gray-100 text-gray-400',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${stateColors[state] || 'bg-gray-100 text-gray-600'}`}>
      {state}
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
    label = `Today ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  } else if (diffDays === 1) {
    label = 'Yesterday';
  } else if (diffDays < 30) {
    label = `${diffDays}d ago`;
  } else {
    label = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  return <span className="text-xs text-gray-500 whitespace-nowrap">{label}</span>;
}

// --- Main Component ---

export function SupportManagerView() {
  const [data, setData] = useState<SupportManagerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedTicket, setExpandedTicket] = useState<string | null>(null);
  const [actionOwnerFilter, setActionOwnerFilter] = useState<ActionOwnerFilter>('all');
  const [urgencyFilter, setUrgencyFilter] = useState<UrgencyFilter>('all');
  const [sortColumn, setSortColumn] = useState<SortColumn>('urgency');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzingTickets, setAnalyzingTickets] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<{ current: number; total: number; currentTicket: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/queues/support-manager');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: SupportManagerResponse = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Recompute counts from tickets array
  const recomputeCounts = useCallback((tickets: SupportManagerTicket[]): SupportManagerResponse['counts'] => {
    const analyzed = tickets.filter((t) => t.analysis).length;
    const byActionOwner: Record<string, number> = {};
    const byUrgency = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const t of tickets) {
      if (t.analysis) {
        if (t.analysis.action_owner) {
          byActionOwner[t.analysis.action_owner] = (byActionOwner[t.analysis.action_owner] || 0) + 1;
        }
        const urg = t.analysis.urgency as keyof typeof byUrgency;
        if (urg in byUrgency) byUrgency[urg]++;
      }
    }
    return { total: tickets.length, analyzed, unanalyzed: tickets.length - analyzed, byActionOwner, byUrgency };
  }, []);

  // Single ticket analysis
  const analyzeTicket = useCallback(async (ticketId: string) => {
    setAnalyzingTickets((prev) => new Set(prev).add(ticketId));
    try {
      const res = await fetch('/api/queues/support-manager/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId }),
      });
      if (!res.ok) throw new Error('Analysis failed');
      const result = await res.json();
      setData((prev) => {
        if (!prev) return prev;
        const updatedTickets = prev.tickets.map((t) =>
          t.ticketId === ticketId ? { ...t, analysis: { hubspot_ticket_id: ticketId, ...result.analysis } } : t
        );
        return { ...prev, tickets: updatedTickets, counts: recomputeCounts(updatedTickets) };
      });
    } catch (err) {
      console.error('Single ticket analysis failed:', err);
    } finally {
      setAnalyzingTickets((prev) => {
        const next = new Set(prev);
        next.delete(ticketId);
        return next;
      });
    }
  }, [recomputeCounts]);

  // Batch analyze
  const handleBatchAnalyze = useCallback(async (reanalyze: boolean) => {
    if (!data || analyzing) return;

    const ticketIds = reanalyze
      ? data.tickets.map((t) => t.ticketId)
      : data.tickets.filter((t) => !t.analysis).map((t) => t.ticketId);

    if (ticketIds.length === 0) return;

    setAnalyzing(true);
    setProgress({ current: 0, total: ticketIds.length, currentTicket: '' });

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/queues/support-manager/batch-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketIds }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const dataMatch = line.match(/^data:\s*(.*)/s);
          if (!dataMatch) continue;

          try {
            const event = JSON.parse(dataMatch[1]);
            if (event.type === 'progress') {
              setProgress({
                current: event.index,
                total: event.total,
                currentTicket: event.ticketSubject,
              });

              // Update the row in real-time
              if (event.status === 'success' && event.analysis) {
                setData((prev) => {
                  if (!prev) return prev;
                  const updatedTickets = prev.tickets.map((t) =>
                    t.ticketId === event.ticketId
                      ? { ...t, analysis: { hubspot_ticket_id: event.ticketId, ...event.analysis } }
                      : t
                  );
                  // Recompute counts
                  const analyzed = updatedTickets.filter((t) => t.analysis).length;
                  const byActionOwner: Record<string, number> = {};
                  const byUrgency = { critical: 0, high: 0, medium: 0, low: 0 };
                  for (const t of updatedTickets) {
                    if (t.analysis) {
                      if (t.analysis.action_owner) {
                        byActionOwner[t.analysis.action_owner] = (byActionOwner[t.analysis.action_owner] || 0) + 1;
                      }
                      const urg = t.analysis.urgency as keyof typeof byUrgency;
                      if (urg in byUrgency) byUrgency[urg]++;
                    }
                  }
                  return {
                    ...prev,
                    tickets: updatedTickets,
                    counts: {
                      ...prev.counts,
                      analyzed,
                      unanalyzed: prev.counts.total - analyzed,
                      byActionOwner,
                      byUrgency,
                    },
                  };
                });
              }
            } else if (event.type === 'done') {
              setProgress(null);
              setAnalyzing(false);
            }
          } catch {
            // skip malformed events
          }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // user cancelled
      } else {
        console.error('Batch analyze error:', err);
      }
    } finally {
      setAnalyzing(false);
      setProgress(null);
      abortRef.current = null;
    }
  }, [data, analyzing, fetchData]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // Filtering and sorting
  const filteredTickets = useMemo(() => {
    if (!data) return [];

    let tickets = data.tickets;

    if (actionOwnerFilter !== 'all') {
      tickets = tickets.filter((t) => t.analysis?.action_owner === actionOwnerFilter);
    }

    if (urgencyFilter !== 'all') {
      tickets = tickets.filter((t) => t.analysis?.urgency === urgencyFilter);
    }

    // Sort
    const urgencyOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    tickets = [...tickets].sort((a, b) => {
      let cmp = 0;
      switch (sortColumn) {
        case 'companyName':
          cmp = (a.analysis?.company_name || a.companyName || '').localeCompare(
            b.analysis?.company_name || b.companyName || ''
          );
          break;
        case 'urgency': {
          const aUrg = a.analysis ? (urgencyOrder[a.analysis.urgency] ?? 4) : 5;
          const bUrg = b.analysis ? (urgencyOrder[b.analysis.urgency] ?? 4) : 5;
          cmp = aUrg - bUrg;
          break;
        }
        case 'actionOwner':
          cmp = (a.analysis?.action_owner || '').localeCompare(b.analysis?.action_owner || '');
          break;
        case 'ageDays':
          cmp = (a.ageDays || 0) - (b.ageDays || 0);
          break;
        case 'analyzedAt': {
          const aTime = a.analysis?.analyzed_at ? new Date(a.analysis.analyzed_at).getTime() : 0;
          const bTime = b.analysis?.analyzed_at ? new Date(b.analysis.analyzed_at).getTime() : 0;
          cmp = aTime - bTime;
          break;
        }
      }
      return sortDirection === 'asc' ? cmp : -cmp;
    });

    return tickets;
  }, [data, actionOwnerFilter, urgencyFilter, sortColumn, sortDirection]);

  const handleSort = useCallback((col: SortColumn) => {
    setSortColumn((prev) => {
      if (prev === col) {
        setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
        return col;
      }
      setSortDirection('asc');
      return col;
    });
  }, []);

  // --- Render ---

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-64" />
          <div className="h-4 bg-gray-200 rounded w-48" />
          <div className="space-y-2 mt-8">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-16 bg-gray-100 rounded" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800 font-medium">Error loading support manager queue</p>
          <p className="text-red-600 text-sm mt-1">{error}</p>
          <button onClick={fetchData} className="mt-3 px-4 py-2 bg-red-600 text-white rounded text-sm hover:bg-red-700">
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { counts } = data;

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Support Manager Queue</h1>
        <p className="text-sm text-gray-500 mt-1">
          {counts.total} open tickets &middot; {counts.analyzed} analyzed &middot; {counts.unanalyzed} pending
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {/* Analyze buttons */}
        {!analyzing ? (
          <>
            {counts.unanalyzed > 0 && (
              <button
                onClick={() => handleBatchAnalyze(false)}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
              >
                Analyze All ({counts.unanalyzed})
              </button>
            )}
            {counts.analyzed > 0 && (
              <button
                onClick={() => handleBatchAnalyze(true)}
                className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
              >
                Re-analyze All ({counts.total})
              </button>
            )}
          </>
        ) : (
          <div className="flex items-center gap-3">
            <button
              onClick={handleCancel}
              className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors"
            >
              Cancel
            </button>
          </div>
        )}

        <div className="flex-1" />

        {/* Urgency filter */}
        <select
          value={urgencyFilter}
          onChange={(e) => setUrgencyFilter(e.target.value as UrgencyFilter)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
        >
          <option value="all">All Urgency</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>

        {/* Refresh */}
        <button
          onClick={fetchData}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white hover:bg-gray-50"
          title="Refresh"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      {/* Action Owner filter pills */}
      <div className="flex gap-2 mb-4">
        {(['all', 'Support Agent', 'Engineering', 'Customer', 'Support Manager'] as ActionOwnerFilter[]).map((filter) => {
          const label = filter === 'all' ? 'All' : filter === 'Support Agent' ? 'Agent' : filter === 'Support Manager' ? 'Manager' : filter;
          const count = filter === 'all' ? counts.analyzed : (counts.byActionOwner[filter] || 0);
          const isActive = actionOwnerFilter === filter;
          return (
            <button
              key={filter}
              onClick={() => setActionOwnerFilter(filter)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                isActive
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {label} {count > 0 && <span className={isActive ? 'text-indigo-200' : 'text-gray-400'}>({count})</span>}
            </button>
          );
        })}
      </div>

      {/* Progress bar */}
      {analyzing && progress && (
        <div className="mb-4 bg-indigo-50 border border-indigo-200 rounded-lg p-3">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-indigo-700 font-medium">
              Analyzing {progress.current}/{progress.total}
            </span>
            <span className="text-indigo-600 text-xs truncate max-w-xs ml-4">
              {progress.currentTicket}
            </span>
          </div>
          <div className="w-full bg-indigo-200 rounded-full h-2">
            <div
              className="bg-indigo-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${(progress.current / progress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        {/* Header row */}
        <div className="flex items-center px-5 py-3 bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-500 uppercase tracking-wider">
          <div className="w-1.5 mr-4" />
          <button onClick={() => handleSort('companyName')} className="w-56 shrink-0 text-left flex items-center gap-1 hover:text-gray-700">
            Company
            {sortColumn === 'companyName' && <span>{sortDirection === 'asc' ? '\u2191' : '\u2193'}</span>}
          </button>
          <button onClick={() => handleSort('actionOwner')} className="w-28 shrink-0 text-left flex items-center gap-1 hover:text-gray-700 ml-4">
            Owner
            {sortColumn === 'actionOwner' && <span>{sortDirection === 'asc' ? '\u2191' : '\u2193'}</span>}
          </button>
          <button onClick={() => handleSort('ageDays')} className="w-14 shrink-0 text-right flex items-center gap-1 hover:text-gray-700 ml-4">
            Age
            {sortColumn === 'ageDays' && <span>{sortDirection === 'asc' ? '\u2191' : '\u2193'}</span>}
          </button>
          <button onClick={() => handleSort('analyzedAt')} className="w-28 shrink-0 text-left flex items-center gap-1 hover:text-gray-700 ml-4">
            Analyzed
            {sortColumn === 'analyzedAt' && <span>{sortDirection === 'asc' ? '\u2191' : '\u2193'}</span>}
          </button>
          <div className="w-6 shrink-0 ml-4" />
        </div>

        {/* Ticket rows */}
        {filteredTickets.length === 0 ? (
          <div className="px-4 py-12 text-center text-gray-400 text-sm">
            {counts.total === 0 ? 'No open tickets' : 'No tickets match the selected filters'}
          </div>
        ) : (
          filteredTickets.map((ticket) => (
            <TicketRow
              key={ticket.ticketId}
              ticket={ticket}
              isExpanded={expandedTicket === ticket.ticketId}
              onToggle={() => setExpandedTicket(expandedTicket === ticket.ticketId ? null : ticket.ticketId)}
              onAnalyze={() => analyzeTicket(ticket.ticketId)}
              isAnalyzing={analyzingTickets.has(ticket.ticketId)}
            />
          ))
        )}
      </div>

      {/* Footer count */}
      <div className="mt-3 text-xs text-gray-400 text-right">
        Showing {filteredTickets.length} of {counts.total} tickets
      </div>
    </div>
  );
}

// --- Ticket Row ---

function Spinner() {
  return (
    <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );
}

function TicketRow({
  ticket,
  isExpanded,
  onToggle,
  onAnalyze,
  isAnalyzing,
}: {
  ticket: SupportManagerTicket;
  isExpanded: boolean;
  onToggle: () => void;
  onAnalyze: () => void;
  isAnalyzing: boolean;
}) {
  const a = ticket.analysis;

  return (
    <div className="border-b border-gray-200 last:border-0">
      {/* Collapsed row */}
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
        className="w-full text-left px-5 py-4 hover:bg-gray-50/70 transition-colors cursor-pointer"
      >
        {/* Line 1: Metadata */}
        <div className="flex items-center">
          {/* Urgency color bar */}
          {a ? (
            <div className={`w-1.5 h-8 rounded-sm shrink-0 mr-4 ${
              { critical: 'bg-red-500', high: 'bg-orange-500', medium: 'bg-yellow-400', low: 'bg-gray-300' }[a.urgency] || 'bg-gray-200'
            }`} />
          ) : (
            <div className="w-1.5 h-8 rounded-sm shrink-0 mr-4 bg-gray-200" />
          )}

          {/* Company */}
          <div className="w-56 shrink-0 text-sm font-semibold text-gray-900 truncate">
            {a?.company_name || ticket.companyName || 'Unknown'}
          </div>

          {/* Action Owner */}
          <div className="w-28 shrink-0 ml-4">
            {a ? (
              <ActionOwnerBadge owner={a.action_owner} />
            ) : (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-50 text-gray-400">
                Pending
              </span>
            )}
          </div>

          {/* Age */}
          <div className="w-14 shrink-0 text-sm text-gray-500 text-right tabular-nums ml-4">
            {ticket.ageDays}d
          </div>

          {/* Analyzed */}
          <div className="w-28 shrink-0 ml-4">
            {a?.analyzed_at ? (
              <AnalyzedTimestamp dateStr={a.analyzed_at} />
            ) : (
              <span className="text-xs text-gray-300">&mdash;</span>
            )}
          </div>

          {/* Re-analyze / Analyze button */}
          <div className="shrink-0 ml-3"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); }}
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onAnalyze();
              }}
              disabled={isAnalyzing}
              className={`text-xs px-2.5 py-1 rounded transition-colors disabled:opacity-50 ${
                a
                  ? 'text-gray-400 hover:text-indigo-600 hover:bg-indigo-50'
                  : 'bg-indigo-600 text-white hover:bg-indigo-700'
              }`}
              title={a ? 'Re-analyze this ticket' : 'Analyze this ticket'}
            >
              {isAnalyzing ? (
                <span className="flex items-center gap-1.5">
                  <Spinner />
                  <span>Analyzing...</span>
                </span>
              ) : a ? (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              ) : 'Analyze'}
            </button>
          </div>

          {/* Expand chevron */}
          <div className="w-6 shrink-0 flex justify-center ml-2">
            <svg
              className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </div>

        {/* Line 2: Issue Summary */}
        <div className="ml-[1.625rem] mt-3 space-y-2.5">
          <div>
            <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Issue </span>
            <span className="text-sm text-gray-600 leading-relaxed">
              {a ? a.issue_summary : (
                <span className="text-gray-400 italic">{ticket.subject || 'Not analyzed'}</span>
              )}
            </span>
          </div>

          {/* Line 3: Next Action */}
          {a && (
            <div>
              <span className="text-[11px] font-semibold text-indigo-500 uppercase tracking-wide">Next </span>
              <span className="text-sm font-medium text-gray-800 leading-relaxed">
                {a.next_action}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Expanded detail */}
      {isExpanded && a && (
        <div className="px-6 pb-5 pt-4 bg-slate-50 border-t-2 border-indigo-200 border-b border-b-gray-200">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left column: LLM analysis */}
            <div className="space-y-4">
              {/* Reasoning */}
              {a.reasoning && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Reasoning</h4>
                  <p className="text-sm text-gray-700 leading-relaxed">{a.reasoning}</p>
                </div>
              )}

              {/* Conversation Summary */}
              {a.engagement_summary && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Conversation Summary</h4>
                  <p className="text-sm text-gray-700 leading-relaxed">{a.engagement_summary}</p>
                </div>
              )}

              {/* Engineering Context */}
              {a.has_linear && a.linear_summary && a.linear_summary !== 'No engineering escalation.' && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                    Engineering Context
                    {a.linear_state && (
                      <span className="ml-2 normal-case"><LinearBadge state={a.linear_state} /></span>
                    )}
                  </h4>
                  <p className="text-sm text-gray-700 leading-relaxed">{a.linear_summary}</p>
                </div>
              )}
            </div>

            {/* Right column: Metadata */}
            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Ticket Details</h4>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div className="text-gray-500">Subject</div>
                <div className="text-gray-900 truncate" title={a.ticket_subject || undefined}>{a.ticket_subject || 'N/A'}</div>

                <div className="text-gray-500">Rep</div>
                <div className="text-gray-900">{a.assigned_rep || ticket.assignedRep || 'Unassigned'}</div>

                <div className="text-gray-500">Source</div>
                <div className="text-gray-900">{ticket.sourceType || 'N/A'}</div>

                <div className="text-gray-500">Priority</div>
                <div className="text-gray-900">{ticket.priority || 'N/A'}</div>

                <div className="text-gray-500">Software</div>
                <div className="text-gray-900">{ticket.software || 'N/A'}</div>

                <div className="text-gray-500">Ball In Court</div>
                <div className="text-gray-900">{ticket.ballInCourt || 'N/A'}</div>

                <div className="text-gray-500">Last Activity</div>
                <div className="text-gray-900">
                  {a.days_since_last_activity != null ? `${a.days_since_last_activity}d ago` : 'N/A'}
                  {a.last_activity_by && a.last_activity_by !== 'Unknown' && (
                    <span className="text-gray-400 ml-1">by {a.last_activity_by}</span>
                  )}
                </div>

                <div className="text-gray-500">Confidence</div>
                <div className="text-gray-900">{(a.confidence * 100).toFixed(0)}%</div>

                <div className="text-gray-500">Analyzed</div>
                <div className="text-gray-900">{new Date(a.analyzed_at).toLocaleString()}</div>
              </div>

              {/* Links */}
              <div className="flex gap-3 pt-2">
                <a
                  href={getHubSpotTicketUrl(ticket.ticketId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-orange-50 text-orange-700 rounded text-xs font-medium hover:bg-orange-100 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                  HubSpot
                </a>
                {ticket.linearTask && (
                  <a
                    href={ticket.linearTask}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-purple-50 text-purple-700 rounded text-xs font-medium hover:bg-purple-100 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                    Linear
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Expanded but not analyzed */}
      {isExpanded && !a && (
        <div className="px-6 pb-5 pt-3 bg-gray-50 border-t border-gray-100">
          <p className="text-sm text-gray-400 italic">
            This ticket has not been analyzed yet.{' '}
            <button
              onClick={onAnalyze}
              disabled={isAnalyzing}
              className="text-indigo-600 hover:underline disabled:opacity-50"
            >
              {isAnalyzing ? 'Analyzing...' : 'Run analysis now'}
            </button>
          </p>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm max-w-md">
            <div className="text-gray-500">Subject</div>
            <div className="text-gray-900">{ticket.subject || 'N/A'}</div>
            <div className="text-gray-500">Company</div>
            <div className="text-gray-900">{ticket.companyName || 'Unknown'}</div>
            <div className="text-gray-500">Priority</div>
            <div className="text-gray-900">{ticket.priority || 'N/A'}</div>
          </div>
          <div className="mt-3">
            <a
              href={getHubSpotTicketUrl(ticket.ticketId)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-orange-50 text-orange-700 rounded text-xs font-medium hover:bg-orange-100 transition-colors"
            >
              HubSpot
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
