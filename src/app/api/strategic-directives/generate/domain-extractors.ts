/**
 * Phase 1: Domain Extraction & Pre-computation
 *
 * Parallel DB queries to all analysis tables + cross-domain correlation computation.
 * No LLM calls — pure data extraction and statistical pre-computation.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CompanyRollup,
  OwnerRollup,
  TemporalTrend,
  DomainDataSource,
  ExtractedData,
  TimeRange,
} from './types';

// --- Time range filter helper ---

function getDateCutoff(timeRange: TimeRange): string {
  const now = new Date();
  const days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90;
  now.setDate(now.getDate() - days);
  return now.toISOString();
}

// --- Domain Extractors ---

async function extractDealHealth(
  supabase: SupabaseClient,
  cutoff: string
): Promise<{ compressed: string; stats: Record<string, unknown>; rows: Record<string, unknown>[] }> {
  const { data: rows, error } = await supabase
    .from('deal_intelligence')
    .select(
      'hubspot_deal_id, deal_name, overall_grade, overall_score, hygiene_score, momentum_score, engagement_score, risk_score, llm_status, llm_urgency, buyer_sentiment, deal_momentum, recommended_action, key_risk, amount, stage_name, days_in_stage, close_date, owner_name, issues, top_action'
    )
    .gte('updated_at', cutoff)
    .order('overall_score', { ascending: true });

  if (error) throw new Error(`deal_intelligence fetch failed: ${error.message}`);
  const data = rows || [];

  // Pre-compute stats
  const gradeDistribution: Record<string, number> = {};
  const statusDistribution: Record<string, number> = {};
  let totalScore = 0;
  let atRiskCount = 0;
  let stalledCount = 0;
  let totalAmount = 0;

  for (const row of data) {
    gradeDistribution[row.overall_grade] = (gradeDistribution[row.overall_grade] || 0) + 1;
    if (row.llm_status) statusDistribution[row.llm_status] = (statusDistribution[row.llm_status] || 0) + 1;
    totalScore += row.overall_score || 0;
    totalAmount += Number(row.amount) || 0;
    if (row.llm_status === 'at_risk') atRiskCount++;
    if (row.deal_momentum === 'stalled') stalledCount++;
  }

  // Compress each row to single line
  const lines = data.map(
    (r) =>
      `[${r.hubspot_deal_id}] ${r.deal_name} | Grade:${r.overall_grade} Score:${r.overall_score} | Stage:${r.stage_name} DaysInStage:${r.days_in_stage} | $${Number(r.amount || 0).toLocaleString()} Close:${r.close_date || 'N/A'} | Status:${r.llm_status || 'N/A'} Momentum:${r.deal_momentum || 'N/A'} Sentiment:${r.buyer_sentiment || 'N/A'} | Owner:${r.owner_name || 'N/A'} | Risk:${r.key_risk || 'None'} | Action:${r.top_action || r.recommended_action || 'None'}`
  );

  return {
    compressed: lines.join('\n'),
    stats: {
      totalDeals: data.length,
      avgScore: data.length ? Math.round(totalScore / data.length) : 0,
      gradeDistribution,
      statusDistribution,
      atRiskCount,
      stalledCount,
      totalPipelineValue: totalAmount,
    },
    rows: data,
  };
}

async function extractDealCoaching(
  supabase: SupabaseClient,
  cutoff: string
): Promise<{ compressed: string; stats: Record<string, unknown>; rows: Record<string, unknown>[] }> {
  const { data: rows, error } = await supabase
    .from('deal_coach_analyses')
    .select(
      'hubspot_deal_id, deal_name, status, urgency, buyer_sentiment, deal_momentum, recommended_action, reasoning, key_risk, amount, stage_name, days_in_stage, close_date, owner_name, confidence'
    )
    .gte('analyzed_at', cutoff)
    .order('analyzed_at', { ascending: false });

  if (error) throw new Error(`deal_coach_analyses fetch failed: ${error.message}`);
  const data = rows || [];

  const urgencyDistribution: Record<string, number> = {};
  const statusDistribution: Record<string, number> = {};
  for (const row of data) {
    urgencyDistribution[row.urgency] = (urgencyDistribution[row.urgency] || 0) + 1;
    statusDistribution[row.status] = (statusDistribution[row.status] || 0) + 1;
  }

  const lines = data.map(
    (r) =>
      `[${r.hubspot_deal_id}] ${r.deal_name} | Status:${r.status} Urgency:${r.urgency} | Sentiment:${r.buyer_sentiment || 'N/A'} Momentum:${r.deal_momentum || 'N/A'} | $${Number(r.amount || 0).toLocaleString()} Stage:${r.stage_name || 'N/A'} | Owner:${r.owner_name || 'N/A'} | Risk:${r.key_risk || 'None'} | Action:${r.recommended_action}`
  );

  return {
    compressed: lines.join('\n'),
    stats: {
      totalDeals: data.length,
      urgencyDistribution,
      statusDistribution,
    },
    rows: data,
  };
}

async function extractSupportQuality(
  supabase: SupabaseClient,
  cutoff: string
): Promise<{ compressed: string; stats: Record<string, unknown>; rows: Record<string, unknown>[] }> {
  const { data: rows, error } = await supabase
    .from('ticket_quality_analyses')
    .select(
      'hubspot_ticket_id, ticket_subject, company_name, assigned_rep, overall_quality_score, quality_grade, rep_competence_score, communication_score, resolution_score, efficiency_score, customer_sentiment, resolution_status, key_observations, improvement_areas, primary_category, severity, is_closed'
    )
    .gte('analyzed_at', cutoff)
    .order('overall_quality_score', { ascending: true });

  if (error) throw new Error(`ticket_quality_analyses fetch failed: ${error.message}`);
  const data = rows || [];

  const gradeDistribution: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  let totalScore = 0;
  for (const row of data) {
    gradeDistribution[row.quality_grade] = (gradeDistribution[row.quality_grade] || 0) + 1;
    totalScore += row.overall_quality_score;
  }

  const lines = data.map((r) => {
    const obs = (r.key_observations || '')
      .split('\n')
      .map((l: string) => l.replace(/^-\s*/, '').trim())
      .filter(Boolean)
      .join('; ');
    return `[${r.hubspot_ticket_id}] ${r.ticket_subject || 'No subject'} | ${r.company_name || 'Unknown'} | Rep:${r.assigned_rep || 'Unassigned'} | Grade:${r.quality_grade} Score:${r.overall_quality_score} | Rep:${r.rep_competence_score} Comm:${r.communication_score} Res:${r.resolution_score} Eff:${r.efficiency_score} | Sentiment:${r.customer_sentiment} Resolution:${r.resolution_status} | Cat:${r.primary_category || 'N/A'} | Obs:${obs.slice(0, 200)}`;
  });

  return {
    compressed: lines.join('\n'),
    stats: {
      totalTickets: data.length,
      avgScore: data.length ? Math.round(totalScore / data.length) : 0,
      gradeDistribution,
      openCount: data.filter((r) => !r.is_closed).length,
      closedCount: data.filter((r) => r.is_closed).length,
    },
    rows: data,
  };
}

async function extractSopCompliance(
  supabase: SupabaseClient,
  cutoff: string
): Promise<{ compressed: string; stats: Record<string, unknown>; rows: Record<string, unknown>[] }> {
  const { data: rows, error } = await supabase
    .from('ticket_sop_analyses')
    .select(
      'hubspot_ticket_id, ticket_subject, company_name, assigned_rep, sop_product_area, sop_issue_type, sop_severity, compliance_score, compliance_grade, triage_compliance_score, routing_compliance_score, authorization_compliance_score, communication_compliance_score, documentation_compliance_score, vendor_compliance_score, sop_gap_identified, sop_gap_description, sop_gap_severity, is_closed'
    )
    .gte('analyzed_at', cutoff)
    .order('compliance_score', { ascending: true });

  if (error) throw new Error(`ticket_sop_analyses fetch failed: ${error.message}`);
  const data = rows || [];

  const gradeDistribution: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  let totalScore = 0;
  let gapCount = 0;
  for (const row of data) {
    gradeDistribution[row.compliance_grade] = (gradeDistribution[row.compliance_grade] || 0) + 1;
    totalScore += row.compliance_score;
    if (row.sop_gap_identified) gapCount++;
  }

  const lines = data.map(
    (r) =>
      `[${r.hubspot_ticket_id}] ${r.ticket_subject || 'No subject'} | ${r.company_name || 'Unknown'} | Grade:${r.compliance_grade} Score:${r.compliance_score} | Area:${r.sop_product_area} Type:${r.sop_issue_type} Sev:${r.sop_severity} | Triage:${r.triage_compliance_score} Route:${r.routing_compliance_score} Auth:${r.authorization_compliance_score} Comm:${r.communication_compliance_score} Doc:${r.documentation_compliance_score} Vendor:${r.vendor_compliance_score ?? 'N/A'} | Gap:${r.sop_gap_identified ? r.sop_gap_description || 'Yes' : 'None'}`
  );

  return {
    compressed: lines.join('\n'),
    stats: {
      totalTickets: data.length,
      avgScore: data.length ? Math.round(totalScore / data.length) : 0,
      gradeDistribution,
      gapCount,
    },
    rows: data,
  };
}

async function extractRcmAudit(
  supabase: SupabaseClient,
  cutoff: string
): Promise<{ compressed: string; stats: Record<string, unknown>; rows: Record<string, unknown>[] }> {
  const { data: rows, error } = await supabase
    .from('ticket_rcm_analyses')
    .select(
      'hubspot_ticket_id, ticket_subject, company_name, assigned_rep, is_rcm_related, rcm_system, issue_category, issue_summary, problems, severity, current_status, vendor_blamed, is_closed'
    )
    .eq('is_rcm_related', true)
    .gte('analyzed_at', cutoff)
    .order('analyzed_at', { ascending: false });

  if (error) throw new Error(`ticket_rcm_analyses fetch failed: ${error.message}`);
  const data = rows || [];

  const severityDistribution: Record<string, number> = {};
  const systemDistribution: Record<string, number> = {};
  const categoryDistribution: Record<string, number> = {};
  let vendorBlamedCount = 0;
  for (const row of data) {
    if (row.severity) severityDistribution[row.severity] = (severityDistribution[row.severity] || 0) + 1;
    if (row.rcm_system) systemDistribution[row.rcm_system] = (systemDistribution[row.rcm_system] || 0) + 1;
    if (row.issue_category) categoryDistribution[row.issue_category] = (categoryDistribution[row.issue_category] || 0) + 1;
    if (row.vendor_blamed) vendorBlamedCount++;
  }

  const lines = data.map(
    (r) =>
      `[${r.hubspot_ticket_id}] ${r.ticket_subject || 'No subject'} | ${r.company_name || 'Unknown'} | System:${r.rcm_system || 'Unknown'} | Cat:${r.issue_category || 'N/A'} Sev:${r.severity || 'N/A'} | Status:${r.current_status || 'N/A'} | Vendor:${r.vendor_blamed ? 'YES' : 'No'} | Problems:${(r.problems || []).join('; ')} | Summary:${(r.issue_summary || '').slice(0, 200)}`
  );

  return {
    compressed: lines.join('\n'),
    stats: {
      totalRcmTickets: data.length,
      severityDistribution,
      systemDistribution,
      categoryDistribution,
      vendorBlamedCount,
    },
    rows: data,
  };
}

async function extractSupportTriage(
  supabase: SupabaseClient,
  cutoff: string
): Promise<{ compressed: string; stats: Record<string, unknown>; rows: Record<string, unknown>[] }> {
  const { data: rows, error } = await supabase
    .from('ticket_support_manager_analyses')
    .select(
      'hubspot_ticket_id, ticket_subject, company_name, assigned_rep, issue_summary, next_action, action_owner, urgency, days_since_last_activity, last_activity_by, age_days, is_closed, has_linear'
    )
    .gte('analyzed_at', cutoff)
    .order('analyzed_at', { ascending: false });

  if (error) throw new Error(`ticket_support_manager_analyses fetch failed: ${error.message}`);
  const data = rows || [];

  const urgencyDistribution: Record<string, number> = {};
  const ownerDistribution: Record<string, number> = {};
  let staleCount = 0;
  for (const row of data) {
    if (row.urgency) urgencyDistribution[row.urgency] = (urgencyDistribution[row.urgency] || 0) + 1;
    if (row.action_owner) ownerDistribution[row.action_owner] = (ownerDistribution[row.action_owner] || 0) + 1;
    if ((row.days_since_last_activity || 0) > 3) staleCount++;
  }

  const lines = data.map(
    (r) =>
      `[${r.hubspot_ticket_id}] ${r.ticket_subject || 'No subject'} | ${r.company_name || 'Unknown'} | Urgency:${r.urgency || 'N/A'} Owner:${r.action_owner || 'N/A'} | Age:${r.age_days || 0}d LastActivity:${r.days_since_last_activity || 0}d by ${r.last_activity_by || 'N/A'} | Linear:${r.has_linear ? 'Yes' : 'No'} | Action:${(r.next_action || '').slice(0, 200)}`
  );

  return {
    compressed: lines.join('\n'),
    stats: {
      totalTriaged: data.length,
      urgencyDistribution,
      ownerDistribution,
      staleCount,
      openCount: data.filter((r) => !r.is_closed).length,
      withLinear: data.filter((r) => r.has_linear).length,
    },
    rows: data,
  };
}

async function extractCompanyHealth(
  supabase: SupabaseClient
): Promise<{ compressed: string; stats: Record<string, unknown>; rows: Record<string, unknown>[] }> {
  const { data: rows, error } = await supabase
    .from('companies')
    .select(
      'hubspot_company_id, name, domain, health_score, health_score_status, sentiment, contract_end, contract_status, auto_renew, arr, mrr, total_revenue, last_activity_date, next_activity_date'
    )
    .order('arr', { ascending: false, nullsFirst: false });

  if (error) throw new Error(`companies fetch failed: ${error.message}`);
  const data = rows || [];

  const healthDistribution: Record<string, number> = {};
  const contractDistribution: Record<string, number> = {};
  let totalArr = 0;
  let atRiskCount = 0;
  for (const row of data) {
    if (row.health_score_status) healthDistribution[row.health_score_status] = (healthDistribution[row.health_score_status] || 0) + 1;
    if (row.contract_status) contractDistribution[row.contract_status] = (contractDistribution[row.contract_status] || 0) + 1;
    totalArr += Number(row.arr) || 0;
    if (row.health_score_status === 'At-Risk' || row.health_score_status === 'Poor') atRiskCount++;
  }

  const lines = data.map(
    (r) =>
      `${r.name || r.domain || 'Unknown'} | Health:${r.health_score ?? 'N/A'} (${r.health_score_status || 'N/A'}) | Sentiment:${r.sentiment || 'N/A'} | ARR:$${Number(r.arr || 0).toLocaleString()} | Contract:${r.contract_status || 'N/A'} Ends:${r.contract_end || 'N/A'} AutoRenew:${r.auto_renew || 'N/A'} | LastActivity:${r.last_activity_date || 'None'} NextActivity:${r.next_activity_date || 'None'}`
  );

  return {
    compressed: lines.join('\n'),
    stats: {
      totalCompanies: data.length,
      healthDistribution,
      contractDistribution,
      totalArr,
      atRiskCount,
    },
    rows: data,
  };
}

async function extractFollowUps(
  supabase: SupabaseClient,
  cutoff: string
): Promise<{ compressed: string; stats: Record<string, unknown>; rows: Record<string, unknown>[] }> {
  const { data: rows, error } = await supabase
    .from('follow_up_analyses')
    .select(
      'hubspot_ticket_id, ticket_subject, company_name, owner_name, status, urgency, customer_sentiment, recommended_action, violation_type, original_severity, gap_hours'
    )
    .gte('analyzed_at', cutoff)
    .order('analyzed_at', { ascending: false });

  if (error) throw new Error(`follow_up_analyses fetch failed: ${error.message}`);
  const data = rows || [];

  const urgencyDistribution: Record<string, number> = {};
  const statusDistribution: Record<string, number> = {};
  const violationDistribution: Record<string, number> = {};
  for (const row of data) {
    urgencyDistribution[row.urgency] = (urgencyDistribution[row.urgency] || 0) + 1;
    statusDistribution[row.status] = (statusDistribution[row.status] || 0) + 1;
    if (row.violation_type) violationDistribution[row.violation_type] = (violationDistribution[row.violation_type] || 0) + 1;
  }

  const lines = data.map(
    (r) =>
      `[${r.hubspot_ticket_id}] ${r.ticket_subject || 'No subject'} | ${r.company_name || 'Unknown'} | Owner:${r.owner_name || 'N/A'} | Status:${r.status} Urgency:${r.urgency} | Sentiment:${r.customer_sentiment || 'N/A'} | Violation:${r.violation_type || 'None'} Gap:${r.gap_hours || 0}h | Action:${(r.recommended_action || '').slice(0, 150)}`
  );

  return {
    compressed: lines.join('\n'),
    stats: {
      totalFollowUps: data.length,
      urgencyDistribution,
      statusDistribution,
      violationDistribution,
      confirmedCount: data.filter((r) => r.status === 'confirmed').length,
    },
    rows: data,
  };
}

// --- Cross-Domain Correlations ---

function buildCompanyRollups(
  companies: Record<string, unknown>[],
  tickets: Record<string, unknown>[]
): CompanyRollup[] {
  const rollupMap = new Map<string, CompanyRollup>();

  // Seed from companies
  for (const c of companies) {
    const name = (c.name as string) || (c.domain as string) || 'Unknown';
    rollupMap.set(name.toLowerCase(), {
      companyName: name,
      ticketCount: 0,
      avgQualityScore: null,
      openTickets: 0,
      criticalTickets: 0,
      dealCount: 0,
      totalPipelineValue: 0,
      healthScore: (c.health_score_status as string) || null,
      arr: Number(c.arr) || null,
      contractStatus: (c.contract_status as string) || null,
      contractEnd: (c.contract_end as string) || null,
    });
  }

  // Aggregate tickets by company
  const ticketScores = new Map<string, number[]>();
  for (const t of tickets) {
    const name = ((t.company_name as string) || 'Unknown').toLowerCase();
    if (!rollupMap.has(name)) {
      rollupMap.set(name, {
        companyName: (t.company_name as string) || 'Unknown',
        ticketCount: 0,
        avgQualityScore: null,
        openTickets: 0,
        criticalTickets: 0,
        dealCount: 0,
        totalPipelineValue: 0,
        healthScore: null,
        arr: null,
        contractStatus: null,
        contractEnd: null,
      });
    }
    const rollup = rollupMap.get(name)!;
    rollup.ticketCount++;
    if (!t.is_closed) rollup.openTickets++;
    if ((t.urgency as string) === 'critical' || (t.severity as string) === 'critical') rollup.criticalTickets++;

    const score = t.overall_quality_score as number | undefined;
    if (score !== undefined) {
      if (!ticketScores.has(name)) ticketScores.set(name, []);
      ticketScores.get(name)!.push(score);
    }
  }

  // Set avg quality scores
  for (const [name, scores] of ticketScores) {
    const rollup = rollupMap.get(name);
    if (rollup && scores.length > 0) {
      rollup.avgQualityScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    }
  }

  // Aggregate deals by owner->company (deals don't have company directly, skip for now)
  // Deals are associated via owner, not company directly in this schema

  return Array.from(rollupMap.values())
    .filter((r) => r.ticketCount > 0 || (r.arr && r.arr > 0))
    .sort((a, b) => (b.arr || 0) - (a.arr || 0));
}

function buildOwnerRollups(
  dealCoach: Record<string, unknown>[],
  dealHealth: Record<string, unknown>[],
  qualityAnalyses: Record<string, unknown>[],
  followUps: Record<string, unknown>[]
): OwnerRollup[] {
  const rollupMap = new Map<string, OwnerRollup>();

  // Deals by owner
  for (const d of dealHealth) {
    const name = (d.owner_name as string) || 'Unknown';
    const key = name.toLowerCase();
    if (!rollupMap.has(key)) {
      rollupMap.set(key, {
        ownerName: name,
        ownerId: (d.owner_id as string) || '',
        dealCount: 0,
        avgDealGrade: null,
        atRiskDeals: 0,
        ticketCount: 0,
        avgTicketQuality: null,
        followUpCompliance: null,
      });
    }
    const rollup = rollupMap.get(key)!;
    rollup.dealCount++;
    if ((d.llm_status as string) === 'at_risk') rollup.atRiskDeals++;
  }

  // Compute avg deal grade per owner
  const ownerGrades = new Map<string, string[]>();
  for (const d of dealHealth) {
    const key = ((d.owner_name as string) || 'Unknown').toLowerCase();
    if (!ownerGrades.has(key)) ownerGrades.set(key, []);
    ownerGrades.get(key)!.push(d.overall_grade as string);
  }
  for (const [key, grades] of ownerGrades) {
    const rollup = rollupMap.get(key);
    if (rollup) {
      // Most common grade
      const counts: Record<string, number> = {};
      for (const g of grades) counts[g] = (counts[g] || 0) + 1;
      rollup.avgDealGrade = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    }
  }

  // Tickets by assigned rep
  const repScores = new Map<string, number[]>();
  for (const t of qualityAnalyses) {
    const name = (t.assigned_rep as string) || 'Unknown';
    const key = name.toLowerCase();
    if (!rollupMap.has(key)) {
      rollupMap.set(key, {
        ownerName: name,
        ownerId: '',
        dealCount: 0,
        avgDealGrade: null,
        atRiskDeals: 0,
        ticketCount: 0,
        avgTicketQuality: null,
        followUpCompliance: null,
      });
    }
    rollupMap.get(key)!.ticketCount++;
    const score = t.overall_quality_score as number | undefined;
    if (score !== undefined) {
      if (!repScores.has(key)) repScores.set(key, []);
      repScores.get(key)!.push(score);
    }
  }

  for (const [key, scores] of repScores) {
    const rollup = rollupMap.get(key);
    if (rollup && scores.length > 0) {
      rollup.avgTicketQuality = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    }
  }

  // Follow-up compliance by owner
  const ownerFollowUps = new Map<string, { confirmed: number; total: number }>();
  for (const f of followUps) {
    const name = ((f.owner_name as string) || 'Unknown').toLowerCase();
    if (!ownerFollowUps.has(name)) ownerFollowUps.set(name, { confirmed: 0, total: 0 });
    ownerFollowUps.get(name)!.total++;
    if ((f.status as string) === 'confirmed') ownerFollowUps.get(name)!.confirmed++;
  }

  for (const [key, data] of ownerFollowUps) {
    const rollup = rollupMap.get(key);
    if (rollup && data.total > 0) {
      const pct = Math.round((data.confirmed / data.total) * 100);
      rollup.followUpCompliance = `${pct}% confirmed (${data.confirmed}/${data.total})`;
    }
  }

  return Array.from(rollupMap.values())
    .filter((r) => r.dealCount > 0 || r.ticketCount > 0)
    .sort((a, b) => b.dealCount - a.dealCount);
}

function buildTemporalTrends(
  tickets: Record<string, unknown>[],
  deals: Record<string, unknown>[]
): TemporalTrend[] {
  const weekMap = new Map<string, TemporalTrend>();

  // Helper to get ISO week string
  function getWeekKey(dateStr: string): string {
    const d = new Date(dateStr);
    const start = new Date(d);
    start.setDate(start.getDate() - start.getDay());
    return start.toISOString().split('T')[0];
  }

  // Tickets by week
  for (const t of tickets) {
    const created = (t.ticket_created_at as string) || (t.analyzed_at as string);
    if (!created) continue;
    const week = getWeekKey(created);
    if (!weekMap.has(week)) {
      weekMap.set(week, { week, newTickets: 0, closedTickets: 0, avgQualityScore: null, dealsProgressed: 0, dealsClosed: 0 });
    }
    const entry = weekMap.get(week)!;
    entry.newTickets++;
    if (t.is_closed) entry.closedTickets++;
  }

  // Deals by week (using close_date for closed deals)
  for (const d of deals) {
    const closeDate = d.close_date as string;
    if (!closeDate) continue;
    const week = getWeekKey(closeDate);
    if (!weekMap.has(week)) {
      weekMap.set(week, { week, newTickets: 0, closedTickets: 0, avgQualityScore: null, dealsProgressed: 0, dealsClosed: 0 });
    }
    weekMap.get(week)!.dealsClosed++;
  }

  return Array.from(weekMap.values()).sort((a, b) => a.week.localeCompare(b.week));
}

// --- Main Extractor ---

export async function extractAllDomains(
  supabase: SupabaseClient,
  options?: { timeRange?: TimeRange }
): Promise<ExtractedData> {
  const cutoff = getDateCutoff(options?.timeRange || '30d');

  // Phase 1: Parallel extraction of all domains
  const [dealHealth, dealCoaching, supportQuality, sopCompliance, rcmAudit, supportTriage, companyHealth, followUps] =
    await Promise.all([
      extractDealHealth(supabase, cutoff),
      extractDealCoaching(supabase, cutoff),
      extractSupportQuality(supabase, cutoff),
      extractSopCompliance(supabase, cutoff),
      extractRcmAudit(supabase, cutoff),
      extractSupportTriage(supabase, cutoff),
      extractCompanyHealth(supabase),
      extractFollowUps(supabase, cutoff),
    ]);

  // Cross-domain correlations
  const companyRollups = buildCompanyRollups(
    companyHealth.rows,
    [...supportQuality.rows, ...supportTriage.rows]
  );
  const ownerRollups = buildOwnerRollups(
    dealCoaching.rows,
    dealHealth.rows,
    supportQuality.rows,
    followUps.rows
  );
  const temporalTrends = buildTemporalTrends(supportQuality.rows, dealHealth.rows);

  const dataSources: DomainDataSource[] = [
    { domain: 'deal_health', recordCount: dealHealth.rows.length, dateRange: `since ${cutoff.split('T')[0]}` },
    { domain: 'deal_coaching', recordCount: dealCoaching.rows.length, dateRange: `since ${cutoff.split('T')[0]}` },
    { domain: 'support_quality', recordCount: supportQuality.rows.length, dateRange: `since ${cutoff.split('T')[0]}` },
    { domain: 'sop_compliance', recordCount: sopCompliance.rows.length, dateRange: `since ${cutoff.split('T')[0]}` },
    { domain: 'rcm_audit', recordCount: rcmAudit.rows.length, dateRange: `since ${cutoff.split('T')[0]}` },
    { domain: 'support_triage', recordCount: supportTriage.rows.length, dateRange: `since ${cutoff.split('T')[0]}` },
    { domain: 'company_health', recordCount: companyHealth.rows.length, dateRange: 'all' },
    { domain: 'follow_ups', recordCount: followUps.rows.length, dateRange: `since ${cutoff.split('T')[0]}` },
  ];

  return {
    domains: {
      dealHealth: { compressed: dealHealth.compressed, stats: dealHealth.stats },
      dealCoaching: { compressed: dealCoaching.compressed, stats: dealCoaching.stats },
      supportQuality: { compressed: supportQuality.compressed, stats: supportQuality.stats },
      sopCompliance: { compressed: sopCompliance.compressed, stats: sopCompliance.stats },
      rcmAudit: { compressed: rcmAudit.compressed, stats: rcmAudit.stats },
      supportTriage: { compressed: supportTriage.compressed, stats: supportTriage.stats },
      companyHealth: { compressed: companyHealth.compressed, stats: companyHealth.stats },
      followUps: { compressed: followUps.compressed, stats: followUps.stats },
    },
    correlations: {
      companyRollups,
      ownerRollups,
      temporalTrends,
    },
    dataSources,
  };
}
