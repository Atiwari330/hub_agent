/**
 * Paginated Supabase fetch helper.
 *
 * Supabase (PostgREST) has a server-side max-rows limit (default 1,000).
 * `.limit(N)` does NOT override this server cap. The only reliable way to
 * fetch all rows is to paginate with `.range()`.
 *
 * Usage:
 *   const deals = await paginatedFetch(() =>
 *     supabase.from('deals').select('*').eq('pipeline', id),
 *   );
 */

const PAGE_SIZE = 500;

/**
 * Fetches all rows from a Supabase query by paginating with .range().
 * Pass a *factory function* that builds the query (with .select(), .eq(), etc.)
 * — the factory is called fresh each page so .range() applies cleanly.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function paginatedFetch<T = any>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buildQuery: () => any,
): Promise<T[]> {
  let allRows: T[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await buildQuery().range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`Paginated fetch failed: ${error.message}`);
    allRows = allRows.concat(data || []);
    hasMore = (data || []).length === PAGE_SIZE;
    offset += PAGE_SIZE;
  }

  return allRows;
}
