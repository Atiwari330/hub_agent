export interface SourceMetrics {
  source: string;
  total: number;
  won: number;
  lost: number;
  open: number;
  winRate: number | null; // null if no closed deals
  wonRevenue: number;
  avgDealSize: number;
  avgDaysToClose: number | null;
  medianDaysToClose: number | null;
  demoCount: number;
  demoRate: number;
}

export interface SourceDetailMetrics {
  source: string;
  detail: string;
  total: number;
  won: number;
  lost: number;
  wonRevenue: number;
  winRate: number | null;
}

export interface AEMetrics {
  ownerId: string;
  name: string;
  email: string;
  total: number;
  won: number;
  lost: number;
  open: number;
  winRate: number | null;
  wonRevenue: number;
  avgDaysToClose: number | null;
  sourceBreakdown: {
    source: string;
    total: number;
    won: number;
    lost: number;
    winRate: number | null;
  }[];
}

export interface FunnelStage {
  stage: string;
  reached: number;
  pctOfTotal: number;
}

export interface StageTransition {
  from: string;
  to: string;
  rate: number;
  avgDays: number | null;
  medianDays: number | null;
  sampleSize: number;
}

export interface RevenueByMonth {
  month: string; // "2026-01"
  deals: number;
  revenue: number;
}

export interface RevenueBySource {
  source: string;
  deals: number;
  revenue: number;
  pctOfRevenue: number;
}

export interface RevenueByAE {
  name: string;
  email: string;
  deals: number;
  revenue: number;
}

export interface DuplicateRecord {
  dealName: string;
  recordCount: number;
  amount: number;
  hubspotDealIds: string[];
}

export interface DataQualityMetrics {
  totalDeals: number;
  missingAmount: number;
  missingAmountPct: number;
  missingLeadSource: number;
  missingLeadSourcePct: number;
  missingCloseDate: number;
  missingCloseDatePct: number;
  missingOwner: number;
  missingOwnerPct: number;
  duplicatesFound: DuplicateRecord[];
  duplicateRevenueInflation: number;
}

export interface DealsAnalysisResult {
  analysisDate: string;
  year: number;

  // Revenue (closed in year, any create date, deduped)
  revenue: {
    totalDeals: number;
    totalRevenue: number;
    avgDealSize: number;
    medianDealSize: number;
    byMonth: RevenueByMonth[];
    bySource: RevenueBySource[];
    byAE: RevenueByAE[];
  };

  // Conversion (created in year)
  conversion: {
    totalCreated: number;
    closedWon: number;
    closedLost: number;
    stillOpen: number;
    winRateOfClosed: number | null;
    wonRevenue: number;
    openPipeline: number;
    avgDaysToClose: number | null;
    medianDaysToClose: number | null;
  };

  // Lead source performance (created in year)
  leadSources: SourceMetrics[];
  leadSourceDetails: SourceDetailMetrics[];

  // AE performance (created in year)
  aePerformance: AEMetrics[];

  // Funnel (created in year)
  funnel: {
    stages: FunnelStage[];
    transitions: StageTransition[];
  };

  // Data quality (created in year)
  dataQuality: DataQualityMetrics;
}
