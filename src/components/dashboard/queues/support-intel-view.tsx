'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getHubSpotTicketUrl, getHubSpotCompanyUrl } from '@/lib/hubspot/urls';
import type {
  SupportIntelResponse,
  TicketCategorizationResponse,
} from '@/app/api/queues/support-intel/route';
import type { TrendsResponse } from '@/app/api/queues/support-intel/trends/route';
import type { SupportIntelSummary } from '@/app/api/queues/support-intel/summary/route';

// --- Types ---

type SortColumn =
  | 'companyName'
  | 'subject'
  | 'category'
  | 'issueType'
  | 'severity'
  | 'ageDays'
  | 'status';
type SortDirection = 'asc' | 'desc';
type StatusFilter = 'all' | 'categorized' | 'uncategorized';

// --- Helper Components ---

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

function SeverityBadge({ severity }: { severity: string }) {
  const styles: Record<string, string> = {
    critical: 'bg-red-100 text-red-700',
    high: 'bg-orange-100 text-orange-700',
    medium: 'bg-yellow-100 text-yellow-700',
    low: 'bg-gray-100 text-gray-600',
  };

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[severity] || 'bg-gray-100 text-gray-600'}`}>
      {severity.charAt(0).toUpperCase() + severity.slice(1)}
    </span>
  );
}

function IssueTypeBadge({ issueType }: { issueType: string }) {
  const labels: Record<string, string> = {
    bug: 'Bug',
    feature_request: 'Feature Request',
    how_to: 'How-To',
    configuration: 'Configuration',
    data_issue: 'Data Issue',
    access_issue: 'Access Issue',
    integration: 'Integration',
    performance: 'Performance',
  };

  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-600">
      {labels[issueType] || issueType}
    </span>
  );
}

function CategoryBar({ name, count, maxCount, onClick }: { name: string; count: number; maxCount: number; onClick: () => void }) {
  const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
  return (
    <button onClick={onClick} className="w-full flex items-center gap-3 py-1.5 hover:bg-slate-50 rounded px-2 transition-colors text-left">
      <span className="text-sm text-gray-700 truncate w-48 flex-shrink-0">{name}</span>
      <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
        <div className="bg-indigo-500 h-full rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-sm font-medium text-gray-600 w-10 text-right flex-shrink-0">{count}</span>
    </button>
  );
}

// --- Main Component ---

export function SupportIntelView() {
  const [data, setData] = useState<SupportIntelResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [analyzingTickets, setAnalyzingTickets] = useState<Set<string>>(new Set());

  // Trends state
  const [trends, setTrends] = useState<TrendsResponse | null>(null);
  const [trendsLoading, setTrendsLoading] = useState(false);

  // Summary state
  const [summary, setSummary] = useState<SupportIntelSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [generatingSummary, setGeneratingSummary] = useState(false);

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
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [issueTypeFilter, setIssueTypeFilter] = useState<string>('all');
  const [companyFilter, setCompanyFilter] = useState<string>('all');
  const [closedFilter, setClosedFilter] = useState<string>('all');

  // Sorting
  const [sortColumn, setSortColumn] = useState<SortColumn>('ageDays');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // --- Data Fetching ---

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/queues/support-intel');
      if (!response.ok) throw new Error('Failed to fetch support intel data');
      const json: SupportIntelResponse = await response.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchTrends = useCallback(async () => {
    try {
      setTrendsLoading(true);
      const response = await fetch('/api/queues/support-intel/trends?period=weekly&weeks=8');
      if (!response.ok) return;
      const json: TrendsResponse = await response.json();
      setTrends(json);
    } catch {
      // Non-critical
    } finally {
      setTrendsLoading(false);
    }
  }, []);

  const fetchSummary = useCallback(async () => {
    try {
      setSummaryLoading(true);
      const response = await fetch('/api/queues/support-intel/summary?periodType=weekly');
      if (!response.ok) return;
      const json = await response.json();
      setSummary(json.summary || null);
    } catch {
      // Non-critical
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    fetchTrends();
    fetchSummary();
  }, [fetchData, fetchTrends, fetchSummary]);

  // --- Actions ---

  const recomputeCounts = useCallback(
    (tickets: SupportIntelResponse['tickets']): SupportIntelResponse['counts'] => {
      const categorized = tickets.filter((t) => t.categorization).length;
      const severityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
      const categoryCounts: Record<string, number> = {};

      for (const t of tickets) {
        if (t.categorization) {
          const sev = t.categorization.severity as keyof typeof severityCounts;
          if (sev in severityCounts) severityCounts[sev]++;
          const cat = t.categorization.primary_category;
          categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
        }
      }

      let topCategory: { name: string; count: number } | null = null;
      for (const [name, count] of Object.entries(categoryCounts)) {
        if (!topCategory || count > topCategory.count) {
          topCategory = { name, count };
        }
      }

      return {
        total: tickets.length,
        categorized,
        uncategorized: tickets.length - categorized,
        bySeverity: severityCounts,
        topCategory,
      };
    },
    []
  );

  const analyzeTicket = async (ticketId: string) => {
    setAnalyzingTickets((prev) => new Set(prev).add(ticketId));

    try {
      const response = await fetch('/api/queues/support-intel/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId }),
      });

      if (!response.ok) throw new Error('Categorization failed');

      const result = await response.json();
      const categorization: TicketCategorizationResponse = result.categorization;

      setData((prev) => {
        if (!prev) return prev;
        const updatedTickets = prev.tickets.map((t) =>
          t.ticketId === ticketId ? { ...t, categorization } : t
        );
        return { tickets: updatedTickets, counts: recomputeCounts(updatedTickets) };
      });
    } catch (err) {
      console.error('Categorization failed:', err);
    } finally {
      setAnalyzingTickets((prev) => {
        const next = new Set(prev);
        next.delete(ticketId);
        return next;
      });
    }
  };

  const batchAnalyze = async () => {
    if (!data) return;

    const uncategorizedIds = data.tickets
      .filter((t) => !t.categorization)
      .map((t) => t.ticketId);

    if (uncategorizedIds.length === 0) return;

    setIsBatchAnalyzing(true);
    setBatchProgress({ current: 0, total: uncategorizedIds.length, currentTicket: '', successful: 0, failed: 0 });

    const abortController = new AbortController();
    batchAbortRef.current = abortController;

    try {
      const response = await fetch('/api/queues/support-intel/batch-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketIds: uncategorizedIds }),
        signal: abortController.signal,
      });

      if (!response.ok) throw new Error('Batch categorization failed to start');

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

              if (event.status === 'success' && event.categorization) {
                const categorization: TicketCategorizationResponse = {
                  hubspot_ticket_id: event.ticketId,
                  primary_category: event.categorization.primary_category,
                  subcategory: event.categorization.subcategory,
                  affected_module: event.categorization.affected_module,
                  issue_type: event.categorization.issue_type,
                  severity: event.categorization.severity,
                  customer_impact: event.categorization.customer_impact,
                  root_cause_hint: event.categorization.root_cause_hint,
                  summary: event.categorization.summary,
                  tags: event.categorization.tags,
                  ticket_subject: event.ticketSubject,
                  company_id: null,
                  company_name: null,
                  ticket_created_at: null,
                  is_closed: false,
                  confidence: event.categorization.confidence,
                  analyzed_at: event.categorization.analyzed_at,
                };

                setData((prev) => {
                  if (!prev) return prev;
                  const updatedTickets = prev.tickets.map((t) =>
                    t.ticketId === event.ticketId ? { ...t, categorization } : t
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
        console.error('Batch categorization error:', err);
      }
    } finally {
      setIsBatchAnalyzing(false);
      batchAbortRef.current = null;
    }
  };

  const cancelBatch = () => {
    batchAbortRef.current?.abort();
  };

  const generateSummary = async () => {
    setGeneratingSummary(true);
    try {
      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const response = await fetch('/api/queues/support-intel/summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          periodStart: weekAgo.toISOString().slice(0, 10),
          periodEnd: now.toISOString().slice(0, 10),
        }),
      });

      if (!response.ok) throw new Error('Failed to generate summary');

      const json = await response.json();
      setSummary(json.summary || null);
    } catch (err) {
      console.error('Summary generation failed:', err);
    } finally {
      setGeneratingSummary(false);
    }
  };

  const exportCsv = () => {
    const params = new URLSearchParams();
    if (categoryFilter !== 'all') params.set('category', categoryFilter);
    if (severityFilter !== 'all') params.set('severity', severityFilter);
    if (issueTypeFilter !== 'all') params.set('issueType', issueTypeFilter);
    const url = `/api/queues/support-intel/export${params.toString() ? `?${params}` : ''}`;
    window.open(url, '_blank');
  };

  // --- Computed Values ---

  const uniqueCategories = useMemo(() => {
    if (!data) return [];
    const values = new Set<string>();
    for (const t of data.tickets) {
      if (t.categorization?.primary_category) values.add(t.categorization.primary_category);
    }
    return Array.from(values).sort();
  }, [data]);

  const uniqueCompanies = useMemo(() => {
    if (!data) return [];
    const values = new Set<string>();
    for (const t of data.tickets) {
      if (t.companyName) values.add(t.companyName);
    }
    return Array.from(values).sort();
  }, [data]);

  const categoryDistribution = useMemo(() => {
    if (!data) return [];
    const counts: Record<string, number> = {};
    for (const t of data.tickets) {
      if (t.categorization) {
        const cat = t.categorization.primary_category;
        counts[cat] = (counts[cat] || 0) + 1;
      }
    }
    return Object.entries(counts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));
  }, [data]);

  const processedTickets = useMemo(() => {
    if (!data) return [];

    let result = [...data.tickets];

    // Status filter
    if (statusFilter === 'categorized') {
      result = result.filter((t) => t.categorization);
    } else if (statusFilter === 'uncategorized') {
      result = result.filter((t) => !t.categorization);
    }

    // Category filter
    if (categoryFilter !== 'all') {
      result = result.filter((t) => t.categorization?.primary_category === categoryFilter);
    }

    // Severity filter
    if (severityFilter !== 'all') {
      result = result.filter((t) => t.categorization?.severity === severityFilter);
    }

    // Issue type filter
    if (issueTypeFilter !== 'all') {
      result = result.filter((t) => t.categorization?.issue_type === issueTypeFilter);
    }

    // Company filter
    if (companyFilter !== 'all') {
      result = result.filter((t) => t.companyName === companyFilter);
    }

    // Open/Closed filter
    if (closedFilter === 'open') {
      result = result.filter((t) => !t.isClosed);
    } else if (closedFilter === 'closed') {
      result = result.filter((t) => t.isClosed);
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
        case 'category':
          comparison = (a.categorization?.primary_category || '').localeCompare(b.categorization?.primary_category || '');
          break;
        case 'issueType':
          comparison = (a.categorization?.issue_type || '').localeCompare(b.categorization?.issue_type || '');
          break;
        case 'severity': {
          const sevOrder: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
          comparison = (sevOrder[a.categorization?.severity || ''] || 0) - (sevOrder[b.categorization?.severity || ''] || 0);
          break;
        }
        case 'ageDays':
          comparison = a.ageDays - b.ageDays;
          break;
        case 'status':
          comparison = (a.categorization ? 1 : 0) - (b.categorization ? 1 : 0);
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [data, statusFilter, categoryFilter, severityFilter, issueTypeFilter, companyFilter, closedFilter, sortColumn, sortDirection]);

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  const hasActiveFilters = statusFilter !== 'all' || categoryFilter !== 'all' || severityFilter !== 'all' || issueTypeFilter !== 'all' || companyFilter !== 'all' || closedFilter !== 'all';

  const clearFilters = () => {
    setStatusFilter('all');
    setCategoryFilter('all');
    setSeverityFilter('all');
    setIssueTypeFilter('all');
    setCompanyFilter('all');
    setClosedFilter('all');
  };

  const toggleRow = (key: string) => {
    setExpandedRow(expandedRow === key ? null : key);
  };

  // --- Render ---

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Support Intel</h1>
        <p className="text-sm text-gray-600 mt-1">
          LLM-powered issue categorization and trend analysis across all support tickets.
        </p>
      </div>

      {/* Executive Summary Card */}
      {!loading && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-gray-900">Weekly Summary</h2>
            <button
              onClick={generateSummary}
              disabled={generatingSummary || summaryLoading}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-50"
            >
              {generatingSummary ? (
                <>
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Generating...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  {summary ? 'Regenerate' : 'Generate Summary'}
                </>
              )}
            </button>
          </div>

          {summaryLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600"></div>
            </div>
          ) : summary ? (
            <div className="space-y-4">
              <div className="prose prose-sm max-w-none text-gray-700">
                {summary.summary_text.split('\n\n').map((paragraph, i) => (
                  <p key={i}>{paragraph}</p>
                ))}
              </div>

              {summary.key_insights && summary.key_insights.length > 0 && (
                <div className="border-t border-gray-100 pt-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Key Insights</h3>
                  <ul className="space-y-1">
                    {summary.key_insights.map((insight, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                        <span className="text-indigo-500 mt-0.5">-</span>
                        <span>{insight}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex items-center gap-4 text-xs text-gray-400 border-t border-gray-100 pt-2">
                <span>Period: {summary.period_start} to {summary.period_end}</span>
                <span>{summary.total_tickets_analyzed} tickets analyzed</span>
                <span>Generated {new Date(summary.generated_at).toLocaleString()}</span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-500 py-4 text-center">
              No summary generated yet. Click &quot;Generate Summary&quot; to create a weekly executive summary.
            </p>
          )}
        </div>
      )}

      {/* Summary Cards */}
      {!loading && data && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <div className="bg-white rounded-lg border border-gray-200 p-3">
            <div className="text-xs text-gray-500 uppercase tracking-wider">Total Tickets</div>
            <div className="text-2xl font-bold text-gray-900 mt-1">{data.counts.total}</div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-3">
            <div className="text-xs text-gray-500 uppercase tracking-wider">Categorized</div>
            <div className="text-2xl font-bold text-indigo-600 mt-1">{data.counts.categorized}</div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-3">
            <div className="text-xs text-gray-500 uppercase tracking-wider">Uncategorized</div>
            <div className="text-2xl font-bold text-gray-400 mt-1">{data.counts.uncategorized}</div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-3">
            <div className="text-xs text-gray-500 uppercase tracking-wider">Top Category</div>
            <div className="text-sm font-bold text-gray-900 mt-1 truncate">
              {data.counts.topCategory ? `${data.counts.topCategory.name} (${data.counts.topCategory.count})` : '-'}
            </div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-3">
            <div className="text-xs text-gray-500 uppercase tracking-wider">Critical/High</div>
            <div className="text-2xl font-bold text-red-600 mt-1">
              {data.counts.bySeverity.critical + data.counts.bySeverity.high}
            </div>
          </div>
        </div>
      )}

      {/* Category Distribution */}
      {!loading && categoryDistribution.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Category Distribution (Top 10)</h2>
          <div className="space-y-1">
            {categoryDistribution.map(({ name, count }) => (
              <CategoryBar
                key={name}
                name={name}
                count={count}
                maxCount={categoryDistribution[0]?.count || 1}
                onClick={() => setCategoryFilter(categoryFilter === name ? 'all' : name)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Trend Chart */}
      {!loading && trends && trends.categories.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Weekly Trends (Top 5 Categories)</h2>
          {trendsLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600"></div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-2 px-2 text-xs font-medium text-slate-500 uppercase">Category</th>
                    {trends.periods.map((p) => (
                      <th key={p} className="text-center py-2 px-2 text-xs font-medium text-slate-500">
                        {p.slice(5)}
                      </th>
                    ))}
                    <th className="text-right py-2 px-2 text-xs font-medium text-slate-500 uppercase">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {trends.categories.slice(0, 5).map((cat) => (
                    <tr key={cat.name} className="hover:bg-slate-50">
                      <td className="py-2 px-2 text-gray-700 font-medium truncate max-w-48">{cat.name}</td>
                      {cat.byPeriod.map((bp) => (
                        <td key={bp.period} className="text-center py-2 px-2">
                          {bp.count > 0 ? (
                            <span className={`inline-block min-w-6 text-center rounded px-1 py-0.5 text-xs font-medium ${
                              bp.count >= 5 ? 'bg-red-100 text-red-700' : bp.count >= 3 ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-600'
                            }`}>
                              {bp.count}
                            </span>
                          ) : (
                            <span className="text-gray-300">-</span>
                          )}
                        </td>
                      ))}
                      <td className="text-right py-2 px-2 font-semibold text-gray-900">{cat.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Action Buttons Row */}
      {!loading && data && (
        <div className="flex flex-wrap items-center gap-3 mb-4">
          {data.counts.uncategorized > 0 && !isBatchAnalyzing && (
            <button
              onClick={batchAnalyze}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Categorize All Uncategorized ({data.counts.uncategorized})
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
                  Categorizing {batchProgress.current} of {batchProgress.total}...
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
                Batch complete: {batchProgress.successful} categorized
                {batchProgress.failed > 0 && `, ${batchProgress.failed} failed`}
              </span>
              <button onClick={() => { setBatchProgress(null); fetchTrends(); }} className="text-sm text-emerald-600 hover:text-emerald-800 ml-2">
                Dismiss
              </button>
            </div>
          )}

          {/* Export CSV button */}
          {data.counts.categorized > 0 && (
            <button
              onClick={exportCsv}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Export CSV
            </button>
          )}
        </div>
      )}

      {/* Filters Row */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Status:</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="all">All</option>
            <option value="categorized">Categorized</option>
            <option value="uncategorized">Uncategorized</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Category:</label>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="all">All Categories</option>
            {uniqueCategories.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Severity:</label>
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="all">All</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Type:</label>
          <select
            value={issueTypeFilter}
            onChange={(e) => setIssueTypeFilter(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="all">All Types</option>
            <option value="bug">Bug</option>
            <option value="feature_request">Feature Request</option>
            <option value="how_to">How-To</option>
            <option value="configuration">Configuration</option>
            <option value="data_issue">Data Issue</option>
            <option value="access_issue">Access Issue</option>
            <option value="integration">Integration</option>
            <option value="performance">Performance</option>
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
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Ticket:</label>
          <select
            value={closedFilter}
            onChange={(e) => setClosedFilter(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="all">Open + Closed</option>
            <option value="open">Open Only</option>
            <option value="closed">Closed Only</option>
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
      {!loading && !error && processedTickets.length === 0 && (
        <div className="text-center py-12 bg-slate-50 rounded-lg border border-slate-200">
          <svg className="mx-auto h-12 w-12 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <h3 className="mt-4 text-lg font-medium text-gray-900">
            {hasActiveFilters ? 'No tickets match the current filters' : 'No tickets found'}
          </h3>
          <p className="mt-1 text-sm text-gray-600">
            {hasActiveFilters ? 'Try adjusting the filters.' : 'No support tickets available for categorization.'}
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
                      <SortIcon active={sortColumn === 'companyName'} direction={sortDirection} />
                    </div>
                  </th>
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none"
                    onClick={() => handleSort('subject')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Subject</span>
                      <SortIcon active={sortColumn === 'subject'} direction={sortDirection} />
                    </div>
                  </th>
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                    onClick={() => handleSort('category')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Category</span>
                      <SortIcon active={sortColumn === 'category'} direction={sortDirection} />
                    </div>
                  </th>
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                    onClick={() => handleSort('issueType')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Type</span>
                      <SortIcon active={sortColumn === 'issueType'} direction={sortDirection} />
                    </div>
                  </th>
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                    onClick={() => handleSort('severity')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Severity</span>
                      <SortIcon active={sortColumn === 'severity'} direction={sortDirection} />
                    </div>
                  </th>
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                    onClick={() => handleSort('ageDays')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Age</span>
                      <SortIcon active={sortColumn === 'ageDays'} direction={sortDirection} />
                    </div>
                  </th>
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                    onClick={() => handleSort('status')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Status</span>
                      <SortIcon active={sortColumn === 'status'} direction={sortDirection} />
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
                      <tr className="hover:bg-slate-50 transition-colors cursor-pointer" onClick={() => toggleRow(ticket.ticketId)}>
                        <td className="px-2 py-3">
                          <svg
                            className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                            fill="none" stroke="currentColor" viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
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
                            <span className="text-sm text-gray-500 italic">No Company</span>
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
                          {ticket.categorization?.primary_category || '-'}
                        </td>
                        <td className="px-4 py-3">
                          {ticket.categorization ? (
                            <IssueTypeBadge issueType={ticket.categorization.issue_type} />
                          ) : (
                            <span className="text-sm text-gray-400">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {ticket.categorization ? (
                            <SeverityBadge severity={ticket.categorization.severity} />
                          ) : (
                            <span className="text-sm text-gray-400">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-sm ${ticket.ageDays >= 14 ? 'font-medium text-red-600' : ticket.ageDays >= 7 ? 'text-orange-600' : 'text-gray-600'}`}>
                            {ticket.ageDays}d
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {ticket.categorization ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-indigo-100 text-indigo-700">
                              Categorized
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border border-gray-300 text-gray-500">
                              Uncategorized
                            </span>
                          )}
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
                                <svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                </svg>
                                Analyzing...
                              </span>
                            ) : ticket.categorization ? 'Re-analyze' : 'Analyze'}
                          </button>
                        </td>
                      </tr>

                      {/* Expanded Row - Categorization Details */}
                      {isExpanded && (
                        <tr>
                          <td colSpan={9} className="px-0 py-0">
                            <div className="bg-slate-50 border-y border-gray-200 px-8 py-4">
                              {ticket.categorization ? (
                                <div className="space-y-3">
                                  <div className="flex items-center gap-4 flex-wrap">
                                    <SeverityBadge severity={ticket.categorization.severity} />
                                    <IssueTypeBadge issueType={ticket.categorization.issue_type} />
                                    <span className="text-sm text-gray-500">
                                      Confidence: {Math.round(ticket.categorization.confidence * 100)}%
                                    </span>
                                    {ticket.isClosed && (
                                      <span className="text-xs px-2 py-0.5 rounded bg-gray-200 text-gray-600">Closed</span>
                                    )}
                                    <span className="text-xs text-gray-400 ml-auto">
                                      Analyzed {new Date(ticket.categorization.analyzed_at).toLocaleString()}
                                    </span>
                                  </div>

                                  <div>
                                    <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Summary</h4>
                                    <p className="text-sm text-gray-700">{ticket.categorization.summary}</p>
                                  </div>

                                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                    <div>
                                      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Category</h4>
                                      <p className="text-sm text-gray-700">
                                        {ticket.categorization.primary_category}
                                        {ticket.categorization.subcategory && (
                                          <span className="text-gray-500"> / {ticket.categorization.subcategory}</span>
                                        )}
                                      </p>
                                    </div>
                                    {ticket.categorization.affected_module && (
                                      <div>
                                        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Affected Module</h4>
                                        <p className="text-sm text-gray-700">{ticket.categorization.affected_module}</p>
                                      </div>
                                    )}
                                    {ticket.categorization.tags && ticket.categorization.tags.length > 0 && (
                                      <div>
                                        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Tags</h4>
                                        <div className="flex flex-wrap gap-1">
                                          {ticket.categorization.tags.map((tag) => (
                                            <span key={tag} className="text-xs px-2 py-0.5 rounded bg-slate-200 text-slate-600">{tag}</span>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>

                                  {ticket.categorization.customer_impact && (
                                    <div>
                                      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Customer Impact</h4>
                                      <p className="text-sm text-gray-700">{ticket.categorization.customer_impact}</p>
                                    </div>
                                  )}

                                  {ticket.categorization.root_cause_hint && (
                                    <div>
                                      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Root Cause Hint</h4>
                                      <p className="text-sm text-gray-700">{ticket.categorization.root_cause_hint}</p>
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <div className="text-center py-4">
                                  <p className="text-sm text-gray-500 mb-2">
                                    This ticket hasn&apos;t been categorized yet.
                                  </p>
                                  <button
                                    onClick={() => analyzeTicket(ticket.ticketId)}
                                    disabled={isAnalyzing}
                                    className="text-sm font-medium px-4 py-2 rounded bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-50"
                                  >
                                    {analyzingTickets.has(ticket.ticketId) ? 'Analyzing...' : 'Categorize This Ticket'}
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
