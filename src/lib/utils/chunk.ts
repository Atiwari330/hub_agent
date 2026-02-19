/**
 * Split an array into chunks of a given size.
 * Used for HubSpot batch API calls (max 100 per request).
 */
export function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
