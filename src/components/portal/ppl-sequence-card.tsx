'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { formatCurrency } from '@/lib/utils/currency';
import { getHubSpotDealUrl } from '@/lib/hubspot/urls';
import type { PplSequenceDeal, QueueResponse } from '@/types/ppl-sequence';

// ===== Types =====

type SortColumn = 'dealName' | 'dealAgeDays' | 'touches' | 'gap';
type SortDirection = 'asc' | 'desc';
type StatusFilter = 'all' | 'on_track' | 'behind' | 'critical' | 'meeting_booked';
type AgeFilter = '7' | '14' | '30' | 'all';

const AGE_OPTIONS: { value: AgeFilter; label: string }[] = [
  { value: '7', label: '\u2264 7 days' },
  { value: '14', label: '\u2264 14 days' },
  { value: '30', label: '\u2264 30 days' },
  { value: 'all', label: 'All Ages' },
];

// ===== Constants =====

const STATUS_COLORS = {
  on_track: { bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500', label: 'On Track' },
  meeting_booked: { bg: 'bg-blue-100', text: 'text-blue-700', dot: 'bg-blue-500', label: 'Meeting Booked' },
  behind: { bg: 'bg-amber-100', text: 'text-amber-700', dot: 'bg-amber-500', label: 'Behind' },
  critical: { bg: 'bg-red-100', text: 'text-red-700', dot: 'bg-red-500', label: 'Critical' },
  pending: { bg: 'bg-gray-100', text: 'text-gray-500', dot: 'bg-gray-400', label: 'Pending' },
};

const TOTAL_COLUMNS = 9; // chevron + 8 data columns (no AE column)

// ===== Helpers =====

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getStatusForDeal(deal: PplSequenceDeal): 'on_track' | 'behind' | 'critical' | 'meeting_booked' | 'pending' {
  if (deal.needsActivityCheck || !deal.week1Analysis) return 'pending';
  if (deal.meetingBooked) return 'meeting_booked';
  return deal.week1Analysis.status;
}

// ===== Sub-Components =====

function SortIcon({ active, direction }: { active: boolean; direction: SortDirection }) {
  if (!active) {
    return (
      <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
      </svg>
    );
  }
  return direction === 'asc' ? (
    <svg className="w-3.5 h-3.5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
    </svg>
  ) : (
    <svg className="w-3.5 h-3.5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <span className="inline-flex p-0.5 rounded hover:bg-gray-200 transition-colors">
      <svg
        className={`w-3.5 h-3.5 text-gray-500 transition-transform ${expanded ? 'rotate-90' : ''}`}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </span>
  );
}

function StatusBadge({ status }: { status: 'on_track' | 'behind' | 'critical' | 'meeting_booked' | 'pending' }) {
  const config = STATUS_COLORS[status];
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded-full ${config.bg} ${config.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
      {config.label}
    </span>
  );
}

function TouchProgressBar({ touches, target }: { touches: number; target: number }) {
  const percentage = Math.min(100, (touches / target) * 100);
  const isComplete = touches >= target;

  return (
    <div className="flex items-center gap-1.5">
      <div className="flex-1 h-2.5 bg-gray-200 rounded-full overflow-hidden max-w-[80px]">
        <div
          className={`h-full rounded-full transition-all ${isComplete ? 'bg-emerald-500' : 'bg-amber-500'}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span className={`text-xs font-semibold tabular-nums ${isComplete ? 'text-emerald-600' : 'text-gray-700'}`}>
        {touches}/{target}
      </span>
    </div>
  );
}

function ExpandedDealPanel({ deal }: { deal: PplSequenceDeal }) {
  const analysis = deal.week1Analysis;

  return (
    <div className="px-4 py-4 bg-slate-50 border-t border-gray-200">
      <div className="grid grid-cols-2 gap-4">
        {/* Left: Touch Breakdown */}
        <div>
          <h4 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Week 1 Touch Breakdown
          </h4>
          {analysis ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-600">Calls</span>
                <span className="font-medium">{analysis.touches.calls}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-600">Outbound Emails</span>
                <span className="font-medium">{analysis.touches.emails}</span>
              </div>
              <div className="flex items-center justify-between text-xs border-t pt-1.5 mt-1.5">
                <span className="text-gray-700 font-medium">Total Touches</span>
                <span className="font-bold">{analysis.touches.total}</span>
              </div>
              {analysis.touches.lastTouchDate && (
                <div className="flex items-center justify-between text-xs pt-1.5 border-t">
                  <span className="text-gray-600">Last Touch</span>
                  <span className="text-gray-900">{formatDate(analysis.touches.lastTouchDate)}</span>
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-gray-400 italic">Activity data not loaded</p>
          )}
        </div>

        {/* Right: Compliance Status + Actions */}
        <div>
          <h4 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Compliance Status
          </h4>
          {analysis ? (
            <div className="space-y-2">
              {deal.meetingBooked ? (
                <div className="p-2.5 rounded-lg bg-blue-50 border border-blue-200">
                  <StatusBadge status="meeting_booked" />
                  <p className="text-xs text-gray-700 mt-1">
                    Meeting booked {formatDate(deal.meetingBookedDate)} — auto-compliant
                  </p>
                </div>
              ) : (
                <div className={`p-2.5 rounded-lg ${
                  analysis.status === 'on_track' ? 'bg-emerald-50 border border-emerald-200' :
                  analysis.status === 'behind' ? 'bg-amber-50 border border-amber-200' :
                  'bg-red-50 border border-red-200'
                }`}>
                  <StatusBadge status={analysis.status} />
                  <p className="text-xs text-gray-700 mt-1">
                    {analysis.status === 'on_track'
                      ? 'Meeting target touch cadence for Week 1'
                      : analysis.isInWeek1
                      ? `Need ${analysis.gap} more touches to meet target`
                      : `Missed target by ${analysis.gap} touches`}
                  </p>
                </div>
              )}
              <div className="text-[10px] text-gray-500">
                <span>Week 1 ends: {formatDate(analysis.week1EndDate)}</span>
                {analysis.isInWeek1 && (
                  <span className="ml-1.5 text-indigo-600 font-medium">(In Progress)</span>
                )}
              </div>
            </div>
          ) : (
            <p className="text-xs text-gray-400 italic">Status pending activity check</p>
          )}

          {/* Actions */}
          <div className="mt-3 pt-3 border-t border-gray-200">
            <a
              href={getHubSpotDealUrl(deal.hubspotDealId)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium rounded-md bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Open in HubSpot
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
            <div className="mt-2 space-y-0.5 text-[10px] text-gray-500">
              <div><span className="text-gray-400">Created:</span> {formatDate(deal.hubspotCreatedAt)}</div>
              <div><span className="text-gray-400">Stage:</span> {deal.stageName}</div>
              <div><span className="text-gray-400">Close Date:</span> {formatDate(deal.closeDate)}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ===== Main Component =====

export function PplSequenceCard() {
  const [allDeals, setAllDeals] = useState<PplSequenceDeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters & sort
  const [ageFilter, setAgeFilter] = useState<AgeFilter>('7');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortColumn, setSortColumn] = useState<SortColumn>('dealAgeDays');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  // Expandable rows
  const [expandedDealId, setExpandedDealId] = useState<string | null>(null);

  // Filter and sort deals
  const filteredDeals = useMemo(() => {
    let result = allDeals;

    if (ageFilter !== 'all') {
      const maxAge = parseInt(ageFilter, 10);
      result = result.filter((d) => d.dealAgeDays <= maxAge);
    }

    if (statusFilter !== 'all') {
      result = result.filter((d) => getStatusForDeal(d) === statusFilter);
    }

    result = [...result].sort((a, b) => {
      let comparison = 0;

      switch (sortColumn) {
        case 'dealName':
          comparison = a.dealName.localeCompare(b.dealName);
          break;
        case 'dealAgeDays':
          comparison = a.dealAgeDays - b.dealAgeDays;
          break;
        case 'touches': {
          const touchesA = a.week1Analysis?.touches.total || 0;
          const touchesB = b.week1Analysis?.touches.total || 0;
          comparison = touchesA - touchesB;
          break;
        }
        case 'gap': {
          const gapA = a.week1Analysis?.gap ?? 999;
          const gapB = b.week1Analysis?.gap ?? 999;
          comparison = gapA - gapB;
          break;
        }
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [allDeals, ageFilter, statusFilter, sortColumn, sortDirection]);

  // Fetch data
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/portal/ppl-sequence');
      if (!response.ok) {
        throw new Error('Failed to fetch PPL sequence data');
      }
      const json: QueueResponse = await response.json();
      setAllDeals(json.deals || []);
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

  return (
    <div className="bg-white rounded-2xl shadow-sm p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
          PPL Sequence Compliance
        </p>
        {!loading && allDeals.length > 0 && (
          <div className="flex items-center gap-2">
            <select
              value={ageFilter}
              onChange={(e) => setAgeFilter(e.target.value as AgeFilter)}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              {AGE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="all">All Status</option>
              <option value="on_track">On Track</option>
              <option value="meeting_booked">Meeting Booked</option>
              <option value="behind">Behind</option>
              <option value="critical">Critical</option>
            </select>
          </div>
        )}
      </div>

      {/* Summary Badges — derived from age-filtered deals */}
      {!loading && allDeals.length > 0 && (() => {
        const ageFiltered = ageFilter !== 'all'
          ? allDeals.filter((d) => d.dealAgeDays <= parseInt(ageFilter, 10))
          : allDeals;
        const badgeCounts = { on_track: 0, behind: 0, critical: 0, meeting_booked: 0 };
        for (const d of ageFiltered) {
          const s = getStatusForDeal(d);
          if (s in badgeCounts) badgeCounts[s as keyof typeof badgeCounts]++;
        }
        return (
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <span className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-full bg-emerald-100 text-emerald-700">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              {badgeCounts.on_track} On Track
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-full bg-blue-100 text-blue-700">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
              {badgeCounts.meeting_booked} Meeting
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-full bg-amber-100 text-amber-700">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              {badgeCounts.behind} Behind
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-full bg-red-100 text-red-700">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
              {badgeCounts.critical} Critical
            </span>
            <span className="text-[10px] text-gray-400 ml-1">
              {ageFiltered.length} total
            </span>
          </div>
        );
      })()}

      {/* Loading State */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-10">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600 mb-3"></div>
          <p className="text-xs text-gray-500">Loading activity data from HubSpot...</p>
          <p className="text-[10px] text-gray-400 mt-1">This may take a moment</p>
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="text-xs text-red-700">{error}</p>
          <button
            onClick={fetchData}
            className="mt-1.5 text-xs text-red-600 hover:text-red-800 font-medium"
          >
            Try again
          </button>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && filteredDeals.length === 0 && (
        <div className="text-center py-8">
          <svg
            className="mx-auto h-8 w-8 text-gray-300"
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
          <p className="mt-2 text-sm font-medium text-gray-600">No PPL deals</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {statusFilter !== 'all'
              ? 'No deals match the selected status.'
              : 'No Paid Per Lead deals in active pipeline stages.'}
          </p>
        </div>
      )}

      {/* Deals Table */}
      {!loading && !error && filteredDeals.length > 0 && (
        <div className="overflow-x-auto -mx-6">
          <div className="px-6 min-w-[700px]">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="w-7 px-1 py-2" />
                  <th
                    className="text-left px-2 py-2 text-[10px] font-medium text-slate-400 uppercase tracking-wider cursor-pointer hover:text-slate-600 select-none"
                    onClick={() => handleSort('dealName')}
                  >
                    <div className="flex items-center gap-0.5">
                      <span>Deal</span>
                      <SortIcon active={sortColumn === 'dealName'} direction={sortDirection} />
                    </div>
                  </th>
                  <th
                    className="text-left px-2 py-2 text-[10px] font-medium text-slate-400 uppercase tracking-wider cursor-pointer hover:text-slate-600 select-none whitespace-nowrap"
                    onClick={() => handleSort('dealAgeDays')}
                  >
                    <div className="flex items-center gap-0.5">
                      <span>Age</span>
                      <SortIcon active={sortColumn === 'dealAgeDays'} direction={sortDirection} />
                    </div>
                  </th>
                  <th
                    className="text-left px-2 py-2 text-[10px] font-medium text-slate-400 uppercase tracking-wider cursor-pointer hover:text-slate-600 select-none whitespace-nowrap"
                    onClick={() => handleSort('touches')}
                  >
                    <div className="flex items-center gap-0.5">
                      <span>Wk 1 Touches</span>
                      <SortIcon active={sortColumn === 'touches'} direction={sortDirection} />
                    </div>
                  </th>
                  <th className="text-left px-2 py-2 text-[10px] font-medium text-slate-400 uppercase tracking-wider whitespace-nowrap">
                    Calls
                  </th>
                  <th className="text-left px-2 py-2 text-[10px] font-medium text-slate-400 uppercase tracking-wider whitespace-nowrap">
                    Emails
                  </th>
                  <th className="text-left px-2 py-2 text-[10px] font-medium text-slate-400 uppercase tracking-wider whitespace-nowrap">
                    Total
                  </th>
                  <th
                    className="text-left px-2 py-2 text-[10px] font-medium text-slate-400 uppercase tracking-wider cursor-pointer hover:text-slate-600 select-none whitespace-nowrap"
                    onClick={() => handleSort('gap')}
                  >
                    <div className="flex items-center gap-0.5">
                      <span>Gap</span>
                      <SortIcon active={sortColumn === 'gap'} direction={sortDirection} />
                    </div>
                  </th>
                  <th className="text-left px-2 py-2 text-[10px] font-medium text-slate-400 uppercase tracking-wider whitespace-nowrap">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
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
                        <td className="px-1 py-2.5 text-center">
                          <ChevronIcon expanded={isExpanded} />
                        </td>
                        <td className="px-2 py-2.5">
                          <a
                            href={getHubSpotDealUrl(deal.hubspotDealId)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-medium text-gray-900 hover:text-indigo-600 transition-colors"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {deal.dealName}
                          </a>
                          {deal.amount != null && (
                            <span className="ml-1.5 text-[10px] text-gray-400">{formatCurrency(deal.amount)}</span>
                          )}
                        </td>
                        <td className="px-2 py-2.5">
                          <span className="text-xs text-gray-600 tabular-nums">{deal.dealAgeDays}d</span>
                        </td>
                        <td className="px-2 py-2.5">
                          {analysis ? (
                            deal.meetingBooked ? (
                              <div className="flex items-center gap-1">
                                <svg className="w-3.5 h-3.5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                                <span className="text-[10px] font-medium text-blue-700">Meeting</span>
                              </div>
                            ) : (
                              <TouchProgressBar touches={analysis.touches.total} target={analysis.target} />
                            )
                          ) : (
                            <span className="text-[10px] text-gray-400 italic">-</span>
                          )}
                        </td>
                        <td className="px-2 py-2.5">
                          <span className="text-xs text-gray-600 tabular-nums">
                            {analysis?.touches.calls ?? '-'}
                          </span>
                        </td>
                        <td className="px-2 py-2.5">
                          <span className="text-xs text-gray-600 tabular-nums">
                            {analysis?.touches.emails ?? '-'}
                          </span>
                        </td>
                        <td className="px-2 py-2.5">
                          <span className="text-xs text-gray-600 tabular-nums font-medium">
                            {deal.totalTouches ?? '-'}
                          </span>
                        </td>
                        <td className="px-2 py-2.5">
                          {analysis ? (
                            <span className={`text-xs font-medium tabular-nums ${
                              analysis.gap === 0 ? 'text-emerald-600' :
                              analysis.gap <= 2 ? 'text-amber-600' :
                              'text-red-600'
                            }`}>
                              {analysis.gap === 0 ? '-' : `-${analysis.gap}`}
                            </span>
                          ) : (
                            <span className="text-[10px] text-gray-400 italic">-</span>
                          )}
                        </td>
                        <td className="px-2 py-2.5">
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
