/**
 * Whole-app audit A7 pass 6 L1 (30 Sep 2026): a phone note typed offline
 * before Make Current on the web overwrote a note the web typed after the
 * activation. The phone's queued edit outlived the activation whenever the
 * current flags differed (A8 pass 3 M2), without asking whether the shared
 * details had changed since the phone last saw them.
 *
 * Now the phone keeps a record of the cloud copy's shared details when it
 * merges it; the edit outlives the activation only while the cloud's details
 * are still those (or this phone's own last upload). Otherwise the newer
 * edit on the web stands, as it does without an activation. Real SyncService
 * queue and uploadPendingChanges, real merge and normalizer; the cloud is a
 * mocked reference_documents list.
 */
const mockStorage = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => {
  const api = {
    getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { mockStorage.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { mockStorage.delete(key); }),
    getAllKeys: jest.fn(async () => [...mockStorage.keys()]),
    multiGet: jest.fn(async (keys: string[]) => keys.map(key => [key, mockStorage.get(key) ?? null])),
    multiSet: jest.fn(async (pairs: Array<[string, string]>) => { pairs.forEach(([key, value]) => mockStorage.set(key, value)); }),
    multiRemove: jest.fn(async (keys: string[]) => { keys.forEach(key => mockStorage.delete(key)); }),
  };
  return { __esModule: true, default: api, ...api };
});

/** Each row's document_data, with updated_at as cloudUpdatedAt, as the metadata RPC lists them. */
const mockDocuments = new Map<string, Record<string, unknown>>();
jest.mock('../../services/SupabaseService', () => {
  const ok = <T>(data: T) => ({ ok: true, configured: true, stubbed: false, data });
  return {
    listProjects: async () => ok([]),
    listArchivedProjects: async () => ok([]),
    listReferenceDocuments: async () => ok([...mockDocuments.values()].map(row => ({ ...row }))),
    // As the real one: document_data without cloudUpdatedAt or this phone's last-seen record.
    upsertReferenceDocument: async (document: Record<string, unknown>) => {
      const { cloudUpdatedAt: _cloudUpdatedAt, cloudDetailsSeen: _cloudDetailsSeen, ...documentData } = document;
      mockDocuments.set(String(document.id), { ...documentData, cloudUpdatedAt: new Date().toISOString() });
      return ok(document);
    },
    listDAVESyncTombstones: async () => ok([]),
    upsertDAVESyncTombstone: async () => ok(null),
    upsertDAVESyncTombstones: async (tombstones: unknown[]) => ok(tombstones),
    listDAVEStorageCleanupIntents: async () => ok([]),
    removeProtectedStorageObject: async () => ok(null),
    recordDAVEStorageCleanupAttempt: async () => ok(null),
    getSupabaseConfigurationStatus: () => ({ configured: true, message: 'Configured.' }),
  };
});

import { getOfflineQueue, queueReferenceDocumentRecord, uploadPendingChanges } from '../../services/SyncService';
import {
  mergeDAVEReferenceDocumentRecoveryRecords,
  referenceDocumentSharedDetailsFingerprint,
} from '../../services/DAVECloudRecovery';
import { normalizeReferenceDocuments } from '../../services/ReferenceDocumentRepository';
import type { ReferenceDocument } from '../../types';

beforeEach(() => {
  mockStorage.clear();
  mockDocuments.clear();
});

describe('a web note typed after Make Current is not overwritten by an older phone note (audit A7 pass 6 L1)', () => {
  const SEEN_AT = '2026-09-29T11:00:00.000Z';
  const TYPED_AT = '2026-09-29T12:00:00.000Z';
  const ACTIVATED_AT = '2026-09-29 12:00:01.234567+00'; // activation_at::text
  const ACTIVATED_ROW_AT = '2026-09-29T12:00:01.234567+00:00';
  const WEB_EDITED_AT = '2026-09-29T12:30:00.000Z';
  const drawing = (notes: string, extra: Partial<ReferenceDocument> = {}): ReferenceDocument => ({
    id: 'drawing-a201', name: 'A-201', originalFileName: 'A-201.pdf', uri: '', mimeType: 'application/pdf',
    storagePath: 'project-documents/alpha/drawing-a201/A-201.pdf', category: 'Drawing', notes,
    isCurrent: false, importedAt: '2026-09-01T00:00:00.000Z', updatedAt: SEEN_AT, drawingNumber: 'A-201', drawingRevision: 'B',
    ...extra,
  });
  /** The phone's copy, as a refresh at 11:00 left it: merged with the cloud copy it saw. */
  const phoneCopyAtLastLook = () => {
    mockDocuments.set('drawing-a201', { ...drawing('Issued for permit'), cloudUpdatedAt: SEEN_AT });
    const cloud = normalizeReferenceDocuments([...mockDocuments.values()]);
    const [merged] = mergeDAVEReferenceDocumentRecoveryRecords({ local: [drawing('Issued for permit', { uri: 'file:///phone/A-201.pdf' })], cloud });
    return merged;
  };
  const activateOnTheWeb = () => {
    const row = mockDocuments.get('drawing-a201')!;
    mockDocuments.set('drawing-a201', { ...row, isCurrent: true, updatedAt: ACTIVATED_AT, cloudUpdatedAt: ACTIVATED_ROW_AT });
  };

  it('12:00 phone note offline, 12:00:01 Make Current on the web, 12:30 web note: the web note stands', async () => {
    const phoneCopy = phoneCopyAtLastLook();
    await queueReferenceDocumentRecord({ ...phoneCopy, notes: 'Phone: stamped by the city', updatedAt: TYPED_AT }, false);
    activateOnTheWeb();
    const row = mockDocuments.get('drawing-a201')!;
    mockDocuments.set('drawing-a201', { ...row, notes: 'Web: revised per RFI 12', updatedAt: WEB_EDITED_AT, cloudUpdatedAt: WEB_EDITED_AT });

    await uploadPendingChanges();
    expect(mockDocuments.get('drawing-a201')).toMatchObject({ notes: 'Web: revised per RFI 12', isCurrent: true });
    expect(await getOfflineQueue()).toEqual([]);
  });

  it('control (A8 pass 3 M2): with only the activation since the phone\'s last look, the phone note still reaches the cloud', async () => {
    const phoneCopy = phoneCopyAtLastLook();
    expect(phoneCopy.cloudDetailsSeen).toEqual(expect.any(String));
    await queueReferenceDocumentRecord({ ...phoneCopy, notes: 'Phone: stamped by the city', updatedAt: TYPED_AT }, false);
    activateOnTheWeb();

    await uploadPendingChanges();
    expect(mockDocuments.get('drawing-a201')).toMatchObject({ notes: 'Phone: stamped by the city', isCurrent: true });
    // (The record is this phone's own and is not sent: audit-a8-p1-f3-reference-document-update.)
  });

  it('a web edit before the activation is newer than the phone\'s last look too: it stands', async () => {
    const phoneCopy = phoneCopyAtLastLook();
    await queueReferenceDocumentRecord({ ...phoneCopy, notes: 'Phone: stamped by the city', updatedAt: TYPED_AT }, false);
    const row = mockDocuments.get('drawing-a201')!;
    mockDocuments.set('drawing-a201', { ...row, drawingRevision: 'C', updatedAt: '2026-09-29T12:00:00.500Z' });
    activateOnTheWeb();
    await uploadPendingChanges();
    expect(mockDocuments.get('drawing-a201')).toMatchObject({ notes: 'Issued for permit', drawingRevision: 'C', isCurrent: true });
  });

  it('this phone\'s own upload counts as seen before its echo comes back', async () => {
    const phoneCopy = phoneCopyAtLastLook();
    await queueReferenceDocumentRecord({ ...phoneCopy, notes: 'Phone: first note', updatedAt: '2026-09-29T11:30:00.000Z' }, false);
    await uploadPendingChanges();
    expect(mockDocuments.get('drawing-a201')).toMatchObject({ notes: 'Phone: first note' });
    // Offline before the echo: the next note is typed on a copy that last saw 11:00.
    await queueReferenceDocumentRecord({ ...phoneCopy, notes: 'Phone: second note', updatedAt: TYPED_AT }, false);
    activateOnTheWeb();
    await uploadPendingChanges();
    expect(mockDocuments.get('drawing-a201')).toMatchObject({ notes: 'Phone: second note', isCurrent: true });
  });

  it('the rule reads the cloud row and the phone\'s normalized copy of it alike', () => {
    const row = { ...drawing('Issued for permit'), cloudUpdatedAt: SEEN_AT, projectNames: undefined, sourceProvider: undefined };
    const [normalized] = normalizeReferenceDocuments([row]);
    expect(referenceDocumentSharedDetailsFingerprint(normalized)).toBe(referenceDocumentSharedDetailsFingerprint(row as ReferenceDocument));
    expect(referenceDocumentSharedDetailsFingerprint({ ...normalized, isCurrent: true, updatedAt: ACTIVATED_AT, retiredForProjectNames: ['P'] }))
      .toBe(referenceDocumentSharedDetailsFingerprint(normalized));
    expect(referenceDocumentSharedDetailsFingerprint({ ...normalized, notes: 'Web: revised per RFI 12' }))
      .not.toBe(referenceDocumentSharedDetailsFingerprint(normalized));
  });

  it('the last-seen record survives a relaunch', () => {
    const phoneCopy = phoneCopyAtLastLook();
    const [reloaded] = normalizeReferenceDocuments(JSON.parse(JSON.stringify([phoneCopy])));
    expect(reloaded.cloudDetailsSeen).toBe(phoneCopy.cloudDetailsSeen);
  });
});
