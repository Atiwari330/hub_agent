'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getHubSpotTicketUrl, getHubSpotCompanyUrl } from '@/lib/hubspot/urls';
import type { FollowUpQueueResponse, FollowUpAnalysisResponse } from '@/app/api/queues/follow-up-queue/route';

// --- Types ---

type SeverityFilter = 'all' | 'critical' | 'warning' | 'watch';
type ViolationFilter = 'all' | 'no_response' | 'customer_hanging' | 'customer_dark';
type AnalysisFilter = 'all' | 'unanalyzed' | 'confirmed' | 'false_positive' | 'monitoring';
type SortColumn = 'severity' | 'gap' | 'companyName' | 'priority' | 'ageDays';
type SortDirection = 'asc' | 'desc';

// --- Helper Components ---

function SeverityBadge({ severity }: { severity: string }) {
  const styles: Record<string, string> = {
    critical: 'bg-red-100 text-red-700',
    warning: 'bg-orange-100 text-orange-700',
    watch: 'bg-yellow-100 text-yellow-700',
  };

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[severity] || 'bg-gray-100 text-gray-600'}`}>
      {severity.charAt(0).toUpperCase() + severity.slice(1)}
    </span>
  );
}

function ViolationBadge({ type }: { type: string }) {
  const styles: Record<string, string> = {
    no_response: 'bg-red-50 text-red-600 border-red-200',
    customer_hanging: 'bg-orange-50 text-orange-600 border-orange-200',
    customer_dark: 'bg-blue-50 text-blue-600 border-blue-200',
  };
  const labels: Record<string, string> = {
    no_response: 'No Response',
    customer_hanging: 'Needs Reply',
    customer_dark: 'Needs Follow-Up',
  };

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${styles[type] || 'bg-gray-50 text-gray-600 border-gray-200'}`}>
      {labels[type] || type}
    </span>
  );
}

function AnalysisStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    confirmed: 'bg-red-100 text-red-700',
    false_positive: 'bg-gray-100 text-gray-500',
    monitoring: 'bg-blue-100 text-blue-700',
  };
  const labels: Record<string, string> = {
    confirmed: 'Confirmed',
    false_positive: 'False Positive',
    monitoring: 'Monitoring',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[status] || 'bg-gray-100 text-gray-600'}`}>
      {labels[status] || status}
    </span>
  );
}

function UrgencyBadge({ urgency }: { urgency: string }) {
  const styles: Record<string, string> = {
    critical: 'bg-red-100 text-red-700',
    high: 'bg-orange-100 text-orange-700',
    medium: 'bg-yellow-100 text-yellow-700',
    low: 'bg-gray-100 text-gray-600',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[urgency] || 'bg-gray-100 text-gray-600'}`}>
      {urgency.charAt(0).toUpperCase() + urgency.slice(1)}
    </span>
  );
}

function SentimentBadge({ sentiment }: { sentiment: string | null }) {
  if (!sentiment) return null;
  const styles: Record<string, string> = {
    positive: 'bg-emerald-100 text-emerald-700',
    neutral: 'bg-gray-100 text-gray-600',
    negative: 'bg-orange-100 text-orange-700',
    frustrated: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[sentiment] || 'bg-gray-100 text-gray-600'}`}>
      {sentiment.charAt(0).toUpperCase() + sentiment.slice(1)}
    </span>
  );
}

function SortIcon({ active, direction }: { active: boolean; direction: SortDirection }) {
  if (!active) {
    return (
      <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
      </svg>
    );
  }
  return direction === 'asc' ? (
    <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
    </svg>
  ) : (
    <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );
}

// --- Main Component ---

export function FollowUpQueueView() {
  const [data, setData] = useState<FollowUpQueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [analyzingTickets, setAnalyzingTickets] = useState<Set<string>>(new Set());

  // Batch analyze state
  const [isBatchAnalyzing, setIsBatchAnalyzing] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{
    current: number;
    total: number;
    currentTicket: string;
    successful: number;
    failed: number;
  } | null>(null);
  const batchAbortRef = useRef<AbortController | null>(null);

  // Filters
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [violationFilter, setViolationFilter] = useState<ViolationFilter>('all');
  const [analysisFilter, setAnalysisFilter] = useState<AnalysisFilter>('all');

  // Sorting
  const [sortColumn, setSortColumn] = useState<SortColumn>('severity');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // --- Data Fetching ---

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/queues/follow-up-queue');
      if (!response.ok) throw new Error('Failed to fetch follow-up queue data');
      const json: FollowUpQueueResponse = await response.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // --- Sorting & Filtering ---

  const SEVERITY_ORDER: Record<string, number> = { critical: 3, warning: 2, watch: 1 };
  const PRIORITY_ORDER: Record<string, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };

  const processedTickets = useMemo(() => {
    if (!data) return [];

    let result = [...data.tickets];

    if (severityFilter !== 'all') {
      result = result.filter((t) => t.severity === severityFilter);
    }
    if (violationFilter !== 'all') {
      result = result.filter((t) => t.violationType === violationFilter);
    }
    if (analysisFilter !== 'all') {
      if (analysisFilter === 'unanalyzed') {
        result = result.filter((t) => !t.analysis);
      } else {
        result = result.filter((t) => t.analysis?.status === analysisFilter);
      }
    }

    result.sort((a, b) => {
      let comparison = 0;
      switch (sortColumn) {
        case 'severity':
          comparison = (SEVERITY_ORDER[a.severity] || 0) - (SEVERITY_ORDER[b.severity] || 0);
          break;
        case 'gap':
          comparison = a.gapHours - b.gapHours;
          break;
        case 'companyName':
          comparison = (a.companyName || '').localeCompare(b.companyName || '');
          break;
        case 'priority':
          comparison = (PRIORITY_ORDER[a.priority?.toUpperCase() || ''] || 0) - (PRIORITY_ORDER[b.priority?.toUpperCase() || ''] || 0);
          break;
        case 'ageDays':
          comparison = a.ageDays - b.ageDays;
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [data, severityFilter, violationFilter, analysisFilter, sortColumn, sortDirection]);

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  const hasActiveFilters = severityFilter !== 'all' || violationFilter !== 'all' || analysisFilter !== 'all';

  const clearFilters = () => {
    setSeverityFilter('all');
    setViolationFilter('all');
    setAnalysisFilter('all');
  };

  const toggleRow = (key: string) => {
    setExpandedRow(expandedRow === key ? null : key);
  };

  // --- Actions ---

  const recomputeCounts = useCallback(
    (tickets: FollowUpQueueResponse['tickets']): FollowUpQueueResponse['counts'] => {
      const analyzed = tickets.filter((t) => t.analysis).length;
      return {
        total: tickets.length,
        critical: tickets.filter((t) => t.severity === 'critical').length,
        warning: tickets.filter((t) => t.severity === 'warning').length,
        watch: tickets.filter((t) => t.severity === 'watch').length,
        byType: {
          noResponse: tickets.filter((t) => t.violationType === 'no_response').length,
          customerHanging: tickets.filter((t) => t.violationType === 'customer_hanging').length,
          customerDark: tickets.filter((t) => t.violationType === 'customer_dark').length,
        },
        analyzed,
        unanalyzed: tickets.length - analyzed,
        confirmed: tickets.filter((t) => t.analysis?.status === 'confirmed').length,
        falsePositive: tickets.filter((t) => t.analysis?.status === 'false_positive').length,
        monitoring: tickets.filter((t) => t.analysis?.status === 'monitoring').length,
      };
    },
    []
  );

  const analyzeTicket = async (ticket: FollowUpQueueResponse['tickets'][0]) => {
    setAnalyzingTickets((prev) => new Set(prev).add(ticket.ticketId));

    try {
      const response = await fetch('/api/queues/follow-up-queue/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticketId: ticket.ticketId,
          violationType: ticket.violationType,
          violationLabel: ticket.violationLabel,
          severity: ticket.severity,
          gapHours: ticket.gapHours,
          gapDisplay: ticket.gapDisplay,
          ownerName: ticket.ownerName,
          ownerId: ticket.ownerId,
        }),
      });

      if (!response.ok) throw new Error('Analysis failed');

      const result = await response.json();
      const analysis: FollowUpAnalysisResponse = {
        status: result.analysis.status,
        urgency: result.analysis.urgency,
        customer_sentiment: result.analysis.customer_sentiment,
        recommended_action: result.analysis.recommended_action,
        reasoning: result.analysis.reasoning,
        last_meaningful_contact: result.analysis.last_meaningful_contact,
        confidence: result.analysis.confidence,
        engagement_count: result.analysis.engagement_count,
        analyzed_at: result.analysis.analyzed_at,
      };

      setData((prev) => {
        if (!prev) return prev;
        const updatedTickets = prev.tickets.map((t) =>
          t.ticketId === ticket.ticketId ? { ...t, analysis } : t
        );
        return { tickets: updatedTickets, counts: recomputeCounts(updatedTickets) };
      });
    } catch (err) {
      console.error('Analysis failed:', err);
    } finally {
      setAnalyzingTickets((prev) => {
        const next = new Set(prev);
        next.delete(ticket.ticketId);
        return next;
      });
    }
  };

  const batchAnalyze = async () => {
    if (!data) return;

    const unanalyzedTickets = data.tickets.filter((t) => !t.analysis);
    if (unanalyzedTickets.length === 0) return;

    setIsBatchAnalyzing(true);
    setBatchProgress({ current: 0, total: unanalyzedTickets.length, currentTicket: '', successful: 0, failed: 0 });

    const abortController = new AbortController();
    batchAbortRef.current = abortController;

    try {
      const response = await fetch('/api/queues/follow-up-queue/batch-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tickets: unanalyzedTickets.map((t) => ({
            ticketId: t.ticketId,
            violationType: t.violationType,
            violationLabel: t.violationLabel,
            severity: t.severity,
            gapHours: t.gapHours,
            gapDisplay: t.gapDisplay,
            ownerName: t.ownerName,
            ownerId: t.ownerId,
          })),
        }),
        signal: abortController.signal,
      });

      if (!response.ok) throw new Error('Batch analysis failed to start');

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response stream');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const dataLine = line.trim();
          if (!dataLine.startsWith('data: ')) continue;

          try {
            const event = JSON.parse(dataLine.slice(6));

            if (event.type === 'progress') {
              setBatchProgress((prev) => ({
                current: event.index,
                total: event.total,
                currentTicket: event.ticketSubject || '',
                successful: event.status === 'success' ? (prev?.successful ?? 0) + 1 : (prev?.successful ?? 0),
                failed: event.status === 'error' ? (prev?.failed ?? 0) + 1 : (prev?.failed ?? 0),
              }));

              if (event.status === 'success' && event.analysis) {
                const analysis: FollowUpAnalysisResponse = {
                  status: event.analysis.status,
                  urgency: event.analysis.urgency,
                  customer_sentiment: event.analysis.customer_sentiment,
                  recommended_action: event.analysis.recommended_action,
                  reasoning: event.analysis.reasoning,
                  last_meaningful_contact: event.analysis.last_meaningful_contact,
                  confidence: event.analysis.confidence,
                  engagement_count: event.analysis.engagement_count,
                  analyzed_at: event.analysis.analyzed_at,
                };

                setData((prev) => {
                  if (!prev) return prev;
                  const updatedTickets = prev.tickets.map((t) =>
                    t.ticketId === event.ticketId ? { ...t, analysis } : t
                  );
                  return { tickets: updatedTickets, counts: recomputeCounts(updatedTickets) };
                });
              }
            }

            if (event.type === 'done') {
              setBatchProgress((prev) => prev ? {
                ...prev,
                current: event.processed,
                successful: event.successful,
                failed: event.failed,
              } : null);
            }
          } catch {
            // Skip malformed events
          }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // User cancelled
      } else {
        console.error('Batch analysis error:', err);
      }
    } finally {
      setIsBatchAnalyzing(false);
      batchAbortRef.current = null;
    }
  };

  const cancelBatch = () => {
    batchAbortRef.current?.abort();
  };

  // --- Render ---

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Follow-Up Queue</h1>
        <p className="text-sm text-gray-600 mt-1">
          Tickets needing agent action — unanswered customers, stale conversations, and missing first responses.
        </p>
      </div>

      {/* Summary Banner */}
      {!loading && data && data.counts.total > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
          <div className="flex flex-wrap items-center gap-6">
            <div>
              <div className="text-3xl font-bold text-gray-900">{data.counts.total}</div>
              <div className="text-xs text-gray-500 uppercase tracking-wider mt-0.5">Tickets Need Attention</div>
            </div>
            <div className="h-12 w-px bg-gray-200" />
            <div className="flex items-center gap-4">
              {data.counts.critical > 0 && (
                <button
                  onClick={() => setSeverityFilter(severityFilter === 'critical' ? 'all' : 'critical')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    severityFilter === 'critical' ? 'bg-red-100 text-red-800 ring-2 ring-red-300' : 'bg-red-50 text-red-700 hover:bg-red-100'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-red-500" />
                  {data.counts.critical} Critical
                </button>
              )}
              {data.counts.warning > 0 && (
                <button
                  onClick={() => setSeverityFilter(severityFilter === 'warning' ? 'all' : 'warning')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    severityFilter === 'warning' ? 'bg-orange-100 text-orange-800 ring-2 ring-orange-300' : 'bg-orange-50 text-orange-700 hover:bg-orange-100'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-orange-500" />
                  {data.counts.warning} Warning
                </button>
              )}
              {data.counts.watch > 0 && (
                <button
                  onClick={() => setSeverityFilter(severityFilter === 'watch' ? 'all' : 'watch')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    severityFilter === 'watch' ? 'bg-yellow-100 text-yellow-800 ring-2 ring-yellow-300' : 'bg-yellow-50 text-yellow-700 hover:bg-yellow-100'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-yellow-500" />
                  {data.counts.watch} Watch
                </button>
              )}
            </div>
            <div className="h-12 w-px bg-gray-200" />
            <div className="flex items-center gap-4 text-sm text-gray-600">
              {data.counts.byType.noResponse > 0 && (
                <button
                  onClick={() => setViolationFilter(violationFilter === 'no_response' ? 'all' : 'no_response')}
                  className={`transition-colors ${violationFilter === 'no_response' ? 'font-semibold text-red-700' : 'hover:text-gray-900'}`}
                >
                  {data.counts.byType.noResponse} No Response
                </button>
              )}
              {data.counts.byType.customerHanging > 0 && (
                <button
                  onClick={() => setViolationFilter(violationFilter === 'customer_hanging' ? 'all' : 'customer_hanging')}
                  className={`transition-colors ${violationFilter === 'customer_hanging' ? 'font-semibold text-orange-700' : 'hover:text-gray-900'}`}
                >
                  {data.counts.byType.customerHanging} Needs Reply
                </button>
              )}
              {data.counts.byType.customerDark > 0 && (
                <button
                  onClick={() => setViolationFilter(violationFilter === 'customer_dark' ? 'all' : 'customer_dark')}
                  className={`transition-colors ${violationFilter === 'customer_dark' ? 'font-semibold text-blue-700' : 'hover:text-gray-900'}`}
                >
                  {data.counts.byType.customerDark} Needs Follow-Up
                </button>
              )}
            </div>
            <div className="h-12 w-px bg-gray-200" />
            <div className="flex items-center gap-3 text-sm text-gray-500">
              <span>{data.counts.analyzed} analyzed</span>
              <span className="text-gray-300">|</span>
              <span>{data.counts.unanalyzed} unanalyzed</span>
            </div>
          </div>
        </div>
      )}

      {/* Action Buttons Row */}
      {!loading && data && data.counts.total > 0 && (
        <div className="flex flex-wrap items-center gap-3 mb-4">
          {data.counts.unanalyzed > 0 && !isBatchAnalyzing && (
            <button
              onClick={batchAnalyze}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Analyze All Unanalyzed ({data.counts.unanalyzed})
            </button>
          )}

          {/* Batch progress indicator */}
          {isBatchAnalyzing && batchProgress && (
            <div className="flex items-center gap-3 bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-2">
              <svg className="animate-spin h-4 w-4 text-indigo-600" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <div className="text-sm">
                <span className="font-medium text-indigo-700">
                  Analyzing {batchProgress.current} of {batchProgress.total}...
                </span>
                {batchProgress.currentTicket && (
                  <span className="text-indigo-500 ml-2 truncate max-w-xs inline-block align-bottom">
                    ({batchProgress.currentTicket})
                  </span>
                )}
              </div>
              <div className="w-32 bg-indigo-100 rounded-full h-2">
                <div
                  className="bg-indigo-600 h-2 rounded-full transition-all"
                  style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
                />
              </div>
              <button onClick={cancelBatch} className="text-sm text-indigo-600 hover:text-indigo-800 font-medium">
                Cancel
              </button>
            </div>
          )}

          {/* Batch complete summary */}
          {!isBatchAnalyzing && batchProgress && batchProgress.current === batchProgress.total && (
            <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2">
              <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-sm text-emerald-700">
                Batch complete: {batchProgress.successful} analyzed
                {batchProgress.failed > 0 && `, ${batchProgress.failed} failed`}
              </span>
              <button onClick={() => setBatchProgress(null)} className="text-sm text-emerald-600 hover:text-emerald-800 ml-2">
                Dismiss
              </button>
            </div>
          )}
        </div>
      )}

      {/* Filters Row */}
      {!loading && data && data.counts.total > 0 && (
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600">Severity:</label>
            <select
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value as SeverityFilter)}
              className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="all">All</option>
              <option value="critical">Critical</option>
              <option value="warning">Warning</option>
              <option value="watch">Watch</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600">Violation:</label>
            <select
              value={violationFilter}
              onChange={(e) => setViolationFilter(e.target.value as ViolationFilter)}
              className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="all">All</option>
              <option value="no_response">No Response</option>
              <option value="customer_hanging">Needs Reply</option>
              <option value="customer_dark">Needs Follow-Up</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600">Analysis:</label>
            <select
              value={analysisFilter}
              onChange={(e) => setAnalysisFilter(e.target.value as AnalysisFilter)}
              className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="all">All</option>
              <option value="unanalyzed">Unanalyzed</option>
              <option value="confirmed">Confirmed</option>
              <option value="false_positive">False Positive</option>
              <option value="monitoring">Monitoring</option>
            </select>
          </div>

          {hasActiveFilters && (
            <button onClick={clearFilters} className="text-sm text-gray-500 hover:text-gray-700">
              Clear filters
            </button>
          )}

          <span className="text-sm text-gray-500 ml-auto">
            {processedTickets.length} ticket{processedTickets.length !== 1 ? 's' : ''} showing
          </span>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-sm text-red-700">{error}</p>
          <button onClick={fetchData} className="mt-2 text-sm text-red-600 hover:text-red-800 font-medium">
            Try again
          </button>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && (!data || data.counts.total === 0) && (
        <div className="text-center py-12 bg-slate-50 rounded-lg border border-slate-200">
          <svg className="mx-auto h-12 w-12 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 13l4 4L19 7" />
          </svg>
          <h3 className="mt-4 text-lg font-medium text-gray-900">All Clear</h3>
          <p className="mt-1 text-sm text-gray-600">
            No tickets need follow-up action right now.
          </p>
        </div>
      )}

      {/* Empty filtered state */}
      {!loading && !error && data && data.counts.total > 0 && processedTickets.length === 0 && (
        <div className="text-center py-12 bg-slate-50 rounded-lg border border-slate-200">
          <h3 className="text-lg font-medium text-gray-900">No tickets match the current filters</h3>
          <p className="mt-1 text-sm text-gray-600">Try adjusting the filters.</p>
        </div>
      )}

      {/* Tickets Table */}
      {!loading && !error && processedTickets.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 border-b border-gray-200">
                  <th className="w-8 px-2 py-3"></th>
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                    onClick={() => handleSort('severity')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Severity</span>
                      <SortIcon active={sortColumn === 'severity'} direction={sortDirection} />
                    </div>
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider whitespace-nowrap">
                    Violation
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider whitespace-nowrap">
                    Ticket
                  </th>
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                    onClick={() => handleSort('companyName')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Company</span>
                      <SortIcon active={sortColumn === 'companyName'} direction={sortDirection} />
                    </div>
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider whitespace-nowrap">
                    Owner
                  </th>
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                    onClick={() => handleSort('gap')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Gap</span>
                      <SortIcon active={sortColumn === 'gap'} direction={sortDirection} />
                    </div>
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider whitespace-nowrap">
                    Action Needed
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider whitespace-nowrap">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {processedTickets.map((ticket) => {
                  const isExpanded = expandedRow === ticket.ticketId;
                  const isAnalyzing = analyzingTickets.has(ticket.ticketId);
                  const isFalsePositive = ticket.analysis?.status === 'false_positive';

                  return (
                    <React.Fragment key={ticket.ticketId}>
                      <tr
                        className={`hover:bg-slate-50 transition-colors cursor-pointer ${isFalsePositive ? 'opacity-60' : ''}`}
                        onClick={() => toggleRow(ticket.ticketId)}
                      >
                        <td className="px-2 py-3">
                          <svg
                            className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                            fill="none" stroke="currentColor" viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </td>
                        <td className="px-4 py-3">
                          <SeverityBadge severity={ticket.severity} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <ViolationBadge type={ticket.violationType} />
                            {ticket.analysis && (
                              <AnalysisStatusBadge status={ticket.analysis.status} />
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <a
                            href={getHubSpotTicketUrl(ticket.ticketId)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-gray-900 hover:text-indigo-600 transition-colors line-clamp-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {ticket.subject || 'No subject'}
                          </a>
                        </td>
                        <td className="px-4 py-3">
                          {ticket.companyId ? (
                            <a
                              href={getHubSpotCompanyUrl(ticket.companyId)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm font-medium text-gray-900 hover:text-indigo-600 transition-colors"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {ticket.companyName || 'Unnamed'}
                            </a>
                          ) : (
                            <span className="text-sm text-gray-500 italic">No Company</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {ticket.ownerName || '-'}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-sm font-medium ${
                            ticket.severity === 'critical'
                              ? 'text-red-600'
                              : ticket.severity === 'warning'
                                ? 'text-orange-600'
                                : 'text-yellow-600'
                          }`}>
                            {ticket.gapDisplay}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {ticket.analysis ? (
                            <div className="flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 flex-shrink-0" />
                              <span className="text-sm text-gray-700 line-clamp-1">{ticket.analysis.recommended_action}</span>
                            </div>
                          ) : (
                            <span className="text-sm text-gray-600">{ticket.recommendedAction}</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              analyzeTicket(ticket);
                            }}
                            disabled={isAnalyzing || isBatchAnalyzing}
                            className={`text-sm font-medium px-3 py-1 rounded transition-colors ${
                              isAnalyzing || isBatchAnalyzing
                                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'
                            }`}
                          >
                            {isAnalyzing ? (
                              <span className="flex items-center gap-1.5">
                                <svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                </svg>
                                Analyzing...
                              </span>
                            ) : ticket.analysis ? 'Re-analyze' : 'Analyze'}
                          </button>
                        </td>
                      </tr>

                      {/* Expanded Row - Analysis Details */}
                      {isExpanded && (
                        <tr>
                          <td colSpan={9} className="px-0 py-0">
                            <div className="bg-slate-50 border-y border-gray-200 px-8 py-4">
                              {ticket.analysis ? (
                                <div className="space-y-3">
                                  <div className="flex items-center gap-4 flex-wrap">
                                    <AnalysisStatusBadge status={ticket.analysis.status} />
                                    <UrgencyBadge urgency={ticket.analysis.urgency} />
                                    <SentimentBadge sentiment={ticket.analysis.customer_sentiment} />
                                    <span className="text-sm text-gray-500">
                                      Confidence: {Math.round(ticket.analysis.confidence * 100)}%
                                    </span>
                                    <span className="text-sm text-gray-400">
                                      {ticket.analysis.engagement_count} engagements analyzed
                                    </span>
                                    <span className="text-xs text-gray-400 ml-auto">
                                      Analyzed {new Date(ticket.analysis.analyzed_at).toLocaleString()}
                                    </span>
                                  </div>

                                  <div>
                                    <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Recommended Action</h4>
                                    <p className="text-sm text-gray-700">{ticket.analysis.recommended_action}</p>
                                  </div>

                                  <div>
                                    <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Reasoning</h4>
                                    <p className="text-sm text-gray-700">{ticket.analysis.reasoning}</p>
                                  </div>

                                  {ticket.analysis.last_meaningful_contact && (
                                    <div>
                                      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Last Meaningful Contact</h4>
                                      <p className="text-sm text-gray-700">{ticket.analysis.last_meaningful_contact}</p>
                                    </div>
                                  )}

                                  <div className="border-t border-gray-200 pt-3">
                                    <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Original Detection</h4>
                                    <div className="flex items-center gap-4 text-sm text-gray-600">
                                      <span>Type: {ticket.violationLabel}</span>
                                      <span>Severity: {ticket.severity}</span>
                                      <span>Gap: {ticket.gapDisplay}</span>
                                      <span>Default action: {ticket.recommendedAction}</span>
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                <div className="text-center py-4">
                                  <p className="text-sm text-gray-500 mb-2">
                                    This ticket hasn&apos;t been analyzed yet. The LLM will read the full engagement timeline to validate the detection.
                                  </p>
                                  <button
                                    onClick={() => analyzeTicket(ticket)}
                                    disabled={isAnalyzing || isBatchAnalyzing}
                                    className="text-sm font-medium px-4 py-2 rounded bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-50"
                                  >
                                    {isAnalyzing ? 'Analyzing...' : 'Analyze This Ticket'}
                                  </button>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
