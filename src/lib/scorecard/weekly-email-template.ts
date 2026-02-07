/**
 * HTML Email Template for Weekly SPIFF Scorecard
 *
 * Apple HIG-inspired design: summary cards → daily detail → motivational close.
 * Optimized for glanceability (<10 seconds to scan) and behavioral motivation.
 */

import {
  CALL_TIERS,
  DEMO_TIERS,
  type WeeklyScorecardData,
  type WeeklyAEData,
} from './weekly-scorecard';

/* ─── Color System ─────────────────────────────────────────────────────── */

function getTierBadgeStyle(tier: string): { color: string; bg: string } {
  switch (tier) {
    case 'Tier 3':
      return { color: '#15803d', bg: '#f0fdf4' }; // green-700 on green-50
    case 'Tier 2':
      return { color: '#16a34a', bg: '#f0fdf4' }; // green-600 on green-50
    case 'Tier 1':
      return { color: '#2563eb', bg: '#eff6ff' }; // blue-600 on blue-50
    case 'Baseline':
      return { color: '#475569', bg: '#f8fafc' }; // slate-600 on slate-50
    default: // "Below"
      return { color: '#94a3b8', bg: 'transparent' }; // slate-400, no bg
  }
}

function getDailyCellBg(tier: string): string {
  switch (tier) {
    case 'Tier 3':
    case 'Tier 2':
      return '#f0fdf4'; // very subtle green-50
    case 'Tier 1':
      return '#eff6ff'; // very subtle blue-50
    default:
      return 'transparent';
  }
}

/* ─── Helpers ──────────────────────────────────────────────────────────── */

function formatWeekRange(weekStart: Date, weekEnd: Date): string {
  const opts: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    timeZone: 'America/New_York',
  };
  const startStr = weekStart.toLocaleDateString('en-US', opts);
  const endStr = weekEnd.toLocaleDateString('en-US', {
    ...opts,
    year: 'numeric',
  });
  return `${startStr}\u2013${endStr}`;
}

function getSpiffAmount(tier: string): number {
  switch (tier) {
    case 'Tier 3': return 100;
    case 'Tier 2': return 75;
    case 'Tier 1': return 50;
    default: return 0;
  }
}

function getTopPerformer(aes: WeeklyAEData[]): WeeklyAEData | null {
  if (aes.length === 0) return null;
  return aes.reduce((best, ae) =>
    ae.weeklyTotalCalls > best.weeklyTotalCalls ? ae : best
  );
}

function getFirstName(fullName: string): string {
  return fullName.split(' ')[0];
}

/* ─── Summary Card ─────────────────────────────────────────────────────── */

function renderSummaryCard(ae: WeeklyAEData): string {
  const callBadge = getTierBadgeStyle(ae.weeklyCallTier);
  const demoBadge = getTierBadgeStyle(ae.weeklyDemoTier);

  const callSpiff = getSpiffAmount(ae.weeklyCallTier);
  const demoSpiff = getSpiffAmount(ae.weeklyDemoTier);
  const totalSpiff = callSpiff + demoSpiff;

  let verdict = '';
  if (totalSpiff > 0) {
    verdict = `<span style="color: #15803d; font-weight: 600;">$${totalSpiff} SPIFF earned</span>`;
  } else if (ae.weeklyCallTier === 'Baseline') {
    verdict = `<span style="color: #475569;">On the board — push for Tier 1 next week</span>`;
  } else {
    verdict = `<span style="color: #94a3b8;">Building momentum</span>`;
  }

  return `
    <div style="background-color: #ffffff; border-radius: 16px; padding: 24px; margin-bottom: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">
      <!-- Name -->
      <p style="margin: 0 0 16px 0; font-size: 15px; font-weight: 600; color: #1e293b; letter-spacing: -0.01em;">
        ${ae.name}
      </p>

      <!-- Metrics row -->
      <table style="width: 100%; border-collapse: collapse;" role="presentation">
        <tr>
          <!-- Calls -->
          <td style="width: 50%; vertical-align: top; padding-right: 12px;">
            <p style="margin: 0 0 2px 0; font-size: 11px; font-weight: 500; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em;">Calls</p>
            <p style="margin: 0 0 6px 0;">
              <span style="font-size: 32px; font-weight: 700; color: #0f172a; letter-spacing: -0.02em;">${ae.weeklyTotalCalls}</span>
            </p>
            <span style="display: inline-block; padding: 3px 10px; border-radius: 9999px; font-size: 12px; font-weight: 600; color: ${callBadge.color}; background-color: ${callBadge.bg}; ${callBadge.bg === 'transparent' ? '' : 'border: 1px solid ' + callBadge.color + '22;'}">
              ${ae.weeklyCallTier}
            </span>
          </td>

          <!-- Demos -->
          <td style="width: 50%; vertical-align: top; padding-left: 12px; border-left: 1px solid #f1f5f9;">
            <p style="margin: 0 0 2px 0; font-size: 11px; font-weight: 500; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em;">Demos</p>
            <p style="margin: 0 0 6px 0;">
              <span style="font-size: 32px; font-weight: 700; color: #0f172a; letter-spacing: -0.02em;">${ae.weeklyDemos}</span>
            </p>
            <span style="display: inline-block; padding: 3px 10px; border-radius: 9999px; font-size: 12px; font-weight: 600; color: ${demoBadge.color}; background-color: ${demoBadge.bg}; ${demoBadge.bg === 'transparent' ? '' : 'border: 1px solid ' + demoBadge.color + '22;'}">
              ${ae.weeklyDemoTier}
            </span>
          </td>
        </tr>
      </table>

      <!-- Verdict -->
      <p style="margin: 16px 0 0 0; font-size: 13px; line-height: 1.4;">
        ${verdict}
      </p>
    </div>`;
}

/* ─── Daily Breakdown Table ─────────────────────────────────────────────── */

function renderDailyBreakdown(aes: WeeklyAEData[]): string {
  // Check if any AE has weekend calls
  const hasWeekendCalls = aes.some((ae) =>
    ae.dailyCalls.slice(5, 7).some((d) => d.calls > 0)
  );

  // Column indices to show: Mon(0)–Fri(4), optionally Sat(5)/Sun(6)
  const dayIndices = hasWeekendCalls ? [0, 1, 2, 3, 4, 5, 6] : [0, 1, 2, 3, 4];
  const dayLabels = hasWeekendCalls
    ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

  const thStyle =
    'padding: 10px 8px; text-align: center; font-weight: 500; color: #94a3b8; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid #f1f5f9;';
  const thLeftStyle =
    'padding: 10px 12px; text-align: left; font-weight: 500; color: #94a3b8; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid #f1f5f9;';

  const dayHeaders = dayLabels
    .map((d) => `<th style="${thStyle}">${d}</th>`)
    .join('');

  const rows = aes
    .map((ae) => {
      const dayCells = dayIndices
        .map((idx) => {
          const day = ae.dailyCalls[idx];
          const bg = getDailyCellBg(day.tier);
          return `<td style="padding: 10px 8px; text-align: center; border-bottom: 1px solid #f8fafc;">
            <span style="display: inline-block; min-width: 28px; padding: 3px 8px; border-radius: 8px; font-size: 14px; font-weight: 600; color: #1e293b; background-color: ${bg};">
              ${day.calls}
            </span>
          </td>`;
        })
        .join('');

      return `
        <tr>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f8fafc; font-weight: 500; color: #334155; white-space: nowrap; font-size: 13px;">
            ${getFirstName(ae.name)}
          </td>
          ${dayCells}
        </tr>`;
    })
    .join('');

  return `
    <div style="background-color: #ffffff; border-radius: 16px; padding: 20px; margin-bottom: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">
      <p style="margin: 0 0 12px 0; font-size: 13px; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em;">
        Daily Breakdown
      </p>
      <table style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr>
            <th style="${thLeftStyle}">AE</th>
            ${dayHeaders}
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>`;
}

/* ─── Motivational Close ────────────────────────────────────────────────── */

function renderMotivationalClose(aes: WeeklyAEData[]): string {
  const top = getTopPerformer(aes);
  if (!top) return '';

  const callSpiff = getSpiffAmount(top.weeklyCallTier);
  const demoSpiff = getSpiffAmount(top.weeklyDemoTier);
  const totalSpiff = callSpiff + demoSpiff;

  let message: string;
  if (totalSpiff > 0) {
    message = `${top.name} led the team with ${top.weeklyTotalCalls} calls this week`;
  } else {
    message = `${top.name} led the team with ${top.weeklyTotalCalls} calls this week`;
  }

  return `
    <div style="text-align: center; padding: 20px 16px 8px 16px;">
      <p style="margin: 0; font-size: 14px; color: #475569; line-height: 1.5;">
        ${message}
      </p>
    </div>`;
}

/* ─── Tier Legend (compact) ──────────────────────────────────────────────── */

function renderTierLegend(): string {
  return `
    <div style="text-align: center; padding: 8px 16px 0 16px;">
      <p style="margin: 0; font-size: 11px; color: #94a3b8; line-height: 1.8;">
        <strong>Calls</strong> &nbsp;
        Baseline ${CALL_TIERS.BASELINE}+
        &middot; T1 ${CALL_TIERS.TIER_1}+ ($50)
        &middot; T2 ${CALL_TIERS.TIER_2}+ ($75)
        &middot; T3 ${CALL_TIERS.TIER_3}+ ($100)
        &nbsp;&nbsp;|&nbsp;&nbsp;
        <strong>Demos</strong> &nbsp;
        Baseline ${DEMO_TIERS.BASELINE}+
        &middot; T1 ${DEMO_TIERS.TIER_1}+ ($50)
        &middot; T2 ${DEMO_TIERS.TIER_2}+ ($75)
        &middot; T3 ${DEMO_TIERS.TIER_3}+ ($100)
      </p>
    </div>`;
}

/* ─── Main Export ──────────────────────────────────────────────────────── */

export function renderWeeklyScorecardEmail(data: WeeklyScorecardData): {
  subject: string;
  html: string;
} {
  const weekRange = formatWeekRange(data.weekStart, data.weekEnd);
  const subject = `Weekly SPIFF \u2014 ${weekRange}`;

  const summaryCards = data.aes.map((ae) => renderSummaryCard(ae)).join('');
  const dailyBreakdown = renderDailyBreakdown(data.aes);
  const motivationalClose = renderMotivationalClose(data.aes);
  const tierLegend = renderTierLegend();

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, sans-serif; -webkit-font-smoothing: antialiased;">
  <div style="max-width: 600px; margin: 0 auto; padding: 32px 16px;">

    <!-- Header -->
    <div style="text-align: center; padding: 0 0 28px 0;">
      <h1 style="margin: 0 0 4px 0; font-size: 24px; font-weight: 700; color: #0f172a; letter-spacing: -0.02em;">Weekly SPIFF</h1>
      <p style="margin: 0; font-size: 14px; color: #94a3b8; font-weight: 400;">${weekRange}</p>
    </div>

    <!-- Section 1: Summary Cards -->
    ${summaryCards}

    <!-- Section 2: Daily Breakdown -->
    ${dailyBreakdown}

    <!-- Section 3: Motivational Close -->
    ${motivationalClose}

    <!-- Compact Tier Legend -->
    ${tierLegend}

    <!-- Footer -->
    <p style="text-align: center; font-size: 11px; color: #cbd5e1; margin-top: 16px; line-height: 1.5;">
      Calls: all logged HubSpot calls &nbsp;&middot;&nbsp; Demos: deals entering Demo Completed
    </p>
  </div>
</body>
</html>`;

  return { subject, html };
}
