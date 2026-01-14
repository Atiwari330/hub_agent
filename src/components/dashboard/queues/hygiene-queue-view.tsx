'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { formatCurrency } from '@/lib/utils/currency';
import { CommitmentDateModal } from './commitment-date-modal';
import { SlackMessageModal } from './slack-message-modal';

interface HygieneQueueDeal {
  id: string;
  dealName: string;
  amount: number | null;
  stageName: string;
  ownerName: string;
  ownerId: string;
  createdAt: string | null;
  businessDaysOld: number;
  status: 'needs_commitment' | 'pending' | 'escalated';
  missingFields: { field: string; label: string }[];
  commitment: { date: string; daysRemaining: number } | null;
  reason: string;
}

interface HygieneQueueResponse {
  deals: HygieneQueueDeal[];
  counts: {
    needsCommitment: number;
    pending: number;
    escalated: number;
    total: number;
  };
}

type StatusFilter = 'all' | 'needs_commitment' | 'pending' | 'escalated';
type SortColumn = 'dealName' | 'ownerName' | 'amount' | 'stageName' | 'status';
type SortDirection = 'asc' | 'desc';

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'needs_commitment', label: 'Needs Date' },
  { value: 'pending', label: 'Pending' },
  { value: 'escalated', label: 'Escalated' },
];

const STATUS_CONFIG = {
  needs_commitment: { label: 'Needs Date', bg: 'bg-blue-100', text: 'text-blue-800' },
  pending: { label: 'Pending', bg: 'bg-amber-100', text: 'text-amber-800' },
  escalated: { label: 'Escalated', bg: 'bg-red-100', text: 'text-red-800' },
} as const;

const MISSING_FIELD_COLORS: Record<string, string> = {
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

export function HygieneQueueView() {
  const [data, setData] = useState<HygieneQueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [aeFilter, setAeFilter] = useState<string>('all');
  const [missingFieldFilter, setMissingFieldFilter] = useState<string>('all');

  // Sorting (default: amount descending)
  const [sortColumn, setSortColumn] = useState<SortColumn>('amount');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Selection
  const [selectedDeals, setSelectedDeals] = useState<Set<string>>(new Set());

  // Modals
  const [commitmentModal, setCommitmentModal] = useState<{ dealId: string; dealName: string } | null>(null);
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

  // Filtered and sorted deals
  const filteredDeals = useMemo(() => {
    if (!data) return [];

    let result = data.deals;

    // Apply status filter
    if (statusFilter !== 'all') {
      result = result.filter((d) => d.status === statusFilter);
    }

    // Apply AE filter
    if (aeFilter !== 'all') {
      result = result.filter((d) => d.ownerId === aeFilter);
    }

    // Apply missing field filter
    if (missingFieldFilter !== 'all') {
      result = result.filter((d) => d.missingFields.some((mf) => mf.label === missingFieldFilter));
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
        case 'stageName':
          comparison = a.stageName.localeCompare(b.stageName);
          break;
        case 'status':
          const statusOrder = { escalated: 0, needs_commitment: 1, pending: 2 };
          comparison = statusOrder[a.status] - statusOrder[b.status];
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [data, statusFilter, aeFilter, missingFieldFilter, sortColumn, sortDirection]);

  // Get deals for Slack modal (selected deals that need commitment)
  const dealsForSlack = useMemo(() => {
    if (selectedDeals.size === 0) {
      // If nothing selected, use all visible needs_commitment deals
      return filteredDeals.filter((d) => d.status === 'needs_commitment');
    }
    // Use selected deals that need commitment
    return filteredDeals.filter((d) => selectedDeals.has(d.id) && d.status === 'needs_commitment');
  }, [filteredDeals, selectedDeals]);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/queues/hygiene');
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

  const handleSetCommitment = (dealId: string) => {
    const deal = data?.deals.find((d) => d.id === dealId);
    if (deal) {
      setCommitmentModal({ dealId, dealName: deal.dealName });
    }
  };

  const handleCommitmentSubmit = async (date: string) => {
    if (!commitmentModal) return;

    const response = await fetch(`/api/queues/${commitmentModal.dealId}/commitment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commitmentDate: date }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to set commitment');
    }

    await fetchData();
  };

  const getTabCount = (tab: StatusFilter): number => {
    if (!data) return 0;
    switch (tab) {
      case 'all':
        return data.counts.total;
      case 'needs_commitment':
        return data.counts.needsCommitment;
      case 'pending':
        return data.counts.pending;
      case 'escalated':
        return data.counts.escalated;
      default:
        return 0;
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Deal Hygiene Queue</h1>
        <p className="text-sm text-gray-600 mt-1">
          Deals missing required fields. Track and commit to updating deal information.
        </p>
      </div>

      {/* Status Tabs */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setStatusFilter(tab.value)}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                statusFilter === tab.value
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {tab.label}
              <span
                className={`ml-2 px-1.5 py-0.5 text-xs rounded-full ${
                  statusFilter === tab.value
                    ? 'bg-indigo-100 text-indigo-600'
                    : 'bg-gray-200 text-gray-600'
                }`}
              >
                {getTabCount(tab.value)}
              </span>
            </button>
          ))}
        </div>

        {/* Generate Slack Messages button */}
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

        {(aeFilter !== 'all' || missingFieldFilter !== 'all') && (
          <button
            onClick={() => {
              setAeFilter('all');
              setMissingFieldFilter('all');
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
                  {/* Checkbox column */}
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedDeals.size === filteredDeals.length && filteredDeals.length > 0}
                      onChange={handleSelectAll}
                      className="w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                    />
                  </th>
                  {/* Deal Name */}
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none"
                    onClick={() => handleSort('dealName')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Deal Name</span>
                      <SortIcon active={sortColumn === 'dealName'} direction={sortDirection} />
                    </div>
                  </th>
                  {/* AE */}
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                    onClick={() => handleSort('ownerName')}
                  >
                    <div className="flex items-center gap-1">
                      <span>AE</span>
                      <SortIcon active={sortColumn === 'ownerName'} direction={sortDirection} />
                    </div>
                  </th>
                  {/* Amount */}
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                    onClick={() => handleSort('amount')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Amount</span>
                      <SortIcon active={sortColumn === 'amount'} direction={sortDirection} />
                    </div>
                  </th>
                  {/* Stage */}
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                    onClick={() => handleSort('stageName')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Stage</span>
                      <SortIcon active={sortColumn === 'stageName'} direction={sortDirection} />
                    </div>
                  </th>
                  {/* Status */}
                  <th
                    className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                    onClick={() => handleSort('status')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Status</span>
                      <SortIcon active={sortColumn === 'status'} direction={sortDirection} />
                    </div>
                  </th>
                  {/* Missing Fields */}
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider whitespace-nowrap">
                    Missing Fields
                  </th>
                  {/* Commitment */}
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider whitespace-nowrap">
                    Due Date
                  </th>
                  {/* Actions */}
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider whitespace-nowrap">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredDeals.map((deal) => {
                  const statusConfig = STATUS_CONFIG[deal.status];
                  return (
                    <tr
                      key={deal.id}
                      className={`hover:bg-slate-50 transition-colors ${
                        selectedDeals.has(deal.id) ? 'bg-indigo-50' : ''
                      }`}
                    >
                      {/* Checkbox */}
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedDeals.has(deal.id)}
                          onChange={() => handleSelectDeal(deal.id)}
                          className="w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                        />
                      </td>
                      {/* Deal Name */}
                      <td className="px-4 py-3">
                        <span className="text-sm font-medium text-gray-900">{deal.dealName}</span>
                      </td>
                      {/* AE */}
                      <td className="px-4 py-3">
                        <span className="text-sm text-gray-600">{deal.ownerName}</span>
                      </td>
                      {/* Amount */}
                      <td className="px-4 py-3">
                        <span className="text-sm text-gray-900 whitespace-nowrap">
                          {deal.amount ? formatCurrency(deal.amount) : '-'}
                        </span>
                      </td>
                      {/* Stage */}
                      <td className="px-4 py-3">
                        <span className="text-sm text-gray-600 whitespace-nowrap">{deal.stageName}</span>
                      </td>
                      {/* Status */}
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex px-2 py-1 text-xs font-medium rounded-full whitespace-nowrap ${statusConfig.bg} ${statusConfig.text}`}
                        >
                          {statusConfig.label}
                        </span>
                      </td>
                      {/* Missing Fields */}
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {deal.missingFields.map((field) => (
                            <span
                              key={field.field}
                              className={`px-2 py-0.5 text-xs font-medium rounded ${
                                MISSING_FIELD_COLORS[field.label] || 'bg-gray-100 text-gray-600'
                              }`}
                            >
                              {field.label}
                            </span>
                          ))}
                        </div>
                      </td>
                      {/* Commitment/Due Date */}
                      <td className="px-4 py-3">
                        {deal.commitment ? (
                          <div className="text-sm">
                            <span className="text-gray-900">{formatDate(deal.commitment.date)}</span>
                            <span className="text-gray-500 ml-1">
                              ({deal.commitment.daysRemaining > 0
                                ? `${deal.commitment.daysRemaining}d left`
                                : deal.commitment.daysRemaining === 0
                                  ? 'Today'
                                  : 'Overdue'
                              })
                            </span>
                          </div>
                        ) : (
                          <span className="text-sm text-gray-400">-</span>
                        )}
                      </td>
                      {/* Actions */}
                      <td className="px-4 py-3">
                        {(deal.status === 'needs_commitment' || deal.status === 'pending') && (
                          <button
                            onClick={() => handleSetCommitment(deal.id)}
                            className="px-3 py-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 rounded hover:bg-indigo-100 transition-colors whitespace-nowrap"
                          >
                            {deal.status === 'needs_commitment' ? 'Set Date' : 'Update'}
                          </button>
                        )}
                        {deal.status === 'escalated' && (
                          <button
                            onClick={() => handleSetCommitment(deal.id)}
                            className="px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 rounded hover:bg-red-100 transition-colors whitespace-nowrap"
                          >
                            Resolve
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Commitment Modal */}
      {commitmentModal && (
        <CommitmentDateModal
          dealName={commitmentModal.dealName}
          isOpen={true}
          onClose={() => setCommitmentModal(null)}
          onSubmit={handleCommitmentSubmit}
        />
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
