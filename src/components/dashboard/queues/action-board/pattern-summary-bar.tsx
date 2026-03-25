'use client';

import { useState } from 'react';
import type { PatternRecord } from '@/lib/ai/intelligence/alert-utils';

interface Props {
  patterns: PatternRecord[];
}

export function PatternSummaryBar({ patterns }: Props) {
  const [expanded, setExpanded] = useState(false);

  if (!patterns || patterns.length === 0) return null;

  const totalAffected = new Set(patterns.flatMap((p) => p.affectedTicketIds)).size;

  return (
    <div className="px-6 py-2">
      {/* Collapsed summary bar */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-2.5 rounded-lg bg-amber-950/20 border border-amber-800/50 hover:bg-amber-950/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-600 text-white">
            PATTERN
          </span>
          <span className="text-sm text-amber-300">
            {patterns.length} pattern{patterns.length !== 1 ? 's' : ''} detected across {totalAffected} ticket{totalAffected !== 1 ? 's' : ''}
          </span>
        </div>
        <svg
          className={`w-4 h-4 text-amber-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expanded pattern cards */}
      {expanded && (
        <div className="mt-2 space-y-2">
          {patterns.map((pattern) => (
            <div key={pattern.id} className="bg-amber-950/30 border border-amber-800 rounded-lg px-4 py-3">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-600 text-white">
                      PATTERN
                    </span>
                    <span className="text-xs text-amber-300 font-medium">
                      {pattern.affectedTicketIds.length} tickets affected
                    </span>
                    {pattern.confidence >= 0.8 && (
                      <span className="text-[10px] text-amber-500">High confidence</span>
                    )}
                  </div>
                  <p className="text-sm text-gray-200">{pattern.description}</p>
                  {pattern.recommendedAction && (
                    <p className="text-xs text-amber-400 mt-1">{pattern.recommendedAction}</p>
                  )}
                </div>
                <span className="text-[10px] text-gray-500 whitespace-nowrap ml-4">
                  {new Date(pattern.createdAt).toLocaleDateString()}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
