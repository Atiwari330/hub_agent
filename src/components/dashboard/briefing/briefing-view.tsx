'use client';

import { useState, useEffect, useCallback } from 'react';
import { BriefingSummaryBar } from './briefing-summary-bar';
import { DealScrubSection } from './deal-scrub-section';
import { PplCadenceSection } from './ppl-cadence-section';
import { TicketTriageSection } from './ticket-triage-section';

interface BriefingRun {
  id: string;
  run_date: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  sync_status: string;
  sync_completed_at: string | null;
  error: string | null;
}

interface BriefingSection {
  id: string;
  run_id: string;
  section_type: string;
  owner_email: string | null;
  status: string;
  results_json: unknown[] | null;
  results_markdown: string | null;
  summary_json: Record<string, unknown> | null;
  item_count: number | null;
  duration_ms: number | null;
  error: string | null;
}

interface DateEntry {
  run_date: string;
  status: string;
  sync_status: string;
}

type TabType = 'deal_scrub' | 'ppl_cadence' | 'ticket_triage';

const TAB_LABELS: Record<TabType, string> = {
  deal_scrub: 'Deal Scrub',
  ppl_cadence: 'PPL Cadence',
  ticket_triage: 'Ticket Triage',
};

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.round((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  });
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'America/New_York',
  });
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    completed: 'bg-emerald-100 text-emerald-800',
    partial: 'bg-amber-100 text-amber-800',
    failed: 'bg-red-100 text-red-800',
    running: 'bg-blue-100 text-blue-800',
    pending: 'bg-gray-100 text-gray-600',
  };

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 text-xs font-medium rounded-full ${colors[status] || colors.pending}`}>
      {status === 'running' && (
        <span className="mr-1.5 h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
      )}
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

export function BriefingView() {
  const [run, setRun] = useState<BriefingRun | null>(null);
  const [sections, setSections] = useState<BriefingSection[]>([]);
  const [dates, setDates] = useState<DateEntry[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('deal_scrub');
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);

  const fetchBriefing = useCallback(async (date?: string) => {
    try {
      setLoading(true);
      const url = date ? `/api/briefing?date=${date}` : '/api/briefing';
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setRun(data.run);
        setSections(data.sections || []);
      }
    } catch (err) {
      console.error('Failed to fetch briefing:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchDates = useCallback(async () => {
    try {
      const res = await fetch('/api/briefing/dates');
      if (res.ok) {
        const data = await res.json();
        setDates(data.dates || []);
      }
    } catch (err) {
      console.error('Failed to fetch dates:', err);
    }
  }, []);

  useEffect(() => {
    fetchBriefing();
    fetchDates();
  }, [fetchBriefing, fetchDates]);

  const handleDateChange = (date: string) => {
    setSelectedDate(date);
    fetchBriefing(date);
  };

  const handleRegenerate = async () => {
    setTriggering(true);
    try {
      const res = await fetch('/api/briefing/trigger', { method: 'POST' });
      if (res.ok) {
        // Refresh after a moment to show the pending state
        setTimeout(() => {
          fetchBriefing(selectedDate || undefined);
          fetchDates();
        }, 3000);
      }
    } catch (err) {
      console.error('Failed to trigger:', err);
    } finally {
      setTriggering(false);
    }
  };

  // Compute total duration
  const totalDuration = sections
    .filter((s) => s.duration_ms)
    .reduce((sum, s) => sum + (s.duration_ms || 0), 0);

  // Get sections by type
  const dealScrubSections = sections.filter((s) => s.section_type === 'deal_scrub');
  const pplCadenceSection = sections.find((s) => s.section_type === 'ppl_cadence');
  const ticketTriageSection = sections.find((s) => s.section_type === 'ticket_triage');

  const tabs: TabType[] = ['deal_scrub', 'ppl_cadence', 'ticket_triage'];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="h-8 w-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-500">Loading briefing...</p>
        </div>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="max-w-4xl mx-auto py-12">
        <div className="text-center">
          <h2 className="text-2xl font-semibold text-gray-900 mb-2">No Briefings Yet</h2>
          <p className="text-gray-500 mb-6">
            Morning briefings run automatically at 5:00 AM EST on weekdays, or you can trigger one manually.
          </p>
          <button
            onClick={handleRegenerate}
            disabled={triggering}
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {triggering ? 'Triggering...' : 'Generate Briefing Now'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-5 mb-6 -mx-6 -mt-6 rounded-t-xl">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-semibold text-gray-900">Morning Briefing</h1>
            <StatusBadge status={run.status} />
          </div>

          <div className="flex items-center gap-3">
            {/* Date picker */}
            <select
              value={selectedDate || run.run_date}
              onChange={(e) => handleDateChange(e.target.value)}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            >
              {dates.length > 0 ? (
                dates.map((d) => (
                  <option key={d.run_date} value={d.run_date}>
                    {formatDate(d.run_date)} {d.status !== 'completed' ? `(${d.status})` : ''}
                  </option>
                ))
              ) : (
                <option value={run.run_date}>{formatDate(run.run_date)}</option>
              )}
            </select>

            {/* Regenerate button */}
            <button
              onClick={handleRegenerate}
              disabled={triggering}
              className="px-3 py-1.5 text-sm font-medium text-indigo-600 border border-indigo-300 rounded-lg hover:bg-indigo-50 disabled:opacity-50 transition-colors"
            >
              {triggering ? 'Triggering...' : 'Regenerate'}
            </button>
          </div>
        </div>

        {/* Meta info */}
        <div className="mt-3 flex items-center gap-4 text-sm text-gray-500">
          {run.completed_at && (
            <span>Generated at {formatTime(run.completed_at)} ET</span>
          )}
          {totalDuration > 0 && (
            <span>Duration: {formatDuration(totalDuration)}</span>
          )}
          <span className={run.sync_status === 'synced' ? 'text-emerald-600' : 'text-amber-600'}>
            {run.sync_status === 'synced'
              ? `Data synced ${run.sync_completed_at ? formatTime(run.sync_completed_at) : ''} ET`
              : 'Using cached data (sync failed)'}
          </span>
        </div>

        {/* Sync warning banner */}
        {run.sync_status === 'sync_failed_used_cache' && (
          <div className="mt-3 p-2 rounded border bg-amber-50 border-amber-200 text-sm text-amber-800">
            HubSpot sync failed — analysis used cached data from the most recent successful sync. Deal engagement data was still fetched live.
          </div>
        )}
      </div>

      {/* Summary bar */}
      <BriefingSummaryBar
        dealScrubSections={dealScrubSections}
        pplCadenceSection={pplCadenceSection || null}
        ticketTriageSection={ticketTriageSection || null}
      />

      {/* Tab navigation */}
      <div className="border-b border-gray-200 mt-6 mb-6">
        <nav className="flex gap-6">
          {tabs.map((tab) => {
            const isActive = activeTab === tab;
            const sectionStatus = tab === 'deal_scrub'
              ? dealScrubSections.every((s) => s.status === 'completed') ? 'completed' : 'partial'
              : tab === 'ppl_cadence'
                ? pplCadenceSection?.status || 'pending'
                : ticketTriageSection?.status || 'pending';

            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`pb-3 text-sm font-medium transition-colors relative ${
                  isActive
                    ? 'text-indigo-600 border-b-2 border-indigo-600'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {TAB_LABELS[tab]}
                {sectionStatus === 'failed' && (
                  <span className="ml-1.5 inline-block h-2 w-2 rounded-full bg-red-500" />
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab content */}
      <div className="pb-12">
        {activeTab === 'deal_scrub' && (
          <DealScrubSection sections={dealScrubSections} />
        )}
        {activeTab === 'ppl_cadence' && (
          <PplCadenceSection section={pplCadenceSection || null} />
        )}
        {activeTab === 'ticket_triage' && (
          <TicketTriageSection section={ticketTriageSection || null} />
        )}
      </div>
    </div>
  );
}
