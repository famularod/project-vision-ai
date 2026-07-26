export const SUPABASE_COLLECTION_PAGE_SIZE = 500;
const SUPABASE_COLLECTION_MAX_PAGES = 10_000;

export type SupabaseCollectionPage<T> = Readonly<{
  data: readonly T[] | null;
  error?: Readonly<{ message: string }> | null;
  status?: number;
  count?: number | null;
}>;

export type SupabaseCollectionPageRequest = Readonly<{
  from: number;
  to: number;
  includeExactCount: boolean;
}>;

export type SupabaseCollectionResult<T> =
  | Readonly<{
      ok: true;
      rows: readonly T[];
      exactCount: number | null;
      status?: number;
    }>
  | Readonly<{
      ok: false;
      rows: readonly [];
      exactCount: number | null;
      status?: number;
      code: 'query_failed' | 'count_mismatch' | 'page_limit_exceeded';
      error: string;
    }>;

export async function paginateSupabaseCollection<T>(
  fetchPage: (
    request: SupabaseCollectionPageRequest,
  ) => Promise<SupabaseCollectionPage<T>>,
  pageSize = SUPABASE_COLLECTION_PAGE_SIZE,
): Promise<SupabaseCollectionResult<T>> {
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new Error('Supabase collection page size must be a positive integer.');
  }

  const rows: T[] = [];
  let exactCount: number | null = null;
  let lastStatus: number | undefined;

  for (let page = 0; page < SUPABASE_COLLECTION_MAX_PAGES; page += 1) {
    const from = page * pageSize;
    const response = await fetchPage({
      from,
      to: from + pageSize - 1,
      includeExactCount: page === 0,
    });
    lastStatus = response.status ?? lastStatus;

    if (response.error) {
      return {
        ok: false,
        rows: [],
        exactCount,
        status: response.status,
        code: 'query_failed',
        error: response.error.message || 'Supabase collection page failed.',
      };
    }

    if (page === 0 && typeof response.count === 'number') {
      exactCount = response.count;
    }

    const pageRows = Array.isArray(response.data) ? [...response.data] : [];
    if (pageRows.length > pageSize) {
      return countMismatch(
        exactCount,
        lastStatus,
        `Supabase returned ${pageRows.length} rows for a ${pageSize}-row page.`,
      );
    }
    rows.push(...pageRows);

    if (exactCount !== null) {
      if (rows.length > exactCount) {
        return countMismatch(
          exactCount,
          lastStatus,
          `Supabase returned ${rows.length} rows, exceeding exact count ${exactCount}.`,
        );
      }
      if (rows.length === exactCount) {
        return { ok: true, rows, exactCount, status: lastStatus };
      }
      if (pageRows.length < pageSize) {
        return countMismatch(
          exactCount,
          lastStatus,
          `Supabase pagination stopped at ${rows.length} of ${exactCount} expected rows.`,
        );
      }
      continue;
    }

    if (pageRows.length < pageSize) {
      return { ok: true, rows, exactCount, status: lastStatus };
    }
  }

  return {
    ok: false,
    rows: [],
    exactCount,
    status: lastStatus,
    code: 'page_limit_exceeded',
    error: 'Supabase collection pagination exceeded its safety limit.',
  };
}

export function chunkSupabaseFilterValues<T>(
  values: readonly T[],
  chunkSize = 100,
): readonly (readonly T[])[] {
  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new Error('Supabase filter chunk size must be a positive integer.');
  }
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }
  return chunks;
}

function countMismatch<T>(
  exactCount: number | null,
  status: number | undefined,
  error: string,
): SupabaseCollectionResult<T> {
  return {
    ok: false,
    rows: [],
    exactCount,
    status,
    code: 'count_mismatch',
    error,
  };
}
