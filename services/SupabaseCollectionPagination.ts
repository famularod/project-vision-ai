export const SUPABASE_COLLECTION_PAGE_SIZE = 500;
const SUPABASE_COLLECTION_MAX_PAGES = 10_000;
/** How many times a list that changed while it was being read is read again before it is reported incomplete. */
export const SUPABASE_COLLECTION_READ_ATTEMPTS = 3;

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

export type SupabaseCollectionPaginationOptions<T = unknown> = Readonly<{
  /** Exact counts make PostgreSQL scan the whole matching set. Operational
   * reads stop on a short page instead and request a count only when a caller
   * explicitly needs count-mismatch diagnostics. */
  requestExactCount?: boolean;
  /**
   * What makes a row the same row on another page: its `id` unless said
   * otherwise. A row with no key is not compared (independent review R02).
   */
  rowKey?: (row: T) => string | null;
  /** Reads of the whole list before it is reported incomplete. Default 3. */
  maxAttempts?: number;
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
      code: 'query_failed' | 'count_mismatch' | 'page_limit_exceeded' | 'unstable_pages';
      error: string;
    }>;

/**
 * Reads a whole list, one page after another, by offset.
 *
 * Independent review R02 (Build 229): the pages are separate requests. A row
 * edited on another device between two of them moves to the front of a
 * newest-first list, every row before it slides down one place, and the next
 * page starts with the last row of the page before and leaves the edited row
 * out. The read used to answer ok with 501 rows, 500 of them different, and
 * the caller took the missing row as one the cloud does not have. A row
 * deleted between two pages slides the rows the other way and leaves one out
 * with no repeat; only an exact count shows that.
 *
 * So a row seen twice, or a row count that does not match an exact count the
 * caller asked for, means the list changed while it was being read. The whole
 * list is read again, a few times; if it keeps changing the read fails, and
 * never answers ok with a row missing. Dropping the repeated row would not do:
 * the row left out would still be missing.
 */
export async function paginateSupabaseCollection<T>(
  fetchPage: (
    request: SupabaseCollectionPageRequest,
  ) => Promise<SupabaseCollectionPage<T>>,
  pageSize = SUPABASE_COLLECTION_PAGE_SIZE,
  options: SupabaseCollectionPaginationOptions<T> = {},
): Promise<SupabaseCollectionResult<T>> {
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new Error('Supabase collection page size must be a positive integer.');
  }
  const attempts = Number.isInteger(options.maxAttempts) && (options.maxAttempts as number) >= 1
    ? options.maxAttempts as number
    : SUPABASE_COLLECTION_READ_ATTEMPTS;

  let result = await readEveryPage(fetchPage, pageSize, options);
  for (let attempt = 1; attempt < attempts && !result.ok && result.error.startsWith(SUPABASE_COLLECTION_CHANGED_WHILE_READ); attempt += 1) {
    result = await readEveryPage(fetchPage, pageSize, options);
  }
  return result;
}

/**
 * What a list that kept changing says. Plain words: the sync shows this
 * sentence to the owner as it is (sanitizeUserFacingSyncMessage).
 */
export const SUPABASE_COLLECTION_CHANGED_WHILE_READ =
  'The cloud list changed while it was being read, so it may be incomplete. Nothing was decided from it. It will be read again at the next sync.';

async function readEveryPage<T>(
  fetchPage: (
    request: SupabaseCollectionPageRequest,
  ) => Promise<SupabaseCollectionPage<T>>,
  pageSize: number,
  options: SupabaseCollectionPaginationOptions<T>,
): Promise<SupabaseCollectionResult<T>> {
  const rows: T[] = [];
  const rowKey = options.rowKey ?? defaultRowKey;
  const seenKeys = new Set<string>();
  let exactCount: number | null = null;
  let lastStatus: number | undefined;

  for (let page = 0; page < SUPABASE_COLLECTION_MAX_PAGES; page += 1) {
    const from = page * pageSize;
    const response = await fetchPage({
      from,
      to: from + pageSize - 1,
      includeExactCount: options.requestExactCount === true && page === 0,
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
    for (const row of pageRows) {
      const key = rowKey(row);
      if (key === null) continue;
      if (seenKeys.has(key)) {
        return {
          ok: false,
          rows: [],
          exactCount,
          status: lastStatus,
          code: 'unstable_pages',
          error: SUPABASE_COLLECTION_CHANGED_WHILE_READ,
        };
      }
      seenKeys.add(key);
    }
    rows.push(...pageRows);

    if (exactCount !== null) {
      if (rows.length > exactCount) {
        return countMismatch(
          exactCount,
          lastStatus,
          `${SUPABASE_COLLECTION_CHANGED_WHILE_READ} (${rows.length} rows where ${exactCount} were counted)`,
        );
      }
      if (rows.length === exactCount) {
        return { ok: true, rows, exactCount, status: lastStatus };
      }
      if (pageRows.length < pageSize) {
        return countMismatch(
          exactCount,
          lastStatus,
          `${SUPABASE_COLLECTION_CHANGED_WHILE_READ} (${rows.length} rows where ${exactCount} were counted)`,
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

/** A database row's own id, when it has one. */
function defaultRowKey(row: unknown): string | null {
  if (!row || typeof row !== 'object') return null;
  const id = (row as { id?: unknown }).id;
  if (typeof id === 'string') return id.trim() ? id : null;
  return typeof id === 'number' && Number.isFinite(id) ? String(id) : null;
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
