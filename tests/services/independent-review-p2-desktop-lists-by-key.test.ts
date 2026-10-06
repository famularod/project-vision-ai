import { createDAVEWebSupabaseGateway } from '../../services/DAVEWebSupabaseClient';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

/**
 * Independent review pass 2 (item 4), the desktop side.
 *
 * The desktop read its lists a page at a time by offset, newest first. While a
 * phone sent an approved schedule's tasks one after another, each write moved a
 * row to the front, so a refresh of a workspace with more than a page of tasks
 * (500) saw a task twice or a count that did not match, read again, and gave up
 * after three tries, until the upload stopped. The lists are now read in the
 * order of a key no edit changes, each page after the last row of the page
 * before, and put newest first afterwards.
 *
 * The stand-in cloud below answers each request from the rows as they are at
 * that moment, in the order and with the filters the request asked for, and
 * lets "another device" write before any request is answered.
 */
type Row = Record<string, unknown>;
type Asked = {
  table: string;
  filters: Array<[string, 'eq' | 'gt', unknown]>;
  order: Array<[string, boolean]>;
  range: [number, number];
  counted: boolean;
};

function standInCloud() {
  const tables = new Map<string, Row[]>();
  const requests: Asked[] = [];
  const rowsOf = (table: string) => {
    if (!tables.has(table)) tables.set(table, []);
    return tables.get(table)!;
  };
  let beforeRequest: (asked: Asked, nth: number) => void = () => undefined;
  const compare = (left: unknown, right: unknown) =>
    typeof left === 'number' && typeof right === 'number' ? left - right : String(left) < String(right) ? -1 : String(left) > String(right) ? 1 : 0;

  function query(table: string) {
    const asked: Asked = { table, filters: [], order: [], range: [0, 0], counted: false };
    const chain: Record<string, unknown> = {};
    Object.assign(chain, {
      select(_columns: string, options?: { count?: string }) {
        asked.counted = options?.count === 'exact';
        return chain;
      },
      eq(column: string, value: unknown) { asked.filters.push([column, 'eq', value]); return chain; },
      gt(column: string, value: unknown) { asked.filters.push([column, 'gt', value]); return chain; },
      order(column: string, options?: { ascending?: boolean }) { asked.order.push([column, options?.ascending !== false]); return chain; },
      async range(from: number, to: number) {
        asked.range = [from, to];
        beforeRequest(asked, requests.filter(request => request.table === table).length);
        requests.push(asked);
        const matching = rowsOf(table)
          .filter(row => asked.filters.every(([column, op, value]) => (op === 'eq' ? row[column] === value : compare(row[column], value) > 0)))
          .sort((left, right) => {
            for (const [column, ascending] of asked.order) {
              const difference = compare(left[column], right[column]);
              if (difference !== 0) return ascending ? difference : -difference;
            }
            return 0;
          });
        return {
          data: matching.slice(from, to + 1).map(row => ({ ...row })),
          error: null,
          status: 200,
          count: asked.counted ? matching.length : null,
        };
      },
    });
    return chain;
  }

  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: 'owner-1', email: 'owner@example.com' } }, error: null }),
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
    },
    async rpc(name: string) {
      if (name === 'dave_is_app_owner') return { data: true, error: null, status: 200 };
      if (name === 'dave_list_reference_document_metadata') return { data: [], error: null, status: 200 };
      return { data: null, error: null, status: 200 };
    },
    from: (table: string) => query(table),
  };

  return {
    client: client as never,
    rows: rowsOf,
    requests,
    of: (table: string) => requests.filter(request => request.table === table),
    /** What another device does just before this device's next request is answered. */
    onRequest(action: (asked: Asked, nth: number) => void) { beforeRequest = action; },
  };
}

const id = (index: number) => `task-${String(index).padStart(5, '0')}`;
const stamp = (tick: number) => `2026-10-05T10:00:00.${String(tick).padStart(6, '0')}+00:00`;

function workspaceWith(taskCount: number) {
  const cloud = standInCloud();
  for (let index = 0; index < taskCount; index += 1) {
    cloud.rows('schedule_items').push({
      owner_id: 'owner-1', id: id(index), updated_at: stamp(index), item_data: { id: id(index), taskName: `Task ${index}` },
    });
  }
  // Another account's row: never this account's.
  cloud.rows('schedule_items').push({ owner_id: 'someone-else', id: 'task-00007x', updated_at: stamp(7), item_data: {} });
  return cloud;
}

describe('independent review pass 2 (item 4): the desktop reads its lists by key', () => {
  it('while a phone sends an approved schedule task after task, the refresh reads the workspace whole, once, newest first', async () => {
    const cloud = workspaceWith(1_203);
    let tick = 2_000;
    let written = 0;
    // Before every request for the task list, the phone writes two more tasks: one already read, one still to come.
    cloud.onRequest(asked => {
      if (asked.table !== 'schedule_items') return;
      [written, 1_202 - written].forEach(index => {
        const row = cloud.rows('schedule_items').find(candidate => candidate.id === id(index))!;
        row.updated_at = stamp(tick += 1);
        row.item_data = { id: id(index), taskName: `Task ${index}`, percentComplete: 50 };
      });
      written += 1;
    });

    const rows = await createDAVEWebSupabaseGateway(cloud.client).loadAuthorizedRows();

    const tasks = rows.scheduleItems as Row[];
    expect(tasks).toHaveLength(1_203);
    expect(new Set(tasks.map(row => row.id)).size).toBe(1_203);
    expect(tasks.every(row => row.owner_id === 'owner-1')).toBe(true);
    // Read once: three pages, no page asked for twice, and nothing read again.
    const asked = cloud.of('schedule_items');
    expect(asked).toHaveLength(3);
    expect(asked.map(request => request.range)).toEqual([[0, 499], [0, 499], [0, 499]]);
    expect(asked.map(request => request.order)).toEqual([[['id', true]], [['id', true]], [['id', true]]]);
    expect(asked.map(request => request.counted)).toEqual([true, false, false]);
    expect(asked.map(request => request.filters)).toEqual([
      [['owner_id', 'eq', 'owner-1']],
      [['owner_id', 'eq', 'owner-1'], ['id', 'gt', id(499)]],
      [['owner_id', 'eq', 'owner-1'], ['id', 'gt', id(999)]],
    ]);
    // Newest first, as the workspace had them before: the task the phone wrote last is at the front.
    const moments = tasks.map(row => String(row.updated_at));
    expect([...moments].sort().reverse()).toEqual(moments);
    expect(tasks[0].id).toBe(id(1_200));
    // A task written before its page was read is there with what the phone wrote.
    expect((tasks.find(row => row.id === id(1_201))!.item_data as Row).percentComplete).toBe(50);
  });

  it('a task deleted and a task added on another device between two pages do not fail the refresh, and no other task is left out', async () => {
    const cloud = workspaceWith(1_100);
    cloud.onRequest((asked, nth) => {
      if (asked.table !== 'schedule_items' || nth !== 1) return;
      const rows = cloud.rows('schedule_items');
      rows.splice(rows.findIndex(row => row.id === id(3)), 1);
      rows.splice(rows.findIndex(row => row.id === id(700)), 1);
      rows.push({ owner_id: 'owner-1', id: 'task-00600-added', updated_at: stamp(9_000), item_data: { id: 'task-00600-added' } });
    });

    const rows = await createDAVEWebSupabaseGateway(cloud.client).loadAuthorizedRows();

    const ids = (rows.scheduleItems as Row[]).map(row => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Every task that was in the cloud for the whole of the read is there.
    for (let index = 0; index < 1_100; index += 1) {
      if (index !== 3 && index !== 700) expect(ids).toContain(id(index));
    }
    expect(ids).not.toContain(id(700));
    expect(ids).toContain('task-00600-added');
    expect(ids[0]).toBe('task-00600-added');
  });

  it('projects and field updates come back newest created first; a list that fits one page is one request', async () => {
    const cloud = standInCloud();
    cloud.rows('projects').push(
      { owner_id: 'owner-1', id: 'project-a', name: 'Older', created_at: '2026-09-01T08:00:00.000000+00:00' },
      { owner_id: 'owner-1', id: 'project-b', name: 'Newest', created_at: '2026-10-01T08:00:00.000000+00:00' },
      { owner_id: 'owner-1', id: 'project-c', name: 'Middle', created_at: '2026-09-15T08:00:00.000000+00:00' },
    );
    cloud.rows('project_updates').push(
      { owner_id: 'owner-1', id: 'update-a', created_at: '2026-10-02T08:00:00.000100+00:00' },
      { owner_id: 'owner-1', id: 'update-b', created_at: '2026-10-02T08:00:00.000900+00:00' },
    );

    const rows = await createDAVEWebSupabaseGateway(cloud.client).loadAuthorizedRows();

    expect((rows.projects as Row[]).map(row => row.name)).toEqual(['Newest', 'Middle', 'Older']);
    expect((rows.projectUpdates as Row[]).map(row => row.id)).toEqual(['update-b', 'update-a']);
    expect(cloud.of('projects')).toHaveLength(1);
    expect(cloud.of('projects')[0].counted).toBe(true);
    expect(cloud.of('project_updates')).toHaveLength(1);
  });

  it('deletion records are read by what they delete (the kind of record, then which), with plain filters, and come back newest first', async () => {
    const cloud = standInCloud();
    // 700 deleted tasks and 450 deleted updates: the first kind runs over a page, the second starts on a later one.
    for (let index = 0; index < 700; index += 1) {
      cloud.rows('dave_sync_tombstones').push({
        owner_id: 'owner-1', entity_type: 'schedule_item', record_id: `gone, "task" ${String(index).padStart(4, '0')}`, deleted_at: stamp(index),
      });
    }
    for (let index = 0; index < 450; index += 1) {
      cloud.rows('dave_sync_tombstones').push({
        owner_id: 'owner-1', entity_type: 'project_update', record_id: `gone-update-${String(index).padStart(4, '0')}`, deleted_at: stamp(5_000 + index),
      });
    }
    // The same record id deleted as two kinds is two records.
    cloud.rows('dave_sync_tombstones').push({
      owner_id: 'owner-1', entity_type: 'reference_document', record_id: 'gone-update-0000', deleted_at: stamp(9_999),
    });
    let tick = 20_000;
    // Another device deletes one more record before every request.
    cloud.onRequest(asked => {
      if (asked.table !== 'dave_sync_tombstones') return;
      cloud.rows('dave_sync_tombstones').push({
        owner_id: 'owner-1', entity_type: 'project_area', record_id: `area-${tick}`, deleted_at: stamp(tick += 1),
      });
    });

    const rows = await createDAVEWebSupabaseGateway(cloud.client).loadAuthorizedRows();

    const records = rows.syncTombstones as Row[];
    const keys = records.map(row => `${row.entity_type}|${row.record_id}`);
    expect(new Set(keys).size).toBe(keys.length);
    // Every record that was there when the read began is in it.
    expect(keys.filter(key => key.startsWith('schedule_item|'))).toHaveLength(700);
    expect(keys.filter(key => key.startsWith('project_update|'))).toHaveLength(450);
    expect(keys).toContain('reference_document|gone-update-0000');
    // Only eq and gt, on the two key columns, and never a value built into a filter string.
    cloud.of('dave_sync_tombstones').forEach(request => {
      expect(request.order).toEqual([['entity_type', true], ['record_id', true]]);
      expect(request.filters[0]).toEqual(['owner_id', 'eq', 'owner-1']);
      request.filters.slice(1).forEach(([column]) => expect(['entity_type', 'record_id']).toContain(column));
    });
    expect(cloud.of('dave_sync_tombstones').some(request =>
      request.filters.some(([column, op, value]) => column === 'record_id' && op === 'gt' && String(value).includes('"task"')))).toBe(true);
    const moments = records.map(row => String(row.deleted_at));
    expect([...moments].sort().reverse()).toEqual(moments);
  });

  it('a document\'s pages are read by page number, each request after the last page read; a page indexed meanwhile shifts nothing', async () => {
    const cloud = standInCloud();
    const page = (number: number) => ({
      owner_id: 'owner-1', document_id: 'doc-1', page_number: number, sheet_number: `A-${number}`, sheet_mapping_status: 'verified', visual_coverage: {},
    });
    // Pages 2..1,150 are indexed; page 1 is indexed while the list is being read.
    for (let number = 2; number <= 1_150; number += 1) cloud.rows('ecos_document_pages').push(page(number));
    cloud.rows('ecos_document_pages').push({ ...page(5), document_id: 'another-document' });
    cloud.onRequest((asked, nth) => {
      if (asked.table === 'ecos_document_pages' && nth === 1) cloud.rows('ecos_document_pages').push(page(1));
    });

    const summary = await createDAVEWebSupabaseGateway(cloud.client).loadAuthorizedDocumentCoverageSummary('doc-1');

    // By offset, a page indexed (or removed) meanwhile moved every later page one place: one came twice, or one was
    // left out. By page number each of the 1,149 pages there throughout is read once.
    expect(summary.indexedPageCount).toBe(1_149);
    expect(summary.verifiedSheetPageCount).toBe(1_149);
    const asked = cloud.of('ecos_document_pages');
    expect(asked.map(request => request.filters.filter(([column]) => column === 'page_number'))).toEqual([
      [],
      [['page_number', 'gt', 501]],
      [['page_number', 'gt', 1_001]],
    ]);
    asked.forEach(request => expect(request.order).toEqual([['page_number', true]]));
  });
});
