import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/client';
import { calculateDealRisk, RiskLevel } from '@/lib/utils/deal-risk';
import { SYNC_CONFIG } from '@/lib/hubspot/sync-config';
import { getAllPipelines, type Pipeline } from '@/lib/hubspot/pipelines';
import type { ExceptionType } from '@/components/dashboard/exception-card';
import type { StatusLevel } from '@/components/dashboard/ae-status-bar';

interface DealRecord {
  id: string;
  hubspot_deal_id: string;
  deal_name: string;
  amount: number | null;
  close_date: string | null;
  deal_stage: string | null;
  pipeline: string | null;
  owner_id: string | null;
  last_activity_date: string | null;
  next_activity_date: string | null;
  next_step: string | null;
  hubspot_created_at: string | null;
  sql_entered_at: string | null;
  demo_scheduled_entered_at: string | null;
  demo_completed_entered_at: string | null;
  next_step_due_date: string | null;
  next_step_status: string | null;
  owners?: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string;
  };
}

interface ExceptionDeal {
  id: string;
  hubspotDealId: string;
  dealName: string;
  amount: number | null;
  closeDate: string | null;
  stageName: string;
  ownerName: string;
  ownerId: string;
  exceptionType: ExceptionType;
  exceptionDetail: string;
  daysSinceActivity: number | null;
  daysInStage: number | null;
  nextStepDueDate: string | null;
}

interface AEStatus {
  id: string;
  name: string;
  initials: string;
  email: string;
  status: StatusLevel;
  overdueCount: number;
  staleCount: number;
  atRiskCount: number;
  healthyCount: number;
  totalDeals: number;
}

interface ExceptionCounts {
  overdueNextSteps: number;
  pastCloseDates: number;
  activityDrought: number;
  noNextStep: number;
  staleStage: number;
  highValueAtRisk: number;
}

function getOwnerDisplayName(owner: { first_name: string | null; last_name: string | null; email: string }): string {
  if (owner.first_name || owner.last_name) {
    return [owner.first_name, owner.last_name].filter(Boolean).join(' ');
  }
  return owner.email.split('@')[0];
}

function getOwnerInitials(owner: { first_name: string | null; last_name: string | null; email: string }): string {
  if (owner.first_name && owner.last_name) {
    return `${owner.first_name[0]}${owner.last_name[0]}`.toUpperCase();
  }
  if (owner.first_name) {
    return owner.first_name.slice(0, 2).toUpperCase();
  }
  return owner.email.slice(0, 2).toUpperCase();
}

function calculateAEStatus(overdueCount: number, staleCount: number): StatusLevel {
  // RED: 3+ overdue OR 5+ stale deals
  if (overdueCount >= 3 || staleCount >= 5) {
    return 'red';
  }
  // AMBER: 1-2 overdue OR 2-4 stale deals
  if (overdueCount >= 1 || staleCount >= 2) {
    return 'amber';
  }
  // GREEN: No overdue actions, < 2 stale deals
  return 'green';
}

export async function GET() {
  try {
    const supabase = createServiceClient();
    const now = new Date();
    const today = now.toISOString().split('T')[0];

    // Fetch target owners
    const { data: owners, error: ownersError } = await supabase
      .from('owners')
      .select('id, first_name, last_name, email')
      .in('email', SYNC_CONFIG.TARGET_AE_EMAILS)
      .order('last_name');

    if (ownersError) {
      console.error('Error fetching owners:', ownersError);
      return NextResponse.json({ error: 'Failed to fetch owners' }, { status: 500 });
    }

    const ownerIds = (owners || []).map((o) => o.id);

    // Fetch all active deals for target owners
    const { data: deals, error: dealsError } = await supabase
      .from('deals')
      .select(`
        id,
        hubspot_deal_id,
        deal_name,
        amount,
        close_date,
        deal_stage,
        pipeline,
        owner_id,
        last_activity_date,
        next_activity_date,
        next_step,
        hubspot_created_at,
        sql_entered_at,
        demo_scheduled_entered_at,
        demo_completed_entered_at,
        next_step_due_date,
        next_step_status,
        owners!inner (id, first_name, last_name, email)
      `)
      .in('owner_id', ownerIds)
      .order('amount', { ascending: false, nullsFirst: false });

    if (dealsError) {
      console.error('Error fetching deals:', dealsError);
      return NextResponse.json({ error: 'Failed to fetch deals' }, { status: 500 });
    }

    // Fetch pipelines for stage name lookup
    const pipelines = await getAllPipelines();
    const stageMap = new Map<string, string>();
    for (const pipeline of pipelines) {
      for (const stage of pipeline.stages) {
        stageMap.set(stage.id, stage.label);
      }
    }

    // Filter out closed deals
    const CLOSED_PATTERNS = ['closedwon', 'closedlost', 'closed won', 'closed lost', 'disqualified'];
    const activeDeals = (deals || []).filter((deal) => {
      const stageName = stageMap.get(deal.deal_stage || '') || deal.deal_stage || '';
      return !CLOSED_PATTERNS.some((p) => stageName.toLowerCase().includes(p));
    });

    // Process each deal for exceptions
    const exceptionDeals: ExceptionDeal[] = [];
    const aeStatusMap = new Map<string, {
      overdueCount: number;
      staleCount: number;
      atRiskCount: number;
      healthyCount: number;
      totalDeals: number;
    }>();

    // Initialize AE stats
    (owners || []).forEach((owner) => {
      aeStatusMap.set(owner.id, {
        overdueCount: 0,
        staleCount: 0,
        atRiskCount: 0,
        healthyCount: 0,
        totalDeals: 0,
      });
    });

    const counts: ExceptionCounts = {
      overdueNextSteps: 0,
      pastCloseDates: 0,
      activityDrought: 0,
      noNextStep: 0,
      staleStage: 0,
      highValueAtRisk: 0,
    };

    for (const deal of activeDeals) {
      const stageName = stageMap.get(deal.deal_stage || '') || deal.deal_stage || 'Unknown';
      const ownerData = deal.owners as unknown as { id: string; first_name: string | null; last_name: string | null; email: string };
      const ownerName = ownerData ? getOwnerDisplayName(ownerData) : 'Unknown';
      const ownerId = deal.owner_id || '';

      // Calculate risk
      const risk = calculateDealRisk({
        stageName,
        closeDate: deal.close_date,
        lastActivityDate: deal.last_activity_date,
        nextActivityDate: deal.next_activity_date,
        nextStep: deal.next_step,
        sqlEnteredAt: deal.sql_entered_at,
        demoScheduledEnteredAt: deal.demo_scheduled_entered_at,
        demoCompletedEnteredAt: deal.demo_completed_entered_at,
        hubspotCreatedAt: deal.hubspot_created_at,
        nextStepDueDate: deal.next_step_due_date,
        nextStepStatus: deal.next_step_status,
      });

      // Update AE stats
      const aeStats = aeStatusMap.get(ownerId);
      if (aeStats) {
        aeStats.totalDeals++;
        if (risk.level === 'stale') {
          aeStats.staleCount++;
        } else if (risk.level === 'at_risk') {
          aeStats.atRiskCount++;
        } else {
          aeStats.healthyCount++;
        }
      }

      // Check for specific exceptions
      const isHighValue = (deal.amount || 0) >= 50000;

      // 1. Overdue next steps (from LLM analysis)
      if (
        deal.next_step_due_date &&
        deal.next_step_status &&
        (deal.next_step_status === 'date_found' || deal.next_step_status === 'date_inferred') &&
        new Date(deal.next_step_due_date) < now
      ) {
        const daysOverdue = Math.floor((now.getTime() - new Date(deal.next_step_due_date).getTime()) / (1000 * 60 * 60 * 24));
        counts.overdueNextSteps++;
        if (aeStats) aeStats.overdueCount++;

        exceptionDeals.push({
          id: deal.id,
          hubspotDealId: deal.hubspot_deal_id,
          dealName: deal.deal_name,
          amount: deal.amount,
          closeDate: deal.close_date,
          stageName,
          ownerName,
          ownerId,
          exceptionType: 'overdue_next_step',
          exceptionDetail: `Next step overdue by ${daysOverdue} day${daysOverdue !== 1 ? 's' : ''}`,
          daysSinceActivity: risk.daysSinceActivity,
          daysInStage: risk.daysInStage,
          nextStepDueDate: deal.next_step_due_date,
        });
      }

      // 2. Past close dates
      if (deal.close_date && new Date(deal.close_date) < now) {
        const daysOverdue = Math.floor((now.getTime() - new Date(deal.close_date).getTime()) / (1000 * 60 * 60 * 24));
        counts.pastCloseDates++;

        // Only add if not already added as overdue_next_step (avoid duplicates)
        const alreadyAdded = exceptionDeals.some(
          (e) => e.id === deal.id && e.exceptionType === 'overdue_next_step'
        );

        if (!alreadyAdded) {
          exceptionDeals.push({
            id: deal.id,
            hubspotDealId: deal.hubspot_deal_id,
            dealName: deal.deal_name,
            amount: deal.amount,
            closeDate: deal.close_date,
            stageName,
            ownerName,
            ownerId,
            exceptionType: 'past_close_date',
            exceptionDetail: `Close date passed ${daysOverdue} day${daysOverdue !== 1 ? 's' : ''} ago`,
            daysSinceActivity: risk.daysSinceActivity,
            daysInStage: risk.daysInStage,
            nextStepDueDate: deal.next_step_due_date,
          });
        }
      }

      // 3. Activity drought (no activity in 7+ days, counted as 10+ for exception)
      if (risk.daysSinceActivity !== null && risk.daysSinceActivity >= 10) {
        counts.activityDrought++;

        // Add if not already in exceptions
        const alreadyAdded = exceptionDeals.some((e) => e.id === deal.id);
        if (!alreadyAdded) {
          exceptionDeals.push({
            id: deal.id,
            hubspotDealId: deal.hubspot_deal_id,
            dealName: deal.deal_name,
            amount: deal.amount,
            closeDate: deal.close_date,
            stageName,
            ownerName,
            ownerId,
            exceptionType: 'activity_drought',
            exceptionDetail: `No activity in ${risk.daysSinceActivity} days`,
            daysSinceActivity: risk.daysSinceActivity,
            daysInStage: risk.daysInStage,
            nextStepDueDate: deal.next_step_due_date,
          });
        }
      }

      // 4. High-value at risk
      if (isHighValue && risk.level === 'stale') {
        counts.highValueAtRisk++;

        // Add with high_value_at_risk type (might create duplicate ID, but different exception)
        exceptionDeals.push({
          id: `${deal.id}-hvr`,
          hubspotDealId: deal.hubspot_deal_id,
          dealName: deal.deal_name,
          amount: deal.amount,
          closeDate: deal.close_date,
          stageName,
          ownerName,
          ownerId,
          exceptionType: 'high_value_at_risk',
          exceptionDetail: `$${((deal.amount || 0) / 1000).toFixed(0)}k deal with ${risk.factors.length} risk factors`,
          daysSinceActivity: risk.daysSinceActivity,
          daysInStage: risk.daysInStage,
          nextStepDueDate: deal.next_step_due_date,
        });
      }
    }

    // Build AE statuses
    const aeStatuses: AEStatus[] = (owners || []).map((owner) => {
      const stats = aeStatusMap.get(owner.id)!;
      return {
        id: owner.id,
        name: getOwnerDisplayName(owner),
        initials: getOwnerInitials(owner),
        email: owner.email,
        status: calculateAEStatus(stats.overdueCount, stats.staleCount),
        overdueCount: stats.overdueCount,
        staleCount: stats.staleCount,
        atRiskCount: stats.atRiskCount,
        healthyCount: stats.healthyCount,
        totalDeals: stats.totalDeals,
      };
    });

    // Sort exceptions by priority (high value first, then by amount)
    exceptionDeals.sort((a, b) => {
      // High value at risk first
      if (a.exceptionType === 'high_value_at_risk' && b.exceptionType !== 'high_value_at_risk') return -1;
      if (b.exceptionType === 'high_value_at_risk' && a.exceptionType !== 'high_value_at_risk') return 1;
      // Then overdue next steps
      if (a.exceptionType === 'overdue_next_step' && b.exceptionType !== 'overdue_next_step') return -1;
      if (b.exceptionType === 'overdue_next_step' && a.exceptionType !== 'overdue_next_step') return 1;
      // Then by amount
      return (b.amount || 0) - (a.amount || 0);
    });

    // Check for critical alert (any high-value deal that needs action)
    const criticalDeals = exceptionDeals.filter(
      (d) => d.exceptionType === 'high_value_at_risk' || (d.exceptionType === 'past_close_date' && (d.amount || 0) >= 50000)
    );

    return NextResponse.json({
      date: today,
      summary: {
        totalActiveDeals: activeDeals.length,
        totalExceptions: exceptionDeals.length,
        counts,
      },
      hasCriticalAlert: criticalDeals.length > 0,
      criticalAlertMessage:
        criticalDeals.length > 0
          ? `${criticalDeals.length} high-value deal${criticalDeals.length !== 1 ? 's' : ''} need${criticalDeals.length === 1 ? 's' : ''} immediate attention`
          : null,
      aeStatuses,
      exceptionDeals: exceptionDeals.slice(0, 50), // Limit to top 50 for performance
    });
  } catch (error) {
    console.error('Error in daily summary:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
