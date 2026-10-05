/**
 * Independent review R02 (Build 229), at the cloud's edge: the real
 * SupabaseService reads and writes, run against a stand-in for the database
 * that answers each request from its rows as they are at that moment (filter,
 * order, count, range), so a row can move between two pages of one read.
 *
 * - this account's lists ask for an exact count and are read again when a row
 *   repeats or the count does not match; a list that keeps changing is not ok;
 * - records are read by their ids a hundred to a request;
 * - a task can be written only if the cloud has no row for it.
 * Synthetic data only.
 */
import type { ScheduleItem } from '../../types';

type Row = Record<string, any>;
const mockTables: Record<string, Row[]> = {};
type MockRequest = { table: string; op: 'select' | 'upsert'; range: [number, number] | null; count: boolean; ids: number; options: unknown };
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
    const request: MockRequest = { table, op: 'select', range: null, count: false, ids: 0, options: null };
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
      eq: (column: string, value: unknown) => { filters.push(row => row[column] === value); return builder; },
      in: (column: string, values: unknown[]) => { request.ids = values.length; filters.push(row => values.includes(row[column])); return builder; },
      order: (column: string, options?: { ascending?: boolean }) => { orders.push({ column, ascending: options?.ascending !== false }); return builder; },
      range: (from: number, to: number) => { request.range = [from, to]; return builder; },
      upsert: (next: Row | Row[], options?: unknown) => { request.op = 'upsert'; payload = next; request.options = options ?? null; return builder; },
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

describe('independent review R02: the cloud reads behind Full Sync', () => {
  const originalUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const originalAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  let service: typeof import('../../services/SupabaseService');
  let absence: typeof import('../../services/CloudListAbsenceCheck');
  let pagination: typeof import('../../services/SupabaseCollectionPagination');

  beforeAll(() => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
    service = require('../../services/SupabaseService');
    absence = require('../../services/CloudListAbsenceCheck');
    pagination = require('../../services/SupabaseCollectionPagination');
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

  it('the reviewer\'s reproduction: a task edited between two pages is in the list the phone gets, once', async () => {
    mockTables.schedule_items = Array.from({ length: 501 }, (_, index) => taskRow(index));
    // After the first page, another device sets the task on the second page to 80% with a note.
    mockHooks.before = (request, index) => {
      if (index !== 2) return;
      const row = mockTables.schedule_items.find(candidate => candidate.id === taskId(500))!;
      row.item_data = task(500, { percentComplete: 80, notes: 'Inspector Thursday' });
      row.updated_at = NOW;
    };

    const result = await service.listScheduleItems();

    expect(result.ok).toBe(true);
    const listed = result.data as ScheduleItem[];
    expect(listed).toHaveLength(501);
    expect(new Set(listed.map(item => item.id)).size).toBe(501);
    expect(listed.find(item => item.id === taskId(500))).toMatchObject({ percentComplete: 80, notes: 'Inspector Thursday' });
    // The first read repeated a row on its second page; the list was read again.
    expect(pages('schedule_items').map(request => request.range![0])).toEqual([0, 500, 0, 500]);
    // Each read asks for the exact count with its first page.
    expect(pages('schedule_items').map(request => request.count)).toEqual([true, false, true, false]);
  });

  it('a task deleted between two pages: the task that slid across the boundary is still in the list', async () => {
    mockTables.schedule_items = Array.from({ length: 501 }, (_, index) => taskRow(index));
    mockHooks.before = (_request, index) => {
      if (index === 2) mockTables.schedule_items.splice(mockTables.schedule_items.findIndex(row => row.id === taskId(10)), 1);
    };

    const result = await service.listScheduleItems();

    expect(result.ok).toBe(true);
    const ids = (result.data as ScheduleItem[]).map(item => item.id);
    expect(ids).toHaveLength(500);
    expect(ids).toContain(taskId(500));
    expect(ids).not.toContain(taskId(10));
  });

  it('a list that keeps changing is not ok: the phone is told, and is given no rows to decide from', async () => {
    mockTables.schedule_items = Array.from({ length: 501 }, (_, index) => taskRow(index));
    let edits = 0;
    mockHooks.before = request => {
      if (request.table !== 'schedule_items' || request.range?.[0] !== 500) return;
      // The oldest task (the one left for the second page) is edited before that page is read.
      const oldest = [...mockTables.schedule_items].sort((left, right) => (left.updated_at < right.updated_at ? -1 : 1))[0];
      oldest.updated_at = new Date(Date.parse(NOW) + (edits += 1) * 1000).toISOString();
    };

    const result = await service.listScheduleItems();

    expect(result).toMatchObject({ ok: false, data: null, error: pagination.SUPABASE_COLLECTION_CHANGED_WHILE_READ });
    expect(pages('schedule_items')).toHaveLength(pagination.SUPABASE_COLLECTION_READ_ATTEMPTS * 2);
  });

  it('GPS areas, field updates and both project lists ask for the exact count too', async () => {
    await service.listProjectAreas();
    await service.listProjectUpdates();
    await service.listProjects();
    await service.listArchivedProjects();
    expect(mockRequests.map(request => [request.table, request.count])).toEqual([
      ['project_areas', true], ['project_updates', true], ['projects', true], ['projects', true],
    ]);
  });

  it('deletion records have no id: one seen twice is told by what it deletes, and the list is read again', async () => {
    mockTables.dave_sync_tombstones = Array.from({ length: 501 }, (_, index) => ({
      owner_id: 'owner-1', entity_type: 'schedule_item', record_id: taskId(index),
      deleted_at: new Date(Date.parse('2026-09-01T00:00:00.000Z') - index * 1000).toISOString(),
    }));
    // A deletion recorded again on another device moves its record to the front between the two pages.
    mockHooks.before = (_request, index) => {
      if (index === 2) mockTables.dave_sync_tombstones.find(row => row.record_id === taskId(500))!.deleted_at = NOW;
    };

    const result = await service.listDAVESyncTombstones();

    expect(result.ok).toBe(true);
    expect(result.data).toHaveLength(501);
    expect(new Set(result.data!.map(tombstone => tombstone.recordId)).size).toBe(501);
    expect(pages('dave_sync_tombstones')).toHaveLength(4);
  });

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
});
