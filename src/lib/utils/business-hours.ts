const TIMEZONE = 'America/New_York';
const START_HOUR = 9;  // 9 AM ET
const END_HOUR = 19;   // 7 PM ET

/**
 * Returns true if the current time is within business hours:
 * Monday–Friday, 9 AM – 7 PM Eastern (America/New_York).
 * Handles EST/EDT automatically via Intl API.
 */
export function isBusinessHours(now: Date = new Date()): boolean {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    hour: 'numeric',
    hour12: false,
    weekday: 'short',
  });

  const parts = formatter.formatToParts(now);
  const weekday = parts.find((p) => p.type === 'weekday')?.value;
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);

  if (weekday === 'Sat' || weekday === 'Sun') return false;

  return hour >= START_HOUR && hour < END_HOUR;
}
