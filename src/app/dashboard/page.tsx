import { createServerSupabaseClient } from '@/lib/supabase/client';
import { formatCurrency } from '@/lib/utils/currency';
import { getCurrentQuarter, getQuarterProgress } from '@/lib/utils/quarter';
import Link from 'next/link';

export default async function DashboardPage() {
  const supabase = await createServerSupabaseClient();

  // Fetch summary stats
  const [ownersResult, dealsResult] = await Promise.all([
    supabase.from('owners').select('id', { count: 'exact' }),
    supabase.from('deals').select('id, amount, deal_stage'),
  ]);

  const ownerCount = ownersResult.count || 0;
  const deals = dealsResult.data || [];

  // Calculate pipeline value (exclude closed deals)
  const CLOSED_PATTERNS = ['closedwon', 'closedlost', 'closed won', 'closed lost'];
  const pipelineDeals = deals.filter((deal) => {
    const stage = deal.deal_stage?.toLowerCase() || '';
    return !CLOSED_PATTERNS.some((p) => stage.includes(p));
  });
  const pipelineValue = pipelineDeals.reduce((sum, deal) => sum + (deal.amount || 0), 0);

  const quarter = getCurrentQuarter();
  const progress = getQuarterProgress(quarter);

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 mt-1">
          {quarter.label} &bull; Day {progress.daysElapsed} of {progress.totalDays}
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {/* AE Count */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="text-sm font-medium text-gray-500 mb-1">Account Executives</div>
          <div className="text-3xl font-semibold text-gray-900">{ownerCount}</div>
        </div>

        {/* Deal Count */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="text-sm font-medium text-gray-500 mb-1">Active Deals</div>
          <div className="text-3xl font-semibold text-gray-900">{pipelineDeals.length}</div>
        </div>

        {/* Pipeline Value */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="text-sm font-medium text-gray-500 mb-1">Total Pipeline</div>
          <div className="text-3xl font-semibold text-gray-900">
            {formatCurrency(pipelineValue)}
          </div>
        </div>
      </div>

      {/* Getting Started */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Getting Started</h2>
        <p className="text-gray-600 mb-4">
          Select an Account Executive from the sidebar to view their detailed performance metrics,
          pipeline analysis, and deal information.
        </p>
        <div className="flex gap-4">
          <Link
            href="/api/cron/sync-hubspot"
            className="inline-flex items-center px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
          >
            Sync HubSpot Data
          </Link>
        </div>
      </div>
    </div>
  );
}
