/**
 * Shared timestamp utilities for converting HubSpot values to PostgreSQL-compatible formats.
 */

/**
 * Convert empty strings to null for timestamp fields.
 * HubSpot returns "" for empty dates, but PostgreSQL needs null.
 * Also handles epoch millisecond strings (e.g. "1702304200168") → ISO 8601.
 */
export function toTimestamp(value: string | undefined | null): string | null {
  if (!value || value === '') return null;
  // HubSpot sometimes returns epoch milliseconds as a string
  if (/^\d{13}$/.test(value)) {
    return new Date(parseInt(value, 10)).toISOString();
  }
  return value;
}
