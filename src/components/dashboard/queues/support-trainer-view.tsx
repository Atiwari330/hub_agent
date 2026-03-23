'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { getHubSpotTicketUrl } from '@/lib/hubspot/urls';
import type { SupportTrainerResponse, SupportTrainerTicket } from '@/app/api/queues/support-trainer/route';

// --- Types ---

type DifficultyFilter = 'all' | 'beginner' | 'intermediate' | 'advanced';
type SortColumn = 'companyName' | 'difficulty' | 'ageDays' | 'analyzedAt';
type SortDirection = 'asc' | 'desc';

interface TrainerComment {
  id: string;
  ticketId: string;
  userId: string;
  displayName: string;
  body: string;
  createdAt: string;
}

// --- Helper Components ---

function DifficultyBar({ difficulty }: { difficulty: string }) {
  const colors: Record<string, string> = {
    advanced: 'bg-red-500',
    intermediate: 'bg-yellow-400',
    beginner: 'bg-emerald-500',
  };
  return (
    <div className={`w-1.5 self-stretch rounded-l ${colors[difficulty] || 'bg-gray-200'}`} />
  );
}

function DifficultyBadge({ difficulty }: { difficulty: string }) {
  const colors: Record<string, string> = {
    beginner: 'bg-emerald-100 text-emerald-700',
    intermediate: 'bg-yellow-100 text-yellow-700',
    advanced: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${colors[difficulty] || 'bg-gray-100 text-gray-600'}`}>
      {difficulty.charAt(0).toUpperCase() + difficulty.slice(1)}
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

export function SupportTrainerView({ userRole, canAnalyzeTicket }: { userRole: string; canAnalyzeTicket: boolean }) {
  const searchParams = useSearchParams();
  const deepLinkTicketId = searchParams.get('ticket');
  const [data, setData] = useState<SupportTrainerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedTicket, setExpandedTicket] = useState<string | null>(deepLinkTicketId);
  const [difficultyFilter, setDifficultyFilter] = useState<DifficultyFilter>('all');
  const [sortColumn, setSortColumn] = useState<SortColumn>('difficulty');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzingTickets, setAnalyzingTickets] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<{ current: number; total: number; currentTicket: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const deepLinkScrolled = useRef(false);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/queues/support-trainer');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: SupportTrainerResponse = await res.json();
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

  // Scroll to deep-linked ticket after data loads
  useEffect(() => {
    if (deepLinkTicketId && data && !deepLinkScrolled.current) {
      deepLinkScrolled.current = true;
      requestAnimationFrame(() => {
        const el = document.getElementById(`ticket-${deepLinkTicketId}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }
  }, [deepLinkTicketId, data]);

  // Recompute counts from tickets array
  const recomputeCounts = useCallback((tickets: SupportTrainerTicket[]): SupportTrainerResponse['counts'] => {
    const analyzed = tickets.filter((t) => t.analysis).length;
    const byDifficulty = { beginner: 0, intermediate: 0, advanced: 0 };
    for (const t of tickets) {
      if (t.analysis) {
        const diff = t.analysis.difficulty_level as keyof typeof byDifficulty;
        if (diff in byDifficulty) byDifficulty[diff]++;
      }
    }
    return { total: tickets.length, analyzed, unanalyzed: tickets.length - analyzed, byDifficulty };
  }, []);

  // Single ticket analysis
  const analyzeTicket = useCallback(async (ticketId: string) => {
    setAnalyzingTickets((prev) => new Set(prev).add(ticketId));
    try {
      const res = await fetch('/api/queues/support-trainer/analyze', {
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
      const res = await fetch('/api/queues/support-trainer/batch-analyze', {
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
                  const byDifficulty = { beginner: 0, intermediate: 0, advanced: 0 };
                  for (const t of updatedTickets) {
                    if (t.analysis) {
                      const diff = t.analysis.difficulty_level as keyof typeof byDifficulty;
                      if (diff in byDifficulty) byDifficulty[diff]++;
                    }
                  }
                  return {
                    ...prev,
                    tickets: updatedTickets,
                    counts: {
                      ...prev.counts,
                      analyzed,
                      unanalyzed: prev.counts.total - analyzed,
                      byDifficulty,
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
  }, [data, analyzing]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // Filtering and sorting
  const filteredTickets = useMemo(() => {
    if (!data) return [];

    let tickets = data.tickets;

    if (difficultyFilter !== 'all') {
      tickets = tickets.filter((t) => t.analysis?.difficulty_level === difficultyFilter);
    }

    // Sort
    const difficultyOrder: Record<string, number> = { advanced: 0, intermediate: 1, beginner: 2 };
    tickets = [...tickets].sort((a, b) => {
      let cmp = 0;
      switch (sortColumn) {
        case 'companyName':
          cmp = (a.analysis?.company_name || a.companyName || '').localeCompare(
            b.analysis?.company_name || b.companyName || ''
          );
          break;
        case 'difficulty': {
          const aDiff = a.analysis ? (difficultyOrder[a.analysis.difficulty_level] ?? 3) : 4;
          const bDiff = b.analysis ? (difficultyOrder[b.analysis.difficulty_level] ?? 3) : 4;
          cmp = aDiff - bDiff;
          break;
        }
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
  }, [data, difficultyFilter, sortColumn, sortDirection]);

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
          <p className="text-red-800 font-medium">Error loading support trainer queue</p>
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
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">Support Trainer</h1>
        </div>
        <p className="text-sm text-gray-500 mt-1">
          {counts.total} open tickets &middot; {counts.analyzed} analyzed &middot; {counts.unanalyzed} pending
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {/* Analyze buttons (VP only) */}
        {userRole === 'vp_revops' && (
          !analyzing ? (
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
          )
        )}

        <div className="flex-1" />

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
              userRole={userRole}
              canAnalyze={canAnalyzeTicket}
              currentUserId={data.currentUser?.id || ''}
              currentUserDisplayName={data.currentUser?.displayName || ''}
              teamMemberCount={data.teamMemberCount || 0}
              onTicketUpdate={(updated) => {
                setData((prev) => {
                  if (!prev) return prev;
                  const updatedTickets = prev.tickets.map((t) =>
                    t.ticketId === updated.ticketId ? updated : t
                  );
                  return { ...prev, tickets: updatedTickets };
                });
              }}
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
  userRole,
  canAnalyze,
  currentUserId,
  currentUserDisplayName,
  teamMemberCount,
  onTicketUpdate,
}: {
  ticket: SupportTrainerTicket;
  isExpanded: boolean;
  onToggle: () => void;
  onAnalyze: () => void;
  isAnalyzing: boolean;
  userRole: string;
  canAnalyze: boolean;
  currentUserId: string;
  currentUserDisplayName: string;
  teamMemberCount: number;
  onTicketUpdate: (ticket: SupportTrainerTicket) => void;
}) {
  const a = ticket.analysis;
  const [comments, setComments] = useState<TrainerComment[]>([]);
  const [commentsLoaded, setCommentsLoaded] = useState(false);
  const [commentBody, setCommentBody] = useState('');
  const [postingComment, setPostingComment] = useState(false);
  const [markingRead, setMarkingRead] = useState(false);
  const [showInaccuracyForm, setShowInaccuracyForm] = useState(false);
  const [inaccuracyReason, setInaccuracyReason] = useState('');
  const [submittingInaccuracy, setSubmittingInaccuracy] = useState(false);

  const hasRead = ticket.readBy?.some((r) => r.userId === currentUserId) ?? false;
  const readCount = ticket.readBy?.length ?? 0;

  // Load comments when expanded
  useEffect(() => {
    if (isExpanded && a && !commentsLoaded) {
      fetch(`/api/queues/support-trainer/comments?ticketId=${ticket.ticketId}`)
        .then((res) => res.json())
        .then((data) => {
          setComments(data.comments || []);
          setCommentsLoaded(true);
        })
        .catch(() => setCommentsLoaded(true));
    }
  }, [isExpanded, a, commentsLoaded, ticket.ticketId]);

  const handleMarkRead = async () => {
    setMarkingRead(true);
    try {
      const res = await fetch('/api/queues/support-trainer/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId: ticket.ticketId }),
      });
      if (res.ok) {
        const { readAt } = await res.json();
        const newReadBy = [...(ticket.readBy || []), { userId: currentUserId, displayName: currentUserDisplayName, readAt }];
        onTicketUpdate({ ...ticket, readBy: newReadBy });
      }
    } catch (err) {
      console.error('Mark read failed:', err);
    } finally {
      setMarkingRead(false);
    }
  };

  const handlePostComment = async () => {
    if (!commentBody.trim()) return;
    setPostingComment(true);
    try {
      const res = await fetch('/api/queues/support-trainer/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId: ticket.ticketId, body: commentBody }),
      });
      if (res.ok) {
        const { comment } = await res.json();
        setComments((prev) => [...prev, comment]);
        setCommentBody('');
        onTicketUpdate({ ...ticket, commentCount: (ticket.commentCount || 0) + 1 });
      }
    } catch (err) {
      console.error('Post comment failed:', err);
    } finally {
      setPostingComment(false);
    }
  };

  const handleReportInaccuracy = async () => {
    if (!inaccuracyReason.trim()) return;
    setSubmittingInaccuracy(true);
    try {
      const res = await fetch('/api/queues/support-trainer/report-inaccuracy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId: ticket.ticketId, reason: inaccuracyReason }),
      });
      if (res.ok) {
        const { report } = await res.json();
        const newReports = [...(ticket.inaccuracyReports || []), {
          id: report.id,
          userId: report.userId,
          displayName: report.displayName,
          reason: report.reason,
          createdAt: report.createdAt,
          resolvedAt: null,
          resolvedBy: null,
        }];
        onTicketUpdate({ ...ticket, inaccuracyReports: newReports });
        setInaccuracyReason('');
        setShowInaccuracyForm(false);
      }
    } catch (err) {
      console.error('Report inaccuracy failed:', err);
    } finally {
      setSubmittingInaccuracy(false);
    }
  };

  const handleResolveInaccuracy = async (reportId: string) => {
    try {
      const res = await fetch('/api/queues/support-trainer/resolve-inaccuracy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId }),
      });
      if (res.ok) {
        const updatedReports = (ticket.inaccuracyReports || []).map((r) =>
          r.id === reportId ? { ...r, resolvedAt: new Date().toISOString(), resolvedBy: currentUserId } : r
        );
        onTicketUpdate({ ...ticket, inaccuracyReports: updatedReports });
      }
    } catch (err) {
      console.error('Resolve inaccuracy failed:', err);
    }
  };

  const [linkCopied, setLinkCopied] = useState(false);

  const handleCopyLink = (e: React.MouseEvent) => {
    e.stopPropagation();
    const url = `${window.location.origin}/dashboard/queues/support-trainer?ticket=${ticket.ticketId}`;
    navigator.clipboard.writeText(url).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    });
  };

  return (
    <div id={`ticket-${ticket.ticketId}`} className="border-b border-gray-200 last:border-0">
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
          {/* Difficulty color bar */}
          {a ? (
            <div className={`w-1.5 h-8 rounded-sm shrink-0 mr-4 ${
              { advanced: 'bg-red-500', intermediate: 'bg-yellow-400', beginner: 'bg-emerald-500' }[a.difficulty_level] || 'bg-gray-200'
            }`} />
          ) : (
            <div className="w-1.5 h-8 rounded-sm shrink-0 mr-4 bg-gray-200" />
          )}

          {/* Ticket ID */}
          <span className="text-[10px] text-gray-400 font-mono shrink-0 mr-3" title={`Ticket #${ticket.ticketId}`}>
            #{ticket.ticketId}
          </span>

          {/* Company */}
          <div className="w-56 shrink-0 text-sm font-semibold text-gray-900 truncate">
            {a?.company_name || ticket.companyName || 'Unknown'}
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

          {/* Read status indicator */}
          {a && (
            <div className="shrink-0 ml-3 flex items-center gap-1.5">
              {!hasRead && (
                <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" title="You haven't reviewed this yet" />
              )}
              <span className="text-[10px] text-gray-400" title={ticket.readBy?.map((r) => r.displayName).join(', ') || 'No reviews yet'}>
                {readCount}/{teamMemberCount}
              </span>
            </div>
          )}

          {/* Collaboration indicators */}
          {a && (ticket.commentCount > 0 || (ticket.inaccuracyReports || []).filter(r => !r.resolvedAt).length > 0) && (
            <div className="shrink-0 ml-2 flex items-center gap-2">
              {ticket.commentCount > 0 && (
                <span className="text-[10px] text-gray-400 flex items-center gap-0.5" title={`${ticket.commentCount} comment${ticket.commentCount > 1 ? 's' : ''}`}>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  {ticket.commentCount}
                </span>
              )}
              {(ticket.inaccuracyReports || []).filter(r => !r.resolvedAt).length > 0 && (
                <span className="text-[10px] text-amber-500 flex items-center gap-0.5" title="Has unresolved inaccuracy report">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                </span>
              )}
            </div>
          )}

          {/* Re-analyze / Analyze button */}
          {canAnalyze && (
            <div className="shrink-0 ml-auto pl-3"
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
          )}

          {/* Copy link */}
          <div className="shrink-0 ml-2" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); }}>
            <button
              onClick={handleCopyLink}
              className="text-gray-300 hover:text-indigo-500 transition-colors p-1 rounded hover:bg-indigo-50"
              title="Copy link to this ticket"
            >
              {linkCopied ? (
                <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
              )}
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

        {/* Line 2: Customer Ask + Difficulty */}
        <div className="ml-[1.625rem] mt-3 space-y-2.5">
          <div>
            <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Customer Ask </span>
            <span className="text-sm text-gray-600 leading-relaxed">
              {a ? a.customer_ask : (
                <span className="text-gray-400 italic">{ticket.subject || 'Not analyzed'}</span>
              )}
            </span>
          </div>
        </div>
      </div>

      {/* Expanded detail */}
      {isExpanded && a && (
        <div className="px-6 pb-5 pt-4 bg-slate-50 border-t-2 border-indigo-200 border-b border-b-gray-200">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left column: Training breakdown */}
            <div className="space-y-4">
              {/* Customer Ask */}
              <div>
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Customer Ask</h4>
                <p className="text-sm text-gray-700 leading-relaxed">{a.customer_ask}</p>
              </div>

              {/* Problem Breakdown */}
              <div>
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Problem Breakdown</h4>
                <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">{a.problem_breakdown}</p>
              </div>

              {/* System Explanation (highlighted) */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <h4 className="text-xs font-semibold text-blue-700 uppercase tracking-wider mb-1">System Explanation</h4>
                <p className="text-sm text-blue-900 leading-relaxed whitespace-pre-line">{a.system_explanation}</p>
              </div>

              {/* Interaction Timeline */}
              <div>
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Interaction Timeline</h4>
                <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">{a.interaction_timeline}</p>
              </div>

              {/* Resolution Approach */}
              <div>
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Resolution Approach</h4>
                <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">{a.resolution_approach}</p>
              </div>

              {/* Coaching Tips */}
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <h4 className="text-xs font-semibold text-amber-700 uppercase tracking-wider mb-1">Coaching Tips</h4>
                <p className="text-sm text-amber-900 leading-relaxed whitespace-pre-line">{a.coaching_tips}</p>
              </div>

              {/* Knowledge Areas */}
              {a.knowledge_areas && a.knowledge_areas !== 'none' && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Knowledge Areas</h4>
                  <p className="text-sm text-gray-600 leading-relaxed italic">{a.knowledge_areas}</p>
                </div>
              )}
            </div>

            {/* Right column: Metadata + Collaboration */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Ticket Details</h4>
                <span className="text-xs font-mono text-gray-400">#{ticket.ticketId}</span>
              </div>
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

                <div className="text-gray-500">Confidence</div>
                <div className="text-gray-900">{(a.confidence * 100).toFixed(0)}%</div>

                <div className="text-gray-500">Analyzed</div>
                <div className="text-gray-900">{new Date(a.analyzed_at).toLocaleString()}</div>
              </div>

              {/* Engineering Context */}
              {a.has_linear && a.linear_state && (
                <div className="pt-2 border-t border-gray-200">
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                    Engineering Context
                    <span className="ml-2 normal-case"><LinearBadge state={a.linear_state} /></span>
                  </h4>
                </div>
              )}

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

              {/* --- Collaboration Section --- */}
              <div className="pt-3 mt-3 border-t border-gray-200 space-y-4">
                {/* Mark as Reviewed */}
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Team Review</h4>
                  {!hasRead ? (
                    <button
                      onClick={handleMarkRead}
                      disabled={markingRead}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded text-xs font-medium hover:bg-indigo-100 transition-colors disabled:opacity-50"
                    >
                      {markingRead ? (
                        <Spinner />
                      ) : (
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                      Mark as Reviewed
                    </button>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-xs text-emerald-600">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      You reviewed this
                    </span>
                  )}
                  {/* Who has read */}
                  {ticket.readBy && ticket.readBy.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {ticket.readBy.map((r) => (
                        <div key={r.userId} className="flex items-center gap-2 text-xs text-gray-500">
                          <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-[10px] font-medium shrink-0">
                            {r.displayName.charAt(0).toUpperCase()}
                          </span>
                          <span>{r.displayName}</span>
                          <span className="text-gray-400">{new Date(r.readAt).toLocaleDateString()}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Inaccuracy Reports */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Inaccuracy Reports</h4>
                    {!showInaccuracyForm && (
                      <button
                        onClick={() => setShowInaccuracyForm(true)}
                        className="text-[10px] text-amber-600 hover:text-amber-700 flex items-center gap-0.5"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21v-4a4 4 0 014-4h4" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4L16.5 3.5z" />
                        </svg>
                        Report Issue
                      </button>
                    )}
                  </div>
                  {showInaccuracyForm && (
                    <div className="mb-2 space-y-2">
                      <textarea
                        value={inaccuracyReason}
                        onChange={(e) => setInaccuracyReason(e.target.value)}
                        placeholder="What seems inaccurate and why?"
                        className="w-full px-3 py-2 border border-gray-300 rounded text-sm resize-none focus:ring-1 focus:ring-amber-400 focus:border-amber-400"
                        rows={2}
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={handleReportInaccuracy}
                          disabled={submittingInaccuracy || !inaccuracyReason.trim()}
                          className="px-3 py-1 bg-amber-500 text-white rounded text-xs font-medium hover:bg-amber-600 disabled:opacity-50"
                        >
                          {submittingInaccuracy ? 'Submitting...' : 'Submit Report'}
                        </button>
                        <button
                          onClick={() => { setShowInaccuracyForm(false); setInaccuracyReason(''); }}
                          className="px-3 py-1 text-gray-500 text-xs hover:text-gray-700"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                  {ticket.inaccuracyReports && ticket.inaccuracyReports.length > 0 ? (
                    <div className="space-y-2">
                      {ticket.inaccuracyReports.map((report) => (
                        <div key={report.id} className={`p-2 rounded text-xs ${report.resolvedAt ? 'bg-gray-50 text-gray-400' : 'bg-amber-50 text-amber-800'}`}>
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <span className="font-medium">{report.displayName}</span>
                              <span className="text-gray-400 ml-1">{new Date(report.createdAt).toLocaleDateString()}</span>
                              {report.resolvedAt && <span className="ml-1 text-emerald-500">(Resolved)</span>}
                            </div>
                            {userRole === 'vp_revops' && !report.resolvedAt && (
                              <button
                                onClick={() => handleResolveInaccuracy(report.id)}
                                className="text-[10px] px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded hover:bg-emerald-200 shrink-0"
                              >
                                Resolve
                              </button>
                            )}
                          </div>
                          <p className="mt-1">{report.reason}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400">No reports</p>
                  )}
                </div>

                {/* Comments */}
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                    Comments {comments.length > 0 && `(${comments.length})`}
                  </h4>
                  {comments.length > 0 && (
                    <div className="space-y-2 mb-3 max-h-48 overflow-y-auto">
                      {comments.map((c) => (
                        <div key={c.id} className="bg-white border border-gray-200 rounded p-2 text-xs">
                          <div className="flex items-center gap-1.5 mb-1">
                            <span className="w-4 h-4 rounded-full bg-gray-200 text-gray-600 flex items-center justify-center text-[9px] font-medium">
                              {c.displayName.charAt(0).toUpperCase()}
                            </span>
                            <span className="font-medium text-gray-700">{c.displayName}</span>
                            <span className="text-gray-400">{new Date(c.createdAt).toLocaleDateString()}</span>
                          </div>
                          <p className="text-gray-600 whitespace-pre-wrap">{c.body}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={commentBody}
                      onChange={(e) => setCommentBody(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handlePostComment(); } }}
                      placeholder="Leave a comment or question..."
                      className="flex-1 px-3 py-1.5 border border-gray-300 rounded text-xs focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400"
                    />
                    <button
                      onClick={handlePostComment}
                      disabled={postingComment || !commentBody.trim()}
                      className="px-3 py-1.5 bg-indigo-600 text-white rounded text-xs font-medium hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {postingComment ? '...' : 'Post'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Expanded but not analyzed */}
      {isExpanded && !a && (
        <div className="px-6 pb-5 pt-3 bg-gray-50 border-t border-gray-100">
          <p className="text-sm text-gray-400 italic">
            This ticket has not been analyzed yet.
            {canAnalyze && (
              <>
                {' '}
                <button
                  onClick={onAnalyze}
                  disabled={isAnalyzing}
                  className="text-indigo-600 hover:underline disabled:opacity-50"
                >
                  {isAnalyzing ? 'Analyzing...' : 'Run analysis now'}
                </button>
              </>
            )}
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
