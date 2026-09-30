/**
 * Whole-app audit A8 pass 1 F3 (30 Sep 2026): the phone saved every shared
 * document with an upsert. Postgres runs the guard trigger's insert branch of
 * an upsert first, and that branch refuses every Current drawing. A record
 * the cloud already has is now written with a plain owner-scoped update, as
 * the iPad and the web do; a new record is still inserted by upsert.
 */
type MockCall = [string, ...unknown[]];
const mockCalls: MockCall[] = [];
let mockUpdatedRows: unknown[] = [];

function mockReferenceDocumentsQuery() {
  const query: Record<string, jest.Mock> = {};
  query.upsert = jest.fn(async (payload: unknown) => {
    mockCalls.push(['upsert', payload]);
    return { error: null, status: 201 };
  });
  query.update = jest.fn((values: unknown) => {
    mockCalls.push(['update', values]);
    return query;
  });
  query.eq = jest.fn((column: string, value: unknown) => {
    mockCalls.push(['eq', column, value]);
    return query;
  });
  query.select = jest.fn(async (columns: string) => {
    mockCalls.push(['select', columns]);
    return { data: mockUpdatedRows, error: null, status: 200 };
  });
  return query;
}

const mockSupabaseClient = {
  auth: {
    getSession: jest.fn(async () => ({
      data: { session: { access_token: 'session-token', user: { id: 'owner-1' } } },
      error: null,
    })),
    onAuthStateChange: jest.fn(),
    startAutoRefresh: jest.fn(),
    stopAutoRefresh: jest.fn(),
  },
  from: jest.fn((table: string) => {
    if (table !== 'reference_documents') throw new Error(`Unexpected table ${table}`);
    return mockReferenceDocumentsQuery();
  }),
  rpc: jest.fn(async () => ({ data: 'job-1', error: null })),
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
  AppState: {
    currentState: 'active',
    addEventListener: jest.fn(),
  },
  NativeModules: {},
  Platform: {
    OS: 'ios',
    select: (values: Record<string, unknown>) =>
      values.ios ?? values.native ?? values.default,
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

import type { ReferenceDocument } from '../../types';

const currentDrawing: ReferenceDocument = {
  id: 'drawing-a201',
  name: 'A-201',
  originalFileName: 'A-201.pdf',
  uri: 'file:///device/A-201.pdf',
  category: 'Drawing',
  notes: 'Field verified',
  isCurrent: true,
  importedAt: '2026-09-01T12:00:00.000Z',
  updatedAt: '2026-09-30T09:00:00.000Z',
  cloudUpdatedAt: '2026-09-01T12:00:05.000Z',
  storagePath: 'owner-1/documents/drawing-a201/A-201.pdf',
  drawingNumber: 'A-201',
};

describe('shared document writes (A8 pass 1 F3)', () => {
  const originalUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const originalAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  let upsertReferenceDocument: typeof import('../../services/SupabaseService').upsertReferenceDocument;

  beforeAll(() => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
    ({ upsertReferenceDocument } = require('../../services/SupabaseService'));
  });

  afterAll(() => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = originalUrl;
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = originalAnonKey;
  });

  beforeEach(() => {
    mockCalls.length = 0;
    mockUpdatedRows = [{ id: currentDrawing.id }];
  });

  it('updates a record the cloud already has, scoped to its id and owner', async () => {
    await expect(upsertReferenceDocument(currentDrawing, { existing: true }))
      .resolves.toMatchObject({ ok: true, data: currentDrawing });

    expect(mockCalls.map(([method]) => method)).toEqual(['update', 'eq', 'eq', 'select']);
    const [, values] = mockCalls[0] as [string, Record<string, any>];
    expect(values).not.toHaveProperty('id');
    expect(values).not.toHaveProperty('owner_id');
    expect(values).toMatchObject({ name: 'A-201', category: 'Drawing' });
    expect(values.document_data).toMatchObject({ isCurrent: true, notes: 'Field verified' });
    expect(values.document_data).not.toHaveProperty('cloudUpdatedAt');
    expect(typeof values.updated_at).toBe('string');
    expect(mockCalls.slice(1)).toEqual([
      ['eq', 'id', 'drawing-a201'],
      ['eq', 'owner_id', 'owner-1'],
      ['select', 'id'],
    ]);
  });

  it('treats an update that changed no row as not found', async () => {
    mockUpdatedRows = [];

    await expect(upsertReferenceDocument(currentDrawing, { existing: true })).resolves.toMatchObject({
      ok: false,
      status: 404,
      code: 'not_found',
      error: 'The shared document record was not found in the cloud. It will be checked again.',
    });
    expect(mockCalls.some(([method]) => method === 'upsert')).toBe(false);
  });

  it('still inserts a new record by upsert, with its owner', async () => {
    const newDocument = { ...currentDrawing, id: 'drawing-new', isCurrent: false };

    await expect(upsertReferenceDocument(newDocument)).resolves.toMatchObject({ ok: true });

    expect(mockCalls).toEqual([
      ['upsert', expect.objectContaining({ id: 'drawing-new', owner_id: 'owner-1' })],
    ]);
  });
});
