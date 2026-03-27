'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { PplDealCard } from './ppl-deal-card';
import { PplAeScoreboard } from './ppl-ae-scoreboard';
import { PplDealPanel } from './ppl-deal-panel';

export interface PplResult {
  id: string;
  deal_id: string;
  deal_name: string;
  amount: number | null;
  stage_name: string;
  owner_id: string | null;
  owner_name: string;
  close_date: string | null;
  create_date: string;
  deal_age_days: number;
  metrics: Record<string, unknown>;
  three_compliance: string;
  three_rationale: string;
  two_compliance: string;
  two_rationale: string;
  one_compliance: string;
  one_rationale: string;
  speed_rating: string;
  speed_rationale: string;
  channel_diversity_rating: string;
  prospect_engagement: string;
  nurture_window: string;
  engagement_insight: string;
  verdict: string;
  coaching: string;
  risk_flag: boolean;
  engagement_risk: boolean;
  executive_summary: string;
  timeline: string;
  analyzed_at: string;
}

interface PplOwner {
  id: string;
  name: string;
}

interface PplSummary {
  totalDeals: number;
  byVerdict: Record<string, number>;
  riskCount: number;
  engagementRiskCount: number;
  lastAnalyzedAt: string | null;
}

type SortKey = 'verdict' | 'age' | 'amount' | 'speed';

const MAX_AGE_DAYS = 14;

const VERDICT_ORDER: Record<string, number> = {
  NON_COMPLIANT: 0,
  NEEDS_IMPROVEMENT: 1,
  COMPLIANT: 2,
  EXEMPLARY: 3,
  UNKNOWN: 4,
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

export function PplDashboard() {
  const [results, setResults] = useState<PplResult[]>([]);
  const [owners, setOwners] = useState<PplOwner[]>([]);
  const [summary, setSummary] = useState<PplSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedOwnerId, setSelectedOwnerId] = useState<string | null>(null);
  const [selectedVerdict, setSelectedVerdict] = useState<string | null>(null);
  const [riskOnly, setRiskOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('verdict');
  const [selectedDeal, setSelectedDeal] = useState<PplResult | null>(null);
  const [showHowItWorks, setShowHowItWorks] = useState(false);

  const fetchResults = useCallback(async () => {
    try {
      const res = await fetch('/api/ppl/results');
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setResults(data.results || []);
      setOwners(data.owners || []);
      setSummary(data.summary || null);
    } catch (err) {
      console.error('Failed to fetch PPL results:', err);
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
      const res = await fetch('/api/ppl/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(selectedOwnerId ? { ownerEmail: owners.find(o => o.id === selectedOwnerId)?.name } : {}),
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

  // Age-filtered results (last 14 days only)
  const recentResults = useMemo(() => {
    const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
    return results.filter((r) => r.create_date && new Date(r.create_date).getTime() >= cutoff);
  }, [results]);

  // Recompute summary from recent results
  const recentSummary = useMemo(() => {
    if (recentResults.length === 0) return null;
    const byVerdict: Record<string, number> = {};
    for (const r of recentResults) {
      byVerdict[r.verdict] = (byVerdict[r.verdict] || 0) + 1;
    }
    return {
      totalDeals: recentResults.length,
      byVerdict,
      riskCount: recentResults.filter((r) => r.risk_flag).length,
      engagementRiskCount: recentResults.filter((r) => r.engagement_risk).length,
      lastAnalyzedAt: summary?.lastAnalyzedAt || null,
    };
  }, [recentResults, summary]);

  // Owners from recent results
  const recentOwners = useMemo(() => {
    return Array.from(
      new Map(
        recentResults
          .filter((r) => r.owner_id && r.owner_name)
          .map((r) => [r.owner_id, { id: r.owner_id!, name: r.owner_name }])
      ).values()
    );
  }, [recentResults]);

  // Filter and sort
  const filteredResults = useMemo(() => {
    let filtered = recentResults;

    if (selectedOwnerId) {
      filtered = filtered.filter((r) => r.owner_id === selectedOwnerId);
    }
    if (riskOnly) {
      filtered = filtered.filter((r) => r.risk_flag || r.engagement_risk);
    }
    if (selectedVerdict) {
      filtered = filtered.filter((r) => r.verdict === selectedVerdict);
    }

    // Sort
    const sorted = [...filtered];
    switch (sortKey) {
      case 'verdict':
        sorted.sort((a, b) => (VERDICT_ORDER[a.verdict] ?? 99) - (VERDICT_ORDER[b.verdict] ?? 99));
        break;
      case 'age':
        sorted.sort((a, b) => (b.deal_age_days || 0) - (a.deal_age_days || 0));
        break;
      case 'amount':
        sorted.sort((a, b) => (b.amount || 0) - (a.amount || 0));
        break;
      case 'speed': {
        const getSpeed = (r: PplResult) => {
          const m = r.metrics as { speedToLeadMinutes?: number | null };
          return m.speedToLeadMinutes ?? 999999;
        };
        sorted.sort((a, b) => getSpeed(a) - getSpeed(b));
        break;
      }
    }

    return sorted;
  }, [recentResults, selectedOwnerId, riskOnly, selectedVerdict, sortKey]);

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-48" />
          <div className="h-4 bg-gray-200 rounded w-96" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-64 bg-gray-200 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">PPL Lead Effectiveness</h1>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-sm text-gray-500">
              3-2-1 cadence compliance for Paid Per Lead deals (last {MAX_AGE_DAYS} days)
            </p>
            <button
              onClick={() => setShowHowItWorks(!showHowItWorks)}
              className="text-xs text-indigo-600 hover:text-indigo-800 font-medium transition-colors"
            >
              {showHowItWorks ? 'Hide' : 'How it works'}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {recentSummary?.lastAnalyzedAt && (
            <span className="text-xs text-gray-400">
              Analyzed {formatRelativeTime(recentSummary.lastAnalyzedAt)}
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

      {/* How It Works */}
      {showHowItWorks && <HowItWorks onClose={() => setShowHowItWorks(false)} />}

      {/* Summary Stats */}
      {recentSummary && (
        <div className="flex flex-wrap gap-2 mb-6">
          <StatPill label="Deals" value={recentSummary.totalDeals} color="gray" />
          <StatPill label="Exemplary" value={recentSummary.byVerdict['EXEMPLARY'] || 0} color="green" />
          <StatPill label="Compliant" value={recentSummary.byVerdict['COMPLIANT'] || 0} color="emerald" />
          <StatPill label="Needs Improvement" value={recentSummary.byVerdict['NEEDS_IMPROVEMENT'] || 0} color="orange" />
          <StatPill label="Non-Compliant" value={recentSummary.byVerdict['NON_COMPLIANT'] || 0} color="red" />
          {recentSummary.engagementRiskCount > 0 && (
            <StatPill label="Engagement Risk" value={recentSummary.engagementRiskCount} color="red" />
          )}
        </div>
      )}


      {/* AE Filter Pills */}
      {recentOwners.length > 1 && (
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
          {recentOwners.map((owner) => (
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

      {/* AE Scoreboard (when All selected) */}
      {!selectedOwnerId && recentOwners.length > 1 && (
        <PplAeScoreboard
          results={recentResults}
          owners={recentOwners}
          onSelectOwner={(id) => setSelectedOwnerId(id)}
        />
      )}

      {/* Sort & Filter Toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 font-medium">Sort:</span>
          {([
            ['verdict', 'Verdict'],
            ['age', 'Deal Age'],
            ['amount', 'Amount'],
            ['speed', 'Speed to Lead'],
          ] as [SortKey, string][]).map(([key, label]) => (
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
            onClick={() => setSelectedVerdict(null)}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
              !selectedVerdict ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            All
          </button>
          {(['NON_COMPLIANT', 'NEEDS_IMPROVEMENT', 'COMPLIANT', 'EXEMPLARY'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setSelectedVerdict(selectedVerdict === v ? null : v)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                selectedVerdict === v ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {v.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).replace(/Non Compliant/, 'Non-Compliant')}
            </button>
          ))}
        </div>

        <div className="h-4 w-px bg-gray-200" />

        <button
          onClick={() => setRiskOnly(!riskOnly)}
          className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
            riskOnly ? 'bg-orange-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          Risk Flags Only
        </button>
      </div>

      {/* Deal Grid */}
      {filteredResults.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <svg className="w-12 h-12 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
          </svg>
          <p className="text-sm font-medium">No PPL results found</p>
          <p className="text-xs mt-1">Click Refresh to run a new analysis</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filteredResults.map((result) => (
            <PplDealCard
              key={result.id}
              result={result}
              onClick={() => setSelectedDeal(result)}
            />
          ))}
        </div>
      )}

      {/* Slide-over detail panel */}
      {selectedDeal && (
        <PplDealPanel
          result={selectedDeal}
          onClose={() => setSelectedDeal(null)}
          onReanalyze={handleRefresh}
        />
      )}
    </div>
  );
}

function HowItWorks({ onClose }: { onClose: () => void }) {
  return (
    <div className="mb-6 bg-white border border-gray-200 rounded-xl p-6">
      <div className="flex items-start justify-between mb-4">
        <h2 className="text-base font-bold text-gray-900">How This Dashboard Works</h2>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <p className="text-sm text-gray-600 mb-4">
        Each Paid Per Lead deal is evaluated against the <strong>3-2-1 Method</strong> — the standard cadence
        for working PPL leads. Data is pulled live from HubSpot (calls, emails, meetings) and analyzed
        by AI to assess both the numbers and the quality of outreach.
      </p>

      <div className="mb-4 p-3 bg-gray-50 rounded-lg">
        <h3 className="text-sm font-semibold text-gray-800 mb-1.5">Which deals appear here?</h3>
        <p className="text-sm text-gray-600">
          Deals that match <strong>all</strong> of the following: pipeline is <strong>Sales Pipeline</strong>,
          lead source is <strong>Paid Lead</strong>, deal stage is <strong>open</strong> (not closed-won or closed-lost),
          and created within the <strong>last {MAX_AGE_DAYS} days</strong>. New deals are automatically
          analyzed within an hour of creation. All deals are re-analyzed daily on weekdays
          as engagement data changes.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
        <div>
          <h3 className="font-semibold text-gray-800 mb-2">The 5 Compliance Bars</h3>
          <ul className="space-y-2 text-gray-600">
            <li><strong className="text-gray-800">Speed to Lead</strong> — Time from deal creation to first call. Target: under 5 minutes.</li>
            <li><strong className="text-gray-800">3-Day Calls</strong> — Number of calls made in the first 3 business days. Target: 6 calls.</li>
            <li><strong className="text-gray-800">5-Day Touches</strong> — Total outreach attempts (calls + emails) in first 5 business days. Target: 6-7 touches.</li>
            <li><strong className="text-gray-800">Nurture</strong> — After week 1, are they maintaining 1-2 touches per week? Shows &ldquo;Too Early&rdquo; if the deal is less than 7 days old.</li>
            <li><strong className="text-gray-800">Channels</strong> — Number of distinct outreach channels used (Phone, Email, LinkedIn, Text, Meeting). Target: 3+.</li>
          </ul>
        </div>

        <div>
          <h3 className="font-semibold text-gray-800 mb-2">Verdicts</h3>
          <ul className="space-y-2 text-gray-600">
            <li><span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500 mr-1.5" /><strong className="text-gray-800">Exemplary</strong> — Exceeded the 3-2-1 method across all dimensions.</li>
            <li><span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500 mr-1.5" /><strong className="text-gray-800">Compliant</strong> — Met the spirit of the 3-2-1 method.</li>
            <li><span className="inline-block w-2.5 h-2.5 rounded-full bg-orange-400 mr-1.5" /><strong className="text-gray-800">Needs Improvement</strong> — Visible effort but significant gaps.</li>
            <li><span className="inline-block w-2.5 h-2.5 rounded-full bg-red-400 mr-1.5" /><strong className="text-gray-800">Non-Compliant</strong> — Did not follow the 3-2-1 method.</li>
          </ul>

          <h3 className="font-semibold text-gray-800 mt-4 mb-2">Key Signals</h3>
          <ul className="space-y-2 text-gray-600">
            <li><strong className="text-orange-700">Engagement Risk</strong> — Prospect is opening emails but the rep stopped reaching out. Highest-priority coaching moment.</li>
            <li><strong className="text-gray-800">Meeting Booked</strong> — If a meeting is booked in week 1, the deal is automatically Compliant or better regardless of raw numbers.</li>
            <li><strong className="text-gray-800">Activity Sparkline</strong> — Green dots are calls, blue dots are emails, plotted over the deal&apos;s lifetime. Dashed lines mark the day 3 and day 5 windows.</li>
            <li><strong className="text-gray-800">Late-Day Deals</strong> — Deals created after 5pm EST start their business day count the next business day. Friday after 5pm or weekends start on Monday. Reps are not penalized for after-hours lead creation.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function StatPill({ label, value, color }: { label: string; value: number; color: string }) {
  const colorMap: Record<string, string> = {
    gray: 'bg-gray-100 text-gray-700',
    green: 'bg-green-100 text-green-700',
    emerald: 'bg-emerald-100 text-emerald-700',
    orange: 'bg-orange-100 text-orange-700',
    red: 'bg-red-100 text-red-700',
  };

  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 text-sm font-medium rounded-full ${colorMap[color] || colorMap.gray}`}>
      <span className="font-bold">{value}</span>
      <span className="text-xs opacity-75">{label}</span>
    </span>
  );
}
