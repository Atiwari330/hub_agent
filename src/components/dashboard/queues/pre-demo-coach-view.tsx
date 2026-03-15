'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { formatCurrency } from '@/lib/utils/currency';
import { getHubSpotDealUrl } from '@/lib/hubspot/urls';

// ===== Types =====

interface PreDemoCoachAnalysis {
  hubspot_deal_id: string;
  situation: string;
  next_action: string;
  follow_up: string | null;
  reasoning: string | null;
  confidence: number;
  call_count: number;
  email_count: number;
  meeting_count: number;
  note_count: number;
  is_ppl: boolean;
  ppl_compliance: number | null;
  ppl_compliant_days: number | null;
  ppl_total_days: number | null;
  deal_name: string | null;
  stage_name: string | null;
  days_in_stage: number | null;
  owner_id: string | null;
  owner_name: string | null;
  amount: number | null;
  lead_source: string | null;
  analyzed_at: string;
}

interface PreDemoCoachDeal {
  id: string;
  hubspotDealId: string;
  dealName: string;
  amount: number | null;
  stageName: string;
  stageId: string;
  ownerName: string;
  ownerId: string;
  closeDate: string | null;
  lastActivityDate: string | null;
  nextStep: string | null;
  hubspotCreatedAt: string | null;
  leadSource: string | null;
  daysInCurrentStage: number;
  daysSinceActivity: number;
  dealAgeDays: number;
  analysis: PreDemoCoachAnalysis | null;
}

interface PreDemoCoachOwner {
  id: string;
  name: string;
}

interface PreDemoCoachResponse {
  deals: PreDemoCoachDeal[];
  owners: PreDemoCoachOwner[];
  counts: {
    total: number;
    analyzed: number;
    unanalyzed: number;
  };
}

type SortColumn = 'dealName' | 'ownerName' | 'stageName' | 'daysInCurrentStage' | 'amount' | 'analyzedAt';
type SortDirection = 'asc' | 'desc';

// ===== Helpers =====

function Spinner() {
  return (
    <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function formatAnalyzedAt(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return `Today ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`;
  }
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function PplBadge({ compliance }: { compliance: number | null }) {
  const pct = compliance !== null ? Math.round(compliance * 100) : null;
  let colorClass = 'bg-gray-100 text-gray-600';
  if (pct !== null) {
    if (pct >= 80) colorClass = 'bg-emerald-100 text-emerald-700';
    else if (pct >= 50) colorClass = 'bg-amber-100 text-amber-700';
    else colorClass = 'bg-red-100 text-red-700';
  }

  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${colorClass}`}>
      PPL{pct !== null ? ` ${pct}%` : ''}
    </span>
  );
}

// ===== Main Component =====

export function PreDemoCoachView() {
  // Data state
  const [data, setData] = useState<PreDemoCoachResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter/sort state
  const [aeFilter, setAeFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState<Set<string>>(new Set());
  const [sourceDropdownOpen, setSourceDropdownOpen] = useState(false);
  const [sortColumn, setSortColumn] = useState<SortColumn>('daysInCurrentStage');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Expand state
  const [expandedDealId, setExpandedDealId] = useState<string | null>(null);

  // Analysis state
  const [analyzingDeals, setAnalyzingDeals] = useState<Set<string>>(new Set());
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number; currentDeal: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Computed counts (account for live updates)
  const counts = useMemo(() => {
    if (!data) return { total: 0, analyzed: 0, unanalyzed: 0 };
    const total = data.deals.length;
    const analyzed = data.deals.filter((d) => d.analysis).length;
    return { total, analyzed, unanalyzed: total - analyzed };
  }, [data]);

  // Extract unique lead sources for filter dropdown
  const uniqueSources = useMemo(() => {
    if (!data) return [];
    const sources = new Map<string, number>();
    for (const deal of data.deals) {
      const src = deal.leadSource || 'No Source';
      sources.set(src, (sources.get(src) || 0) + 1);
    }
    return Array.from(sources.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);

  // Client-side filtering + sorting
  const filteredDeals = useMemo(() => {
    if (!data) return [];

    let deals = data.deals;

    if (aeFilter !== 'all') {
      deals = deals.filter((d) => d.ownerId === aeFilter);
    }

    if (sourceFilter.size > 0) {
      deals = deals.filter((d) => {
        const src = d.leadSource || 'No Source';
        return sourceFilter.has(src);
      });
    }

    deals = [...deals].sort((a, b) => {
      let comparison = 0;
      switch (sortColumn) {
        case 'dealName':
          comparison = a.dealName.localeCompare(b.dealName);
          break;
        case 'ownerName':
          comparison = a.ownerName.localeCompare(b.ownerName);
          break;
        case 'stageName':
          comparison = a.stageName.localeCompare(b.stageName);
          break;
        case 'daysInCurrentStage':
          comparison = a.daysInCurrentStage - b.daysInCurrentStage;
          break;
        case 'amount':
          comparison = (a.amount || 0) - (b.amount || 0);
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

    return deals;
  }, [data, aeFilter, sourceFilter, sortColumn, sortDirection]);

  // Fetch data
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/queues/pre-demo-coach');
      if (!response.ok) throw new Error('Failed to fetch deals');
      const json: PreDemoCoachResponse = await response.json();
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

  // Sort handler
  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  // Single deal analysis
  const handleAnalyze = useCallback(async (dealId: string) => {
    setAnalyzingDeals((prev) => new Set(prev).add(dealId));
    try {
      const response = await fetch('/api/queues/pre-demo-coach/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dealId }),
      });
      if (!response.ok) throw new Error('Analysis failed');
      const result = await response.json();
      if (result.analysis) {
        setData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            deals: prev.deals.map((d) =>
              d.hubspotDealId === dealId ? { ...d, analysis: result.analysis } : d
            ),
          };
        });
      }
    } catch (err) {
      console.error('Failed to analyze deal:', err);
    } finally {
      setAnalyzingDeals((prev) => {
        const next = new Set(prev);
        next.delete(dealId);
        return next;
      });
    }
  }, []);

  // Batch analysis
  const handleBatchAnalyze = useCallback(
    async (reanalyze: boolean) => {
      if (!data) return;

      const dealIds = reanalyze
        ? filteredDeals.map((d) => d.hubspotDealId)
        : filteredDeals.filter((d) => !d.analysis).map((d) => d.hubspotDealId);

      if (dealIds.length === 0) return;

      setAnalyzing(true);
      setProgress({ current: 0, total: dealIds.length, currentDeal: '' });

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch('/api/queues/pre-demo-coach/batch-analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dealIds }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          const errorBody = await response.text().catch(() => 'no body');
          console.error('Batch analyze response:', response.status, errorBody);
          throw new Error(`Batch analysis failed: ${response.status}`);
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
            const dataStr = line.replace(/^data: /, '').trim();
            if (!dataStr) continue;

            try {
              const event = JSON.parse(dataStr);

              if (event.type === 'progress') {
                setProgress({
                  current: event.index,
                  total: event.total,
                  currentDeal: event.dealName,
                });

                if (event.status === 'success' && event.analysis) {
                  setData((prev) => {
                    if (!prev) return prev;
                    return {
                      ...prev,
                      deals: prev.deals.map((d) =>
                        d.hubspotDealId === event.dealId ? { ...d, analysis: event.analysis } : d
                      ),
                    };
                  });
                }
              }
            } catch {
              // Skip malformed events
            }
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          console.error('Batch analysis error:', err);
        }
      } finally {
        setAnalyzing(false);
        setProgress(null);
        abortRef.current = null;
      }
    },
    [data, filteredDeals]
  );

  const handleCancel = () => {
    abortRef.current?.abort();
  };

  // Render
  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="flex items-center gap-3 text-gray-500">
          <Spinner />
          <span>Loading pre-demo deals...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800 font-medium">Error loading pre-demo coach queue</p>
          <p className="text-red-600 text-sm mt-1">{error}</p>
          <button onClick={fetchData} className="mt-3 px-4 py-2 bg-red-600 text-white rounded text-sm hover:bg-red-700">
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  // Compute filtered counts for AE filter
  const filteredCounts = {
    total: filteredDeals.length,
    analyzed: filteredDeals.filter((d) => d.analysis).length,
    unanalyzed: filteredDeals.filter((d) => !d.analysis).length,
  };

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Pre-Demo Coach Queue</h1>
        <p className="text-sm text-gray-500 mt-1">
          {counts.total} deals &middot; {counts.analyzed} analyzed &middot; {counts.unanalyzed} pending
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {/* Analyze buttons */}
        {!analyzing ? (
          <>
            {filteredCounts.unanalyzed > 0 && (
              <button
                onClick={() => handleBatchAnalyze(false)}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
              >
                Analyze All ({filteredCounts.unanalyzed})
              </button>
            )}
            {filteredCounts.analyzed > 0 && (
              <button
                onClick={() => handleBatchAnalyze(true)}
                className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
              >
                Re-analyze All ({filteredCounts.total})
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

        {/* Lead Source Filter (multi-select) */}
        <div className="relative">
          <button
            onClick={() => setSourceDropdownOpen((prev) => !prev)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white flex items-center gap-2 min-w-[140px]"
          >
            <span className="truncate">
              {sourceFilter.size === 0
                ? 'All Sources'
                : sourceFilter.size === 1
                  ? Array.from(sourceFilter)[0]
                  : `${sourceFilter.size} sources`}
            </span>
            <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {sourceDropdownOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setSourceDropdownOpen(false)} />
              <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 min-w-[220px] max-h-[300px] overflow-y-auto">
                {sourceFilter.size > 0 && (
                  <button
                    onClick={() => setSourceFilter(new Set())}
                    className="w-full px-3 py-2 text-left text-xs text-indigo-600 hover:bg-indigo-50 border-b border-gray-100"
                  >
                    Clear all
                  </button>
                )}
                {uniqueSources.map((s) => {
                  const isChecked = sourceFilter.has(s.name);
                  return (
                    <label
                      key={s.name}
                      className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {
                          setSourceFilter((prev) => {
                            const next = new Set(prev);
                            if (isChecked) next.delete(s.name);
                            else next.add(s.name);
                            return next;
                          });
                        }}
                        className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="flex-1 truncate">{s.name}</span>
                      <span className="text-xs text-gray-400">{s.count}</span>
                    </label>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* AE Filter */}
        <select
          value={aeFilter}
          onChange={(e) => setAeFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
        >
          <option value="all">All AEs</option>
          {data.owners.map((owner) => (
            <option key={owner.id} value={owner.id}>
              {owner.name}
            </option>
          ))}
        </select>

        {/* Refresh */}
        <button
          onClick={fetchData}
          disabled={loading}
          className="p-2 text-gray-400 hover:text-gray-600 transition-colors"
          title="Refresh"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      {/* Progress bar */}
      {analyzing && progress && (
        <div className="mb-4 bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-3">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-indigo-700 font-medium">
              Analyzing {progress.current}/{progress.total}
            </span>
            <span className="text-indigo-500 truncate max-w-[300px]">{progress.currentDeal}</span>
          </div>
          <div className="w-full bg-indigo-100 rounded-full h-2">
            <div
              className="bg-indigo-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${(progress.current / progress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {/* Header row */}
        <div className="grid grid-cols-[1fr_120px_110px_80px_90px_90px] gap-2 px-6 py-3 bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-500 uppercase tracking-wider">
          <SortHeader label="Deal" column="dealName" current={sortColumn} direction={sortDirection} onSort={handleSort} />
          <SortHeader label="AE" column="ownerName" current={sortColumn} direction={sortDirection} onSort={handleSort} />
          <SortHeader label="Stage" column="stageName" current={sortColumn} direction={sortDirection} onSort={handleSort} />
          <SortHeader label="Days" column="daysInCurrentStage" current={sortColumn} direction={sortDirection} onSort={handleSort} />
          <SortHeader label="Amount" column="amount" current={sortColumn} direction={sortDirection} onSort={handleSort} />
          <SortHeader label="Analyzed" column="analyzedAt" current={sortColumn} direction={sortDirection} onSort={handleSort} />
        </div>

        {/* Deal rows */}
        {filteredDeals.length === 0 ? (
          <div className="px-6 py-12 text-center text-gray-400">
            No pre-demo deals found{aeFilter !== 'all' ? ' for this AE' : ''}.
          </div>
        ) : (
          filteredDeals.map((deal) => {
            const a = deal.analysis;
            const isExpanded = expandedDealId === deal.id;
            const isAnalyzing = analyzingDeals.has(deal.hubspotDealId);
            const isPpl = a?.is_ppl || (deal.leadSource && deal.leadSource.toLowerCase().includes('paid'));

            return (
              <div
                key={deal.id}
                className={`border-b border-gray-100 ${isExpanded ? 'bg-white' : 'hover:bg-gray-50'} transition-colors cursor-pointer`}
                onClick={() => setExpandedDealId(isExpanded ? null : deal.id)}
              >
                {/* Main row */}
                <div className="px-6 py-4">
                  {/* Line 1: Metadata */}
                  <div className="grid grid-cols-[1fr_120px_110px_80px_90px_90px] gap-2 items-center">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-medium text-gray-900 truncate">{deal.dealName}</span>
                      {isPpl && <PplBadge compliance={a?.ppl_compliance ?? null} />}
                    </div>
                    <div className="text-sm text-gray-600 truncate">{deal.ownerName}</div>
                    <div className="text-sm text-gray-600">{deal.stageName}</div>
                    <div className="text-sm text-gray-600">{deal.daysInCurrentStage}d</div>
                    <div className="text-sm text-gray-600">{deal.amount ? formatCurrency(deal.amount) : '-'}</div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400">
                        {a?.analyzed_at ? formatAnalyzedAt(a.analyzed_at) : '-'}
                      </span>
                      {/* Analyze button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAnalyze(deal.hubspotDealId);
                        }}
                        disabled={isAnalyzing}
                        className={`text-xs px-2.5 py-1 rounded transition-colors disabled:opacity-50 ${
                          a
                            ? 'text-gray-400 hover:text-indigo-600 hover:bg-indigo-50'
                            : 'bg-indigo-600 text-white hover:bg-indigo-700'
                        }`}
                        title={a ? 'Re-analyze this deal' : 'Analyze this deal'}
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
                        ) : (
                          'Analyze'
                        )}
                      </button>
                      {/* Expand chevron */}
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

                  {/* Line 2-4: SITUATION / NEXT / FOLLOW-UP */}
                  <div className="mt-3 space-y-2.5 ml-0">
                    <div>
                      <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Situation </span>
                      <span className="text-sm text-gray-600 leading-relaxed">
                        {a ? a.situation : (
                          <span className="text-gray-400 italic">{deal.nextStep || 'Not analyzed'}</span>
                        )}
                      </span>
                    </div>

                    {a && (
                      <div>
                        <span className="text-[11px] font-semibold text-indigo-500 uppercase tracking-wide">Next </span>
                        <span className="text-sm font-medium text-gray-800 leading-relaxed">
                          {a.next_action}
                        </span>
                      </div>
                    )}

                    {a?.follow_up && (
                      <div>
                        <span className="text-[11px] font-semibold text-amber-600 uppercase tracking-wide">Follow-up </span>
                        <span className="text-sm text-gray-700 leading-relaxed">
                          {a.follow_up}
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
                        {a.reasoning && (
                          <div>
                            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Reasoning</h4>
                            <p className="text-sm text-gray-700 leading-relaxed">{a.reasoning}</p>
                          </div>
                        )}

                        {/* Engagement counts */}
                        <div>
                          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Engagement Activity</h4>
                          <div className="flex gap-4 text-sm">
                            <div className="flex items-center gap-1.5">
                              <span className="text-gray-400">Calls:</span>
                              <span className="font-medium text-gray-700">{a.call_count}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-gray-400">Emails:</span>
                              <span className="font-medium text-gray-700">{a.email_count}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-gray-400">Meetings:</span>
                              <span className="font-medium text-gray-700">{a.meeting_count}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-gray-400">Notes:</span>
                              <span className="font-medium text-gray-700">{a.note_count}</span>
                            </div>
                          </div>
                        </div>

                        {/* PPL Compliance card */}
                        {a.is_ppl && (
                          <div>
                            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">PPL Call Compliance</h4>
                            <div className={`rounded-lg p-3 border ${
                              a.ppl_compliance !== null && a.ppl_compliance >= 0.8
                                ? 'bg-emerald-50 border-emerald-200'
                                : a.ppl_compliance !== null && a.ppl_compliance >= 0.5
                                  ? 'bg-amber-50 border-amber-200'
                                  : 'bg-red-50 border-red-200'
                            }`}>
                              <div className="flex items-center gap-2 text-sm">
                                <span className="font-medium">
                                  {a.ppl_compliant_days ?? 0} / {a.ppl_total_days ?? 0} days compliant
                                </span>
                                <span className="text-gray-500">
                                  ({a.ppl_compliance !== null ? `${Math.round(a.ppl_compliance * 100)}%` : 'N/A'})
                                </span>
                              </div>
                              <p className="text-xs text-gray-500 mt-1">
                                Requirement: 2 calls/day during the first 7 days
                              </p>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Right column: Metadata */}
                      <div className="space-y-3">
                        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Deal Details</h4>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                          <div className="text-gray-500">Stage</div>
                          <div className="text-gray-900">{a.stage_name || deal.stageName}</div>

                          <div className="text-gray-500">Days in Stage</div>
                          <div className="text-gray-900">{a.days_in_stage ?? deal.daysInCurrentStage}</div>

                          <div className="text-gray-500">Amount</div>
                          <div className="text-gray-900">{deal.amount ? formatCurrency(deal.amount) : 'N/A'}</div>

                          <div className="text-gray-500">Close Date</div>
                          <div className="text-gray-900">{formatDate(deal.closeDate)}</div>

                          <div className="text-gray-500">Lead Source</div>
                          <div className="text-gray-900">{deal.leadSource || 'N/A'}</div>

                          <div className="text-gray-500">Deal Age</div>
                          <div className="text-gray-900">{deal.dealAgeDays} days</div>

                          <div className="text-gray-500">Last Activity</div>
                          <div className="text-gray-900">
                            {deal.daysSinceActivity > 0 ? `${deal.daysSinceActivity}d ago` : 'Today'}
                          </div>

                          <div className="text-gray-500">Next Step</div>
                          <div className="text-gray-900 truncate" title={deal.nextStep || undefined}>
                            {deal.nextStep || 'N/A'}
                          </div>

                          <div className="text-gray-500">Created</div>
                          <div className="text-gray-900">{formatDate(deal.hubspotCreatedAt)}</div>

                          <div className="text-gray-500">Confidence</div>
                          <div className="text-gray-900">{(a.confidence * 100).toFixed(0)}%</div>

                          <div className="text-gray-500">Analyzed</div>
                          <div className="text-gray-900">{new Date(a.analyzed_at).toLocaleString()}</div>
                        </div>

                        {/* HubSpot link */}
                        <div className="pt-2">
                          <a
                            href={getHubSpotDealUrl(deal.hubspotDealId)}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-orange-50 text-orange-700 rounded text-xs font-medium hover:bg-orange-100 transition-colors"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                            HubSpot
                          </a>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Expanded but not analyzed */}
                {isExpanded && !a && (
                  <div className="px-6 pb-5 pt-3 bg-gray-50 border-t border-gray-100">
                    <p className="text-sm text-gray-400 italic">
                      This deal has not been analyzed yet. Click &quot;Analyze&quot; to run AI coaching analysis.
                    </p>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ===== Sort Header Component =====

function SortHeader({
  label,
  column,
  current,
  direction,
  onSort,
}: {
  label: string;
  column: SortColumn;
  current: SortColumn;
  direction: SortDirection;
  onSort: (col: SortColumn) => void;
}) {
  const isActive = current === column;
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onSort(column);
      }}
      className="flex items-center gap-1 hover:text-gray-700 transition-colors"
    >
      <span>{label}</span>
      {isActive && (
        <span className="text-indigo-600">
          {direction === 'asc' ? '\u2191' : '\u2193'}
        </span>
      )}
    </button>
  );
}
