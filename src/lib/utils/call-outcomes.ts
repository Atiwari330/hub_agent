/**
 * HubSpot Call Outcome Mappings
 *
 * Maps HubSpot call disposition IDs to human-readable labels
 * and provides grouping/color utilities for visualization.
 */

// HubSpot Call Disposition IDs to Labels
export const CALL_OUTCOME_MAP: Record<string, string> = {
  'b2cf5968-551e-4856-9783-52b3da59a7d0': 'Left Voicemail',
  'f240bbac-87c9-4f6e-bf70-924b57d47db7': 'Connected',
  '17b47fee-58de-441e-a44c-c6300d46f273': 'Wrong Number',
  'a4c4c377-d246-4b32-a13b-75a56a4cd0ff': 'Left Live Message',
  '73a0d17f-1163-4015-bdd5-ec830791da20': 'No Answer',
  '9d9162e7-6cf3-4944-bf63-4dff82258764': 'Busy',
};

// IDs for connected calls (conversations that happened)
export const CONNECTED_OUTCOME_IDS = new Set([
  'f240bbac-87c9-4f6e-bf70-924b57d47db7', // Connected
]);

// IDs for partial contact (message left)
export const PARTIAL_CONTACT_IDS = new Set([
  'b2cf5968-551e-4856-9783-52b3da59a7d0', // Left Voicemail
  'a4c4c377-d246-4b32-a13b-75a56a4cd0ff', // Left Live Message
]);

// IDs for no contact
export const NO_CONTACT_IDS = new Set([
  '73a0d17f-1163-4015-bdd5-ec830791da20', // No Answer
  '9d9162e7-6cf3-4944-bf63-4dff82258764', // Busy
  '17b47fee-58de-441e-a44c-c6300d46f273', // Wrong Number
]);

// Color mappings for visualization
export const OUTCOME_COLORS: Record<string, string> = {
  connected: '#10b981', // emerald-500
  leftVoicemail: '#f59e0b', // amber-500
  leftLiveMessage: '#f59e0b', // amber-500
  noAnswer: '#6b7280', // gray-500
  busy: '#6b7280', // gray-500
  wrongNumber: '#ef4444', // red-500
  unknown: '#9ca3af', // gray-400
};

// Tailwind class mappings
export const OUTCOME_BG_CLASSES: Record<string, string> = {
  connected: 'bg-emerald-500',
  leftVoicemail: 'bg-amber-500',
  leftLiveMessage: 'bg-amber-400',
  noAnswer: 'bg-gray-400',
  busy: 'bg-gray-500',
  wrongNumber: 'bg-red-400',
  unknown: 'bg-gray-300',
};

/**
 * Get human-readable label for an outcome ID
 */
export function getOutcomeLabel(outcomeId: string | null): string {
  if (!outcomeId) return 'Unknown';
  return CALL_OUTCOME_MAP[outcomeId] || 'Unknown';
}

/**
 * Check if an outcome represents a connected call
 */
export function isConnectedOutcome(outcomeId: string | null): boolean {
  if (!outcomeId) return false;
  return CONNECTED_OUTCOME_IDS.has(outcomeId);
}

/**
 * Get outcome category key for styling
 */
export function getOutcomeKey(outcomeId: string | null): string {
  if (!outcomeId) return 'unknown';

  if (outcomeId === 'f240bbac-87c9-4f6e-bf70-924b57d47db7') return 'connected';
  if (outcomeId === 'b2cf5968-551e-4856-9783-52b3da59a7d0') return 'leftVoicemail';
  if (outcomeId === 'a4c4c377-d246-4b32-a13b-75a56a4cd0ff') return 'leftLiveMessage';
  if (outcomeId === '73a0d17f-1163-4015-bdd5-ec830791da20') return 'noAnswer';
  if (outcomeId === '9d9162e7-6cf3-4944-bf63-4dff82258764') return 'busy';
  if (outcomeId === '17b47fee-58de-441e-a44c-c6300d46f273') return 'wrongNumber';

  return 'unknown';
}

/**
 * Format duration in milliseconds to human-readable string (e.g., "1:12")
 */
export function formatCallDuration(milliseconds: number | null): string {
  if (!milliseconds || milliseconds <= 0) return '0:00';

  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
