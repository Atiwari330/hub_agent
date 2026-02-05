'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { formatPercent } from '@/lib/utils/currency';
import { hasPermission, RESOURCES, type UserWithPermissions } from '@/lib/auth/types';

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
  onCollapsedChange?: (collapsed: boolean) => void;
  user: UserWithPermissions;
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

function CollapseIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      className={`w-5 h-5 transition-transform ${collapsed ? 'rotate-180' : ''}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

const SIDEBAR_COLLAPSED_KEY = 'sidebar-collapsed';

function LogoutIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
    </svg>
  );
}

export function Sidebar({ owners, lastSync, quarterLabel, quarterProgress, onCollapsedChange, user }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [aeListOpen, setAeListOpen] = useState(true);
  const [queuesOpen, setQueuesOpen] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Load collapsed state from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
    if (stored !== null) {
      const collapsed = stored === 'true';
      setIsCollapsed(collapsed);
      onCollapsedChange?.(collapsed);
    }
  }, [onCollapsedChange]);

  const toggleCollapsed = () => {
    const newCollapsed = !isCollapsed;
    setIsCollapsed(newCollapsed);
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(newCollapsed));
    onCollapsedChange?.(newCollapsed);
  };

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
  // Sales Pipeline queues
  const isOnHygieneQueue = pathname === '/dashboard/queues/hygiene';
  const isOnNextStepQueue = pathname === '/dashboard/queues/next-step';
  const isOnOverdueTasksQueue = pathname === '/dashboard/queues/overdue-tasks';
  const isOnStalledDealsQueue = pathname === '/dashboard/queues/stalled-deals';
  const isOnPplSequenceQueue = pathname === '/dashboard/queues/ppl-sequence';
  // Upsell Pipeline queues
  const isOnUpsellHygieneQueue = pathname === '/dashboard/queues/upsell-hygiene';
  const isOnStalledUpsellsQueue = pathname === '/dashboard/queues/stalled-upsells';
  // Customer Success queues
  const isOnAtRiskQueue = pathname === '/dashboard/queues/at-risk';

  return (
    <aside className={`fixed left-0 top-0 h-screen bg-slate-900 text-slate-100 flex flex-col transition-all duration-300 ${isCollapsed ? 'w-16' : 'w-64'}`}>
      {/* Header */}
      <div className={`border-b border-slate-700 flex items-center ${isCollapsed ? 'p-2 justify-center' : 'p-4 justify-between'}`}>
        {!isCollapsed && (
          <div>
            <h1 className="text-lg font-semibold">RevOps Agent</h1>
            <p className="text-xs text-slate-400">EHR Sales Intelligence</p>
          </div>
        )}
        <button
          onClick={toggleCollapsed}
          className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-700 rounded transition-colors"
          title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {isCollapsed ? <MenuIcon /> : <CollapseIcon collapsed={isCollapsed} />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4 scrollbar-thin">
        {/* Mission Control Link - only show if user has dashboard permission */}
        {hasPermission(user, RESOURCES.DASHBOARD) && (
          <>
            <div className="mb-2">
              <Link
                href="/dashboard"
                className={`flex items-center gap-3 py-2.5 text-sm font-medium transition-colors ${isCollapsed ? 'px-0 justify-center' : 'px-4'} ${
                  isOnMissionControl
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
                title={isCollapsed ? 'Mission Control' : undefined}
              >
                <DashboardIcon />
                {!isCollapsed && <span>Mission Control</span>}
              </Link>
            </div>

            {!isCollapsed && (
              <div className="px-4 py-2">
                <div className="border-t border-slate-700"></div>
              </div>
            )}
          </>
        )}

        {/* Account Executives Section - only show if user has ae_detail permission */}
        {hasPermission(user, RESOURCES.AE_DETAIL) && (
        <div>
          {!isCollapsed && (
            <button
              onClick={() => setAeListOpen(!aeListOpen)}
              className="w-full flex items-center justify-between px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800 transition-colors"
            >
              <span>Account Executives</span>
              <ChevronIcon open={aeListOpen} />
            </button>
          )}

          {(isCollapsed || aeListOpen) && (
            <ul className={`space-y-0.5 ${!isCollapsed ? 'mt-1' : ''}`}>
              {owners.map((owner) => {
                const isActive = currentOwnerId === owner.id;
                const displayName = getOwnerDisplayName(owner);
                const initials = getOwnerInitials(owner);

                return (
                  <li key={owner.id}>
                    <Link
                      href={`/dashboard/ae/${owner.id}`}
                      className={`flex items-center gap-3 py-2 text-sm transition-colors ${isCollapsed ? 'px-0 justify-center' : 'px-4'} ${
                        isActive
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-300 hover:bg-slate-800'
                      }`}
                      title={isCollapsed ? displayName : undefined}
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
                      {!isCollapsed && <span className="truncate">{displayName}</span>}
                    </Link>
                  </li>
                );
              })}

              {owners.length === 0 && !isCollapsed && (
                <li className="px-4 py-2 text-sm text-slate-500 italic">
                  No account executives found
                </li>
              )}
            </ul>
          )}
        </div>
        )}

        {/* Queues Section - only show if user has permission for at least one queue */}
        {(hasPermission(user, RESOURCES.QUEUE_HYGIENE) ||
          hasPermission(user, RESOURCES.QUEUE_NEXT_STEP) ||
          hasPermission(user, RESOURCES.QUEUE_OVERDUE_TASKS) ||
          hasPermission(user, RESOURCES.QUEUE_STALLED_DEALS) ||
          hasPermission(user, RESOURCES.QUEUE_PPL_SEQUENCE) ||
          hasPermission(user, RESOURCES.QUEUE_UPSELL_HYGIENE) ||
          hasPermission(user, RESOURCES.QUEUE_STALLED_UPSELLS) ||
          hasPermission(user, RESOURCES.QUEUE_AT_RISK)) && (
        <div className="mt-4">
          {!isCollapsed && (
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
          )}

          {(isCollapsed || queuesOpen) && (
            <div className={`${!isCollapsed ? 'mt-1' : ''}`}>
              {/* Sales Pipeline Section - only show if user has permission for any sales queue */}
              {(hasPermission(user, RESOURCES.QUEUE_HYGIENE) ||
                hasPermission(user, RESOURCES.QUEUE_NEXT_STEP) ||
                hasPermission(user, RESOURCES.QUEUE_OVERDUE_TASKS) ||
                hasPermission(user, RESOURCES.QUEUE_STALLED_DEALS) ||
                hasPermission(user, RESOURCES.QUEUE_PPL_SEQUENCE)) && (
              <>
                {!isCollapsed && (
                  <div className="px-4 pl-11 py-1.5">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Sales Pipeline</span>
                  </div>
                )}
                <ul className="space-y-0.5">
                  {hasPermission(user, RESOURCES.QUEUE_HYGIENE) && (
                  <li>
                    <Link
                      href="/dashboard/queues/hygiene"
                      className={`flex items-center py-2 text-sm transition-colors ${
                        isCollapsed
                          ? 'px-0 justify-center'
                          : 'px-4 pl-14'
                      } ${
                        isOnHygieneQueue
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-300 hover:bg-slate-800'
                      }`}
                      title={isCollapsed ? 'Deal Hygiene (Sales)' : undefined}
                    >
                      {isCollapsed ? (
                        <QueueIcon />
                      ) : (
                        <span>Deal Hygiene</span>
                      )}
                    </Link>
                  </li>
                  )}
                  {hasPermission(user, RESOURCES.QUEUE_NEXT_STEP) && (
                  <li>
                    <Link
                      href="/dashboard/queues/next-step"
                      className={`flex items-center py-2 text-sm transition-colors ${
                        isCollapsed
                          ? 'px-0 justify-center'
                          : 'px-4 pl-14'
                      } ${
                        isOnNextStepQueue
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-300 hover:bg-slate-800'
                      }`}
                      title={isCollapsed ? 'Next Steps' : undefined}
                    >
                      {isCollapsed ? (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      ) : (
                        <span>Next Steps</span>
                      )}
                    </Link>
                  </li>
                  )}
                  {hasPermission(user, RESOURCES.QUEUE_OVERDUE_TASKS) && (
                  <li>
                    <Link
                      href="/dashboard/queues/overdue-tasks"
                      className={`flex items-center py-2 text-sm transition-colors ${
                        isCollapsed
                          ? 'px-0 justify-center'
                          : 'px-4 pl-14'
                      } ${
                        isOnOverdueTasksQueue
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-300 hover:bg-slate-800'
                      }`}
                      title={isCollapsed ? 'Overdue Tasks' : undefined}
                    >
                      {isCollapsed ? (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      ) : (
                        <span>Overdue Tasks</span>
                      )}
                    </Link>
                  </li>
                  )}
                  {hasPermission(user, RESOURCES.QUEUE_STALLED_DEALS) && (
                  <li>
                    <Link
                      href="/dashboard/queues/stalled-deals"
                      className={`flex items-center py-2 text-sm transition-colors ${
                        isCollapsed
                          ? 'px-0 justify-center'
                          : 'px-4 pl-14'
                      } ${
                        isOnStalledDealsQueue
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-300 hover:bg-slate-800'
                      }`}
                      title={isCollapsed ? 'Stalled Deals' : undefined}
                    >
                      {isCollapsed ? (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      ) : (
                        <span>Stalled Deals</span>
                      )}
                    </Link>
                  </li>
                  )}
                  {hasPermission(user, RESOURCES.QUEUE_PPL_SEQUENCE) && (
                  <li>
                    <Link
                      href="/dashboard/queues/ppl-sequence"
                      className={`flex items-center py-2 text-sm transition-colors ${
                        isCollapsed
                          ? 'px-0 justify-center'
                          : 'px-4 pl-14'
                      } ${
                        isOnPplSequenceQueue
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-300 hover:bg-slate-800'
                      }`}
                      title={isCollapsed ? 'PPL Sequence' : undefined}
                    >
                      {isCollapsed ? (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                        </svg>
                      ) : (
                        <span>PPL Sequence</span>
                      )}
                    </Link>
                  </li>
                  )}
                </ul>
              </>
              )}

              {/* Upsells Pipeline Section - only show if user has permission for any upsell queue */}
              {(hasPermission(user, RESOURCES.QUEUE_UPSELL_HYGIENE) ||
                hasPermission(user, RESOURCES.QUEUE_STALLED_UPSELLS)) && (
              <>
                {!isCollapsed && (
                  <div className="px-4 pl-11 py-1.5 mt-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Upsells Pipeline</span>
                  </div>
                )}
                <ul className="space-y-0.5">
                  {hasPermission(user, RESOURCES.QUEUE_UPSELL_HYGIENE) && (
                  <li>
                    <Link
                      href="/dashboard/queues/upsell-hygiene"
                      className={`flex items-center py-2 text-sm transition-colors ${
                        isCollapsed
                          ? 'px-0 justify-center'
                          : 'px-4 pl-14'
                      } ${
                        isOnUpsellHygieneQueue
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-300 hover:bg-slate-800'
                      }`}
                      title={isCollapsed ? 'Deal Hygiene (Upsells)' : undefined}
                    >
                      {isCollapsed ? (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                        </svg>
                      ) : (
                        <span>Deal Hygiene</span>
                      )}
                    </Link>
                  </li>
                  )}
                  {hasPermission(user, RESOURCES.QUEUE_STALLED_UPSELLS) && (
                  <li>
                    <Link
                      href="/dashboard/queues/stalled-upsells"
                      className={`flex items-center py-2 text-sm transition-colors ${
                        isCollapsed
                          ? 'px-0 justify-center'
                          : 'px-4 pl-14'
                      } ${
                        isOnStalledUpsellsQueue
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-300 hover:bg-slate-800'
                      }`}
                      title={isCollapsed ? 'Stalled Deals (Upsells)' : undefined}
                    >
                      {isCollapsed ? (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      ) : (
                        <span>Stalled Deals</span>
                      )}
                    </Link>
                  </li>
                  )}
                </ul>
              </>
              )}

              {/* Customer Success Section */}
              {hasPermission(user, RESOURCES.QUEUE_AT_RISK) && (
              <>
                {!isCollapsed && (
                  <div className="px-4 pl-11 py-1.5 mt-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Customer Success</span>
                  </div>
                )}
                <ul className="space-y-0.5">
                  <li>
                    <Link
                      href="/dashboard/queues/at-risk"
                      className={`flex items-center py-2 text-sm transition-colors ${
                        isCollapsed
                          ? 'px-0 justify-center'
                          : 'px-4 pl-14'
                      } ${
                        isOnAtRiskQueue
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-300 hover:bg-slate-800'
                      }`}
                      title={isCollapsed ? 'At-Risk Accounts' : undefined}
                    >
                      {isCollapsed ? (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                      ) : (
                        <span>At-Risk Accounts</span>
                      )}
                    </Link>
                  </li>
                </ul>
              </>
              )}
            </div>
          )}
        </div>
        )}

        {/* Leads Section (placeholder for future) - hide when collapsed, only show for vp_revops */}
        {!isCollapsed && hasPermission(user, RESOURCES.DASHBOARD) && (
          <div className="mt-4">
            <Link
              href="/dashboard/leads"
              className="flex items-center px-4 py-2 text-sm text-slate-400 hover:bg-slate-800 hover:text-slate-300 transition-colors"
            >
              <span>Leads</span>
              <span className="ml-auto text-xs bg-slate-700 px-2 py-0.5 rounded">Soon</span>
            </Link>
          </div>
        )}
      </nav>

      {/* Footer */}
      <div className={`border-t border-slate-700 flex-shrink-0 ${isCollapsed ? 'p-2' : 'p-3'}`}>
        {isCollapsed ? (
          <div className="flex flex-col items-center gap-3">
            {/* Sync button when collapsed - show for all users */}
            <button
              onClick={handleSync}
              disabled={syncing}
              className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-700 rounded transition-colors disabled:opacity-50"
              title={syncing ? 'Syncing...' : `Sync with HubSpot (${formatRelativeTime(lastSync)})`}
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
            {/* Logout button when collapsed */}
            <a
              href="/api/auth/logout"
              className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-700 rounded transition-colors"
              title={`Logout (${user.displayName || user.email})`}
            >
              <LogoutIcon />
            </a>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Quarter Progress & Sync - show for all users */}
            <div className="flex items-center gap-3">
              {/* Quarter info */}
              <div className="flex-1 min-w-0">
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
                <div className="text-xs text-slate-500 mt-1">
                  {syncing ? 'Syncing...' : `Synced ${formatRelativeTime(lastSync)}`}
                </div>
              </div>
              {/* Sync button */}
              <button
                onClick={handleSync}
                disabled={syncing}
                className="flex-shrink-0 p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-700 rounded transition-colors disabled:opacity-50"
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

            {/* User info and logout */}
            <div className="flex items-center gap-3 pt-3 border-t border-slate-700">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center text-xs font-semibold text-white">
                {user.displayName
                  ? user.displayName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
                  : user.email.slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-200 truncate">
                  {user.displayName || user.email.split('@')[0]}
                </p>
              </div>
              <a
                href="/api/auth/logout"
                className="flex-shrink-0 p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-700 rounded transition-colors"
                title="Logout"
              >
                <LogoutIcon />
              </a>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
