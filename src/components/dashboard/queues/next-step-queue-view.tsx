'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { formatCurrency } from '@/lib/utils/currency';
import { getHubSpotDealUrl } from '@/lib/hubspot/urls';

interface ExistingTaskInfo {
  hubspotTaskId: string;
  createdAt: string;
  taskType: 'missing' | 'overdue';
  nextStepText: string | null;
  daysOverdue: number | null;
}

interface AnalysisInfo {
  lastAnalyzedAt: string | null;
  analyzedValue: string | null;
  needsAnalysis: boolean;
  analysisStatus: string | null;
}

interface NextStepQueueDeal {
  id: string;
  hubspotDealId: string;
  hubspotOwnerId: string;
  dealName: string;
  amount: number | null;
  stageName: string;
  ownerName: string;
  ownerId: string;
  status: 'missing' | 'overdue' | 'compliant' | 'needs_analysis';
  nextStep: string | null;
  nextStepDueDate: string | null;
  daysOverdue: number | null;
  reason: string;
  existingTask: ExistingTaskInfo | null;
  analysis: AnalysisInfo;
}

interface NextStepQueueResponse {
  deals: NextStepQueueDeal[];
  counts: {
    missing: number;
    overdue: number;
    compliant: number;
    needsAnalysis: number;
    total: number;
  };
}

type SortColumn = 'dealName' | 'ownerName' | 'amount' | 'stageName' | 'daysOverdue';
type SortDirection = 'asc' | 'desc';
type ViewMode = 'issues' | 'all';

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

export function NextStepQueueView() {
  const [data, setData] = useState<NextStepQueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // View mode: 'issues' (default) or 'all' (shows all deals for testing)
  const [viewMode, setViewMode] = useState<ViewMode>('issues');

  // Filters
  const [aeFilter, setAeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Sorting
  const [sortColumn, setSortColumn] = useState<SortColumn>('amount');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Selection
  const [selectedDeals, setSelectedDeals] = useState<Set<string>>(new Set());

  // Task creation state
  const [creatingTasks, setCreatingTasks] = useState<Set<string>>(new Set());

  // Analysis state
  const [analyzingDeals, setAnalyzingDeals] = useState<Set<string>>(new Set());

  // Batch analysis state
  const [isBatchAnalyzing, setIsBatchAnalyzing] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{
    current: number;
    total: number;
    currentDealName: string;
  } | null>(null);
  const [batchResults, setBatchResults] = useState<Map<string, { success: boolean; error?: string }>>(
    new Map()
  );

  // Extract unique AEs for filter dropdown
  const uniqueAEs = useMemo(() => {
    if (!data) return [];
    const aes = new Map<string, string>();
    for (const deal of data.deals) {
      if (deal.ownerId && deal.ownerName) {
        aes.set(deal.ownerId, deal.ownerName);
      }
    }
    return Array.from(aes.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);

  // Filtered and sorted deals
  const filteredDeals = useMemo(() => {
    if (!data) return [];

    let result = data.deals;

    // Apply AE filter
    if (aeFilter !== 'all') {
      result = result.filter((d) => d.ownerId === aeFilter);
    }

    // Apply status filter
    if (statusFilter !== 'all') {
      result = result.filter((d) => d.status === statusFilter);
    }

    // Sort
    result = [...result].sort((a, b) => {
      let comparison = 0;
      switch (sortColumn) {
        case 'dealName':
          comparison = a.dealName.localeCompare(b.dealName);
          break;
        case 'ownerName':
          comparison = a.ownerName.localeCompare(b.ownerName);
          break;
        case 'amount':
          comparison = (a.amount || 0) - (b.amount || 0);
          break;
        case 'stageName':
          comparison = a.stageName.localeCompare(b.stageName);
          break;
        case 'daysOverdue':
          comparison = (a.daysOverdue || 0) - (b.daysOverdue || 0);
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [data, aeFilter, statusFilter, sortColumn, sortDirection]);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (viewMode === 'all') {
        params.set('showAll', 'true');
      }
      const response = await fetch(`/api/queues/next-step?${params}`);
      if (!response.ok) {
        throw new Error('Failed to fetch next-step queue');
      }
      const json = await response.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [viewMode]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  const handleSelectAll = () => {
    if (selectedDeals.size === filteredDeals.length) {
      setSelectedDeals(new Set());
    } else {
      setSelectedDeals(new Set(filteredDeals.map((d) => d.id)));
    }
  };

  const handleSelectDeal = (dealId: string) => {
    const newSelected = new Set(selectedDeals);
    if (newSelected.has(dealId)) {
      newSelected.delete(dealId);
    } else {
      newSelected.add(dealId);
    }
    setSelectedDeals(newSelected);
  };

  // Analyze a deal's next step
  const handleAnalyze = async (deal: NextStepQueueDeal) => {
    setAnalyzingDeals((prev) => new Set(prev).add(deal.id));

    try {
      const response = await fetch(`/api/ae/${deal.ownerId}/deals/${deal.id}/analyze-next-step`, {
        method: 'POST',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to analyze');
      }

      // Refresh data to show updated analysis
      await fetchData();
    } catch (err) {
      console.error('Failed to analyze:', err);
      alert(err instanceof Error ? err.message : 'Failed to analyze');
    } finally {
      setAnalyzingDeals((prev) => {
        const next = new Set(prev);
        next.delete(deal.id);
        return next;
      });
    }
  };

  // Create HubSpot task for a deal
  const handleCreateTask = async (deal: NextStepQueueDeal, skipRefresh = false) => {
    if (deal.status !== 'missing' && deal.status !== 'overdue') {
      alert('Can only create tasks for missing or overdue deals');
      return;
    }

    setCreatingTasks((prev) => new Set(prev).add(deal.id));

    try {
      const response = await fetch('/api/queues/create-next-step-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dealId: deal.id,
          hubspotDealId: deal.hubspotDealId,
          hubspotOwnerId: deal.hubspotOwnerId,
          dealName: deal.dealName,
          taskType: deal.status,
          nextStepText: deal.nextStep,
          daysOverdue: deal.daysOverdue,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create task');
      }

      if (!skipRefresh) {
        await fetchData();
      }
    } catch (err) {
      console.error('Failed to create task:', err);
      alert(err instanceof Error ? err.message : 'Failed to create task');
    } finally {
      setCreatingTasks((prev) => {
        const next = new Set(prev);
        next.delete(deal.id);
        return next;
      });
    }
  };

  // Batch analyze selected deals
  const handleBatchAnalyze = async () => {
    if (selectedDeals.size === 0 || isBatchAnalyzing) return;

    const dealIds = Array.from(selectedDeals);
    setIsBatchAnalyzing(true);
    setBatchProgress({ current: 0, total: dealIds.length, currentDealName: '' });
    setBatchResults(new Map());

    try {
      const response = await fetch('/api/queues/batch-analyze-next-step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dealIds }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to start batch analysis');
      }

      if (!response.body) {
        throw new Error('No response body');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6);
          if (!jsonStr) continue;

          try {
            const event = JSON.parse(jsonStr);

            if (event.type === 'progress') {
              setBatchProgress({
                current: event.index,
                total: event.total,
                currentDealName: event.dealName,
              });

              setBatchResults((prev) => {
                const next = new Map(prev);
                next.set(event.dealId, {
                  success: event.status === 'success',
                  error: event.error,
                });
                return next;
              });

              // Update the deal in the local data if analysis was successful
              if (event.status === 'success' && event.analysis) {
                setData((prev) => {
                  if (!prev) return prev;
                  return {
                    ...prev,
                    deals: prev.deals.map((deal) => {
                      if (deal.id === event.dealId) {
                        return {
                          ...deal,
                          status: event.analysis.status === 'date_found' || event.analysis.status === 'date_inferred'
                            ? 'compliant'
                            : deal.status,
                          analysis: {
                            ...deal.analysis,
                            lastAnalyzedAt: new Date().toISOString(),
                            needsAnalysis: false,
                            analysisStatus: event.analysis.status,
                          },
                        };
                      }
                      return deal;
                    }),
                  };
                });
              }
            } else if (event.type === 'done') {
              // Batch complete - clear selection
              setSelectedDeals(new Set());
            }
          } catch {
            console.error('Failed to parse SSE event:', jsonStr);
          }
        }
      }
    } catch (err) {
      console.error('Batch analysis error:', err);
      alert(err instanceof Error ? err.message : 'Batch analysis failed');
    } finally {
      setIsBatchAnalyzing(false);
      setBatchProgress(null);
      // Refresh data to get updated counts
      fetchData();
    }
  };

  // Format dates
  const formatTaskDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const formatDueDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // Get status badge styling
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'overdue':
        return { bg: 'bg-red-100', text: 'text-red-700', label: 'Overdue' };
      case 'missing':
        return { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Missing' };
      case 'needs_analysis':
        return { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Needs Analysis' };
      case 'compliant':
        return { bg: 'bg-green-100', text: 'text-green-700', label: 'Compliant' };
      default:
        return { bg: 'bg-gray-100', text: 'text-gray-700', label: status };
    }
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Next Step Queue</h1>
          <p className="text-sm text-gray-600 mt-1">
            {viewMode === 'all'
              ? 'All active deals. Analyze next steps to extract due dates.'
              : 'Deals with missing or overdue next steps.'}
          </p>
        </div>

        {/* View mode toggle */}
        <div className="flex items-center gap-3">
          <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
            <button
              onClick={() => setViewMode('issues')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                viewMode === 'issues'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Issues Only
            </button>
            <button
              onClick={() => setViewMode('all')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                viewMode === 'all'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              All Deals
            </button>
          </div>
        </div>
      </div>

      {/* Counts Summary */}
      {data && (
        <div className="flex gap-4 mb-4">
          <div className="flex items-center gap-2 text-sm">
            <span className="px-2 py-1 bg-red-100 text-red-700 rounded font-medium">{data.counts.overdue}</span>
            <span className="text-gray-600">Overdue</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="px-2 py-1 bg-amber-100 text-amber-700 rounded font-medium">{data.counts.missing}</span>
            <span className="text-gray-600">Missing</span>
          </div>
          {viewMode === 'all' && (
            <>
              <div className="flex items-center gap-2 text-sm">
                <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded font-medium">{data.counts.needsAnalysis}</span>
                <span className="text-gray-600">Needs Analysis</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="px-2 py-1 bg-green-100 text-green-700 rounded font-medium">{data.counts.compliant}</span>
                <span className="text-gray-600">Compliant</span>
              </div>
            </>
          )}
          <div className="flex items-center gap-2 text-sm">
            <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded font-medium">{data.counts.total}</span>
            <span className="text-gray-600">Total</span>
          </div>
        </div>
      )}

      {/* Filters Row */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">AE:</label>
          <select
            value={aeFilter}
            onChange={(e) => setAeFilter(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="all">All AEs</option>
            {uniqueAEs.map((ae) => (
              <option key={ae.id} value={ae.id}>{ae.name}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Status:</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="all">All Statuses</option>
            <option value="overdue">Overdue</option>
            <option value="missing">Missing</option>
            {viewMode === 'all' && (
              <>
                <option value="needs_analysis">Needs Analysis</option>
                <option value="compliant">Compliant</option>
              </>
            )}
          </select>
        </div>

        {(aeFilter !== 'all' || statusFilter !== 'all') && (
          <button
            onClick={() => {
              setAeFilter('all');
              setStatusFilter('all');
            }}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Clear filters
          </button>
        )}

        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm text-gray-500">
            {filteredDeals.length} deal{filteredDeals.length !== 1 ? 's' : ''}
            {selectedDeals.size > 0 && ` (${selectedDeals.size} selected)`}
          </span>

          {/* Run Analysis button */}
          {selectedDeals.size > 0 && (
            <button
              onClick={handleBatchAnalyze}
              disabled={isBatchAnalyzing}
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isBatchAnalyzing ? (
                <>
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span>
                    {batchProgress ? `${batchProgress.current}/${batchProgress.total}` : 'Starting...'}
                  </span>
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                  <span>Run Analysis</span>
                </>
              )}
            </button>
          )}
        </div>
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
      {!loading && !error && filteredDeals.length === 0 && (
        <div className="text-center py-12 bg-gray-50 rounded-lg">
          <svg
            className="mx-auto h-12 w-12 text-gray-400"
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
          <h3 className="mt-4 text-lg font-medium text-gray-900">
            {viewMode === 'all' ? 'No deals found' : 'All caught up!'}
          </h3>
          <p className="mt-1 text-sm text-gray-500">
            No deals matching the current filters.
          </p>
        </div>
      )}

      {/* Batch Analysis Progress Banner */}
      {isBatchAnalyzing && batchProgress && (
        <div className="mb-4 bg-indigo-50 border border-indigo-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <svg className="animate-spin w-5 h-5 text-indigo-600" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-sm font-medium text-indigo-900">
                Analyzing deal {batchProgress.current} of {batchProgress.total}
              </span>
            </div>
            <span className="text-sm text-indigo-700 truncate max-w-[300px]" title={batchProgress.currentDealName}>
              {batchProgress.currentDealName}
            </span>
          </div>
          <div className="w-full bg-indigo-200 rounded-full h-2">
            <div
              className="bg-indigo-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Deals Table */}
      {!loading && !error && filteredDeals.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 border-b border-gray-200">
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedDeals.size === filteredDeals.length && filteredDeals.length > 0}
                      onChange={handleSelectAll}
                      disabled={isBatchAnalyzing}
                      className="w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500 disabled:opacity-50"
                    />
                  </th>
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none"
                    onClick={() => handleSort('dealName')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Deal Name</span>
                      <SortIcon active={sortColumn === 'dealName'} direction={sortDirection} />
                    </div>
                  </th>
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                    onClick={() => handleSort('ownerName')}
                  >
                    <div className="flex items-center gap-1">
                      <span>AE</span>
                      <SortIcon active={sortColumn === 'ownerName'} direction={sortDirection} />
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
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                    onClick={() => handleSort('stageName')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Stage</span>
                      <SortIcon active={sortColumn === 'stageName'} direction={sortDirection} />
                    </div>
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider whitespace-nowrap">
                    Status
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider whitespace-nowrap">
                    Next Step
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider whitespace-nowrap">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredDeals.map((deal) => {
                  const isCreating = creatingTasks.has(deal.id);
                  const isAnalyzing = analyzingDeals.has(deal.id);
                  const hasTask = deal.existingTask !== null;
                  const statusBadge = getStatusBadge(deal.status);

                  // Batch analysis state for this row
                  const batchResult = batchResults.get(deal.id);
                  const isBeingBatchAnalyzed = isBatchAnalyzing && selectedDeals.has(deal.id) && !batchResult;
                  const batchAnalysisComplete = batchResult !== undefined;

                  return (
                    <tr
                      key={deal.id}
                      className={`hover:bg-slate-50 transition-colors ${
                        selectedDeals.has(deal.id) ? 'bg-indigo-50' : ''
                      } ${deal.status === 'compliant' ? 'bg-green-50/30' : ''} ${
                        batchAnalysisComplete && batchResult.success ? 'bg-green-50' : ''
                      } ${batchAnalysisComplete && !batchResult.success ? 'bg-red-50' : ''}`}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center">
                          {isBeingBatchAnalyzed ? (
                            <svg className="animate-spin w-4 h-4 text-indigo-600" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                          ) : batchAnalysisComplete && batchResult.success ? (
                            <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          ) : batchAnalysisComplete && !batchResult.success ? (
                            <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          ) : (
                            <input
                              type="checkbox"
                              checked={selectedDeals.has(deal.id)}
                              onChange={() => handleSelectDeal(deal.id)}
                              disabled={isBatchAnalyzing}
                              className="w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500 disabled:opacity-50"
                            />
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <a
                          href={getHubSpotDealUrl(deal.hubspotDealId)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-medium text-gray-900 hover:text-indigo-600 transition-colors"
                        >
                          {deal.dealName}
                        </a>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-gray-600">{deal.ownerName}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-gray-900 whitespace-nowrap">
                          {deal.amount ? formatCurrency(deal.amount) : '-'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-gray-600 whitespace-nowrap">{deal.stageName}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 text-xs font-medium rounded ${statusBadge.bg} ${statusBadge.text}`}>
                          {statusBadge.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 max-w-[300px]">
                        {deal.nextStep ? (
                          <div className="flex flex-col gap-0.5">
                            <span className="text-sm text-gray-700 truncate" title={deal.nextStep}>
                              {deal.nextStep}
                            </span>
                            {deal.status === 'overdue' && deal.daysOverdue && (
                              <span className="text-xs text-red-600 font-medium">
                                {deal.daysOverdue} day{deal.daysOverdue !== 1 ? 's' : ''} overdue (Due: {formatDueDate(deal.nextStepDueDate)})
                              </span>
                            )}
                            {deal.analysis.lastAnalyzedAt && (
                              <span className="text-xs text-gray-400">
                                Analyzed: {formatTaskDate(deal.analysis.lastAnalyzedAt)}
                                {deal.analysis.needsAnalysis && ' (stale)'}
                              </span>
                            )}
                            {!deal.analysis.lastAnalyzedAt && (
                              <span className="text-xs text-blue-600">Not analyzed yet</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-sm text-gray-400 italic">No next step defined</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {/* Analyze button - show if deal has next step and needs analysis */}
                          {deal.nextStep && deal.analysis.needsAnalysis && (
                            <button
                              onClick={() => handleAnalyze(deal)}
                              disabled={isAnalyzing}
                              className="px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 rounded hover:bg-blue-100 transition-colors whitespace-nowrap disabled:opacity-50"
                            >
                              {isAnalyzing ? (
                                <span className="flex items-center gap-1">
                                  <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                  </svg>
                                  Analyzing...
                                </span>
                              ) : (
                                'Analyze'
                              )}
                            </button>
                          )}

                          {/* Create Task button - show for missing or overdue */}
                          {(deal.status === 'missing' || deal.status === 'overdue') && (
                            <>
                              {hasTask ? (
                                <div className="flex items-center gap-1">
                                  <span className="text-xs text-emerald-600">
                                    Task {formatTaskDate(deal.existingTask!.createdAt)}
                                  </span>
                                  <button
                                    onClick={() => handleCreateTask(deal)}
                                    disabled={isCreating}
                                    className="text-xs text-gray-500 hover:text-gray-700 underline"
                                  >
                                    Re-create
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => handleCreateTask(deal)}
                                  disabled={isCreating}
                                  className="px-3 py-1.5 text-xs font-medium text-emerald-600 bg-emerald-50 rounded hover:bg-emerald-100 transition-colors whitespace-nowrap disabled:opacity-50"
                                >
                                  {isCreating ? 'Creating...' : 'Create Task'}
                                </button>
                              )}
                            </>
                          )}

                          {/* Re-analyze button for analyzed compliant deals */}
                          {deal.nextStep && !deal.analysis.needsAnalysis && deal.status === 'compliant' && (
                            <button
                              onClick={() => handleAnalyze(deal)}
                              disabled={isAnalyzing}
                              className="text-xs text-gray-500 hover:text-gray-700 underline"
                            >
                              {isAnalyzing ? 'Analyzing...' : 'Re-analyze'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
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
