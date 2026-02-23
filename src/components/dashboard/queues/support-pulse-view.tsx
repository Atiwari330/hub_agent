'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { formatCurrency } from '@/lib/utils/currency';
import { getHubSpotCompanyUrl, getHubSpotTicketUrl } from '@/lib/hubspot/urls';
import type {
  SupportPulseAccount,
  SupportPulseResponse,
} from '@/app/api/queues/support-pulse/route';

type SortColumn =
  | 'companyName'
  | 'arr'
  | 'riskScore'
  | 'openTicketCount'
  | 'slaBreachCount'
  | 'oldestOpenTicketDays'
  | 'engineeringEscalations'
  | 'waitingOnSupport';
type SortDirection = 'asc' | 'desc';

function SortIcon({
  active,
  direction,
}: {
  active: boolean;
  direction: SortDirection;
}) {
  if (!active) {
    return (
      <svg
        className="w-4 h-4 text-gray-400"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"
        />
      </svg>
    );
  }
  return direction === 'asc' ? (
    <svg
      className="w-4 h-4 text-indigo-600"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M5 15l7-7 7 7"
      />
    </svg>
  ) : (
    <svg
      className="w-4 h-4 text-indigo-600"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M19 9l-7 7-7-7"
      />
    </svg>
  );
}

function RiskBadge({ level }: { level: SupportPulseAccount['riskLevel'] }) {
  const styles = {
    Critical: 'bg-red-100 text-red-700',
    Warning: 'bg-orange-100 text-orange-700',
    Watch: 'bg-yellow-100 text-yellow-700',
    Healthy: 'bg-green-100 text-green-700',
  };

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[level]}`}
    >
      {level}
    </span>
  );
}

function formatHours(hours: number | null): string {
  if (hours === null) return '-';
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}

export function SupportPulseView() {
  const [data, setData] = useState<SupportPulseResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  // Filters
  const [riskFilter, setRiskFilter] = useState<string>('non-healthy');
  const [ballInCourtFilter, setBallInCourtFilter] = useState<string>('all');
  const [sourceTypeFilter, setSourceTypeFilter] = useState<string>('all');

  // Sorting
  const [sortColumn, setSortColumn] = useState<SortColumn>('riskScore');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/queues/support-pulse');
      if (!response.ok) {
        throw new Error('Failed to fetch support pulse data');
      }
      const json: SupportPulseResponse = await response.json();
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

  // Extract unique ball-in-court values
  const uniqueBallInCourt = useMemo(() => {
    if (!data) return [];
    const values = new Set<string>();
    for (const account of data.accounts) {
      for (const ticket of account.openTickets) {
        if (ticket.ballInCourt) values.add(ticket.ballInCourt);
      }
    }
    return Array.from(values).sort();
  }, [data]);

  // Extract unique source types
  const uniqueSourceTypes = useMemo(() => {
    if (!data) return [];
    const values = new Set<string>();
    for (const account of data.accounts) {
      for (const ticket of account.openTickets) {
        if (ticket.sourceType) values.add(ticket.sourceType);
      }
    }
    return Array.from(values).sort();
  }, [data]);

  // Filtered and sorted accounts
  const processedAccounts = useMemo(() => {
    if (!data) return [];

    let result = [...data.accounts];

    // Risk level filter
    if (riskFilter === 'non-healthy') {
      result = result.filter((a) => a.riskLevel !== 'Healthy');
    } else if (riskFilter !== 'all') {
      result = result.filter((a) => a.riskLevel === riskFilter);
    }

    // Ball in court filter (applies to accounts that have at least one ticket with the matching BIC)
    if (ballInCourtFilter !== 'all') {
      result = result.filter((a) =>
        a.openTickets.some((t) => t.ballInCourt === ballInCourtFilter)
      );
    }

    // Source type filter
    if (sourceTypeFilter !== 'all') {
      result = result.filter((a) =>
        a.openTickets.some((t) => t.sourceType === sourceTypeFilter)
      );
    }

    // Sort
    result.sort((a, b) => {
      let comparison = 0;
      switch (sortColumn) {
        case 'companyName':
          comparison = (a.companyName || '').localeCompare(
            b.companyName || ''
          );
          break;
        case 'arr':
          comparison = (a.arr || 0) - (b.arr || 0);
          break;
        case 'riskScore':
          comparison = a.riskScore - b.riskScore;
          break;
        case 'openTicketCount':
          comparison = a.openTicketCount - b.openTicketCount;
          break;
        case 'slaBreachCount':
          comparison = a.slaBreachCount - b.slaBreachCount;
          break;
        case 'oldestOpenTicketDays':
          comparison = a.oldestOpenTicketDays - b.oldestOpenTicketDays;
          break;
        case 'engineeringEscalations':
          comparison = a.engineeringEscalations - b.engineeringEscalations;
          break;
        case 'waitingOnSupport':
          comparison = a.waitingOnSupport - b.waitingOnSupport;
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [data, riskFilter, ballInCourtFilter, sourceTypeFilter, sortColumn, sortDirection]);

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  const hasActiveFilters =
    riskFilter !== 'non-healthy' ||
    ballInCourtFilter !== 'all' ||
    sourceTypeFilter !== 'all';

  const clearFilters = () => {
    setRiskFilter('non-healthy');
    setBallInCourtFilter('all');
    setSourceTypeFilter('all');
  };

  const toggleRow = (key: string) => {
    setExpandedRow(expandedRow === key ? null : key);
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Support Pulse</h1>
        <p className="text-sm text-gray-600 mt-1">
          Account-level support health — which accounts have the most support
          pain right now?
        </p>
      </div>

      {/* Summary Banner */}
      {!loading && data && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <div className="bg-white rounded-lg border border-gray-200 p-3">
            <div className="text-xs text-gray-500 uppercase tracking-wider">
              Open Tickets
            </div>
            <div className="text-2xl font-bold text-gray-900 mt-1">
              {data.summary.totalOpenTickets}
            </div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-3">
            <div className="text-xs text-gray-500 uppercase tracking-wider">
              SLA Breaches
            </div>
            <div className="text-2xl font-bold text-red-600 mt-1">
              {data.summary.totalSLABreaches}
            </div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-3">
            <div className="text-xs text-gray-500 uppercase tracking-wider">
              Eng Escalations
            </div>
            <div className="text-2xl font-bold text-orange-600 mt-1">
              {data.summary.totalEscalations}
            </div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-3">
            <div className="text-xs text-gray-500 uppercase tracking-wider">
              Avg Resolution
            </div>
            <div className="text-2xl font-bold text-gray-900 mt-1">
              {formatHours(data.summary.avgResolutionHours)}
            </div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-3">
            <div className="text-xs text-gray-500 uppercase tracking-wider">
              Accounts at Risk
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-sm font-semibold text-red-600">
                {data.counts.critical} critical
              </span>
              <span className="text-sm font-semibold text-orange-600">
                {data.counts.warning} warning
              </span>
              <span className="text-sm font-semibold text-yellow-600">
                {data.counts.watch} watch
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Filters Row */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Risk Level:</label>
          <select
            value={riskFilter}
            onChange={(e) => setRiskFilter(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="all">All</option>
            <option value="non-healthy">Needs Attention</option>
            <option value="Critical">Critical</option>
            <option value="Warning">Warning</option>
            <option value="Watch">Watch</option>
            <option value="Healthy">Healthy</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Ball In Court:</label>
          <select
            value={ballInCourtFilter}
            onChange={(e) => setBallInCourtFilter(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="all">All</option>
            {uniqueBallInCourt.map((bic) => (
              <option key={bic} value={bic}>
                {bic}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Source:</label>
          <select
            value={sourceTypeFilter}
            onChange={(e) => setSourceTypeFilter(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="all">All Sources</option>
            {uniqueSourceTypes.map((src) => (
              <option key={src} value={src}>
                {src}
              </option>
            ))}
          </select>
        </div>

        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Clear filters
          </button>
        )}

        <span className="text-sm text-gray-500 ml-auto">
          {processedAccounts.length} account
          {processedAccounts.length !== 1 ? 's' : ''} showing
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
          <button
            onClick={fetchData}
            className="mt-2 text-sm text-red-600 hover:text-red-800 font-medium"
          >
            Try again
          </button>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && processedAccounts.length === 0 && (
        <div className="text-center py-12 bg-emerald-50 rounded-lg border border-emerald-200">
          <svg
            className="mx-auto h-12 w-12 text-emerald-500"
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
          <h3 className="mt-4 text-lg font-medium text-emerald-900">
            {hasActiveFilters
              ? 'No accounts match the current filters'
              : 'No support issues — all clear!'}
          </h3>
          <p className="mt-1 text-sm text-emerald-700">
            {hasActiveFilters
              ? 'Try adjusting the filters.'
              : 'No open support tickets found.'}
          </p>
        </div>
      )}

      {/* Accounts Table */}
      {!loading && !error && processedAccounts.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 border-b border-gray-200">
                  {/* Expand chevron column */}
                  <th className="w-8 px-2 py-3"></th>
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none"
                    onClick={() => handleSort('companyName')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Company</span>
                      <SortIcon
                        active={sortColumn === 'companyName'}
                        direction={sortDirection}
                      />
                    </div>
                  </th>
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                    onClick={() => handleSort('arr')}
                  >
                    <div className="flex items-center gap-1">
                      <span>ARR</span>
                      <SortIcon
                        active={sortColumn === 'arr'}
                        direction={sortDirection}
                      />
                    </div>
                  </th>
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                    onClick={() => handleSort('riskScore')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Risk</span>
                      <SortIcon
                        active={sortColumn === 'riskScore'}
                        direction={sortDirection}
                      />
                    </div>
                  </th>
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                    onClick={() => handleSort('openTicketCount')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Open</span>
                      <SortIcon
                        active={sortColumn === 'openTicketCount'}
                        direction={sortDirection}
                      />
                    </div>
                  </th>
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                    onClick={() => handleSort('slaBreachCount')}
                  >
                    <div className="flex items-center gap-1">
                      <span>SLA Breach</span>
                      <SortIcon
                        active={sortColumn === 'slaBreachCount'}
                        direction={sortDirection}
                      />
                    </div>
                  </th>
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                    onClick={() => handleSort('oldestOpenTicketDays')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Oldest</span>
                      <SortIcon
                        active={sortColumn === 'oldestOpenTicketDays'}
                        direction={sortDirection}
                      />
                    </div>
                  </th>
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                    onClick={() => handleSort('engineeringEscalations')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Eng Esc</span>
                      <SortIcon
                        active={sortColumn === 'engineeringEscalations'}
                        direction={sortDirection}
                      />
                    </div>
                  </th>
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                    onClick={() => handleSort('waitingOnSupport')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Waiting On Us</span>
                      <SortIcon
                        active={sortColumn === 'waitingOnSupport'}
                        direction={sortDirection}
                      />
                    </div>
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider whitespace-nowrap">
                    Alert Reasons
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {processedAccounts.map((account) => {
                  const rowKey = account.companyId || '__no_company__';
                  const isExpanded = expandedRow === rowKey;

                  return (
                    <React.Fragment key={rowKey}>
                      <tr
                        className="hover:bg-slate-50 transition-colors cursor-pointer"
                        onClick={() => toggleRow(rowKey)}
                      >
                        <td className="px-2 py-3">
                          <svg
                            className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M9 5l7 7-7 7"
                            />
                          </svg>
                        </td>
                        <td className="px-4 py-3">
                          {account.companyId ? (
                            <a
                              href={getHubSpotCompanyUrl(account.companyId)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm font-medium text-gray-900 hover:text-indigo-600 transition-colors"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {account.companyName || 'Unnamed Company'}
                            </a>
                          ) : (
                            <span className="text-sm text-gray-500 italic">
                              No Company
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm font-semibold text-gray-900 whitespace-nowrap">
                            {account.arr
                              ? formatCurrency(account.arr)
                              : '-'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <RiskBadge level={account.riskLevel} />
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm font-medium text-gray-900">
                            {account.openTicketCount}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {account.slaBreachCount > 0 ? (
                            <span className="inline-flex items-center gap-1 text-sm font-medium text-red-600">
                              <span className="w-2 h-2 rounded-full bg-red-500" />
                              {account.slaBreachCount}
                            </span>
                          ) : (
                            <span className="text-sm text-gray-400">0</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`text-sm ${account.oldestOpenTicketDays >= 14 ? 'font-medium text-red-600' : account.oldestOpenTicketDays >= 7 ? 'text-orange-600' : 'text-gray-600'}`}
                          >
                            {account.oldestOpenTicketDays}d
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {account.engineeringEscalations > 0 ? (
                            <span className="text-sm font-medium text-orange-600">
                              {account.engineeringEscalations}
                            </span>
                          ) : (
                            <span className="text-sm text-gray-400">0</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {account.waitingOnSupport > 0 ? (
                            <span className="text-sm font-medium text-amber-600">
                              {account.waitingOnSupport}
                            </span>
                          ) : (
                            <span className="text-sm text-gray-400">0</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {account.alertReasons.map((reason, i) => (
                              <span
                                key={i}
                                className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600"
                              >
                                {reason}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>

                      {/* Expanded Drill-Down */}
                      {isExpanded && (
                        <tr>
                          <td colSpan={10} className="px-0 py-0">
                            <div className="bg-slate-50 border-y border-gray-200 px-8 py-3">
                              <table className="w-full">
                                <thead>
                                  <tr>
                                    <th className="text-left px-3 py-2 text-xs font-medium text-slate-500 uppercase tracking-wider">
                                      Subject
                                    </th>
                                    <th className="text-left px-3 py-2 text-xs font-medium text-slate-500 uppercase tracking-wider">
                                      Source
                                    </th>
                                    <th className="text-left px-3 py-2 text-xs font-medium text-slate-500 uppercase tracking-wider">
                                      Age
                                    </th>
                                    <th className="text-left px-3 py-2 text-xs font-medium text-slate-500 uppercase tracking-wider">
                                      Priority
                                    </th>
                                    <th className="text-left px-3 py-2 text-xs font-medium text-slate-500 uppercase tracking-wider">
                                      Stage
                                    </th>
                                    <th className="text-left px-3 py-2 text-xs font-medium text-slate-500 uppercase tracking-wider">
                                      Ball In Court
                                    </th>
                                    <th className="text-left px-3 py-2 text-xs font-medium text-slate-500 uppercase tracking-wider">
                                      SLA
                                    </th>
                                    <th className="text-left px-3 py-2 text-xs font-medium text-slate-500 uppercase tracking-wider">
                                      Eng
                                    </th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                  {account.openTickets.map((ticket) => (
                                    <tr
                                      key={ticket.ticketId}
                                      className="hover:bg-white transition-colors"
                                    >
                                      <td className="px-3 py-2">
                                        <a
                                          href={getHubSpotTicketUrl(
                                            ticket.ticketId
                                          )}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-sm text-gray-900 hover:text-indigo-600 transition-colors"
                                        >
                                          {ticket.subject || 'No subject'}
                                        </a>
                                      </td>
                                      <td className="px-3 py-2 text-sm text-gray-600">
                                        {ticket.sourceType || '-'}
                                      </td>
                                      <td className="px-3 py-2">
                                        <span
                                          className={`text-sm ${ticket.ageDays >= 14 ? 'font-medium text-red-600' : ticket.ageDays >= 7 ? 'text-orange-600' : 'text-gray-600'}`}
                                        >
                                          {ticket.ageDays}d
                                        </span>
                                      </td>
                                      <td className="px-3 py-2 text-sm text-gray-600">
                                        {ticket.priority || '-'}
                                      </td>
                                      <td className="px-3 py-2 text-sm text-gray-600">
                                        {ticket.pipelineStage || '-'}
                                      </td>
                                      <td className="px-3 py-2 text-sm text-gray-600">
                                        {ticket.ballInCourt || '-'}
                                      </td>
                                      <td className="px-3 py-2">
                                        {ticket.hasSLABreach ? (
                                          <span className="inline-flex items-center gap-1 text-xs text-red-600">
                                            <span className="w-2 h-2 rounded-full bg-red-500" />
                                            Breached
                                          </span>
                                        ) : (
                                          <span className="text-sm text-gray-400">
                                            -
                                          </span>
                                        )}
                                      </td>
                                      <td className="px-3 py-2">
                                        {ticket.hasLinearTask ? (
                                          <span className="inline-flex items-center gap-1 text-xs text-orange-600">
                                            <span className="w-2 h-2 rounded-full bg-orange-500" />
                                            Linear
                                          </span>
                                        ) : (
                                          <span className="text-sm text-gray-400">
                                            -
                                          </span>
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              {account.avgTimeToCloseHours !== null && (
                                <div className="mt-2 text-xs text-gray-500">
                                  Avg resolution time (90d):{' '}
                                  {formatHours(account.avgTimeToCloseHours)}
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
