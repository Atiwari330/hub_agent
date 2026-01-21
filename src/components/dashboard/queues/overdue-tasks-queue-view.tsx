'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { formatCurrency } from '@/lib/utils/currency';

interface OverdueTaskInfo {
  taskId: string;
  subject: string;
  dueDate: string;
  daysOverdue: number;
}

interface ExistingReminderInfo {
  hubspotTaskId: string;
  createdAt: string;
  overdueTaskCount: number;
  oldestOverdueDays: number;
}

interface OverdueTasksQueueDeal {
  id: string;
  hubspotDealId: string;
  hubspotOwnerId: string;
  dealName: string;
  amount: number | null;
  stageName: string;
  ownerName: string;
  ownerId: string;
  overdueTaskCount: number;
  oldestOverdueDays: number;
  overdueTasks: OverdueTaskInfo[];
  existingReminder: ExistingReminderInfo | null;
}

interface OverdueTasksQueueResponse {
  deals: OverdueTasksQueueDeal[];
  counts: {
    total: number;
    critical: number;
  };
}

type SortColumn = 'dealName' | 'ownerName' | 'amount' | 'stageName' | 'overdueTaskCount' | 'oldestOverdueDays';
type SortDirection = 'asc' | 'desc';

// Stage options for multi-select filter
const STAGE_OPTIONS = [
  { id: '17915773', label: 'SQL' },
  { id: '138092708', label: 'Discovery' },
  { id: 'baedc188-ba76-4a41-8723-5bb99fe7c5bf', label: 'Demo - Scheduled' },
  { id: '963167283', label: 'Demo - Completed' },
  { id: '59865091', label: 'Proposal' },
];

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

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-4 h-4 transition-transform ${open ? 'rotate-90' : ''}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  );
}

export function OverdueTasksQueueView() {
  const [data, setData] = useState<OverdueTasksQueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [aeFilter, setAeFilter] = useState<string>('all');
  const [selectedStages, setSelectedStages] = useState<Set<string>>(new Set(STAGE_OPTIONS.map((s) => s.id)));
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [stageDropdownOpen, setStageDropdownOpen] = useState(false);

  // Sorting
  const [sortColumn, setSortColumn] = useState<SortColumn>('oldestOverdueDays');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Selection
  const [selectedDeals, setSelectedDeals] = useState<Set<string>>(new Set());

  // Expanded rows (for showing task details)
  const [expandedDeals, setExpandedDeals] = useState<Set<string>>(new Set());

  // Reminder creation state
  const [creatingReminders, setCreatingReminders] = useState<Set<string>>(new Set());

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

  // Filtered and sorted deals
  const filteredDeals = useMemo(() => {
    if (!data) return [];

    let result = data.deals;

    // Apply AE filter
    if (aeFilter !== 'all') {
      result = result.filter((d) => d.ownerId === aeFilter);
    }

    // Sorting
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
        case 'overdueTaskCount':
          comparison = a.overdueTaskCount - b.overdueTaskCount;
          break;
        case 'oldestOverdueDays':
          comparison = a.oldestOverdueDays - b.oldestOverdueDays;
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [data, aeFilter, sortColumn, sortDirection]);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();

      // Add stage filter
      if (selectedStages.size > 0 && selectedStages.size < STAGE_OPTIONS.length) {
        params.set('stage', Array.from(selectedStages).join(','));
      }

      // Add severity filter
      if (severityFilter !== 'all') {
        params.set('severity', severityFilter);
      }

      const response = await fetch(`/api/queues/overdue-tasks?${params}`);
      if (!response.ok) {
        throw new Error('Failed to fetch overdue-tasks queue');
      }
      const json = await response.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [selectedStages, severityFilter]);

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

  const toggleExpanded = (dealId: string) => {
    const newExpanded = new Set(expandedDeals);
    if (newExpanded.has(dealId)) {
      newExpanded.delete(dealId);
    } else {
      newExpanded.add(dealId);
    }
    setExpandedDeals(newExpanded);
  };

  const toggleStage = (stageId: string) => {
    const newSelected = new Set(selectedStages);
    if (newSelected.has(stageId)) {
      if (newSelected.size > 1) {
        newSelected.delete(stageId);
      }
    } else {
      newSelected.add(stageId);
    }
    setSelectedStages(newSelected);
  };

  const selectAllStages = () => {
    setSelectedStages(new Set(STAGE_OPTIONS.map((s) => s.id)));
  };

  // Create reminder task for a deal
  const handleCreateReminder = async (deal: OverdueTasksQueueDeal) => {
    setCreatingReminders((prev) => new Set(prev).add(deal.id));

    try {
      const response = await fetch('/api/queues/create-overdue-reminder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dealId: deal.id,
          hubspotDealId: deal.hubspotDealId,
          hubspotOwnerId: deal.hubspotOwnerId,
          dealName: deal.dealName,
          overdueTasks: deal.overdueTasks.map((t) => ({
            subject: t.subject,
            daysOverdue: t.daysOverdue,
          })),
          oldestOverdueDays: deal.oldestOverdueDays,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create reminder');
      }

      await fetchData();
    } catch (err) {
      console.error('Failed to create reminder:', err);
      alert(err instanceof Error ? err.message : 'Failed to create reminder');
    } finally {
      setCreatingReminders((prev) => {
        const next = new Set(prev);
        next.delete(deal.id);
        return next;
      });
    }
  };

  // Format dates
  const formatTaskDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // Get severity badge styling
  const getSeverityBadge = (daysOverdue: number) => {
    if (daysOverdue > 14) {
      return { bg: 'bg-red-100', text: 'text-red-700', label: `${daysOverdue}d` };
    }
    if (daysOverdue > 7) {
      return { bg: 'bg-orange-100', text: 'text-orange-700', label: `${daysOverdue}d` };
    }
    if (daysOverdue > 3) {
      return { bg: 'bg-amber-100', text: 'text-amber-700', label: `${daysOverdue}d` };
    }
    return { bg: 'bg-yellow-100', text: 'text-yellow-700', label: `${daysOverdue}d` };
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Overdue Tasks Queue</h1>
          <p className="text-sm text-gray-600 mt-1">
            Deals with overdue HubSpot tasks that need attention.
          </p>
        </div>
      </div>

      {/* Counts Summary */}
      {data && (
        <div className="flex gap-4 mb-4">
          <div className="flex items-center gap-2 text-sm">
            <span className="px-2 py-1 bg-red-100 text-red-700 rounded font-medium">{data.counts.critical}</span>
            <span className="text-gray-600">Critical (&gt;7 days)</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded font-medium">{data.counts.total}</span>
            <span className="text-gray-600">Total</span>
          </div>
        </div>
      )}

      {/* Filters Row */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
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

        {/* Stage multi-select dropdown */}
        <div className="relative">
          <label className="text-sm text-gray-600 mr-2">Stage:</label>
          <button
            onClick={() => setStageDropdownOpen(!stageDropdownOpen)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 inline-flex items-center gap-1"
          >
            <span>
              {selectedStages.size === STAGE_OPTIONS.length
                ? 'All Stages'
                : selectedStages.size === 1
                  ? STAGE_OPTIONS.find((s) => selectedStages.has(s.id))?.label
                  : `${selectedStages.size} stages`}
            </span>
            <ChevronIcon open={stageDropdownOpen} />
          </button>

          {stageDropdownOpen && (
            <div className="absolute z-10 mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg">
              <div className="p-2 border-b border-gray-100">
                <button
                  onClick={selectAllStages}
                  className="text-xs text-indigo-600 hover:text-indigo-800"
                >
                  Select all
                </button>
              </div>
              <div className="py-1">
                {STAGE_OPTIONS.map((stage) => (
                  <label
                    key={stage.id}
                    className="flex items-center px-3 py-1.5 hover:bg-gray-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedStages.has(stage.id)}
                      onChange={() => toggleStage(stage.id)}
                      className="w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                    />
                    <span className="ml-2 text-sm text-gray-700">{stage.label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Severity:</label>
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="all">All</option>
            <option value="3">&gt; 3 days</option>
            <option value="7">&gt; 7 days</option>
            <option value="14">&gt; 14 days</option>
          </select>
        </div>

        {(aeFilter !== 'all' || selectedStages.size < STAGE_OPTIONS.length || severityFilter !== 'all') && (
          <button
            onClick={() => {
              setAeFilter('all');
              setSelectedStages(new Set(STAGE_OPTIONS.map((s) => s.id)));
              setSeverityFilter('all');
            }}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Clear filters
          </button>
        )}

        <div className="ml-auto text-sm text-gray-500">
          {filteredDeals.length} deal{filteredDeals.length !== 1 ? 's' : ''}
          {selectedDeals.size > 0 && ` (${selectedDeals.size} selected)`}
        </div>
      </div>

      {/* Click outside to close dropdown */}
      {stageDropdownOpen && (
        <div
          className="fixed inset-0 z-0"
          onClick={() => setStageDropdownOpen(false)}
        />
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
          <h3 className="mt-4 text-lg font-medium text-gray-900">All caught up!</h3>
          <p className="mt-1 text-sm text-gray-500">
            No deals with overdue tasks matching the current filters.
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
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedDeals.size === filteredDeals.length && filteredDeals.length > 0}
                      onChange={handleSelectAll}
                      className="w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                    />
                  </th>
                  <th className="w-8 px-2 py-3"></th>
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
                    onClick={() => handleSort('amount')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Amount</span>
                      <SortIcon active={sortColumn === 'amount'} direction={sortDirection} />
                    </div>
                  </th>
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                    onClick={() => handleSort('stageName')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Stage</span>
                      <SortIcon active={sortColumn === 'stageName'} direction={sortDirection} />
                    </div>
                  </th>
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                    onClick={() => handleSort('overdueTaskCount')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Overdue Tasks</span>
                      <SortIcon active={sortColumn === 'overdueTaskCount'} direction={sortDirection} />
                    </div>
                  </th>
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                    onClick={() => handleSort('oldestOverdueDays')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Oldest Overdue</span>
                      <SortIcon active={sortColumn === 'oldestOverdueDays'} direction={sortDirection} />
                    </div>
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider whitespace-nowrap">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredDeals.map((deal) => {
                  const isCreating = creatingReminders.has(deal.id);
                  const hasReminder = deal.existingReminder !== null;
                  const isExpanded = expandedDeals.has(deal.id);
                  const severityBadge = getSeverityBadge(deal.oldestOverdueDays);

                  return (
                    <React.Fragment key={deal.id}>
                      <tr
                        className={`hover:bg-slate-50 transition-colors ${
                          selectedDeals.has(deal.id) ? 'bg-indigo-50' : ''
                        } ${deal.oldestOverdueDays > 7 ? 'bg-red-50/30' : ''}`}
                      >
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={selectedDeals.has(deal.id)}
                            onChange={() => handleSelectDeal(deal.id)}
                            className="w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                          />
                        </td>
                        <td className="px-2 py-3">
                          <button
                            onClick={() => toggleExpanded(deal.id)}
                            className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
                          >
                            <ChevronIcon open={isExpanded} />
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm font-medium text-gray-900">{deal.dealName}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-gray-600">{deal.ownerName}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-gray-900 whitespace-nowrap">
                            {deal.amount ? formatCurrency(deal.amount) : '-'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-gray-600 whitespace-nowrap">{deal.stageName}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="px-2 py-1 text-xs font-medium rounded bg-red-100 text-red-700">
                            {deal.overdueTaskCount} task{deal.overdueTaskCount !== 1 ? 's' : ''}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-1 text-xs font-medium rounded ${severityBadge.bg} ${severityBadge.text}`}>
                            {severityBadge.label}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {hasReminder ? (
                            <div className="flex items-center gap-1">
                              <span className="text-xs text-emerald-600">
                                Reminder {formatTaskDate(deal.existingReminder!.createdAt)}
                              </span>
                              <button
                                onClick={() => handleCreateReminder(deal)}
                                disabled={isCreating}
                                className="text-xs text-gray-500 hover:text-gray-700 underline"
                              >
                                Re-create
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => handleCreateReminder(deal)}
                              disabled={isCreating}
                              className="px-3 py-1.5 text-xs font-medium text-emerald-600 bg-emerald-50 rounded hover:bg-emerald-100 transition-colors whitespace-nowrap disabled:opacity-50"
                            >
                              {isCreating ? 'Creating...' : 'Create Reminder'}
                            </button>
                          )}
                        </td>
                      </tr>
                      {/* Expanded row showing task details */}
                      {isExpanded && (
                        <tr className="bg-slate-50">
                          <td colSpan={9} className="px-4 py-3">
                            <div className="ml-12">
                              <h4 className="text-sm font-medium text-gray-700 mb-2">Overdue Tasks:</h4>
                              <ul className="space-y-1">
                                {deal.overdueTasks.map((task) => (
                                  <li key={task.taskId} className="flex items-center gap-3 text-sm">
                                    <span className={`px-1.5 py-0.5 text-xs rounded ${getSeverityBadge(task.daysOverdue).bg} ${getSeverityBadge(task.daysOverdue).text}`}>
                                      {task.daysOverdue}d
                                    </span>
                                    <span className="text-gray-700">{task.subject}</span>
                                    <span className="text-gray-400">Due: {formatTaskDate(task.dueDate)}</span>
                                  </li>
                                ))}
                              </ul>
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
