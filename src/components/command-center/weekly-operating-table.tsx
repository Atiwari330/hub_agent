'use client';

import { Fragment, useState } from 'react';
import type { WeeklyPacingRow, WeeklyDealRef } from '@/lib/command-center/types';

function fmt(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n.toLocaleString()}`;
}

function formatDateRange(start: string, end: string): string {
  const s = new Date(start + 'T12:00:00');
  const e = new Date(end + 'T12:00:00');
  return `${s.getMonth() + 1}/${s.getDate()} – ${e.getMonth() + 1}/${e.getDate()}`;
}

interface DrillDownState {
  weekNumber: number;
  column: string;
  deals: WeeklyDealRef[];
}

function DrillDownPopover({ state, onClose }: { state: DrillDownState; onClose: () => void }) {
  if (state.deals.length === 0) return null;

  return (
    <tr>
      <td colSpan={7} className="p-0">
        <div className="bg-indigo-50 border-y border-indigo-100 px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-indigo-800 uppercase tracking-wider">
              W{state.weekNumber} &middot; {state.column} ({state.deals.length})
            </span>
            <button onClick={onClose} className="text-xs text-gray-500 hover:text-gray-700">&times; Close</button>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-400 uppercase tracking-wider">
                <th className="pb-1 pr-3">Deal</th>
                <th className="pb-1 pr-3">Owner</th>
                <th className="pb-1 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {state.deals.map((d) => (
                <tr key={d.hubspotDealId} className="border-t border-indigo-100">
                  <td className="py-1 pr-3 text-gray-800">{d.dealName}</td>
                  <td className="py-1 pr-3 text-gray-600">{d.ownerName}</td>
                  <td className="py-1 text-right font-mono text-gray-700">{fmt(d.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </td>
    </tr>
  );
}

interface WeeklyOperatingTableProps {
  weeklyRows: WeeklyPacingRow[];
}

export function WeeklyOperatingTable({ weeklyRows }: WeeklyOperatingTableProps) {
  const [drillDown, setDrillDown] = useState<DrillDownState | null>(null);
  // Anything after the current week is future; before is past. If there's no
  // current week (e.g. viewing a completed quarter), treat everything as past.
  const currentIdx = weeklyRows.findIndex((r) => r.isCurrent);

  function handleClick(weekNumber: number, column: string, deals: WeeklyDealRef[], count: number) {
    if (count === 0) return;
    if (drillDown?.weekNumber === weekNumber && drillDown?.column === column) {
      setDrillDown(null);
      return;
    }
    setDrillDown({ weekNumber, column, deals });
  }

  const cellButton = (count: number | string, weekNumber: number, column: string, deals: WeeklyDealRef[], isFuture: boolean) => {
    if (isFuture) return <span>–</span>;
    const num = typeof count === 'number' ? count : 0;
    const isActive = drillDown?.weekNumber === weekNumber && drillDown?.column === column;
    if (num === 0) return <span>{typeof count === 'string' ? count : '0'}</span>;
    return (
      <button
        onClick={() => handleClick(weekNumber, column, deals, num)}
        className={`font-mono hover:underline cursor-pointer ${isActive ? 'text-indigo-700 font-semibold' : ''}`}
      >
        {typeof count === 'string' ? count : count}
      </button>
    );
  };

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-gray-900">Weekly Operating View</h2>
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wider text-gray-500">
              <th className="px-4 py-3">Week</th>
              <th className="px-4 py-3">Dates</th>
              <th className="px-4 py-3 text-right">Deals Created</th>
              <th className="px-4 py-3 text-right">Demos Scheduled</th>
              <th className="px-4 py-3 text-right">Demos Completed</th>
              <th className="px-4 py-3 text-right">Closed Won</th>
              <th className="px-4 py-3 text-right">Closed Won ARR</th>
            </tr>
          </thead>
          <tbody>
            {weeklyRows.map((row, idx) => {
              const isCurrent = row.isCurrent;
              const isFuture = currentIdx >= 0 && idx > currentIdx;
              const isPast = currentIdx >= 0 && idx < currentIdx;
              const isEmpty = isPast && row.leadsCreated === 0 && row.demosScheduled === 0 && row.dealsToDemo === 0 && row.closedWonCount === 0;

              let rowClass = 'border-b border-gray-100';
              if (isCurrent) rowClass += ' bg-indigo-50';
              else if (isFuture) rowClass += ' text-gray-300';
              else if (isEmpty) rowClass += ' bg-amber-50/50';

              const showDrill = drillDown?.weekNumber === row.weekNumber;

              return (
                <Fragment key={row.weekNumber}>
                  <tr className={rowClass}>
                    <td className="px-4 py-2.5 font-medium text-gray-900">
                      W{row.weekNumber}
                      {isCurrent && (
                        <span className="ml-2 inline-block rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-indigo-700">
                          Current
                        </span>
                      )}
                      {row.isPartial && (
                        <span className="ml-2 inline-block rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-gray-500">
                          Partial
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500">{formatDateRange(row.weekStart, row.weekEnd)}</td>
                    <td className="px-4 py-2.5 text-right text-gray-900">
                      {cellButton(row.leadsCreated, row.weekNumber, 'Deals Created', row.leadsCreatedDeals || [], isFuture)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-900">
                      {cellButton(row.demosScheduled, row.weekNumber, 'Demos Scheduled', row.demosScheduledDeals || [], isFuture)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-900">
                      {cellButton(row.dealsToDemo, row.weekNumber, 'Demos Completed', row.demoCompletedDeals || [], isFuture)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-900">
                      {cellButton(row.closedWonCount, row.weekNumber, 'Closed Won', row.closedWonDeals || [], isFuture)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-gray-900">
                      {isFuture ? '–' : fmt(row.closedWonARR)}
                    </td>
                  </tr>
                  {showDrill && drillDown && (
                    <DrillDownPopover
                      key={`drill-${row.weekNumber}`}
                      state={drillDown}
                      onClose={() => setDrillDown(null)}
                    />
                  )}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="font-medium text-gray-900">
              <td className="px-4 pt-3 pb-4" colSpan={2}>Total</td>
              <td className="px-4 pt-3 pb-4 text-right font-mono">
                {weeklyRows.reduce((s, r) => s + r.leadsCreated, 0)}
              </td>
              <td className="px-4 pt-3 pb-4 text-right font-mono">
                {weeklyRows.reduce((s, r) => s + r.demosScheduled, 0)}
              </td>
              <td className="px-4 pt-3 pb-4 text-right font-mono">
                {weeklyRows.reduce((s, r) => s + r.dealsToDemo, 0)}
              </td>
              <td className="px-4 pt-3 pb-4 text-right font-mono">
                {weeklyRows.reduce((s, r) => s + r.closedWonCount, 0)}
              </td>
              <td className="px-4 pt-3 pb-4 text-right font-mono">
                {fmt(weeklyRows.reduce((s, r) => s + r.closedWonARR, 0))}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
