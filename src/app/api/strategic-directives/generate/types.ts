// --- Strategic Directives Engine Types ---

export type DirectiveDomain =
  | 'deals'
  | 'support'
  | 'company_health'
  | 'team'
  | 'process'
  | 'cross_domain';

export type DirectiveUrgency =
  | 'immediate'
  | 'this_week'
  | 'this_month'
  | 'this_quarter';

export type StrategicFocus = 'revenue' | 'churn' | 'efficiency';
export type TimeRange = '7d' | '30d' | '90d';

// --- Phase 1: Domain Extraction Types ---

export interface DomainDataSource {
  domain: string;
  recordCount: number;
  dateRange: string;
}

export interface CompanyRollup {
  companyName: string;
  ticketCount: number;
  avgQualityScore: number | null;
  openTickets: number;
  criticalTickets: number;
  dealCount: number;
  totalPipelineValue: number;
  healthScore: string | null;
  arr: number | null;
  contractStatus: string | null;
  contractEnd: string | null;
}

export interface OwnerRollup {
  ownerName: string;
  ownerId: string;
  dealCount: number;
  avgDealGrade: string | null;
  atRiskDeals: number;
  ticketCount: number;
  avgTicketQuality: number | null;
  followUpCompliance: string | null;
}

export interface TemporalTrend {
  week: string;
  newTickets: number;
  closedTickets: number;
  avgQualityScore: number | null;
  dealsProgressed: number;
  dealsClosed: number;
}

export interface DomainExtraction {
  dealHealth: { compressed: string; stats: Record<string, unknown> };
  dealCoaching: { compressed: string; stats: Record<string, unknown> };
  supportQuality: { compressed: string; stats: Record<string, unknown> };
  sopCompliance: { compressed: string; stats: Record<string, unknown> };
  rcmAudit: { compressed: string; stats: Record<string, unknown> };
  supportTriage: { compressed: string; stats: Record<string, unknown> };
  companyHealth: { compressed: string; stats: Record<string, unknown> };
  followUps: { compressed: string; stats: Record<string, unknown> };
}

export interface CrossDomainCorrelations {
  companyRollups: CompanyRollup[];
  ownerRollups: OwnerRollup[];
  temporalTrends: TemporalTrend[];
}

export interface ExtractedData {
  domains: DomainExtraction;
  correlations: CrossDomainCorrelations;
  dataSources: DomainDataSource[];
}

// --- Phase 2: Domain Brief Types ---

export interface DomainBrief {
  domain: string;
  topFindings: string;
  keyMetrics: string;
  criticalRisks: string;
  brightSpots: string;
  rawText: string;
}

export interface DomainBriefs {
  dealPipeline: DomainBrief;
  supportOperations: DomainBrief;
  rcmBilling: DomainBrief;
  customerHealth: DomainBrief;
  teamPerformance: DomainBrief;
  pipelineVelocity: DomainBrief;
}

// --- Phase 3: Strategic Directives Output ---

export interface DirectiveAction {
  step: number;
  action: string;
  owner: string;
  deadline: string;
}

export interface Directive {
  rank: number;
  title: string;
  domain: DirectiveDomain;
  urgency: DirectiveUrgency;
  estimatedRevImpact: string;
  rootCause: string;
  actions: DirectiveAction[];
  evidence: string[];
  dependsOn: number[];
  successMetric: string;
}

export interface CrossDomainInsight {
  insight: string;
  domains: string[];
  evidence: string;
  implication: string;
}

export interface ScorecardEntry {
  grade: string;
  trend: 'improving' | 'stable' | 'declining';
  summary: string;
}

export interface OperationalScorecard {
  dealPipelineHealth: ScorecardEntry;
  supportQuality: ScorecardEntry;
  customerHealth: ScorecardEntry;
  teamPerformance: ScorecardEntry;
  processCompliance: ScorecardEntry;
}

export interface StrategicHorizonEntry {
  theme: string;
  objectives: string[];
  keyResults: string[];
}

export interface StrategicDirectivesReport {
  generatedAt: string;
  dataSources: DomainDataSource[];
  thinkingOutput: string;

  directives: Directive[];

  crossDomainInsights: CrossDomainInsight[];

  operationalScorecard: OperationalScorecard;

  strategicHorizon: {
    thirtyDay: StrategicHorizonEntry;
    sixtyDay: StrategicHorizonEntry;
    ninetyDay: StrategicHorizonEntry;
  };

  domainBriefs: Record<string, string>;

  // Timing metadata
  phase1DurationMs: number;
  phase2DurationMs: number;
  phase3DurationMs: number;
  totalDurationMs: number;
}

// --- Options ---

export interface StrategicDirectivesOptions {
  domains?: 'all' | string[];
  timeRange?: TimeRange;
  focus?: StrategicFocus;
  verbose?: boolean;
}
