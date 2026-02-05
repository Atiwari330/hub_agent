'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { formatCurrency } from '@/lib/utils/currency';
import { getHubSpotDealUrl } from '@/lib/hubspot/urls';
import { getCurrentQuarter, getQuarterInfo } from '@/lib/utils/quarter';

// Tooltip component for hover information
function Tooltip({ children, content }: { children: React.ReactNode; content: string }) {
  const [show, setShow] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleMouseEnter = () => {
    timeoutRef.current = setTimeout(() => setShow(true), 400);
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setShow(false);
  };

  return (
    <span className="relative inline-block" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
      {children}
      {show && (
        <span className="absolute z-50 px-2 py-1 text-xs text-white bg-gray-900 rounded shadow-lg whitespace-nowrap -top-8 left-1/2 -translate-x-1/2">
          {content}
          <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
        </span>
      )}
    </span>
  );
}

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
  closeDate: string | null;
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
type QuarterFilter = 'q1' | 'q2' | 'q3' | 'q4';

const DEFAULT_STAGES = ['Proposal/Evaluating', 'Demo - Completed'];
const DEFAULT_QUARTERS: QuarterFilter[] = ['q1'];

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

  // Stage multiselect
  const [stageFilter, setStageFilter] = useState<string[]>(DEFAULT_STAGES);
  const [stageDropdownOpen, setStageDropdownOpen] = useState(false);

  // Quarter multiselect
  const [quarterFilter, setQuarterFilter] = useState<QuarterFilter[]>(DEFAULT_QUARTERS);
  const [quarterDropdownOpen, setQuarterDropdownOpen] = useState(false);

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

  // Extract unique stages
  const uniqueStages = useMemo(() => {
    if (!data) return [];
    const stages = new Set<string>();
    for (const deal of data.deals) {
      if (deal.stageName) stages.add(deal.stageName);
    }
    return Array.from(stages).sort();
  }, [data]);

  // Quarter options
  const quarterOptions = useMemo(() => {
    const currentQ = getCurrentQuarter();
    return [
      { value: 'q1' as QuarterFilter, label: `Q1 ${currentQ.year}`, year: currentQ.year },
      { value: 'q2' as QuarterFilter, label: `Q2 ${currentQ.year}`, year: currentQ.year },
      { value: 'q3' as QuarterFilter, label: `Q3 ${currentQ.year}`, year: currentQ.year },
      { value: 'q4' as QuarterFilter, label: `Q4 ${currentQ.year}`, year: currentQ.year },
    ];
  }, []);

  const currentYear = quarterOptions[0]?.year || new Date().getFullYear();

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

    // Stage filter
    if (stageFilter.length > 0) {
      result = result.filter((d) => stageFilter.includes(d.stageName));
    }

    // Quarter filter
    if (quarterFilter.length > 0) {
      result = result.filter((deal) => {
        if (!deal.closeDate) return false;
        const closeTime = new Date(deal.closeDate).getTime();
        return quarterFilter.some((qf) => {
          const quarterNum = parseInt(qf.replace('q', ''), 10);
          const qi = getQuarterInfo(currentYear, quarterNum);
          return closeTime >= qi.startDate.getTime() && closeTime <= qi.endDate.getTime();
        });
      });
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
  }, [data, aeFilter, statusFilter, stageFilter, quarterFilter, currentYear, sortColumn, sortDirection]);

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

  // Get status badge styling - compact version
  const getStatusBadge = (status: string, daysOverdue?: number | null) => {
    switch (status) {
      case 'overdue':
        return {
          bg: 'bg-red-100',
          text: 'text-red-700',
          label: daysOverdue ? `${daysOverdue}d` : 'Late',
          fullLabel: daysOverdue ? `${daysOverdue} days overdue` : 'Overdue'
        };
      case 'missing':
        return { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Missing', fullLabel: 'Missing next step' };
      case 'needs_analysis':
        return { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Analyze', fullLabel: 'Needs analysis' };
      case 'compliant':
        return { bg: 'bg-green-100', text: 'text-green-700', label: 'OK', fullLabel: 'Compliant' };
      default:
        return { bg: 'bg-gray-100', text: 'text-gray-700', label: status, fullLabel: status };
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

      {/* Summary Banner - Simplified */}
      {data && (
        <div className="mb-6">
          {/* Primary metric: deals needing attention */}
          {(data.counts.overdue + data.counts.missing) > 0 ? (
            <div className="flex items-center justify-between">
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-semibold text-gray-900">
                  {data.counts.overdue + data.counts.missing}
                </span>
                <span className="text-gray-600">
                  deal{(data.counts.overdue + data.counts.missing) !== 1 ? 's' : ''} need attention
                </span>
                {/* Subtle breakdown on hover */}
                <span className="text-sm text-gray-400 ml-2">
                  ({data.counts.overdue} overdue, {data.counts.missing} missing)
                </span>
              </div>
              {/* Compliance percentage */}
              <div className="flex items-center gap-3">
                <div className="w-32 h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                    style={{ width: `${data.counts.total > 0 ? ((data.counts.compliant / data.counts.total) * 100) : 0}%` }}
                  />
                </div>
                <span className="text-sm text-gray-500">
                  {data.counts.total > 0 ? Math.round((data.counts.compliant / data.counts.total) * 100) : 0}% compliant
                </span>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-emerald-600">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="font-medium">All deals have valid next steps</span>
            </div>
          )}
        </div>
      )}

      {/* Filters Row - Compact design */}
      <div className="flex items-center gap-2 mb-4 pb-4 border-b border-gray-100">
        {/* Active filter pills */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Quarter pills */}
          {quarterFilter.length > 0 && quarterFilter.map((q) => {
            const option = quarterOptions.find((opt) => opt.value === q);
            return (
              <span
                key={q}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-indigo-100 text-indigo-700 rounded-full"
              >
                {option?.label}
                <button
                  onClick={() => setQuarterFilter(quarterFilter.filter((qf) => qf !== q))}
                  className="hover:text-indigo-900 transition-colors"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </span>
            );
          })}

          {/* Stage pills */}
          {stageFilter.length > 0 && stageFilter.map((stage) => (
            <span
              key={stage}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-gray-100 text-gray-700 rounded-full"
            >
              {stage}
              <button
                onClick={() => setStageFilter(stageFilter.filter((s) => s !== stage))}
                className="hover:text-gray-900 transition-colors"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </span>
          ))}

          {/* AE pill */}
          {aeFilter !== 'all' && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-gray-100 text-gray-700 rounded-full">
              {uniqueAEs.find((ae) => ae.id === aeFilter)?.name}
              <button
                onClick={() => setAeFilter('all')}
                className="hover:text-gray-900 transition-colors"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </span>
          )}

          {/* Status pill */}
          {statusFilter !== 'all' && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-gray-100 text-gray-700 rounded-full capitalize">
              {statusFilter.replace('_', ' ')}
              <button
                onClick={() => setStatusFilter('all')}
                className="hover:text-gray-900 transition-colors"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </span>
          )}
        </div>

        {/* Filter dropdowns - more subtle */}
        <div className="flex items-center gap-2 ml-2">
          <select
            value={aeFilter}
            onChange={(e) => setAeFilter(e.target.value)}
            className="text-xs border border-gray-200 rounded-md px-2 py-1.5 bg-white text-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
          >
            <option value="all">All AEs</option>
            {uniqueAEs.map((ae) => (
              <option key={ae.id} value={ae.id}>{ae.name}</option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="text-xs border border-gray-200 rounded-md px-2 py-1.5 bg-white text-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
          >
            <option value="all">All Status</option>
            <option value="overdue">Overdue</option>
            <option value="missing">Missing</option>
            {viewMode === 'all' && (
              <>
                <option value="needs_analysis">Needs Analysis</option>
                <option value="compliant">Compliant</option>
              </>
            )}
          </select>

          {/* Stage Filter Dropdown */}
          <div className="relative">
            <button
              onClick={() => setStageDropdownOpen(!stageDropdownOpen)}
              className="text-xs border border-gray-200 rounded-md px-2 py-1.5 bg-white text-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 flex items-center gap-1"
            >
              <span>Stage</span>
              <svg className={`w-3 h-3 text-gray-400 transition-transform ${stageDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {stageDropdownOpen && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setStageDropdownOpen(false)}
                />
                <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 min-w-[200px] max-h-[300px] overflow-y-auto">
                  {uniqueStages.map((stage) => (
                    <label
                      key={stage}
                      className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer text-xs"
                    >
                      <input
                        type="checkbox"
                        checked={stageFilter.includes(stage)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setStageFilter([...stageFilter, stage]);
                          } else {
                            setStageFilter(stageFilter.filter((s) => s !== stage));
                          }
                        }}
                        className="w-3.5 h-3.5 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                      />
                      <span className="text-gray-700">{stage}</span>
                    </label>
                  ))}
                  {stageFilter.length > 0 && (
                    <button
                      onClick={() => setStageFilter([])}
                      className="w-full px-3 py-2 text-xs text-indigo-600 hover:bg-indigo-50 border-t border-gray-100 text-left"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Quarter Filter Dropdown */}
          <div className="relative">
            <button
              onClick={() => setQuarterDropdownOpen(!quarterDropdownOpen)}
              className="text-xs border border-gray-200 rounded-md px-2 py-1.5 bg-white text-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 flex items-center gap-1"
            >
              <span>Quarter</span>
              <svg className={`w-3 h-3 text-gray-400 transition-transform ${quarterDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {quarterDropdownOpen && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setQuarterDropdownOpen(false)}
                />
                <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 min-w-[130px]">
                  {quarterOptions.map((option) => (
                    <label
                      key={option.value}
                      className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer text-xs"
                    >
                      <input
                        type="checkbox"
                        checked={quarterFilter.includes(option.value)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setQuarterFilter([...quarterFilter, option.value]);
                          } else {
                            setQuarterFilter(quarterFilter.filter((q) => q !== option.value));
                          }
                        }}
                        className="w-3.5 h-3.5 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                      />
                      <span className="text-gray-700">{option.label}</span>
                    </label>
                  ))}
                  {quarterFilter.length > 0 && (
                    <button
                      onClick={() => setQuarterFilter([])}
                      className="w-full px-3 py-2 text-xs text-indigo-600 hover:bg-indigo-50 border-t border-gray-100 text-left"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Reset to defaults */}
          {(aeFilter !== 'all' ||
            statusFilter !== 'all' ||
            JSON.stringify([...stageFilter].sort()) !== JSON.stringify([...DEFAULT_STAGES].sort()) ||
            JSON.stringify([...quarterFilter].sort()) !== JSON.stringify([...DEFAULT_QUARTERS].sort())) && (
            <button
              onClick={() => {
                setAeFilter('all');
                setStatusFilter('all');
                setStageFilter([...DEFAULT_STAGES]);
                setQuarterFilter([...DEFAULT_QUARTERS]);
              }}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              Reset
            </button>
          )}
        </div>

        {/* Right side: count and batch action */}
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-gray-500">
            {filteredDeals.length} deal{filteredDeals.length !== 1 ? 's' : ''}
            {selectedDeals.size > 0 && (
              <span className="text-indigo-600 font-medium"> · {selectedDeals.size} selected</span>
            )}
          </span>

          {/* Run Analysis button */}
          {selectedDeals.size > 0 && (
            <button
              onClick={handleBatchAnalyze}
              disabled={isBatchAnalyzing}
              className="px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 shadow-sm"
            >
              {isBatchAnalyzing ? (
                <>
                  <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span>
                    {batchProgress ? `${batchProgress.current}/${batchProgress.total}` : '...'}
                  </span>
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                  <span>Analyze</span>
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
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50/80 border-b border-gray-200">
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
                    className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100/50 select-none transition-colors"
                    onClick={() => handleSort('dealName')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Deal</span>
                      <SortIcon active={sortColumn === 'dealName'} direction={sortDirection} />
                    </div>
                  </th>
                  <th
                    className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100/50 select-none whitespace-nowrap transition-colors"
                    onClick={() => handleSort('ownerName')}
                  >
                    <div className="flex items-center gap-1">
                      <span>AE</span>
                      <SortIcon active={sortColumn === 'ownerName'} direction={sortDirection} />
                    </div>
                  </th>
                  <th
                    className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100/50 select-none whitespace-nowrap transition-colors"
                    onClick={() => handleSort('amount')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Value</span>
                      <SortIcon active={sortColumn === 'amount'} direction={sortDirection} />
                    </div>
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap w-20">
                    Status
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">
                    Next Step
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap w-28">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredDeals.map((deal) => {
                  const isCreating = creatingTasks.has(deal.id);
                  const isAnalyzing = analyzingDeals.has(deal.id);
                  const hasTask = deal.existingTask !== null;
                  const statusBadge = getStatusBadge(deal.status, deal.daysOverdue);

                  // Batch analysis state for this row
                  const batchResult = batchResults.get(deal.id);
                  const isBeingBatchAnalyzed = isBatchAnalyzing && selectedDeals.has(deal.id) && !batchResult;
                  const batchAnalysisComplete = batchResult !== undefined;

                  // High-value deal styling (over $50k gets emphasis)
                  const isHighValue = (deal.amount || 0) >= 50000;

                  return (
                    <tr
                      key={deal.id}
                      className={`group transition-colors ${
                        selectedDeals.has(deal.id)
                          ? 'bg-indigo-50/70'
                          : batchAnalysisComplete && batchResult.success
                          ? 'bg-emerald-50/50'
                          : batchAnalysisComplete && !batchResult.success
                          ? 'bg-red-50/50'
                          : deal.status === 'compliant'
                          ? 'bg-white hover:bg-gray-50/50'
                          : 'bg-white hover:bg-gray-50'
                      }`}
                    >
                      <td className="px-4 py-4">
                        <div className="flex items-center justify-center">
                          {isBeingBatchAnalyzed ? (
                            <svg className="animate-spin w-4 h-4 text-indigo-600" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                          ) : batchAnalysisComplete && batchResult.success ? (
                            <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                      <td className="px-4 py-4">
                        <a
                          href={getHubSpotDealUrl(deal.hubspotDealId)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`text-sm hover:text-indigo-600 transition-colors ${
                            isHighValue ? 'font-semibold text-gray-900' : 'font-medium text-gray-800'
                          }`}
                        >
                          {deal.dealName}
                        </a>
                      </td>
                      <td className="px-4 py-4">
                        <span className="text-sm text-gray-600">{deal.ownerName}</span>
                      </td>
                      <td className="px-4 py-4">
                        <span className={`text-sm whitespace-nowrap ${isHighValue ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
                          {deal.amount ? formatCurrency(deal.amount) : '-'}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <Tooltip content={statusBadge.fullLabel}>
                          <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${statusBadge.bg} ${statusBadge.text}`}>
                            {statusBadge.label}
                          </span>
                        </Tooltip>
                      </td>
                      <td className="px-4 py-4 max-w-[320px]">
                        {deal.nextStep ? (
                          <div className="flex flex-col gap-1">
                            {/* Primary: Next step text (clean, no date prefix) */}
                            <span className="text-sm text-gray-700 line-clamp-2" title={deal.nextStep}>
                              {deal.nextStep}
                            </span>
                            {/* Secondary: Due date info (smaller, muted) */}
                            {deal.nextStepDueDate && (
                              <Tooltip content={deal.analysis.lastAnalyzedAt ? `Analyzed ${formatTaskDate(deal.analysis.lastAnalyzedAt)}` : 'Not analyzed yet'}>
                                <span className="text-xs text-gray-400">
                                  Due {formatDueDate(deal.nextStepDueDate)}
                                  {deal.status === 'overdue' && deal.daysOverdue && (
                                    <span className="text-red-500 ml-1">· {deal.daysOverdue}d late</span>
                                  )}
                                </span>
                              </Tooltip>
                            )}
                            {!deal.nextStepDueDate && !deal.analysis.lastAnalyzedAt && (
                              <span className="text-xs text-blue-500">Not analyzed</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-sm text-gray-400 italic">No next step</span>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center">
                          {/* Priority 1: Analyze button if needs analysis */}
                          {deal.nextStep && deal.analysis.needsAnalysis ? (
                            <button
                              onClick={() => handleAnalyze(deal)}
                              disabled={isAnalyzing}
                              className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors whitespace-nowrap disabled:opacity-50 shadow-sm"
                            >
                              {isAnalyzing ? (
                                <span className="flex items-center gap-1.5">
                                  <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                  </svg>
                                  <span>...</span>
                                </span>
                              ) : (
                                'Analyze'
                              )}
                            </button>
                          ) : /* Priority 2: Create Task or show checkmark for missing/overdue */
                          (deal.status === 'missing' || deal.status === 'overdue') ? (
                            hasTask ? (
                              /* Task exists: show subtle checkmark, Re-create on hover */
                              <div className="flex items-center gap-1.5 group/task">
                                <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                                <span className="text-xs text-gray-500">{formatTaskDate(deal.existingTask!.createdAt)}</span>
                                <button
                                  onClick={() => handleCreateTask(deal)}
                                  disabled={isCreating}
                                  className="text-xs text-gray-400 hover:text-indigo-600 opacity-0 group-hover/task:opacity-100 transition-opacity"
                                >
                                  {isCreating ? '...' : 'Redo'}
                                </button>
                              </div>
                            ) : (
                              /* No task: show Create Task button */
                              <button
                                onClick={() => handleCreateTask(deal)}
                                disabled={isCreating}
                                className="px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 rounded-md hover:bg-emerald-700 transition-colors whitespace-nowrap disabled:opacity-50 shadow-sm"
                              >
                                {isCreating ? (
                                  <span className="flex items-center gap-1.5">
                                    <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                    </svg>
                                    <span>...</span>
                                  </span>
                                ) : (
                                  'Create Task'
                                )}
                              </button>
                            )
                          ) : /* Priority 3: Compliant deals - subtle re-analyze option */
                          deal.status === 'compliant' && deal.nextStep ? (
                            <button
                              onClick={() => handleAnalyze(deal)}
                              disabled={isAnalyzing}
                              className="text-xs text-gray-400 hover:text-indigo-600 transition-colors opacity-0 group-hover:opacity-100"
                            >
                              {isAnalyzing ? '...' : 'Re-analyze'}
                            </button>
                          ) : (
                            /* Nothing to show */
                            <span className="text-gray-300">—</span>
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
