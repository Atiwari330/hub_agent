'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { formatPercent } from '@/lib/utils/currency';

interface Owner {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
}

interface SidebarProps {
  owners: Owner[];
  lastSync: string | null;
  quarterLabel: string;
  quarterProgress: number;
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-4 h-4 transition-transform ${open ? 'rotate-90' : ''}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  );
}

function formatRelativeTime(dateString: string | null): string {
  if (!dateString) return 'Never';

  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

function getOwnerDisplayName(owner: Owner): string {
  if (owner.first_name || owner.last_name) {
    return [owner.first_name, owner.last_name].filter(Boolean).join(' ');
  }
  return owner.email.split('@')[0];
}

function getOwnerInitials(owner: Owner): string {
  if (owner.first_name && owner.last_name) {
    return `${owner.first_name[0]}${owner.last_name[0]}`.toUpperCase();
  }
  if (owner.first_name) {
    return owner.first_name.slice(0, 2).toUpperCase();
  }
  return owner.email.slice(0, 2).toUpperCase();
}

export function Sidebar({ owners, lastSync, quarterLabel, quarterProgress }: SidebarProps) {
  const pathname = usePathname();
  const [aeListOpen, setAeListOpen] = useState(true);

  // Extract current owner ID from pathname
  const currentOwnerId = pathname?.match(/\/dashboard\/ae\/([^/]+)/)?.[1];

  return (
    <aside className="fixed left-0 top-0 h-screen w-64 bg-slate-900 text-slate-100 flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-slate-700">
        <h1 className="text-lg font-semibold">RevOps Agent</h1>
        <p className="text-xs text-slate-400">EHR Sales Intelligence</p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4">
        {/* Account Executives Section */}
        <div>
          <button
            onClick={() => setAeListOpen(!aeListOpen)}
            className="w-full flex items-center justify-between px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800 transition-colors"
          >
            <span>Account Executives</span>
            <ChevronIcon open={aeListOpen} />
          </button>

          {aeListOpen && (
            <ul className="mt-1 space-y-0.5">
              {owners.map((owner) => {
                const isActive = currentOwnerId === owner.id;
                const displayName = getOwnerDisplayName(owner);
                const initials = getOwnerInitials(owner);

                return (
                  <li key={owner.id}>
                    <Link
                      href={`/dashboard/ae/${owner.id}`}
                      className={`flex items-center gap-3 px-4 py-2 text-sm transition-colors ${
                        isActive
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      <span
                        className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium ${
                          isActive
                            ? 'bg-indigo-500 text-white'
                            : 'bg-slate-700 text-slate-300'
                        }`}
                      >
                        {initials}
                      </span>
                      <span className="truncate">{displayName}</span>
                    </Link>
                  </li>
                );
              })}

              {owners.length === 0 && (
                <li className="px-4 py-2 text-sm text-slate-500 italic">
                  No account executives found
                </li>
              )}
            </ul>
          )}
        </div>

        {/* Leads Section (placeholder for future) */}
        <div className="mt-4">
          <Link
            href="/dashboard/leads"
            className="flex items-center px-4 py-2 text-sm text-slate-400 hover:bg-slate-800 hover:text-slate-300 transition-colors"
          >
            <span>Leads</span>
            <span className="ml-auto text-xs bg-slate-700 px-2 py-0.5 rounded">Soon</span>
          </Link>
        </div>
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-slate-700 space-y-3">
        {/* Quarter Progress */}
        <div>
          <div className="flex justify-between text-xs text-slate-400 mb-1">
            <span>{quarterLabel}</span>
            <span>{formatPercent(quarterProgress)}</span>
          </div>
          <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-500 rounded-full transition-all"
              style={{ width: `${Math.min(100, quarterProgress)}%` }}
            />
          </div>
        </div>

        {/* Last Sync */}
        <div className="text-xs text-slate-500">
          Last sync: {formatRelativeTime(lastSync)}
        </div>
      </div>
    </aside>
  );
}
