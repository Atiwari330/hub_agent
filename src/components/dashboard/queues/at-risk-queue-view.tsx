'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { formatCurrency } from '@/lib/utils/currency';
import { getHubSpotCompanyUrl } from '@/lib/hubspot/urls';
import type { AtRiskCompany, AtRiskQueueResponse } from '@/app/api/queues/at-risk/route';

type SortColumn = 'name' | 'arr' | 'accountStatus' | 'sentiment' | 'contractEnd' | 'lastQbrDate' | 'lastActivityDate';
type SortDirection = 'asc' | 'desc';

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getDaysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  return Math.ceil((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
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

function getContractEndBadge(contractEnd: string | null): { label: string; bgClass: string; textClass: string } | null {
  const daysUntil = getDaysUntil(contractEnd);
  if (daysUntil === null) return null;

  if (daysUntil < 0) {
    return { label: 'Expired', bgClass: 'bg-red-100', textClass: 'text-red-700' };
  }
  if (daysUntil <= 30) {
    return { label: `${daysUntil}d`, bgClass: 'bg-red-100', textClass: 'text-red-700' };
  }
  if (daysUntil <= 60) {
    return { label: `${daysUntil}d`, bgClass: 'bg-orange-100', textClass: 'text-orange-700' };
  }
  if (daysUntil <= 90) {
    return { label: `${daysUntil}d`, bgClass: 'bg-yellow-100', textClass: 'text-yellow-700' };
  }
  return null;
}

export function AtRiskQueueView() {
  const [data, setData] = useState<AtRiskQueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [ownerFilter, setOwnerFilter] = useState<string>('all');
  const [accountStatusFilter, setAccountStatusFilter] = useState<string>('all');

  // Sorting - default to ARR descending (biggest $ at risk first)
  const [sortColumn, setSortColumn] = useState<SortColumn>('arr');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/queues/at-risk');
      if (!response.ok) {
        throw new Error('Failed to fetch at-risk accounts');
      }
      const json: AtRiskQueueResponse = await response.json();
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

  // Extract unique owners from data
  const uniqueOwners = useMemo(() => {
    if (!data) return [];
    const owners = new Map<string, string>();
    for (const company of data.companies) {
      if (company.hubspotOwnerId && company.ownerName) {
        owners.set(company.hubspotOwnerId, company.ownerName);
      }
    }
    return Array.from(owners.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);

  // Extract unique account statuses from data
  const uniqueAccountStatuses = useMemo(() => {
    if (!data) return [];
    const statuses = new Set<string>();
    for (const company of data.companies) {
      if (company.contractStatus) {
        statuses.add(company.contractStatus);
      }
    }
    return Array.from(statuses).sort();
  }, [data]);

  // Filtered and sorted companies
  const processedCompanies = useMemo(() => {
    if (!data) return [];

    let result = [...data.companies];

    // Apply owner filter
    if (ownerFilter !== 'all') {
      result = result.filter((c) => c.hubspotOwnerId === ownerFilter);
    }

    // Apply account status filter
    if (accountStatusFilter !== 'all') {
      result = result.filter((c) => c.contractStatus === accountStatusFilter);
    }

    // Sort
    result.sort((a, b) => {
      let comparison = 0;
      switch (sortColumn) {
        case 'name':
          comparison = (a.name || '').localeCompare(b.name || '');
          break;
        case 'arr':
          comparison = (a.arr || 0) - (b.arr || 0);
          break;
        case 'accountStatus':
          comparison = (a.contractStatus || '').localeCompare(b.contractStatus || '');
          break;
        case 'sentiment':
          comparison = (a.isFlagged ? 1 : 0) - (b.isFlagged ? 1 : 0);
          break;
        case 'contractEnd':
          if (!a.contractEnd && !b.contractEnd) comparison = 0;
          else if (!a.contractEnd) comparison = 1;
          else if (!b.contractEnd) comparison = -1;
          else comparison = new Date(a.contractEnd).getTime() - new Date(b.contractEnd).getTime();
          break;
        case 'lastQbrDate':
          if (!a.latestMeetingDate && !b.latestMeetingDate) comparison = 0;
          else if (!a.latestMeetingDate) comparison = 1;
          else if (!b.latestMeetingDate) comparison = -1;
          else comparison = new Date(a.latestMeetingDate).getTime() - new Date(b.latestMeetingDate).getTime();
          break;
        case 'lastActivityDate':
          if (!a.lastActivityDate && !b.lastActivityDate) comparison = 0;
          else if (!a.lastActivityDate) comparison = 1;
          else if (!b.lastActivityDate) comparison = -1;
          else comparison = new Date(a.lastActivityDate).getTime() - new Date(b.lastActivityDate).getTime();
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [data, ownerFilter, accountStatusFilter, sortColumn, sortDirection]);

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  const hasActiveFilters = ownerFilter !== 'all' || accountStatusFilter !== 'all';

  const clearFilters = () => {
    setOwnerFilter('all');
    setAccountStatusFilter('all');
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">At-Risk Accounts</h1>
        <p className="text-sm text-gray-600 mt-1">
          Customer accounts flagged by CSM sentiment, sorted by ARR.
        </p>
      </div>

      {/* Filters Row */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {/* Owner Filter */}
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Owner:</label>
          <select
            value={ownerFilter}
            onChange={(e) => setOwnerFilter(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="all">All Owners</option>
            {uniqueOwners.map((owner) => (
              <option key={owner.id} value={owner.id}>{owner.name}</option>
            ))}
          </select>
        </div>

        {/* Account Status Filter */}
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Account Status:</label>
          <select
            value={accountStatusFilter}
            onChange={(e) => setAccountStatusFilter(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="all">All Statuses</option>
            {uniqueAccountStatuses.map((status) => (
              <option key={status} value={status}>{status}</option>
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

      {/* Summary Badge */}
      {!loading && data && (
        <div className="flex items-center gap-3 mb-4">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-full bg-red-100 text-red-700">
            <span className="w-2 h-2 rounded-full bg-red-500" />
            {data.counts.flagged} Flagged account{data.counts.flagged !== 1 ? 's' : ''}
          </span>
          <span className="text-sm text-gray-500 ml-2">
            {processedCompanies.length} showing
          </span>
        </div>
      )}

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
      {!loading && !error && processedCompanies.length === 0 && (
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
              : 'No flagged accounts — all clear!'}
          </h3>
          <p className="mt-1 text-sm text-emerald-700">
            {hasActiveFilters
              ? 'Try adjusting the owner or account status filters.'
              : 'All customer accounts are in good health.'}
          </p>
        </div>
      )}

      {/* Companies Table */}
      {!loading && !error && processedCompanies.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 border-b border-gray-200">
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none"
                    onClick={() => handleSort('name')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Company</span>
                      <SortIcon active={sortColumn === 'name'} direction={sortDirection} />
                    </div>
                  </th>
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                    onClick={() => handleSort('arr')}
                  >
                    <div className="flex items-center gap-1">
                      <span>ARR</span>
                      <SortIcon active={sortColumn === 'arr'} direction={sortDirection} />
                    </div>
                  </th>
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                    onClick={() => handleSort('accountStatus')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Account Status</span>
                      <SortIcon active={sortColumn === 'accountStatus'} direction={sortDirection} />
                    </div>
                  </th>
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                    onClick={() => handleSort('sentiment')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Sentiment</span>
                      <SortIcon active={sortColumn === 'sentiment'} direction={sortDirection} />
                    </div>
                  </th>
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                    onClick={() => handleSort('contractEnd')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Contract End</span>
                      <SortIcon active={sortColumn === 'contractEnd'} direction={sortDirection} />
                    </div>
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider whitespace-nowrap">
                    Owner
                  </th>
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                    onClick={() => handleSort('lastQbrDate')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Last QBR</span>
                      <SortIcon active={sortColumn === 'lastQbrDate'} direction={sortDirection} />
                    </div>
                  </th>
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                    onClick={() => handleSort('lastActivityDate')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Last Activity</span>
                      <SortIcon active={sortColumn === 'lastActivityDate'} direction={sortDirection} />
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {processedCompanies.map((company) => {
                  const contractBadge = getContractEndBadge(company.contractEnd);

                  return (
                    <tr
                      key={company.id}
                      className="hover:bg-slate-50 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <a
                          href={getHubSpotCompanyUrl(company.hubspotCompanyId)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-medium text-gray-900 hover:text-indigo-600 transition-colors"
                        >
                          {company.name || 'Unnamed Company'}
                        </a>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm font-semibold text-gray-900 whitespace-nowrap">
                          {company.arr ? formatCurrency(company.arr) : '-'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-gray-600">
                          {company.contractStatus || '-'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {company.sentiment ? (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                            company.sentiment === 'Flagged'
                              ? 'bg-red-100 text-red-700'
                              : 'bg-gray-100 text-gray-700'
                          }`}>
                            {company.sentiment}
                          </span>
                        ) : (
                          <span className="text-sm text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-gray-600 whitespace-nowrap">
                            {formatDate(company.contractEnd)}
                          </span>
                          {contractBadge && (
                            <span className={`text-xs px-1.5 py-0.5 rounded ${contractBadge.bgClass} ${contractBadge.textClass}`}>
                              {contractBadge.label}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-gray-600">
                          {company.ownerName || '-'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-gray-600 whitespace-nowrap">
                          {formatDate(company.latestMeetingDate)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-gray-600 whitespace-nowrap">
                          {formatDate(company.lastActivityDate)}
                        </span>
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
