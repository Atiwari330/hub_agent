'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { formatCurrency } from '@/lib/utils/currency';
import { getHubSpotDealUrl } from '@/lib/hubspot/urls';
import { SlackMessageModal } from './slack-message-modal';

interface ExistingTaskInfo {
  hubspotTaskId: string;
  createdAt: string;
  fieldsTaskedFor: string[];
  coversAllCurrentFields: boolean;
}

interface HygieneQueueDeal {
  id: string;
  hubspotDealId: string;
  dealName: string;
  amount: number | null;
  stageName: string;
  ownerName: string;
  ownerId: string;
  hubspotOwnerId: string;
  createdAt: string | null;
  businessDaysOld: number;
  missingFields: { field: string; label: string }[];
  reason: string;
  existingTask: ExistingTaskInfo | null;
}

interface HygieneQueueResponse {
  deals: HygieneQueueDeal[];
  counts: {
    total: number;
  };
}

type SortColumn = 'dealName' | 'ownerName' | 'amount' | 'stageName';
type SortDirection = 'asc' | 'desc';

// Default color scheme for missing fields
const DEFAULT_MISSING_FIELD_COLORS: Record<string, string> = {
  'Lead Source': 'bg-orange-100 text-orange-700',
  'Products': 'bg-purple-100 text-purple-700',
  'Collaborator': 'bg-cyan-100 text-cyan-700',
  'Amount': 'bg-red-100 text-red-700',
  'Close Date': 'bg-pink-100 text-pink-700',
  'Substage': 'bg-slate-100 text-slate-700',
};

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

export interface BaseHygieneQueueViewProps {
  title: string;
  subtitle: string;
  apiEndpoint: string;
  missingFieldColors?: Record<string, string>;
}

export function BaseHygieneQueueView({
  title,
  subtitle,
  apiEndpoint,
  missingFieldColors = DEFAULT_MISSING_FIELD_COLORS,
}: BaseHygieneQueueViewProps) {
  const [data, setData] = useState<HygieneQueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [aeFilter, setAeFilter] = useState<string>('all');
  const [missingFieldFilter, setMissingFieldFilter] = useState<string>('all');
  const [stageFilter, setStageFilter] = useState<string[]>([]);
  const [stageDropdownOpen, setStageDropdownOpen] = useState(false);

  // Sorting (default: amount descending)
  const [sortColumn, setSortColumn] = useState<SortColumn>('amount');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Selection
  const [selectedDeals, setSelectedDeals] = useState<Set<string>>(new Set());

  // Task creation state
  const [creatingTasks, setCreatingTasks] = useState<Set<string>>(new Set());

  // Modals
  const [slackModalOpen, setSlackModalOpen] = useState(false);

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

  // Extract unique missing fields for filter dropdown
  const uniqueMissingFields = useMemo(() => {
    if (!data) return [];
    const fields = new Set<string>();
    for (const deal of data.deals) {
      for (const mf of deal.missingFields) {
        fields.add(mf.label);
      }
    }
    return Array.from(fields).sort();
  }, [data]);

  // Extract unique stages for filter dropdown
  const uniqueStages = useMemo(() => {
    if (!data) return [];
    const stages = new Set<string>();
    for (const deal of data.deals) {
      if (deal.stageName) {
        stages.add(deal.stageName);
      }
    }
    return Array.from(stages).sort();
  }, [data]);

  // Filtered and sorted deals
  const filteredDeals = useMemo(() => {
    if (!data) return [];

    let result = data.deals;

    if (aeFilter !== 'all') {
      result = result.filter((d) => d.ownerId === aeFilter);
    }

    if (missingFieldFilter !== 'all') {
      result = result.filter((d) => d.missingFields.some((mf) => mf.label === missingFieldFilter));
    }

    if (stageFilter.length > 0) {
      result = result.filter((d) => stageFilter.includes(d.stageName));
    }

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
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [data, aeFilter, missingFieldFilter, stageFilter, sortColumn, sortDirection]);

  // Get deals for Slack modal
  const dealsForSlack = useMemo(() => {
    if (selectedDeals.size === 0) {
      return filteredDeals;
    }
    return filteredDeals.filter((d) => selectedDeals.has(d.id));
  }, [filteredDeals, selectedDeals]);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(apiEndpoint);
      if (!response.ok) {
        throw new Error('Failed to fetch hygiene queue');
      }
      const json = await response.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [apiEndpoint]);

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

  const handleCreateTask = async (deal: HygieneQueueDeal, skipRefresh = false) => {
    setCreatingTasks((prev) => new Set(prev).add(deal.id));

    try {
      const response = await fetch('/api/queues/create-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dealId: deal.id,
          hubspotDealId: deal.hubspotDealId,
          hubspotOwnerId: deal.hubspotOwnerId,
          dealName: deal.dealName,
          missingFields: deal.missingFields.map((f) => f.label),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create task');
      }

      if (!skipRefresh) {
        await fetchData();
      }
    } catch (err) {
      console.error('Failed to create task:', err);
      alert(err instanceof Error ? err.message : 'Failed to create task');
    } finally {
      setCreatingTasks((prev) => {
        const next = new Set(prev);
        next.delete(deal.id);
        return next;
      });
    }
  };

  const handleCreateTasksForSelected = async () => {
    const dealsToProcess = filteredDeals.filter(
      (d) => selectedDeals.has(d.id) && (!d.existingTask || !d.existingTask.coversAllCurrentFields)
    );

    for (const deal of dealsToProcess) {
      await handleCreateTask(deal, true);
    }

    await fetchData();
    setSelectedDeals(new Set());
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
          <p className="text-sm text-gray-600 mt-1">{subtitle}</p>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-3">
          {selectedDeals.size > 0 && (
            <button
              onClick={handleCreateTasksForSelected}
              disabled={creatingTasks.size > 0}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
                />
              </svg>
              Create Tasks ({selectedDeals.size})
            </button>
          )}

          {dealsForSlack.length > 0 && (
            <button
              onClick={() => setSlackModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
                />
              </svg>
              Generate Slack {selectedDeals.size > 0 ? `(${dealsForSlack.length} selected)` : `(${dealsForSlack.length})`}
            </button>
          )}
        </div>
      </div>

      {/* Filters Row */}
      <div className="flex items-center gap-3 mb-4">
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

        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Missing:</label>
          <select
            value={missingFieldFilter}
            onChange={(e) => setMissingFieldFilter(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="all">All Fields</option>
            {uniqueMissingFields.map((field) => (
              <option key={field} value={field}>{field}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2 relative">
          <label className="text-sm text-gray-600">Stage:</label>
          <button
            onClick={() => setStageDropdownOpen(!stageDropdownOpen)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 flex items-center gap-2 min-w-[120px]"
          >
            <span>{stageFilter.length === 0 ? 'All Stages' : `${stageFilter.length} Stage${stageFilter.length > 1 ? 's' : ''}`}</span>
            <svg className={`w-4 h-4 text-gray-400 transition-transform ${stageDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {stageDropdownOpen && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setStageDropdownOpen(false)}
              />
              <div className="absolute top-full left-0 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg z-20 min-w-[200px] max-h-[300px] overflow-y-auto">
                {uniqueStages.map((stage) => (
                  <label
                    key={stage}
                    className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={stageFilter.includes(stage)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setStageFilter([...stageFilter, stage]);
                        } else {
                          setStageFilter(stageFilter.filter((s) => s !== stage));
                        }
                      }}
                      className="w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                    />
                    <span className="text-gray-700">{stage}</span>
                  </label>
                ))}
                {stageFilter.length > 0 && (
                  <button
                    onClick={() => setStageFilter([])}
                    className="w-full px-3 py-2 text-sm text-indigo-600 hover:bg-indigo-50 border-t border-gray-200 text-left"
                  >
                    Clear selection
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        {(aeFilter !== 'all' || missingFieldFilter !== 'all' || stageFilter.length > 0) && (
          <button
            onClick={() => {
              setAeFilter('all');
              setMissingFieldFilter('all');
              setStageFilter([]);
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
            No deals matching the current filters.
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
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider whitespace-nowrap">
                    Missing Fields
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider whitespace-nowrap">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredDeals.map((deal) => {
                  const isCreating = creatingTasks.has(deal.id);
                  const hasTask = deal.existingTask !== null;
                  const taskCoversAll = deal.existingTask?.coversAllCurrentFields ?? false;

                  const formatTaskDate = (dateStr: string) => {
                    const date = new Date(dateStr);
                    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                  };

                  return (
                    <tr
                      key={deal.id}
                      className={`hover:bg-slate-50 transition-colors ${
                        selectedDeals.has(deal.id) ? 'bg-indigo-50' : ''
                      } ${hasTask && taskCoversAll ? 'bg-emerald-50/50' : ''}`}
                    >
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedDeals.has(deal.id)}
                          onChange={() => handleSelectDeal(deal.id)}
                          className="w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <a
                          href={getHubSpotDealUrl(deal.hubspotDealId)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-medium text-gray-900 hover:text-indigo-600 transition-colors"
                        >
                          {deal.dealName}
                        </a>
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
                        <div className="flex flex-wrap gap-1">
                          {deal.missingFields.map((field) => (
                            <span
                              key={field.field}
                              className={`px-2 py-0.5 text-xs font-medium rounded ${
                                missingFieldColors[field.label] || 'bg-gray-100 text-gray-600'
                              }`}
                            >
                              {field.label}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          {hasTask && taskCoversAll ? (
                            <div className="flex items-center gap-2">
                              <span className="flex items-center gap-1 text-xs font-medium text-emerald-600">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                                Task Created {formatTaskDate(deal.existingTask!.createdAt)}
                              </span>
                              <button
                                onClick={() => handleCreateTask(deal)}
                                disabled={isCreating}
                                className="text-xs text-gray-500 hover:text-gray-700 underline"
                              >
                                Re-create
                              </button>
                            </div>
                          ) : hasTask && !taskCoversAll ? (
                            <div className="flex flex-col gap-1">
                              <span className="text-xs text-amber-600">
                                Task created {formatTaskDate(deal.existingTask!.createdAt)} for other fields
                              </span>
                              <button
                                onClick={() => handleCreateTask(deal)}
                                disabled={isCreating}
                                className="px-3 py-1.5 text-xs font-medium text-emerald-600 bg-emerald-50 rounded hover:bg-emerald-100 transition-colors whitespace-nowrap disabled:opacity-50 w-fit"
                              >
                                {isCreating ? (
                                  <span className="flex items-center gap-1">
                                    <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                    </svg>
                                    Creating...
                                  </span>
                                ) : (
                                  'Create Task for New Fields'
                                )}
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => handleCreateTask(deal)}
                              disabled={isCreating}
                              className="px-3 py-1.5 text-xs font-medium text-emerald-600 bg-emerald-50 rounded hover:bg-emerald-100 transition-colors whitespace-nowrap disabled:opacity-50"
                            >
                              {isCreating ? (
                                <span className="flex items-center gap-1">
                                  <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                  </svg>
                                  Creating...
                                </span>
                              ) : (
                                'Create Task'
                              )}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Slack Message Modal */}
      <SlackMessageModal
        isOpen={slackModalOpen}
        onClose={() => setSlackModalOpen(false)}
        deals={dealsForSlack}
      />
    </div>
  );
}
