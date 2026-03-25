import { PriorityBadge, WhoBadge, StatusTag, AnalyzedTimestamp } from './badges';
import type { LiveActionItem } from '@/app/api/queues/support-action-board/route';

export function ActionItemCard({ item, onComplete }: { item: LiveActionItem; onComplete?: () => void }) {
  const isActive = item.status === 'active';
  const isCompleted = item.status === 'completed';
  const isSuperseded = item.status === 'superseded';
  const isExpired = item.status === 'expired';
  const isAutoCompleted = isCompleted && item.completedMethod === 'auto_detected';
  const isUnverified = isCompleted && item.verified === false;

  const bgClass = isCompleted
    ? isUnverified
      ? 'bg-red-950/30 border border-red-900'
      : 'bg-emerald-950/30 border border-emerald-900'
    : isSuperseded
      ? 'bg-slate-800/50 border border-slate-700 opacity-60'
      : isExpired
        ? 'bg-slate-800/30 border border-slate-700 opacity-40'
        : 'bg-slate-800';

  return (
    <div className={`flex items-start gap-3 p-3 rounded-lg ${bgClass}`}>
      {/* Checkbox (only for active items) */}
      {isActive && onComplete ? (
        <button
          onClick={(e) => { e.stopPropagation(); onComplete(); }}
          className="mt-0.5 flex-shrink-0 w-5 h-5 rounded border border-gray-500 hover:border-indigo-400 flex items-center justify-center"
        />
      ) : (
        <div className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded border flex items-center justify-center ${
          isCompleted ? 'bg-emerald-600 border-emerald-600' : 'border-gray-600'
        }`}>
          {isCompleted && (
            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          )}
          {isSuperseded && (
            <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          )}
        </div>
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <PriorityBadge priority={item.priority} />
          <WhoBadge who={item.who} />
          {item.statusTags.map((tag) => (
            <StatusTag key={tag} tag={tag} />
          ))}
          {isAutoCompleted && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium bg-emerald-900/50 text-emerald-400">
              Auto-detected
            </span>
          )}
          {/* Item age */}
          <span className="text-[10px] text-gray-500 ml-auto">
            <AnalyzedTimestamp dateStr={item.createdAt} />
          </span>
        </div>

        <p className={`text-sm ${
          isCompleted || isSuperseded ? 'line-through text-gray-500' :
          isExpired ? 'text-gray-600' : 'text-gray-200'
        }`}>
          {item.description}
        </p>

        {/* Status detail line */}
        {isCompleted && (
          <p className="text-xs text-gray-500 mt-1">
            {isAutoCompleted ? 'Auto-completed' : `Completed by ${item.completedByName || 'agent'}`}
            {item.completedAt && <> · <AnalyzedTimestamp dateStr={item.completedAt} /></>}
            {isUnverified && (
              <span className="text-red-400 font-medium ml-2">
                Unverified — {item.verificationNote || 'No matching activity found'}
              </span>
            )}
            {item.verified === true && (
              <span className="text-emerald-400 ml-2">Verified</span>
            )}
          </p>
        )}
        {isSuperseded && item.expiredReason && (
          <p className="text-xs text-gray-500 mt-1">Replaced: {item.expiredReason}</p>
        )}
        {isExpired && item.expiredReason && (
          <p className="text-xs text-gray-500 mt-1">Expired: {item.expiredReason}</p>
        )}
      </div>
    </div>
  );
}
