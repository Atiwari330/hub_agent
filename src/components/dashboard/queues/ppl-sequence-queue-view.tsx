'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { formatCurrency } from '@/lib/utils/currency';
import { getHubSpotDealUrl } from '@/lib/hubspot/urls';
import type { Week1TouchAnalysis } from '@/lib/utils/touch-counter';

// ===== Types =====

interface PplSequenceDeal {
  id: string;
  hubspotDealId: string;
  dealName: string;
  amount: number | null;
  stageName: string;
  stageId: string;
  ownerName: string;
  ownerId: string;
  closeDate: string | null;
  hubspotCreatedAt: string | null;
  dealAgeDays: number;
  week1Analysis: Week1TouchAnalysis | null;
  needsActivityCheck: boolean;
}

interface QueueResponse {
  deals: PplSequenceDeal[];
  counts: {
    on_track: number;
    behind: number;
    critical: number;
    pending: number;
  };
}

type SortColumn = 'dealName' | 'ownerName' | 'amount' | 'dealAgeDays' | 'touches' | 'gap';
type SortDirection = 'asc' | 'desc';
type StatusFilter = 'all' | 'on_track' | 'behind' | 'critical' | 'pending';

// ===== Constants =====

const STATUS_COLORS = {
  on_track: { bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500', label: 'On Track' },
  behind: { bg: 'bg-amber-100', text: 'text-amber-700', dot: 'bg-amber-500', label: 'Behind' },
  critical: { bg: 'bg-red-100', text: 'text-red-700', dot: 'bg-red-500', label: 'Critical' },
  pending: { bg: 'bg-gray-100', text: 'text-gray-500', dot: 'bg-gray-400', label: 'Pending' },
};

const TOTAL_COLUMNS = 9; // chevron + 8 data columns

// Stage filter options (map stage IDs to readable names)
const STAGE_OPTIONS = [
  { value: 'all', label: 'All Stages' },
  { value: '17915773', label: 'SQL' },
  { value: '138092708', label: 'Discovery' },
  { value: 'baedc188-ba76-4a41-8723-5bb99fe7c5bf', label: 'Demo Scheduled' },
  { value: '963167283', label: 'Demo Completed' },
  { value: '59865091', label: 'Proposal' },
];

// Created date filter options
const DATE_OPTIONS = [
  { value: 'all', label: 'All Time' },
  { value: '7', label: 'Last 7 Days' },
  { value: '14', label: 'Last 14 Days' },
  { value: '30', label: 'Last 30 Days' },
];

// ===== Helpers =====

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getStatusForDeal(deal: PplSequenceDeal): 'on_track' | 'behind' | 'critical' | 'pending' {
  if (deal.needsActivityCheck || !deal.week1Analysis) return 'pending';
  return deal.week1Analysis.status;
}

// ===== Sub-Components =====

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

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <span className="inline-flex p-1 rounded hover:bg-gray-200 transition-colors">
      <svg
        className={`w-4 h-4 text-gray-500 transition-transform ${expanded ? 'rotate-90' : ''}`}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </span>
  );
}

function StatusBadge({ status }: { status: 'on_track' | 'behind' | 'critical' | 'pending' }) {
  const config = STATUS_COLORS[status];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded-full ${config.bg} ${config.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
      {config.label}
    </span>
  );
}

function TouchProgressBar({ touches, target }: { touches: number; target: number }) {
  const percentage = Math.min(100, (touches / target) * 100);
  const isComplete = touches >= target;

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-3 bg-gray-200 rounded-full overflow-hidden max-w-[120px]">
        <div
          className={`h-full rounded-full transition-all ${isComplete ? 'bg-emerald-500' : 'bg-amber-500'}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span className={`text-sm font-semibold tabular-nums ${isComplete ? 'text-emerald-600' : 'text-gray-700'}`}>
        {touches}/{target}
      </span>
    </div>
  );
}

function ExpandedDealPanel({ deal }: { deal: PplSequenceDeal }) {
  const analysis = deal.week1Analysis;

  return (
    <div className="p-5 bg-slate-50 border-t border-gray-200">
      <div className="grid grid-cols-3 gap-6">
        {/* Left: Touch Breakdown */}
        <div>
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Week 1 Touch Breakdown
          </h4>
          {analysis ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">Calls</span>
                <span className="font-medium">{analysis.touches.calls}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">Outbound Emails</span>
                <span className="font-medium">{analysis.touches.emails}</span>
              </div>
              <div className="flex items-center justify-between text-sm border-t pt-2 mt-2">
                <span className="text-gray-700 font-medium">Total Touches</span>
                <span className="font-bold">{analysis.touches.total}</span>
              </div>
              {analysis.touches.lastTouchDate && (
                <div className="flex items-center justify-between text-sm pt-2 border-t">
                  <span className="text-gray-600">Last Touch</span>
                  <span className="text-gray-900">{formatDate(analysis.touches.lastTouchDate)}</span>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-400 italic">Activity data not loaded</p>
          )}
        </div>

        {/* Center: Compliance Status */}
        <div>
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Compliance Status
          </h4>
          {analysis ? (
            <div className="space-y-3">
              <div className={`p-3 rounded-lg ${
                analysis.status === 'on_track' ? 'bg-emerald-50 border border-emerald-200' :
                analysis.status === 'behind' ? 'bg-amber-50 border border-amber-200' :
                'bg-red-50 border border-red-200'
              }`}>
                <div className="flex items-center gap-2 mb-1">
                  <StatusBadge status={analysis.status} />
                </div>
                <p className="text-sm text-gray-700">
                  {analysis.status === 'on_track'
                    ? 'Meeting target touch cadence for Week 1'
                    : analysis.isInWeek1
                    ? `Need ${analysis.gap} more touches to meet target`
                    : `Missed target by ${analysis.gap} touches`}
                </p>
              </div>
              <div className="text-xs text-gray-500">
                <span>Week 1 ends: {formatDate(analysis.week1EndDate)}</span>
                {analysis.isInWeek1 && (
                  <span className="ml-2 text-indigo-600 font-medium">(In Progress)</span>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-400 italic">Status pending activity check</p>
          )}
        </div>

        {/* Right: Actions */}
        <div>
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Actions
          </h4>
          <div className="space-y-2">
            <a
              href={getHubSpotDealUrl(deal.hubspotDealId)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Open in HubSpot
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          </div>
          {/* Deal Info */}
          <div className="mt-4 space-y-1 text-xs text-gray-500">
            <div><span className="text-gray-400">Created:</span> {formatDate(deal.hubspotCreatedAt)}</div>
            <div><span className="text-gray-400">Stage:</span> {deal.stageName}</div>
            <div><span className="text-gray-400">Close Date:</span> {formatDate(deal.closeDate)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ===== Main Component =====

export function PplSequenceQueueView() {
  // State
  const [allDeals, setAllDeals] = useState<PplSequenceDeal[]>([]);
  const [counts, setCounts] = useState({ on_track: 0, behind: 0, critical: 0, pending: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [aeFilter, setAeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [stageFilter, setStageFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<string>('all');

  // Sorting - default to youngest deals first (Age ascending)
  const [sortColumn, setSortColumn] = useState<SortColumn>('dealAgeDays');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  // Expandable rows
  const [expandedDealId, setExpandedDealId] = useState<string | null>(null);

  // Extract unique AEs from deals
  const uniqueAEs = useMemo(() => {
    const aes = new Map<string, string>();
    for (const deal of allDeals) {
      if (deal.ownerId && deal.ownerName) {
        aes.set(deal.ownerId, deal.ownerName);
      }
    }
    return Array.from(aes.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allDeals]);

  // Filter and sort
  const filteredDeals = useMemo(() => {
    let result = allDeals;

    // Filter by AE
    if (aeFilter !== 'all') {
      result = result.filter((d) => d.ownerId === aeFilter);
    }

    // Filter by status
    if (statusFilter !== 'all') {
      result = result.filter((d) => getStatusForDeal(d) === statusFilter);
    }

    // Filter by stage
    if (stageFilter !== 'all') {
      result = result.filter((d) => d.stageId === stageFilter);
    }

    // Filter by created date
    if (dateFilter !== 'all') {
      const days = parseInt(dateFilter, 10);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);
      result = result.filter((d) => {
        if (!d.hubspotCreatedAt) return false;
        const createdDate = new Date(d.hubspotCreatedAt);
        return createdDate >= cutoffDate;
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
        case 'dealAgeDays':
          comparison = a.dealAgeDays - b.dealAgeDays;
          break;
        case 'touches':
          const touchesA = a.week1Analysis?.touches.total || 0;
          const touchesB = b.week1Analysis?.touches.total || 0;
          comparison = touchesA - touchesB;
          break;
        case 'gap':
          const gapA = a.week1Analysis?.gap ?? 999;
          const gapB = b.week1Analysis?.gap ?? 999;
          comparison = gapA - gapB;
          break;
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [allDeals, aeFilter, statusFilter, stageFilter, dateFilter, sortColumn, sortDirection]);

  // Fetch data
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/queues/ppl-sequence');
      if (!response.ok) {
        throw new Error('Failed to fetch PPL sequence data');
      }
      const json: QueueResponse = await response.json();
      setAllDeals(json.deals || []);
      setCounts(json.counts || { on_track: 0, behind: 0, critical: 0, pending: 0 });
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

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  const toggleExpanded = (dealId: string) => {
    setExpandedDealId((prev) => (prev === dealId ? null : dealId));
  };

  const hasActiveFilters = aeFilter !== 'all' || statusFilter !== 'all' || stageFilter !== 'all' || dateFilter !== 'all';

  const clearFilters = () => {
    setAeFilter('all');
    setStatusFilter('all');
    setStageFilter('all');
    setDateFilter('all');
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">PPL Sequence Compliance</h1>
        <p className="text-sm text-gray-600 mt-1">
          Track Week 1 touch compliance for Paid Per Lead deals. Target: 6 touches in first 5 business days.
        </p>
      </div>

      {/* Filters Row */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {/* AE Filter */}
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

        {/* Status Filter */}
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Status:</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="all">All</option>
            <option value="on_track">On Track</option>
            <option value="behind">Behind</option>
            <option value="critical">Critical</option>
          </select>
        </div>

        {/* Stage Filter */}
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Stage:</label>
          <select
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {STAGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>

        {/* Created Date Filter */}
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Created:</label>
          <select
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {DATE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>

        {/* Clear Filters */}
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Summary Badges */}
      {!loading && allDeals.length > 0 && (
        <div className="flex items-center gap-3 mb-4">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-full bg-emerald-100 text-emerald-700">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            {counts.on_track} On Track
          </span>
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-full bg-amber-100 text-amber-700">
            <span className="w-2 h-2 rounded-full bg-amber-500" />
            {counts.behind} Behind
          </span>
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-full bg-red-100 text-red-700">
            <span className="w-2 h-2 rounded-full bg-red-500" />
            {counts.critical} Critical
          </span>
          <span className="text-sm text-gray-500 ml-2">
            {allDeals.length} PPL deals total
          </span>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mb-4"></div>
          <p className="text-sm text-gray-500">Loading activity data from HubSpot...</p>
          <p className="text-xs text-gray-400 mt-1">This may take a moment for many deals</p>
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
          <h3 className="mt-4 text-lg font-medium text-gray-900">No PPL deals found</h3>
          <p className="mt-1 text-sm text-gray-500">
            {hasActiveFilters
              ? 'No deals match the current filters. Try adjusting the filters.'
              : 'No Paid Per Lead deals found in active pipeline stages.'}
          </p>
        </div>
      )}

      {/* Deals Table */}
      {!loading && !error && filteredDeals.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 border-b border-gray-200">
                  <th className="w-10 px-2 py-3" />
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
                    onClick={() => handleSort('dealAgeDays')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Age</span>
                      <SortIcon active={sortColumn === 'dealAgeDays'} direction={sortDirection} />
                    </div>
                  </th>
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                    onClick={() => handleSort('touches')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Week 1 Touches</span>
                      <SortIcon active={sortColumn === 'touches'} direction={sortDirection} />
                    </div>
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider whitespace-nowrap">
                    Calls
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider whitespace-nowrap">
                    Emails
                  </th>
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                    onClick={() => handleSort('gap')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Gap</span>
                      <SortIcon active={sortColumn === 'gap'} direction={sortDirection} />
                    </div>
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider whitespace-nowrap">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredDeals.map((deal) => {
                  const status = getStatusForDeal(deal);
                  const isExpanded = expandedDealId === deal.id;
                  const analysis = deal.week1Analysis;

                  return (
                    <React.Fragment key={deal.id}>
                      <tr
                        className={`hover:bg-slate-50 transition-colors cursor-pointer ${isExpanded ? 'bg-slate-50' : ''}`}
                        onClick={() => toggleExpanded(deal.id)}
                      >
                        <td className="px-2 py-3 text-center">
                          <ChevronIcon expanded={isExpanded} />
                        </td>
                        <td className="px-4 py-3">
                          <a
                            href={getHubSpotDealUrl(deal.hubspotDealId)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm font-medium text-gray-900 hover:text-indigo-600 transition-colors"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {deal.dealName}
                          </a>
                          {deal.amount && (
                            <span className="ml-2 text-xs text-gray-400">{formatCurrency(deal.amount)}</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-gray-600">{deal.ownerName}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-gray-600 tabular-nums">{deal.dealAgeDays}d</span>
                        </td>
                        <td className="px-4 py-3">
                          {analysis ? (
                            <TouchProgressBar touches={analysis.touches.total} target={analysis.target} />
                          ) : (
                            <span className="text-xs text-gray-400 italic">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-gray-600 tabular-nums">
                            {analysis?.touches.calls ?? '-'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-gray-600 tabular-nums">
                            {analysis?.touches.emails ?? '-'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {analysis ? (
                            <span className={`text-sm font-medium tabular-nums ${
                              analysis.gap === 0 ? 'text-emerald-600' :
                              analysis.gap <= 2 ? 'text-amber-600' :
                              'text-red-600'
                            }`}>
                              {analysis.gap === 0 ? '-' : `-${analysis.gap}`}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400 italic">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={status} />
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={TOTAL_COLUMNS} className="p-0">
                            <ExpandedDealPanel deal={deal} />
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
