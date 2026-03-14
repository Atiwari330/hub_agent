'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getHubSpotTicketUrl } from '@/lib/hubspot/urls';
import type { RcmAuditResponse, RcmAuditTicket } from '@/app/api/queues/rcm-audit/route';

// --- Types ---

type SortColumn =
  | 'subject'
  | 'companyName'
  | 'rcmSystem'
  | 'category'
  | 'severity'
  | 'status'
  | 'ageDays'
  | 'analyzedAt'
  | 'vendorBlamed'
  | 'hasLinear';
type SortDirection = 'asc' | 'desc';
type AnalysisFilter = 'all' | 'analyzed' | 'unanalyzed' | 'rcm' | 'not-rcm';

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

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active: 'bg-blue-100 text-blue-700',
    stalled: 'bg-red-100 text-red-700',
    waiting_vendor: 'bg-orange-100 text-orange-700',
    waiting_customer: 'bg-yellow-100 text-yellow-700',
    resolved: 'bg-emerald-100 text-emerald-700',
  };
  const labels: Record<string, string> = {
    active: 'Active',
    stalled: 'Stalled',
    waiting_vendor: 'Waiting Vendor',
    waiting_customer: 'Waiting Customer',
    resolved: 'Resolved',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[status] || 'bg-gray-100 text-gray-600'}`}>
      {labels[status] || status}
    </span>
  );
}

function RcmSystemBadge({ system }: { system: string }) {
  const styles: Record<string, string> = {
    practice_suite: 'bg-purple-100 text-purple-700',
    opus_rcm: 'bg-indigo-100 text-indigo-700',
    both: 'bg-pink-100 text-pink-700',
    unknown: 'bg-gray-100 text-gray-600',
  };
  const labels: Record<string, string> = {
    practice_suite: 'Practice Suite',
    opus_rcm: 'Opus RCM',
    both: 'Both',
    unknown: 'Unknown',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[system] || 'bg-gray-100 text-gray-600'}`}>
      {labels[system] || system}
    </span>
  );
}

function CategoryLabel({ category }: { category: string }) {
  const labels: Record<string, string> = {
    claim_denial: 'Claim Denial',
    encounter_sync: 'Encounter Sync',
    era_remittance: 'ERA/Remittance',
    insurance_entry: 'Insurance Entry',
    cpt_npi_config: 'CPT/NPI Config',
    billing_rules: 'Billing Rules',
    payment_posting: 'Payment Posting',
    vendor_issue: 'Vendor Issue',
    other: 'Other',
  };
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-600">
      {labels[category] || category}
    </span>
  );
}

function AnalyzedTimestamp({ dateStr }: { dateStr: string }) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  let label: string;
  if (diffDays === 0) {
    label = `Today ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  } else if (diffDays === 1) {
    label = 'Yesterday';
  } else if (diffDays < 30) {
    label = `${diffDays}d ago`;
  } else {
    label = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  return <span className="text-xs text-gray-500 whitespace-nowrap">{label}</span>;
}

function Spinner() {
  return (
    <svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );
}

// --- Main Component ---

export function RcmAuditView() {
  const [data, setData] = useState<RcmAuditResponse | null>(null);
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
  const [analysisFilter, setAnalysisFilter] = useState<AnalysisFilter>('all');
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [systemFilter, setSystemFilter] = useState<string>('all');
  const [linearFilter, setLinearFilter] = useState<string>('all');
  const [dataMode, setDataMode] = useState<'normal' | 'last200'>('normal');

  // Sorting
  const [sortColumn, setSortColumn] = useState<SortColumn>('ageDays');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // --- Data Fetching ---

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const params = dataMode === 'last200' ? '?mode=last200' : '';
      const response = await fetch(`/api/queues/rcm-audit${params}`);
      if (!response.ok) throw new Error('Failed to fetch RCM audit data');
      const json: RcmAuditResponse = await response.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [dataMode]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // --- Actions ---

  const analyzeTicket = async (ticketId: string) => {
    setAnalyzingTickets((prev) => new Set(prev).add(ticketId));

    try {
      const response = await fetch('/api/queues/rcm-audit/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId }),
      });

      if (!response.ok) throw new Error('Analysis failed');

      const result = await response.json();

      setData((prev) => {
        if (!prev) return prev;
        const updatedTickets = prev.tickets.map((t) =>
          t.ticketId === ticketId ? { ...t, analysis: result.analysis } : t
        );
        return { ...prev, tickets: updatedTickets, counts: recomputeCounts(updatedTickets) };
      });
    } catch (err) {
      console.error('RCM analysis failed:', err);
    } finally {
      setAnalyzingTickets((prev) => {
        const next = new Set(prev);
        next.delete(ticketId);
        return next;
      });
    }
  };

  const recomputeCounts = (tickets: RcmAuditTicket[]): RcmAuditResponse['counts'] => {
    const analyzed = tickets.filter((t) => t.analysis).length;
    const rcmRelated = tickets.filter((t) => t.analysis?.is_rcm_related).length;
    const notRcmRelated = tickets.filter((t) => t.analysis && !t.analysis.is_rcm_related).length;
    const hasLinear = tickets.filter((t) => t.linearTask).length;
    const severityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
    const categoryCounts: Record<string, number> = {};
    const statusCounts: Record<string, number> = {};

    for (const t of tickets) {
      if (t.analysis?.is_rcm_related) {
        const sev = t.analysis.severity as keyof typeof severityCounts;
        if (sev in severityCounts) severityCounts[sev]++;
        if (t.analysis.issue_category) {
          categoryCounts[t.analysis.issue_category] = (categoryCounts[t.analysis.issue_category] || 0) + 1;
        }
        if (t.analysis.current_status) {
          statusCounts[t.analysis.current_status] = (statusCounts[t.analysis.current_status] || 0) + 1;
        }
      }
    }

    return {
      total: tickets.length,
      analyzed,
      unanalyzed: tickets.length - analyzed,
      rcmRelated,
      notRcmRelated,
      hasLinear,
      bySeverity: severityCounts,
      byCategory: categoryCounts,
      byStatus: statusCounts,
    };
  };

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
      const response = await fetch('/api/queues/rcm-audit/batch-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketIds: unanalyzedIds.slice(0, 100) }),
        signal: abortController.signal,
      });

      if (!response.ok || !response.body) throw new Error('Batch analysis failed');

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
          const dataMatch = line.match(/^data:\s*(.+)$/m);
          if (!dataMatch) continue;

          try {
            const event = JSON.parse(dataMatch[1]);

            if (event.type === 'progress') {
              setBatchProgress((prev) => ({
                current: event.index,
                total: event.total,
                currentTicket: event.ticketSubject,
                successful: (prev?.successful || 0) + (event.status === 'success' ? 1 : 0),
                failed: (prev?.failed || 0) + (event.status === 'error' ? 1 : 0),
              }));

              if (event.status === 'success' && event.analysis) {
                setData((prev) => {
                  if (!prev) return prev;
                  const updatedTickets = prev.tickets.map((t) =>
                    t.ticketId === event.ticketId ? { ...t, analysis: event.analysis } : t
                  );
                  return { ...prev, tickets: updatedTickets };
                });
              }
            }

            if (event.type === 'done') {
              setBatchProgress({
                current: event.processed,
                total: event.processed,
                currentTicket: 'Complete',
                successful: event.successful,
                failed: event.failed,
              });
            }
          } catch {
            // Skip malformed events
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // User cancelled
      } else {
        console.error('Batch analysis error:', err);
      }
    } finally {
      setIsBatchAnalyzing(false);
      batchAbortRef.current = null;
      // Refresh data to get accurate counts
      fetchData();
    }
  };

  const batchReanalyze = async () => {
    if (!data) return;

    const analyzedIds = filteredTickets
      .filter((t) => t.analysis)
      .map((t) => t.ticketId);

    if (analyzedIds.length === 0) return;

    const confirmed = window.confirm(
      `Re-analyze ${analyzedIds.length} already-analyzed ticket${analyzedIds.length !== 1 ? 's' : ''}? This will replace existing analyses.`
    );
    if (!confirmed) return;

    setIsBatchAnalyzing(true);
    setBatchProgress({ current: 0, total: analyzedIds.length, currentTicket: '', successful: 0, failed: 0 });

    const abortController = new AbortController();
    batchAbortRef.current = abortController;

    try {
      const response = await fetch('/api/queues/rcm-audit/batch-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketIds: analyzedIds.slice(0, 100) }),
        signal: abortController.signal,
      });

      if (!response.ok || !response.body) throw new Error('Batch re-analysis failed');

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
          const dataMatch = line.match(/^data:\s*(.+)$/m);
          if (!dataMatch) continue;

          try {
            const event = JSON.parse(dataMatch[1]);

            if (event.type === 'progress') {
              setBatchProgress((prev) => ({
                current: event.index,
                total: event.total,
                currentTicket: event.ticketSubject,
                successful: (prev?.successful || 0) + (event.status === 'success' ? 1 : 0),
                failed: (prev?.failed || 0) + (event.status === 'error' ? 1 : 0),
              }));

              if (event.status === 'success' && event.analysis) {
                setData((prev) => {
                  if (!prev) return prev;
                  const updatedTickets = prev.tickets.map((t) =>
                    t.ticketId === event.ticketId ? { ...t, analysis: event.analysis } : t
                  );
                  return { ...prev, tickets: updatedTickets };
                });
              }
            }

            if (event.type === 'done') {
              setBatchProgress({
                current: event.processed,
                total: event.processed,
                currentTicket: 'Complete',
                successful: event.successful,
                failed: event.failed,
              });
            }
          } catch {
            // Skip malformed events
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // User cancelled
      } else {
        console.error('Batch re-analysis error:', err);
      }
    } finally {
      setIsBatchAnalyzing(false);
      batchAbortRef.current = null;
      fetchData();
    }
  };

  const cancelBatch = () => {
    batchAbortRef.current?.abort();
  };

  // --- Filtering & Sorting ---

  const filteredTickets = useMemo(() => {
    if (!data) return [];
    let tickets = [...data.tickets];

    // Analysis status filter
    if (analysisFilter === 'analyzed') tickets = tickets.filter((t) => t.analysis);
    if (analysisFilter === 'unanalyzed') tickets = tickets.filter((t) => !t.analysis);
    if (analysisFilter === 'rcm') tickets = tickets.filter((t) => t.analysis?.is_rcm_related);
    if (analysisFilter === 'not-rcm') tickets = tickets.filter((t) => t.analysis && !t.analysis.is_rcm_related);

    // Severity filter
    if (severityFilter !== 'all') {
      tickets = tickets.filter((t) => t.analysis?.severity === severityFilter);
    }

    // Category filter
    if (categoryFilter !== 'all') {
      tickets = tickets.filter((t) => t.analysis?.issue_category === categoryFilter);
    }

    // System filter
    if (systemFilter !== 'all') {
      tickets = tickets.filter((t) => t.analysis?.rcm_system === systemFilter);
    }

    // Linear filter
    if (linearFilter === 'has-linear') tickets = tickets.filter((t) => t.linearTask);
    if (linearFilter === 'no-linear') tickets = tickets.filter((t) => !t.linearTask);

    // Sorting
    tickets.sort((a, b) => {
      const dir = sortDirection === 'asc' ? 1 : -1;
      switch (sortColumn) {
        case 'subject':
          return dir * (a.subject || '').localeCompare(b.subject || '');
        case 'companyName':
          return dir * (a.companyName || '').localeCompare(b.companyName || '');
        case 'rcmSystem':
          return dir * (a.analysis?.rcm_system || '').localeCompare(b.analysis?.rcm_system || '');
        case 'category':
          return dir * (a.analysis?.issue_category || '').localeCompare(b.analysis?.issue_category || '');
        case 'severity': {
          const sevOrder: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
          return dir * ((sevOrder[a.analysis?.severity || ''] || 0) - (sevOrder[b.analysis?.severity || ''] || 0));
        }
        case 'status':
          return dir * (a.analysis?.current_status || '').localeCompare(b.analysis?.current_status || '');
        case 'ageDays':
          return dir * (a.ageDays - b.ageDays);
        case 'analyzedAt': {
          const aTime = a.analysis?.analyzed_at ? new Date(a.analysis.analyzed_at).getTime() : 0;
          const bTime = b.analysis?.analyzed_at ? new Date(b.analysis.analyzed_at).getTime() : 0;
          return dir * (aTime - bTime);
        }
        case 'vendorBlamed':
          return dir * ((a.analysis?.vendor_blamed ? 1 : 0) - (b.analysis?.vendor_blamed ? 1 : 0));
        case 'hasLinear':
          return dir * ((a.linearTask ? 1 : 0) - (b.linearTask ? 1 : 0));
        default:
          return 0;
      }
    });

    return tickets;
  }, [data, analysisFilter, severityFilter, categoryFilter, systemFilter, linearFilter, sortColumn, sortDirection]);

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  // --- Render ---

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading RCM audit data...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-red-500">{error}</div>
      </div>
    );
  }

  if (!data) return null;

  const counts = data.counts;
  const unanalyzedCount = counts.unanalyzed;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">RCM Audit</h1>
          <p className="text-sm text-gray-500 mt-1">
            Revenue Cycle Management ticket analysis with Linear engineering context
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={dataMode}
            onChange={(e) => setDataMode(e.target.value as 'normal' | 'last200')}
            className="text-sm border border-gray-300 rounded-md px-3 py-1.5"
          >
            <option value="normal">Open Tickets</option>
            <option value="last200">Last 200 Tickets</option>
          </select>
          <button
            onClick={fetchData}
            disabled={loading}
            className="text-sm bg-white border border-gray-300 rounded-md px-3 py-1.5 hover:bg-gray-50"
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <div className="bg-white rounded-lg border border-gray-200 p-3">
          <div className="text-xs text-gray-500 uppercase tracking-wider">Total</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">{counts.total}</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-3">
          <div className="text-xs text-gray-500 uppercase tracking-wider">Analyzed</div>
          <div className="text-2xl font-bold text-indigo-600 mt-1">{counts.analyzed}</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-3">
          <div className="text-xs text-gray-500 uppercase tracking-wider">RCM-Related</div>
          <div className="text-2xl font-bold text-purple-600 mt-1">{counts.rcmRelated}</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-3">
          <div className="text-xs text-gray-500 uppercase tracking-wider">Critical</div>
          <div className="text-2xl font-bold text-red-600 mt-1">{counts.bySeverity.critical}</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-3">
          <div className="text-xs text-gray-500 uppercase tracking-wider">High</div>
          <div className="text-2xl font-bold text-orange-600 mt-1">{counts.bySeverity.high}</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-3">
          <div className="text-xs text-gray-500 uppercase tracking-wider">Has Linear</div>
          <div className="text-2xl font-bold text-blue-600 mt-1">{counts.hasLinear}</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-3">
          <div className="text-xs text-gray-500 uppercase tracking-wider">Unanalyzed</div>
          <div className="text-2xl font-bold text-gray-400 mt-1">{counts.unanalyzed}</div>
        </div>
      </div>

      {/* Batch Analyze / Re-analyze + Progress */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        {!isBatchAnalyzing ? (
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600">
              {unanalyzedCount > 0
                ? `${unanalyzedCount} ticket${unanalyzedCount !== 1 ? 's' : ''} pending analysis`
                : 'All tickets analyzed'}
            </span>
            <div className="flex items-center gap-3">
              {filteredTickets.filter((t) => t.analysis).length > 0 && (
                <button
                  onClick={batchReanalyze}
                  className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-md bg-white border border-indigo-300 text-indigo-600 hover:bg-indigo-50"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Re-analyze All ({filteredTickets.filter((t) => t.analysis).length})
                </button>
              )}
              {unanalyzedCount > 0 && (
                <button
                  onClick={batchAnalyze}
                  className="bg-indigo-600 text-white text-sm px-4 py-2 rounded-md hover:bg-indigo-700"
                >
                  Analyze All ({Math.min(unanalyzedCount, 100)})
                </button>
              )}
            </div>
          </div>
        ) : batchProgress ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-gray-600">
                <Spinner />
                Analyzing {batchProgress.current}/{batchProgress.total}: {batchProgress.currentTicket}
              </span>
              <button
                onClick={cancelBatch}
                className="text-red-600 hover:text-red-700 text-sm"
              >
                Cancel
              </button>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-indigo-600 h-2 rounded-full transition-all"
                style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
              />
            </div>
          </div>
        ) : null}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          value={analysisFilter}
          onChange={(e) => setAnalysisFilter(e.target.value as AnalysisFilter)}
          className="text-sm border border-gray-300 rounded-md px-3 py-1.5"
        >
          <option value="all">All Tickets</option>
          <option value="analyzed">Analyzed</option>
          <option value="unanalyzed">Unanalyzed</option>
          <option value="rcm">RCM-Related</option>
          <option value="not-rcm">Not RCM</option>
        </select>
        <select
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value)}
          className="text-sm border border-gray-300 rounded-md px-3 py-1.5"
        >
          <option value="all">All Severities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="text-sm border border-gray-300 rounded-md px-3 py-1.5"
        >
          <option value="all">All Categories</option>
          <option value="claim_denial">Claim Denial</option>
          <option value="encounter_sync">Encounter Sync</option>
          <option value="era_remittance">ERA/Remittance</option>
          <option value="insurance_entry">Insurance Entry</option>
          <option value="cpt_npi_config">CPT/NPI Config</option>
          <option value="billing_rules">Billing Rules</option>
          <option value="payment_posting">Payment Posting</option>
          <option value="vendor_issue">Vendor Issue</option>
          <option value="other">Other</option>
        </select>
        <select
          value={systemFilter}
          onChange={(e) => setSystemFilter(e.target.value)}
          className="text-sm border border-gray-300 rounded-md px-3 py-1.5"
        >
          <option value="all">All Systems</option>
          <option value="practice_suite">Practice Suite</option>
          <option value="opus_rcm">Opus RCM</option>
          <option value="both">Both</option>
          <option value="unknown">Unknown</option>
        </select>
        <select
          value={linearFilter}
          onChange={(e) => setLinearFilter(e.target.value)}
          className="text-sm border border-gray-300 rounded-md px-3 py-1.5"
        >
          <option value="all">All (Linear)</option>
          <option value="has-linear">Has Linear Link</option>
          <option value="no-linear">No Linear Link</option>
        </select>
      </div>

      {/* Results count */}
      <div className="text-sm text-gray-500">
        Showing {filteredTickets.length} of {data.tickets.length} tickets
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="w-8 px-2 py-3" />
                {[
                  { key: 'subject' as SortColumn, label: 'Subject' },
                  { key: 'companyName' as SortColumn, label: 'Company' },
                  { key: 'rcmSystem' as SortColumn, label: 'System' },
                  { key: 'category' as SortColumn, label: 'Category' },
                  { key: 'severity' as SortColumn, label: 'Severity' },
                  { key: 'status' as SortColumn, label: 'Status' },
                  { key: 'hasLinear' as SortColumn, label: 'Linear' },
                  { key: 'ageDays' as SortColumn, label: 'Age' },
                  { key: 'analyzedAt' as SortColumn, label: 'Analyzed' },
                ].map(({ key, label }) => (
                  <th
                    key={key}
                    onClick={() => handleSort(key)}
                    className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                  >
                    <div className="flex items-center gap-1">
                      {label}
                      <SortIcon active={sortColumn === key} direction={sortDirection} />
                    </div>
                  </th>
                ))}
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredTickets.map((ticket) => (
                <React.Fragment key={ticket.ticketId}>
                  <tr
                    className={`hover:bg-gray-50 cursor-pointer ${
                      expandedRow === ticket.ticketId ? 'bg-indigo-50' : ''
                    } ${!ticket.analysis ? 'opacity-70' : ''}`}
                    onClick={() => setExpandedRow(expandedRow === ticket.ticketId ? null : ticket.ticketId)}
                  >
                    <td className="px-2 py-3">
                      <svg
                        className={`w-4 h-4 text-gray-400 transition-transform ${expandedRow === ticket.ticketId ? 'rotate-90' : ''}`}
                        fill="none" stroke="currentColor" viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <div className="max-w-xs truncate">
                        <a
                          href={getHubSpotTicketUrl(ticket.ticketId)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-indigo-600 hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {ticket.subject || 'No subject'}
                        </a>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 max-w-[140px] truncate">
                      {ticket.companyName || '—'}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {ticket.analysis?.is_rcm_related && ticket.analysis.rcm_system ? (
                        <RcmSystemBadge system={ticket.analysis.rcm_system} />
                      ) : ticket.analysis ? (
                        <span className="text-xs text-gray-400">Not RCM</span>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {ticket.analysis?.is_rcm_related && ticket.analysis.issue_category ? (
                        <CategoryLabel category={ticket.analysis.issue_category} />
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {ticket.analysis?.is_rcm_related && ticket.analysis.severity ? (
                        <SeverityBadge severity={ticket.analysis.severity} />
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {ticket.analysis?.is_rcm_related && ticket.analysis.current_status ? (
                        <StatusBadge status={ticket.analysis.current_status} />
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {ticket.linearTask ? (
                        <a
                          href={ticket.linearTask}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700 hover:bg-blue-200"
                          title="Open in Linear"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 16 16">
                            <path d="M10.604 1h4.146a.25.25 0 01.25.25v4.146a.25.25 0 01-.427.177L13.03 4.03 9.28 7.78a.751.751 0 01-1.042-.018.751.751 0 01-.018-1.042l3.75-3.75-1.543-1.543A.25.25 0 0110.604 1z" />
                            <path d="M3.75 2A1.75 1.75 0 002 3.75v8.5c0 .966.784 1.75 1.75 1.75h8.5A1.75 1.75 0 0014 12.25v-3.5a.75.75 0 00-1.5 0v3.5a.25.25 0 01-.25.25h-8.5a.25.25 0 01-.25-.25v-8.5a.25.25 0 01.25-.25h3.5a.75.75 0 000-1.5h-3.5z" />
                          </svg>
                          Linear
                        </a>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {ticket.ageDays}d
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {ticket.analysis?.analyzed_at ? (
                        <AnalyzedTimestamp dateStr={ticket.analysis.analyzed_at} />
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {!ticket.analysis && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            analyzeTicket(ticket.ticketId);
                          }}
                          disabled={analyzingTickets.has(ticket.ticketId)}
                          className="text-xs bg-indigo-600 text-white px-3 py-1 rounded hover:bg-indigo-700 disabled:opacity-50"
                        >
                          {analyzingTickets.has(ticket.ticketId) ? (
                            <span className="flex items-center gap-1.5">
                              <Spinner />
                              Analyzing...
                            </span>
                          ) : 'Analyze'}
                        </button>
                      )}
                      {ticket.analysis && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            analyzeTicket(ticket.ticketId);
                          }}
                          disabled={analyzingTickets.has(ticket.ticketId)}
                          className="text-xs text-gray-500 hover:text-indigo-600 disabled:opacity-50"
                          title="Re-analyze"
                        >
                          {analyzingTickets.has(ticket.ticketId) ? (
                            <span className="flex items-center gap-1.5">
                              <Spinner />
                              Analyzing...
                            </span>
                          ) : 'Re-run'}
                        </button>
                      )}
                    </td>
                  </tr>

                  {/* Expanded Row */}
                  {expandedRow === ticket.ticketId && ticket.analysis && (
                    <tr>
                      <td colSpan={11} className="px-4 py-4 bg-gray-50">
                        <div className="space-y-4">
                          {/* RCM Classification */}
                          {ticket.analysis.is_rcm_related ? (
                            <div className="space-y-3">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-semibold uppercase text-gray-500">RCM Analysis</span>
                                <span className="text-xs text-gray-400">
                                  Confidence: {(ticket.analysis.confidence * 100).toFixed(0)}%
                                </span>
                                {ticket.analysis.vendor_blamed && (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">
                                    Vendor Blamed
                                  </span>
                                )}
                              </div>

                              {/* Summary */}
                              {ticket.analysis.issue_summary && (
                                <div>
                                  <div className="text-xs font-medium text-gray-500 mb-1">Summary</div>
                                  <p className="text-sm text-gray-700">{ticket.analysis.issue_summary}</p>
                                </div>
                              )}

                              {/* Problems */}
                              {ticket.analysis.problems && ticket.analysis.problems.length > 0 && (
                                <div>
                                  <div className="text-xs font-medium text-gray-500 mb-1">Problems Identified</div>
                                  <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">
                                    {ticket.analysis.problems.map((p, i) => (
                                      <li key={i}>{p}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}

                              {/* Linear Assessment */}
                              {ticket.analysis.linear_assessment && ticket.analysis.linear_assessment !== 'No Linear ticket linked.' && (
                                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                                  <div className="flex items-center gap-2 mb-1">
                                    <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    <span className="text-xs font-semibold uppercase text-blue-600">Linear Engineering Context</span>
                                    {ticket.analysis.linear_state && (
                                      <span className="text-xs text-blue-500">({ticket.analysis.linear_state})</span>
                                    )}
                                    {ticket.analysis.linear_comment_count != null && (
                                      <span className="text-xs text-blue-400">
                                        {ticket.analysis.linear_comment_count} comment{ticket.analysis.linear_comment_count !== 1 ? 's' : ''}
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-sm text-blue-800">{ticket.analysis.linear_assessment}</p>
                                </div>
                              )}

                              {/* Metadata row */}
                              <div className="flex flex-wrap gap-4 text-xs text-gray-500 pt-2 border-t border-gray-200">
                                <span>Rep: {ticket.analysis.assigned_rep || 'Unassigned'}</span>
                                <span>Ball In Court: {ticket.ballInCourt || '—'}</span>
                                <span>Analyzed: {new Date(ticket.analysis.analyzed_at).toLocaleDateString()}</span>
                              </div>
                            </div>
                          ) : (
                            <div className="text-sm text-gray-500">
                              <span className="font-medium">Not RCM-related</span>
                              <span className="ml-2 text-xs text-gray-400">
                                (Confidence: {(ticket.analysis.confidence * 100).toFixed(0)}%)
                              </span>
                              {/* Still show Linear assessment if available */}
                              {ticket.analysis.linear_assessment && ticket.analysis.linear_assessment !== 'No Linear ticket linked.' && (
                                <div className="mt-2 bg-blue-50 border border-blue-200 rounded-lg p-3">
                                  <div className="text-xs font-semibold uppercase text-blue-600 mb-1">Linear Engineering Context</div>
                                  <p className="text-sm text-blue-800">{ticket.analysis.linear_assessment}</p>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}

                  {/* Expanded Row - Unanalyzed */}
                  {expandedRow === ticket.ticketId && !ticket.analysis && (
                    <tr>
                      <td colSpan={11} className="px-4 py-4 bg-gray-50">
                        <div className="text-sm text-gray-500 text-center">
                          This ticket has not been analyzed yet.{' '}
                          <button
                            onClick={() => analyzeTicket(ticket.ticketId)}
                            disabled={analyzingTickets.has(ticket.ticketId)}
                            className="text-indigo-600 hover:underline"
                          >
                            {analyzingTickets.has(ticket.ticketId) ? 'Analyzing...' : 'Run analysis now'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}

              {filteredTickets.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-8 text-center text-sm text-gray-500">
                    No tickets match the current filters.
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
