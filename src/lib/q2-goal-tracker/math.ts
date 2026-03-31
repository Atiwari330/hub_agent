/**
 * Pure computation functions for the Q2 Goal Tracker.
 * No side effects — used client-side for instant slider updates.
 */

import type { LeadSourceRate, AEData, PipelineCredit } from './types';

// ── Core reverse-engineering math ──

export function computeDealsNeeded(target: number, avgDealSize: number): number {
  if (avgDealSize <= 0) return 0;
  return Math.ceil(target / avgDealSize);
}

export function computeDemosNeeded(dealsNeeded: number, demoToWonRate: number): number {
  if (demoToWonRate <= 0) return 0;
  return Math.ceil(dealsNeeded / demoToWonRate);
}

export function computeLeadsNeeded(demosNeeded: number, createToDemoRate: number): number {
  if (createToDemoRate <= 0) return 0;
  return Math.ceil(demosNeeded / createToDemoRate);
}

// ── Pipeline gap ──

export function computeWeightedPipeline(
  pipeline: PipelineCredit,
  demoToWonRate: number,
  createToDemoRate: number
): number {
  const postDemoWeighted = pipeline.postDemoRawARR * demoToWonRate;
  const preDemoWeighted = pipeline.preDemoRawARR * createToDemoRate * demoToWonRate;
  return Math.round(postDemoWeighted + preDemoWeighted);
}

export function computeGap(target: number, weightedPipeline: number): number {
  return Math.max(0, target - weightedPipeline);
}

// ── Weekly timeline zones ──

export interface WeekZone {
  weekNumber: number;
  weekStart: string;
  weekEnd: string;
  daysRemaining: number;
  zone: 'green' | 'yellow' | 'red';
  isCurrent: boolean;
}

export function computeWeeklyTimeline(
  quarterStart: string,
  quarterEnd: string,
  cycleTime: number,
  demoToCloseTime: number,
  currentDate: Date = new Date()
): WeekZone[] {
  const start = new Date(quarterStart);
  const end = new Date(quarterEnd);
  const weeks: WeekZone[] = [];

  for (let i = 0; i < 13; i++) {
    const weekStart = new Date(start.getTime() + i * 7 * 86400000);
    if (weekStart > end) break;
    const weekEnd = new Date(Math.min(weekStart.getTime() + 6 * 86400000, end.getTime()));
    const daysRemaining = Math.round((end.getTime() - weekStart.getTime()) / 86400000);

    let zone: 'green' | 'yellow' | 'red';
    if (daysRemaining >= cycleTime) {
      zone = 'green';
    } else if (daysRemaining >= demoToCloseTime) {
      zone = 'yellow';
    } else {
      zone = 'red';
    }

    const isCurrent = currentDate >= weekStart && currentDate <= weekEnd;

    weeks.push({
      weekNumber: i + 1,
      weekStart: weekStart.toISOString().split('T')[0],
      weekEnd: weekEnd.toISOString().split('T')[0],
      daysRemaining,
      zone,
      isCurrent,
    });
  }

  return weeks;
}

// ── Per-AE breakdown ──

export interface AERequirement {
  name: string;
  email: string;
  q2Target: number;
  closesNeeded: number;
  demosNeeded: number;
  leadsNeeded: number;
  closesPerMonth: number;
  demosPerMonth: number;
  bestQuarterARR: number;
  bestQuarterLabel: string;
  gapFactor: number; // target / bestQuarter (0 = no history)
}

export function computeAEBreakdown(
  aeData: AEData[],
  avgDealSize: number,
  demoToWonRate: number,
  createToDemoRate: number
): AERequirement[] {
  return aeData.map((ae) => {
    const closesNeeded = computeDealsNeeded(ae.q2Target, avgDealSize);
    const demosNeeded = computeDemosNeeded(closesNeeded, demoToWonRate);
    const leadsNeeded = computeLeadsNeeded(demosNeeded, createToDemoRate);
    const gapFactor = ae.bestQuarterARR > 0 ? ae.q2Target / ae.bestQuarterARR : 0;

    return {
      name: ae.name,
      email: ae.email,
      q2Target: ae.q2Target,
      closesNeeded,
      demosNeeded,
      leadsNeeded,
      closesPerMonth: Math.ceil(closesNeeded / 3),
      demosPerMonth: Math.ceil(demosNeeded / 3),
      bestQuarterARR: ae.bestQuarterARR,
      bestQuarterLabel: ae.bestQuarterLabel,
      gapFactor,
    };
  });
}

// ── Lead source breakdown ──

export interface SourceRequirement {
  source: string;
  createToDemoRate: number;
  leadsPerDemo: number;
  leadsNeededIfSoleSource: number;
}

export function computeSourceRequirements(
  demosNeeded: number,
  sourceRates: LeadSourceRate[]
): SourceRequirement[] {
  return sourceRates.map((s) => ({
    source: s.source,
    createToDemoRate: s.createToDemoRate,
    leadsPerDemo: s.createToDemoRate > 0 ? 1 / s.createToDemoRate : 0,
    leadsNeededIfSoleSource: s.createToDemoRate > 0 ? Math.ceil(demosNeeded / s.createToDemoRate) : 0,
  }));
}

// ── Cumulative pacing targets ──

export interface WeeklyTarget {
  weekNumber: number;
  cumulativeTarget: number; // linear pacing
}

export function computeWeeklyTargets(teamTarget: number, totalWeeks: number = 13): WeeklyTarget[] {
  const targets: WeeklyTarget[] = [];
  for (let i = 1; i <= totalWeeks; i++) {
    targets.push({
      weekNumber: i,
      cumulativeTarget: Math.round((teamTarget / totalWeeks) * i),
    });
  }
  return targets;
}
