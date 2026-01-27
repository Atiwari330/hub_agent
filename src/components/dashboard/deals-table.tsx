'use client';

import { useState, useMemo, useCallback } from 'react';
import { formatCurrency } from '@/lib/utils/currency';
import { getCurrentQuarter, getQuarterInfo } from '@/lib/utils/quarter';
import { getHubSpotDealUrl } from '@/lib/hubspot/urls';

interface RiskFactor {
  type: string;
  message: string;
}

interface DealRisk {
  level: 'healthy' | 'at_risk' | 'stale';
  factors: RiskFactor[];
  daysInStage: number | null;
  daysSinceActivity: number | null;
}

interface NextStepAnalysis {
  status: 'date_found' | 'date_inferred' | 'no_date' | 'date_unclear' | 'awaiting_external' | 'empty' | 'unparseable';
  dueDate: string | null;
  confidence: number | null;
  displayMessage: string | null;
  actionType: string | null;
  analyzedAt: string | null;
}

interface Deal {
  id: string;
  hubspotDealId: string;
  dealName: string;
  amount: number | null;
  closeDate: string | null;
  stage: string | null;
  stageName: string | null;
  pipeline: string | null;
  // Activity properties
  hubspotCreatedAt: string | null;
  leadSource: string | null;
  lastActivityDate: string | null;
  nextActivityDate: string | null;
  nextStep: string | null;
  products: string | null;
  dealSubstage: string | null;
  // Next step analysis
  nextStepAnalysis: NextStepAnalysis | null;
  // Risk assessment
  risk: DealRisk;
}

interface DealsTableProps {
  deals: Deal[];
  ownerId: string;
}

type SortColumn = 'dealName' | 'amount' | 'closeDate' | 'stage';
type SortOrder = 'asc' | 'desc';
type DealFilter = 'active' | 'closed_won' | 'closed_lost' | 'all';
type QuarterFilter = 'q1' | 'q2' | 'q3' | 'q4' | 'all';

// Generate quarter options for the dropdown
function getQuarterOptions(): { value: QuarterFilter; label: string; year: number }[] {
  const currentQ = getCurrentQuarter();
  return [
    { value: 'q1', label: `Q1 ${currentQ.year}`, year: currentQ.year },
    { value: 'q2', label: `Q2 ${currentQ.year}`, year: currentQ.year },
    { value: 'q3', label: `Q3 ${currentQ.year}`, year: currentQ.year },
    { value: 'q4', label: `Q4 ${currentQ.year}`, year: currentQ.year },
    { value: 'all', label: 'All Quarters', year: currentQ.year },
  ];
}

// Get the current quarter filter value
function getCurrentQuarterFilter(): QuarterFilter {
  const currentQ = getCurrentQuarter();
  return `q${currentQ.quarter}` as QuarterFilter;
}

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

// Risk badge colors and labels
const RISK_CONFIG = {
  healthy: {
    bg: 'bg-emerald-100',
    text: 'text-emerald-800',
    label: 'Healthy',
  },
  at_risk: {
    bg: 'bg-amber-100',
    text: 'text-amber-800',
    label: 'At Risk',
  },
  stale: {
    bg: 'bg-red-100',
    text: 'text-red-800',
    label: 'Stale',
  },
} as const;

function RiskBadge({ risk }: { risk: DealRisk }) {
  const config = RISK_CONFIG[risk.level];
  const hasFactors = risk.factors.length > 0;

  return (
    <div className="relative group">
      <span
        className={`inline-flex px-2 py-1 text-xs font-medium rounded-full whitespace-nowrap ${config.bg} ${config.text}`}
      >
        {config.label}
      </span>
      {hasFactors && (
        <div className="absolute left-0 top-full mt-1 hidden group-hover:block z-20 w-64 p-3 bg-slate-800 text-white text-xs rounded-lg shadow-lg">
          <div className="font-semibold mb-2">
            {config.label}: {risk.factors.length} issue{risk.factors.length > 1 ? 's' : ''}
          </div>
          <ul className="space-y-1">
            {risk.factors.map((factor, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <span className="text-slate-400">•</span>
                <span>{factor.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// Next Step Status configuration
const NEXT_STEP_STATUS_CONFIG = {
  date_found: { icon: '📅', bg: 'bg-emerald-100', text: 'text-emerald-800' },
  date_inferred: { icon: '📅', bg: 'bg-emerald-50', text: 'text-emerald-700' },
  no_date: { icon: '—', bg: 'bg-gray-100', text: 'text-gray-600' },
  date_unclear: { icon: '❓', bg: 'bg-amber-100', text: 'text-amber-700' },
  awaiting_external: { icon: '⏳', bg: 'bg-blue-100', text: 'text-blue-700' },
  empty: { icon: '∅', bg: 'bg-gray-100', text: 'text-gray-500' },
  unparseable: { icon: '✗', bg: 'bg-gray-100', text: 'text-gray-500' },
} as const;

function NextStepStatusBadge({ analysis, dueDate }: { analysis: NextStepAnalysis | null; dueDate?: string | null }) {
  if (!analysis) {
    return (
      <span className="inline-flex px-2 py-1 text-xs text-gray-400 whitespace-nowrap">
        Not analyzed
      </span>
    );
  }

  const config = NEXT_STEP_STATUS_CONFIG[analysis.status] || NEXT_STEP_STATUS_CONFIG.unparseable;

  // Check if due date is overdue
  let isOverdue = false;
  let isDueToday = false;
  if (analysis.dueDate && (analysis.status === 'date_found' || analysis.status === 'date_inferred')) {
    const due = new Date(analysis.dueDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    due.setHours(0, 0, 0, 0);
    isOverdue = due < today;
    isDueToday = due.getTime() === today.getTime();
  }

  // Override colors for overdue/due today
  let badgeBg: string = config.bg;
  let badgeText: string = config.text;
  let statusIcon: string = config.icon;

  if (isOverdue) {
    badgeBg = 'bg-red-100';
    badgeText = 'text-red-800';
    statusIcon = '⚠️';
  } else if (isDueToday) {
    badgeBg = 'bg-amber-100';
    badgeText = 'text-amber-800';
    statusIcon = '🔔';
  }

  return (
    <div className="relative group">
      <span
        className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full whitespace-nowrap ${badgeBg} ${badgeText}`}
      >
        <span>{statusIcon}</span>
        <span className="max-w-24 truncate">{analysis.displayMessage || analysis.status}</span>
      </span>
      {analysis.analyzedAt && (
        <div className="absolute left-0 top-full mt-1 hidden group-hover:block z-20 w-56 p-3 bg-slate-800 text-white text-xs rounded-lg shadow-lg">
          <div className="space-y-1">
            <div><span className="text-slate-400">Status:</span> {analysis.status}</div>
            {analysis.dueDate && <div><span className="text-slate-400">Due:</span> {formatDate(analysis.dueDate)}</div>}
            {analysis.actionType && <div><span className="text-slate-400">Action:</span> {analysis.actionType}</div>}
            {analysis.confidence !== null && (
              <div><span className="text-slate-400">Confidence:</span> {Math.round(analysis.confidence * 100)}%</div>
            )}
            <div className="text-slate-500 mt-2 pt-2 border-t border-slate-600">
              Analyzed: {formatDate(analysis.analyzedAt)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AnalyzeButton({
  dealId,
  ownerId,
  isAnalyzing,
  onAnalyze
}: {
  dealId: string;
  ownerId: string;
  isAnalyzing: boolean;
  onAnalyze: (dealId: string, ownerId: string) => void;
}) {
  return (
    <button
      onClick={() => onAnalyze(dealId, ownerId)}
      disabled={isAnalyzing}
      className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md transition-colors ${
        isAnalyzing
          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
          : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
      }`}
      title="Analyze next step with AI"
    >
      {isAnalyzing ? (
        <>
          <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span>...</span>
        </>
      ) : (
        <>
          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <span>Analyze</span>
        </>
      )}
    </button>
  );
}

export function DealsTable({ deals: initialDeals, ownerId }: DealsTableProps) {
  const [sortColumn, setSortColumn] = useState<SortColumn>('amount');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [quarterFilter, setQuarterFilter] = useState<QuarterFilter>(getCurrentQuarterFilter());
  const [filter, setFilter] = useState<DealFilter>('active');
  const [analyzingDeals, setAnalyzingDeals] = useState<Set<string>>(new Set());
  const [dealAnalyses, setDealAnalyses] = useState<Record<string, NextStepAnalysis>>({});

  // Get quarter options and info for filtering
  const quarterOptions = useMemo(() => getQuarterOptions(), []);
  const currentYear = quarterOptions[0]?.year || new Date().getFullYear();

  // Merge initial data with any updated analyses
  const deals = useMemo(() => {
    return initialDeals.map(deal => ({
      ...deal,
      nextStepAnalysis: dealAnalyses[deal.id] || deal.nextStepAnalysis,
    }));
  }, [initialDeals, dealAnalyses]);

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortOrder('desc');
    }
  };

  const handleAnalyze = useCallback(async (dealId: string, ownerIdParam: string) => {
    setAnalyzingDeals(prev => new Set(prev).add(dealId));

    try {
      const response = await fetch(`/api/ae/${ownerIdParam}/deals/${dealId}/analyze-next-step`, {
        method: 'POST',
      });

      if (response.ok) {
        const result = await response.json();
        setDealAnalyses(prev => ({
          ...prev,
          [dealId]: result.analysis,
        }));
      } else {
        console.error('Failed to analyze deal:', await response.text());
      }
    } catch (error) {
      console.error('Error analyzing deal:', error);
    } finally {
      setAnalyzingDeals(prev => {
        const next = new Set(prev);
        next.delete(dealId);
        return next;
      });
    }
  }, []);

  // Check if a deal's close date falls within a quarter
  const isInQuarter = useCallback((closeDate: string | null, quarterNum: number, year: number): boolean => {
    if (!closeDate) return false;
    const quarterInfo = getQuarterInfo(year, quarterNum);
    const date = new Date(closeDate);
    return date >= quarterInfo.startDate && date <= quarterInfo.endDate;
  }, []);

  const filteredDeals = useMemo(() => {
    return deals.filter((deal) => {
      const stageLower = (deal.stageName || deal.stage || '').toLowerCase();
      const isClosedWon = stageLower.includes('closed won') || stageLower.includes('closedwon');
      const isClosedLost = stageLower.includes('closed lost') || stageLower.includes('closedlost');

      // Filter by quarter first
      if (quarterFilter !== 'all') {
        const quarterNum = parseInt(quarterFilter.replace('q', ''), 10);
        if (!isInQuarter(deal.closeDate, quarterNum, currentYear)) {
          return false;
        }
      }

      // Then filter by status
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
  }, [deals, filter, quarterFilter, currentYear, isInQuarter]);

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
      {/* Header with filters */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Deals</h2>
        <div className="flex items-center gap-2">
          {/* Quarter filter */}
          <select
            value={quarterFilter}
            onChange={(e) => setQuarterFilter(e.target.value as QuarterFilter)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          >
            {quarterOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          {/* Status filter */}
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
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider whitespace-nowrap">
                Deal Name
              </th>
              <th
                className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                onClick={() => handleSort('amount')}
              >
                <div className="flex items-center gap-1">
                  <span>Amount</span>
                  <SortIcon active={sortColumn === 'amount'} order={sortOrder} />
                </div>
              </th>
              <th
                className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                onClick={() => handleSort('closeDate')}
              >
                <div className="flex items-center gap-1">
                  <span>Close Date</span>
                  <SortIcon active={sortColumn === 'closeDate'} order={sortOrder} />
                </div>
              </th>
              <th
                className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                onClick={() => handleSort('stage')}
              >
                <div className="flex items-center gap-1">
                  <span>Stage</span>
                  <SortIcon active={sortColumn === 'stage'} order={sortOrder} />
                </div>
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider whitespace-nowrap">
                Risk
              </th>
              {/* Activity columns */}
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider whitespace-nowrap">
                Create Date
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider whitespace-nowrap">
                Lead Source
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider whitespace-nowrap">
                Last Activity
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider whitespace-nowrap">
                Next Activity
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider whitespace-nowrap">
                Next Step
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider whitespace-nowrap">
                Step Status
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider whitespace-nowrap">
                Products
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider whitespace-nowrap">
                Substage
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider whitespace-nowrap">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sortedDeals.map((deal) => (
              <tr key={deal.id} className="hover:bg-slate-50 transition-colors">
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
                <td className="px-4 py-3 text-sm text-gray-900 whitespace-nowrap">
                  {deal.amount !== null ? formatCurrency(deal.amount) : '-'}
                </td>
                <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                  {formatDate(deal.closeDate)}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex px-2 py-1 text-xs font-medium rounded-full whitespace-nowrap ${getStageColor(deal.stage)}`}
                  >
                    {deal.stageName || deal.stage || 'Unknown'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <RiskBadge risk={deal.risk} />
                </td>
                {/* Activity columns */}
                <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                  {formatDate(deal.hubspotCreatedAt)}
                </td>
                <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                  {deal.leadSource || '-'}
                </td>
                <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                  {formatDate(deal.lastActivityDate)}
                </td>
                <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                  {formatDate(deal.nextActivityDate)}
                </td>
                <td className="px-4 py-3 text-sm text-gray-600 max-w-xs truncate" title={deal.nextStep || ''}>
                  {deal.nextStep || '-'}
                </td>
                <td className="px-4 py-3">
                  <NextStepStatusBadge analysis={deal.nextStepAnalysis} />
                </td>
                <td className="px-4 py-3 text-sm text-gray-600 max-w-xs truncate" title={deal.products || ''}>
                  {deal.products || '-'}
                </td>
                <td className="px-4 py-3">
                  {deal.dealSubstage ? (
                    <span className="inline-flex px-2 py-1 text-xs font-medium rounded-full bg-sky-100 text-sky-800 whitespace-nowrap">
                      {deal.dealSubstage}
                    </span>
                  ) : (
                    <span className="text-sm text-gray-400">-</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <AnalyzeButton
                    dealId={deal.id}
                    ownerId={ownerId}
                    isAnalyzing={analyzingDeals.has(deal.id)}
                    onAnalyze={handleAnalyze}
                  />
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
