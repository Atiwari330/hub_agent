'use client';

import { useState, useEffect, useCallback } from 'react';
import type { CommandCenterResponse, DealForecastItem, AEExecutionSummary } from '@/lib/command-center/types';
import { HeroSummary } from './hero-summary';
import { PacingSection } from './pacing-section';
import { InitiativeTracker } from './initiative-tracker';
import { WeeklyOperatingTable } from './weekly-operating-table';
import { DealIntelligenceTable } from './deal-intelligence-table';
import { DealDetailPanel } from './deal-detail-panel';
import { AEExecutionSection } from './ae-execution-section';

interface DealsResponse {
  deals: DealForecastItem[];
  counts: {
    total: number;
    byGrade: Record<string, number>;
    byLikelihood: Record<string, number>;
    withOverrides: number;
  };
}

interface AEResponse {
  aeExecutions: AEExecutionSummary[];
}

export function CommandCenterView() {
  const [data, setData] = useState<CommandCenterResponse | null>(null);
  const [deals, setDeals] = useState<DealForecastItem[]>([]);
  const [aeExecutions, setAeExecutions] = useState<AEExecutionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDeal, setSelectedDeal] = useState<string | null>(null);
  const [aeFilter, setAeFilter] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [mainRes, dealsRes, aeRes] = await Promise.all([
        fetch('/api/command-center'),
        fetch('/api/command-center/deals'),
        fetch('/api/command-center/ae-execution'),
      ]);

      if (!mainRes.ok) throw new Error(`Main API error: ${mainRes.status}`);
      const mainJson: CommandCenterResponse = await mainRes.json();
      setData(mainJson);

      if (dealsRes.ok) {
        const dealsJson: DealsResponse = await dealsRes.json();
        setDeals(dealsJson.deals);
      }

      if (aeRes.ok) {
        const aeJson: AEResponse = await aeRes.json();
        setAeExecutions(aeJson.aeExecutions);
      }
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
          <div className="h-16 rounded-lg bg-gray-200" />
          <div className="grid grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 rounded-lg bg-gray-200" />
            ))}
          </div>
          <div className="h-64 rounded-lg bg-gray-200" />
          <div className="h-48 rounded-lg bg-gray-200" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-sm text-red-700">Failed to load Command Center data</p>
          <p className="mt-1 text-xs text-red-500">{error}</p>
          <button
            onClick={fetchData}
            className="mt-4 rounded-md bg-gray-100 px-4 py-2 text-sm text-gray-700 hover:bg-gray-200 transition-colors"
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
      <AEExecutionSection
        aeExecutions={aeExecutions}
        onSelectAE={setAeFilter}
        activeAEFilter={aeFilter}
      />
      <DealIntelligenceTable
        deals={deals}
        onSelectDeal={setSelectedDeal}
        aeFilter={aeFilter}
        onClearAeFilter={() => setAeFilter(null)}
      />
      {selectedDeal && (
        <DealDetailPanel
          dealId={selectedDeal}
          onClose={() => setSelectedDeal(null)}
        />
      )}
      {/* Phase 3 will add: ForecastSection, ExecutiveSummary */}
    </div>
  );
}
