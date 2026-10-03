/**
 * Audit P1-23: stale 'uploading' documents recover to retryable 'failed'
 * at startup; all other statuses pass through untouched.
 */

import {
  buildSharedReferenceDocument,
  cleanupProjectDocumentOwnedFileForRecordRemoval,
  findSharedReferenceDocumentForProjectDocument,
  importProjectDocumentIntoOwnedStorage,
  OWNED_PROJECT_DOCUMENTS_FOLDER,
  referenceCategoryForProjectDocument,
  recoverStaleUploadingDocuments,
  requireOwnedProjectDocumentAccess,
  synchronizeSharedReferenceDocumentMetadata,
} from '../../services/ProjectDocumentLifecycle';
import type { OwnedLocalFileStoreDependencies } from '../../services/OwnedLocalFileStore';

const NOW = '2026-07-18T12:00:00.000Z';
// The phone keys a project document by its project name (App.tsx
// authorityProjectId). Earlier fixtures used "project-2375", a key the app
// never produces for "2375 Compliance Project" (audit A7 M1).
const KEY_2375 = 'project-2375-compliance-project';
const KEY_2321 = 'project-2321-compliance-project';
const CLOUD_2375 = '72e941d8-8114-4082-a976-ae5b2b5daba9';
const CLOUD_2321 = '607c7eed-5dea-4a5a-8b52-0f165c71c4b5';

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

describe('shared project-document metadata', () => {
  it('finds the shared cloud download record when another device has no local file', () => {
    const shared = buildSharedReferenceDocument({
      document: {
        id: 'drawing-1',
        referenceDocumentId: 'shared-drawing-1',
        projectId: KEY_2375,
        name: '2375-site-plan.pdf',
        category: 'Drawing',
        storagePath: 'project-2375/drawing-1/2375-site-plan.pdf',
        importedAt: NOW,
      },
      projectName: '2375 Compliance Project',
      contentSha256: 'a'.repeat(64),
      updatedAt: NOW,
    });

    expect(findSharedReferenceDocumentForProjectDocument({
      id: 'drawing-1',
      referenceDocumentId: 'shared-drawing-1',
      projectId: KEY_2375,
      storagePath: 'project-2375/drawing-1/2375-site-plan.pdf',
    }, [shared])).toBe(shared);
  });

  it('does not borrow a same-named cloud record from another project', () => {
    const shared = buildSharedReferenceDocument({
      document: {
        id: 'drawing-1',
        projectId: KEY_2321,
        name: 'site-plan.pdf',
        category: 'Drawing',
        storagePath: 'project-2321/drawing-1/site-plan.pdf',
        importedAt: NOW,
      },
      projectName: '2321 Compliance Project',
      contentSha256: 'b'.repeat(64),
      updatedAt: NOW,
    });

    expect(findSharedReferenceDocumentForProjectDocument({
      id: 'drawing-1',
      projectId: KEY_2375,
      storagePath: 'project-2321/drawing-1/site-plan.pdf',
    }, [shared])).toBeNull();
  });

  it('preserves Drawing classification and stable identity for cloud sync', () => {
    const reference = buildSharedReferenceDocument({
      document: {
        id: 'drawing-1',
        referenceDocumentId: null,
        projectId: KEY_2375,
        name: '2375-site-plan.pdf',
        category: 'Drawing',
        mimeType: 'application/pdf',
        sizeBytes: 4_900_484,
        storagePath: 'project-2375/drawing-1/2375-site-plan.pdf',
        note: 'Issued for field use',
        drawingNumber: 'A2.01',
        drawingRevision: '3',
        drawingDiscipline: 'Architectural',
        drawingStatus: 'For Construction',
        drawingIssuedAt: '2026-07-17',
        webVersionGroupId: 'drawing-family-a2.01',
        importedAt: NOW,
      },
      projectName: '2375 Compliance Project',
      contentSha256: 'a'.repeat(64),
      updatedAt: NOW,
    });

    expect(reference).toMatchObject({
      id: 'drawing-1',
      category: 'Drawing',
      // Named, not keyed: the upload resolves the cloud id (audit A7 M1).
      projectId: null,
      projectName: '2375 Compliance Project',
      projectNames: ['2375 Compliance Project'],
      storagePath: 'project-2375/drawing-1/2375-site-plan.pdf',
      sizeBytes: 4_900_484,
      contentSha256: 'a'.repeat(64),
      isCurrent: false,
      drawingNumber: 'A2.01',
      drawingRevision: '3',
      drawingDiscipline: 'Architectural',
      drawingStatus: 'For Construction',
      drawingIssuedAt: '2026-07-17',
      webVersionGroupId: 'drawing-family-a2.01',
    });
  });

  it('synchronizes later mobile edits without erasing hosted proof or current state', () => {
    const original = {
      ...buildSharedReferenceDocument({
        document: {
          id: 'drawing-1',
          projectId: KEY_2375,
          name: 'site-plan.pdf',
          category: 'Drawing' as const,
          drawingNumber: 'C5',
          drawingRevision: '1',
          drawingStatus: 'For Review' as const,
          importedAt: NOW,
        },
        projectName: '2375 Compliance Project',
        contentSha256: 'c'.repeat(64),
        updatedAt: NOW,
      }),
      isCurrent: true,
      extractionStatus: 'complete' as const,
      extractedPages: [{
        pageNumber: 1,
        text: 'verified evidence',
        regions: [],
      }],
      ecosHostedIndexStatus: 'Ready for ECOS' as const,
      documentIntelligenceVersion: 'ecos-document-intelligence/2.0' as const,
      documentVisualIndexVersion: 'ecos-visual-index/3.0' as const,
    };

    const synchronized = synchronizeSharedReferenceDocumentMetadata({
      sharedDocument: original,
      document: {
        id: 'drawing-1',
        projectId: KEY_2375,
        name: 'renamed-site-plan.pdf',
        category: 'Drawing',
        drawingNumber: 'C5',
        drawingRevision: '2',
        drawingDiscipline: 'Civil',
        drawingStatus: 'For Construction',
        drawingIssuedAt: '2026-08-09',
        webVersionGroupId: 'drawing-family-c5',
        importedAt: NOW,
      },
      projectName: '2375 Compliance Project',
      updatedAt: '2026-08-09T09:00:00.000Z',
    });

    expect(synchronized).toMatchObject({
      name: 'renamed-site-plan',
      originalFileName: 'renamed-site-plan.pdf',
      drawingRevision: '2',
      drawingDiscipline: 'Civil',
      drawingStatus: 'For Construction',
      drawingIssuedAt: '2026-08-09',
      webVersionGroupId: 'drawing-family-c5',
      isCurrent: true,
      extractionStatus: 'complete',
      ecosHostedIndexStatus: 'Ready for ECOS',
      documentIntelligenceVersion: 'ecos-document-intelligence/2.0',
      documentVisualIndexVersion: 'ecos-visual-index/3.0',
    });
    expect(synchronized.extractedPages).toEqual(original.extractedPages);
  });

  // Whole-app audit A8 pass 1 F3 (30 Sep 2026): a Current drawing's family is
  // its webVersionGroupId or, without one, its drawing number, and the cloud
  // refuses to move a Current drawing out of its family outside Make Current.
  // A number correction on the phone keeps the old family.
  it('keeps a renumbered Current drawing in its drawing family', () => {
    const currentDrawing = {
      ...buildSharedReferenceDocument({
        document: {
          id: 'drawing-1',
          projectId: KEY_2375,
          name: 'site-plan.pdf',
          category: 'Drawing' as const,
          drawingNumber: ' C5 ',
          importedAt: NOW,
        },
        projectName: '2375 Compliance Project',
        contentSha256: 'c'.repeat(64),
        updatedAt: NOW,
      }),
      isCurrent: true,
    };
    const renumber = (sharedDocument: typeof currentDrawing, drawingNumber: string) =>
      synchronizeSharedReferenceDocumentMetadata({
        sharedDocument,
        document: {
          id: 'drawing-1',
          projectId: KEY_2375,
          name: 'site-plan.pdf',
          category: 'Drawing',
          drawingNumber,
          importedAt: NOW,
        },
        projectName: '2375 Compliance Project',
        updatedAt: '2026-09-30T09:00:00.000Z',
      });

    const corrected = renumber(currentDrawing, 'C-501');
    expect(corrected).toMatchObject({ drawingNumber: 'C-501', webVersionGroupId: 'c5' });
    // Later keystrokes keep the family the first one recorded.
    expect(renumber({ ...currentDrawing, ...corrected }, 'C-5012').webVersionGroupId).toBe('c5');

    // Nothing is recorded when the family would not change, when the drawing
    // is not Current, when it already has a family, or when it had no number.
    expect(renumber(currentDrawing, 'c5').webVersionGroupId).toBeNull();
    expect(renumber({ ...currentDrawing, isCurrent: false }, 'C-501').webVersionGroupId).toBeNull();
    expect(renumber({ ...currentDrawing, webVersionGroupId: 'site-plans' }, 'C-501').webVersionGroupId)
      .toBe('site-plans');
    expect(renumber({ ...currentDrawing, drawingNumber: null }, 'C-501').webVersionGroupId).toBeNull();
    expect(renumber({ ...currentDrawing, category: 'Specifications' }, 'C-501').webVersionGroupId)
      .toBeNull();
  });

  it('never shares the phone name key as a project id (audit A7 M1)', () => {
    const source = {
      id: 'spec-1',
      projectId: KEY_2375,
      name: 'spec.pdf',
      category: 'Contract' as const,
      importedAt: NOW,
    };
    expect(buildSharedReferenceDocument({
      document: source,
      projectName: '2375 Compliance Project',
      contentSha256: null,
      updatedAt: NOW,
    })).toMatchObject({
      projectId: null,
      projectName: '2375 Compliance Project',
      projectNames: ['2375 Compliance Project'],
    });
    // A project this phone cannot name keeps its key, so the upload is held
    // for review instead of being sent without a project.
    expect(buildSharedReferenceDocument({
      document: source,
      projectName: null,
      contentSha256: null,
      updatedAt: NOW,
    }).projectId).toBe(KEY_2375);
    expect(buildSharedReferenceDocument({
      document: { ...source, projectId: CLOUD_2375 },
      projectName: '2375 Compliance Project',
      contentSha256: null,
      updatedAt: NOW,
    }).projectId).toBe(CLOUD_2375);
  });

  it('keeps a document linked after its shared record gains the cloud project id (audit A7 M1)', () => {
    const uploaded = {
      ...buildSharedReferenceDocument({
        document: {
          id: 'spec-1',
          projectId: KEY_2375,
          name: 'spec.pdf',
          category: 'Contract',
          storagePath: 'owner/project-documents/spec-1/spec.pdf',
          importedAt: NOW,
        },
        projectName: '2375 Compliance Project',
        contentSha256: null,
        updatedAt: NOW,
      }),
      projectId: CLOUD_2375,
    };
    const phoneDocument = {
      id: 'spec-1',
      referenceDocumentId: 'spec-1',
      projectId: KEY_2375,
      storagePath: 'owner/project-documents/spec-1/spec.pdf',
    };
    expect(findSharedReferenceDocumentForProjectDocument(phoneDocument, [uploaded]))
      .toBe(uploaded);
    // Another project's uploaded record is still never borrowed.
    const otherProject = {
      ...uploaded,
      projectId: CLOUD_2321,
      projectName: '2321 Compliance Project',
      projectNames: ['2321 Compliance Project'],
    };
    expect(findSharedReferenceDocumentForProjectDocument(phoneDocument, [otherProject]))
      .toBeNull();

    // A later edit keeps the cloud id rather than writing the key back.
    const edited = synchronizeSharedReferenceDocumentMetadata({
      sharedDocument: uploaded,
      document: {
        id: 'spec-1',
        projectId: KEY_2375,
        name: 'spec-rev-b.pdf',
        category: 'Contract',
        importedAt: NOW,
      },
      projectName: '2375 Compliance Project',
      updatedAt: '2026-07-19T12:00:00.000Z',
    });
    expect(edited).toMatchObject({
      name: 'spec-rev-b',
      projectId: CLOUD_2375,
      projectName: '2375 Compliance Project',
    });
    expect(findSharedReferenceDocumentForProjectDocument(phoneDocument, [edited]))
      .toBe(edited);
  });

  it('does not make an uploaded schedule current without PM confirmation', () => {
    expect(referenceCategoryForProjectDocument('Schedule')).toBe('Schedules');
    expect(buildSharedReferenceDocument({
      document: {
        id: 'schedule-1',
        projectId: KEY_2321,
        name: 'lookahead.pdf',
        category: 'Schedule',
        importedAt: NOW,
      },
      projectName: '2321 Compliance Project',
      contentSha256: null,
      updatedAt: NOW,
    }).isCurrent).toBe(false);
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
