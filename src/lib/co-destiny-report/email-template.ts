import type { CoDestinyReportData, CoDestinyTicketSummary } from './data';

function getUrgencyColor(urgency: string): string {
  switch (urgency) {
    case 'critical': return '#dc2626';
    case 'high': return '#ea580c';
    case 'medium': return '#ca8a04';
    case 'low': return '#16a34a';
    default: return '#6b7280';
  }
}

function getUrgencyBgColor(urgency: string): string {
  switch (urgency) {
    case 'critical': return '#fee2e2';
    case 'high': return '#fff7ed';
    case 'medium': return '#fef9c3';
    case 'low': return '#dcfce7';
    default: return '#f3f4f6';
  }
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/New_York',
  });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + '\u2026';
}

function renderUrgencyPill(urgency: string): string {
  const color = getUrgencyColor(urgency);
  const bg = getUrgencyBgColor(urgency);
  const label = urgency.charAt(0).toUpperCase() + urgency.slice(1);
  return `<span style="display:inline-block;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:600;color:${color};background-color:${bg};text-transform:uppercase;letter-spacing:0.03em;">${label}</span>`;
}

function renderTicketRow(ticket: CoDestinyTicketSummary): string {
  const subjectText = escapeHtml(ticket.subject || 'No subject');
  const summaryText = ticket.hasAnalysis
    ? escapeHtml(truncate(ticket.issueSummary || 'No summary available', 200))
    : '<em style="color:#94a3b8;">Awaiting analysis</em>';
  const nextActionText = ticket.hasAnalysis
    ? escapeHtml(truncate(ticket.nextAction || '-', 150))
    : '';

  const tempBadge = ticket.customerTemperature && ticket.customerTemperature !== 'calm'
    ? ` <span style="font-size:11px;color:${getUrgencyColor(ticket.customerTemperature === 'angry' ? 'critical' : 'high')};">(${ticket.customerTemperature})</span>`
    : '';

  const linearBadge = ticket.hasLinear
    ? ` <a href="${ticket.linearTask || '#'}" style="font-size:11px;color:#6366f1;text-decoration:none;" target="_blank">[Linear]</a>`
    : '';

  const activityText = ticket.daysSinceLastActivity != null
    ? `${ticket.daysSinceLastActivity}d`
    : '-';

  const ageText = ticket.ageDays != null ? `${ticket.ageDays}d` : '-';

  return `
    <tr style="border-bottom:1px solid #e5e7eb;">
      <td style="padding:10px 12px;vertical-align:top;width:80px;">
        ${renderUrgencyPill(ticket.urgency || 'unknown')}
      </td>
      <td style="padding:10px 12px;vertical-align:top;">
        <a href="${ticket.appTicketUrl}" style="color:#1e293b;font-weight:500;text-decoration:none;font-size:13px;" target="_blank">${subjectText}</a>
        <a href="${ticket.hubspotTicketUrl}" style="font-size:10px;color:#94a3b8;text-decoration:none;margin-left:4px;" target="_blank" title="Open in HubSpot">&#x1F517;</a>
        ${tempBadge}${linearBadge}
        <div style="margin-top:4px;font-size:12px;color:#475569;line-height:1.5;">${summaryText}</div>
        ${nextActionText ? `<div style="margin-top:3px;font-size:12px;color:#64748b;line-height:1.4;"><strong>Next:</strong> ${nextActionText}</div>` : ''}
      </td>
      <td style="padding:10px 8px;vertical-align:top;text-align:center;font-size:12px;color:#64748b;white-space:nowrap;">
        ${ageText}
      </td>
      <td style="padding:10px 8px;vertical-align:top;text-align:center;font-size:12px;color:${ticket.daysSinceLastActivity != null && ticket.daysSinceLastActivity >= 2 ? '#dc2626' : '#64748b'};white-space:nowrap;">
        ${activityText}
      </td>
    </tr>`;
}

function renderUrgencyCountPills(byUrgency: Record<string, number>): string {
  const order = ['critical', 'high', 'medium', 'low'];
  return order
    .filter((u) => byUrgency[u])
    .map((u) => {
      const color = getUrgencyColor(u);
      const bg = getUrgencyBgColor(u);
      return `<span style="display:inline-block;padding:3px 10px;border-radius:9999px;font-size:12px;font-weight:600;color:${color};background-color:${bg};margin:0 4px;">${byUrgency[u]} ${u}</span>`;
    })
    .join('');
}

function renderAllClearEmail(data: CoDestinyReportData, dateLabel: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:24px 16px;">
    <div style="background-color:#1e293b;color:white;padding:24px;border-radius:12px 12px 0 0;text-align:center;">
      <h1 style="margin:0 0 4px 0;font-size:22px;font-weight:700;">Co-Destiny VIP Report</h1>
      <p style="margin:0;font-size:14px;color:#94a3b8;">${dateLabel}</p>
    </div>
    <div style="background-color:white;padding:32px 24px;border-radius:0 0 12px 12px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
      <div style="font-size:36px;margin-bottom:12px;">&#x2705;</div>
      <h2 style="margin:0 0 8px 0;font-size:18px;color:#1e293b;">All Clear</h2>
      <p style="margin:0;font-size:14px;color:#475569;line-height:1.6;">
        ${data.totals.totalCoDestinyTickets > 0
          ? `All ${data.totals.totalCoDestinyTickets} open Co-Destiny tickets are currently medium/low urgency with no stale items.`
          : 'No open Co-Destiny tickets at this time.'}
      </p>
    </div>
    <p style="text-align:center;font-size:11px;color:#94a3b8;margin-top:24px;">
      Data refreshed hourly &middot; Analyses updated continuously during business hours
    </p>
  </div>
</body>
</html>`;
}

export function renderCoDestinyEmail(data: CoDestinyReportData): {
  subject: string;
  html: string;
} {
  const dateLabel = formatDate(data.date);
  const shortDate = data.date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone: 'America/New_York',
  });

  // All clear variant
  if (data.companies.length === 0) {
    return {
      subject: `Co-Destiny VIP Report \u2014 All Clear \u2014 ${shortDate}`,
      html: renderAllClearEmail(data, dateLabel),
    };
  }

  const subject = `Co-Destiny VIP Report \u2014 ${shortDate}`;

  // Build company sections
  const companySections = data.companies
    .map((company) => {
      const ticketRows = company.tickets.map(renderTicketRow).join('');
      const companySummaryHtml = company.companySummary
        ? `<p style="margin:0 0 12px 0;padding:8px 12px;font-size:13px;color:#334155;background-color:#f8fafc;border-radius:6px;line-height:1.5;">${escapeHtml(company.companySummary)}</p>`
        : '';

      return `
      <div style="margin-bottom:24px;">
        <div style="border-left:4px solid #3b82f6;padding:8px 12px;margin-bottom:8px;">
          <h2 style="margin:0;font-size:16px;font-weight:600;color:#1e293b;">${escapeHtml(company.companyName)}</h2>
          <span style="font-size:12px;color:#64748b;">${company.tickets.length} flagged ticket${company.tickets.length === 1 ? '' : 's'}</span>
        </div>
        ${companySummaryHtml}
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead>
            <tr style="background-color:#f8fafc;">
              <th style="padding:6px 12px;text-align:left;font-weight:600;color:#64748b;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #e2e8f0;">Urgency</th>
              <th style="padding:6px 12px;text-align:left;font-weight:600;color:#64748b;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #e2e8f0;">Ticket</th>
              <th style="padding:6px 8px;text-align:center;font-weight:600;color:#64748b;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #e2e8f0;">Age</th>
              <th style="padding:6px 8px;text-align:center;font-weight:600;color:#64748b;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid #e2e8f0;">Last Act.</th>
            </tr>
          </thead>
          <tbody>
            ${ticketRows}
          </tbody>
        </table>
      </div>`;
    })
    .join('');

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:640px;margin:0 auto;padding:24px 16px;">

    <!-- Header -->
    <div style="background-color:#1e293b;color:white;padding:24px;border-radius:12px 12px 0 0;text-align:center;">
      <h1 style="margin:0 0 4px 0;font-size:22px;font-weight:700;">Co-Destiny VIP Report</h1>
      <p style="margin:0;font-size:14px;color:#94a3b8;">${dateLabel}</p>
    </div>

    <!-- Summary Banner -->
    <div style="background-color:white;padding:16px 24px;border-bottom:1px solid #e5e7eb;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
      <div style="text-align:center;margin-bottom:8px;">
        <span style="font-size:15px;font-weight:600;color:#1e293b;">
          ${data.totals.flaggedTickets} flagged ticket${data.totals.flaggedTickets === 1 ? '' : 's'} across ${data.companies.length} account${data.companies.length === 1 ? '' : 's'}
        </span>
      </div>
      <div style="text-align:center;">
        ${renderUrgencyCountPills(data.totals.byUrgency)}
      </div>
    </div>

    <!-- Company Sections -->
    <div style="background-color:white;padding:20px;border-radius:0 0 12px 12px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
      ${companySections}
    </div>

    <!-- Footer -->
    <p style="text-align:center;font-size:11px;color:#94a3b8;margin-top:24px;">
      Data refreshed hourly &middot; Analyses updated continuously during business hours
    </p>
  </div>
</body>
</html>`;

  return { subject, html };
}
