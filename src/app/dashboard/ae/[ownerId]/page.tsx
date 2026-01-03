import { notFound } from 'next/navigation';
import { AEHeader } from '@/components/dashboard/ae-header';
import { MetricsCards } from '@/components/dashboard/metrics-cards';
import { ActivityStatsBar } from '@/components/dashboard/activity-stats-bar';
import { TargetProgress } from '@/components/dashboard/target-progress';
import { WeeklyPipelineChart } from '@/components/dashboard/weekly-pipeline-chart';
import { DealsTable } from '@/components/dashboard/deals-table';

interface PageProps {
  params: Promise<{ ownerId: string }>;
}

async function fetchMetrics(ownerId: string, baseUrl: string) {
  const res = await fetch(`${baseUrl}/api/ae/${ownerId}/metrics`, {
    cache: 'no-store',
  });

  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error('Failed to fetch metrics');
  }

  return res.json();
}

async function fetchDeals(ownerId: string, baseUrl: string) {
  const res = await fetch(`${baseUrl}/api/ae/${ownerId}/deals?sortBy=amount&sortOrder=desc&limit=500`, {
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error('Failed to fetch deals');
  }

  return res.json();
}

export default async function AEDetailPage({ params }: PageProps) {
  const { ownerId } = await params;

  // Determine base URL for API calls
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

  // Fetch data in parallel
  const [metricsData, dealsData] = await Promise.all([
    fetchMetrics(ownerId, baseUrl),
    fetchDeals(ownerId, baseUrl),
  ]);

  if (!metricsData) {
    notFound();
  }

  return (
    <div className="p-8">
      {/* Header */}
      <AEHeader
        firstName={metricsData.owner.firstName}
        lastName={metricsData.owner.lastName}
        email={metricsData.owner.email}
      />

      {/* Quarter Info */}
      <div className="text-sm text-gray-500 mb-4">
        {metricsData.quarter.label} &bull; Day {metricsData.quarterProgress.daysElapsed} of{' '}
        {metricsData.quarterProgress.totalDays} ({metricsData.quarterProgress.percentComplete}% complete)
      </div>

      {/* Target Progress Banner */}
      <div className="mb-6">
        <TargetProgress ownerId={ownerId} />
      </div>

      {/* Metrics Cards */}
      <MetricsCards
        quota={metricsData.quota}
        paceToGoal={metricsData.paceToGoal}
        pipeline={metricsData.pipeline}
        quarterProgress={metricsData.quarterProgress.percentComplete}
      />

      {/* Activity Stats */}
      <ActivityStatsBar
        avgDealSize={metricsData.activityStats.avgDealSize}
        avgSalesCycle={metricsData.activityStats.avgSalesCycle}
        winRate={metricsData.activityStats.winRate}
        totalDeals={metricsData.activityStats.totalDeals}
        closedWonCount={metricsData.activityStats.closedWonCount}
        closedLostCount={metricsData.activityStats.closedLostCount}
      />

      {/* Weekly Pipeline Chart */}
      <div className="mt-6">
        <WeeklyPipelineChart ownerId={ownerId} />
      </div>

      {/* Deals Table */}
      <div className="mt-6">
        <DealsTable deals={dealsData.deals} ownerId={ownerId} />
      </div>
    </div>
  );
}
