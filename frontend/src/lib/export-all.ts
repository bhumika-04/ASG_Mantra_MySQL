/**
 * Fetch every page of a filtered list endpoint.
 *
 * Export buttons previously serialised whatever array the grid was holding, which is a
 * single server page — so exporting a 1,082-row filtered result silently produced 50
 * rows with no indication anything was missing.
 *
 * The backends cap page_size at 1000, so a single oversized request is not enough for
 * the larger result sets; this walks the pages instead.
 */
export async function fetchAllPages<T>(
  fetchPage: (page: number, pageSize: number) => Promise<{ items?: T[]; total?: number }>,
  opts: { pageSize?: number; maxRows?: number } = {},
): Promise<{ rows: T[]; total: number; truncated: boolean }> {
  const pageSize = opts.pageSize ?? 500;
  // Guard against an unbounded export locking up the browser on a huge filter.
  const maxRows = opts.maxRows ?? 20000;

  const first = await fetchPage(1, pageSize);
  const rows: T[] = [...(first.items ?? [])];
  const total = first.total ?? rows.length;

  const pagesNeeded = Math.ceil(total / pageSize);
  const pagesAllowed = Math.ceil(maxRows / pageSize);
  const lastPage = Math.min(pagesNeeded, pagesAllowed);

  for (let p = 2; p <= lastPage; p++) {
    const res = await fetchPage(p, pageSize);
    rows.push(...(res.items ?? []));
    if (rows.length >= maxRows) break;
  }

  return { rows, total, truncated: rows.length < total };
}
