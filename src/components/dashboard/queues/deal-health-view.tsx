'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getHubSpotDealUrl } from '@/lib/hubspot/urls';
import { ACTIVE_STAGE_OPTIONS, SALES_PIPELINE_STAGES } from '@/lib/hubspot/stage-config';
import type { DealIntelligenceResponse, DealIntelligenceItem } from '@/app/api/queues/deal-intelligence/route';

// --- Types ---

type GradeFilter = 'all' | 'A' | 'B' | 'C' | 'D' | 'F';
type ViewTab = 'all' | 'pre_demo_effort' | 'deal_health';
type SortColumn = 'grade' | 'dealName' | 'amount' | 'stage' | 'closeDate' | 'urgency' | 'issues';
type SortDirection = 'asc' | 'desc';

// --- Helper Components ---

function GradeBadge({ grade, score, gradeType }: { grade: string; score: number; gradeType?: string }) {
  const styles: Record<string, string> = {
    A: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    B: 'bg-blue-100 text-blue-800 border-blue-300',
    C: 'bg-yellow-100 text-yellow-800 border-yellow-300',
    D: 'bg-orange-100 text-orange-800 border-orange-300',
    F: 'bg-red-100 text-red-800 border-red-300',
  };
  const label = gradeType === 'pre_demo_effort' ? 'Effort' : 'Health';
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-sm font-bold border ${styles[grade] || 'bg-gray-100 text-gray-800'}`}>
        {grade}
        <span className="text-xs font-normal opacity-70">{score}</span>
      </span>
      <span className="text-[10px] text-gray-400 font-medium">{label}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-xs text-gray-400">Pending</span>;
  const styles: Record<string, string> = {
    needs_action: 'bg-orange-100 text-orange-700',
    on_track: 'bg-emerald-100 text-emerald-700',
    at_risk: 'bg-red-100 text-red-700',
    stalled: 'bg-gray-100 text-gray-600',
    no_action_needed: 'bg-blue-100 text-blue-700',
    nurture: 'bg-purple-100 text-purple-700',
  };
  const labels: Record<string, string> = {
    needs_action: 'Needs Action',
    on_track: 'On Track',
    at_risk: 'At Risk',
    stalled: 'Stalled',
    no_action_needed: 'No Action Needed',
    nurture: 'Nurture',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[status] || 'bg-gray-100 text-gray-600'}`}>
      {labels[status] || status}
    </span>
  );
}

function UrgencyBadge({ urgency }: { urgency: string | null }) {
  if (!urgency) return null;
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

function IssueBadge({ issue }: { issue: { type: string; severity: string; message: string } }) {
  const severityStyles: Record<string, string> = {
    critical: 'border-red-300 bg-red-50 text-red-700',
    high: 'border-orange-300 bg-orange-50 text-orange-700',
    medium: 'border-yellow-300 bg-yellow-50 text-yellow-700',
    low: 'border-gray-300 bg-gray-50 text-gray-600',
  };
  const typeIcons: Record<string, string> = {
    hygiene: 'H',
    next_step: 'NS',
    stalled: 'S',
    close_date: 'CD',
    overdue_tasks: 'OT',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs border ${severityStyles[issue.severity] || 'border-gray-300 bg-gray-50'}`}>
      <span className="font-semibold">{typeIcons[issue.type] || '?'}</span>
      <span className="hidden sm:inline">{issue.message}</span>
    </span>
  );
}

function DimensionBar({ label, score, color }: { label: string; score: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500 w-24">{label}</span>
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${score}%` }}
        />
      </div>
      <span className="text-xs font-medium text-gray-700 w-8 text-right">{score}</span>
    </div>
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

const GRADE_ORDER: Record<string, number> = { F: 5, D: 4, C: 3, B: 2, A: 1 };
const URGENCY_ORDER: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

// --- Main Component ---

export function DealHealthView() {
  const [data, setData] = useState<DealIntelligenceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [analyzingDeals, setAnalyzingDeals] = useState<Set<string>>(new Set());

  // Batch analyze state
  const [isBatchAnalyzing, setIsBatchAnalyzing] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{
    current: number;
    total: number;
    successful: number;
    failed: number;
  } | null>(null);
  const batchAbortRef = useRef<AbortController | null>(null);

  const [confirmDialog, setConfirmDialog] = useState<{
    dealIds: string[];
    count: number;
  } | null>(null);

  // View tab
  const [viewTab, setViewTab] = useState<ViewTab>('all');

  // Filters
  const [gradeFilter, setGradeFilter] = useState<GradeFilter>('all');
  const [aeFilter, setAeFilter] = useState<string>('all');
  const [stageFilter, setStageFilter] = useState<string>('all');
  const [issueTypeFilter, setIssueTypeFilter] = useState<string>('all');

  // Sorting
  const [sortColumn, setSortColumn] = useState<SortColumn>('grade');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // --- Data Fetching ---

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/queues/deal-intelligence');
      if (!response.ok) throw new Error('Failed to fetch deal intelligence data');
      const json: DealIntelligenceResponse = await response.json();
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
      if (d.owner_name) names.add(d.owner_name);
    }
    return Array.from(names).sort();
  }, [data]);

  const stageOptions = useMemo(() => {
    return [
      { id: SALES_PIPELINE_STAGES.MQL.id, label: SALES_PIPELINE_STAGES.MQL.label },
      ...ACTIVE_STAGE_OPTIONS,
    ];
  }, []);

  // --- Sorting & Filtering ---

  const processedDeals = useMemo(() => {
    if (!data) return [];

    let result = [...data.deals];

    if (viewTab !== 'all') {
      result = result.filter(d => d.grade_type === viewTab);
    }
    if (gradeFilter !== 'all') {
      result = result.filter(d => d.overall_grade === gradeFilter);
    }
    if (aeFilter !== 'all') {
      result = result.filter(d => d.owner_name === aeFilter);
    }
    if (stageFilter !== 'all') {
      result = result.filter(d => d.stage_id === stageFilter);
    }
    if (issueTypeFilter !== 'all') {
      result = result.filter(d => d.issues.some(i => i.type === issueTypeFilter));
    }

    result.sort((a, b) => {
      let comparison = 0;
      switch (sortColumn) {
        case 'grade':
          comparison = (GRADE_ORDER[a.overall_grade] || 0) - (GRADE_ORDER[b.overall_grade] || 0);
          if (comparison === 0) comparison = a.overall_score - b.overall_score;
          break;
        case 'dealName':
          comparison = (a.deal_name || '').localeCompare(b.deal_name || '');
          break;
        case 'amount':
          comparison = (a.amount || 0) - (b.amount || 0);
          break;
        case 'stage':
          comparison = (a.stage_name || '').localeCompare(b.stage_name || '');
          break;
        case 'closeDate':
          comparison = (a.close_date || '').localeCompare(b.close_date || '');
          break;
        case 'urgency':
          comparison = (URGENCY_ORDER[a.llm_urgency || ''] || 0) - (URGENCY_ORDER[b.llm_urgency || ''] || 0);
          break;
        case 'issues':
          comparison = a.issues.length - b.issues.length;
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [data, viewTab, gradeFilter, aeFilter, stageFilter, issueTypeFilter, sortColumn, sortDirection]);

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  // --- Single deal analysis ---

  const handleAnalyzeDeal = async (dealId: string) => {
    setAnalyzingDeals(prev => new Set(prev).add(dealId));
    try {
      const response = await fetch('/api/queues/deal-intelligence/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dealId }),
      });
      if (response.ok) {
        await fetchData();
      }
    } catch (err) {
      console.error('Analysis failed:', err);
    } finally {
      setAnalyzingDeals(prev => {
        const next = new Set(prev);
        next.delete(dealId);
        return next;
      });
    }
  };

  // --- Batch analysis ---

  const handleBatchAnalyze = () => {
    const dealIds = processedDeals.map(d => d.hubspot_deal_id);
    setConfirmDialog({ dealIds, count: dealIds.length });
  };

  const startBatchAnalyze = async (dealIds: string[]) => {
    setConfirmDialog(null);
    setIsBatchAnalyzing(true);
    setBatchProgress({ current: 0, total: dealIds.length, successful: 0, failed: 0 });

    const abortController = new AbortController();
    batchAbortRef.current = abortController;

    try {
      const response = await fetch('/api/queues/deal-intelligence/batch-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dealIds }),
        signal: abortController.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error('Failed to start batch analysis');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === 'progress') {
              setBatchProgress({
                current: event.index,
                total: event.total,
                successful: (event.status === 'success' ? 1 : 0) + (batchProgress?.successful || 0),
                failed: (event.status === 'error' ? 1 : 0) + (batchProgress?.failed || 0),
              });
            } else if (event.type === 'done') {
              setBatchProgress({
                current: event.processed,
                total: event.processed,
                successful: event.successful,
                failed: event.failed,
              });
            }
          } catch {
            // skip malformed SSE
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.error('Batch analysis error:', err);
      }
    } finally {
      setIsBatchAnalyzing(false);
      batchAbortRef.current = null;
      await fetchData();
    }
  };

  const handleCancelBatch = () => {
    batchAbortRef.current?.abort();
  };

  // --- Compute Rules (Phase 1 only) ---

  const [isComputingRules, setIsComputingRules] = useState(false);

  const handleComputeRules = async () => {
    setIsComputingRules(true);
    try {
      const response = await fetch('/api/cron/compute-deal-intelligence');
      if (response.ok) {
        await fetchData();
      }
    } catch (err) {
      console.error('Rules computation failed:', err);
    } finally {
      setIsComputingRules(false);
    }
  };

  // --- Render ---

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-700">{error}</p>
          <button onClick={fetchData} className="mt-2 text-sm text-red-600 underline">Retry</button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { counts } = data;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Deal Intelligence</h1>
          <p className="text-sm text-gray-500 mt-1">
            {viewTab === 'pre_demo_effort' ? 'Pre-demo AE effort scoring across call cadence, follow-up, tactics, and discipline' :
             viewTab === 'deal_health' ? 'Post-demo deal health across hygiene, momentum, engagement, and risk' :
             'Consolidated deal intelligence — effort grades for pre-demo, health grades for post-demo'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleComputeRules}
            disabled={isComputingRules}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            {isComputingRules ? 'Computing...' : 'Refresh Scores'}
          </button>
          <button
            onClick={handleBatchAnalyze}
            disabled={isBatchAnalyzing || processedDeals.length === 0}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
          >
            {isBatchAnalyzing ? 'Analyzing...' : `Analyze All (${processedDeals.length})`}
          </button>
        </div>
      </div>

      {/* Grade Distribution Bar */}
      <div className="flex gap-2">
        {(['A', 'B', 'C', 'D', 'F'] as const).map((grade) => {
          const count = counts[`grade${grade}` as keyof typeof counts] as number;
          const isActive = gradeFilter === grade;
          const gradeStyles: Record<string, string> = {
            A: isActive ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
            B: isActive ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-700 hover:bg-blue-100',
            C: isActive ? 'bg-yellow-600 text-white' : 'bg-yellow-50 text-yellow-700 hover:bg-yellow-100',
            D: isActive ? 'bg-orange-600 text-white' : 'bg-orange-50 text-orange-700 hover:bg-orange-100',
            F: isActive ? 'bg-red-600 text-white' : 'bg-red-50 text-red-700 hover:bg-red-100',
          };
          return (
            <button
              key={grade}
              onClick={() => setGradeFilter(gradeFilter === grade ? 'all' : grade)}
              className={`flex-1 px-4 py-3 rounded-lg text-center transition-colors ${gradeStyles[grade]}`}
            >
              <div className="text-2xl font-bold">{count}</div>
              <div className="text-xs font-medium">Grade {grade}</div>
            </button>
          );
        })}
      </div>

      {/* View Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
        {([
          ['all', 'All Deals'],
          ['pre_demo_effort', 'Pre-Demo Effort'],
          ['deal_health', 'Post-Demo Health'],
        ] as [ViewTab, string][]).map(([tab, label]) => {
          const count = tab === 'all' ? data.deals.length :
            data.deals.filter(d => d.grade_type === tab).length;
          return (
            <button
              key={tab}
              onClick={() => setViewTab(tab)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                viewTab === tab
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {label} ({count})
            </button>
          );
        })}
      </div>

      {/* Batch Progress */}
      {isBatchAnalyzing && batchProgress && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-indigo-700">
              Analyzing {batchProgress.current}/{batchProgress.total} deals...
            </span>
            <button onClick={handleCancelBatch} className="text-sm text-red-600 hover:underline">Cancel</button>
          </div>
          <div className="w-full h-2 bg-indigo-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-600 rounded-full transition-all"
              style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Confirmation Dialog */}
      {confirmDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-md shadow-xl">
            <h3 className="text-lg font-semibold mb-2">Analyze {confirmDialog.count} deals?</h3>
            <p className="text-sm text-gray-600 mb-4">
              This will run LLM analysis on {confirmDialog.count} deals. Each deal makes one API call.
              Estimated time: ~{Math.ceil(confirmDialog.count * 1.5)} seconds.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmDialog(null)}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => startBatchAnalyze(confirmDialog.dealIds)}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
              >
                Start Analysis
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          value={aeFilter}
          onChange={(e) => setAeFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-300 rounded-lg"
        >
          <option value="all">All AEs</option>
          {aeOptions.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
        <select
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-300 rounded-lg"
        >
          <option value="all">All Stages</option>
          {stageOptions.map(({ id, label }) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </select>
        <select
          value={issueTypeFilter}
          onChange={(e) => setIssueTypeFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-300 rounded-lg"
        >
          <option value="all">All Issues</option>
          <option value="hygiene">Hygiene</option>
          <option value="next_step">Next Step</option>
          <option value="stalled">Stalled</option>
          <option value="close_date">Close Date</option>
        </select>
        <span className="text-sm text-gray-500 self-center ml-auto">
          {processedDeals.length} of {counts.total} deals
          {counts.unanalyzed > 0 && ` (${counts.unanalyzed} unanalyzed)`}
        </span>
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {([
                  ['grade', 'Grade'],
                  ['dealName', 'Deal Name'],
                  ['amount', 'Amount'],
                  ['stage', 'Stage'],
                  ['closeDate', 'Close Date'],
                  ['urgency', 'Status'],
                  ['issues', 'Issues'],
                ] as [SortColumn, string][]).map(([col, label]) => (
                  <th
                    key={col}
                    onClick={() => handleSort(col)}
                    className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                  >
                    <div className="flex items-center gap-1">
                      {label}
                      <SortIcon active={sortColumn === col} direction={sortDirection} />
                    </div>
                  </th>
                ))}
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">AE</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Top Action</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {processedDeals.map((deal) => (
                <React.Fragment key={deal.hubspot_deal_id}>
                  <tr
                    onClick={() => setExpandedRow(expandedRow === deal.hubspot_deal_id ? null : deal.hubspot_deal_id)}
                    className="hover:bg-gray-50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3">
                      <GradeBadge grade={deal.overall_grade} score={deal.overall_score} gradeType={deal.grade_type} />
                    </td>
                    <td className="px-4 py-3 max-w-[200px]">
                      <a
                        href={getHubSpotDealUrl(deal.hubspot_deal_id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="font-medium text-gray-900 text-sm hover:text-indigo-600 transition-colors block truncate"
                      >
                        {deal.deal_name || 'Unnamed'}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {deal.amount ? `$${deal.amount.toLocaleString()}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">
                      {deal.stage_name || '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">
                      {deal.close_date ? new Date(deal.close_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <StatusBadge status={deal.llm_status} />
                        {deal.llm_urgency && <UrgencyBadge urgency={deal.llm_urgency} />}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1 max-w-[200px]">
                        {deal.issues.length === 0 ? (
                          <span className="text-xs text-emerald-600">No issues</span>
                        ) : (
                          <>
                            {deal.issues.slice(0, 2).map((issue, i) => (
                              <IssueBadge key={i} issue={issue} />
                            ))}
                            {deal.issues.length > 2 && (
                              <span className="text-xs text-gray-400">+{deal.issues.length - 2}</span>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">
                      {deal.owner_name || '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 min-w-[300px] line-clamp-2">
                      {deal.top_action || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAnalyzeDeal(deal.hubspot_deal_id);
                        }}
                        disabled={analyzingDeals.has(deal.hubspot_deal_id)}
                        className="px-3 py-1.5 text-xs font-medium rounded-md bg-indigo-50 text-indigo-600 hover:bg-indigo-100 disabled:opacity-50 whitespace-nowrap"
                      >
                        {analyzingDeals.has(deal.hubspot_deal_id) ? (
                          <span className="flex items-center gap-1">
                            <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                            Analyzing...
                          </span>
                        ) : deal.llm_analyzed_at ? 'Re-analyze' : 'Analyze'}
                      </button>
                    </td>
                  </tr>

                  {/* Expanded row detail */}
                  {expandedRow === deal.hubspot_deal_id && (
                    <tr>
                      <td colSpan={10} className="px-6 py-4 bg-gray-50">
                        <ExpandedDealDetail
                          deal={deal}
                          onAnalyze={() => handleAnalyzeDeal(deal.hubspot_deal_id)}
                          isAnalyzing={analyzingDeals.has(deal.hubspot_deal_id)}
                        />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
              {processedDeals.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-gray-500">
                    {data.deals.length === 0
                      ? 'No deal intelligence data yet. Click "Refresh Scores" to compute.'
                      : 'No deals match the current filters.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// --- Expanded Row Detail ---

function ExpandedDealDetail({
  deal,
  onAnalyze,
  isAnalyzing,
}: {
  deal: DealIntelligenceItem;
  onAnalyze: () => void;
  isAnalyzing: boolean;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Left: Dimension Scores */}
      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-gray-700">
          {deal.grade_type === 'pre_demo_effort' ? 'Effort Dimensions' : 'Dimension Scores'}
        </h4>
        {deal.grade_type === 'pre_demo_effort' ? (
          <>
            <DimensionBar label="Call Cadence (25%)" score={deal.hygiene_score} color="bg-blue-500" />
            <DimensionBar label="Follow-up (25%)" score={deal.momentum_score} color="bg-emerald-500" />
            <DimensionBar label="Tactic Mix (30%)" score={deal.engagement_score} color="bg-purple-500" />
            <DimensionBar label="Discipline (20%)" score={deal.risk_score} color="bg-orange-500" />
          </>
        ) : (
          <>
            <DimensionBar label="Hygiene (15%)" score={deal.hygiene_score} color="bg-blue-500" />
            <DimensionBar label="Momentum (30%)" score={deal.momentum_score} color="bg-emerald-500" />
            <DimensionBar label="Engagement (35%)" score={deal.engagement_score} color="bg-purple-500" />
            <DimensionBar label="Risk (20%)" score={deal.risk_score} color="bg-orange-500" />
          </>
        )}
        <div className="pt-2 border-t border-gray-200">
          <DimensionBar label="Overall" score={deal.overall_score} color="bg-indigo-600" />
        </div>

        {/* Pre-demo metrics detail */}
        {deal.grade_type === 'pre_demo_effort' && (
          <div className="pt-3 border-t border-gray-200 space-y-2">
            <h5 className="text-xs font-semibold text-gray-500 uppercase">Effort Metrics</h5>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-lg font-semibold text-gray-900">{deal.total_calls ?? 0}</div>
                <div className="text-xs text-gray-500">Calls</div>
              </div>
              <div>
                <div className="text-lg font-semibold text-gray-900">{deal.connected_calls ?? 0}</div>
                <div className="text-xs text-gray-500">Connected</div>
              </div>
              <div>
                <div className="text-lg font-semibold text-gray-900">{deal.total_outbound_emails ?? 0}</div>
                <div className="text-xs text-gray-500">Outbound Emails</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
              <div>Avg call gap: <span className="font-medium">{deal.avg_call_gap_days != null ? `${deal.avg_call_gap_days}d` : '—'}</span></div>
              <div>Max call gap: <span className="font-medium">{deal.max_call_gap_days != null ? `${deal.max_call_gap_days}d` : '—'}</span></div>
              <div>Hours tried: <span className="font-medium">{deal.distinct_call_hours ?? '—'}</span></div>
              <div>Days tried: <span className="font-medium">{deal.distinct_call_days ?? '—'}</span></div>
              <div>Max touchpoint gap: <span className="font-medium">{deal.max_touchpoint_gap_days != null ? `${deal.max_touchpoint_gap_days}d` : '—'}</span></div>
              <div>Days in pre-demo: <span className="font-medium">{deal.days_in_pre_demo ?? '—'}</span></div>
            </div>
            {deal.sent_gift && (
              <div className="flex items-center gap-1 mt-1">
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700 border border-purple-200">
                  Gift Sent
                </span>
              </div>
            )}
            {deal.tactics_detected && deal.tactics_detected.length > 0 && (
              <div className="mt-2">
                <h6 className="text-xs font-semibold text-gray-500 uppercase mb-1">Tactics Detected</h6>
                <div className="flex flex-wrap gap-1">
                  {deal.tactics_detected.map((tactic) => (
                    <span key={tactic} className="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded text-xs border border-indigo-200">
                      {tactic.replace(/_/g, ' ')}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Activity Summary (post-demo) */}
        {deal.grade_type !== 'pre_demo_effort' && (
          <div className="pt-3 border-t border-gray-200 space-y-1">
            <h5 className="text-xs font-semibold text-gray-500 uppercase">Activity</h5>
            <div className="grid grid-cols-4 gap-2 text-center">
              <div>
                <div className="text-lg font-semibold text-gray-900">{deal.email_count}</div>
                <div className="text-xs text-gray-500">Emails</div>
              </div>
              <div>
                <div className="text-lg font-semibold text-gray-900">{deal.call_count}</div>
                <div className="text-xs text-gray-500">Calls</div>
              </div>
              <div>
                <div className="text-lg font-semibold text-gray-900">{deal.meeting_count}</div>
                <div className="text-xs text-gray-500">Meetings</div>
              </div>
              <div>
                <div className="text-lg font-semibold text-gray-900">{deal.note_count}</div>
                <div className="text-xs text-gray-500">Notes</div>
              </div>
            </div>
            {deal.days_since_activity != null && (
              <p className="text-xs text-gray-500 mt-1">
                {deal.days_since_activity === 0
                  ? 'Active today'
                  : `${deal.days_since_activity} days since last activity`}
                {deal.has_future_activity && ' | Future activity scheduled'}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Middle: Issues */}
      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-gray-700">Issues ({deal.issues.length})</h4>
        {deal.issues.length === 0 ? (
          <p className="text-sm text-emerald-600">No issues found</p>
        ) : (
          <div className="space-y-2">
            {deal.issues.map((issue, i) => (
              <div
                key={i}
                className={`p-2 rounded-lg border text-sm ${
                  issue.severity === 'critical' ? 'border-red-200 bg-red-50' :
                  issue.severity === 'high' ? 'border-orange-200 bg-orange-50' :
                  issue.severity === 'medium' ? 'border-yellow-200 bg-yellow-50' :
                  'border-gray-200 bg-gray-50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-bold uppercase ${
                    issue.severity === 'critical' ? 'text-red-700' :
                    issue.severity === 'high' ? 'text-orange-700' :
                    issue.severity === 'medium' ? 'text-yellow-700' :
                    'text-gray-600'
                  }`}>
                    {issue.severity}
                  </span>
                  <span className="text-xs text-gray-500 uppercase">{issue.type.replace('_', ' ')}</span>
                </div>
                <p className="text-gray-700 mt-0.5">{issue.message}</p>
              </div>
            ))}
          </div>
        )}

        {/* Missing Fields Detail */}
        {deal.missing_fields.length > 0 && (
          <div className="pt-2">
            <h5 className="text-xs font-semibold text-gray-500 uppercase mb-1">Missing Fields</h5>
            <div className="flex flex-wrap gap-1">
              {deal.missing_fields.map((field) => (
                <span key={field} className="px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded text-xs">
                  {field}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Right: LLM Coaching */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-gray-700">AI Coaching</h4>
          <div className="flex items-center gap-2">
            <a
              href={getHubSpotDealUrl(deal.hubspot_deal_id)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-indigo-600 hover:underline"
            >
              HubSpot
            </a>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAnalyze();
              }}
              disabled={isAnalyzing}
              className="px-3 py-1 text-xs font-medium text-white bg-indigo-600 rounded hover:bg-indigo-700 disabled:opacity-50"
            >
              {isAnalyzing ? 'Analyzing...' : deal.llm_analyzed_at ? 'Re-analyze' : 'Analyze'}
            </button>
          </div>
        </div>

        {deal.llm_analyzed_at ? (
          <>
            {deal.recommended_action && (
              <div>
                <h5 className="text-xs font-semibold text-gray-500 uppercase mb-1">Recommended Action</h5>
                <p className="text-sm text-gray-700 whitespace-pre-line">{deal.recommended_action}</p>
              </div>
            )}
            {deal.reasoning && (
              <div>
                <h5 className="text-xs font-semibold text-gray-500 uppercase mb-1">Reasoning</h5>
                <p className="text-sm text-gray-600 whitespace-pre-line">{deal.reasoning}</p>
              </div>
            )}
            {deal.key_risk && (
              <div>
                <h5 className="text-xs font-semibold text-gray-500 uppercase mb-1">Key Risk</h5>
                <p className="text-sm text-red-600">{deal.key_risk}</p>
              </div>
            )}
            <div className="text-xs text-gray-400">
              Analyzed {new Date(deal.llm_analyzed_at).toLocaleString()} | Confidence: {deal.llm_confidence ? `${Math.round(deal.llm_confidence * 100)}%` : '—'}
            </div>
          </>
        ) : (
          <div className="bg-gray-100 rounded-lg p-3 text-center">
            <p className="text-sm text-gray-500 mb-2">Not yet analyzed by AI</p>
            <p className="text-xs text-gray-400">Click &quot;Analyze&quot; to get coaching recommendations</p>
          </div>
        )}
      </div>
    </div>
  );
}
