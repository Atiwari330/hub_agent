'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { PricingComplianceCard } from './pricing-compliance-card';
import { PricingCompliancePanel } from './pricing-compliance-panel';

export interface PricingResult {
  id: string;
  deal_id: string;
  deal_name: string;
  amount: number | null;
  stage_name: string;
  owner_id: string | null;
  owner_name: string;
  demo_completed_at: string;
  demo_detected_via: string;
  pricing_sent_at: string | null;
  hours_to_pricing: number | null;
  exemption_noted_at: string | null;
  compliance_status: string;
  pricing_evidence: string | null;
  exemption_reason: string | null;
  analysis_rationale: string;
  executive_summary: string;
  risk_level: string;
  analyzed_at: string;
}

interface PricingOwner {
  id: string;
  name: string;
}

interface PricingSummary {
  totalDeals: number;
  byStatus: Record<string, number>;
  complianceRate: number | null;
  nonCompliantCount: number;
  lastAnalyzedAt: string | null;
}

const STATUS_ORDER: Record<string, number> = {
  NON_COMPLIANT: 0,
  STALE_STAGE: 1,
  PENDING: 2,
  EXEMPT: 3,
  COMPLIANT: 4,
};

function formatRelativeTime(dateString: string | null): string {
  if (!dateString) return 'Never';
  const diffMs = Date.now() - new Date(dateString).getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" width="16" height="16">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  );
}

function formatCurrency(amount: number | null): string {
  if (amount === null) return '--';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);
}

export function PricingComplianceDashboard() {
  const [results, setResults] = useState<PricingResult[]>([]);
  const [owners, setOwners] = useState<PricingOwner[]>([]);
  const [summary, setSummary] = useState<PricingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedOwnerId, setSelectedOwnerId] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
  const [selectedDeal, setSelectedDeal] = useState<PricingResult | null>(null);
  const [sortKey, setSortKey] = useState<'status' | 'demo_date' | 'amount' | 'hours'>('status');

  const fetchResults = useCallback(async () => {
    try {
      const res = await fetch('/api/pricing-compliance/results');
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setResults(data.results || []);
      setOwners(data.owners || []);
      setSummary(data.summary || null);
    } catch (err) {
      console.error('Failed to fetch pricing compliance results:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchResults();
  }, [fetchResults]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/pricing-compliance/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        await fetchResults();
      }
    } catch (err) {
      console.error('Refresh failed:', err);
    } finally {
      setRefreshing(false);
    }
  };

  // Filter and sort
  const filteredResults = useMemo(() => {
    let filtered = results;

    if (selectedOwnerId) {
      filtered = filtered.filter((r) => r.owner_id === selectedOwnerId);
    }
    if (selectedStatus) {
      filtered = filtered.filter((r) => r.compliance_status === selectedStatus);
    }

    const sorted = [...filtered];
    switch (sortKey) {
      case 'status':
        sorted.sort((a, b) => (STATUS_ORDER[a.compliance_status] ?? 99) - (STATUS_ORDER[b.compliance_status] ?? 99));
        break;
      case 'demo_date':
        sorted.sort((a, b) => new Date(b.demo_completed_at).getTime() - new Date(a.demo_completed_at).getTime());
        break;
      case 'amount':
        sorted.sort((a, b) => (b.amount || 0) - (a.amount || 0));
        break;
      case 'hours':
        sorted.sort((a, b) => {
          const aH = a.hours_to_pricing ?? 999;
          const bH = b.hours_to_pricing ?? 999;
          return aH - bH;
        });
        break;
    }

    return sorted;
  }, [results, selectedOwnerId, selectedStatus, sortKey]);

  // Per-owner stats for AE scoreboard
  const ownerStats = useMemo(() => {
    const stats = new Map<string, {
      id: string;
      name: string;
      total: number;
      compliant: number;
      exempt: number;
      nonCompliant: number;
      pending: number;
      avgHours: number | null;
      totalValue: number;
    }>();

    for (const r of results) {
      const id = r.owner_id || 'unknown';
      const existing = stats.get(id) || {
        id,
        name: r.owner_name,
        total: 0,
        compliant: 0,
        exempt: 0,
        nonCompliant: 0,
        pending: 0,
        avgHours: null,
        totalValue: 0,
      };

      existing.total++;
      existing.totalValue += r.amount || 0;

      if (r.compliance_status === 'COMPLIANT') existing.compliant++;
      else if (r.compliance_status === 'EXEMPT') existing.exempt++;
      else if (r.compliance_status === 'NON_COMPLIANT' || r.compliance_status === 'STALE_STAGE') existing.nonCompliant++;
      else if (r.compliance_status === 'PENDING') existing.pending++;

      stats.set(id, existing);
    }

    // Calculate avg hours for each owner
    for (const [id, stat] of stats) {
      const ownerResults = results.filter((r) => (r.owner_id || 'unknown') === id && r.hours_to_pricing !== null);
      if (ownerResults.length > 0) {
        stat.avgHours = ownerResults.reduce((sum, r) => sum + r.hours_to_pricing!, 0) / ownerResults.length;
      }
    }

    return Array.from(stats.values());
  }, [results]);

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-64" />
          <div className="h-4 bg-gray-200 rounded w-96" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-48 bg-gray-200 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const scored = results.filter((r) => r.compliance_status !== 'PENDING');
  const compliantCount = results.filter(
    (r) => r.compliance_status === 'COMPLIANT' || r.compliance_status === 'EXEMPT'
  ).length;
  const complianceRate = scored.length > 0 ? Math.round((compliantCount / scored.length) * 100) : null;

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pricing Compliance</h1>
          <p className="text-sm text-gray-500 mt-1">
            Pricing must be sent in writing within 24 hours of demo completion
          </p>
        </div>

        <div className="flex items-center gap-3">
          {summary?.lastAnalyzedAt && (
            <span className="text-xs text-gray-400">
              Analyzed {formatRelativeTime(summary.lastAnalyzedAt)}
            </span>
          )}
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshIcon className={refreshing ? 'animate-spin' : ''} />
            {refreshing ? 'Analyzing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Compliance Rate Banner */}
      <div className="flex flex-wrap items-center gap-6 mb-6 p-4 bg-white border border-gray-200 rounded-xl">
        <div className="flex items-baseline gap-2">
          <span className={`text-4xl font-bold ${
            complianceRate === null ? 'text-gray-400' :
            complianceRate >= 80 ? 'text-green-600' :
            complianceRate >= 60 ? 'text-amber-600' :
            'text-red-600'
          }`}>
            {complianceRate !== null ? `${complianceRate}%` : '--'}
          </span>
          <span className="text-sm text-gray-500">Compliance Rate</span>
        </div>
        <div className="h-8 w-px bg-gray-200" />
        <div className="flex flex-wrap gap-3">
          <StatPill label="Total" value={results.length} color="gray" />
          <StatPill label="Compliant" value={summary?.byStatus?.COMPLIANT || 0} color="green" />
          <StatPill label="Exempt" value={summary?.byStatus?.EXEMPT || 0} color="yellow" />
          <StatPill label="Pending" value={summary?.byStatus?.PENDING || 0} color="blue" />
          <StatPill label="Non-Compliant" value={summary?.byStatus?.NON_COMPLIANT || 0} color="red" />
          {(summary?.byStatus?.STALE_STAGE || 0) > 0 && (
            <StatPill label="Stale Stage" value={summary?.byStatus?.STALE_STAGE || 0} color="orange" />
          )}
        </div>
      </div>

      {/* AE Scoreboard */}
      {ownerStats.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          {ownerStats.map((stat) => {
            const scored = stat.total - stat.pending;
            const rate = scored > 0 ? Math.round(((stat.compliant + stat.exempt) / scored) * 100) : null;
            return (
              <button
                key={stat.id}
                onClick={() => setSelectedOwnerId(selectedOwnerId === stat.id ? null : stat.id)}
                className={`p-4 bg-white border rounded-xl text-left transition-all ${
                  selectedOwnerId === stat.id
                    ? 'border-indigo-500 ring-2 ring-indigo-200'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="font-semibold text-gray-900">{stat.name}</span>
                  <span className={`text-2xl font-bold ${
                    rate === null ? 'text-gray-400' :
                    rate >= 80 ? 'text-green-600' :
                    rate >= 60 ? 'text-amber-600' :
                    'text-red-600'
                  }`}>
                    {rate !== null ? `${rate}%` : '--'}
                  </span>
                </div>
                <div className="flex items-center gap-4 text-xs text-gray-500">
                  <span>{stat.total} deals</span>
                  <span>{formatCurrency(stat.totalValue)} pipeline</span>
                  {stat.avgHours !== null && (
                    <span>Avg {stat.avgHours.toFixed(1)}h to pricing</span>
                  )}
                </div>
                <div className="flex gap-1.5 mt-2">
                  {stat.compliant > 0 && (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-medium">
                      {stat.compliant} compliant
                    </span>
                  )}
                  {stat.exempt > 0 && (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 text-xs font-medium">
                      {stat.exempt} exempt
                    </span>
                  )}
                  {stat.nonCompliant > 0 && (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-medium">
                      {stat.nonCompliant} non-compliant
                    </span>
                  )}
                  {stat.pending > 0 && (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-medium">
                      {stat.pending} pending
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* AE Filter Pills */}
      {owners.length > 1 && (
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setSelectedOwnerId(null)}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              !selectedOwnerId
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            All
          </button>
          {owners.map((owner) => (
            <button
              key={owner.id}
              onClick={() => setSelectedOwnerId(selectedOwnerId === owner.id ? null : owner.id)}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                selectedOwnerId === owner.id
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {owner.name}
            </button>
          ))}
        </div>
      )}

      {/* Sort & Filter Toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 font-medium">Sort:</span>
          {([
            ['status', 'Status'],
            ['demo_date', 'Demo Date'],
            ['amount', 'Amount'],
            ['hours', 'Hours to Pricing'],
          ] as [typeof sortKey, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setSortKey(key)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                sortKey === key
                  ? 'bg-gray-800 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="h-4 w-px bg-gray-200" />

        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 font-medium">Filter:</span>
          <button
            onClick={() => setSelectedStatus(null)}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
              !selectedStatus ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            All
          </button>
          {([
            ['NON_COMPLIANT', 'Non-Compliant'],
            ['PENDING', 'Pending'],
            ['EXEMPT', 'Exempt'],
            ['COMPLIANT', 'Compliant'],
            ['STALE_STAGE', 'Stale Stage'],
          ] as [string, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setSelectedStatus(selectedStatus === key ? null : key)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                selectedStatus === key
                  ? 'bg-gray-800 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Deal Grid */}
      {filteredResults.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <svg className="w-12 h-12 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-sm font-medium">No deals to display</p>
          <p className="text-xs mt-1">Click Refresh to run a new analysis</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filteredResults.map((result) => (
            <PricingComplianceCard
              key={result.id}
              result={result}
              onClick={() => setSelectedDeal(result)}
            />
          ))}
        </div>
      )}

      {/* Slide-over detail panel */}
      {selectedDeal && (
        <PricingCompliancePanel
          result={selectedDeal}
          onClose={() => setSelectedDeal(null)}
          onReanalyze={handleRefresh}
        />
      )}
    </div>
  );
}

function StatPill({ label, value, color }: { label: string; value: number; color: string }) {
  const colorMap: Record<string, string> = {
    gray: 'bg-gray-100 text-gray-700',
    green: 'bg-green-100 text-green-700',
    yellow: 'bg-yellow-100 text-yellow-700',
    orange: 'bg-orange-100 text-orange-700',
    red: 'bg-red-100 text-red-700',
    blue: 'bg-blue-100 text-blue-700',
  };

  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 text-sm font-medium rounded-full ${colorMap[color] || colorMap.gray}`}>
      <span className="font-bold">{value}</span>
      <span className="text-xs opacity-75">{label}</span>
    </span>
  );
}
