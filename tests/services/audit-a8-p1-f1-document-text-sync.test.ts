/**
 * Whole-app audit A8 pass 1 F1 (30 Sep 2026): text typed on a phone document
 * card reached the cloud and the iPad cut short. "1" was uploaded while "12"
 * was being typed; the cloud copy of "1" was stamped with its upload time,
 * which outranked the edit time of "12", so the queued "12" was resolved as
 * already uploaded. The cloud copy is now ranked by its own edit time
 * (document_data.updatedAt), with ties going to the cloud.
 */
const mockStorageValues = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn((key: string) => Promise.resolve(mockStorageValues.get(key) ?? null)),
  setItem: jest.fn((key: string, value: string) => {
    mockStorageValues.set(key, value);
    return Promise.resolve();
  }),
  removeItem: jest.fn((key: string) => {
    mockStorageValues.delete(key);
    return Promise.resolve();
  }),
  getAllKeys: jest.fn(() => Promise.resolve([...mockStorageValues.keys()])),
}));

const ok = <T>(data: T) => Promise.resolve({ ok: true, configured: true, stubbed: false, data });
// The cloud keeps each row's document_data and stamps updated_at with the
// upload time, as SupabaseService.upsertReferenceDocument does.
const mockCloud = new Map<string, Record<string, unknown>>();
const mockUploadTimes: string[] = [];
let mockHeldUpload: Promise<void> | null = null;
let mockUploadStarted: () => void = () => undefined;
const mockUpsertReferenceDocument = jest.fn(async (document: Record<string, unknown>) => {
  mockUploadStarted();
  if (mockHeldUpload) await mockHeldUpload;
  const { cloudUpdatedAt: _cloudUpdatedAt, ...documentData } = document;
  mockCloud.set(String(document.id), {
    ...documentData,
    cloudUpdatedAt: mockUploadTimes.shift() || '2026-09-30T12:00:59.000Z',
  });
  return { ok: true, configured: true, stubbed: false, data: document };
});

jest.mock('../../services/SupabaseService', () => ({
  listProjects: () => ok([]),
  listArchivedProjects: () => ok([]),
  listReferenceDocuments: () => ok([...mockCloud.values()].map(row => ({ ...row }))),
  upsertReferenceDocument: (document: Record<string, unknown>) => mockUpsertReferenceDocument(document),
  listDAVESyncTombstones: () => ok([]),
  upsertDAVESyncTombstone: () => ok(null),
  upsertDAVESyncTombstones: (tombstones: unknown[]) => ok(tombstones),
  listDAVEStorageCleanupIntents: () => ok([]),
  removeProtectedStorageObject: () => ok(null),
  recordDAVEStorageCleanupAttempt: () => ok(null),
  getSupabaseConfigurationStatus: () => ({ configured: true, message: 'Configured.' }),
}));

import {
  getOfflineQueue,
  queueReferenceDocumentRecord,
  uploadPendingChanges,
} from '../../services/SyncService';
import type { ReferenceDocument } from '../../types';

function cardRecord(notes: string, updatedAt: string): ReferenceDocument {
  return {
    id: 'spec-1',
    name: 'spec',
    originalFileName: 'spec.pdf',
    uri: '',
    storagePath: 'project-documents/owner-1/spec-1/spec.pdf',
    category: 'Specification',
    notes,
    isCurrent: false,
    importedAt: '2026-09-30T11:00:00.000Z',
    updatedAt,
  };
}

const TYPED_1_AT = '2026-09-30T12:00:01.000Z';
const TYPED_12_AT = '2026-09-30T12:00:02.000Z';
const UPLOADED_1_AT = '2026-09-30T12:00:05.000Z';

describe('text typed on a phone document card reaches the cloud whole (A8 pass 1 F1)', () => {
  beforeEach(() => {
    mockStorageValues.clear();
    mockCloud.clear();
    mockUploadTimes.length = 0;
    mockHeldUpload = null;
    mockUploadStarted = () => undefined;
    mockUpsertReferenceDocument.mockClear();
  });

  it('race: "12" typed while the "1" upload is held ends with "12" in the cloud', async () => {
    let releaseUpload: () => void = () => undefined;
    mockHeldUpload = new Promise(resolve => { releaseUpload = resolve; });
    const uploadStarted = new Promise<void>(resolve => { mockUploadStarted = resolve; });
    mockUploadTimes.push(UPLOADED_1_AT, '2026-09-30T12:00:08.000Z');

    await queueReferenceDocumentRecord(cardRecord('1', TYPED_1_AT), false);
    const firstPass = uploadPendingChanges();
    await uploadStarted;
    // The owner keeps typing while "1" is on its way to the cloud.
    await queueReferenceDocumentRecord(cardRecord('12', TYPED_12_AT), false);
    mockHeldUpload = null;
    releaseUpload();
    await firstPass;

    // The cloud now holds "1", stamped after "12" was typed.
    expect(mockCloud.get('spec-1')).toMatchObject({
      notes: '1',
      updatedAt: TYPED_1_AT,
      cloudUpdatedAt: UPLOADED_1_AT,
    });
    await expect(getOfflineQueue()).resolves.toHaveLength(1);

    await expect(uploadPendingChanges()).resolves.toMatchObject({ queued: 0 });
    expect(mockUpsertReferenceDocument).toHaveBeenCalledTimes(2);
    expect(mockCloud.get('spec-1')).toMatchObject({ notes: '12', updatedAt: TYPED_12_AT });
    await expect(getOfflineQueue()).resolves.toEqual([]);
  });

  it('control: "12" typed after the "1" upload finished reaches the cloud', async () => {
    const typed12AfterUploadAt = '2026-09-30T12:00:06.000Z';
    mockUploadTimes.push(UPLOADED_1_AT, '2026-09-30T12:00:08.000Z');

    await queueReferenceDocumentRecord(cardRecord('1', TYPED_1_AT), false);
    await uploadPendingChanges();
    await queueReferenceDocumentRecord(cardRecord('12', typed12AfterUploadAt), false);
    await expect(uploadPendingChanges()).resolves.toMatchObject({ queued: 0 });

    expect(mockCloud.get('spec-1')).toMatchObject({ notes: '12', updatedAt: typed12AfterUploadAt });
  });

  it('control: a newer web edit is not overwritten by an older queued phone edit', async () => {
    const webEditedAt = '2026-09-30T12:00:03.000Z';
    mockCloud.set('spec-1', {
      ...cardRecord('Edited on the web', webEditedAt),
      cloudUpdatedAt: webEditedAt,
    });

    await queueReferenceDocumentRecord(cardRecord('12', TYPED_12_AT), false);
    await expect(uploadPendingChanges()).resolves.toMatchObject({ queued: 0 });

    expect(mockUpsertReferenceDocument).not.toHaveBeenCalled();
    expect(mockCloud.get('spec-1')).toMatchObject({ notes: 'Edited on the web' });
  });

  it('control: an unchanged record whose cloud copy has the same edit time is not sent again', async () => {
    mockCloud.set('spec-1', {
      ...cardRecord('12', TYPED_12_AT),
      cloudUpdatedAt: UPLOADED_1_AT,
    });

    await queueReferenceDocumentRecord(cardRecord('12', TYPED_12_AT), false);
    await expect(uploadPendingChanges()).resolves.toMatchObject({ queued: 0 });

    expect(mockUpsertReferenceDocument).not.toHaveBeenCalled();
  });
});
