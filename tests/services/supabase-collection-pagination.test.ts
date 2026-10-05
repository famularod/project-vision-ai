import {
  SUPABASE_COLLECTION_CHANGED_WHILE_READ,
  paginateSupabaseCollection,
  type SupabaseCollectionPageRequest,
} from '../../services/SupabaseCollectionPagination';

describe('Supabase collection pagination request budget', () => {
  it('does not request an exact count for routine operational reads', async () => {
    const requests: Array<{ from: number; to: number; includeExactCount: boolean }> = [];
    const result = await paginateSupabaseCollection(async request => {
      requests.push(request);
      return {
        data: request.from === 0 ? ['one', 'two'] : [],
        error: null,
      };
    }, 2);

    expect(result).toMatchObject({ ok: true, rows: ['one', 'two'], exactCount: null });
    expect(requests).toEqual([
      { from: 0, to: 1, includeExactCount: false },
      { from: 2, to: 3, includeExactCount: false },
    ]);
  });

  it('retains exact-count validation for callers that explicitly request it', async () => {
    const requests: boolean[] = [];
    const result = await paginateSupabaseCollection(async request => {
      requests.push(request.includeExactCount);
      return { data: ['only'], count: 2, error: null };
    }, 5, { requestExactCount: true });

    expect(result).toMatchObject({ ok: false, code: 'count_mismatch', exactCount: 2 });
    // Independent review R02: a count that does not match means the list changed while it was read, so it is read
    // again (three times in all) before it is reported incomplete. It was one request.
    expect(requests).toEqual([true, true, true]);
  });
});

/**
 * Independent review R02 (Build 229): the reviewer's reproduction. A task on a
 * later page is edited on another device while the list is read, moves to the
 * front of the newest-first list, and the next page repeats one row and
 * leaves the edited row out: 501 rows returned, 500 different, status ok.
 */
describe('independent review R02: a list that changes while it is read', () => {
  type Row = { id: string; updated_at: number };
  /** A table read newest first, then by id, a page at a time, as the cloud reads it at each request. */
  function table(count: number) {
    const rows: Row[] = Array.from({ length: count }, (_, index) => ({ id: `task-${String(index).padStart(4, '0')}`, updated_at: count - index }));
    let clock = count;
    const requests: SupabaseCollectionPageRequest[] = [];
    /** Run before the numbered request is served (1 = the first page of the first read). */
    const before = new Map<number, () => void>();
    /** Run before every request is served. */
    const hooks: { beforeAny: ((request: SupabaseCollectionPageRequest) => void) | null } = { beforeAny: null };
    const ordered = () => [...rows].sort((left, right) => right.updated_at - left.updated_at || left.id.localeCompare(right.id));
    return {
      rows,
      requests,
      before,
      hooks,
      edit: (id: string) => { rows.find(row => row.id === id)!.updated_at = (clock += 1); },
      remove: (id: string) => { rows.splice(rows.findIndex(row => row.id === id), 1); },
      add: (id: string) => { rows.push({ id, updated_at: (clock += 1) }); },
      fetchPage: async (request: SupabaseCollectionPageRequest) => {
        requests.push(request);
        before.get(requests.length)?.();
        hooks.beforeAny?.(request);
        return {
          data: ordered().slice(request.from, request.to + 1).map(row => ({ ...row })),
          count: request.includeExactCount ? rows.length : null,
          error: null,
          status: 200,
        };
      },
    };
  }
  const ids = (rows: readonly Row[]) => rows.map(row => row.id).sort();

  it('a row edited between two pages: the read is done again and returns every row once', async () => {
    const cloud = table(501);
    // After the first page is read, the task on the second page is edited on another device.
    cloud.before.set(2, () => cloud.edit('task-0500'));
    const result = await paginateSupabaseCollection(cloud.fetchPage, 500);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(501);
    expect(new Set(result.rows.map(row => row.id)).size).toBe(501);
    expect(result.rows.some(row => row.id === 'task-0500')).toBe(true);
    // Two requests found the repeat; the second read took two more.
    expect(cloud.requests).toHaveLength(4);
  });

  it('a list that keeps changing is not ok, and says so in plain words', async () => {
    const cloud = table(501);
    // Every read is disturbed: each time, the one task left on the second page is edited after the first page is read.
    [2, 4, 6].forEach((request, index) => cloud.before.set(request, () => cloud.edit(`task-0${500 - index}`)));
    const result = await paginateSupabaseCollection(cloud.fetchPage, 500);

    expect(result).toMatchObject({ ok: false, code: 'unstable_pages', rows: [] });
    if (result.ok) return;
    expect(result.error).toBe(SUPABASE_COLLECTION_CHANGED_WHILE_READ);
    expect(cloud.requests).toHaveLength(6);
  });

  it('a row deleted between two pages leaves one out with no repeat: only an exact count shows it', async () => {
    const counted = table(501);
    counted.before.set(2, () => counted.remove('task-0010'));
    const result = await paginateSupabaseCollection(counted.fetchPage, 500, { requestExactCount: true });
    // The second read is undisturbed: the 500 rows the cloud now has, the row that slid across the pages among them.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(ids(result.rows)).toEqual(ids(counted.rows));
    expect(result.rows.some(row => row.id === 'task-0500')).toBe(true);

    // Without the count the same read answers ok with task-0500 missing: why this account's lists ask for it.
    const uncounted = table(501);
    uncounted.before.set(2, () => uncounted.remove('task-0010'));
    const blind = await paginateSupabaseCollection(uncounted.fetchPage, 500);
    expect(blind.ok && blind.rows.some(row => row.id === 'task-0500')).toBe(false);
  });

  it('a count that never matches is reported, with the plain sentence and the two numbers', async () => {
    const cloud = table(1001);
    // In every read, a row is deleted after the first page.
    cloud.hooks.beforeAny = request => { if (request.from === 500) cloud.remove(cloud.rows[3].id); };
    const result = await paginateSupabaseCollection(cloud.fetchPage, 500, { requestExactCount: true });
    expect(result).toMatchObject({ ok: false, code: 'count_mismatch' });
    if (result.ok) return;
    expect(result.error).toBe(`${SUPABASE_COLLECTION_CHANGED_WHILE_READ} (998 rows where 999 were counted)`);
    // The words reach the owner as they are: nothing in them reads as a database fault (sanitizeUserFacingSyncMessage).
    expect(result.error).toMatch(/^[\w .,'“”'!?()-]{1,180}$/);
    expect(result.error).not.toMatch(/error|exception|failed|failure|supabase|postgres/i);
  });

  it('a row added between two pages repeats one: read again, with the new row', async () => {
    const cloud = table(501);
    cloud.before.set(2, () => cloud.add('task-new'));
    const result = await paginateSupabaseCollection(cloud.fetchPage, 500, { requestExactCount: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(ids(result.rows)).toEqual(ids(cloud.rows));
  });

  it('a stable list of several pages is read once, each page once', async () => {
    const cloud = table(2000);
    const result = await paginateSupabaseCollection(cloud.fetchPage, 500, { requestExactCount: true });
    expect(result.ok && result.rows.length).toBe(2000);
    expect(cloud.requests.map(request => request.from)).toEqual([0, 500, 1000, 1500]);
    expect(cloud.requests.map(request => request.includeExactCount)).toEqual([true, false, false, false]);
  });

  it('compares rows by the key it is given, and does not compare rows that have none', async () => {
    // Deletion records have no id: the record they delete is their key.
    const pages = [
      [{ entity_type: 'schedule_item', record_id: 'a' }, { entity_type: 'project_area', record_id: 'a' }],
      [{ entity_type: 'schedule_item', record_id: 'a' }],
    ];
    const keyed = await paginateSupabaseCollection(async ({ from }) => ({ data: pages[from / 2] ?? [], error: null }), 2, {
      rowKey: row => `${row.entity_type}:${row.record_id}`, maxAttempts: 1,
    });
    expect(keyed).toMatchObject({ ok: false, code: 'unstable_pages' });
    const unkeyed = await paginateSupabaseCollection(async ({ from }) => ({ data: pages[from / 2] ?? [], error: null }), 2);
    expect(unkeyed.ok && unkeyed.rows.length).toBe(3);
  });

  it('a failed page is not read again', async () => {
    let requests = 0;
    const result = await paginateSupabaseCollection(async () => {
      requests += 1;
      return { data: null, error: { message: 'Network request failed' }, status: 0 };
    }, 500);
    expect(result).toMatchObject({ ok: false, code: 'query_failed', error: 'Network request failed' });
    expect(requests).toBe(1);
  });
});
