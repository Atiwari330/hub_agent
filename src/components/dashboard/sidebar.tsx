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
  isStale?: boolean;
  syncHealth?: 'healthy' | 'degraded' | 'failed' | 'unknown';
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

export function Sidebar({ owners, lastSync, quarterLabel, quarterProgress, onCollapsedChange, user, isStale, syncHealth }: SidebarProps) {
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
      // Sync all data sources in parallel
      await Promise.all([
        fetch('/api/cron/sync-hubspot'),
        fetch('/api/cron/sync-companies'),
        fetch('/api/cron/sync-tickets'),
      ]);
      router.refresh();
    } catch (err) {
      console.error('Sync failed:', err);
    } finally {
      setSyncing(false);
    }
  };

  // Auto-sync on mount if data is stale
  useEffect(() => {
    if (isStale && !syncing) {
      handleSync();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run once on mount

  // Extract current owner ID from pathname
  const currentOwnerId = pathname?.match(/\/dashboard\/ae\/([^/]+)/)?.[1];
  const isOnMissionControl = pathname === '/dashboard';
  // Sales Pipeline queues
  const isOnDealCoachQueue = pathname === '/dashboard/queues/deal-health';
  const isOnPplSequenceQueue = pathname === '/dashboard/queues/ppl-sequence';
  const isOnDomainEnrichmentQueue = pathname === '/dashboard/queues/domain-enrichment';
  const isOnComplianceResearchQueue = pathname === '/dashboard/queues/compliance-research';
  // Upsell Pipeline queues
  const isOnUpsellHygieneQueue = pathname === '/dashboard/queues/upsell-hygiene';
  const isOnStalledUpsellsQueue = pathname === '/dashboard/queues/stalled-upsells';
  // Customer Success queues
  const isOnAtRiskQueue = pathname === '/dashboard/queues/at-risk';
  const isOnCSHygieneQueue = pathname === '/dashboard/queues/cs-hygiene';
  // Support queues
  const isOnSupportPulse = pathname === '/dashboard/queues/support-pulse';
  const isOnFollowUpQueue = pathname === '/dashboard/queues/follow-up-queue';
  const isOnPitchQueue = pathname === '/dashboard/queues/pitch-queue';
  const isOnSupportIntel = pathname === '/dashboard/queues/support-intel';
  const isOnRcmAudit = pathname === '/dashboard/queues/rcm-audit';
  const isOnSupportManager = pathname === '/dashboard/queues/support-manager';
  const isOnSupportTrainer = pathname === '/dashboard/queues/support-trainer';
  const isOnSupportActionBoard = pathname === '/dashboard/queues/support-action-board';
  // Morning Briefing
  const isOnBriefing = pathname === '/dashboard/briefing';
  // Hot Tracker
  const isOnHotTracker = pathname === '/dashboard/hot-tracker';
  // Demo Tracker & Demo Economics
  const isOnDemoTracker = pathname === '/dashboard/demo-tracker';
  const isOnDemoEconomics = pathname === '/dashboard/demo-economics';
  // PPL Dashboard
  const isOnPplDashboard = pathname === '/dashboard/ppl';
  // Admin
  const isOnAdmin = pathname === '/dashboard/admin';
  // AE pages
  const isOnAEHome = pathname === '/dashboard/home';
  const isOnMyEnrichment = pathname === '/dashboard/my-enrichment';
  const isOnMyCompliance = pathname === '/dashboard/my-compliance';

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
        {/* AE Home Link */}
        {hasPermission(user, RESOURCES.AE_HOME) && (
          <>
            <div className="mb-2">
              <Link
                href="/dashboard/home"
                className={`flex items-center gap-3 py-2.5 text-sm font-medium transition-colors ${isCollapsed ? 'px-0 justify-center' : 'px-4'} ${
                  isOnAEHome
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
                title={isCollapsed ? 'Home' : undefined}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
                {!isCollapsed && <span>Home</span>}
              </Link>
            </div>
            {!isCollapsed && (
              <div className="px-4 py-2">
                <div className="border-t border-slate-700"></div>
              </div>
            )}
          </>
        )}

        {/* AE Research Section */}
        {hasPermission(user, RESOURCES.QUEUE_ENRICHMENT_VIEW) && (
          <>
            {!isCollapsed && (
              <div className="px-4 pt-2 pb-1">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Research</span>
              </div>
            )}
            <ul className="space-y-0.5">
              <li>
                <Link
                  href="/dashboard/my-enrichment"
                  className={`flex items-center gap-3 py-2 text-sm transition-colors ${isCollapsed ? 'px-0 justify-center' : 'px-4 pl-6'} ${
                    isOnMyEnrichment
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-300 hover:bg-slate-800'
                  }`}
                  title={isCollapsed ? 'Domain Enrichment' : undefined}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                  </svg>
                  {!isCollapsed && <span>Domain Enrichment</span>}
                </Link>
              </li>
              <li>
                <Link
                  href="/dashboard/my-compliance"
                  className={`flex items-center gap-3 py-2 text-sm transition-colors ${isCollapsed ? 'px-0 justify-center' : 'px-4 pl-6'} ${
                    isOnMyCompliance
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-300 hover:bg-slate-800'
                  }`}
                  title={isCollapsed ? 'Compliance Research' : undefined}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  {!isCollapsed && <span>Compliance Research</span>}
                </Link>
              </li>
            </ul>
            {!isCollapsed && (
              <div className="px-4 py-2">
                <div className="border-t border-slate-700"></div>
              </div>
            )}
          </>
        )}

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

        {/* Morning Briefing Link */}
        {hasPermission(user, RESOURCES.MORNING_BRIEFING) && (
          <div className="mb-2">
            <Link
              href="/dashboard/briefing"
              className={`flex items-center gap-3 py-2.5 text-sm font-medium transition-colors ${isCollapsed ? 'px-0 justify-center' : 'px-4'} ${
                isOnBriefing
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-300 hover:bg-slate-800'
              }`}
              title={isCollapsed ? 'Morning Briefing' : undefined}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
              </svg>
              {!isCollapsed && <span>Morning Briefing</span>}
            </Link>
          </div>
        )}

        {/* Hot Tracker Link */}
        {hasPermission(user, RESOURCES.HOT_TRACKER) && (
          <div className="mb-2">
            <Link
              href="/dashboard/hot-tracker"
              className={`flex items-center gap-3 py-2.5 text-sm font-medium transition-colors ${isCollapsed ? 'px-0 justify-center' : 'px-4'} ${
                isOnHotTracker
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-300 hover:bg-slate-800'
              }`}
              title={isCollapsed ? 'Hot Tracker' : undefined}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.879 16.121A3 3 0 1012.015 11L11 14H9c0 .768.293 1.536.879 2.121z" />
              </svg>
              {!isCollapsed && <span>Hot Tracker</span>}
            </Link>
          </div>
        )}

        {/* Demo Tracker Link */}
        {hasPermission(user, RESOURCES.DEMO_TRACKER) && (
          <div className="mb-2">
            <Link
              href="/dashboard/demo-tracker"
              className={`flex items-center gap-3 py-2.5 text-sm font-medium transition-colors ${isCollapsed ? 'px-0 justify-center' : 'px-4'} ${
                isOnDemoTracker
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-300 hover:bg-slate-800'
              }`}
              title={isCollapsed ? 'Demo Tracker' : undefined}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              {!isCollapsed && <span>Demo Tracker</span>}
            </Link>
          </div>
        )}

        {/* Demo Economics */}
        {hasPermission(user, RESOURCES.DEMO_TRACKER) && (
          <div className="mb-2">
            <Link
              href="/dashboard/demo-economics"
              className={`flex items-center gap-3 py-2.5 text-sm font-medium transition-colors ${isCollapsed ? 'px-0 justify-center' : 'px-4'} ${
                isOnDemoEconomics
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-300 hover:bg-slate-800'
              }`}
              title={isCollapsed ? 'Demo Economics' : undefined}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
              {!isCollapsed && <span>Demo Economics</span>}
            </Link>
          </div>
        )}

        {/* PPL Leads Dashboard */}
        {hasPermission(user, RESOURCES.PPL_DASHBOARD) && (
          <div className="mb-2">
            <Link
              href="/dashboard/ppl"
              className={`flex items-center gap-3 py-2.5 text-sm font-medium transition-colors ${isCollapsed ? 'px-0 justify-center' : 'px-4'} ${
                isOnPplDashboard
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-300 hover:bg-slate-800'
              }`}
              title={isCollapsed ? 'PPL Leads' : undefined}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              {!isCollapsed && <span>PPL Leads</span>}
            </Link>
          </div>
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
        {(hasPermission(user, RESOURCES.QUEUE_DEAL_HEALTH) ||
          hasPermission(user, RESOURCES.QUEUE_PPL_SEQUENCE) ||
          hasPermission(user, RESOURCES.QUEUE_DOMAIN_ENRICHMENT) ||
          hasPermission(user, RESOURCES.QUEUE_COMPLIANCE_RESEARCH) ||
          hasPermission(user, RESOURCES.QUEUE_UPSELL_HYGIENE) ||
          hasPermission(user, RESOURCES.QUEUE_STALLED_UPSELLS) ||
          hasPermission(user, RESOURCES.QUEUE_AT_RISK) ||
          hasPermission(user, RESOURCES.QUEUE_CS_HYGIENE) ||
          hasPermission(user, RESOURCES.QUEUE_SUPPORT_PULSE) ||
          hasPermission(user, RESOURCES.QUEUE_FOLLOW_UP) ||
          hasPermission(user, RESOURCES.QUEUE_PITCH_QUEUE) ||
          hasPermission(user, RESOURCES.QUEUE_SUPPORT_INTEL) ||
          hasPermission(user, RESOURCES.QUEUE_SUPPORT_MANAGER) ||
          hasPermission(user, RESOURCES.QUEUE_SUPPORT_TRAINER)) && (
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
              {(hasPermission(user, RESOURCES.QUEUE_DEAL_HEALTH) ||
                hasPermission(user, RESOURCES.QUEUE_PPL_SEQUENCE) ||
                hasPermission(user, RESOURCES.QUEUE_DOMAIN_ENRICHMENT) ||
                hasPermission(user, RESOURCES.QUEUE_COMPLIANCE_RESEARCH)) && (
              <>
                {!isCollapsed && (
                  <div className="px-4 pl-11 py-1.5">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Sales Pipeline</span>
                  </div>
                )}
                <ul className="space-y-0.5">
                  {hasPermission(user, RESOURCES.QUEUE_DEAL_HEALTH) && (
                  <li>
                    <Link
                      href="/dashboard/queues/deal-health"
                      className={`flex items-center py-2 text-sm transition-colors ${
                        isCollapsed
                          ? 'px-0 justify-center'
                          : 'px-4 pl-14'
                      } ${
                        isOnDealCoachQueue
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-300 hover:bg-slate-800'
                      }`}
                      title={isCollapsed ? 'Deal Coach' : undefined}
                    >
                      {isCollapsed ? (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                        </svg>
                      ) : (
                        <span>Deal Coach</span>
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
                  {hasPermission(user, RESOURCES.QUEUE_DOMAIN_ENRICHMENT) && (
                  <li>
                    <Link
                      href="/dashboard/queues/domain-enrichment"
                      className={`flex items-center py-2 text-sm transition-colors ${
                        isCollapsed
                          ? 'px-0 justify-center'
                          : 'px-4 pl-14'
                      } ${
                        isOnDomainEnrichmentQueue
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-300 hover:bg-slate-800'
                      }`}
                      title={isCollapsed ? 'Domain Enrichment' : undefined}
                    >
                      {isCollapsed ? (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                        </svg>
                      ) : (
                        <span>Domain Enrichment</span>
                      )}
                    </Link>
                  </li>
                  )}
                  {hasPermission(user, RESOURCES.QUEUE_COMPLIANCE_RESEARCH) && (
                  <li>
                    <Link
                      href="/dashboard/queues/compliance-research"
                      className={`flex items-center py-2 text-sm transition-colors ${
                        isCollapsed
                          ? 'px-0 justify-center'
                          : 'px-4 pl-14'
                      } ${
                        isOnComplianceResearchQueue
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-300 hover:bg-slate-800'
                      }`}
                      title={isCollapsed ? 'Compliance Research' : undefined}
                    >
                      {isCollapsed ? (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                        </svg>
                      ) : (
                        <span>Compliance Research</span>
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
              {(hasPermission(user, RESOURCES.QUEUE_AT_RISK) ||
                hasPermission(user, RESOURCES.QUEUE_CS_HYGIENE)) && (
              <>
                {!isCollapsed && (
                  <div className="px-4 pl-11 py-1.5 mt-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Customer Success</span>
                  </div>
                )}
                <ul className="space-y-0.5">
                  {hasPermission(user, RESOURCES.QUEUE_AT_RISK) && (
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
                  )}
                  {hasPermission(user, RESOURCES.QUEUE_CS_HYGIENE) && (
                  <li>
                    <Link
                      href="/dashboard/queues/cs-hygiene"
                      className={`flex items-center py-2 text-sm transition-colors ${
                        isCollapsed
                          ? 'px-0 justify-center'
                          : 'px-4 pl-14'
                      } ${
                        isOnCSHygieneQueue
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-300 hover:bg-slate-800'
                      }`}
                      title={isCollapsed ? 'CS Hygiene' : undefined}
                    >
                      {isCollapsed ? (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                        </svg>
                      ) : (
                        <span>CS Hygiene</span>
                      )}
                    </Link>
                  </li>
                  )}
                </ul>
              </>
              )}

              {/* Support Section */}
              {(hasPermission(user, RESOURCES.QUEUE_SUPPORT_PULSE) ||
                hasPermission(user, RESOURCES.QUEUE_FOLLOW_UP) ||
                hasPermission(user, RESOURCES.QUEUE_PITCH_QUEUE) ||
                hasPermission(user, RESOURCES.QUEUE_SUPPORT_INTEL) ||
                hasPermission(user, RESOURCES.QUEUE_RCM_AUDIT) ||
                hasPermission(user, RESOURCES.QUEUE_SUPPORT_MANAGER) ||
                hasPermission(user, RESOURCES.QUEUE_SUPPORT_TRAINER)) && (
              <>
                {!isCollapsed && (
                  <div className="px-4 pl-11 py-1.5 mt-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Support</span>
                  </div>
                )}
                <ul className="space-y-0.5">
                  {hasPermission(user, RESOURCES.QUEUE_SUPPORT_PULSE) && (
                  <li>
                    <Link
                      href="/dashboard/queues/support-pulse"
                      className={`flex items-center py-2 text-sm transition-colors ${
                        isCollapsed
                          ? 'px-0 justify-center'
                          : 'px-4 pl-14'
                      } ${
                        isOnSupportPulse
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-300 hover:bg-slate-800'
                      }`}
                      title={isCollapsed ? 'Support Pulse' : undefined}
                    >
                      {isCollapsed ? (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z" />
                        </svg>
                      ) : (
                        <span>Support Pulse</span>
                      )}
                    </Link>
                  </li>
                  )}
                  {hasPermission(user, RESOURCES.QUEUE_FOLLOW_UP) && (
                  <li>
                    <Link
                      href="/dashboard/queues/follow-up-queue"
                      className={`flex items-center py-2 text-sm transition-colors ${
                        isCollapsed
                          ? 'px-0 justify-center'
                          : 'px-4 pl-14'
                      } ${
                        isOnFollowUpQueue
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-300 hover:bg-slate-800'
                      }`}
                      title={isCollapsed ? 'Follow-Up Queue' : undefined}
                    >
                      {isCollapsed ? (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                      ) : (
                        <span>Follow-Up Queue</span>
                      )}
                    </Link>
                  </li>
                  )}
                  {hasPermission(user, RESOURCES.QUEUE_PITCH_QUEUE) && (
                  <li>
                    <Link
                      href="/dashboard/queues/pitch-queue"
                      className={`flex items-center py-2 text-sm transition-colors ${
                        isCollapsed
                          ? 'px-0 justify-center'
                          : 'px-4 pl-14'
                      } ${
                        isOnPitchQueue
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-300 hover:bg-slate-800'
                      }`}
                      title={isCollapsed ? 'Pitch Queue' : undefined}
                    >
                      {isCollapsed ? (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
                        </svg>
                      ) : (
                        <span>Pitch Queue</span>
                      )}
                    </Link>
                  </li>
                  )}
                  {hasPermission(user, RESOURCES.QUEUE_SUPPORT_INTEL) && (
                  <li>
                    <Link
                      href="/dashboard/queues/support-intel"
                      className={`flex items-center py-2 text-sm transition-colors ${
                        isCollapsed
                          ? 'px-0 justify-center'
                          : 'px-4 pl-14'
                      } ${
                        isOnSupportIntel
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-300 hover:bg-slate-800'
                      }`}
                      title={isCollapsed ? 'Support Intel' : undefined}
                    >
                      {isCollapsed ? (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                        </svg>
                      ) : (
                        <span>Support Intel</span>
                      )}
                    </Link>
                  </li>
                  )}
                  {hasPermission(user, RESOURCES.QUEUE_RCM_AUDIT) && (
                  <li>
                    <Link
                      href="/dashboard/queues/rcm-audit"
                      className={`flex items-center py-2 text-sm transition-colors ${
                        isCollapsed
                          ? 'px-0 justify-center'
                          : 'px-4 pl-14'
                      } ${
                        isOnRcmAudit
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-300 hover:bg-slate-800'
                      }`}
                      title={isCollapsed ? 'RCM Audit' : undefined}
                    >
                      {isCollapsed ? (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                        </svg>
                      ) : (
                        <span>RCM Audit</span>
                      )}
                    </Link>
                  </li>
                  )}
                  {hasPermission(user, RESOURCES.QUEUE_SUPPORT_MANAGER) && (
                  <li>
                    <Link
                      href="/dashboard/queues/support-manager"
                      className={`flex items-center py-2 text-sm transition-colors ${
                        isCollapsed
                          ? 'px-0 justify-center'
                          : 'px-4 pl-14'
                      } ${
                        isOnSupportManager
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-300 hover:bg-slate-800'
                      }`}
                      title={isCollapsed ? 'Support Manager' : undefined}
                    >
                      {isCollapsed ? (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                        </svg>
                      ) : (
                        <span>Support Manager</span>
                      )}
                    </Link>
                  </li>
                  )}
                  {hasPermission(user, RESOURCES.QUEUE_SUPPORT_TRAINER) && (
                  <li>
                    <Link
                      href="/dashboard/queues/support-trainer"
                      className={`flex items-center py-2 text-sm transition-colors ${
                        isCollapsed
                          ? 'px-0 justify-center'
                          : 'px-4 pl-14'
                      } ${
                        isOnSupportTrainer
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-300 hover:bg-slate-800'
                      }`}
                      title={isCollapsed ? 'Support Trainer' : undefined}
                    >
                      {isCollapsed ? (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                        </svg>
                      ) : (
                        <span>Support Trainer</span>
                      )}
                    </Link>
                  </li>
                  )}
                  {hasPermission(user, RESOURCES.QUEUE_SUPPORT_ACTION_BOARD) && (
                  <li>
                    <Link
                      href="/dashboard/queues/support-action-board"
                      className={`flex items-center py-2 text-sm transition-colors ${
                        isCollapsed
                          ? 'px-0 justify-center'
                          : 'px-4 pl-14'
                      } ${
                        isOnSupportActionBoard
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-300 hover:bg-slate-800'
                      }`}
                      title={isCollapsed ? 'Action Board' : undefined}
                    >
                      {isCollapsed ? (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                        </svg>
                      ) : (
                        <span>Action Board</span>
                      )}
                    </Link>
                  </li>
                  )}
                </ul>
              </>
              )}
            </div>
          )}
        </div>
        )}

        {/* Admin Section - VP only */}
        {!isCollapsed && user.role === 'vp_revops' && (
          <div className="mt-4">
            <Link
              href="/dashboard/admin"
              className={`flex items-center gap-3 px-4 py-2 text-sm font-medium transition-colors ${
                isOnAdmin
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span>Admin</span>
            </Link>
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
            {/* Sync button when collapsed - show for VP only */}
            {user.role === 'vp_revops' && (
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
            )}
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
                <div className="text-xs text-slate-500 mt-1 flex items-center gap-1.5">
                  {syncing ? 'Syncing...' : (
                    <>
                      <span
                        className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                          syncHealth === 'failed' ? 'bg-red-400' :
                          syncHealth === 'degraded' ? 'bg-amber-400' :
                          'bg-emerald-400'
                        }`}
                        title={
                          syncHealth === 'failed' ? 'Last sync failed' :
                          syncHealth === 'degraded' ? 'Last sync completed with errors' :
                          'Sync healthy'
                        }
                      />
                      {syncHealth === 'failed' ? 'Sync failed' : `Synced ${formatRelativeTime(lastSync)}`}
                    </>
                  )}
                </div>
              </div>
              {/* Sync button - VP only */}
              {user.role === 'vp_revops' && (
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
              )}
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
