/**
 * Audit P1-23: stale 'uploading' documents recover to retryable 'failed'
 * at startup; all other statuses pass through untouched.
 */

import {
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
});
