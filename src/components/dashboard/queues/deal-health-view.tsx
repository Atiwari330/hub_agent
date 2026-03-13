'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getHubSpotDealUrl } from '@/lib/hubspot/urls';
import { ACTIVE_STAGE_OPTIONS, SALES_PIPELINE_STAGES } from '@/lib/hubspot/stage-config';
import type { DealIntelligenceResponse, DealIntelligenceItem } from '@/app/api/queues/deal-intelligence/route';

// --- Types ---

type GradeFilter = 'all' | 'A' | 'B' | 'C' | 'D' | 'F';
type ViewTab = 'pre_demo_effort' | 'deal_health';
type SortColumn = 'grade' | 'topAction' | 'dealName' | 'amount' | 'stage' | 'closeDate' | 'issues';
type SortDirection = 'asc' | 'desc';

interface AESummary {
  ownerName: string;
  ownerId: string;
  avgScore: number;
  avgGrade: string;
  dealCount: number;
  totalCalls: number;
  connectedCalls: number;
  biggestGap: { dimension: string; detail: string };
  deals: DealIntelligenceItem[];
}

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
function computeGrade(score: number): string {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

// --- AE Aggregation ---

function computeAESummaries(deals: DealIntelligenceItem[]): AESummary[] {
  const byOwner = new Map<string, DealIntelligenceItem[]>();
  for (const deal of deals) {
    const name = deal.owner_name || 'Unknown';
    if (!byOwner.has(name)) byOwner.set(name, []);
    byOwner.get(name)!.push(deal);
  }

  const summaries: AESummary[] = [];
  for (const [ownerName, aeDeals] of byOwner) {
    const avgScore = Math.round(aeDeals.reduce((sum, d) => sum + d.overall_score, 0) / aeDeals.length);
    const totalCalls = aeDeals.reduce((sum, d) => sum + (d.total_calls ?? 0), 0);
    const connectedCalls = aeDeals.reduce((sum, d) => sum + (d.connected_calls ?? 0), 0);

    // Compute biggest gap: which dimension has the lowest average score
    const dimAvgs = [
      { key: 'Call cadence', avg: aeDeals.reduce((s, d) => s + d.hygiene_score, 0) / aeDeals.length },
      { key: 'Follow-up regularity', avg: aeDeals.reduce((s, d) => s + d.momentum_score, 0) / aeDeals.length },
      { key: 'Tactic diversity', avg: aeDeals.reduce((s, d) => s + d.engagement_score, 0) / aeDeals.length },
      { key: 'Discipline', avg: aeDeals.reduce((s, d) => s + d.risk_score, 0) / aeDeals.length },
    ];
    const weakest = dimAvgs.reduce((min, d) => d.avg < min.avg ? d : min);

    // Compute a useful detail stat for the weakest dimension
    let detail = `avg score ${Math.round(weakest.avg)}`;
    if (weakest.key === 'Call cadence') {
      const avgCalls = totalCalls / aeDeals.length;
      detail = `avg ${avgCalls.toFixed(1)} calls/deal`;
    } else if (weakest.key === 'Follow-up regularity') {
      const gapDeals = aeDeals.filter(d => d.max_touchpoint_gap_days != null);
      if (gapDeals.length > 0) {
        const avgGap = Math.round(gapDeals.reduce((s, d) => s + (d.max_touchpoint_gap_days ?? 0), 0) / gapDeals.length);
        detail = `avg ${avgGap}d max touchpoint gap`;
      }
    } else if (weakest.key === 'Tactic diversity') {
      const withTactics = aeDeals.filter(d => d.tactics_detected && d.tactics_detected.length > 0);
      detail = `${withTactics.length}/${aeDeals.length} deals use multiple tactics`;
    } else if (weakest.key === 'Discipline') {
      const withNextStep = aeDeals.filter(d => {
        // Check if discipline/risk score is decent (has next steps set)
        return d.risk_score >= 50;
      });
      detail = `${withNextStep.length}/${aeDeals.length} deals have next steps`;
    }

    summaries.push({
      ownerName,
      ownerId: aeDeals[0]?.owner_id || '',
      avgScore,
      avgGrade: computeGrade(avgScore),
      dealCount: aeDeals.length,
      totalCalls,
      connectedCalls,
      biggestGap: { dimension: weakest.key, detail },
      deals: aeDeals.sort((a, b) => a.overall_score - b.overall_score), // worst first
    });
  }

  return summaries.sort((a, b) => a.avgScore - b.avgScore); // worst AE first
}

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

  // View tab - default to pre-demo
  const [viewTab, setViewTab] = useState<ViewTab>('pre_demo_effort');

  // Pre-demo: expanded AE cards
  const [expandedAE, setExpandedAE] = useState<string | null>(null);

  // Post-demo filters
  const [gradeFilter, setGradeFilter] = useState<GradeFilter>('all');
  const [aeFilter, setAeFilter] = useState<string>('all');
  const [stageFilter, setStageFilter] = useState<string>('all');
  const [issueTypeFilter, setIssueTypeFilter] = useState<string>('all');

  // Post-demo sorting
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

  const preDemoDeals = useMemo(() => {
    if (!data) return [];
    return data.deals.filter(d => d.grade_type === 'pre_demo_effort');
  }, [data]);

  const postDemoDeals = useMemo(() => {
    if (!data) return [];
    return data.deals.filter(d => d.grade_type === 'deal_health');
  }, [data]);

  const aeSummaries = useMemo(() => computeAESummaries(preDemoDeals), [preDemoDeals]);

  const aeOptions = useMemo(() => {
    if (!data) return [];
    const names = new Set<string>();
    for (const d of postDemoDeals) {
      if (d.owner_name) names.add(d.owner_name);
    }
    return Array.from(names).sort();
  }, [data, postDemoDeals]);

  const stageOptions = useMemo(() => {
    return [
      { id: SALES_PIPELINE_STAGES.MQL.id, label: SALES_PIPELINE_STAGES.MQL.label },
      ...ACTIVE_STAGE_OPTIONS,
    ];
  }, []);

  // Post-demo grade counts (recalculated for post-demo only)
  const postDemoGradeCounts = useMemo(() => {
    const counts = { A: 0, B: 0, C: 0, D: 0, F: 0 };
    for (const d of postDemoDeals) {
      const g = d.overall_grade as keyof typeof counts;
      if (g in counts) counts[g]++;
    }
    return counts;
  }, [postDemoDeals]);

  // --- Post-demo Sorting & Filtering ---

  const processedPostDemoDeals = useMemo(() => {
    let result = [...postDemoDeals];

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
        case 'topAction':
          comparison = (a.top_action || '').localeCompare(b.top_action || '');
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
        case 'issues':
          comparison = a.issues.length - b.issues.length;
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [postDemoDeals, gradeFilter, aeFilter, stageFilter, issueTypeFilter, sortColumn, sortDirection]);

  // Current tab's deals for batch actions
  const currentTabDeals = viewTab === 'pre_demo_effort' ? preDemoDeals : processedPostDemoDeals;

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
    const dealIds = currentTabDeals.map(d => d.hubspot_deal_id);
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
              setBatchProgress(prev => ({
                current: event.index,
                total: event.total,
                successful: (prev?.successful || 0) + (event.status === 'success' ? 1 : 0),
                failed: (prev?.failed || 0) + (event.status === 'error' ? 1 : 0),
              }));
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

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Deal Intelligence</h1>
          <p className="text-sm text-gray-500 mt-1">
            {viewTab === 'pre_demo_effort'
              ? 'How hard are your AEs working pre-demo deals?'
              : 'Post-demo deal health across hygiene, momentum, engagement, and risk'}
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
            disabled={isBatchAnalyzing || currentTabDeals.length === 0}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
          >
            {isBatchAnalyzing ? 'Analyzing...' : `Analyze All (${currentTabDeals.length})`}
          </button>
        </div>
      </div>

      {/* View Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
        {([
          ['pre_demo_effort', 'AE Effort (Pre-Demo)'],
          ['deal_health', 'Deal Health (Post-Demo)'],
        ] as [ViewTab, string][]).map(([tab, label]) => {
          const count = tab === 'pre_demo_effort' ? preDemoDeals.length : postDemoDeals.length;
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

      {/* Tab Content */}
      {viewTab === 'pre_demo_effort' ? (
        <PreDemoEffortView
          aeSummaries={aeSummaries}
          expandedAE={expandedAE}
          setExpandedAE={setExpandedAE}
          expandedRow={expandedRow}
          setExpandedRow={setExpandedRow}
          analyzingDeals={analyzingDeals}
          onAnalyzeDeal={handleAnalyzeDeal}
        />
      ) : (
        <PostDemoHealthView
          deals={processedPostDemoDeals}
          totalCount={postDemoDeals.length}
          gradeCounts={postDemoGradeCounts}
          gradeFilter={gradeFilter}
          setGradeFilter={setGradeFilter}
          aeFilter={aeFilter}
          setAeFilter={setAeFilter}
          aeOptions={aeOptions}
          stageFilter={stageFilter}
          setStageFilter={setStageFilter}
          stageOptions={stageOptions}
          issueTypeFilter={issueTypeFilter}
          setIssueTypeFilter={setIssueTypeFilter}
          sortColumn={sortColumn}
          sortDirection={sortDirection}
          onSort={handleSort}
          expandedRow={expandedRow}
          setExpandedRow={setExpandedRow}
          analyzingDeals={analyzingDeals}
          onAnalyzeDeal={handleAnalyzeDeal}
        />
      )}
    </div>
  );
}

// --- Pre-Demo Effort View ---

function PreDemoEffortView({
  aeSummaries,
  expandedAE,
  setExpandedAE,
  expandedRow,
  setExpandedRow,
  analyzingDeals,
  onAnalyzeDeal,
}: {
  aeSummaries: AESummary[];
  expandedAE: string | null;
  setExpandedAE: (ae: string | null) => void;
  expandedRow: string | null;
  setExpandedRow: (id: string | null) => void;
  analyzingDeals: Set<string>;
  onAnalyzeDeal: (dealId: string) => void;
}) {
  if (aeSummaries.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-12 text-center text-gray-500">
        No pre-demo deals found. Click &quot;Refresh Scores&quot; to compute.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {aeSummaries.map((ae) => {
        const isExpanded = expandedAE === ae.ownerName;
        const gradeStyles: Record<string, string> = {
          A: 'border-emerald-200 bg-emerald-50',
          B: 'border-blue-200 bg-blue-50',
          C: 'border-yellow-200 bg-yellow-50',
          D: 'border-orange-200 bg-orange-50',
          F: 'border-red-200 bg-red-50',
        };
        const gradeTextStyles: Record<string, string> = {
          A: 'text-emerald-700',
          B: 'text-blue-700',
          C: 'text-yellow-700',
          D: 'text-orange-700',
          F: 'text-red-700',
        };

        return (
          <div key={ae.ownerName} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            {/* AE Summary Card */}
            <button
              onClick={() => setExpandedAE(isExpanded ? null : ae.ownerName)}
              className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors text-left"
            >
              <div className="flex items-center gap-6">
                <div className="flex flex-col items-center">
                  <span className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-lg font-bold border ${gradeStyles[ae.avgGrade] || 'border-gray-200 bg-gray-50'} ${gradeTextStyles[ae.avgGrade] || 'text-gray-700'}`}>
                    {ae.avgGrade}
                    <span className="text-sm font-normal opacity-70">{ae.avgScore}</span>
                  </span>
                  <span className="text-[10px] text-gray-400 mt-0.5">Avg Effort</span>
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">{ae.ownerName}</h3>
                  <div className="flex items-center gap-4 mt-1 text-sm text-gray-500">
                    <span>{ae.dealCount} deals</span>
                    <span>{ae.totalCalls} calls</span>
                    <span>{ae.connectedCalls} connected</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className="text-xs text-gray-400 uppercase font-medium">Biggest gap</div>
                  <div className="text-sm font-medium text-gray-700">{ae.biggestGap.dimension}</div>
                  <div className="text-xs text-gray-500">{ae.biggestGap.detail}</div>
                </div>
                <svg
                  className={`w-5 h-5 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </button>

            {/* Expanded Deal List */}
            {isExpanded && (
              <div className="border-t border-gray-200">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-100">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Grade</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Deal Name</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Stage</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Calls</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Connected</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Max Gap</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Days in Pre-Demo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {ae.deals.map((deal) => (
                        <React.Fragment key={deal.hubspot_deal_id}>
                          <tr
                            onClick={() => setExpandedRow(expandedRow === deal.hubspot_deal_id ? null : deal.hubspot_deal_id)}
                            className="hover:bg-gray-50 cursor-pointer transition-colors"
                          >
                            <td className="px-4 py-2.5">
                              <GradeBadge grade={deal.overall_grade} score={deal.overall_score} gradeType={deal.grade_type} />
                            </td>
                            <td className="px-4 py-2.5 max-w-[250px]">
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
                            <td className="px-4 py-2.5 text-sm text-gray-700 whitespace-nowrap">
                              {deal.stage_name || '—'}
                            </td>
                            <td className="px-4 py-2.5 text-sm text-gray-700">
                              {deal.total_calls ?? 0}
                            </td>
                            <td className="px-4 py-2.5 text-sm text-gray-700">
                              {deal.connected_calls ?? 0}
                            </td>
                            <td className="px-4 py-2.5 text-sm text-gray-700">
                              {deal.max_touchpoint_gap_days != null ? `${deal.max_touchpoint_gap_days}d` : '—'}
                            </td>
                            <td className="px-4 py-2.5 text-sm text-gray-700">
                              {deal.days_in_pre_demo != null ? `${deal.days_in_pre_demo}d` : '—'}
                            </td>
                          </tr>

                          {/* Expanded deal detail */}
                          {expandedRow === deal.hubspot_deal_id && (
                            <tr>
                              <td colSpan={7} className="px-6 py-4 bg-gray-50">
                                <ExpandedDealDetail
                                  deal={deal}
                                  onAnalyze={() => onAnalyzeDeal(deal.hubspot_deal_id)}
                                  isAnalyzing={analyzingDeals.has(deal.hubspot_deal_id)}
                                />
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// --- Post-Demo Health View ---

function PostDemoHealthView({
  deals,
  totalCount,
  gradeCounts,
  gradeFilter,
  setGradeFilter,
  aeFilter,
  setAeFilter,
  aeOptions,
  stageFilter,
  setStageFilter,
  stageOptions,
  issueTypeFilter,
  setIssueTypeFilter,
  sortColumn,
  sortDirection,
  onSort,
  expandedRow,
  setExpandedRow,
  analyzingDeals,
  onAnalyzeDeal,
}: {
  deals: DealIntelligenceItem[];
  totalCount: number;
  gradeCounts: Record<string, number>;
  gradeFilter: GradeFilter;
  setGradeFilter: (f: GradeFilter) => void;
  aeFilter: string;
  setAeFilter: (f: string) => void;
  aeOptions: string[];
  stageFilter: string;
  setStageFilter: (f: string) => void;
  stageOptions: { id: string; label: string }[];
  issueTypeFilter: string;
  setIssueTypeFilter: (f: string) => void;
  sortColumn: SortColumn;
  sortDirection: SortDirection;
  onSort: (col: SortColumn) => void;
  expandedRow: string | null;
  setExpandedRow: (id: string | null) => void;
  analyzingDeals: Set<string>;
  onAnalyzeDeal: (dealId: string) => void;
}) {
  return (
    <>
      {/* Grade Distribution Bar */}
      <div className="flex gap-2">
        {(['A', 'B', 'C', 'D', 'F'] as const).map((grade) => {
          const count = gradeCounts[grade] || 0;
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
          {deals.length} of {totalCount} deals
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
                  ['topAction', 'Top Action'],
                  ['dealName', 'Deal Name'],
                  ['amount', 'Amount'],
                  ['stage', 'Stage'],
                  ['closeDate', 'Close Date'],
                  ['issues', 'Issues'],
                ] as [SortColumn, string][]).map(([col, label]) => (
                  <th
                    key={col}
                    onClick={() => onSort(col)}
                    className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                  >
                    <div className="flex items-center gap-1">
                      {label}
                      <SortIcon active={sortColumn === col} direction={sortDirection} />
                    </div>
                  </th>
                ))}
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">AE</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {deals.map((deal) => (
                <React.Fragment key={deal.hubspot_deal_id}>
                  <tr
                    onClick={() => setExpandedRow(expandedRow === deal.hubspot_deal_id ? null : deal.hubspot_deal_id)}
                    className="hover:bg-gray-50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3">
                      <GradeBadge grade={deal.overall_grade} score={deal.overall_score} gradeType={deal.grade_type} />
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700 min-w-[250px]">
                      <span className="line-clamp-2">{deal.top_action || '—'}</span>
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
                      <div className="flex flex-col gap-1 max-w-[250px]">
                        {deal.issues.length === 0 ? (
                          <span className="text-xs text-emerald-600">No issues</span>
                        ) : (
                          <>
                            {deal.issues.slice(0, 2).map((issue, i) => (
                              <span
                                key={i}
                                className={`text-xs ${
                                  issue.severity === 'critical' ? 'text-red-700' :
                                  issue.severity === 'high' ? 'text-orange-700' :
                                  issue.severity === 'medium' ? 'text-yellow-700' :
                                  'text-gray-600'
                                }`}
                              >
                                {issue.message}
                              </span>
                            ))}
                            {deal.issues.length > 2 && (
                              <span className="text-xs text-gray-400">+{deal.issues.length - 2} more</span>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">
                      {deal.owner_name || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onAnalyzeDeal(deal.hubspot_deal_id);
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
                      <td colSpan={9} className="px-6 py-4 bg-gray-50">
                        <ExpandedDealDetail
                          deal={deal}
                          onAnalyze={() => onAnalyzeDeal(deal.hubspot_deal_id)}
                          isAnalyzing={analyzingDeals.has(deal.hubspot_deal_id)}
                        />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
              {deals.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-gray-500">
                    No deals match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
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

      {/* Middle: Issues & Status */}
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

        {/* Status (moved here from table column) */}
        {deal.llm_status && (
          <div className="pt-2 border-t border-gray-200">
            <h5 className="text-xs font-semibold text-gray-500 uppercase mb-1">Status</h5>
            <div className="flex items-center gap-2">
              <StatusBadge status={deal.llm_status} />
              {deal.llm_urgency && <UrgencyBadge urgency={deal.llm_urgency} />}
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
