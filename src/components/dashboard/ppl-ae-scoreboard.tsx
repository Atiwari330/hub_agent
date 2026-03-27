'use client';

import type { PplResult } from './ppl-dashboard';

interface PplAeScoreboardProps {
  results: PplResult[];
  owners: Array<{ id: string; name: string }>;
  onSelectOwner: (id: string) => void;
}

function formatSpeed(minutes: number | null): string {
  if (minutes === null) return '--';
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

const VERDICT_COLORS: Record<string, { bg: string; text: string }> = {
  EXEMPLARY: { bg: 'bg-green-500', text: 'text-green-700' },
  COMPLIANT: { bg: 'bg-emerald-500', text: 'text-emerald-700' },
  NEEDS_IMPROVEMENT: { bg: 'bg-orange-400', text: 'text-orange-700' },
  NON_COMPLIANT: { bg: 'bg-red-400', text: 'text-red-700' },
};

export function PplAeScoreboard({ results, owners, onSelectOwner }: PplAeScoreboardProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
      {owners.map((owner) => {
        const aeResults = results.filter((r) => r.owner_id === owner.id);
        if (aeResults.length === 0) return null;

        const total = aeResults.length;
        const compliantPlus = aeResults.filter(
          (r) => r.verdict === 'COMPLIANT' || r.verdict === 'EXEMPLARY'
        ).length;
        const complianceRate = total > 0 ? compliantPlus / total : 0;

        const speedMinutes = aeResults
          .map((r) => (r.metrics as { speedToLeadMinutes?: number | null }).speedToLeadMinutes)
          .filter((m): m is number => m !== null && m !== undefined);
        const avgSpeed = speedMinutes.length > 0
          ? Math.round(speedMinutes.reduce((a, b) => a + b, 0) / speedMinutes.length)
          : null;

        const channels = aeResults
          .map((r) => (r.metrics as { channelDiversity?: number }).channelDiversity)
          .filter((c): c is number => c !== undefined && c !== null);
        const avgChannels = channels.length > 0
          ? (channels.reduce((a, b) => a + b, 0) / channels.length).toFixed(1)
          : '--';

        const riskCount = aeResults.filter((r) => r.risk_flag || r.engagement_risk).length;

        // Verdict breakdown
        const verdictCounts: Record<string, number> = {};
        for (const r of aeResults) {
          verdictCounts[r.verdict] = (verdictCounts[r.verdict] || 0) + 1;
        }

        const barColor = complianceRate >= 0.7 ? 'bg-green-500' : complianceRate >= 0.4 ? 'bg-amber-400' : 'bg-red-400';

        return (
          <button
            key={owner.id}
            onClick={() => onSelectOwner(owner.id)}
            className="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-lg hover:border-gray-300 transition-all text-left"
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
              <span className="text-base font-bold text-gray-900">{owner.name}</span>
              <span className="text-sm text-gray-400">{total} deals</span>
            </div>

            {/* Compliance bar */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs text-gray-500 font-medium">Compliance Rate</span>
                <span className="text-sm font-bold text-gray-800">
                  {compliantPlus}/{total} ({Math.round(complianceRate * 100)}%)
                </span>
              </div>
              <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${barColor}`}
                  style={{ width: `${Math.round(complianceRate * 100)}%` }}
                />
              </div>
            </div>

            {/* Verdict breakdown */}
            <div className="flex gap-2 mb-4">
              {(['EXEMPLARY', 'COMPLIANT', 'NEEDS_IMPROVEMENT', 'NON_COMPLIANT'] as const).map((v) => {
                const count = verdictCounts[v] || 0;
                if (count === 0) return null;
                const colors = VERDICT_COLORS[v];
                return (
                  <div key={v} className="flex items-center gap-1.5">
                    <span className={`w-2.5 h-2.5 rounded-full ${colors.bg}`} />
                    <span className={`text-xs font-medium ${colors.text}`}>{count}</span>
                  </div>
                );
              })}
            </div>

            {/* Stats row */}
            <div className="flex items-center gap-4 text-xs text-gray-500">
              <span>Avg Speed: <span className="font-semibold text-gray-700">{formatSpeed(avgSpeed)}</span></span>
              <span>Channels: <span className="font-semibold text-gray-700">{avgChannels}</span></span>
              {riskCount > 0 && (
                <span className="text-orange-600 font-semibold">{riskCount} risk{riskCount !== 1 ? 's' : ''}</span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
