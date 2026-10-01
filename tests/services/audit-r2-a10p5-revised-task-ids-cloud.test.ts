/**
 * Audit round 2, A10 pass 5 M1 (30 Sep 2026), persistence: the ids a task
 * had before a new master moved it (revisedFromTaskIds) reach every device.
 * They live in the task's JSON record, as lookaheadOverlay does: the phone's
 * upsert writes the whole record to schedule_items.item_data and its read
 * returns it, a web edit keeps it (the web rebuilds the record field by
 * field), sync keeps every id either copy knows, and the web's read keeps
 * it. No schema change.
 * These tests run the real SupabaseService write and read against a mocked
 * client, and the web read against mocked rows. Synthetic data only.
 */
import type { ScheduleItem } from '../../types';

type Row = { id: string; owner_id: string; item_data: unknown; updated_at: string };
const mockRows = new Map<string, Row>();
const mockSession = {
  access_token: 'session-token',
  user: { id: 'owner-1' },
  expires_at: Math.floor(Date.now() / 1000) + 3600,
};

const mockSupabaseClient = {
  auth: {
    getSession: jest.fn(async () => ({ data: { session: mockSession }, error: null })),
    onAuthStateChange: jest.fn(),
    startAutoRefresh: jest.fn(),
    stopAutoRefresh: jest.fn(),
  },
  from: jest.fn((table: string) => {
    let written: Row | null = null;
    let readId: string | null = null;
    const builder: Record<string, jest.Mock> = {};
    builder.upsert = jest.fn((payload: Row) => {
      written = { ...payload, item_data: JSON.parse(JSON.stringify(payload.item_data)) };
      mockRows.set(payload.id, written);
      return builder;
    });
    builder.select = jest.fn(() => builder);
    builder.order = jest.fn(() => builder);
    builder.eq = jest.fn((column: string, value: string) => {
      if (column === 'id') readId = value;
      return builder;
    });
    builder.single = jest.fn(async () => ({ data: written && { id: written.id, item_data: written.item_data }, error: null, status: 201 }));
    builder.maybeSingle = jest.fn(async () => {
      const row = readId ? mockRows.get(readId) : null;
      return { data: row ? { id: row.id, item_data: row.item_data } : null, error: null, status: 200 };
    });
    builder.range = jest.fn(async () => {
      const rows = table === 'schedule_items' ? [...mockRows.values()] : [];
      return { data: rows, error: null, status: 200, count: rows.length };
    });
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
/** Pour slab as the 27 Sep master saved it: it was A, then B. */
const pourC: ScheduleItem = {
  id: 'MASTER 0927-1', projectId: PROJECT_ID, projectName: 'Alpha', scheduleProjectName: 'Alpha', locationName: 'Lot',
  taskName: 'Pour slab', startDate: '09/30/2026', finishDate: '10/02/2026', milestone: '', owner: '', contractor: '',
  percentComplete: 40, status: 'In Progress', priority: 'Medium', notes: '', importBatchId: 'batch-MASTER 0927',
  sourceDocumentId: 'MASTER 0927', importedAt: '2026-09-27T08:00:00.000Z', createdAt: '2026-09-27T08:00:00.000Z',
  revisedFromTaskIds: ['MASTER 0831-1', 'MASTER 0926-1'],
};

describe('A10 pass 5 M1: a moved task\'s earlier ids survive the cloud round trip', () => {
  const originalUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const originalAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  let service: typeof import('../../services/SupabaseService');
  let recovery: typeof import('../../services/DAVEScheduleRecovery');
  let web: typeof import('../../services/DAVEWebReadOnlyRepository');
  let gateway: typeof import('../../services/DAVEWebSupabaseClient');

  beforeAll(() => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
    service = require('../../services/SupabaseService');
    recovery = require('../../services/DAVEScheduleRecovery');
    web = require('../../services/DAVEWebReadOnlyRepository');
    gateway = require('../../services/DAVEWebSupabaseClient');
  });
  afterAll(() => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = originalUrl;
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = originalAnonKey;
  });
  beforeEach(() => mockRows.clear());

  it('the phone writes them in item_data, the cloud acknowledges the exact record, and the phone reads them back', async () => {
    const written = await service.upsertScheduleItem(pourC);
    expect(written).toMatchObject({ ok: true, data: { revisedFromTaskIds: ['MASTER 0831-1', 'MASTER 0926-1'] } });
    expect(mockRows.get(pourC.id)?.item_data).toMatchObject({ revisedFromTaskIds: ['MASTER 0831-1', 'MASTER 0926-1'] });
    const read = await service.listScheduleItems();
    expect(read.ok).toBe(true);
    expect(read.data?.find(item => item.id === pourC.id)?.revisedFromTaskIds).toEqual(['MASTER 0831-1', 'MASTER 0926-1']);
  });

  it('sync keeps every earlier id either copy knows: a copy edited on the web without them does not drop them', () => {
    const { revisedFromTaskIds: _dropped, ...webEdited } = { ...pourC, notes: 'Pump truck booked', updatedAt: '2026-09-28T09:00:00.000Z' };
    const [merged] = recovery.recoverDAVEScheduleRecords({ local: [pourC], cloud: [webEdited as ScheduleItem], allowCloudOnly: true });
    expect(merged).toMatchObject({ notes: 'Pump truck booked', revisedFromTaskIds: ['MASTER 0831-1', 'MASTER 0926-1'] });
    // Two copies that each know a different earlier id keep both, oldest first.
    const [both] = recovery.recoverDAVEScheduleRecords({
      local: [{ ...pourC, revisedFromTaskIds: ['MASTER 0831-1'] }],
      cloud: [{ ...pourC, revisedFromTaskIds: ['MASTER 0926-1'], updatedAt: '2026-09-28T09:00:00.000Z' }],
      allowCloudOnly: true,
    });
    expect(both.revisedFromTaskIds?.slice().sort()).toEqual(['MASTER 0831-1', 'MASTER 0926-1']);
  });

  it('an area-only web edit keeps them (the web builds the record field by field)', () => {
    const editing: typeof import('../../services/DAVEWebTaskEditing') = require('../../services/DAVEWebTaskEditing');
    const edited = editing.buildDAVEWebScheduleItem({
      id: pourC.id, current: { ...pourC, cloudUpdatedAt: 'rev-1' }, actor: 'David', now: '2026-09-28T09:00:00.000Z',
      draft: {
        itemType: 'Task', taskName: pourC.taskName, projectName: 'Alpha', locationName: 'Lot North',
        startDate: pourC.startDate, finishDate: pourC.finishDate, milestone: '', owner: '', contractor: '',
        percentComplete: String(pourC.percentComplete), priority: 'Medium', status: pourC.status, notes: '', nextAction: '', activityMessage: '',
      },
    });
    expect(edited).toMatchObject({ locationName: 'Lot North', revisedFromTaskIds: ['MASTER 0831-1', 'MASTER 0926-1'] });
  });

  it('the web reads them from item_data with the task', async () => {
    jest.mocked(gateway.daveWebSupabaseGateway.loadAuthorizedRows).mockResolvedValue({
      projects: [{ id: 'alpha', name: 'Alpha', archived: false }],
      scheduleItems: [{ id: pourC.id, updated_at: '2026-09-27T08:00:00.000Z', item_data: pourC }],
      projectUpdates: [],
      referenceDocuments: [],
      syncTombstones: [],
    } as never);
    const snapshot = await web.loadDAVEWebReadOnlySnapshot();
    expect(snapshot.scheduleItems.find(item => item.id === pourC.id)?.revisedFromTaskIds).toEqual(['MASTER 0831-1', 'MASTER 0926-1']);
  });
});
