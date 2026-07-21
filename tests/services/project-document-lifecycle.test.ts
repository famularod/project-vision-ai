/**
 * Audit P1-23: stale 'uploading' documents recover to retryable 'failed'
 * at startup; all other statuses pass through untouched.
 */

import {
  cleanupProjectDocumentOwnedFileForRecordRemoval,
  importProjectDocumentIntoOwnedStorage,
  OWNED_PROJECT_DOCUMENTS_FOLDER,
  recoverStaleUploadingDocuments,
  requireOwnedProjectDocumentAccess,
} from '../../services/ProjectDocumentLifecycle';
import type { OwnedLocalFileStoreDependencies } from '../../services/OwnedLocalFileStore';

const NOW = '2026-07-18T12:00:00.000Z';

describe('recoverStaleUploadingDocuments (audit P1-23)', () => {
  it('converts stale uploading documents to retryable failed', () => {
    const documents = [
      { id: 'a', status: 'uploading' as const, updatedAt: '2026-07-17T00:00:00Z' },
      { id: 'b', status: 'uploaded' as const, updatedAt: '2026-07-17T00:00:00Z' },
    ];

    const recovered = recoverStaleUploadingDocuments(documents, NOW);

    expect(recovered[0].status).toBe('failed');
    expect(recovered[0].updatedAt).toBe(NOW);
    expect(recovered[1]).toEqual(documents[1]);
  });

  it('leaves local, uploaded, and failed documents untouched', () => {
    const documents = [
      { id: 'a', status: 'local' as const, updatedAt: 't' },
      { id: 'b', status: 'failed' as const, updatedAt: 't' },
      { id: 'c', status: 'uploaded' as const, updatedAt: 't' },
    ];

    expect(recoverStaleUploadingDocuments(documents, NOW)).toEqual(documents);
  });
});

describe('owned project-document import (audit P0-09/P1-23)', () => {
  it('uses a v2 folder outside the legacy reference-document delete root', () => {
    expect(OWNED_PROJECT_DOCUMENTS_FOLDER).toBe('project-documents-v2');
    expect(OWNED_PROJECT_DOCUMENTS_FOLDER).not.toBe('project-documents');
  });

  it('returns only a verified app-owned path and manifest identity', async () => {
    const sourceUri = 'content://picker/specification';
    const ownedRoot = 'file:///app/Documents/project-documents-v2';
    const fileId = '550e8400-e29b-41d4-a716-446655440000';
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const files = new Map<string, Uint8Array>([[sourceUri, bytes]]);
    const dependencies: OwnedLocalFileStoreDependencies = {
      generateOpaqueFileId: () => fileId,
      ensureDirectory: async () => undefined,
      copyFile: async (source, destination) => {
        const sourceBytes = files.get(source);
        if (!sourceBytes) throw new Error('missing source');
        files.set(destination, new Uint8Array(sourceBytes));
      },
      readBytes: async uri => {
        const value = files.get(uri);
        if (!value) throw new Error('missing file');
        return new Uint8Array(value);
      },
      statFile: async uri => ({
        exists: files.has(uri),
        sizeBytes: files.get(uri)?.byteLength ?? null,
      }),
      deleteFile: async uri => {
        if (!files.delete(uri)) throw new Error('missing file');
      },
      sha256: async value => Array.from(value)
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('')
        .padEnd(64, '0')
        .slice(0, 64),
    };

    const imported = await importProjectDocumentIntoOwnedStorage({
      sourceUri,
      ownedRoot,
      extension: 'pdf',
      mimeType: 'application/pdf',
      dependencies,
    });

    expect(imported.fileId).toBe(fileId);
    expect(imported.localUri).toBe(`${ownedRoot}/${fileId}.pdf`);
    expect(imported.record).toMatchObject({
      kind: 'project_document',
      sizeBytes: bytes.byteLength,
      mimeType: 'application/pdf',
    });
    expect(imported.manifest.files[fileId]).toEqual(imported.record);
    expect((imported as { sourceUri?: string }).sourceUri).toBeUndefined();
  });

  it('rejects a legacy arbitrary local URI before it can be read or uploaded', () => {
    expect(() => requireOwnedProjectDocumentAccess({
      localUri: 'file:///private/arbitrary-document.pdf',
      ownedFileId: null,
      ownedFileManifest: null,
    })).toThrow('must be added again');
  });

  it('deletes a verified owned file when its document record is removed', async () => {
    const sourceUri = 'content://picker/schedule';
    const ownedRoot = 'file:///app/Documents/project-documents-v2';
    const fileId = '550e8400-e29b-41d4-a716-446655440001';
    const bytes = new Uint8Array([5, 6, 7, 8]);
    const files = new Map<string, Uint8Array>([[sourceUri, bytes]]);
    const dependencies: OwnedLocalFileStoreDependencies = {
      generateOpaqueFileId: () => fileId,
      ensureDirectory: async () => undefined,
      copyFile: async (source, destination) => {
        const sourceBytes = files.get(source);
        if (!sourceBytes) throw new Error('missing source');
        files.set(destination, new Uint8Array(sourceBytes));
      },
      readBytes: async uri => {
        const value = files.get(uri);
        if (!value) throw new Error('missing file');
        return new Uint8Array(value);
      },
      statFile: async uri => ({
        exists: files.has(uri),
        sizeBytes: files.get(uri)?.byteLength ?? null,
      }),
      deleteFile: async uri => {
        files.delete(uri);
      },
      sha256: async value => Array.from(value)
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('')
        .padEnd(64, '0')
        .slice(0, 64),
    };
    const imported = await importProjectDocumentIntoOwnedStorage({
      sourceUri,
      ownedRoot,
      extension: 'pdf',
      mimeType: 'application/pdf',
      dependencies,
    });

    const result = await cleanupProjectDocumentOwnedFileForRecordRemoval({
      document: {
        ownedFileId: imported.fileId,
        ownedFileManifest: imported.manifest,
        localUri: imported.localUri,
      },
      ownedRoot,
      dependencies,
    });

    expect(result.status).toBe('deleted');
    expect(files.has(imported.localUri)).toBe(false);
  });

  it('does not let a stale prior-installation path block record removal', async () => {
    const ownedRoot = 'file:///current/Documents/project-documents-v2';
    const fileId = '550e8400-e29b-41d4-a716-446655440002';
    const record = {
      fileId,
      kind: 'project_document' as const,
      generatedBasename: `${fileId}.pdf`,
      relativePath: `${fileId}.pdf`,
      sha256: '1'.repeat(64),
      sizeBytes: 10,
      mimeType: 'application/pdf',
    };
    const dependencies: OwnedLocalFileStoreDependencies = {
      generateOpaqueFileId: () => fileId,
      ensureDirectory: async () => undefined,
      copyFile: async () => undefined,
      readBytes: async () => {
        throw new Error('old container is unavailable');
      },
      statFile: async () => ({ exists: false, sizeBytes: null }),
      deleteFile: async () => {
        throw new Error('must not delete an unverified path');
      },
      sha256: async () => '1'.repeat(64),
    };

    const result = await cleanupProjectDocumentOwnedFileForRecordRemoval({
      document: {
        ownedFileId: fileId,
        ownedFileManifest: {
          version: 1,
          files: { [fileId]: record },
        },
        localUri:
          'file:///previous-install/Documents/project-documents-v2/' +
          `${fileId}.pdf`,
      },
      ownedRoot,
      dependencies,
    });

    expect(result.status).toBe('unavailable');
  });
});
