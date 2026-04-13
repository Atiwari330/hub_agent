import { requirePermission, RESOURCES } from '@/lib/auth';
import { runDealsAnalysis } from '@/lib/analysis/deals-analysis';
import { RevenueSummary } from '@/components/dashboard/deals-analysis/revenue-summary';
import { SourcePerformanceTable } from '@/components/dashboard/deals-analysis/source-performance-table';
import { FunnelChart } from '@/components/dashboard/deals-analysis/funnel-chart';
import { AEComparisonTable } from '@/components/dashboard/deals-analysis/ae-comparison-table';
import { DataQualityAlerts } from '@/components/dashboard/deals-analysis/data-quality-alerts';

export default async function DealsAnalysisPage() {
  await requirePermission(RESOURCES.DEALS_ANALYSIS);

  const data = await runDealsAnalysis();

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Deals Analysis</h1>
        <p className="text-sm text-gray-500">
          {data.year} &middot; {data.conversion.totalCreated} deals created &middot; Analysis date:{' '}
          {data.analysisDate}
        </p>
      </div>

      <RevenueSummary data={data} />

      <SourcePerformanceTable
        sources={data.leadSources}
        details={data.leadSourceDetails}
        year={data.year}
      />

      <FunnelChart
        stages={data.funnel.stages}
        transitions={data.funnel.transitions}
        totalDeals={data.conversion.totalCreated}
      />

      <AEComparisonTable aeData={data.aePerformance} year={data.year} />

      <DataQualityAlerts quality={data.dataQuality} />
    </div>
  );
}
