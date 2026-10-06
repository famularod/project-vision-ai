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
      code: 'query_failed' | 'count_mismatch' | 'page_limit_exceeded' | 'unstable_pages' | 'key_out_of_order';
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

export type SupabaseKeysetFilter = Readonly<{
  column: string;
  op: 'eq' | 'gt';
  value: string | number;
}>;

export type SupabaseKeysetPageRequest = Readonly<{
  /** What places this page after the rows already read; none for the first page. */
  after: readonly SupabaseKeysetFilter[];
  /** The most rows to return: the first `limit` rows in the key's order. */
  limit: number;
  includeExactCount: boolean;
}>;

export type SupabaseKeysetOptions = Readonly<{
  /**
   * The column, or the two columns, the list is read in the order of. Together
   * they must be one row's alone, and no edit may change them: a row's id; for
   * a deletion record, what it deletes.
   */
  key: readonly [string] | readonly [string, string];
  /**
   * Ask how many rows there are with the first page. The count never fails
   * the read; see paginateSupabaseCollectionByKey.
   */
  requestExactCount?: boolean;
}>;

/**
 * What a list says when its rows do not come back in the order of its key.
 * Plain words: the sync shows this sentence to the owner as it is.
 */
export const SUPABASE_COLLECTION_KEY_OUT_OF_ORDER =
  'The cloud list could not be read in order, so nothing was decided from it. It will be read again at the next sync.';

/**
 * Reads a whole list a page at a time by its key: each page asks for the rows
 * AFTER the last row of the page before, in the order of a key that is one
 * row's alone and that no edit changes.
 *
 * Independent review pass 2 (item 4): the read by offset above notices a list
 * that changed while it was read and reads it again. That had an everyday
 * trigger. While any device sends many tasks one after another (an approved
 * schedule), every write moves a row to the front of the newest-first list,
 * so every other read of that list, on every device, failed three times and
 * gave up until the upload stopped, for an account with more than a page of
 * tasks. Read by key, an edit elsewhere cannot move a row: no row that is in
 * the cloud for the whole of the read is repeated or left out, and nothing
 * has to be read again. A row added or deleted elsewhere during the read is
 * simply in the answer or not, as if the read had been a moment earlier or
 * later (a record this device holds that the list lacks is asked for by its
 * id before anything is decided from that).
 *
 * The exact count, when asked for, never fails the read. It is taken with the
 * first page, in the same statement. If the first page holds that many rows,
 * the list is whole and nothing more is asked. Later it only decides whether
 * a short page is the end: with fewer rows read than were counted (rows
 * deleted meanwhile, or a cloud that returns fewer rows to a request than it
 * was asked for), the next page is asked for all the same, and the read ends
 * on an empty page. So a cloud that caps its answers below the page size
 * cannot make a list look complete.
 *
 * With two key columns (deletion records: what kind of record, and which) the
 * pages use plain filters only: first the rest of the rows that share the
 * last row's first column, then the rows beyond it.
 *
 * The rows come back in key order; a caller that needs another order sorts
 * them (sortSupabaseRows).
 */
export async function paginateSupabaseCollectionByKey<T>(
  fetchPage: (
    request: SupabaseKeysetPageRequest,
  ) => PromiseLike<SupabaseCollectionPage<T>>,
  options: SupabaseKeysetOptions,
  pageSize = SUPABASE_COLLECTION_PAGE_SIZE,
): Promise<SupabaseCollectionResult<T>> {
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new Error('Supabase collection page size must be a positive integer.');
  }
  const [major, minor] = options.key.length === 2 ? options.key : [null, options.key[0]];
  const rows: T[] = [];
  const seenKeys = new Set<string>();
  let exactCount: number | null = null;
  let lastStatus: number | undefined;
  let after: readonly SupabaseKeysetFilter[] = [];
  /** The first-column value the page under way is confined to (two-column keys only). */
  let within: string | number | null = null;
  const outOfOrder = (): SupabaseCollectionResult<T> => ({
    ok: false, rows: [], exactCount, status: lastStatus, code: 'key_out_of_order', error: SUPABASE_COLLECTION_KEY_OUT_OF_ORDER,
  });

  for (let page = 0; page < SUPABASE_COLLECTION_MAX_PAGES; page += 1) {
    const response = await fetchPage({
      after,
      limit: pageSize,
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
    if (page === 0 && typeof response.count === 'number') exactCount = response.count;

    const pageRows = Array.isArray(response.data) ? [...response.data] : [];
    /** The key of the page's last row; null when that row has none. */
    let last: Readonly<{ major: string | number | null; minor: string | number }> | null = null;
    for (const row of pageRows) {
      const rowMajor = major === null ? null : keyValue(row, major);
      const rowMinor = keyValue(row, minor);
      // A row without its key is not compared (as the read by offset never compared one).
      if (rowMinor === null || (major !== null && rowMajor === null)) {
        last = null;
        continue;
      }
      const key = `${String(rowMajor)}\u0000${String(rowMinor)}`;
      // A row seen before: the cloud did not answer in the key's order. Never a loop, never a guess.
      if (seenKeys.has(key)) return outOfOrder();
      seenKeys.add(key);
      last = { major: rowMajor, minor: rowMinor };
    }
    rows.push(...pageRows);

    // The first page and the count are one statement: that many rows is the whole list.
    if (page === 0 && exactCount !== null && rows.length === exactCount) {
      return { ok: true, rows, exactCount, status: lastStatus };
    }
    const more = pageRows.length > 0 && (pageRows.length >= pageSize || (exactCount !== null && rows.length < exactCount));
    // Another page is placed after this page's last row: without that row's key it cannot be asked for.
    if (more && !last) return outOfOrder();
    if (more && last) {
      // The rest of the rows that share the last row's first column, or simply the rows after the last row.
      within = last.major;
      after = last.major === null
        ? [{ column: minor, op: 'gt', value: last.minor }]
        : [{ column: major as string, op: 'eq', value: last.major }, { column: minor, op: 'gt', value: last.minor }];
      continue;
    }
    if (within !== null) {
      // That first-column value is exhausted: on to the rows beyond it.
      after = [{ column: major as string, op: 'gt', value: within }];
      within = null;
      continue;
    }
    return { ok: true, rows, exactCount, status: lastStatus };
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

function keyValue(row: unknown, column: string): string | number | null {
  const value = row && typeof row === 'object' ? (row as Record<string, unknown>)[column] : null;
  if (typeof value === 'string') return value === '' ? null : value;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

type KeysetQuery = {
  eq: (column: string, value: string | number) => unknown;
  gt: (column: string, value: string | number) => unknown;
  order: (column: string, options: { ascending: boolean }) => unknown;
  range: (from: number, to: number) => unknown;
};

/**
 * Puts a keyset page on a query: the filters that place it after the rows
 * already read, the key's order, and the row window. Plain `eq` and `gt`
 * filters only, so a key value needs no quoting whatever characters it has.
 */
export function applySupabaseKeysetPage<Q>(
  query: Q,
  key: readonly string[],
  request: SupabaseKeysetPageRequest,
): Q {
  let next = query as unknown as KeysetQuery;
  request.after.forEach(filter => {
    next = (filter.op === 'eq' ? next.eq(filter.column, filter.value) : next.gt(filter.column, filter.value)) as KeysetQuery;
  });
  key.forEach(column => { next = next.order(column, { ascending: true }) as KeysetQuery; });
  return next.range(0, request.limit - 1) as Q;
}

export type SupabaseRowOrder<T> = Readonly<{
  by: (row: T) => unknown;
  /** Newest (or greatest) first. */
  descending?: boolean;
  /** The value is a cloud timestamp: compared as a moment, to the microsecond. */
  time?: boolean;
}>;

/**
 * Rows read by key, put in the order a list had when the cloud sorted it
 * (newest first, then by id, for most): what is done with a list never
 * depended on that order being exact among rows of the same instant, and
 * this keeps it the same everywhere else.
 */
export function sortSupabaseRows<T>(rows: readonly T[], ...orders: readonly SupabaseRowOrder<T>[]): T[] {
  const keyed = rows.map(row => ({
    row,
    values: orders.map(order => (order.time ? cloudMoment(order.by(row)) : plainValue(order.by(row)))),
  }));
  keyed.sort((left, right) => {
    for (let index = 0; index < orders.length; index += 1) {
      const difference = compareValues(left.values[index], right.values[index]);
      if (difference !== 0) return orders[index].descending ? -difference : difference;
    }
    return 0;
  });
  return keyed.map(entry => entry.row);
}

type SortValue = number | string | readonly [number, number];

function plainValue(value: unknown): SortValue {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return typeof value === 'string' ? value : '';
}

/** A cloud timestamp as [whole seconds, microseconds]; a missing or unreadable one sorts as the oldest. */
function cloudMoment(value: unknown): readonly [number, number] {
  if (typeof value !== 'string') return [0, 0];
  const fraction = /\.(\d+)/.exec(value)?.[1] ?? '';
  const whole = Date.parse(value.replace(/\.\d+/, ''));
  return Number.isFinite(whole) ? [Math.floor(whole / 1000), Number(`${fraction}000000`.slice(0, 6))] : [0, 0];
}

function compareValues(left: SortValue, right: SortValue): number {
  if (Array.isArray(left) && Array.isArray(right)) return left[0] - right[0] || left[1] - right[1];
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  const a = String(left);
  const b = String(right);
  return a < b ? -1 : a > b ? 1 : 0;
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
