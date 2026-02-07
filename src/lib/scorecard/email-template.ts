/**
 * HTML Email Template for Daily SPIFF Scorecard
 *
 * Renders AE performance data as a clean, mobile-friendly HTML email
 * using inline CSS (required for email client compatibility).
 */

import { CALL_TIERS, type DailyScorecardData } from './daily-scorecard';

function getTierColor(tier: string): string {
  switch (tier) {
    case 'Tier 3':
      return '#15803d'; // green-700
    case 'Tier 2':
      return '#16a34a'; // green-600
    case 'Tier 1':
      return '#2563eb'; // blue-600
    case 'Baseline':
      return '#ca8a04'; // yellow-600
    default:
      return '#dc2626'; // red-600
  }
}

function getTierBgColor(tier: string): string {
  switch (tier) {
    case 'Tier 3':
      return '#dcfce7'; // green-100
    case 'Tier 2':
      return '#dcfce7';
    case 'Tier 1':
      return '#dbeafe'; // blue-100
    case 'Baseline':
      return '#fef9c3'; // yellow-100
    default:
      return '#fee2e2'; // red-100
  }
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'America/New_York',
  });
}

export function renderScorecardEmail(data: DailyScorecardData): {
  subject: string;
  html: string;
} {
  const dateLabel = formatDate(data.date);

  const subject = `SPIFF Scorecard - ${data.date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/New_York',
  })}`;

  const aeRows = data.aes
    .map((ae) => {
      const tierColor = getTierColor(ae.callTier);
      const tierBg = getTierBgColor(ae.callTier);

      return `
        <tr>
          <td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb; font-weight: 500;">
            ${ae.name}
          </td>
          <td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb; text-align: center; font-size: 18px; font-weight: 600;">
            ${ae.qualifiedCalls}
          </td>
          <td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb; text-align: center;">
            <span style="display: inline-block; padding: 4px 12px; border-radius: 9999px; font-size: 13px; font-weight: 600; color: ${tierColor}; background-color: ${tierBg};">
              ${ae.callTier}
            </span>
          </td>
          <td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb; text-align: center; font-size: 18px; font-weight: 600;">
            ${ae.demosYesterday}
          </td>
        </tr>`;
    })
    .join('');

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; padding: 24px 16px;">

    <!-- Header -->
    <div style="background-color: #1e293b; color: white; padding: 24px; border-radius: 12px 12px 0 0; text-align: center;">
      <h1 style="margin: 0 0 4px 0; font-size: 22px; font-weight: 700;">SPIFF Scorecard</h1>
      <p style="margin: 0; font-size: 14px; color: #94a3b8;">${dateLabel}</p>
    </div>

    <!-- Table -->
    <div style="background-color: white; border-radius: 0 0 12px 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <thead>
          <tr style="background-color: #f8fafc;">
            <th style="padding: 12px 16px; text-align: left; font-weight: 600; color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 2px solid #e2e8f0;">
              AE
            </th>
            <th style="padding: 12px 16px; text-align: center; font-weight: 600; color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 2px solid #e2e8f0;">
              Calls
            </th>
            <th style="padding: 12px 16px; text-align: center; font-weight: 600; color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 2px solid #e2e8f0;">
              Tier
            </th>
            <th style="padding: 12px 16px; text-align: center; font-weight: 600; color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 2px solid #e2e8f0;">
              Demos
            </th>
          </tr>
        </thead>
        <tbody>
          ${aeRows}
        </tbody>
      </table>
    </div>

    <!-- Tier Reference -->
    <div style="margin-top: 16px; padding: 16px; background-color: white; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
      <p style="margin: 0 0 8px 0; font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em;">
        Daily Call Tiers
      </p>
      <p style="margin: 0; font-size: 13px; color: #475569; line-height: 1.6;">
        <span style="color: #dc2626;">Below: &lt;${CALL_TIERS.BASELINE}</span> &nbsp;&middot;&nbsp;
        <span style="color: #ca8a04;">Baseline: ${CALL_TIERS.BASELINE}-${CALL_TIERS.TIER_1 - 1}</span> &nbsp;&middot;&nbsp;
        <span style="color: #2563eb;">T1: ${CALL_TIERS.TIER_1}-${CALL_TIERS.TIER_2 - 1} ($50)</span> &nbsp;&middot;&nbsp;
        <span style="color: #16a34a;">T2: ${CALL_TIERS.TIER_2}-${CALL_TIERS.TIER_3 - 1} ($75)</span> &nbsp;&middot;&nbsp;
        <span style="color: #15803d;">T3: ${CALL_TIERS.TIER_3}+ ($100)</span>
      </p>
    </div>

    <!-- Footer -->
    <p style="text-align: center; font-size: 12px; color: #94a3b8; margin-top: 24px;">
      Calls counted: 15+ second duration only &nbsp;&middot;&nbsp; Demos: deals entering Demo Completed stage
    </p>
  </div>
</body>
</html>`;

  return { subject, html };
}
