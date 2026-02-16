'use client';

import { useState } from 'react';
import { formatCurrency } from '@/lib/utils/currency';
import { getHubSpotDealUrl } from '@/lib/hubspot/urls';

// ===== Types =====

interface BaseDeal {
  id: string;
  hubspotDealId: string;
  dealName: string;
  amount: number | null;
}

export interface HygieneDeal extends BaseDeal {
  missingFields: { field: string; label: string }[];
  stageName: string | null;
  isHighPriority: boolean;
}

export interface StalledDeal extends BaseDeal {
  severity: 'critical' | 'warning' | 'watch';
  daysSinceActivity: number;
  aggravatingFactors: {
    closeDateInPast: boolean;
    closeDateWithin14Days: boolean;
    noNextStep: boolean;
    nextStepOverdue: boolean;
  };
}

export interface NextStepDeal extends BaseDeal {
  nextStepStatus: 'missing' | 'overdue';
  daysOverdue: number | null;
  reason: string;
  stageName: string | null;
  isHighPriority: boolean;
}

export interface CloseDateDeal extends BaseDeal {
  closeDate: string;
  daysOverdue: number;
}

interface PrioritizedDeal extends BaseDeal {
  stageName: string | null;
  isHighPriority: boolean;
}

export interface ActionItemsCardProps {
  hygiene: HygieneDeal[];
  stalled: StalledDeal[];
  nextSteps: NextStepDeal[];
  closeDate: CloseDateDeal[];
  totalUniqueDeals: number;
}

// ===== Constants =====

const DEFAULT_VISIBLE = 3;

const SEVERITY_COLORS = {
  critical: { bg: 'bg-red-100', text: 'text-red-700' },
  warning: { bg: 'bg-amber-100', text: 'text-amber-700' },
  watch: { bg: 'bg-slate-100', text: 'text-slate-600' },
} as const;

// ===== Sub-Components =====

function DealRow({
  deal,
  detail,
  muted,
  stageBadge,
}: {
  deal: BaseDeal;
  detail: React.ReactNode;
  muted?: boolean;
  stageBadge?: string | null;
}) {
  return (
    <a
      href={getHubSpotDealUrl(deal.hubspotDealId)}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center justify-between p-3 rounded-xl hover:bg-slate-50 transition-colors group"
    >
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium truncate ${muted ? 'text-slate-500' : 'text-slate-900'}`}>
          {deal.dealName}
        </p>
        <div className={`flex items-center gap-2 mt-1 flex-wrap ${muted ? 'opacity-70' : ''}`}>
          {deal.amount != null && (
            <span className="text-xs text-slate-500">
              {formatCurrency(deal.amount)}
            </span>
          )}
          {stageBadge && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-50 text-indigo-600">
              {stageBadge}
            </span>
          )}
          {detail}
        </div>
      </div>
      <svg
        className="w-4 h-4 text-slate-300 group-hover:text-slate-500 transition-colors flex-shrink-0 ml-2"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </a>
  );
}

function CategorySection({
  icon,
  label,
  count,
  children,
  deals,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  children: (deals: unknown[]) => React.ReactNode;
  deals: unknown[];
}) {
  const [expanded, setExpanded] = useState(false);
  const visibleDeals = expanded ? deals : deals.slice(0, DEFAULT_VISIBLE);
  const remaining = deals.length - DEFAULT_VISIBLE;

  return (
    <div className="space-y-1">
      {/* Category header */}
      <div className="flex items-center gap-2 px-1 mb-1">
        <span className="text-slate-400">{icon}</span>
        <span className="text-xs font-semibold text-slate-600">{label}</span>
        <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-slate-200 text-slate-600 text-[10px] font-bold px-1">
          {count}
        </span>
      </div>

      {/* Deal rows */}
      <div className="space-y-0.5">{children(visibleDeals)}</div>

      {/* Show more toggle */}
      {remaining > 0 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full text-center text-xs text-indigo-600 hover:text-indigo-800 font-medium py-1.5 transition-colors"
        >
          {expanded ? 'Show less' : `Show ${remaining} more`}
        </button>
      )}
    </div>
  );
}

function PrioritizedCategorySection<T extends PrioritizedDeal>({
  icon,
  label,
  deals,
  renderDetail,
  keyPrefix,
}: {
  icon: React.ReactNode;
  label: string;
  deals: T[];
  renderDetail: (deal: T) => React.ReactNode;
  keyPrefix?: string;
}) {
  const priority = deals.filter((d) => d.isHighPriority);
  const earlier = deals.filter((d) => !d.isHighPriority);
  const totalCount = deals.length;

  const [priorityExpanded, setPriorityExpanded] = useState(false);
  const [earlierExpanded, setEarlierExpanded] = useState(false);

  const visiblePriority = priorityExpanded ? priority : priority.slice(0, DEFAULT_VISIBLE);
  const priorityRemaining = priority.length - DEFAULT_VISIBLE;

  const visibleEarlier = earlierExpanded ? earlier : [];

  const prefix = keyPrefix ? `${keyPrefix}-` : '';

  return (
    <div className="space-y-1">
      {/* Category header */}
      <div className="flex items-center gap-2 px-1 mb-1">
        <span className="text-slate-400">{icon}</span>
        <span className="text-xs font-semibold text-slate-600">{label}</span>
        <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-slate-200 text-slate-600 text-[10px] font-bold px-1">
          {totalCount}
        </span>
      </div>

      {/* Priority deals */}
      {priority.length > 0 && (
        <div className="space-y-0.5">
          {visiblePriority.map((deal) => (
            <DealRow
              key={`${prefix}${deal.id}`}
              deal={deal}
              detail={renderDetail(deal)}
              stageBadge={deal.stageName}
            />
          ))}
        </div>
      )}

      {/* Priority show more */}
      {priorityRemaining > 0 && (
        <button
          onClick={() => setPriorityExpanded(!priorityExpanded)}
          className="w-full text-center text-xs text-indigo-600 hover:text-indigo-800 font-medium py-1.5 transition-colors"
        >
          {priorityExpanded ? 'Show less' : `Show ${priorityRemaining} more`}
        </button>
      )}

      {/* Earlier stage deals */}
      {earlier.length > 0 && (
        <>
          {/* Separator */}
          <div className="border-t border-slate-100 mx-1" />

          {/* Earlier stage toggle / header */}
          <button
            onClick={() => setEarlierExpanded(!earlierExpanded)}
            className="flex items-center gap-1.5 px-1 py-1 w-full text-left"
          >
            <svg
              className={`w-3 h-3 text-slate-400 transition-transform ${earlierExpanded ? 'rotate-90' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <span className="text-[11px] text-slate-400 font-medium">
              {earlierExpanded ? 'Earlier Stage' : `Show ${earlier.length} earlier-stage deal${earlier.length !== 1 ? 's' : ''}`}
            </span>
          </button>

          {/* Earlier stage deal rows */}
          {earlierExpanded && (
            <div className="space-y-0.5">
              {visibleEarlier.map((deal) => (
                <DealRow
                  key={`${prefix}early-${deal.id}`}
                  deal={deal}
                  detail={renderDetail(deal)}
                  muted
                  stageBadge={deal.stageName}
                />
              ))}
              <button
                onClick={() => setEarlierExpanded(false)}
                className="w-full text-center text-xs text-slate-400 hover:text-slate-600 font-medium py-1 transition-colors"
              >
                Show less
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ===== Category Detail Renderers =====

function HygieneDetail({ deal }: { deal: HygieneDeal }) {
  return (
    <>
      {deal.missingFields.map((f) => (
        <span
          key={f.field}
          className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-orange-100 text-orange-700"
        >
          {f.label}
        </span>
      ))}
    </>
  );
}

function StalledDetail({ deal }: { deal: StalledDeal }) {
  const colors = SEVERITY_COLORS[deal.severity];
  return (
    <>
      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${colors.bg} ${colors.text}`}>
        {deal.severity === 'critical' ? 'Critical' : deal.severity === 'warning' ? 'Warning' : 'Watch'}
      </span>
      <span className="text-[10px] text-slate-500">
        No activity in {deal.daysSinceActivity} days
      </span>
    </>
  );
}

function NextStepDetail({ deal }: { deal: NextStepDeal }) {
  if (deal.nextStepStatus === 'missing') {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700">
        No next step defined
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-100 text-red-700">
      Next step {deal.daysOverdue} day{deal.daysOverdue !== 1 ? 's' : ''} overdue
    </span>
  );
}

function CloseDateDetail({ deal }: { deal: CloseDateDeal }) {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-100 text-red-700">
      Close date passed {deal.daysOverdue} day{deal.daysOverdue !== 1 ? 's' : ''} ago
    </span>
  );
}

// ===== Icons =====

function ClipboardIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  );
}

// ===== Main Component =====

export function ActionItemsCard({
  hygiene,
  stalled,
  nextSteps,
  closeDate,
  totalUniqueDeals,
}: ActionItemsCardProps) {
  const hasItems = totalUniqueDeals > 0;

  return (
    <div className="bg-white rounded-2xl shadow-sm p-6">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
          Action Items
        </p>
        {hasItems && (
          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-500 text-white text-xs font-bold">
            {totalUniqueDeals}
          </span>
        )}
      </div>

      {/* Empty state */}
      {!hasItems && (
        <div className="flex items-center gap-3 py-8 justify-center text-slate-400">
          <svg className="w-6 h-6 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span className="text-sm font-medium text-slate-500">You&apos;re all caught up</span>
        </div>
      )}

      {/* Categories */}
      {hasItems && (
        <div className="space-y-5">
          {/* 1. Deal Hygiene */}
          {hygiene.length > 0 && (
            <PrioritizedCategorySection
              icon={<ClipboardIcon />}
              label="Deal Hygiene"
              deals={hygiene}
              renderDetail={(deal) => <HygieneDetail deal={deal} />}
            />
          )}

          {/* 2. Stalled Deals — always visible */}
          <div className="space-y-1">
            <div className="flex items-center gap-2 px-1 mb-1">
              <span className="text-slate-400"><PauseIcon /></span>
              <span className="text-xs font-semibold text-slate-600">Stalled Deals</span>
              <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-slate-200 text-slate-600 text-[10px] font-bold px-1">
                {stalled.length}
              </span>
            </div>
            {stalled.length > 0 ? (
              <StalledDealsContent deals={stalled} />
            ) : (
              <div className="flex items-center gap-2 px-3 py-3">
                <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-xs font-medium text-emerald-600">
                  No stalled deals &mdash; you&apos;re on track
                </span>
              </div>
            )}
          </div>

          {/* 3. Next Steps */}
          {nextSteps.length > 0 && (
            <PrioritizedCategorySection
              icon={<ArrowRightIcon />}
              label="Next Steps"
              deals={nextSteps}
              renderDetail={(deal) => <NextStepDetail deal={deal} />}
              keyPrefix="nextstep"
            />
          )}

          {/* 4. Past Close Date */}
          {closeDate.length > 0 && (
            <CategorySection
              icon={<CalendarIcon />}
              label="Past Close Date"
              count={closeDate.length}
              deals={closeDate}
            >
              {(visible) =>
                (visible as CloseDateDeal[]).map((deal) => (
                  <DealRow key={`closedate-${deal.id}`} deal={deal} detail={<CloseDateDetail deal={deal} />} />
                ))
              }
            </CategorySection>
          )}
        </div>
      )}
    </div>
  );
}

// Stalled deals sub-component with expand/collapse
function StalledDealsContent({ deals }: { deals: StalledDeal[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? deals : deals.slice(0, DEFAULT_VISIBLE);
  const remaining = deals.length - DEFAULT_VISIBLE;

  return (
    <>
      <div className="space-y-0.5">
        {visible.map((deal) => (
          <DealRow key={deal.id} deal={deal} detail={<StalledDetail deal={deal} />} />
        ))}
      </div>
      {remaining > 0 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full text-center text-xs text-indigo-600 hover:text-indigo-800 font-medium py-1.5 transition-colors"
        >
          {expanded ? 'Show less' : `Show ${remaining} more`}
        </button>
      )}
    </>
  );
}
