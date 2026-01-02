'use client';

import { useEffect, useState } from 'react';
import { formatCurrency } from '@/lib/utils/currency';

interface TargetProgressProps {
  ownerId: string;
}

interface TargetData {
  quarter: {
    year: number;
    quarter: number;
    label: string;
  };
  target: {
    amount: number;
    closedAmount: number;
    percentComplete: number;
    onTrack: boolean;
  };
}

function CheckIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
      />
    </svg>
  );
}

export function TargetProgress({ ownerId }: TargetProgressProps) {
  const [data, setData] = useState<TargetData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        const response = await fetch(`/api/ae/${ownerId}/weekly-pipeline`);
        if (!response.ok) {
          throw new Error('Failed to fetch target data');
        }
        const result = await response.json();
        setData({
          quarter: result.quarter,
          target: result.target,
        });
      } catch {
        // Silently fail - the component just won't show
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [ownerId]);

  if (loading) {
    return (
      <div className="animate-pulse">
        <div className="h-16 bg-gray-100 rounded-lg" />
      </div>
    );
  }

  if (!data) {
    return null;
  }

  const { target, quarter } = data;
  const remaining = target.amount - target.closedAmount;
  const percentComplete = Math.min(100, target.percentComplete);

  return (
    <div
      className={`rounded-xl border p-5 ${
        target.onTrack
          ? 'bg-emerald-50 border-emerald-200'
          : 'bg-amber-50 border-amber-200'
      }`}
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span
              className={`flex items-center gap-1 text-sm font-medium ${
                target.onTrack ? 'text-emerald-700' : 'text-amber-700'
              }`}
            >
              {target.onTrack ? <CheckIcon /> : <AlertIcon />}
              {target.onTrack ? 'On Track' : 'Needs Attention'}
            </span>
            <span className="text-gray-400">|</span>
            <span className="text-sm text-gray-500">{quarter.label} Target</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-gray-900">
              {formatCurrency(target.closedAmount)}
            </span>
            <span className="text-gray-500">of {formatCurrency(target.amount)}</span>
          </div>
        </div>

        <div className="text-right">
          <div
            className={`text-3xl font-bold ${
              target.onTrack ? 'text-emerald-600' : 'text-amber-600'
            }`}
          >
            {percentComplete.toFixed(1)}%
          </div>
          <div className="text-sm text-gray-500">
            {remaining > 0 ? `${formatCurrency(remaining)} to go` : 'Target met!'}
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-4 h-3 bg-gray-200 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${
            target.onTrack ? 'bg-emerald-500' : 'bg-amber-500'
          }`}
          style={{ width: `${percentComplete}%` }}
        />
      </div>
    </div>
  );
}
