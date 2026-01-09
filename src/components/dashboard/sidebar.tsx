'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { formatPercent } from '@/lib/utils/currency';

interface Owner {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
}

interface QueueCounts {
  hygiene: { total: number; escalated: number };
  nextStep: { total: number; overdue: number };
}

interface SidebarProps {
  owners: Owner[];
  lastSync: string | null;
  quarterLabel: string;
  quarterProgress: number;
  queueCounts?: QueueCounts;
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

function DashboardIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
    </svg>
  );
}

function QueueIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    </svg>
  );
}

export function Sidebar({ owners, lastSync, quarterLabel, quarterProgress, queueCounts }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [aeListOpen, setAeListOpen] = useState(true);
  const [queuesOpen, setQueuesOpen] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await fetch('/api/cron/sync-hubspot');
      router.refresh();
    } catch (err) {
      console.error('Sync failed:', err);
    } finally {
      setSyncing(false);
    }
  };

  // Extract current owner ID from pathname
  const currentOwnerId = pathname?.match(/\/dashboard\/ae\/([^/]+)/)?.[1];
  const isOnMissionControl = pathname === '/dashboard';
  const isOnHygieneQueue = pathname === '/dashboard/queues/hygiene';
  const isOnNextStepQueue = pathname === '/dashboard/queues/next-step';

  return (
    <aside className="fixed left-0 top-0 h-screen w-64 bg-slate-900 text-slate-100 flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-slate-700">
        <h1 className="text-lg font-semibold">RevOps Agent</h1>
        <p className="text-xs text-slate-400">EHR Sales Intelligence</p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4">
        {/* Mission Control Link */}
        <div className="mb-2">
          <Link
            href="/dashboard"
            className={`flex items-center gap-3 px-4 py-2.5 text-sm font-medium transition-colors ${
              isOnMissionControl
                ? 'bg-indigo-600 text-white'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            <DashboardIcon />
            <span>Mission Control</span>
          </Link>
        </div>

        <div className="px-4 py-2">
          <div className="border-t border-slate-700"></div>
        </div>

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

        {/* Queues Section */}
        <div className="mt-4">
          <button
            onClick={() => setQueuesOpen(!queuesOpen)}
            className="w-full flex items-center justify-between px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800 transition-colors"
          >
            <span className="flex items-center gap-2">
              <QueueIcon />
              <span>Queues</span>
            </span>
            <ChevronIcon open={queuesOpen} />
          </button>

          {queuesOpen && (
            <ul className="mt-1 space-y-0.5">
              <li>
                <Link
                  href="/dashboard/queues/hygiene"
                  className={`flex items-center justify-between px-4 py-2 pl-11 text-sm transition-colors ${
                    isOnHygieneQueue
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <span>Deal Hygiene</span>
                  {queueCounts && queueCounts.hygiene.total > 0 && (
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                        queueCounts.hygiene.escalated > 0
                          ? 'bg-red-500 text-white'
                          : 'bg-slate-600 text-slate-200'
                      }`}
                    >
                      {queueCounts.hygiene.total}
                    </span>
                  )}
                </Link>
              </li>
              <li>
                <Link
                  href="/dashboard/queues/next-step"
                  className={`flex items-center justify-between px-4 py-2 pl-11 text-sm transition-colors ${
                    isOnNextStepQueue
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <span>Next Steps</span>
                  {queueCounts && queueCounts.nextStep.total > 0 && (
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                        queueCounts.nextStep.overdue > 0
                          ? 'bg-red-500 text-white'
                          : 'bg-slate-600 text-slate-200'
                      }`}
                    >
                      {queueCounts.nextStep.total}
                    </span>
                  )}
                </Link>
              </li>
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
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500">
            {syncing ? 'Syncing...' : `Last sync: ${formatRelativeTime(lastSync)}`}
          </span>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-700 rounded transition-colors disabled:opacity-50"
            title="Sync with HubSpot"
          >
            <svg
              className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>
        </div>
      </div>
    </aside>
  );
}
