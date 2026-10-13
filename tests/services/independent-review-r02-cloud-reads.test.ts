/**
 * Independent review R02 (Build 229) and pass 2 (items 1 and 4), at the
 * cloud's edge: the real SupabaseService reads and writes, run against a
 * stand-in for the database that answers each request from its rows as they
 * are at that moment (filters, order, count, row window), so another device
 * can write between two pages of one read, or between a read and a write.
 *
 * - this account's lists are read by key (each page asks for the rows after
 *   the last id of the page before): an edit elsewhere can neither repeat a
 *   row nor hide one, and nothing is read again; they come back newest first
 *   as before; the count asked for with the first page never fails the read;
 * - records are read by their ids a hundred to a request;
 * - a task or GPS area can be written only if the cloud has no row for it, or
 *   only if the cloud's row is still the version that was read.
 * Synthetic data only.
 */
import type { ScheduleItem } from '../../types';

type Row = Record<string, any>;
const mockTables: Record<string, Row[]> = {};
type MockRequest = {
  table: string; op: 'select' | 'upsert' | 'update'; range: [number, number] | null; count: boolean; ids: number; options: unknown;
  /** The filters as asked: `column op value`. */
  filters: string[]; order: string[];
};
const mockRequests: MockRequest[] = [];
const mockHooks: { before: ((request: MockRequest, index: number) => void) | null } = { before: null };
const mockSession = { access_token: 'session-token', user: { id: 'owner-1' }, expires_at: Math.floor(Date.now() / 1000) + 3600 };

const mockSupabaseClient = {
  auth: {
    getSession: jest.fn(async () => ({ data: { session: mockSession }, error: null })),
    onAuthStateChange: jest.fn(),
    startAutoRefresh: jest.fn(),
    stopAutoRefresh: jest.fn(),
  },
  from: jest.fn((table: string) => {
    const filters: Array<(row: Row) => boolean> = [];
    const orders: Array<{ column: string; ascending: boolean }> = [];
    const request: MockRequest = { table, op: 'select', range: null, count: false, ids: 0, options: null, filters: [], order: [] };
    let payload: Row | Row[] | null = null;
    let one: 'single' | 'maybeSingle' | null = null;
    const run = () => {
      mockRequests.push(request);
      mockHooks.before?.(request, mockRequests.length);
      const rows = (mockTables[table] ||= []);
      if (request.op === 'upsert') {
        const written: Row[] = [];
        (Array.isArray(payload) ? payload : [payload as Row]).forEach(next => {
          const index = rows.findIndex(row => row.id === next.id);
          if (index >= 0 && (request.options as { ignoreDuplicates?: boolean } | null)?.ignoreDuplicates) return;
          const copy = JSON.parse(JSON.stringify(next)) as Row;
          if (index >= 0) rows[index] = copy; else rows.push(copy);
          written.push(copy);
        });
        if (one) return written[0] ? { data: written[0], error: null, status: 201 } : { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned' }, status: 406 };
        return { data: written, error: null, status: 201 };
      }
      const matching = rows.filter(row => filters.every(filter => filter(row)));
      if (request.op === 'update') {
        // A conditional write: only the rows every filter still matches are changed, in one step.
        matching.forEach(row => Object.assign(row, JSON.parse(JSON.stringify(payload))));
        return { data: matching.map(row => ({ ...row })), error: null, status: 200 };
      }
      const ordered = [...matching].sort((left, right) => {
        for (const { column, ascending } of orders) {
          if (left[column] === right[column]) continue;
          return (left[column] < right[column] ? -1 : 1) * (ascending ? 1 : -1);
        }
        return 0;
      });
      const page = request.range ? ordered.slice(request.range[0], request.range[1] + 1) : ordered;
      if (one) return { data: page[0] ?? null, error: null, status: 200 };
      return { data: page.map(row => ({ ...row })), error: null, status: 200, count: request.count ? matching.length : null };
    };
    const builder: Record<string, any> = {
      select: (_columns?: string, options?: { count?: string }) => { if (request.op === 'select') request.count = options?.count === 'exact'; return builder; },
      eq: (column: string, value: unknown) => { request.filters.push(`${column} eq ${String(value)}`); filters.push(row => row[column] === value); return builder; },
      gt: (column: string, value: any) => { request.filters.push(`${column} gt ${String(value)}`); filters.push(row => row[column] > value); return builder; },
      in: (column: string, values: unknown[]) => { request.ids = values.length; filters.push(row => values.includes(row[column])); return builder; },
      order: (column: string, options?: { ascending?: boolean }) => { request.order.push(column); orders.push({ column, ascending: options?.ascending !== false }); return builder; },
      range: (from: number, to: number) => { request.range = [from, to]; return builder; },
      upsert: (next: Row | Row[], options?: unknown) => { request.op = 'upsert'; payload = next; request.options = options ?? null; return builder; },
      update: (next: Row) => { request.op = 'update'; payload = next; return builder; },
      single: () => { one = 'single'; return builder; },
      maybeSingle: () => { one = 'maybeSingle'; return builder; },
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve().then(run).then(resolve, reject),
    };
    return builder;
  }),
};

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => mockSupabaseClient) }));
jest.mock('react-native-url-polyfill/auto', () => ({}));
jest.mock('expo-crypto', () => ({ randomUUID: () => `uuid-${Math.random().toString(16).slice(2)}` }));
jest.mock('expo-file-system/legacy', () => ({ getInfoAsync: jest.fn(), readAsStringAsync: jest.fn(), EncodingType: { Base64: 'base64' } }));
jest.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: jest.fn() },
  NativeModules: {},
  Platform: { OS: 'ios', select: (values: Record<string, unknown>) => values.ios ?? values.native ?? values.default },
  TurboModuleRegistry: { get: jest.fn(() => null) },
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined) },
}));
jest.mock('../../services/SupabaseAuthStorage', () => ({
  isAuthStorageSecure: jest.fn(async () => true),
  supabaseSecureAuthStorage: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined) },
}));
jest.mock('../../services/ResumableStorageUpload', () => ({ RESUMABLE_UPLOAD_THRESHOLD_BYTES: 6 * 1024 * 1024, uploadFileResumably: jest.fn() }));
jest.mock('../../services/DAVEWebSupabaseClient', () => ({ daveWebSupabaseGateway: { loadAuthorizedRows: jest.fn() } }));

const PROJECT_ID = '607c7eed-5dea-4a5a-8b52-0f165c71c4b5';
const taskId = (index: number) => `task-${String(index).padStart(4, '0')}`;
const task = (index: number, patch: Partial<ScheduleItem> = {}): ScheduleItem => ({
  id: taskId(index), itemType: 'Task', projectId: PROJECT_ID, projectName: 'Alpha', scheduleProjectName: 'Alpha', locationName: 'Lot',
  taskName: `Task ${index}`, startDate: '10/15/2026', finishDate: '10/25/2026', milestone: '', owner: '', contractor: '',
  percentComplete: 0, status: 'Not Started', priority: 'Medium', notes: '', createdAt: '2026-09-01T08:00:00.000Z',
  ...patch,
} as ScheduleItem);
/** A task row; the higher its number, the older its updated_at, so the further down the newest-first list. */
const taskRow = (index: number, owner = 'owner-1', patch: Partial<ScheduleItem> = {}): Row => ({
  id: taskId(index), owner_id: owner, project_id: PROJECT_ID, project_name: 'Alpha', task_name: `Task ${index}`,
  item_data: task(index, patch), updated_at: new Date(Date.parse('2026-09-01T00:00:00.000Z') - index * 1000).toISOString(),
});
const NOW = '2026-10-05T12:00:00.000Z';

describe('independent review R02 and pass 2: the cloud reads and writes behind the sync', () => {
  const originalUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const originalAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  let service: typeof import('../../services/SupabaseService');
  let absence: typeof import('../../services/CloudListAbsenceCheck');
  let versions: typeof import('../../services/CloudRowVersion');

  beforeAll(() => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
    service = require('../../services/SupabaseService');
    absence = require('../../services/CloudListAbsenceCheck');
    versions = require('../../services/CloudRowVersion');
  });
  afterAll(() => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = originalUrl;
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = originalAnonKey;
  });
  beforeEach(() => {
    Object.keys(mockTables).forEach(table => { delete mockTables[table]; });
    mockRequests.length = 0;
    mockHooks.before = null;
  });
  const pages = (table: string) => mockRequests.filter(request => request.table === table && request.range);
  /** Another device writes a task's row: new content, and the row's updated_at with it, as every writer sets it. */
  const anotherDeviceWrites = (index: number, patch: Partial<ScheduleItem>, at: string) => {
    const row = mockTables.schedule_items.find(candidate => candidate.id === taskId(index))!;
    row.item_data = task(index, patch);
    row.updated_at = at;
  };

  /* Lists, read by key ------------------------------------------------------------------------------------------ */

  it('the reviewer\'s reproduction: a task edited between two pages is in the list once, with the edit, and nothing is read again', async () => {
    mockTables.schedule_items = Array.from({ length: 501 }, (_, index) => taskRow(index));
    // After the first page, another device sets the last task to 80% with a note.
    mockHooks.before = (_request, index) => { if (index === 2) anotherDeviceWrites(500, { percentComplete: 80, notes: 'Inspector Thursday' }, NOW); };

    const result = await service.listScheduleItems();

    expect(result.ok).toBe(true);
    const listed = result.data as ScheduleItem[];
    expect(listed).toHaveLength(501);
    expect(new Set(listed.map(item => item.id)).size).toBe(501);
    expect(listed.find(item => item.id === taskId(500))).toMatchObject({ percentComplete: 80, notes: 'Inspector Thursday' });
    // Two requests: the first 500 rows in the order of their ids, with the count; then the rows after the last id.
    expect(pages('schedule_items').map(request => [request.order, request.range, request.count, request.filters.filter(filter => filter.includes(' gt '))])).toEqual([
      [['id'], [0, 499], true, []],
      [['id'], [0, 499], false, [`id gt ${taskId(499)}`]],
    ]);
    // Newest first, as the list always was: the task just edited leads, then the rest as before.
    expect(listed.slice(0, 3).map(item => item.id)).toEqual([taskId(500), taskId(0), taskId(1)]);
  });

  it('the everyday case: while another device sends task after task, the list is read whole, once', async () => {
    mockTables.schedule_items = Array.from({ length: 1200 }, (_, index) => taskRow(index));
    let sent = 0;
    // An approved schedule going up from another device: a task written before each of this read's requests.
    mockHooks.before = request => {
      if (request.table !== 'schedule_items') return;
      sent += 1;
      anotherDeviceWrites(1199 - sent * 100, { notes: `row ${sent} of the new master` }, new Date(Date.parse(NOW) + sent * 1000).toISOString());
    };

    const result = await service.listScheduleItems();

    expect(result.ok).toBe(true);
    expect(new Set((result.data as ScheduleItem[]).map(item => item.id)).size).toBe(1200);
    expect(pages('schedule_items')).toHaveLength(3);
  });

  it('a task deleted, and one added, between two pages: the read is not failed by the count, and no other task is left out', async () => {
    mockTables.schedule_items = Array.from({ length: 501 }, (_, index) => taskRow(index));
    mockHooks.before = (_request, index) => {
      if (index !== 2) return;
      mockTables.schedule_items.splice(mockTables.schedule_items.findIndex(row => row.id === taskId(10)), 1);
      mockTables.schedule_items.push(taskRow(9000));
    };

    const result = await service.listScheduleItems();

    expect(result.ok).toBe(true);
    const ids = (result.data as ScheduleItem[]).map(item => item.id);
    // Everything in the cloud at the end is there; the task deleted after it was read is there too.
    expect([...ids].sort()).toEqual([...mockTables.schedule_items.map(row => row.id), taskId(10)].sort());
  });

  it('GPS areas, field updates and both project lists are read the same way, with the count on their first page', async () => {
    await service.listProjectAreas();
    await service.listProjectUpdates();
    await service.listProjects();
    await service.listArchivedProjects();
    expect(mockRequests.map(request => [request.table, request.order, request.range, request.count])).toEqual([
      ['project_areas', ['id'], [0, 499], true], ['project_updates', ['id'], [0, 499], true],
      ['projects', ['id'], [0, 499], true], ['projects', ['id'], [0, 499], true],
    ]);
  });

  it('projects and field updates come back newest created first, as before', async () => {
    mockTables.projects = [
      { id: 'b', owner_id: 'owner-1', name: 'Bravo', archived: false, created_at: '2026-09-02T00:00:00+00:00' },
      { id: 'a', owner_id: 'owner-1', name: 'Alpha', archived: false, created_at: '2026-09-03T00:00:00+00:00' },
      { id: 'c', owner_id: 'owner-1', name: 'Closed', archived: true, created_at: '2026-09-04T00:00:00+00:00' },
    ];
    mockTables.project_updates = [
      { id: 'u1', owner_id: 'owner-1', created_at: '2026-09-01T10:00:00.000001+00:00', update_data: {} },
      { id: 'u2', owner_id: 'owner-1', created_at: '2026-09-01T10:00:00.000002+00:00', update_data: {} },
    ];
    expect((await service.listProjects()).data!.map(project => project.name)).toEqual(['Alpha', 'Bravo']);
    expect((await service.listArchivedProjects()).data!.map(project => project.name)).toEqual(['Closed']);
    expect((await service.listProjectUpdates()).data!.map(update => update.id)).toEqual(['u2', 'u1']);
  });

  it('deletion records are read by what they delete, with plain filters, and come back newest first', async () => {
    const deleted = (entityType: string, recordId: string, index: number) => ({
      owner_id: 'owner-1', entity_type: entityType, record_id: recordId,
      deleted_at: new Date(Date.parse('2026-09-01T00:00:00.000Z') - index * 1000).toISOString(),
    });
    mockTables.dave_sync_tombstones = [
      ...Array.from({ length: 501 }, (_, index) => deleted('schedule_item', taskId(index), index)),
      deleted('project', 'Lot 5, North (East)', 600), deleted('reference_document', 'doc-1', 601), deleted('project_area', 'area-1', 602),
      // The same id deleted as two kinds of record is two records: the key is the kind and the id together.
      deleted('project_update', 'doc-1', 603),
    ];
    // A deletion recorded again on another device between two pages: its time changes, its key does not.
    mockHooks.before = (_request, index) => {
      if (index === 2) mockTables.dave_sync_tombstones.find(row => row.record_id === taskId(500))!.deleted_at = NOW;
    };

    const result = await service.listDAVESyncTombstones();

    expect(result.ok).toBe(true);
    expect(result.data).toHaveLength(505);
    expect(new Set(result.data!.map(tombstone => `${tombstone.entityType}/${tombstone.recordId}`)).size).toBe(505);
    expect(result.data!.filter(tombstone => tombstone.recordId === 'doc-1').map(tombstone => tombstone.entityType).sort()).toEqual(['project_update', 'reference_document']);
    expect(result.data![0]).toEqual({ entityType: 'schedule_item', recordId: taskId(500), deletedAt: NOW });
    // After the first page: the rest of that kind after its last record, then the kinds beyond it. No "or", no quoting.
    const placed = pages('dave_sync_tombstones').map(request => request.filters.filter(filter => !filter.startsWith('owner_id')));
    expect(placed[0]).toEqual([]);
    placed.slice(1).forEach(filters => expect(filters.map(filter => filter.split(' ')[1])).toEqual(expect.arrayContaining(['gt'])));
    expect(placed.flat().every(filter => /^(entity_type|record_id) (eq|gt) /.test(filter))).toBe(true);
  });

  // Sync batch Y1 (item 2): the deletion history asked again for just the records a sync is about to create.
  it('the deletion records of named records are read by their ids: this account\'s, of that kind, a hundred ids to a request, in either letter case', async () => {
    const deleted = (owner: string, entityType: string, recordId: string) => ({ owner_id: owner, entity_type: entityType, record_id: recordId, deleted_at: NOW });
    mockTables.dave_sync_tombstones = [
      deleted('owner-1', 'schedule_item', taskId(3)),
      deleted('owner-1', 'schedule_item', 'master f-9'),     // written by a device that keeps ids in lower case
      deleted('owner-1', 'project_area', taskId(4)),          // another kind of record with that id
      deleted('owner-2', 'schedule_item', taskId(5)),         // another account's
      deleted('owner-1', 'schedule_item', taskId(900)),       // not asked about
    ];

    const result = await service.listDAVESyncTombstonesForRecords('schedule_item', [taskId(3), taskId(4), taskId(5), 'MASTER F-9', ' ', taskId(3)]);

    expect(result.ok).toBe(true);
    expect(result.data).toEqual([
      { entityType: 'schedule_item', recordId: taskId(3), deletedAt: NOW },
      { entityType: 'schedule_item', recordId: 'master f-9', deletedAt: NOW },
    ]);
    const askedOf = () => mockRequests.filter(request => request.table === 'dave_sync_tombstones');
    const [asked] = askedOf();
    expect(askedOf()).toHaveLength(1);
    expect(asked.filters).toEqual(['owner_id eq owner-1', 'entity_type eq schedule_item']);
    // Each id once as given and once in lower case, where that differs.
    expect(asked.ids).toBe(5);

    // 150 ids: two requests, a hundred ids at most in each.
    mockRequests.length = 0;
    const many = await service.listDAVESyncTombstonesForRecords('schedule_item', Array.from({ length: 150 }, (_, index) => taskId(index)));
    expect(many.data).toEqual([{ entityType: 'schedule_item', recordId: taskId(3), deletedAt: NOW }]);
    expect(askedOf().map(request => request.ids)).toEqual([100, 50]);

    // Nothing to ask about: no request.
    mockRequests.length = 0;
    await expect(service.listDAVESyncTombstonesForRecords('schedule_item', [])).resolves.toMatchObject({ ok: true, data: [] });
    expect(mockRequests).toEqual([]);
  });

  it('judgments and decisions are read by their ids and come back in the order they had: newest first, a decision\'s versions by number', async () => {
    const scope = { organization_id: 'org-1', project_id: 'p-1' };
    mockTables.pie_executive_judgments = [
      // The newest judgment is not the first by id.
      { id: 'j-b', ...scope, judgment_time: '2026-09-03T00:00:00+00:00' },
      { id: 'j-a', ...scope, judgment_time: '2026-09-02T00:00:00+00:00' },
      { id: 'j-z', organization_id: 'org-1', project_id: 'p-2', judgment_time: '2026-09-09T00:00:00+00:00' },
    ];
    mockTables.pie_decision_records = [
      { id: 'd-1', ...scope, created_at: '2026-09-01T00:00:00+00:00' },
      { id: 'd-2', ...scope, created_at: '2026-09-05T00:00:00+00:00' },
    ];
    mockTables.pie_decision_versions = [
      { id: 12, decision_id: 'd-1', ...scope, version: 10 }, { id: 3, decision_id: 'd-1', ...scope, version: 9 }, { id: 7, decision_id: 'd-2', ...scope, version: 1 },
    ];
    mockTables.pie_decision_outcomes = [];
    mockTables.pie_decision_audit_events = [
      { id: 'e-2', decision_id: 'd-1', ...scope, created_at: '2026-09-02T00:00:00+00:00', event_type: 'second' },
      { id: 'e-9', decision_id: 'd-1', ...scope, created_at: '2026-09-01T12:00:00+00:00', event_type: 'first' },
    ];

    const judgments = await service.listPIEExecutiveJudgmentsCloud('org-1', 'p-1');
    expect(judgments.data!.map(judgment => judgment.id)).toEqual(['j-b', 'j-a']);
    expect((await service.getActivePIEExecutiveJudgmentCloud('org-1', 'p-1')).data?.id).toBe('j-b');

    const decisions = await service.listPIEDecisionRecords('org-1', 'p-1');
    expect(decisions.data!.map(decision => decision.id)).toEqual(['d-2', 'd-1']);
    expect(decisions.data![1].versions.map(version => version.version)).toEqual([9, 10]);
    expect(decisions.data![1].auditHistory).toHaveLength(2);
    expect(mockRequests.filter(request => request.table.startsWith('pie_')).every(request => request.order.join() === 'id' && request.range?.join() === '0,499')).toBe(true);
  });

  /* Reads by id --------------------------------------------------------------------------------------------------- */

  it('2,000 tasks are read by their ids in 20 requests, this account\'s rows only', async () => {
    mockTables.schedule_items = [
      ...Array.from({ length: 1500 }, (_, index) => taskRow(index)),
      taskRow(1700, 'another-owner'),
    ];
    const ids = Array.from({ length: 2000 }, (_, index) => taskId(index));

    const result = await service.getScheduleItemsByIds(ids);

    expect(result.ok).toBe(true);
    expect(result.data).toHaveLength(1500);
    expect(result.data![0]).toEqual(task(0));
    expect(mockRequests).toHaveLength(20);
    expect(mockRequests.every(request => request.ids === 100 && request.range === null)).toBe(true);
  });

  it('GPS areas and projects are read by their ids the same way', async () => {
    mockTables.project_areas = [{ id: 'area-1', owner_id: 'owner-1', name: 'North Lot', area_data: { id: 'area-1', name: 'North Lot', latitude: 33.9 } }];
    mockTables.projects = [{ id: 'p-2', owner_id: 'owner-1', name: 'Bravo', archived: true }];

    expect((await service.getProjectAreasByIds(['area-1', 'area-2'])).data).toEqual([{ id: 'area-1', name: 'North Lot', latitude: 33.9 }]);
    expect((await service.getProjectsByIds(['p-1', 'p-2'])).data).toEqual([expect.objectContaining({ id: 'p-2', name: 'Bravo', archived: true })]);
    // No ids: nothing is asked.
    mockRequests.length = 0;
    expect((await service.getScheduleItemsByIds([])).data).toEqual([]);
    expect(mockRequests).toEqual([]);
  });

  /* Writes -------------------------------------------------------------------------------------------------------- */

  it('a task written only if the cloud has none: a row that is there is left exactly as it is', async () => {
    const theirs = taskRow(7, 'owner-1', { percentComplete: 80, notes: 'Inspector Thursday' });
    mockTables.schedule_items = [theirs];

    const refused = await service.upsertScheduleItem(task(7), { onlyIfAbsent: true });

    expect(refused).toMatchObject({ ok: false, code: absence.SCHEDULE_ITEM_ALREADY_IN_CLOUD, status: 409 });
    expect(mockTables.schedule_items).toEqual([theirs]);
    expect(mockRequests.filter(request => request.op === 'upsert').map(request => request.options)).toEqual([{ ignoreDuplicates: true }]);

    // A task the cloud has no row for is written and acknowledged.
    const written = await service.upsertScheduleItem(task(8, { notes: 'New on the phone' }), { onlyIfAbsent: true });
    expect(written.ok).toBe(true);
    expect(mockTables.schedule_items.find(row => row.id === taskId(8))!.item_data).toMatchObject({ notes: 'New on the phone' });
  });

  it('the ordinary task write is as it was: one upsert, no options', async () => {
    mockTables.schedule_items = [taskRow(7)];
    const result = await service.upsertScheduleItem(task(7, { notes: 'Edited' }));
    expect(result.ok).toBe(true);
    expect(mockRequests.filter(request => request.op === 'upsert').map(request => request.options)).toEqual([null]);
    expect(mockTables.schedule_items[0].item_data).toMatchObject({ notes: 'Edited' });
  });

  it('every way of reading a task gives its row\'s version, beside the record and never in it', async () => {
    mockTables.schedule_items = [taskRow(7), taskRow(8)];
    const stamp = (index: number) => mockTables.schedule_items.find(row => row.id === taskId(index))!.updated_at;

    const listed = (await service.listScheduleItems()).data!.find(item => item.id === taskId(7))!;
    const one = (await service.getScheduleItem(taskId(7))).data!;
    const several = (await service.getScheduleItemsByIds([taskId(7), taskId(8)])).data!;

    expect([listed, one, several[0]].map(versions.cloudRowVersionOf)).toEqual([stamp(7), stamp(7), stamp(7)]);
    expect(versions.cloudRowVersionOf(several[1])).toBe(stamp(8));
    // The record is the task as the cloud holds it, nothing added: it is compared and saved as that.
    expect(listed).toEqual(task(7));
    expect(JSON.stringify(one)).toBe(JSON.stringify(task(7)));
    // A copy of a record is a new record: its version is not known, and it is written as before.
    expect(versions.cloudRowVersionOf({ ...listed })).toBeNull();
  });

  it('a task written only if its row is still the one that was read: another device\'s write since is left exactly as it is', async () => {
    mockTables.schedule_items = [taskRow(7)];
    const read = (await service.getScheduleItem(taskId(7))).data!;
    const asRead = versions.cloudRowVersionOf(read)!;
    // The other device sets the owner after this device read the row.
    anotherDeviceWrites(7, { owner: 'Mike' }, NOW);
    const theirs = JSON.parse(JSON.stringify(mockTables.schedule_items[0]));
    mockRequests.length = 0;

    const refused = await service.upsertScheduleItem({ ...read, notes: 'Typed on this device' }, { ifUnchangedSince: asRead });

    expect(refused).toMatchObject({ ok: false, code: versions.CLOUD_ROW_CHANGED_SINCE_READ, status: 409 });
    expect(mockTables.schedule_items).toEqual([theirs]);
    // One request, an update that names the version it expects: there is no moment between a check and the write.
    expect(mockRequests.map(request => [request.op, request.filters])).toEqual([
      ['update', ['owner_id eq owner-1', `id eq ${taskId(7)}`, `updated_at eq ${asRead}`]],
    ]);

    // Read again and weighed against the row as it is, the write lands, and says which version the row now is.
    const again = (await service.getScheduleItem(taskId(7))).data!;
    const written = await service.upsertScheduleItem({ ...again, notes: 'Typed on this device' }, { ifUnchangedSince: versions.cloudRowVersionOf(again) });
    expect(written.ok).toBe(true);
    expect(mockTables.schedule_items[0].item_data).toMatchObject({ owner: 'Mike', notes: 'Typed on this device' });
    expect(versions.cloudRowVersionOf(written.data)).toBe(mockTables.schedule_items[0].updated_at);
    // The version it was read as is spent.
    expect((await service.upsertScheduleItem({ ...again, notes: 'again' }, { ifUnchangedSince: versions.cloudRowVersionOf(again) })).code)
      .toBe(versions.CLOUD_ROW_CHANGED_SINCE_READ);
  });

  it('a GPS area is written under the same two conditions, and plainly without them', async () => {
    const areaRow = (latitude: number, at: string) => ({ id: 'area-1', owner_id: 'owner-1', name: 'North Lot', area_data: { id: 'area-1', name: 'North Lot', latitude }, updated_at: at });
    mockTables.project_areas = [areaRow(33.9, '2026-09-09T12:00:00+00:00')];
    const read = (await service.getProjectAreasByIds(['area-1'])).data![0];
    expect(versions.cloudRowVersionOf(read)).toBe('2026-09-09T12:00:00+00:00');
    mockTables.project_areas[0] = areaRow(35.1, NOW); // another device captures a point

    const mine = { ...read, latitude: 34 } as typeof read;
    expect((await service.upsertProjectArea(mine, { ifUnchangedSince: versions.cloudRowVersionOf(read) })).code).toBe(versions.CLOUD_ROW_CHANGED_SINCE_READ);
    expect((await service.upsertProjectArea(mine, { onlyIfAbsent: true })).code).toBe(versions.CLOUD_ROW_CHANGED_SINCE_READ);
    expect(mockTables.project_areas[0].area_data.latitude).toBe(35.1);

    const written = await service.upsertProjectArea(mine, { ifUnchangedSince: NOW });
    expect(written.ok).toBe(true);
    expect(mockTables.project_areas[0].area_data.latitude).toBe(34);
    expect(versions.cloudRowVersionOf(written.data)).toBe(mockTables.project_areas[0].updated_at);

    // A new area written only if there is none; and the plain write, as before: one upsert, no options.
    expect((await service.upsertProjectArea({ ...mine, id: 'area-2' }, { onlyIfAbsent: true })).ok).toBe(true);
    mockRequests.length = 0;
    expect((await service.upsertProjectArea({ ...mine, latitude: 36 })).ok).toBe(true);
    expect(mockRequests.map(request => [request.op, request.options])).toEqual([['upsert', null]]);
  });
});
