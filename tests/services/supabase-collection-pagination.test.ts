import {
  SUPABASE_COLLECTION_CHANGED_WHILE_READ,
  SUPABASE_COLLECTION_KEY_OUT_OF_ORDER,
  applySupabaseKeysetPage,
  paginateSupabaseCollection,
  paginateSupabaseCollectionByKey,
  sortSupabaseRows,
  type SupabaseCollectionPageRequest,
  type SupabaseKeysetPageRequest,
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

/**
 * Independent review pass 2 (item 4): the notice-and-read-again above had an
 * everyday trigger. While any device sends many tasks one after another (an
 * approved schedule), every write moves a row to the front of the newest-first
 * list, and every other read of that list failed until the upload stopped.
 * Read by key (each page asks for the rows after the last row of the page
 * before, in the order of the row's own id) an edit elsewhere cannot move a
 * row, and nothing has to be read again.
 */
describe('independent review pass 2: a list read by key is not disturbed by edits elsewhere', () => {
  type Row = { id: string; updated_at: number; kind?: string };
  /** A table answered from its rows as they are at each request: filtered, in key order, the first `limit` rows. */
  function table(count: number, cap = Infinity) {
    const rows: Row[] = Array.from({ length: count }, (_, index) => ({ id: `task-${String(index).padStart(4, '0')}`, updated_at: count - index }));
    let clock = count;
    const requests: SupabaseKeysetPageRequest[] = [];
    const before = new Map<number, () => void>();
    const hooks: { beforeAny: ((request: SupabaseKeysetPageRequest, index: number) => void) | null } = { beforeAny: null };
    return {
      rows, requests, before, hooks,
      edit: (id: string) => { rows.find(row => row.id === id)!.updated_at = (clock += 1); },
      remove: (id: string) => { rows.splice(rows.findIndex(row => row.id === id), 1); },
      add: (id: string) => { rows.push({ id, updated_at: (clock += 1) }); },
      fetchPage: (key: readonly string[]) => async (request: SupabaseKeysetPageRequest) => {
        requests.push(request);
        before.get(requests.length)?.();
        hooks.beforeAny?.(request, requests.length);
        const value = (row: Row, column: string) => (row as unknown as Record<string, string | number>)[column];
        const matching = rows.filter(row => request.after.every(filter =>
          filter.op === 'eq' ? value(row, filter.column) === filter.value : value(row, filter.column) > filter.value));
        const ordered = [...matching].sort((left, right) => {
          for (const column of key) {
            if (value(left, column) !== value(right, column)) return value(left, column) < value(right, column) ? -1 : 1;
          }
          return 0;
        });
        return {
          data: ordered.slice(0, Math.min(request.limit, cap)).map(row => ({ ...row })),
          count: request.includeExactCount ? rows.length : null,
          error: null,
          status: 200,
        };
      },
    };
  }
  const ID = ['id'] as const;
  const ids = (rows: readonly Row[]) => rows.map(row => row.id).sort();

  it('a task edited between two pages: read once, every row once, the edit in it', async () => {
    const cloud = table(501);
    cloud.before.set(2, () => cloud.edit('task-0500'));
    const result = await paginateSupabaseCollectionByKey(cloud.fetchPage(ID), { key: ID, requestExactCount: true }, 500);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(ids(result.rows)).toEqual(ids(cloud.rows));
    expect(result.rows.find(row => row.id === 'task-0500')?.updated_at).toBe(502);
    // Two pages, asked for once each: the second for the rows after the last id of the first.
    expect(cloud.requests.map(request => request.after)).toEqual([[], [{ column: 'id', op: 'gt', value: 'task-0499' }]]);
  });

  it('the everyday case: another device writes a task before every page (an approved schedule going up): read once, whole', async () => {
    const cloud = table(2000);
    let writes = 0;
    cloud.hooks.beforeAny = () => { cloud.edit(`task-${String(1999 - (writes += 1) * 7).padStart(4, '0')}`); };
    const result = await paginateSupabaseCollectionByKey(cloud.fetchPage(ID), { key: ID, requestExactCount: true }, 500);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(ids(result.rows)).toEqual(ids(cloud.rows));
    // Four pages of 500 and the empty page that ends a list whose last page was full.
    expect(cloud.requests).toHaveLength(5);

    // The same writes against the same list read by offset, newest first: it gives up after three reads.
    const byOffset = table(2000);
    let moved = 0;
    const disturbed = await paginateSupabaseCollection(async request => {
      byOffset.edit(`task-${String(1999 - (moved += 1) * 7).padStart(4, '0')}`);
      const ordered = [...byOffset.rows].sort((left, right) => right.updated_at - left.updated_at || left.id.localeCompare(right.id));
      return { data: ordered.slice(request.from, request.to + 1), count: request.includeExactCount ? ordered.length : null, error: null };
    }, 500, { requestExactCount: true });
    expect(disturbed).toMatchObject({ ok: false, error: SUPABASE_COLLECTION_CHANGED_WHILE_READ });
  });

  it('a row deleted between two pages does not fail the read, and no other row is left out', async () => {
    const cloud = table(501);
    cloud.before.set(2, () => cloud.remove('task-0010'));
    const result = await paginateSupabaseCollectionByKey(cloud.fetchPage(ID), { key: ID, requestExactCount: true }, 500);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Every row still in the cloud is there once; the deleted one, read before it went, is there too.
    expect(ids(result.rows)).toEqual([...ids(cloud.rows), 'task-0010'].sort());
    expect(result.exactCount).toBe(501);
  });

  it('a row deleted ahead of the read: fewer rows than were counted is not a failure; one more page is asked for, and is empty', async () => {
    const cloud = table(501);
    cloud.before.set(2, () => cloud.remove('task-0500'));
    const result = await paginateSupabaseCollectionByKey(cloud.fetchPage(ID), { key: ID, requestExactCount: true }, 500);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(ids(result.rows)).toEqual(ids(cloud.rows));
    // The second page came back empty (500 rows where 501 were counted): that ends the read.
    expect(cloud.requests).toHaveLength(2);
  });

  it('a row added between two pages does not fail the read: it is in the answer or not, and nothing else changes', async () => {
    const ahead = table(501);
    ahead.before.set(2, () => ahead.add('task-9999'));
    const withIt = await paginateSupabaseCollectionByKey(ahead.fetchPage(ID), { key: ID, requestExactCount: true }, 500);
    expect(withIt.ok && ids(withIt.rows)).toEqual(ids(ahead.rows));

    const behind = table(501);
    behind.before.set(2, () => behind.add('task-0000a'));
    const withoutIt = await paginateSupabaseCollectionByKey(behind.fetchPage(ID), { key: ID, requestExactCount: true }, 500);
    expect(withoutIt.ok && ids(withoutIt.rows)).toEqual(ids(behind.rows).filter(id => id !== 'task-0000a'));
  });

  it('a list that fits the first page is one request, and its count is asked for with it', async () => {
    const cloud = table(120);
    const result = await paginateSupabaseCollectionByKey(cloud.fetchPage(ID), { key: ID, requestExactCount: true }, 500);
    expect(result.ok && result.rows.length).toBe(120);
    expect(cloud.requests).toEqual([{ after: [], limit: 500, includeExactCount: true }]);

    // Exactly one page of rows: the count, taken in the same statement, says the list is whole.
    const full = table(500);
    await paginateSupabaseCollectionByKey(full.fetchPage(ID), { key: ID, requestExactCount: true }, 500);
    expect(full.requests).toHaveLength(1);
    // Without the count a full page must be followed by one more.
    const uncounted = table(500);
    await paginateSupabaseCollectionByKey(uncounted.fetchPage(ID), { key: ID }, 500);
    expect(uncounted.requests).toHaveLength(2);
  });

  it('a cloud that returns fewer rows to a request than it was asked for cannot make a counted list look complete', async () => {
    const capped = table(450, 100);
    const result = await paginateSupabaseCollectionByKey(capped.fetchPage(ID), { key: ID, requestExactCount: true }, 500);
    expect(result.ok && ids(result.rows)).toEqual(ids(capped.rows));
    // Five answers of at most 100 rows; with all 450 read, the last short answer ends it.
    expect(capped.requests).toHaveLength(5);

    // Without the count the first short answer is taken as the end: why this account's lists ask for it.
    const blind = table(450, 100);
    const short = await paginateSupabaseCollectionByKey(blind.fetchPage(ID), { key: ID }, 500);
    expect(short.ok && short.rows.length).toBe(100);
  });

  it('two key columns (deletion records): plain filters only, whatever characters a value has', async () => {
    const PAIR = ['kind', 'id'] as const;
    const cloud = table(0);
    const names = ['Lot 5, North (East)', 'a.b:c', 'O"Brien \\ Sons', 'Zed'];
    ['project', 'schedule_item', 'project_area'].forEach(kind => {
      for (let index = 0; index < (kind === 'schedule_item' ? 7 : 2); index += 1) cloud.rows.push({ kind, id: `${kind}-${index}`, updated_at: index });
    });
    names.forEach(name => cloud.rows.push({ kind: 'project', id: name, updated_at: 0 }));
    // While it is read, a deletion is recorded again (its time changes; its key does not).
    cloud.hooks.beforeAny = () => cloud.edit('schedule_item-3');

    const result = await paginateSupabaseCollectionByKey(cloud.fetchPage(PAIR), { key: PAIR, requestExactCount: true }, 2);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.map(row => `${row.kind}/${row.id}`).sort()).toEqual(cloud.rows.map(row => `${row.kind}/${row.id}`).sort());
    expect(result.rows).toHaveLength(15);
    // Each later page is "the rest of this kind after that record" or "the kinds beyond this one".
    cloud.requests.slice(1).forEach(request => {
      expect([['eq', 'gt'], ['gt']]).toContainEqual(request.after.map(filter => filter.op));
      expect(request.after.every(filter => typeof filter.value === 'string')).toBe(true);
    });
    // A value goes into a filter exactly as it is: no quoting, no escaping.
    expect(cloud.requests[1].after).toEqual([{ column: 'kind', op: 'eq', value: 'project' }, { column: 'id', op: 'gt', value: 'O"Brien \\ Sons' }]);
  });

  it('a page that ends on a row without its key, or a key seen twice, fails the read plainly: never a loop, never a guess', async () => {
    // Another page would have to be placed after the last row, and that row has no key.
    const noKey = await paginateSupabaseCollectionByKey(async () => ({ data: [{ id: 'a' }, { name: 'no id' }], error: null }), { key: ID }, 2);
    expect(noKey).toMatchObject({ ok: false, code: 'key_out_of_order', error: SUPABASE_COLLECTION_KEY_OUT_OF_ORDER, rows: [] });
    // A list that ends on that page needs no key: the rows are returned as they are (the read by offset never
    // compared a row without one either).
    const whole = await paginateSupabaseCollectionByKey(async () => ({ data: [{ name: 'no id' }], error: null }), { key: ID }, 2);
    expect(whole).toMatchObject({ ok: true, rows: [{ name: 'no id' }] });
    const counted = await paginateSupabaseCollectionByKey(async () => ({ data: [{ name: 'no id' }, { name: 'nor this' }], count: 2, error: null }), { key: ID, requestExactCount: true }, 2);
    expect(counted).toMatchObject({ ok: true, exactCount: 2 });
    // A row without its key in the middle of a page does not stop the read: the next page is placed after the last row.
    const pages = [[{ id: 'a' }, { name: 'no id' }, { id: 'c' }], [{ id: 'd' }]];
    const placed: unknown[] = [];
    const middle = await paginateSupabaseCollectionByKey(async ({ after }) => { placed.push(after); return { data: pages[placed.length - 1], error: null }; }, { key: ID }, 3);
    expect(middle).toMatchObject({ ok: true, rows: [{ id: 'a' }, { name: 'no id' }, { id: 'c' }, { id: 'd' }] });
    expect(placed).toEqual([[], [{ column: 'id', op: 'gt', value: 'c' }]]);
    // A cloud that ignores "after": the same page again.
    let asked = 0;
    const stuck = await paginateSupabaseCollectionByKey(async () => { asked += 1; return { data: [{ id: 'a' }, { id: 'b' }], error: null }; }, { key: ID }, 2);
    expect(stuck).toMatchObject({ ok: false, code: 'key_out_of_order' });
    expect(asked).toBe(2);
    expect(SUPABASE_COLLECTION_KEY_OUT_OF_ORDER).toMatch(/^[\w .,'“”'!?()-]{1,180}$/);
    expect(SUPABASE_COLLECTION_KEY_OUT_OF_ORDER).not.toMatch(/error|exception|failed|failure|supabase|postgres/i);
  });

  it('a failed page fails the read with its reason, and is not asked for again', async () => {
    let asked = 0;
    const result = await paginateSupabaseCollectionByKey(async () => {
      asked += 1;
      return { data: null, error: { message: 'Network request failed' }, status: 0 };
    }, { key: ID });
    expect(result).toMatchObject({ ok: false, code: 'query_failed', error: 'Network request failed' });
    expect(asked).toBe(1);
  });

  it('puts a page on a query with eq, gt, the key\'s order and the first rows only', () => {
    const calls: unknown[][] = [];
    const query: Record<string, (...args: unknown[]) => unknown> = {};
    ['eq', 'gt', 'order', 'range'].forEach(method => { query[method] = (...args: unknown[]) => { calls.push([method, ...args]); return query; }; });
    applySupabaseKeysetPage(query, ['entity_type', 'record_id'], {
      after: [{ column: 'entity_type', op: 'eq', value: 'project' }, { column: 'record_id', op: 'gt', value: 'Lot 5, North' }],
      limit: 500, includeExactCount: false,
    });
    expect(calls).toEqual([
      ['eq', 'entity_type', 'project'], ['gt', 'record_id', 'Lot 5, North'],
      ['order', 'entity_type', { ascending: true }], ['order', 'record_id', { ascending: true }],
      ['range', 0, 499],
    ]);
  });

  it('puts rows read by key back in the order the cloud gave them: newest first to the microsecond, then by id', () => {
    const rows = [
      { id: 'c', updated_at: '2026-09-10T08:00:00.123457+00:00' },
      { id: 'a', updated_at: '2026-09-10T08:00:00.123456+00:00' },
      { id: 'b', updated_at: '2026-09-10T08:00:00.123456+00:00' },
      { id: 'e', updated_at: null },
      { id: 'd', updated_at: '2026-09-10T09:00:00Z' },
    ];
    const sorted = sortSupabaseRows(rows, { by: row => row.updated_at, time: true, descending: true }, { by: row => row.id });
    // c is a millionth of a second newer than a and b, which are of the same instant and so in id order.
    expect(sorted.map(row => row.id)).toEqual(['d', 'c', 'a', 'b', 'e']);
    // Numbers by size, text by character: a decision's versions in order.
    const versions = [{ d: 'x', v: 10 }, { d: 'x', v: 9 }, { d: 'w', v: 1 }];
    expect(sortSupabaseRows(versions, { by: row => row.d }, { by: row => row.v }).map(row => `${row.d}${row.v}`)).toEqual(['w1', 'x9', 'x10']);
    expect(rows.map(row => row.id)).toEqual(['c', 'a', 'b', 'e', 'd']); // the rows given are left as they were
  });
});
