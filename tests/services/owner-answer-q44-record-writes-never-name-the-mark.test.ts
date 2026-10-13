/**
 * Owner answer Q44 (6 Oct 2026), the mixed state. The archived mark is a
 * column of its own because a write that does not name a column leaves it as
 * it is. This pins the other half of that: the phone's and iPad's write of a
 * shared document (the real services/SupabaseService.ts upsertReferenceDocument,
 * the same in Build 230) names id, name, category, document_data, updated_at
 * and owner_id, and nothing else, whichever of its two ways it writes and
 * whatever the record carries. So no save of a record, by this build or an
 * older one, can set or empty the mark.
 *
 * It passes before and after this batch: it is a guard for later changes.
 */
const mockWrites: Array<{ how: 'upsert' | 'update'; table: string; payload: Record<string, unknown> }> = [];
let mockSession: Record<string, unknown> | null = null;
let mockListAnswer: { data: unknown; error: { message: string } | null; status: number } = { data: [], error: null, status: 200 };

const mockSupabaseClient = {
  auth: {
    getSession: jest.fn(async () => ({ data: { session: mockSession }, error: null })),
    onAuthStateChange: jest.fn(),
    startAutoRefresh: jest.fn(),
    stopAutoRefresh: jest.fn(),
  },
  rpc: jest.fn(async (name: string) => (name === 'dave_list_reference_document_metadata'
    ? mockListAnswer
    : { data: null, error: null, status: 200 })),
  from: jest.fn((table: string) => {
    const builder: Record<string, jest.Mock> = {};
    builder.upsert = jest.fn(async (payload: Record<string, unknown>) => {
      mockWrites.push({ how: 'upsert', table, payload });
      return { error: null, status: 201 };
    });
    builder.update = jest.fn((payload: Record<string, unknown>) => {
      mockWrites.push({ how: 'update', table, payload });
      return builder;
    });
    builder.eq = jest.fn(() => builder);
    builder.select = jest.fn(async () => ({ data: [{ id: 'doc-permit' }], error: null, status: 200 }));
    return builder;
  }),
};

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => mockSupabaseClient) }));
jest.mock('react-native-url-polyfill/auto', () => ({}));
jest.mock('expo-file-system/legacy', () => ({
  getInfoAsync: jest.fn(), readAsStringAsync: jest.fn(), EncodingType: { Base64: 'base64' },
}));
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
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
  isAvailableAsync: jest.fn(async () => false), getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => undefined),
}));
jest.mock('../../services/ResumableStorageUpload', () => ({
  RESUMABLE_UPLOAD_THRESHOLD_BYTES: 6 * 1024 * 1024, uploadFileResumably: jest.fn(),
}));

import type { ReferenceDocument } from '../../types';

const COLUMNS_EVERY_BUILD_WRITES = ['category', 'document_data', 'id', 'name', 'updated_at'];
const permit: ReferenceDocument = {
  id: 'doc-permit', name: 'Grading permit', originalFileName: 'Grading permit.pdf', uri: '', mimeType: 'application/pdf',
  category: 'Permit Card', notes: '', isCurrent: false, importedAt: '2026-10-05T15:59:00.000Z', projectId: '11111111-1111-4111-8111-111111111111',
  projectName: 'Lot 9', projectNames: ['Lot 9'], storagePath: 'owner-a/project-documents/doc-permit.pdf', sizeBytes: 2048,
  updatedAt: '2026-10-05T16:00:00.000Z', cloudUpdatedAt: '2026-10-05T16:00:01.000Z',
};

describe('a save of a shared document never names the archived mark (owner answer Q44)', () => {
  const originalUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const originalAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  let service: typeof import('../../services/SupabaseService');

  beforeAll(() => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
    service = require('../../services/SupabaseService');
  });
  afterAll(() => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = originalUrl;
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = originalAnonKey;
  });
  beforeEach(() => {
    mockWrites.length = 0;
    mockSession = { access_token: 'session-token', user: { id: 'owner-a' }, expires_at: Math.floor(Date.now() / 1000) + 3600 };
  });

  const recordWrites = () => mockWrites.filter(write => write.table === 'reference_documents');

  it('a record the cloud does not have yet (an upsert): the columns every build writes, and the account', async () => {
    const result = await service.upsertReferenceDocument(permit);
    expect(result.ok).toBe(true);
    expect(recordWrites().map(write => write.how)).toEqual(['upsert']);
    expect(Object.keys(recordWrites()[0].payload).sort()).toEqual([...COLUMNS_EVERY_BUILD_WRITES, 'owner_id'].sort());
  });

  it('a record the cloud already has (an update): the same columns, the row found by its id and account', async () => {
    const result = await service.upsertReferenceDocument(permit, { existing: true });
    expect(result.ok).toBe(true);
    expect(recordWrites().map(write => write.how)).toEqual(['update']);
    expect(Object.keys(recordWrites()[0].payload).sort()).toEqual(COLUMNS_EVERY_BUILD_WRITES.filter(column => column !== 'id').sort());
  });

  it('whatever the record carries, the mark is never a column of the write', async () => {
    const carrying = { ...permit, archived_at: '2026-10-06T18:00:00.000Z', archivedAt: '2026-10-06T18:00:00.000Z' } as ReferenceDocument;
    await service.upsertReferenceDocument(carrying);
    await service.upsertReferenceDocument(carrying, { existing: true });
    expect(recordWrites()).toHaveLength(2);
    for (const write of recordWrites()) expect(Object.keys(write.payload).filter(column => /archiv/i.test(column))).toEqual([]);
  });
});

describe('reading the shared-document list tells the archived-mark listener (owner answer Q44)', () => {
  const originalUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const originalAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  let service: typeof import('../../services/SupabaseService');
  const listed = [{ id: 'doc-permit', updated_at: '2026-10-05T16:00:01.000Z', document_data: { ...permit, cloudUpdatedAt: undefined } }];

  beforeAll(() => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
    service = require('../../services/SupabaseService');
  });
  afterAll(() => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = originalUrl;
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = originalAnonKey;
  });
  beforeEach(() => {
    mockListAnswer = { data: listed, error: null, status: 200 };
    mockSession = { access_token: 'session-token', user: { id: 'owner-a' }, expires_at: Math.floor(Date.now() / 1000) + 3600 };
  });
  afterEach(() => { service.setReferenceDocumentsListedListener(null); });

  it('after the list is read, with the cloud connection and the account it was read for', async () => {
    const listener = jest.fn(async () => undefined);
    service.setReferenceDocumentsListedListener(listener);
    const result = await service.listReferenceDocuments();
    expect(result.data?.map(document => document.id)).toEqual(['doc-permit']);
    expect(listener.mock.calls).toEqual([[mockSupabaseClient, 'owner-a']]);
  });

  it('the list is what was asked for: a listener that fails, either way, changes nothing', async () => {
    service.setReferenceDocumentsListedListener(jest.fn(async () => { throw new Error('the mark could not be read'); }));
    expect((await service.listReferenceDocuments()).data?.map(document => document.id)).toEqual(['doc-permit']);
    service.setReferenceDocumentsListedListener(jest.fn(() => { throw new Error('the mark could not be read'); }) as never);
    const result = await service.listReferenceDocuments();
    expect(result.ok).toBe(true);
    expect(result.data?.map(document => document.id)).toEqual(['doc-permit']);
  });

  it('review of D1, L12: the list does not wait for the listener: it is back at once while the archive question is still out, and the listener\'s work goes on', async () => {
    let finish: () => void = () => undefined;
    let finished = false;
    // A stalled connection: the question about the mark takes as long as it takes.
    const listener = jest.fn(() => new Promise<void>(resolve => { finish = () => { finished = true; resolve(); }; }));
    service.setReferenceDocumentsListedListener(listener);
    const heldUp = new Promise<'held up'>(resolve => setTimeout(() => resolve('held up'), 1500));
    const result = await Promise.race([service.listReferenceDocuments(), heldUp]);
    expect(result).not.toBe('held up');
    expect((result as Awaited<ReturnType<typeof service.listReferenceDocuments>>).data?.map(document => document.id)).toEqual(['doc-permit']);
    expect(listener.mock.calls).toEqual([[mockSupabaseClient, 'owner-a']]);
    expect(finished).toBe(false); // still out: its answer is applied when it comes
    finish();
  });

  it('a list that could not be read tells no one, and no listener is no trouble', async () => {
    const listener = jest.fn(async () => undefined);
    service.setReferenceDocumentsListedListener(listener);
    mockListAnswer = { data: null, error: { message: 'Network request failed' }, status: 0 };
    expect((await service.listReferenceDocuments()).ok).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    service.setReferenceDocumentsListedListener(null);
    mockListAnswer = { data: listed, error: null, status: 200 };
    expect((await service.listReferenceDocuments()).ok).toBe(true);
  });
});
