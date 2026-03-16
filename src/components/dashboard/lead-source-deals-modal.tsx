'use client';

interface DealRecord {
  hubspotDealId: string;
  dealName: string;
  amount: number | null;
  closeDate: string | null;
  leadSource: string;
  ownerName: string;
  hubspotCreatedAt: string;
  currentStage: string;
}

interface LeadSourceDealsModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  deals: DealRecord[];
}

const HUBSPOT_PORTAL_ID = '7358632';

function formatCurrency(amount: number | null): string {
  if (amount === null || amount === undefined) return '-';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function ExternalLinkIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      width="14"
      height="14"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
      />
    </svg>
  );
}

function DealCard({ deal }: { deal: DealRecord }) {
  const hubspotUrl = `https://app.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/deal/${deal.hubspotDealId}`;

  return (
    <div className="border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition-colors">
      {/* Deal header */}
      <div className="flex items-center justify-between gap-4 mb-2">
        <a
          href={hubspotUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline inline-flex items-center gap-1"
        >
          {deal.dealName}
          <ExternalLinkIcon className="text-indigo-400" />
        </a>
        {deal.amount !== null && (
          <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700 whitespace-nowrap">
            {formatCurrency(deal.amount)}
          </span>
        )}
      </div>

      {/* Owner + stage */}
      <div className="text-xs text-gray-500 mb-2">
        Owner: <span className="text-gray-700 font-medium">{deal.ownerName}</span>
        <span className="text-gray-300 mx-2">|</span>
        Stage: <span className="text-gray-700 font-medium">{deal.currentStage}</span>
      </div>

      {/* Dates */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-600">
        <span>
          Created: <span className="font-medium text-gray-900">{formatDate(deal.hubspotCreatedAt)}</span>
        </span>
        {deal.closeDate && (
          <>
            <span className="text-gray-300">|</span>
            <span>
              Close: <span className="font-medium text-gray-900">{formatDate(deal.closeDate)}</span>
            </span>
          </>
        )}
      </div>
    </div>
  );
}

export type { DealRecord };

export function LeadSourceDealsModal({ isOpen, onClose, title, deals }: LeadSourceDealsModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
            <p className="text-sm text-gray-500 mt-1">
              {deals.length} deal{deals.length !== 1 ? 's' : ''}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label="Close"
          >
            <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {deals.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500">No deals found.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {deals.map((deal) => (
                <DealCard key={deal.hubspotDealId} deal={deal} />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
