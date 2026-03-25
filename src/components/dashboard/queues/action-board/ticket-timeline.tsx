'use client';

import { useState, useCallback } from 'react';
import type { NarrativeEntry } from '@/lib/ai/memory/narrative-generator';

function temperatureRank(temp: string): number {
  const ranks: Record<string, number> = { calm: 0, frustrated: 1, escalating: 2, angry: 3 };
  return ranks[temp] ?? 0;
}

export function TicketTimeline({ ticketId }: { ticketId: string }) {
  const [timeline, setTimeline] = useState<NarrativeEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const fetchTimeline = useCallback(async () => {
    if (timeline) return; // Already loaded
    setLoading(true);
    try {
      const res = await fetch(`/api/queues/support-action-board/timeline/${ticketId}`);
      if (res.ok) {
        const data = await res.json();
        setTimeline(data.timeline || []);
      }
    } catch (err) {
      console.error('Failed to fetch timeline:', err);
    } finally {
      setLoading(false);
    }
  }, [ticketId, timeline]);

  const handleToggle = () => {
    if (!expanded) {
      fetchTimeline();
    }
    setExpanded(!expanded);
  };

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <button
        onClick={handleToggle}
        className="w-full flex items-center justify-between text-xs font-semibold text-gray-400 uppercase tracking-wider"
      >
        <span>Ticket Timeline</span>
        <svg
          className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="mt-3">
          {loading && <p className="text-xs text-gray-500">Loading timeline...</p>}
          {timeline && timeline.length === 0 && (
            <p className="text-xs text-gray-500">No timeline data yet. Run an analysis to start building history.</p>
          )}
          {timeline && timeline.length > 0 && (
            <div className="relative">
              {/* Vertical line */}
              <div className="absolute left-2 top-2 bottom-2 w-px bg-slate-700" />

              <div className="space-y-4">
                {timeline.map((entry, idx) => {
                  const isImprovement = entry.temperatureChange &&
                    temperatureRank(entry.temperatureChange.to) < temperatureRank(entry.temperatureChange.from);
                  const isDegradation = entry.temperatureChange &&
                    temperatureRank(entry.temperatureChange.to) > temperatureRank(entry.temperatureChange.from);

                  return (
                    <div key={idx} className="relative pl-6">
                      {/* Dot */}
                      <div className={`absolute left-0.5 top-1.5 w-3 h-3 rounded-full border-2 ${
                        isDegradation ? 'border-red-500 bg-red-900' :
                        isImprovement ? 'border-emerald-500 bg-emerald-900' :
                        'border-slate-500 bg-slate-800'
                      }`} />

                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] text-gray-500">
                            {new Date(entry.timestamp).toLocaleString([], {
                              month: 'short', day: 'numeric',
                              hour: '2-digit', minute: '2-digit',
                            })}
                          </span>
                          {entry.triggerEvent && (
                            <span className="text-[10px] text-gray-600">
                              {entry.triggerEvent}
                            </span>
                          )}
                        </div>

                        {entry.temperatureChange && (
                          <div className={`text-xs mb-1 ${isDegradation ? 'text-red-400' : 'text-emerald-400'}`}>
                            Temperature: {entry.temperatureChange.from} → {entry.temperatureChange.to}
                          </div>
                        )}

                        {entry.changes.map((change, ci) => (
                          <p key={ci} className="text-xs text-gray-400">{change}</p>
                        ))}

                        {entry.situationDelta && (
                          <p className="text-xs text-gray-300 mt-1 italic border-l-2 border-slate-600 pl-2">
                            {entry.situationDelta.slice(0, 200)}
                            {entry.situationDelta.length > 200 ? '...' : ''}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
