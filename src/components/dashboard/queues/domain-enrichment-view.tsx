'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getHubSpotDealUrl } from '@/lib/hubspot/urls';
import type { DomainEnrichmentQueueResponse, DomainEnrichmentDeal } from '@/app/api/queues/domain-enrichment/route';

// --- Types ---

type StatusFilter = 'all' | 'enriched' | 'unenriched' | 'no_contacts' | 'free_email_only' | 'failed';
type SortColumn = 'status' | 'dealName' | 'amount' | 'stage' | 'daysInStage' | 'closeDate' | 'domain' | 'analyzedAt';
type SortDirection = 'asc' | 'desc';

// --- Helper Components ---

function EnrichmentStatusBadge({ status }: { status: string | null }) {
  if (!status) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500">
        Pending
      </span>
    );
  }
  const styles: Record<string, string> = {
    enriched: 'bg-emerald-100 text-emerald-700',
    no_contacts: 'bg-yellow-100 text-yellow-700',
    free_email_only: 'bg-orange-100 text-orange-700',
    failed: 'bg-red-100 text-red-700',
    pending: 'bg-gray-100 text-gray-500',
  };
  const labels: Record<string, string> = {
    enriched: 'Enriched',
    no_contacts: 'No Contacts',
    free_email_only: 'Free Email',
    failed: 'Failed',
    pending: 'Pending',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[status] || 'bg-gray-100 text-gray-500'}`}>
      {labels[status] || status}
    </span>
  );
}

function ConfidenceBadge({ score }: { score: number | null }) {
  if (score === null) return null;
  const pct = Math.round(score * 100);
  const color = pct >= 80 ? 'bg-emerald-100 text-emerald-700' : pct >= 50 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${color}`}>
      {pct}% confidence
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

function formatRelativeTime(dateString: string | null): string {
  if (!dateString) return '-';
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function formatCurrency(amount: number | null): string {
  if (amount === null) return '-';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);
}

// --- Constants ---

const STATUS_ORDER: Record<string, number> = { enriched: 3, failed: 2, free_email_only: 1, no_contacts: 1, pending: 0 };

// --- Main Component ---

export function DomainEnrichmentView() {
  const [data, setData] = useState<DomainEnrichmentQueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [enrichingDeals, setEnrichingDeals] = useState<Set<string>>(new Set());

  // Batch state
  const [isBatchEnriching, setIsBatchEnriching] = useState(false);
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
      const response = await fetch('/api/queues/domain-enrichment');
      if (!response.ok) throw new Error('Failed to fetch domain enrichment data');
      const json: DomainEnrichmentQueueResponse = await response.json();
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
      if (statusFilter === 'unenriched') {
        result = result.filter((d) => !d.enrichment || d.enrichment.status === 'pending');
      } else {
        result = result.filter((d) => d.enrichment?.status === statusFilter);
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
          comparison = (STATUS_ORDER[a.enrichment?.status || 'pending'] || 0) - (STATUS_ORDER[b.enrichment?.status || 'pending'] || 0);
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
        case 'domain':
          comparison = (a.enrichment?.domain || '').localeCompare(b.enrichment?.domain || '');
          break;
        case 'analyzedAt': {
          const aTime = a.enrichment?.analyzedAt ? new Date(a.enrichment.analyzedAt).getTime() : 0;
          const bTime = b.enrichment?.analyzedAt ? new Date(b.enrichment.analyzedAt).getTime() : 0;
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

  const enrichDeal = async (deal: DomainEnrichmentDeal, force?: boolean) => {
    setEnrichingDeals((prev) => new Set(prev).add(deal.dealId));

    try {
      const response = await fetch('/api/queues/domain-enrichment/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dealId: deal.dealId, force }),
      });

      if (!response.ok) throw new Error('Enrichment failed');

      const result = await response.json();

      // Refetch full data to get updated domain enrichment details
      await fetchData();

      // If expanded, keep it expanded
      if (expandedRow === deal.dealId) {
        // Data will refresh with new enrichment
      }

      void result;
    } catch (err) {
      console.error('Enrichment failed:', err);
    } finally {
      setEnrichingDeals((prev) => {
        const next = new Set(prev);
        next.delete(deal.dealId);
        return next;
      });
    }
  };

  const batchEnrich = async (dealIds: string[], force?: boolean) => {
    if (!data || dealIds.length === 0) return;

    const totalDeals = dealIds.length;
    const CHUNK_SIZE = 100;

    setIsBatchEnriching(true);
    setBatchProgress({ current: 0, total: totalDeals, currentDeal: '', successful: 0, failed: 0 });

    const abortController = new AbortController();
    batchAbortRef.current = abortController;

    let cumulativeSuccessful = 0;
    let cumulativeFailed = 0;

    try {
      for (let chunkStart = 0; chunkStart < totalDeals; chunkStart += CHUNK_SIZE) {
        if (abortController.signal.aborted) break;

        const chunkIds = dealIds.slice(chunkStart, chunkStart + CHUNK_SIZE);
        const chunkOffset = chunkStart;

        const response = await fetch('/api/queues/domain-enrichment/batch-analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dealIds: chunkIds, force }),
          signal: abortController.signal,
        });

        if (!response.ok) throw new Error('Batch enrichment failed to start');

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
              }
            } catch {
              // Skip malformed events
            }
          }
        }
      }

      setBatchProgress({
        current: totalDeals,
        total: totalDeals,
        currentDeal: '',
        successful: cumulativeSuccessful,
        failed: cumulativeFailed,
      });

      // Refetch all data after batch completes
      await fetchData();
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // User cancelled — still refetch to show partial progress
        await fetchData();
      } else {
        console.error('Batch enrichment error:', err);
      }
    } finally {
      setIsBatchEnriching(false);
      batchAbortRef.current = null;
    }
  };

  const cancelBatch = () => {
    batchAbortRef.current?.abort();
  };

  const handleEnrichUnenriched = () => {
    if (!data) return;
    const ids = data.deals
      .filter((d) => !d.enrichment || d.enrichment.status === 'pending')
      .map((d) => d.dealId);
    batchEnrich(ids);
  };

  const handleReenrichFiltered = () => {
    const ids = processedDeals
      .filter((d) => d.enrichment && d.enrichment.status !== 'pending')
      .map((d) => d.dealId);
    if (ids.length === 0) return;
    setConfirmDialog({ dealIds: ids, count: ids.length });
  };

  const confirmReenrich = () => {
    if (!confirmDialog) return;
    const ids = confirmDialog.dealIds;
    setConfirmDialog(null);
    batchEnrich(ids, true);
  };

  // --- Render ---

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Domain Enrichment</h1>
        <p className="text-sm text-gray-600 mt-1">
          Scrape and analyze company websites for deals — extract services, team members, specialties, and business intelligence.
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
              <span>{data.counts.enriched} enriched</span>
              <span className="text-gray-300">|</span>
              <span>{data.counts.unenriched} unenriched</span>
            </div>
            <div className="h-12 w-px bg-gray-200" />
            <div className="flex items-center gap-3">
              {data.counts.enriched > 0 && (
                <button
                  onClick={() => setStatusFilter(statusFilter === 'enriched' ? 'all' : 'enriched')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    statusFilter === 'enriched' ? 'bg-emerald-100 text-emerald-800 ring-2 ring-emerald-300' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  {data.counts.enriched} Enriched
                </button>
              )}
              {data.counts.failed > 0 && (
                <button
                  onClick={() => setStatusFilter(statusFilter === 'failed' ? 'all' : 'failed')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    statusFilter === 'failed' ? 'bg-red-100 text-red-800 ring-2 ring-red-300' : 'bg-red-50 text-red-700 hover:bg-red-100'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-red-500" />
                  {data.counts.failed} Failed
                </button>
              )}
              {data.counts.noContacts > 0 && (
                <button
                  onClick={() => setStatusFilter(statusFilter === 'no_contacts' ? 'all' : 'no_contacts')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    statusFilter === 'no_contacts' ? 'bg-yellow-100 text-yellow-800 ring-2 ring-yellow-300' : 'bg-yellow-50 text-yellow-700 hover:bg-yellow-100'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-yellow-500" />
                  {data.counts.noContacts} No Contacts
                </button>
              )}
              {data.counts.freeEmailOnly > 0 && (
                <button
                  onClick={() => setStatusFilter(statusFilter === 'free_email_only' ? 'all' : 'free_email_only')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    statusFilter === 'free_email_only' ? 'bg-orange-100 text-orange-800 ring-2 ring-orange-300' : 'bg-orange-50 text-orange-700 hover:bg-orange-100'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-orange-500" />
                  {data.counts.freeEmailOnly} Free Email
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Action Buttons Row */}
      {!loading && data && data.counts.total > 0 && (
        <div className="flex flex-wrap items-center gap-3 mb-4">
          {data.counts.unenriched > 0 && !isBatchEnriching && (
            <button
              onClick={handleEnrichUnenriched}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
              </svg>
              Enrich All Unenriched ({data.counts.unenriched})
            </button>
          )}

          {!isBatchEnriching && processedDeals.filter((d) => d.enrichment && d.enrichment.status !== 'pending').length > 0 && (
            <button
              onClick={handleReenrichFiltered}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-white border border-indigo-300 text-indigo-600 hover:bg-indigo-50 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Re-enrich {hasActiveFilters ? 'Filtered' : 'All'} ({processedDeals.filter((d) => d.enrichment && d.enrichment.status !== 'pending').length})
            </button>
          )}

          {/* Batch progress */}
          {isBatchEnriching && batchProgress && (
            <div className="flex items-center gap-4 px-4 py-2 bg-indigo-50 rounded-lg border border-indigo-200">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 animate-spin text-indigo-600" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span className="text-sm text-indigo-700">
                  Enriching {batchProgress.current}/{batchProgress.total}
                  {batchProgress.currentDeal && ` — ${batchProgress.currentDeal}`}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-indigo-600">
                <span>{batchProgress.successful} ok</span>
                {batchProgress.failed > 0 && <span className="text-red-600">{batchProgress.failed} failed</span>}
              </div>
              <button
                onClick={cancelBatch}
                className="text-xs text-red-600 hover:text-red-800 font-medium"
              >
                Cancel
              </button>
            </div>
          )}

          <div className="flex-1" />

          {/* Filters */}
          <div className="flex items-center gap-2">
            <select
              value={aeFilter}
              onChange={(e) => setAeFilter(e.target.value)}
              className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white"
            >
              <option value="all">All AEs</option>
              {aeOptions.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
            <select
              value={stageFilter}
              onChange={(e) => setStageFilter(e.target.value)}
              className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white"
            >
              <option value="all">All Stages</option>
              {stageOptions.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>
      )}

      {/* Confirmation Dialog */}
      {confirmDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-md mx-4 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Re-enrich {confirmDialog.count} deals?</h3>
            <p className="text-sm text-gray-600 mb-4">
              This will re-scrape and re-analyze company websites for {confirmDialog.count} deal{confirmDialog.count > 1 ? 's' : ''}. This may take a while for large batches.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmDialog(null)}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmReenrich}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
              >
                Re-enrich
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="text-center py-12 text-gray-500">
          <svg className="w-8 h-8 animate-spin mx-auto mb-3 text-indigo-600" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Loading domain enrichment queue...
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="text-center py-12">
          <p className="text-red-600 mb-2">{error}</p>
          <button onClick={fetchData} className="text-sm text-indigo-600 hover:underline">
            Retry
          </button>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && data && data.deals.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          No open deals found in the sales pipeline.
        </div>
      )}

      {/* Table */}
      {!loading && !error && data && processedDeals.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="w-8 px-3 py-3" />
                  <th className="px-3 py-3 text-left">
                    <button onClick={() => handleSort('status')} className="flex items-center gap-1 font-medium text-gray-700">
                      Status <SortIcon active={sortColumn === 'status'} direction={sortDirection} />
                    </button>
                  </th>
                  <th className="px-3 py-3 text-left">
                    <button onClick={() => handleSort('dealName')} className="flex items-center gap-1 font-medium text-gray-700">
                      Deal <SortIcon active={sortColumn === 'dealName'} direction={sortDirection} />
                    </button>
                  </th>
                  <th className="px-3 py-3 text-right">
                    <button onClick={() => handleSort('amount')} className="flex items-center gap-1 font-medium text-gray-700 ml-auto">
                      Amount <SortIcon active={sortColumn === 'amount'} direction={sortDirection} />
                    </button>
                  </th>
                  <th className="px-3 py-3 text-left font-medium text-gray-700">AE</th>
                  <th className="px-3 py-3 text-left">
                    <button onClick={() => handleSort('stage')} className="flex items-center gap-1 font-medium text-gray-700">
                      Stage <SortIcon active={sortColumn === 'stage'} direction={sortDirection} />
                    </button>
                  </th>
                  <th className="px-3 py-3 text-right">
                    <button onClick={() => handleSort('daysInStage')} className="flex items-center gap-1 font-medium text-gray-700 ml-auto">
                      Days <SortIcon active={sortColumn === 'daysInStage'} direction={sortDirection} />
                    </button>
                  </th>
                  <th className="px-3 py-3 text-left">
                    <button onClick={() => handleSort('closeDate')} className="flex items-center gap-1 font-medium text-gray-700">
                      Close Date <SortIcon active={sortColumn === 'closeDate'} direction={sortDirection} />
                    </button>
                  </th>
                  <th className="px-3 py-3 text-left">
                    <button onClick={() => handleSort('domain')} className="flex items-center gap-1 font-medium text-gray-700">
                      Domain <SortIcon active={sortColumn === 'domain'} direction={sortDirection} />
                    </button>
                  </th>
                  <th className="px-3 py-3 text-left">
                    <button onClick={() => handleSort('analyzedAt')} className="flex items-center gap-1 font-medium text-gray-700">
                      Enriched <SortIcon active={sortColumn === 'analyzedAt'} direction={sortDirection} />
                    </button>
                  </th>
                  <th className="px-3 py-3 text-center font-medium text-gray-700">Action</th>
                </tr>
              </thead>
              <tbody>
                {processedDeals.map((deal) => {
                  const isExpanded = expandedRow === deal.dealId;
                  const isEnriching = enrichingDeals.has(deal.dealId);

                  return (
                    <React.Fragment key={deal.dealId}>
                      <tr
                        className={`border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors ${isExpanded ? 'bg-indigo-50/30' : ''}`}
                        onClick={() => toggleRow(deal.dealId)}
                      >
                        <td className="px-3 py-3 text-center">
                          <svg
                            className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                            fill="none" stroke="currentColor" viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </td>
                        <td className="px-3 py-3">
                          <EnrichmentStatusBadge status={deal.enrichment?.status || null} />
                        </td>
                        <td className="px-3 py-3">
                          <a
                            href={getHubSpotDealUrl(deal.dealId)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-indigo-600 hover:underline font-medium"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {deal.dealName || 'Unnamed Deal'}
                          </a>
                        </td>
                        <td className="px-3 py-3 text-right font-medium">
                          {formatCurrency(deal.amount)}
                        </td>
                        <td className="px-3 py-3 text-gray-600">
                          {deal.ownerName || '-'}
                        </td>
                        <td className="px-3 py-3">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700">
                            {deal.stageName}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right text-gray-600">
                          {deal.daysInStage !== null ? `${deal.daysInStage}d` : '-'}
                        </td>
                        <td className="px-3 py-3 text-gray-600">
                          {deal.closeDate ? new Date(deal.closeDate + 'T00:00:00').toLocaleDateString() : '-'}
                        </td>
                        <td className="px-3 py-3 text-gray-600">
                          {deal.enrichment?.domain ? (
                            <span className="font-mono text-xs">{deal.enrichment.domain}</span>
                          ) : '-'}
                        </td>
                        <td className="px-3 py-3 text-gray-500 text-xs">
                          {formatRelativeTime(deal.enrichment?.analyzedAt || null)}
                        </td>
                        <td className="px-3 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                          {isEnriching ? (
                            <span className="inline-flex items-center gap-1 text-xs text-indigo-600">
                              <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                              </svg>
                              Enriching...
                            </span>
                          ) : deal.enrichment?.status === 'enriched' ? (
                            <button
                              onClick={() => enrichDeal(deal, true)}
                              className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                            >
                              Re-enrich
                            </button>
                          ) : (
                            <button
                              onClick={() => enrichDeal(deal)}
                              className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
                            >
                              Enrich
                            </button>
                          )}
                        </td>
                      </tr>

                      {/* Expandable Row */}
                      {isExpanded && (
                        <tr>
                          <td colSpan={11} className="px-6 py-4 bg-gray-50/50 border-b border-gray-200">
                            <ExpandedContent deal={deal} onEnrich={() => enrichDeal(deal)} isEnriching={isEnriching} />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 text-sm text-gray-500">
            Showing {processedDeals.length} of {data.counts.total} deals
          </div>
        </div>
      )}
    </div>
  );
}

// --- Expanded Row Content ---

interface DomainDetail {
  company_name: string | null;
  company_overview: string | null;
  services: { name: string; description: string }[] | null;
  specialties: string[] | null;
  team_members: { name: string; title: string; bio?: string }[] | null;
  community_events: { name: string; description?: string; date?: string }[] | null;
  locations: string[] | null;
  pages_scraped: string[] | null;
  confidence_score: number | null;
  enriched_at: string | null;
}

function ExpandedContent({ deal, onEnrich, isEnriching }: { deal: DomainEnrichmentDeal; onEnrich: () => void; isEnriching: boolean }) {
  const [details, setDetails] = useState<DomainDetail | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  useEffect(() => {
    if (deal.enrichment?.status === 'enriched' && deal.enrichment.domain) {
      setLoadingDetails(true);
      // Fetch full domain data
      fetch(`/api/queues/domain-enrichment/details?domain=${encodeURIComponent(deal.enrichment.domain)}`)
        .then((res) => res.json())
        .then((data) => setDetails(data))
        .catch(() => {/* ignore */})
        .finally(() => setLoadingDetails(false));
    }
  }, [deal.enrichment?.status, deal.enrichment?.domain]);

  // No enrichment at all
  if (!deal.enrichment || deal.enrichment.status === 'pending') {
    return (
      <div className="text-sm text-gray-500 flex items-center gap-3">
        <span>Click Enrich to scrape and analyze the company website.</span>
        {!isEnriching && (
          <button
            onClick={onEnrich}
            className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
          >
            Enrich
          </button>
        )}
      </div>
    );
  }

  // No contacts
  if (deal.enrichment.status === 'no_contacts') {
    return (
      <div className="text-sm text-yellow-700 bg-yellow-50 rounded-lg px-4 py-3">
        No contacts associated with this deal in HubSpot.
      </div>
    );
  }

  // Free email only
  if (deal.enrichment.status === 'free_email_only') {
    return (
      <div className="text-sm text-orange-700 bg-orange-50 rounded-lg px-4 py-3">
        <p className="font-medium mb-1">All contacts have free email providers (gmail, yahoo, etc.)</p>
        {deal.enrichment.contactEmails && deal.enrichment.contactEmails.length > 0 && (
          <p className="text-orange-600">{deal.enrichment.contactEmails.join(', ')}</p>
        )}
      </div>
    );
  }

  // Failed
  if (deal.enrichment.status === 'failed') {
    return (
      <div className="text-sm text-red-700 bg-red-50 rounded-lg px-4 py-3">
        <p className="font-medium mb-1">Enrichment failed</p>
        {deal.enrichment.errorMessage && (
          <p className="text-red-600">{deal.enrichment.errorMessage}</p>
        )}
        {deal.enrichment.domain && (
          <p className="text-red-500 mt-1">Domain: {deal.enrichment.domain}</p>
        )}
      </div>
    );
  }

  // Enriched — show full details
  if (loadingDetails) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
        <svg className="w-4 h-4 animate-spin text-indigo-600" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Loading company details...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Company header */}
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">
            {details?.company_name || deal.enrichment.companyName || deal.enrichment.domain}
          </h3>
          {(details?.confidence_score !== undefined || deal.enrichment.confidenceScore !== null) && (
            <ConfidenceBadge score={details?.confidence_score ?? deal.enrichment.confidenceScore} />
          )}
        </div>
        <div className="text-xs text-gray-400">
          {deal.enrichment.domain && (
            <a
              href={`https://${deal.enrichment.domain}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-600 hover:underline"
            >
              {deal.enrichment.domain}
            </a>
          )}
        </div>
      </div>

      {/* Company overview */}
      {(details?.company_overview || deal.enrichment.companyOverview) && (
        <p className="text-sm text-gray-700">
          {details?.company_overview || deal.enrichment.companyOverview}
        </p>
      )}

      {/* Contact info */}
      <div className="bg-white rounded-lg border border-gray-200 p-3">
        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Contact Emails</h4>
        <div className="text-sm text-gray-700">
          {deal.enrichment.selectedEmail && (
            <div className="mb-1">
              <span className="text-xs text-gray-500 mr-2">Selected:</span>
              <span className="font-mono text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded">{deal.enrichment.selectedEmail}</span>
            </div>
          )}
          {deal.enrichment.contactEmails && deal.enrichment.contactEmails.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {deal.enrichment.contactEmails.map((email) => (
                <span key={email} className="font-mono text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{email}</span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Services */}
        {details?.services && details.services.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 p-3">
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Services ({details.services.length})
            </h4>
            <ul className="space-y-2">
              {details.services.map((svc, i) => (
                <li key={i} className="text-sm">
                  <span className="font-medium text-gray-800">{svc.name}</span>
                  {svc.description && <span className="text-gray-500"> — {svc.description}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Specialties */}
        {details?.specialties && details.specialties.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 p-3">
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Specialties</h4>
            <div className="flex flex-wrap gap-1.5">
              {details.specialties.map((s, i) => (
                <span key={i} className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full">{s}</span>
              ))}
            </div>
          </div>
        )}

        {/* Locations */}
        {details?.locations && details.locations.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 p-3">
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Locations</h4>
            <div className="flex flex-wrap gap-1.5">
              {details.locations.map((loc, i) => (
                <span key={i} className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">{loc}</span>
              ))}
            </div>
          </div>
        )}

        {/* Community Events */}
        {details?.community_events && details.community_events.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 p-3">
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Community Events</h4>
            <ul className="space-y-1">
              {details.community_events.map((evt, i) => (
                <li key={i} className="text-sm">
                  <span className="font-medium text-gray-800">{evt.name}</span>
                  {evt.date && <span className="text-gray-400 text-xs ml-2">{evt.date}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Team Members */}
      {details?.team_members && details.team_members.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-3">
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Team Members ({details.team_members.length})
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {details.team_members.map((member, i) => (
              <div key={i} className="border border-gray-100 rounded-lg p-2">
                <div className="font-medium text-sm text-gray-800">{member.name}</div>
                {member.title && <div className="text-xs text-gray-500">{member.title}</div>}
                {member.bio && <div className="text-xs text-gray-400 mt-1 line-clamp-2">{member.bio}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Enrichment metadata */}
      <div className="flex items-center gap-4 text-xs text-gray-400 pt-2 border-t border-gray-200">
        {details?.pages_scraped && (
          <span>{details.pages_scraped.length} page{details.pages_scraped.length !== 1 ? 's' : ''} scraped</span>
        )}
        {deal.enrichment.analyzedAt && (
          <span>Analyzed {formatRelativeTime(deal.enrichment.analyzedAt)}</span>
        )}
      </div>
    </div>
  );
}
