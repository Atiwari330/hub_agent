'use client';

import { useState, useMemo } from 'react';
import { formatCurrency } from '@/lib/utils/currency';

interface Deal {
  id: string;
  hubspotDealId: string;
  dealName: string;
  amount: number | null;
  closeDate: string | null;
  stage: string | null;
  stageName: string | null;
  pipeline: string | null;
}

interface DealsTableProps {
  deals: Deal[];
}

type SortColumn = 'dealName' | 'amount' | 'closeDate' | 'stage';
type SortOrder = 'asc' | 'desc';
type DealFilter = 'active' | 'closed_won' | 'closed_lost' | 'all';

// Stage color mapping
function getStageColor(stage: string | null): string {
  if (!stage) return 'bg-gray-100 text-gray-700';

  const stageLower = stage.toLowerCase();

  if (stageLower.includes('closedwon') || stageLower.includes('closed won')) {
    return 'bg-emerald-100 text-emerald-800';
  }
  if (stageLower.includes('closedlost') || stageLower.includes('closed lost')) {
    return 'bg-red-100 text-red-800';
  }
  if (stageLower.includes('negotiation') || stageLower.includes('contract')) {
    return 'bg-amber-100 text-amber-800';
  }
  if (stageLower.includes('proposal')) {
    return 'bg-purple-100 text-purple-800';
  }
  if (stageLower.includes('demo')) {
    return 'bg-violet-100 text-violet-800';
  }
  if (stageLower.includes('discovery') || stageLower.includes('qualified')) {
    return 'bg-blue-100 text-blue-800';
  }
  if (stageLower.includes('qualification') || stageLower.includes('mql')) {
    return 'bg-slate-200 text-slate-700';
  }

  return 'bg-indigo-100 text-indigo-800';
}

function SortIcon({ active, order }: { active: boolean; order: SortOrder }) {
  if (!active) {
    return (
      <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
      </svg>
    );
  }

  return order === 'asc' ? (
    <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
    </svg>
  ) : (
    <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function formatDate(dateString: string | null): string {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function DealsTable({ deals }: DealsTableProps) {
  const [sortColumn, setSortColumn] = useState<SortColumn>('amount');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [filter, setFilter] = useState<DealFilter>('active');

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortOrder('desc');
    }
  };

  const filteredDeals = useMemo(() => {
    return deals.filter((deal) => {
      const stageLower = (deal.stageName || deal.stage || '').toLowerCase();
      const isClosedWon = stageLower.includes('closed won') || stageLower.includes('closedwon');
      const isClosedLost = stageLower.includes('closed lost') || stageLower.includes('closedlost');

      switch (filter) {
        case 'active':
          return !isClosedWon && !isClosedLost;
        case 'closed_won':
          return isClosedWon;
        case 'closed_lost':
          return isClosedLost;
        case 'all':
          return true;
      }
    });
  }, [deals, filter]);

  const sortedDeals = useMemo(() => {
    return [...filteredDeals].sort((a, b) => {
      let comparison = 0;

      switch (sortColumn) {
        case 'dealName':
          comparison = (a.dealName || '').localeCompare(b.dealName || '');
          break;
        case 'amount':
          comparison = (a.amount || 0) - (b.amount || 0);
          break;
        case 'closeDate':
          const dateA = a.closeDate ? new Date(a.closeDate).getTime() : 0;
          const dateB = b.closeDate ? new Date(b.closeDate).getTime() : 0;
          comparison = dateA - dateB;
          break;
        case 'stage':
          comparison = (a.stageName || a.stage || '').localeCompare(b.stageName || b.stage || '');
          break;
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });
  }, [filteredDeals, sortColumn, sortOrder]);

  const getEmptyMessage = () => {
    if (deals.length === 0) {
      return 'No deals found for this account executive.';
    }
    switch (filter) {
      case 'active':
        return 'No active deals in pipeline.';
      case 'closed_won':
        return 'No closed won deals.';
      case 'closed_lost':
        return 'No closed lost deals.';
      case 'all':
        return 'No deals found for this account executive.';
    }
  };

  return (
    <div>
      {/* Header with filter */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Deals</h2>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as DealFilter)}
          className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
        >
          <option value="active">Active Pipeline</option>
          <option value="closed_won">Closed Won</option>
          <option value="closed_lost">Closed Lost</option>
          <option value="all">All Deals</option>
        </select>
      </div>

      {filteredDeals.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <p className="text-gray-500">{getEmptyMessage()}</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-slate-50 border-b border-gray-200">
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">
                Deal Name
              </th>
              <th
                className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none"
                onClick={() => handleSort('amount')}
              >
                <div className="flex items-center gap-1">
                  <span>Amount</span>
                  <SortIcon active={sortColumn === 'amount'} order={sortOrder} />
                </div>
              </th>
              <th
                className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none"
                onClick={() => handleSort('closeDate')}
              >
                <div className="flex items-center gap-1">
                  <span>Close Date</span>
                  <SortIcon active={sortColumn === 'closeDate'} order={sortOrder} />
                </div>
              </th>
              <th
                className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none"
                onClick={() => handleSort('stage')}
              >
                <div className="flex items-center gap-1">
                  <span>Stage</span>
                  <SortIcon active={sortColumn === 'stage'} order={sortOrder} />
                </div>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sortedDeals.map((deal) => (
              <tr key={deal.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-4 py-3">
                  <a
                    href={`https://app.hubspot.com/contacts/YOUR_PORTAL/deal/${deal.hubspotDealId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-gray-900 hover:text-indigo-600 transition-colors"
                  >
                    {deal.dealName}
                  </a>
                </td>
                <td className="px-4 py-3 text-sm text-gray-900">
                  {deal.amount !== null ? formatCurrency(deal.amount) : '-'}
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">
                  {formatDate(deal.closeDate)}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${getStageColor(deal.stage)}`}
                  >
                    {deal.stageName || deal.stage || 'Unknown'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
        </div>
      )}
    </div>
  );
}
