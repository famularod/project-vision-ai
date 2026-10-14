/**
 * High item 3, option (b2) (the coordinator's decision on Q52 B, 13 Oct 2026). A drawing's row carries its citation
 * slice under document_data.citationPageIndex. A phone or iPad still on an older build (Build 231) does not know that
 * key: does its edit of the drawing's details keep it in the row? Only the app's own functions, as the older build
 * has them (this file is also run on a5cab6c, the commit Build 231 was made from): its document list, its
 * normalizer, the upload queue's payload and merge with the listed copy (SyncService 'reference_document'), Sync
 * Now's choice of what to send (daveReferenceDocumentsNeedingCloudUpload), and its upload. Made-up drawing.
 */
import type { ReferenceDocument } from '../../types';

const mockRows = new Map<string, { id: string; name: string; category: string; document_data: Record<string, unknown>; updated_at: string }>();
let mockClock = Date.parse('2026-10-01T10:00:00.000Z');
function mockStore(payload: Record<string, any>, id: string) {
  mockClock += 60_000;
  mockRows.set(id, { id, name: payload.name, category: payload.category, document_data: JSON.parse(JSON.stringify(payload.document_data)), updated_at: new Date(mockClock).toISOString() });
}
function mockQuery() {
  const query: Record<string, any> = {};
  let pending: Record<string, any> | null = null;
  const ids: string[] = [];
  query.upsert = jest.fn(async (payload: Record<string, any>) => { mockStore(payload, payload.id); return { error: null, status: 201 }; });
  query.update = jest.fn((values: Record<string, any>) => { pending = values; return query; });
  query.eq = jest.fn((column: string, value: string) => { if (column === 'id') ids.push(value); return query; });
  query.select = jest.fn(async () => { if (pending && ids[0]) mockStore(pending, ids[0]); return { data: ids.map(id => ({ id })), error: null, status: 200 }; });
  return query;
}
const mockClient = {
  auth: {
    getSession: jest.fn(async () => ({ data: { session: { access_token: 't', user: { id: 'owner-1' } } }, error: null })),
    getUser: jest.fn(async () => ({ data: { user: { id: 'owner-1' } }, error: null })),
    onAuthStateChange: jest.fn(), startAutoRefresh: jest.fn(), stopAutoRefresh: jest.fn(),
  },
  from: jest.fn(() => mockQuery()),
  // The live document list: document_data - 'extractedPages'.
  rpc: jest.fn(async (name: string) => name === 'dave_list_reference_document_metadata'
    ? { data: [...mockRows.values()].map(row => { const { extractedPages: _left, ...data } = row.document_data; return { ...row, document_data: data }; }), error: null, status: 200 }
    : { data: [], error: null, status: 200 }),
};
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => mockClient) }));
jest.mock('react-native-url-polyfill/auto', () => ({}));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null, getInfoAsync: jest.fn(), readAsStringAsync: jest.fn(), EncodingType: { Base64: 'base64' } }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined), getAllKeys: jest.fn(async () => []), multiGet: jest.fn(async () => []) },
}));
jest.mock('../../services/SupabaseAuthStorage', () => ({
  isAuthStorageSecure: jest.fn(async () => true),
  supabaseSecureAuthStorage: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined) },
}));
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
/* eslint-disable @typescript-eslint/no-var-requires */
const SupabaseService = require('../../services/SupabaseService');
const { compactECOSDocumentIndexForCloud } = require('../../services/ECOSDocumentIndexPersistence');
const { mergeDAVEReferenceDocumentRecoveryRecords, daveReferenceDocumentsNeedingCloudUpload } = require('../../services/DAVECloudRecovery');
const { normalizeReferenceDocuments } = require('../../services/ReferenceDocumentRepository');
/* eslint-enable @typescript-eslint/no-var-requires */

const SHA = 'c'.repeat(64);
const SLICE = { sourceSha256: SHA, pages: [{ pageNumber: 1, sheetNumber: null, regions: [{ id: 'region-lot', label: 'Lot', areaNames: ['Lot'], confidence: 0.95, x: 0.1, y: 0.1, width: 0.4, height: 0.3 }] }] };
/** The row as this build writes it: the citation key, and the drawing's own index already gone (an earlier edit). */
function cloudRowWithTheKey() {
  mockRows.clear();
  mockStore({ name: 'A-201 Site plan', category: 'Plans', document_data: {
    id: 'doc-a201', name: 'A-201 Site plan', originalFileName: 'A-201 Site plan.pdf', category: 'Plans', notes: '', isCurrent: true,
    importedAt: '2026-09-21T15:00:00.000Z', updatedAt: '2026-09-21T15:00:00.000Z', projectName: 'Alpha', projectNames: ['Alpha'],
    storagePath: 'owner-1/doc-a201/A-201-Site-plan.pdf', sourceProvider: 'supabase_storage', sizeBytes: 1000, contentSha256: SHA, indexedContentSha256: SHA,
    drawingNumber: 'A-201', drawingRevision: 'C', drawingStatus: 'For Construction', extractionStatus: 'complete',
    extractedPages: [], citationPageIndex: SLICE,
  } }, 'doc-a201');
}
/** The older build's phone: its list, normalized into what it holds; its own edit of the details. */
async function heldAndEdited(): Promise<{ edited: ReferenceDocument; listed: ReferenceDocument[] }> {
  const listed = (await SupabaseService.listReferenceDocuments()).data as ReferenceDocument[];
  const [held] = normalizeReferenceDocuments(listed);
  return { edited: { ...held, notes: 'Checked on site', updatedAt: '2026-10-02T09:00:00.000Z' }, listed };
}

describe('a phone on an older build edits a drawing whose row carries the citation key', () => {
  it('through its upload queue (the payload merged with the listed copy, then sent): the key stays in the row', async () => {
    cloudRowWithTheKey();
    const { edited } = await heldAndEdited();
    const payload = compactECOSDocumentIndexForCloud(edited);
    const remote = ((await SupabaseService.listReferenceDocuments()).data as ReferenceDocument[]).find(document => document.id === 'doc-a201')!;
    const merged = mergeDAVEReferenceDocumentRecoveryRecords({ local: [payload], cloud: [remote] }).find((document: ReferenceDocument) => document.id === 'doc-a201');
    const result = await SupabaseService.upsertReferenceDocument(merged, { existing: true });
    expect(result.ok).toBe(true);
    const row = mockRows.get('doc-a201')!;
    expect(row.document_data.notes).toBe('Checked on site');
    expect(row.document_data.citationPageIndex).toEqual(SLICE);
  });

  it('through Sync Now (what needs sending, merged with the listed copy, then sent): the key stays in the row', async () => {
    cloudRowWithTheKey();
    const { edited, listed } = await heldAndEdited();
    const [pending] = daveReferenceDocumentsNeedingCloudUpload({ local: [edited], cloud: listed });
    expect(pending).toBeDefined();
    expect((await SupabaseService.upsertReferenceDocument(pending, { existing: true })).ok).toBe(true);
    const row = mockRows.get('doc-a201')!;
    expect(row.document_data.notes).toBe('Checked on site');
    expect(row.document_data.citationPageIndex).toEqual(SLICE);
  });
});
