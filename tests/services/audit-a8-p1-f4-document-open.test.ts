/**
 * Whole-app audit A8 pass 1 F4 (30 Sep 2026): opening a shared document
 * downloaded it again every time and rewrote the cloud record. The restore
 * was saved under Documents/restored-reference-documents/<id>/, a path the
 * reference-document normalizer drops, and the open then saved the record
 * with a new edit time and queued it, which could overwrite a newer web edit
 * held in a stale local copy. A restore is now saved flat in
 * Documents/project-documents and kept on this phone only.
 */
import fs from 'node:fs';
import path from 'node:path';

const mockFiles = new Map<string, Uint8Array>();
const mockCreatedDirectories: string[] = [];

jest.mock('expo-file-system', () => {
  const join = (base: string, name: string) => `${base.replace(/\/+$/, '')}/${name}`;
  class Directory {
    uri: string;
    constructor(parent: { uri: string }, name: string) {
      this.uri = join(parent.uri, name);
    }
    create() {
      mockCreatedDirectories.push(this.uri);
    }
  }
  class File {
    uri: string;
    constructor(parent: { uri: string } | string, name?: string) {
      this.uri = typeof parent === 'string' ? parent : join(parent.uri, String(name));
    }
    create() {}
    write(bytes: Uint8Array) {
      mockFiles.set(this.uri, new Uint8Array(bytes));
    }
    async bytes() {
      return mockFiles.get(this.uri) || new Uint8Array();
    }
    get exists() {
      return mockFiles.has(this.uri);
    }
    delete() {
      mockFiles.delete(this.uri);
    }
  }
  return { Directory, File, Paths: { document: { uri: 'file:///documents/' } } };
});
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///documents/',
  getInfoAsync: jest.fn(async (uri: string) => ({ exists: mockFiles.has(uri) })),
  makeDirectoryAsync: jest.fn(),
  deleteAsync: jest.fn(async (uri: string) => { mockFiles.delete(uri); }),
}));

const mockBytes = new Uint8Array([1, 2, 3, 4]);
const mockSha = 'a'.repeat(64);
const BYTES = mockBytes;
const SHA = mockSha;
const mockDownloadPhoto = jest.fn(async (..._args: unknown[]) => ({ ok: true, data: mockBytes }));
const mockUploadPhoto = jest.fn();
jest.mock('../../services/SupabaseService', () => ({
  downloadPhoto: (...args: unknown[]) => mockDownloadPhoto(...args),
  uploadPhoto: (...args: unknown[]) => mockUploadPhoto(...args),
}));
jest.mock('../../services/BlobBytes', () => ({ blobToBytes: async (data: Uint8Array) => data }));
jest.mock('../../services/ExpoSha256', () => ({ sha256Hex: async () => mockSha }));

import { daveReferenceDocumentsNeedingCloudUpload, mergeDAVEReferenceDocumentRecoveryRecords } from '../../services/DAVECloudRecovery';
import {
  restoreReferenceDocumentBytesFromCloud,
  restoredReferenceDocumentFileName,
} from '../../services/ExpoReferenceDocumentByteRestore';
import { withRestoredReferenceDocumentBytes } from '../../services/ReferenceDocumentByteRestore';
import {
  deleteStoredReferenceDocument,
  normalizeReferenceDocument,
  resolveReferenceDocumentUri,
} from '../../services/ReferenceDocumentRepository';
import type { ReferenceDocument } from '../../types';

const cloudCopy: ReferenceDocument = {
  id: 'web-document-1',
  name: 'Spec sheet',
  originalFileName: 'Spec sheet (rev 2).pdf',
  uri: '',
  mimeType: 'application/pdf',
  category: 'Specifications',
  notes: '',
  isCurrent: false,
  importedAt: '2026-09-01T12:00:00.000Z',
  updatedAt: '2026-09-02T12:00:00.000Z',
  cloudUpdatedAt: '2026-09-02T12:00:05.000Z',
  storagePath: 'owner-1/documents/web-document-1/spec.pdf',
  sizeBytes: BYTES.byteLength,
  contentSha256: SHA,
};

function openInput(document: ReferenceDocument) {
  return {
    documentId: document.id,
    storagePath: String(document.storagePath),
    originalFileName: document.originalFileName,
    expectedSizeBytes: Number(document.sizeBytes),
    expectedSha256: SHA,
  };
}

describe('opening a shared document (A8 pass 1 F4)', () => {
  beforeEach(() => {
    mockFiles.clear();
    mockCreatedDirectories.length = 0;
    mockDownloadPhoto.mockClear();
    mockUploadPhoto.mockClear();
  });

  it('saves the restore flat in Documents/project-documents, and normalize keeps that path', async () => {
    const restored = await restoreReferenceDocumentBytesFromCloud(openInput(cloudCopy));

    expect(restoredReferenceDocumentFileName('web-document-1', 'Spec-sheet--rev-2-.pdf'))
      .toBe('restored-web-document-1-Spec-sheet--rev-2-.pdf');
    expect(restored.uri).toBe(
      'file:///documents/project-documents/restored-web-document-1-Spec-sheet--rev-2-.pdf',
    );
    expect(mockCreatedDirectories).toEqual(['file:///documents/project-documents']);
    expect(mockFiles.has(restored.uri)).toBe(true);
    expect(normalizeReferenceDocument({ ...cloudCopy, uri: restored.uri }).uri).toBe(restored.uri);
    // The old nested path was dropped, so every open downloaded again.
    expect(normalizeReferenceDocument({
      ...cloudCopy,
      uri: 'file:///documents/restored-reference-documents/web-document-1/spec.pdf',
    }).uri).toBe('');

    // Document delete removes a restored file like any other stored document.
    await deleteStoredReferenceDocument(restored.uri);
    expect(mockFiles.has(restored.uri)).toBe(false);
  });

  it('a second open finds the restored file: nothing is downloaded or uploaded', async () => {
    const restored = await restoreReferenceDocumentBytesFromCloud(openInput(cloudCopy));
    expect(mockDownloadPhoto).toHaveBeenCalledTimes(1);

    // The open saves the path on this phone; the next launch normalizes it.
    const [saved] = withRestoredReferenceDocumentBytes([cloudCopy], restored);
    const reloaded = normalizeReferenceDocument(JSON.parse(JSON.stringify(saved)));
    const resolvedUri = resolveReferenceDocumentUri(reloaded.uri);

    // ensureVerifiedReferenceDocumentBytes restores only when this is empty or missing.
    expect(resolvedUri).toBe(restored.uri);
    expect(mockFiles.has(resolvedUri)).toBe(true);
    expect(reloaded.updatedAt).toBe(cloudCopy.updatedAt);
    expect(daveReferenceDocumentsNeedingCloudUpload({
      local: [reloaded],
      cloud: [normalizeReferenceDocument(cloudCopy)],
    })).toEqual([]);
    expect(mockDownloadPhoto).toHaveBeenCalledTimes(1);
    expect(mockUploadPhoto).not.toHaveBeenCalled();
  });

  it('an open does not overwrite a newer web edit held in a stale local copy', async () => {
    const staleLocal = { ...cloudCopy, notes: 'Before the web edit', cloudUpdatedAt: null };
    const webEdited = {
      ...cloudCopy,
      notes: 'Edited on the web',
      updatedAt: '2026-09-30T09:00:00.000Z',
      cloudUpdatedAt: '2026-09-30T09:00:00.000Z',
    };

    const restored = await restoreReferenceDocumentBytesFromCloud(openInput(staleLocal));
    const [opened] = withRestoredReferenceDocumentBytes([staleLocal], restored);

    expect(opened).toEqual({ ...staleLocal, uri: restored.uri, sizeBytes: 4, contentSha256: SHA });
    expect(mergeDAVEReferenceDocumentRecoveryRecords({ local: [opened], cloud: [webEdited] }))
      .toEqual([expect.objectContaining({ notes: 'Edited on the web', uri: restored.uri })]);
    expect(daveReferenceDocumentsNeedingCloudUpload({ local: [opened], cloud: [webEdited] }))
      .toEqual([]);
  });

  it('App keeps a restore on this phone only, outside the Make Current source range', () => {
    const app = fs.readFileSync(path.join(process.cwd(), 'App.tsx'), 'utf8');
    const ensure = app.match(
      /async function ensureVerifiedReferenceDocumentBytes\([\s\S]+?\n  \}\n/,
    )?.[0] || '';
    const save = app.match(
      /function saveRestoredReferenceDocumentLocally\([\s\S]+?\n  \}\n/,
    )?.[0] || '';

    expect(ensure).toContain('saveRestoredReferenceDocumentLocally(restored);');
    expect(ensure).not.toContain('updateReferenceDocument(');
    expect(ensure).not.toContain('queueReferenceDocumentRecord');
    expect(save).toContain('withRestoredReferenceDocumentBytes(referenceDocumentsCurrentRef.current, restored)');
    expect(save).not.toContain('queueReferenceDocumentRecord');
    expect(save).not.toContain('updatedAt');
    expect(app.indexOf('function saveRestoredReferenceDocumentLocally('))
      .toBeGreaterThan(app.indexOf('async function ensureVerifiedReferenceDocumentBytes('));
  });
});
