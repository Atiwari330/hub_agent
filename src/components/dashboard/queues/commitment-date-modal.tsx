'use client';

import { useState } from 'react';

interface CommitmentDateModalProps {
  dealName: string;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (date: string) => Promise<void>;
}

function getTomorrowDate(): string {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.toISOString().split('T')[0];
}

function getMaxDate(): string {
  const maxDate = new Date();
  maxDate.setDate(maxDate.getDate() + 30);
  return maxDate.toISOString().split('T')[0];
}

export function CommitmentDateModal({
  dealName,
  isOpen,
  onClose,
  onSubmit,
}: CommitmentDateModalProps) {
  const [date, setDate] = useState(getTomorrowDate());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await onSubmit(date);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set commitment date');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-md mx-4 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Set Commitment Date</h2>
        <p className="text-sm text-gray-600 mb-4 truncate" title={dealName}>
          {dealName}
        </p>

        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label htmlFor="commitment-date" className="block text-sm font-medium text-gray-700 mb-1">
              When will the deal hygiene be updated?
            </label>
            <input
              type="date"
              id="commitment-date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              min={getTomorrowDate()}
              max={getMaxDate()}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              required
            />
            <p className="mt-1 text-xs text-gray-500">
              Set a date within the next 30 days when you expect the missing fields to be completed.
            </p>
          </div>

          <div className="bg-blue-50 border border-blue-100 rounded-md p-3 mb-4">
            <p className="text-xs text-blue-800">
              <strong>Why this matters:</strong> Setting a commitment date helps track deal hygiene
              progress. If fields are not updated by this date, the deal will be escalated for
              follow-up.
            </p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 transition-colors disabled:opacity-50"
            >
              {isSubmitting ? 'Saving...' : 'Set Date'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
