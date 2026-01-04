'use client';

import Link from 'next/link';

export type StatusLevel = 'green' | 'amber' | 'red';

export interface AEStatus {
  id: string;
  name: string;
  initials: string;
  status: StatusLevel;
  overdueCount: number;
  staleCount: number;
}

interface AEStatusBarProps {
  aeStatuses: AEStatus[];
}

const STATUS_COLORS: Record<StatusLevel, { bg: string; ring: string; dot: string }> = {
  green: {
    bg: 'bg-emerald-50',
    ring: 'ring-emerald-200',
    dot: 'bg-emerald-500',
  },
  amber: {
    bg: 'bg-amber-50',
    ring: 'ring-amber-200',
    dot: 'bg-amber-500',
  },
  red: {
    bg: 'bg-red-50',
    ring: 'ring-red-200',
    dot: 'bg-red-500',
  },
};

function getStatusLabel(status: StatusLevel): string {
  switch (status) {
    case 'green': return 'On Track';
    case 'amber': return 'Needs Attention';
    case 'red': return 'Critical';
  }
}

export function AEStatusBar({ aeStatuses }: AEStatusBarProps) {
  if (aeStatuses.length === 0) {
    return null;
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <h3 className="text-sm font-medium text-gray-700 mb-3">AE Quick Status</h3>
      <div className="flex flex-wrap gap-3">
        {aeStatuses.map((ae) => {
          const colors = STATUS_COLORS[ae.status];
          return (
            <Link
              key={ae.id}
              href={`/dashboard/ae/${ae.id}`}
              className={`
                flex items-center gap-2 px-3 py-2 rounded-lg ring-1 transition-all
                hover:shadow-md hover:scale-[1.02]
                ${colors.bg} ${colors.ring}
              `}
              title={`${ae.name}: ${ae.overdueCount} overdue, ${ae.staleCount} stale`}
            >
              {/* Avatar with status dot */}
              <div className="relative">
                <span className="flex items-center justify-center w-8 h-8 rounded-full bg-slate-700 text-white text-xs font-medium">
                  {ae.initials}
                </span>
                <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${colors.dot}`} />
              </div>

              {/* Name and status */}
              <div className="flex flex-col">
                <span className="text-sm font-medium text-gray-900">{ae.name.split(' ')[0]}</span>
                <span className="text-xs text-gray-500">{getStatusLabel(ae.status)}</span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
