'use client';

import { AE_LIKELIHOOD_OPTIONS } from '@/lib/deal-review/config';

const TIER_COLORS: Record<string, { active: string; inactive: string }> = {
  commit: {
    active: 'bg-emerald-600 text-white ring-emerald-600',
    inactive: 'bg-white text-emerald-700 ring-emerald-300 hover:bg-emerald-50',
  },
  strong: {
    active: 'bg-blue-600 text-white ring-blue-600',
    inactive: 'bg-white text-blue-700 ring-blue-300 hover:bg-blue-50',
  },
  possible: {
    active: 'bg-amber-500 text-white ring-amber-500',
    inactive: 'bg-white text-amber-700 ring-amber-300 hover:bg-amber-50',
  },
  unlikely: {
    active: 'bg-orange-500 text-white ring-orange-500',
    inactive: 'bg-white text-orange-700 ring-orange-300 hover:bg-orange-50',
  },
  not_this_quarter: {
    active: 'bg-gray-600 text-white ring-gray-600',
    inactive: 'bg-white text-gray-600 ring-gray-300 hover:bg-gray-50',
  },
};

interface LikelihoodSelectorProps {
  /** The currently active AE value (mapped from internal tier) */
  selectedValue: string | null;
  /** Whether this is an AE override (true) or AI default (false) */
  isOverride: boolean;
  onSelect: (aeValue: string) => void;
  onReset?: () => void;
  disabled?: boolean;
}

export function LikelihoodSelector({
  selectedValue,
  isOverride,
  onSelect,
  onReset,
  disabled,
}: LikelihoodSelectorProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
          Your Call
        </span>
        {isOverride && (
          <span className="text-[10px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-medium">
            Override
          </span>
        )}
        {!isOverride && selectedValue && (
          <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
            AI Default
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {AE_LIKELIHOOD_OPTIONS.map((opt) => {
          const isSelected = selectedValue === opt.value;
          const colors = TIER_COLORS[opt.value];
          return (
            <button
              key={opt.value}
              onClick={() => onSelect(opt.value)}
              disabled={disabled}
              title={opt.description}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg ring-1 ring-inset transition-all ${
                isSelected ? colors.active : colors.inactive
              } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      {isOverride && onReset && (
        <button
          onClick={onReset}
          disabled={disabled}
          className="text-xs text-gray-500 hover:text-gray-700 underline underline-offset-2"
        >
          Reset to AI assessment
        </button>
      )}
    </div>
  );
}
