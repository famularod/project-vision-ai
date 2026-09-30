// Owner answer Q16 (30 Sep 2026): the shared "since the last report" period is
// one report_snapshots row per owner, projects and format. These tests run the
// real SupabaseService read and upsert against a mocked client: before the SQL
// is applied the table is missing and the app keeps each device's own period,
// quietly.

type MockResponse = { data?: unknown; error: { message: string } | null; status: number };
const mockSelectFilters: Array<[string, unknown]> = [];
const mockUpserts: Array<{ payload: Record<string, unknown>; options: unknown }> = [];
let mockSelectResponse: MockResponse = { data: null, error: null, status: 200 };
let mockUpsertResponse: MockResponse = { error: null, status: 201 };
let mockSession: Record<string, unknown> | null = null;

const mockSupabaseClient = {
  auth: {
    getSession: jest.fn(async () => ({ data: { session: mockSession }, error: null })),
    onAuthStateChange: jest.fn(),
    startAutoRefresh: jest.fn(),
    stopAutoRefresh: jest.fn(),
  },
  from: jest.fn((table: string) => {
    type Builder = Record<'select' | 'eq' | 'maybeSingle' | 'upsert', jest.Mock> & { table: string };
    const builder: Builder = {
      table,
      select: jest.fn(() => builder),
      eq: jest.fn((column: string, value: unknown) => {
        mockSelectFilters.push([column, value]);
        return builder;
      }),
      maybeSingle: jest.fn(async () => mockSelectResponse),
      upsert: jest.fn(async (payload: Record<string, unknown>, options: unknown) => {
        mockUpserts.push({ payload, options });
        return mockUpsertResponse;
      }),
    };
    return builder;
  }),
};

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => mockSupabaseClient),
}));
jest.mock('react-native-url-polyfill/auto', () => ({}));
jest.mock('expo-file-system/legacy', () => ({
  getInfoAsync: jest.fn(),
  readAsStringAsync: jest.fn(),
  EncodingType: { Base64: 'base64' },
}));
jest.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: jest.fn() },
  NativeModules: {},
  Platform: {
    OS: 'ios',
    select: (values: Record<string, unknown>) => values.ios ?? values.native ?? values.default,
  },
  TurboModuleRegistry: { get: jest.fn(() => null) },
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));
jest.mock('../../services/SupabaseAuthStorage', () => ({
  isAuthStorageSecure: jest.fn(async () => true),
  supabaseSecureAuthStorage: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));
jest.mock('../../services/ResumableStorageUpload', () => ({
  RESUMABLE_UPLOAD_THRESHOLD_BYTES: 6 * 1024 * 1024,
  uploadFileResumably: jest.fn(),
}));

import type { DAVEReportSnapshot } from '../../services/DAVEReportSnapshot';

const MISSING_TABLE = "Could not find the table 'public.report_snapshots' in the schema cache";
const MISSING_RELATION = 'relation "public.report_snapshots" does not exist';
const KEY = '@vitruvius/report-snapshots/v1:tower:project_manager';

describe('the report_snapshots cloud row (owner answer Q16)', () => {
  const originalUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const originalAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  let service: typeof import('../../services/SupabaseService');
  let repository: typeof import('../../services/DAVEReportSnapshotRepository');
  let snapshots: typeof import('../../services/DAVEReportSnapshot');

  beforeAll(() => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
    service = require('../../services/SupabaseService');
    repository = require('../../services/DAVEReportSnapshotRepository');
    snapshots = require('../../services/DAVEReportSnapshot');
  });
  afterAll(() => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = originalUrl;
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = originalAnonKey;
  });
  beforeEach(() => {
    mockSelectFilters.length = 0;
    mockUpserts.length = 0;
    mockSelectResponse = { data: null, error: null, status: 200 };
    mockUpsertResponse = { error: null, status: 201 };
    mockSession = {
      access_token: 'session-token',
      user: { id: 'owner-1' },
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    };
  });

  const sentSnapshot = (fingerprint: string, deliveredAt: string): DAVEReportSnapshot => snapshots.markReportSnapshotDelivered(
    snapshots.reportSnapshotToSave(snapshots.buildDAVEReportSnapshot({
      truths: [],
      scopeKey: 'tower',
      sourceFingerprint: fingerprint,
      capturedAt: '2026-09-29T09:00:00.000Z',
      reportFormat: 'project_manager',
    }), null) as DAVEReportSnapshot,
    deliveredAt,
  );
  const deviceWith = (snapshot: DAVEReportSnapshot | null) => {
    const values = new Map<string, string>(snapshot ? [[KEY, JSON.stringify(snapshot)]] : []);
    return {
      values,
      getItem: jest.fn(async (key: string) => values.get(key) ?? null),
      setItem: jest.fn(async (key: string, value: string) => {
        values.set(key, value);
      }),
    };
  };
  const flush = () => new Promise(resolve => setTimeout(resolve, 0));

  it('reads the signed-in owner\'s row for these projects and this format', async () => {
    const shared = sentSnapshot('f1', '2026-09-29T10:00:00.000Z');
    mockSelectResponse = { data: { snapshot: shared }, error: null, status: 200 };
    const result = await service.loadReportSnapshotCloud('tower', 'project_manager');
    expect(result).toMatchObject({ ok: true, data: { ownerId: 'owner-1', snapshot: shared } });
    expect(result.stubbed).toBeUndefined();
    expect(mockSupabaseClient.from).toHaveBeenCalledWith('report_snapshots');
    expect(mockSelectFilters).toEqual([['owner_id', 'owner-1'], ['scope_key', 'tower'], ['format', 'project_manager']]);
  });

  it('upserts one row per owner, projects and format, with the period\'s send time', async () => {
    const shared = sentSnapshot('f1', '2026-09-29T10:00:00.000Z');
    const pending = snapshots.reportSnapshotToSave({ ...shared, sourceFingerprint: 'f2', capturedAt: '2026-09-30T09:00:00.000Z' }, shared) as DAVEReportSnapshot;
    await repository.saveDAVEReportSnapshot(pending, deviceWith(null));
    await flush();
    expect(mockUpserts).toHaveLength(1);
    expect(mockUpserts[0].options).toEqual({ onConflict: 'owner_id,scope_key,format' });
    expect(mockUpserts[0].payload).toMatchObject({
      owner_id: 'owner-1',
      scope_key: 'tower',
      format: 'project_manager',
      approved_at: '2026-09-30T09:00:00.000Z',
      // Not yet sent: the period still starts from the report it superseded.
      delivered_at: '2026-09-29T10:00:00.000Z',
    });
    expect((mockUpserts[0].payload.snapshot as DAVEReportSnapshot).sourceFingerprint).toBe('f2');
  });

  it.each([MISSING_TABLE, MISSING_RELATION])('before the SQL is applied (%s) the read and the write are quiet stubs, and the device keeps its own period', async message => {
    mockSelectResponse = { data: null, error: { message }, status: 404 };
    mockUpsertResponse = { error: { message }, status: 404 };
    const errors = jest.spyOn(console, 'error');
    const warnings = jest.spyOn(console, 'warn');
    try {
      await expect(service.loadReportSnapshotCloud('tower', 'project_manager')).resolves.toMatchObject({ ok: true, stubbed: true, data: null });
      const own = sentSnapshot('f1', '2026-09-29T10:00:00.000Z');
      const device = deviceWith(own);
      await expect(repository.loadDAVEReportSnapshot('tower', 'project_manager', device)).resolves.toEqual(own);
      await flush();
      // No carry-over upload is attempted while the table is missing.
      expect(mockUpserts).toHaveLength(0);
      await expect(repository.saveDAVEReportSnapshot(own, device)).resolves.toBeUndefined();
      await flush();
      expect(mockUpserts).toHaveLength(1);
      await expect(service.saveReportSnapshotCloud({
        scopeKey: 'tower', format: 'project_manager', snapshot: own, approvedAt: own.capturedAt, deliveredAt: own.deliveredAt ?? null,
      })).resolves.toMatchObject({ ok: true, stubbed: true });
      expect(errors).not.toHaveBeenCalled();
      expect(warnings).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
      warnings.mockRestore();
    }
  });

  it('a real schema error is not mistaken for the missing table', async () => {
    mockSelectResponse = { data: null, error: { message: 'column report_snapshots.format does not exist' }, status: 400 };
    await expect(service.loadReportSnapshotCloud('tower', 'project_manager')).resolves.toMatchObject({ ok: false });
    // The device still uses its own period.
    const own = sentSnapshot('f1', '2026-09-29T10:00:00.000Z');
    await expect(repository.loadDAVEReportSnapshot('tower', 'project_manager', deviceWith(own))).resolves.toEqual(own);
  });

  it('signed out: nothing is read or written, and the device keeps its own period', async () => {
    mockSession = null;
    const own = sentSnapshot('f1', '2026-09-29T10:00:00.000Z');
    await expect(repository.loadDAVEReportSnapshot('tower', 'project_manager', deviceWith(own))).resolves.toEqual(own);
    await repository.saveDAVEReportSnapshot(own, deviceWith(null));
    await flush();
    expect(mockSupabaseClient.from).not.toHaveBeenCalled();
  });

  it('a carry-over read for one account is never written under another', async () => {
    await expect(service.saveReportSnapshotCloud({
      scopeKey: 'tower', format: 'project_manager', snapshot: {}, approvedAt: '2026-09-29T09:00:00.000Z', deliveredAt: null, expectedOwnerId: 'owner-2',
    })).resolves.toMatchObject({ ok: false, code: 'owner_changed' });
    expect(mockUpserts).toHaveLength(0);
  });
});
