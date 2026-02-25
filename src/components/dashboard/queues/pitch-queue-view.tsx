'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getHubSpotTicketUrl, getHubSpotCompanyUrl } from '@/lib/hubspot/urls';
import type {
  PitchQueueResponse,
  PitchAnalysis,
} from '@/app/api/queues/pitch-queue/route';

type SortColumn =
  | 'companyName'
  | 'subject'
  | 'sourceType'
  | 'ageDays'
  | 'priority'
  | 'recommendation'
  | 'confidence';
type SortDirection = 'asc' | 'desc';
type RecommendationFilter = 'all' | 'unanalyzed' | 'pitch' | 'maybe' | 'skip';

function SortIcon({
  active,
  direction,
}: {
  active: boolean;
  direction: SortDirection;
}) {
  if (!active) {
    return (
      <svg
        className="w-4 h-4 text-gray-400"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"
        />
      </svg>
    );
  }
  return direction === 'asc' ? (
    <svg
      className="w-4 h-4 text-indigo-600"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
    </svg>
  ) : (
    <svg
      className="w-4 h-4 text-indigo-600"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function RecommendationBadge({
  recommendation,
}: {
  recommendation: 'pitch' | 'skip' | 'maybe' | null;
}) {
  if (!recommendation) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border border-gray-300 text-gray-500">
        Unanalyzed
      </span>
    );
  }

  const styles = {
    pitch: 'bg-emerald-100 text-emerald-700',
    maybe: 'bg-yellow-100 text-yellow-700',
    skip: 'bg-gray-100 text-gray-600',
  };

  const labels = {
    pitch: 'Pitch',
    maybe: 'Maybe',
    skip: 'Skip',
  };

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[recommendation]}`}
    >
      {labels[recommendation]}
    </span>
  );
}

function SentimentBadge({
  sentiment,
}: {
  sentiment: 'positive' | 'neutral' | 'negative' | null;
}) {
  if (!sentiment) return null;

  const styles = {
    positive: 'text-emerald-600',
    neutral: 'text-gray-500',
    negative: 'text-red-600',
  };

  return (
    <span className={`text-xs font-medium ${styles[sentiment]}`}>
      {sentiment.charAt(0).toUpperCase() + sentiment.slice(1)}
    </span>
  );
}

export function PitchQueueView() {
  const [data, setData] = useState<PitchQueueResponse | null>(null);
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
  const [recommendationFilter, setRecommendationFilter] =
    useState<RecommendationFilter>('all');
  const [companyFilter, setCompanyFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');

  // Sorting
  const [sortColumn, setSortColumn] = useState<SortColumn>('ageDays');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/queues/pitch-queue');
      if (!response.ok) {
        throw new Error('Failed to fetch pitch queue data');
      }
      const json: PitchQueueResponse = await response.json();
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

  // Helper to recompute counts after ticket state changes
  const recomputeCounts = useCallback(
    (tickets: PitchQueueResponse['tickets']): PitchQueueResponse['counts'] => {
      const analyzed = tickets.filter((t) => t.analysis).length;
      const pitch = tickets.filter((t) => t.analysis?.recommendation === 'pitch').length;
      const maybe = tickets.filter((t) => t.analysis?.recommendation === 'maybe').length;
      const skip = tickets.filter((t) => t.analysis?.recommendation === 'skip').length;
      return {
        total: tickets.length,
        analyzed,
        pitch,
        maybe,
        skip,
        unanalyzed: tickets.length - analyzed,
      };
    },
    []
  );

  // Analyze a single ticket
  const analyzeTicket = async (ticketId: string) => {
    setAnalyzingTickets((prev) => new Set(prev).add(ticketId));

    try {
      const response = await fetch('/api/queues/pitch-queue/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId }),
      });

      if (!response.ok) {
        throw new Error('Analysis failed');
      }

      const result = await response.json();
      const analysis: PitchAnalysis = result.analysis;

      setData((prev) => {
        if (!prev) return prev;
        const updatedTickets = prev.tickets.map((t) =>
          t.ticketId === ticketId ? { ...t, analysis } : t
        );
        return { tickets: updatedTickets, counts: recomputeCounts(updatedTickets) };
      });
    } catch (err) {
      console.error('Analysis failed:', err);
    } finally {
      setAnalyzingTickets((prev) => {
        const next = new Set(prev);
        next.delete(ticketId);
        return next;
      });
    }
  };

  // Batch analyze all unanalyzed tickets
  const batchAnalyze = async () => {
    if (!data) return;

    const unanalyzedIds = data.tickets
      .filter((t) => !t.analysis)
      .map((t) => t.ticketId);

    if (unanalyzedIds.length === 0) return;

    setIsBatchAnalyzing(true);
    setBatchProgress({ current: 0, total: unanalyzedIds.length, currentTicket: '', successful: 0, failed: 0 });

    const abortController = new AbortController();
    batchAbortRef.current = abortController;

    try {
      const response = await fetch('/api/queues/pitch-queue/batch-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketIds: unanalyzedIds }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error('Batch analysis failed to start');
      }

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
              setBatchProgress({
                current: event.index,
                total: event.total,
                currentTicket: event.ticketSubject || '',
                successful: event.status === 'success'
                  ? (batchProgress?.successful ?? 0) + 1
                  : (batchProgress?.successful ?? 0),
                failed: event.status === 'error'
                  ? (batchProgress?.failed ?? 0) + 1
                  : (batchProgress?.failed ?? 0),
              });

              // Update ticket in state on success
              if (event.status === 'success' && event.analysis) {
                const analysis: PitchAnalysis = {
                  hubspot_ticket_id: event.ticketId,
                  company_id: null,
                  company_name: event.analysis.company_name,
                  contact_name: event.analysis.contact_name,
                  contact_email: event.analysis.contact_email,
                  ticket_subject: event.ticketSubject,
                  recommendation: event.analysis.recommendation as 'pitch' | 'skip' | 'maybe',
                  confidence: event.analysis.confidence,
                  talking_points: event.analysis.talking_points,
                  reasoning: event.analysis.reasoning,
                  customer_sentiment: event.analysis.customer_sentiment as 'positive' | 'neutral' | 'negative' | null,
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

  // Export CSV
  const exportCsv = (filter: string = 'all') => {
    const params = new URLSearchParams();
    if (filter !== 'all') params.set('filter', filter);
    const url = `/api/queues/pitch-queue/export${params.toString() ? `?${params}` : ''}`;
    window.open(url, '_blank');
  };

  // Unique companies and sources for filters
  const uniqueCompanies = useMemo(() => {
    if (!data) return [];
    const values = new Set<string>();
    for (const ticket of data.tickets) {
      if (ticket.companyName) values.add(ticket.companyName);
    }
    return Array.from(values).sort();
  }, [data]);

  const uniqueSources = useMemo(() => {
    if (!data) return [];
    const values = new Set<string>();
    for (const ticket of data.tickets) {
      if (ticket.sourceType) values.add(ticket.sourceType);
    }
    return Array.from(values).sort();
  }, [data]);

  // Filtered and sorted tickets
  const processedTickets = useMemo(() => {
    if (!data) return [];

    let result = [...data.tickets];

    // Recommendation filter
    if (recommendationFilter === 'unanalyzed') {
      result = result.filter((t) => !t.analysis);
    } else if (recommendationFilter !== 'all') {
      result = result.filter(
        (t) => t.analysis?.recommendation === recommendationFilter
      );
    }

    // Company filter
    if (companyFilter !== 'all') {
      result = result.filter((t) => t.companyName === companyFilter);
    }

    // Source filter
    if (sourceFilter !== 'all') {
      result = result.filter((t) => t.sourceType === sourceFilter);
    }

    // Sort
    result.sort((a, b) => {
      let comparison = 0;
      switch (sortColumn) {
        case 'companyName':
          comparison = (a.companyName || '').localeCompare(b.companyName || '');
          break;
        case 'subject':
          comparison = (a.subject || '').localeCompare(b.subject || '');
          break;
        case 'sourceType':
          comparison = (a.sourceType || '').localeCompare(b.sourceType || '');
          break;
        case 'ageDays':
          comparison = a.ageDays - b.ageDays;
          break;
        case 'priority': {
          const priorityOrder: Record<string, number> = {
            HIGH: 3,
            MEDIUM: 2,
            LOW: 1,
          };
          comparison =
            (priorityOrder[a.priority || ''] || 0) -
            (priorityOrder[b.priority || ''] || 0);
          break;
        }
        case 'recommendation': {
          const recOrder: Record<string, number> = {
            pitch: 3,
            maybe: 2,
            skip: 1,
          };
          const aRec = a.analysis?.recommendation
            ? recOrder[a.analysis.recommendation] || 0
            : -1;
          const bRec = b.analysis?.recommendation
            ? recOrder[b.analysis.recommendation] || 0
            : -1;
          comparison = aRec - bRec;
          break;
        }
        case 'confidence':
          comparison =
            (a.analysis?.confidence || 0) - (b.analysis?.confidence || 0);
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [
    data,
    recommendationFilter,
    companyFilter,
    sourceFilter,
    sortColumn,
    sortDirection,
  ]);

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  const hasActiveFilters =
    recommendationFilter !== 'all' ||
    companyFilter !== 'all' ||
    sourceFilter !== 'all';

  const clearFilters = () => {
    setRecommendationFilter('all');
    setCompanyFilter('all');
    setSourceFilter('all');
  };

  const toggleRow = (key: string) => {
    setExpandedRow(expandedRow === key ? null : key);
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Pitch Queue</h1>
        <p className="text-sm text-gray-600 mt-1">
          Identify upsell opportunities in open support tickets. Click
          &quot;Analyze&quot; to get an LLM assessment.
        </p>
      </div>

      {/* Summary Cards */}
      {!loading && data && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
          <div className="bg-white rounded-lg border border-gray-200 p-3">
            <div className="text-xs text-gray-500 uppercase tracking-wider">
              Open Tickets
            </div>
            <div className="text-2xl font-bold text-gray-900 mt-1">
              {data.counts.total}
            </div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-3">
            <div className="text-xs text-gray-500 uppercase tracking-wider">
              Analyzed
            </div>
            <div className="text-2xl font-bold text-indigo-600 mt-1">
              {data.counts.analyzed}
            </div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-3">
            <div className="text-xs text-gray-500 uppercase tracking-wider">
              Pitch
            </div>
            <div className="text-2xl font-bold text-emerald-600 mt-1">
              {data.counts.pitch}
            </div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-3">
            <div className="text-xs text-gray-500 uppercase tracking-wider">
              Maybe
            </div>
            <div className="text-2xl font-bold text-yellow-600 mt-1">
              {data.counts.maybe}
            </div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-3">
            <div className="text-xs text-gray-500 uppercase tracking-wider">
              Skip
            </div>
            <div className="text-2xl font-bold text-gray-500 mt-1">
              {data.counts.skip}
            </div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-3">
            <div className="text-xs text-gray-500 uppercase tracking-wider">
              Unanalyzed
            </div>
            <div className="text-2xl font-bold text-gray-400 mt-1">
              {data.counts.unanalyzed}
            </div>
          </div>
        </div>
      )}

      {/* Action Buttons Row */}
      {!loading && data && (
        <div className="flex flex-wrap items-center gap-3 mb-4">
          {/* Analyze All button */}
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
              {/* Progress bar */}
              <div className="w-32 bg-indigo-100 rounded-full h-2">
                <div
                  className="bg-indigo-600 h-2 rounded-full transition-all"
                  style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
                />
              </div>
              <button
                onClick={cancelBatch}
                className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
              >
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
              <button
                onClick={() => setBatchProgress(null)}
                className="text-sm text-emerald-600 hover:text-emerald-800 ml-2"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Export CSV button */}
          {data.counts.analyzed > 0 && (
            <button
              onClick={() => exportCsv(recommendationFilter !== 'all' && recommendationFilter !== 'unanalyzed' ? recommendationFilter : 'all')}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Export CSV
              {recommendationFilter !== 'all' && recommendationFilter !== 'unanalyzed' && (
                <span className="text-xs text-gray-500">({recommendationFilter})</span>
              )}
            </button>
          )}
        </div>
      )}

      {/* Filters Row */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Status:</label>
          <select
            value={recommendationFilter}
            onChange={(e) =>
              setRecommendationFilter(e.target.value as RecommendationFilter)
            }
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="all">All</option>
            <option value="unanalyzed">Unanalyzed</option>
            <option value="pitch">Pitch</option>
            <option value="maybe">Maybe</option>
            <option value="skip">Skip</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Company:</label>
          <select
            value={companyFilter}
            onChange={(e) => setCompanyFilter(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="all">All Companies</option>
            {uniqueCompanies.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Source:</label>
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="all">All Sources</option>
            {uniqueSources.map((src) => (
              <option key={src} value={src}>
                {src}
              </option>
            ))}
          </select>
        </div>

        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Clear filters
          </button>
        )}

        <span className="text-sm text-gray-500 ml-auto">
          {processedTickets.length} ticket
          {processedTickets.length !== 1 ? 's' : ''} showing
        </span>
      </div>

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
          <button
            onClick={fetchData}
            className="mt-2 text-sm text-red-600 hover:text-red-800 font-medium"
          >
            Try again
          </button>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && processedTickets.length === 0 && (
        <div className="text-center py-12 bg-emerald-50 rounded-lg border border-emerald-200">
          <svg
            className="mx-auto h-12 w-12 text-emerald-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <h3 className="mt-4 text-lg font-medium text-emerald-900">
            {hasActiveFilters
              ? 'No tickets match the current filters'
              : 'No open tickets found'}
          </h3>
          <p className="mt-1 text-sm text-emerald-700">
            {hasActiveFilters
              ? 'Try adjusting the filters.'
              : 'There are no open support tickets to analyze.'}
          </p>
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
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none"
                    onClick={() => handleSort('companyName')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Company</span>
                      <SortIcon
                        active={sortColumn === 'companyName'}
                        direction={sortDirection}
                      />
                    </div>
                  </th>
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none"
                    onClick={() => handleSort('subject')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Subject</span>
                      <SortIcon
                        active={sortColumn === 'subject'}
                        direction={sortDirection}
                      />
                    </div>
                  </th>
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                    onClick={() => handleSort('sourceType')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Source</span>
                      <SortIcon
                        active={sortColumn === 'sourceType'}
                        direction={sortDirection}
                      />
                    </div>
                  </th>
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                    onClick={() => handleSort('ageDays')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Age</span>
                      <SortIcon
                        active={sortColumn === 'ageDays'}
                        direction={sortDirection}
                      />
                    </div>
                  </th>
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                    onClick={() => handleSort('priority')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Priority</span>
                      <SortIcon
                        active={sortColumn === 'priority'}
                        direction={sortDirection}
                      />
                    </div>
                  </th>
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                    onClick={() => handleSort('recommendation')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Status</span>
                      <SortIcon
                        active={sortColumn === 'recommendation'}
                        direction={sortDirection}
                      />
                    </div>
                  </th>
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                    onClick={() => handleSort('confidence')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Confidence</span>
                      <SortIcon
                        active={sortColumn === 'confidence'}
                        direction={sortDirection}
                      />
                    </div>
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider whitespace-nowrap">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {processedTickets.map((ticket) => {
                  const isExpanded = expandedRow === ticket.ticketId;
                  const isAnalyzing = analyzingTickets.has(ticket.ticketId) || isBatchAnalyzing;

                  return (
                    <React.Fragment key={ticket.ticketId}>
                      <tr
                        className="hover:bg-slate-50 transition-colors cursor-pointer"
                        onClick={() => toggleRow(ticket.ticketId)}
                      >
                        <td className="px-2 py-3">
                          <svg
                            className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M9 5l7 7-7 7"
                            />
                          </svg>
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
                              {ticket.companyName || 'Unnamed Company'}
                            </a>
                          ) : (
                            <span className="text-sm text-gray-500 italic">
                              No Company
                            </span>
                          )}
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
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {ticket.sourceType || '-'}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`text-sm ${ticket.ageDays >= 14 ? 'font-medium text-red-600' : ticket.ageDays >= 7 ? 'text-orange-600' : 'text-gray-600'}`}
                          >
                            {ticket.ageDays}d
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {ticket.priority || '-'}
                        </td>
                        <td className="px-4 py-3">
                          <RecommendationBadge
                            recommendation={
                              ticket.analysis?.recommendation || null
                            }
                          />
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {ticket.analysis
                            ? `${Math.round(ticket.analysis.confidence * 100)}%`
                            : '-'}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              analyzeTicket(ticket.ticketId);
                            }}
                            disabled={isAnalyzing}
                            className={`text-sm font-medium px-3 py-1 rounded transition-colors ${
                              isAnalyzing
                                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'
                            }`}
                          >
                            {analyzingTickets.has(ticket.ticketId) ? (
                              <span className="flex items-center gap-1.5">
                                <svg
                                  className="animate-spin h-3.5 w-3.5"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                >
                                  <circle
                                    className="opacity-25"
                                    cx="12"
                                    cy="12"
                                    r="10"
                                    stroke="currentColor"
                                    strokeWidth="4"
                                  />
                                  <path
                                    className="opacity-75"
                                    fill="currentColor"
                                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                                  />
                                </svg>
                                Analyzing...
                              </span>
                            ) : ticket.analysis ? (
                              'Re-analyze'
                            ) : (
                              'Analyze'
                            )}
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
                                  <div className="flex items-center gap-4">
                                    <RecommendationBadge
                                      recommendation={
                                        ticket.analysis.recommendation
                                      }
                                    />
                                    <span className="text-sm text-gray-500">
                                      Confidence:{' '}
                                      {Math.round(
                                        ticket.analysis.confidence * 100
                                      )}
                                      %
                                    </span>
                                    <SentimentBadge
                                      sentiment={
                                        ticket.analysis.customer_sentiment
                                      }
                                    />
                                    <span className="text-xs text-gray-400 ml-auto">
                                      Analyzed{' '}
                                      {new Date(
                                        ticket.analysis.analyzed_at
                                      ).toLocaleString()}
                                    </span>
                                  </div>

                                  {ticket.analysis.reasoning && (
                                    <div>
                                      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                                        Reasoning
                                      </h4>
                                      <p className="text-sm text-gray-700">
                                        {ticket.analysis.reasoning}
                                      </p>
                                    </div>
                                  )}

                                  {ticket.analysis.talking_points &&
                                    ticket.analysis.talking_points !== 'N/A' && (
                                      <div>
                                        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                                          Talking Points
                                        </h4>
                                        <p className="text-sm text-gray-700">
                                          {ticket.analysis.talking_points}
                                        </p>
                                      </div>
                                    )}

                                  <div className="flex items-center gap-4 text-xs text-gray-500 pt-1 border-t border-gray-200">
                                    {ticket.analysis.contact_name && (
                                      <span>
                                        Contact: {ticket.analysis.contact_name}
                                        {ticket.analysis.contact_email
                                          ? ` (${ticket.analysis.contact_email})`
                                          : ''}
                                      </span>
                                    )}
                                    {ticket.analysis.company_name && (
                                      <span>
                                        Company: {ticket.analysis.company_name}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              ) : (
                                <div className="text-center py-4">
                                  <p className="text-sm text-gray-500 mb-2">
                                    This ticket hasn&apos;t been analyzed yet.
                                  </p>
                                  <button
                                    onClick={() =>
                                      analyzeTicket(ticket.ticketId)
                                    }
                                    disabled={isAnalyzing}
                                    className="text-sm font-medium px-4 py-2 rounded bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-50"
                                  >
                                    {analyzingTickets.has(ticket.ticketId)
                                      ? 'Analyzing...'
                                      : 'Analyze This Ticket'}
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
