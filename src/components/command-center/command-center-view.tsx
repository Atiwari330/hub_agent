'use client';

import { useState, useEffect, useCallback } from 'react';
import type { CommandCenterResponse } from '@/lib/command-center/types';
import { HeroSummary } from './hero-summary';
import { PacingSection } from './pacing-section';
import { InitiativeTracker } from './initiative-tracker';
import { WeeklyOperatingTable } from './weekly-operating-table';

export function CommandCenterView() {
  const [data, setData] = useState<CommandCenterResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/command-center');
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const json: CommandCenterResponse = await res.json();
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="space-y-8 p-6">
        <div className="animate-pulse space-y-6">
          <div className="h-24 rounded-lg bg-slate-800/50" />
          <div className="grid grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 rounded-lg bg-slate-800/50" />
            ))}
          </div>
          <div className="h-64 rounded-lg bg-slate-800/50" />
          <div className="h-48 rounded-lg bg-slate-800/50" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-6 text-center">
          <p className="text-sm text-red-400">Failed to load Command Center data</p>
          <p className="mt-1 text-xs text-red-400/70">{error}</p>
          <button
            onClick={fetchData}
            className="mt-4 rounded-md bg-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-600 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const currentWeek = data.goalTracker.progress.currentWeek;

  return (
    <div className="space-y-8 p-6">
      <HeroSummary goalTracker={data.goalTracker} />
      <PacingSection pacing={data.pacing} currentWeek={currentWeek} />
      <InitiativeTracker initiatives={data.initiatives} />
      <WeeklyOperatingTable weeklyRows={data.pacing.weeklyRows} currentWeek={currentWeek} />
      {/* Phase 2 will add: DealIntelligenceTable, AEExecutionSection */}
      {/* Phase 3 will add: ForecastSection, ExecutiveSummary */}
    </div>
  );
}
