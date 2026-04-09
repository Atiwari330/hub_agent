'use client';

import { useState } from 'react';
import { getAELabelForTier, mapAETierToInternal } from '@/lib/deal-review/config';

interface OverrideFormProps {
  dealId: string;
  aeValue: string;
  onSaved: () => void;
  onCancel: () => void;
}

export function OverrideForm({ dealId, aeValue, onSaved, onCancel }: OverrideFormProps) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const internalTier = mapAETierToInternal(aeValue);
  const label = getAELabelForTier(internalTier);

  async function handleSave() {
    if (!reason.trim()) {
      setError('Please provide a reason for your assessment.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`/api/deal-review/${dealId}/override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          override_likelihood: internalTier,
          override_reason: reason.trim(),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `Save failed (${res.status})`);
      }

      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-2 space-y-2">
      <div className="flex items-center gap-2 text-sm text-gray-600">
        Setting to <span className="font-semibold text-gray-900">{label}</span>
      </div>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Why do you believe this? (required)"
        rows={2}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none resize-none"
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-3 py-1.5 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button
          onClick={onCancel}
          disabled={saving}
          className="px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-900"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
