import type { DataQualityMetrics } from '@/lib/analysis/types';

function pct(n: number): string {
  return (n * 100).toFixed(1) + '%';
}

function cur(n: number): string {
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function severity(pctVal: number): { color: string; label: string } {
  if (pctVal >= 0.5) return { color: 'bg-red-50 border-red-200 text-red-800', label: 'Critical' };
  if (pctVal >= 0.2) return { color: 'bg-yellow-50 border-yellow-200 text-yellow-800', label: 'Warning' };
  if (pctVal >= 0.05) return { color: 'bg-blue-50 border-blue-200 text-blue-800', label: 'Info' };
  return { color: 'bg-green-50 border-green-200 text-green-800', label: 'Good' };
}

interface Props {
  quality: DataQualityMetrics;
}

export function DataQualityAlerts({ quality }: Props) {
  const issues = [
    { label: 'Missing/zero amount', count: quality.missingAmount, pctVal: quality.missingAmountPct },
    { label: 'Missing lead source', count: quality.missingLeadSource, pctVal: quality.missingLeadSourcePct },
    { label: 'Missing close date', count: quality.missingCloseDate, pctVal: quality.missingCloseDatePct },
    { label: 'Missing owner', count: quality.missingOwner, pctVal: quality.missingOwnerPct },
  ];

  return (
    <div className="rounded-lg bg-white p-4 shadow">
      <h3 className="mb-3 text-sm font-semibold text-gray-700">
        Data Quality ({quality.totalDeals} deals)
      </h3>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {issues.map(issue => {
          const sev = severity(issue.pctVal);
          return (
            <div key={issue.label} className={`rounded border p-3 ${sev.color}`}>
              <p className="text-xs font-medium uppercase">{sev.label}</p>
              <p className="text-lg font-bold">{pct(issue.pctVal)}</p>
              <p className="text-xs">{issue.label}</p>
              <p className="text-xs opacity-70">{issue.count} of {quality.totalDeals}</p>
            </div>
          );
        })}
      </div>

      {quality.duplicatesFound.length > 0 && (
        <div className="mt-4 rounded border border-orange-200 bg-orange-50 p-3">
          <p className="text-sm font-medium text-orange-800">
            Duplicates Detected ({quality.duplicatesFound.length} deals)
          </p>
          <p className="text-xs text-orange-600">
            Revenue inflation removed: {cur(quality.duplicateRevenueInflation)}
          </p>
          <ul className="mt-2 space-y-1">
            {quality.duplicatesFound.map((d, i) => (
              <li key={i} className="text-xs text-orange-700">
                &quot;{d.dealName}&quot; — {d.recordCount} records at {cur(d.amount)} each
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
