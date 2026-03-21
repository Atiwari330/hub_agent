'use client';

import React, { useState, useEffect } from 'react';

interface UsageSummary {
  userId: string;
  email: string;
  displayName: string | null;
  count: number;
  totalTokens: number;
  lastAnalysis: string;
}

interface UsageLog {
  id: string;
  user_email: string;
  user_display_name: string | null;
  queue_type: string;
  hubspot_ticket_id: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  created_at: string;
}

export function AdminAnalysisUsage() {
  const [summary, setSummary] = useState<UsageSummary[]>([]);
  const [logs, setLogs] = useState<UsageLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);
  const [showLogs, setShowLogs] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/analysis-usage?days=${days}`)
      .then((r) => r.json())
      .then((data) => {
        setSummary(data.summary || []);
        setLogs(data.logs || []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [days]);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };

  const formatTokens = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toString();
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Analysis Usage</h2>
        <select
          value={days}
          onChange={(e) => setDays(parseInt(e.target.value, 10))}
          className="text-sm border border-gray-300 rounded-lg px-3 py-1.5"
        >
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </div>

      {loading ? (
        <div className="text-sm text-gray-400 py-4">Loading...</div>
      ) : summary.length === 0 ? (
        <div className="text-sm text-gray-400 py-4">No analysis usage in this period.</div>
      ) : (
        <>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 uppercase tracking-wider border-b border-gray-200">
                <th className="pb-2 font-medium">User</th>
                <th className="pb-2 font-medium text-right"># Analyses</th>
                <th className="pb-2 font-medium text-right">Total Tokens</th>
                <th className="pb-2 font-medium text-right">Last Analysis</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((s) => (
                <tr key={s.userId} className="border-b border-gray-100">
                  <td className="py-2.5">
                    <div className="font-medium text-gray-900">{s.displayName || s.email}</div>
                    {s.displayName && <div className="text-xs text-gray-400">{s.email}</div>}
                  </td>
                  <td className="py-2.5 text-right font-medium text-gray-900">{s.count}</td>
                  <td className="py-2.5 text-right text-gray-600">{s.totalTokens > 0 ? formatTokens(s.totalTokens) : '—'}</td>
                  <td className="py-2.5 text-right text-gray-500">{formatDate(s.lastAnalysis)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-4 pt-3 border-t border-gray-100">
            <button
              onClick={() => setShowLogs(!showLogs)}
              className="text-xs text-indigo-600 hover:text-indigo-800"
            >
              {showLogs ? 'Hide' : 'Show'} detailed log ({logs.length} entries)
            </button>

            {showLogs && (
              <div className="mt-3 max-h-64 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-gray-500 uppercase tracking-wider border-b border-gray-200">
                      <th className="pb-1.5 font-medium">Time</th>
                      <th className="pb-1.5 font-medium">User</th>
                      <th className="pb-1.5 font-medium">Queue</th>
                      <th className="pb-1.5 font-medium">Ticket ID</th>
                      <th className="pb-1.5 font-medium text-right">Tokens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log) => (
                      <tr key={log.id} className="border-b border-gray-50">
                        <td className="py-1.5 text-gray-500">{formatDate(log.created_at)}</td>
                        <td className="py-1.5 text-gray-700">{log.user_display_name || log.user_email}</td>
                        <td className="py-1.5 text-gray-600">{log.queue_type}</td>
                        <td className="py-1.5 text-gray-500 font-mono">{log.hubspot_ticket_id}</td>
                        <td className="py-1.5 text-right text-gray-600">
                          {log.total_tokens ? formatTokens(log.total_tokens) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
