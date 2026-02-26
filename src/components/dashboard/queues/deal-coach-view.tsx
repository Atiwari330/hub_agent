'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getHubSpotDealUrl } from '@/lib/hubspot/urls';
import type { DealCoachQueueResponse, DealCoachAnalysisResponse } from '@/app/api/queues/deal-coach/route';

// --- Types ---

type StatusFilter = 'all' | 'needs_action' | 'on_track' | 'at_risk' | 'stalled' | 'no_action_needed' | 'unanalyzed';
type SortColumn = 'status' | 'urgency' | 'dealName' | 'amount' | 'stage' | 'daysInStage' | 'closeDate' | 'analyzedAt';
type SortDirection = 'asc' | 'desc';

// --- Helper Components ---

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    needs_action: 'bg-orange-100 text-orange-700',
    on_track: 'bg-emerald-100 text-emerald-700',
    at_risk: 'bg-red-100 text-red-700',
    stalled: 'bg-gray-100 text-gray-600',
    no_action_needed: 'bg-blue-100 text-blue-700',
  };
  const labels: Record<string, string> = {
    needs_action: 'Needs Action',
    on_track: 'On Track',
    at_risk: 'At Risk',
    stalled: 'Stalled',
    no_action_needed: 'No Action Needed',
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
    engaged: 'bg-blue-100 text-blue-700',
    neutral: 'bg-gray-100 text-gray-600',
    unresponsive: 'bg-orange-100 text-orange-700',
    negative: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[sentiment] || 'bg-gray-100 text-gray-600'}`}>
      {sentiment.charAt(0).toUpperCase() + sentiment.slice(1)}
    </span>
  );
}

function MomentumBadge({ momentum }: { momentum: string | null }) {
  if (!momentum) return null;
  const styles: Record<string, string> = {
    accelerating: 'bg-emerald-100 text-emerald-700',
    steady: 'bg-blue-100 text-blue-700',
    slowing: 'bg-orange-100 text-orange-700',
    stalled: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[momentum] || 'bg-gray-100 text-gray-600'}`}>
      {momentum.charAt(0).toUpperCase() + momentum.slice(1)}
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

// --- Constants ---

const STATUS_ORDER: Record<string, number> = { needs_action: 5, at_risk: 4, stalled: 3, on_track: 2, no_action_needed: 1 };
const URGENCY_ORDER: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

// --- Main Component ---

export function DealCoachView() {
  const [data, setData] = useState<DealCoachQueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [analyzingDeals, setAnalyzingDeals] = useState<Set<string>>(new Set());

  // Batch analyze state
  const [isBatchAnalyzing, setIsBatchAnalyzing] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{
    current: number;
    total: number;
    currentDeal: string;
    successful: number;
    failed: number;
  } | null>(null);
  const batchAbortRef = useRef<AbortController | null>(null);

  // Confirmation dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    dealIds: string[];
    count: number;
  } | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [aeFilter, setAeFilter] = useState<string>('all');
  const [stageFilter, setStageFilter] = useState<string>('all');

  // Sorting
  const [sortColumn, setSortColumn] = useState<SortColumn>('amount');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // --- Data Fetching ---

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/queues/deal-coach');
      if (!response.ok) throw new Error('Failed to fetch deal coach data');
      const json: DealCoachQueueResponse = await response.json();
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

  // --- Derived data ---

  const aeOptions = useMemo(() => {
    if (!data) return [];
    const names = new Set<string>();
    for (const d of data.deals) {
      if (d.ownerName) names.add(d.ownerName);
    }
    return Array.from(names).sort();
  }, [data]);

  const stageOptions = useMemo(() => {
    if (!data) return [];
    const stages = new Map<string, string>();
    for (const d of data.deals) {
      stages.set(d.stageId, d.stageName);
    }
    return Array.from(stages.entries()).map(([id, label]) => ({ id, label }));
  }, [data]);

  // --- Sorting & Filtering ---

  const processedDeals = useMemo(() => {
    if (!data) return [];

    let result = [...data.deals];

    if (statusFilter !== 'all') {
      if (statusFilter === 'unanalyzed') {
        result = result.filter((d) => !d.analysis);
      } else {
        result = result.filter((d) => d.analysis?.status === statusFilter);
      }
    }
    if (aeFilter !== 'all') {
      result = result.filter((d) => d.ownerName === aeFilter);
    }
    if (stageFilter !== 'all') {
      result = result.filter((d) => d.stageId === stageFilter);
    }

    result.sort((a, b) => {
      let comparison = 0;
      switch (sortColumn) {
        case 'status':
          comparison = (STATUS_ORDER[a.analysis?.status || ''] || 0) - (STATUS_ORDER[b.analysis?.status || ''] || 0);
          break;
        case 'urgency':
          comparison = (URGENCY_ORDER[a.analysis?.urgency || ''] || 0) - (URGENCY_ORDER[b.analysis?.urgency || ''] || 0);
          break;
        case 'dealName':
          comparison = (a.dealName || '').localeCompare(b.dealName || '');
          break;
        case 'amount':
          comparison = (a.amount || 0) - (b.amount || 0);
          break;
        case 'stage':
          comparison = a.stageName.localeCompare(b.stageName);
          break;
        case 'daysInStage':
          comparison = (a.daysInStage || 0) - (b.daysInStage || 0);
          break;
        case 'closeDate':
          comparison = (a.closeDate || '').localeCompare(b.closeDate || '');
          break;
        case 'analyzedAt': {
          const aTime = a.analysis?.analyzed_at ? new Date(a.analysis.analyzed_at).getTime() : 0;
          const bTime = b.analysis?.analyzed_at ? new Date(b.analysis.analyzed_at).getTime() : 0;
          comparison = aTime - bTime;
          break;
        }
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [data, statusFilter, aeFilter, stageFilter, sortColumn, sortDirection]);

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  const hasActiveFilters = statusFilter !== 'all' || aeFilter !== 'all' || stageFilter !== 'all';

  const clearFilters = () => {
    setStatusFilter('all');
    setAeFilter('all');
    setStageFilter('all');
  };

  const toggleRow = (key: string) => {
    setExpandedRow(expandedRow === key ? null : key);
  };

  // --- Actions ---

  const recomputeCounts = useCallback(
    (deals: DealCoachQueueResponse['deals']): DealCoachQueueResponse['counts'] => {
      const analyzed = deals.filter((d) => d.analysis).length;
      return {
        total: deals.length,
        analyzed,
        unanalyzed: deals.length - analyzed,
        needsAction: deals.filter((d) => d.analysis?.status === 'needs_action').length,
        onTrack: deals.filter((d) => d.analysis?.status === 'on_track').length,
        atRisk: deals.filter((d) => d.analysis?.status === 'at_risk').length,
        stalled: deals.filter((d) => d.analysis?.status === 'stalled').length,
        noActionNeeded: deals.filter((d) => d.analysis?.status === 'no_action_needed').length,
      };
    },
    []
  );

  const analyzeDeal = async (deal: DealCoachQueueResponse['deals'][0]) => {
    setAnalyzingDeals((prev) => new Set(prev).add(deal.dealId));

    try {
      const response = await fetch('/api/queues/deal-coach/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dealId: deal.dealId }),
      });

      if (!response.ok) throw new Error('Analysis failed');

      const result = await response.json();
      const analysis: DealCoachAnalysisResponse = {
        status: result.analysis.status,
        urgency: result.analysis.urgency,
        buyer_sentiment: result.analysis.buyer_sentiment,
        deal_momentum: result.analysis.deal_momentum,
        recommended_action: result.analysis.recommended_action,
        reasoning: result.analysis.reasoning,
        confidence: result.analysis.confidence,
        key_risk: result.analysis.key_risk,
        email_count: result.analysis.email_count,
        call_count: result.analysis.call_count,
        meeting_count: result.analysis.meeting_count,
        note_count: result.analysis.note_count,
        analyzed_at: result.analysis.analyzed_at,
      };

      setData((prev) => {
        if (!prev) return prev;
        const updatedDeals = prev.deals.map((d) =>
          d.dealId === deal.dealId ? { ...d, analysis } : d
        );
        return { deals: updatedDeals, counts: recomputeCounts(updatedDeals) };
      });
    } catch (err) {
      console.error('Analysis failed:', err);
    } finally {
      setAnalyzingDeals((prev) => {
        const next = new Set(prev);
        next.delete(deal.dealId);
        return next;
      });
    }
  };

  const batchAnalyze = async (dealIds: string[]) => {
    if (!data || dealIds.length === 0) return;

    const allDealIds = dealIds;
    const totalDeals = allDealIds.length;
    const CHUNK_SIZE = 100;

    setIsBatchAnalyzing(true);
    setBatchProgress({ current: 0, total: totalDeals, currentDeal: '', successful: 0, failed: 0 });

    const abortController = new AbortController();
    batchAbortRef.current = abortController;

    let cumulativeSuccessful = 0;
    let cumulativeFailed = 0;

    try {
      // Process in chunks of CHUNK_SIZE to stay within server batch limit
      for (let chunkStart = 0; chunkStart < totalDeals; chunkStart += CHUNK_SIZE) {
        if (abortController.signal.aborted) break;

        const chunkIds = allDealIds.slice(chunkStart, chunkStart + CHUNK_SIZE);
        const chunkOffset = chunkStart;

        const response = await fetch('/api/queues/deal-coach/batch-analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dealIds: chunkIds }),
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
                if (event.status === 'success') cumulativeSuccessful++;
                if (event.status === 'error') cumulativeFailed++;

                setBatchProgress({
                  current: chunkOffset + event.index,
                  total: totalDeals,
                  currentDeal: event.dealName || '',
                  successful: cumulativeSuccessful,
                  failed: cumulativeFailed,
                });

                if (event.status === 'success' && event.analysis) {
                  const analysis: DealCoachAnalysisResponse = {
                    status: event.analysis.status,
                    urgency: event.analysis.urgency,
                    buyer_sentiment: event.analysis.buyer_sentiment,
                    deal_momentum: event.analysis.deal_momentum,
                    recommended_action: event.analysis.recommended_action,
                    reasoning: event.analysis.reasoning,
                    confidence: event.analysis.confidence,
                    key_risk: event.analysis.key_risk,
                    email_count: event.analysis.email_count,
                    call_count: event.analysis.call_count,
                    meeting_count: event.analysis.meeting_count,
                    note_count: event.analysis.note_count,
                    analyzed_at: event.analysis.analyzed_at,
                  };

                  setData((prev) => {
                    if (!prev) return prev;
                    const updatedDeals = prev.deals.map((d) =>
                      d.dealId === event.dealId ? { ...d, analysis } : d
                    );
                    return { deals: updatedDeals, counts: recomputeCounts(updatedDeals) };
                  });
                }
              }
            } catch {
              // Skip malformed events
            }
          }
        }
      }

      // Final progress update
      setBatchProgress({
        current: totalDeals,
        total: totalDeals,
        currentDeal: '',
        successful: cumulativeSuccessful,
        failed: cumulativeFailed,
      });
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

  const handleAnalyzeUnanalyzed = () => {
    if (!data) return;
    const ids = data.deals.filter((d) => !d.analysis).map((d) => d.dealId);
    batchAnalyze(ids);
  };

  const handleReanalyzeFiltered = () => {
    const ids = processedDeals.filter((d) => d.analysis).map((d) => d.dealId);
    if (ids.length === 0) return;
    setConfirmDialog({ dealIds: ids, count: ids.length });
  };

  const confirmReanalyze = () => {
    if (!confirmDialog) return;
    const ids = confirmDialog.dealIds;
    setConfirmDialog(null);
    batchAnalyze(ids);
  };

  // --- Render ---

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Deal Coach</h1>
        <p className="text-sm text-gray-600 mt-1">
          LLM-powered coaching for every open deal — engagement analysis, buyer sentiment, and actionable next-step recommendations.
        </p>
      </div>

      {/* Summary Cards */}
      {!loading && data && data.counts.total > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
          <div className="flex flex-wrap items-center gap-6">
            <div>
              <div className="text-3xl font-bold text-gray-900">{data.counts.total}</div>
              <div className="text-xs text-gray-500 uppercase tracking-wider mt-0.5">Open Deals</div>
            </div>
            <div className="h-12 w-px bg-gray-200" />
            <div className="flex items-center gap-3 text-sm text-gray-500">
              <span>{data.counts.analyzed} analyzed</span>
              <span className="text-gray-300">|</span>
              <span>{data.counts.unanalyzed} unanalyzed</span>
            </div>
            <div className="h-12 w-px bg-gray-200" />
            <div className="flex items-center gap-3">
              {data.counts.needsAction > 0 && (
                <button
                  onClick={() => setStatusFilter(statusFilter === 'needs_action' ? 'all' : 'needs_action')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    statusFilter === 'needs_action' ? 'bg-orange-100 text-orange-800 ring-2 ring-orange-300' : 'bg-orange-50 text-orange-700 hover:bg-orange-100'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-orange-500" />
                  {data.counts.needsAction} Needs Action
                </button>
              )}
              {data.counts.atRisk > 0 && (
                <button
                  onClick={() => setStatusFilter(statusFilter === 'at_risk' ? 'all' : 'at_risk')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    statusFilter === 'at_risk' ? 'bg-red-100 text-red-800 ring-2 ring-red-300' : 'bg-red-50 text-red-700 hover:bg-red-100'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-red-500" />
                  {data.counts.atRisk} At Risk
                </button>
              )}
              {data.counts.stalled > 0 && (
                <button
                  onClick={() => setStatusFilter(statusFilter === 'stalled' ? 'all' : 'stalled')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    statusFilter === 'stalled' ? 'bg-gray-200 text-gray-800 ring-2 ring-gray-400' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-gray-500" />
                  {data.counts.stalled} Stalled
                </button>
              )}
              {data.counts.onTrack > 0 && (
                <button
                  onClick={() => setStatusFilter(statusFilter === 'on_track' ? 'all' : 'on_track')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    statusFilter === 'on_track' ? 'bg-emerald-100 text-emerald-800 ring-2 ring-emerald-300' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  {data.counts.onTrack} On Track
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Action Buttons Row */}
      {!loading && data && data.counts.total > 0 && (
        <div className="flex flex-wrap items-center gap-3 mb-4">
          {data.counts.unanalyzed > 0 && !isBatchAnalyzing && (
            <button
              onClick={handleAnalyzeUnanalyzed}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Analyze All Unanalyzed ({data.counts.unanalyzed})
            </button>
          )}

          {!isBatchAnalyzing && processedDeals.filter((d) => d.analysis).length > 0 && (
            <button
              onClick={handleReanalyzeFiltered}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-white border border-indigo-300 text-indigo-600 hover:bg-indigo-50 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Re-analyze {hasActiveFilters ? 'Filtered' : 'All'} ({processedDeals.filter((d) => d.analysis).length})
            </button>
          )}

          {/* Export CSV button */}
          {data.counts.analyzed > 0 && (
            <button
              onClick={() => {
                const params = new URLSearchParams();
                if (statusFilter !== 'all' && statusFilter !== 'unanalyzed') params.set('status', statusFilter);
                if (aeFilter !== 'all') params.set('ae', aeFilter);
                if (stageFilter !== 'all') params.set('stage', stageFilter);
                const url = `/api/queues/deal-coach/export${params.toString() ? `?${params}` : ''}`;
                window.open(url, '_blank');
              }}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Export CSV
              {hasActiveFilters && (
                <span className="text-xs text-gray-500">
                  ({statusFilter !== 'all' && statusFilter !== 'unanalyzed' ? statusFilter.replace('_', ' ') : stageFilter !== 'all' ? stageOptions.find(s => s.id === stageFilter)?.label || 'filtered' : aeFilter !== 'all' ? aeFilter : 'filtered'})
                </span>
              )}
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
                {batchProgress.currentDeal && (
                  <span className="text-indigo-500 ml-2 truncate max-w-xs inline-block align-bottom">
                    ({batchProgress.currentDeal})
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
            <label className="text-sm text-gray-600">Status:</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="all">All</option>
              <option value="needs_action">Needs Action</option>
              <option value="on_track">On Track</option>
              <option value="at_risk">At Risk</option>
              <option value="stalled">Stalled</option>
              <option value="no_action_needed">No Action Needed</option>
              <option value="unanalyzed">Unanalyzed</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600">AE:</label>
            <select
              value={aeFilter}
              onChange={(e) => setAeFilter(e.target.value)}
              className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="all">All</option>
              {aeOptions.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600">Stage:</label>
            <select
              value={stageFilter}
              onChange={(e) => setStageFilter(e.target.value)}
              className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="all">All</option>
              {stageOptions.map((stage) => (
                <option key={stage.id} value={stage.id}>{stage.label}</option>
              ))}
            </select>
          </div>

          {hasActiveFilters && (
            <button onClick={clearFilters} className="text-sm text-gray-500 hover:text-gray-700">
              Clear filters
            </button>
          )}

          <span className="text-sm text-gray-500 ml-auto">
            {processedDeals.length} deal{processedDeals.length !== 1 ? 's' : ''} showing
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
          <h3 className="mt-4 text-lg font-medium text-gray-900">No Open Deals</h3>
          <p className="mt-1 text-sm text-gray-600">
            No open deals found in the sales pipeline.
          </p>
        </div>
      )}

      {/* Empty filtered state */}
      {!loading && !error && data && data.counts.total > 0 && processedDeals.length === 0 && (
        <div className="text-center py-12 bg-slate-50 rounded-lg border border-slate-200">
          <h3 className="text-lg font-medium text-gray-900">No deals match the current filters</h3>
          <p className="mt-1 text-sm text-gray-600">Try adjusting the filters.</p>
        </div>
      )}

      {/* Deals Table */}
      {!loading && !error && processedDeals.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 border-b border-gray-200">
                  <th className="w-8 px-2 py-3"></th>
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                    onClick={() => handleSort('status')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Status</span>
                      <SortIcon active={sortColumn === 'status'} direction={sortDirection} />
                    </div>
                  </th>
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                    onClick={() => handleSort('urgency')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Urgency</span>
                      <SortIcon active={sortColumn === 'urgency'} direction={sortDirection} />
                    </div>
                  </th>
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                    onClick={() => handleSort('dealName')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Deal</span>
                      <SortIcon active={sortColumn === 'dealName'} direction={sortDirection} />
                    </div>
                  </th>
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                    onClick={() => handleSort('amount')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Amount</span>
                      <SortIcon active={sortColumn === 'amount'} direction={sortDirection} />
                    </div>
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider whitespace-nowrap">
                    AE
                  </th>
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                    onClick={() => handleSort('stage')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Stage</span>
                      <SortIcon active={sortColumn === 'stage'} direction={sortDirection} />
                    </div>
                  </th>
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                    onClick={() => handleSort('daysInStage')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Days in Stage</span>
                      <SortIcon active={sortColumn === 'daysInStage'} direction={sortDirection} />
                    </div>
                  </th>
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                    onClick={() => handleSort('closeDate')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Close Date</span>
                      <SortIcon active={sortColumn === 'closeDate'} direction={sortDirection} />
                    </div>
                  </th>
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                    onClick={() => handleSort('analyzedAt')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Analyzed</span>
                      <SortIcon active={sortColumn === 'analyzedAt'} direction={sortDirection} />
                    </div>
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider whitespace-nowrap">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {processedDeals.map((deal) => {
                  const isExpanded = expandedRow === deal.dealId;
                  const isAnalyzing = analyzingDeals.has(deal.dealId);

                  return (
                    <React.Fragment key={deal.dealId}>
                      <tr
                        className="hover:bg-slate-50 transition-colors cursor-pointer"
                        onClick={() => toggleRow(deal.dealId)}
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
                          {deal.analysis ? (
                            <StatusBadge status={deal.analysis.status} />
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-500">
                              Pending
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {deal.analysis ? (
                            <UrgencyBadge urgency={deal.analysis.urgency} />
                          ) : (
                            <span className="text-xs text-gray-400">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <a
                            href={getHubSpotDealUrl(deal.dealId)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-gray-900 hover:text-indigo-600 transition-colors line-clamp-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {deal.dealName || 'Unnamed Deal'}
                          </a>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-900 font-medium whitespace-nowrap">
                          {deal.amount ? `$${deal.amount.toLocaleString()}` : '-'}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                          {deal.ownerName || '-'}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                          {deal.stageName}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                          {deal.daysInStage !== null ? `${deal.daysInStage}d` : '-'}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                          {deal.closeDate ? new Date(deal.closeDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '-'}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                          {(() => {
                            if (!deal.analysis?.analyzed_at) return <span className="text-gray-300">&mdash;</span>;
                            const analyzed = new Date(deal.analysis.analyzed_at);
                            const now = new Date();
                            const diffMs = now.getTime() - analyzed.getTime();
                            const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
                            const isToday = analyzed.toDateString() === now.toDateString();
                            const yesterday = new Date(now);
                            yesterday.setDate(yesterday.getDate() - 1);
                            const isYesterday = analyzed.toDateString() === yesterday.toDateString();

                            if (isToday) return `Today ${analyzed.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
                            if (isYesterday) return 'Yesterday';
                            if (diffDays <= 7) return `${diffDays}d ago`;
                            return analyzed.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                          })()}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              analyzeDeal(deal);
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
                            ) : deal.analysis ? 'Re-analyze' : 'Analyze'}
                          </button>
                        </td>
                      </tr>

                      {/* Expanded Row - Analysis Details */}
                      {isExpanded && (
                        <tr>
                          <td colSpan={11} className="px-0 py-0">
                            <div className="bg-slate-50 border-y border-gray-200 px-8 py-4">
                              {deal.analysis ? (
                                <div className="space-y-3">
                                  <div className="flex items-center gap-4 flex-wrap">
                                    <StatusBadge status={deal.analysis.status} />
                                    <UrgencyBadge urgency={deal.analysis.urgency} />
                                    <SentimentBadge sentiment={deal.analysis.buyer_sentiment} />
                                    <MomentumBadge momentum={deal.analysis.deal_momentum} />
                                    <span className="text-sm text-gray-500">
                                      Confidence: {Math.round(deal.analysis.confidence * 100)}%
                                    </span>
                                    <span className="text-sm text-gray-400">
                                      {deal.analysis.email_count}e / {deal.analysis.call_count}c / {deal.analysis.meeting_count}m / {deal.analysis.note_count}n
                                    </span>
                                    <span className="text-xs text-gray-400 ml-auto">
                                      Analyzed {new Date(deal.analysis.analyzed_at).toLocaleString()}
                                    </span>
                                  </div>

                                  <div>
                                    <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Recommended Action</h4>
                                    <p className="text-sm text-gray-700">{deal.analysis.recommended_action}</p>
                                  </div>

                                  <div>
                                    <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Reasoning</h4>
                                    <p className="text-sm text-gray-700">{deal.analysis.reasoning}</p>
                                  </div>

                                  {deal.analysis.key_risk && (
                                    <div>
                                      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Key Risk</h4>
                                      <p className="text-sm text-red-700">{deal.analysis.key_risk}</p>
                                    </div>
                                  )}

                                  <div className="border-t border-gray-200 pt-3">
                                    <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Deal Context</h4>
                                    <div className="flex items-center gap-4 text-sm text-gray-600 flex-wrap">
                                      {deal.nextStep && <span>Next Step: {deal.nextStep}</span>}
                                      {deal.products && <span>Products: {deal.products}</span>}
                                      {deal.leadSource && <span>Lead Source: {deal.leadSource}</span>}
                                      {deal.dealSubstage && <span>Substage: {deal.dealSubstage}</span>}
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                <div className="text-center py-4">
                                  <p className="text-sm text-gray-500 mb-2">
                                    This deal hasn&apos;t been analyzed yet. The LLM will review engagement history, buyer sentiment, and deal momentum.
                                  </p>
                                  <button
                                    onClick={() => analyzeDeal(deal)}
                                    disabled={isAnalyzing || isBatchAnalyzing}
                                    className="text-sm font-medium px-4 py-2 rounded bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-50"
                                  >
                                    {isAnalyzing ? 'Analyzing...' : 'Analyze This Deal'}
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
      {/* Confirmation Dialog */}
      {confirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Re-analyze {confirmDialog.count} deals?</h3>
            <p className="text-sm text-gray-600 mb-6">
              This will replace existing analyses for {confirmDialog.count} deal{confirmDialog.count !== 1 ? 's' : ''} matching the current filters.
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setConfirmDialog(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmReanalyze}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors"
              >
                Re-analyze {confirmDialog.count} Deals
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
