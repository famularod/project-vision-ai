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
  projectDocumentsForExactWorkspace,
  referenceCategoryForProjectDocument,
  recoverStaleUploadingDocuments,
  requireOwnedProjectDocumentAccess,
  synchronizeSharedReferenceDocumentMetadata,
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

describe('shared project-document metadata', () => {
  it('projects exact cloud documents into a fresh-device workspace without mixing projects', () => {
    const sharedA1 = buildSharedReferenceDocument({
      document: {
        id: 'local-a1',
        referenceDocumentId: 'shared-a1',
        projectId: 'project-a',
        name: 'schedule-a.pdf',
        category: 'Schedule',
        importedAt: NOW,
      },
      projectName: 'Shared Name',
      contentSha256: 'a'.repeat(64),
      updatedAt: NOW,
    });
    const sharedA2 = {
      ...buildSharedReferenceDocument({
        document: {
          id: 'shared-a2',
          projectId: 'project-a',
          name: 'plan-a.pdf',
          category: 'Drawing',
          importedAt: NOW,
        },
        projectName: 'Shared Name',
        contentSha256: 'b'.repeat(64),
        updatedAt: NOW,
      }),
      category: 'Plans',
    };
    const sharedB = buildSharedReferenceDocument({
      document: {
        id: 'shared-b',
        projectId: 'project-b',
        name: 'plan-b.pdf',
        category: 'Drawing',
        importedAt: NOW,
      },
      projectName: 'Shared Name',
      contentSha256: 'c'.repeat(64),
      updatedAt: NOW,
    });
    const unbound = { ...sharedB, id: 'unbound', projectId: null };
    const localA = {
      id: 'local-a1',
      projectId: 'project-a',
      name: 'schedule-a.pdf',
      category: 'Schedule' as const,
      referenceDocumentId: 'shared-a1',
      createdAt: NOW,
      updatedAt: NOW,
      importedAt: NOW,
      status: 'uploaded' as const,
    };

    const workspace = projectDocumentsForExactWorkspace({
      projectId: 'project-a',
      projectDocuments: [localA],
      referenceDocuments: [sharedA1, sharedA2, sharedB, unbound],
    });

    expect(workspace.map(document => document.id)).toEqual(['local-a1', 'shared-a2']);
    expect(workspace[0]).toBe(localA);
    expect(workspace[1]).toMatchObject({
      projectId: 'project-a',
      category: 'Drawing',
      referenceDocumentId: 'shared-a2',
      status: 'uploaded',
      sharedReferenceOnly: true,
    });
  });

  it('fails closed when the selected project ID is absent or noncanonical', () => {
    const shared = buildSharedReferenceDocument({
      document: {
        id: 'shared-a',
        projectId: 'project-a',
        name: 'plan.pdf',
        category: 'Drawing',
        importedAt: NOW,
      },
      projectName: 'Project A',
      contentSha256: 'd'.repeat(64),
      updatedAt: NOW,
    });

    expect(projectDocumentsForExactWorkspace({
      projectId: null,
      projectDocuments: [],
      referenceDocuments: [shared],
    })).toEqual([]);
    expect(projectDocumentsForExactWorkspace({
      projectId: ' project-a ',
      projectDocuments: [],
      referenceDocuments: [shared],
    })).toEqual([]);
  });

  it('finds the shared cloud download record when another device has no local file', () => {
    const shared = buildSharedReferenceDocument({
      document: {
        id: 'drawing-1',
        referenceDocumentId: 'shared-drawing-1',
        projectId: 'project-2375',
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
      projectId: 'project-2375',
      storagePath: 'project-2375/drawing-1/2375-site-plan.pdf',
    }, [shared])).toBe(shared);
  });

  it('does not borrow a same-named cloud record from another project', () => {
    const shared = buildSharedReferenceDocument({
      document: {
        id: 'drawing-1',
        projectId: 'project-2321',
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
      projectId: 'project-2375',
      storagePath: 'project-2321/drawing-1/site-plan.pdf',
    }, [shared])).toBeNull();
  });

  it('preserves Drawing classification and stable identity for cloud sync', () => {
    const reference = buildSharedReferenceDocument({
      document: {
        id: 'drawing-1',
        referenceDocumentId: null,
        projectId: 'project-2375',
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
      projectId: 'project-2375',
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

  it('invalidates current authority and hosted proof when drawing identity changes', () => {
    const original = {
      ...buildSharedReferenceDocument({
        document: {
          id: 'drawing-1',
          projectId: 'project-2375',
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
        projectId: 'project-2375',
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
      isCurrent: false,
      extractionStatus: 'pending',
      ecosHostedIndexStatus: null,
      documentIntelligenceVersion: null,
      documentVisualIndexVersion: null,
    });
    expect(synchronized.extractedPages).toEqual([]);
  });

  it('preserves proof when an edit changes only non-identity notes', () => {
    const original = {
      ...buildSharedReferenceDocument({
        document: {
          id: 'drawing-1',
          projectId: 'project-2375',
          name: 'site-plan.pdf',
          category: 'Drawing' as const,
          drawingNumber: 'C5',
          drawingRevision: '1',
          drawingStatus: 'For Construction' as const,
          importedAt: NOW,
        },
        projectName: '2375 Compliance Project',
        contentSha256: 'c'.repeat(64),
        updatedAt: NOW,
      }),
      isCurrent: true,
      extractionStatus: 'complete' as const,
      extractedPages: [{ pageNumber: 1, text: 'verified evidence', regions: [] }],
      ecosHostedIndexStatus: 'Ready for ECOS' as const,
    };

    const synchronized = synchronizeSharedReferenceDocumentMetadata({
      sharedDocument: original,
      document: {
        id: 'drawing-1',
        projectId: 'project-2375',
        name: 'site-plan.pdf',
        note: 'PM note only',
        category: 'Drawing',
        drawingNumber: 'C5',
        drawingRevision: '1',
        drawingStatus: 'For Construction',
        importedAt: NOW,
      },
      projectName: '2375 Compliance Project',
    });

    expect(synchronized).toMatchObject({
      notes: 'PM note only',
      isCurrent: true,
      extractionStatus: 'complete',
      ecosHostedIndexStatus: 'Ready for ECOS',
    });
    expect(synchronized.extractedPages).toEqual(original.extractedPages);
  });

  it('invalidates current authority for the canonical Plans drawing alias', () => {
    const original = {
      ...buildSharedReferenceDocument({
        document: {
          id: 'plans-1',
          projectId: 'project-2375',
          name: 'civil-plans.pdf',
          category: 'Plans' as never,
          drawingNumber: 'C5',
          drawingRevision: '1',
          drawingStatus: 'For Construction' as const,
          importedAt: NOW,
        },
        projectName: '2375 Compliance Project',
        contentSha256: 'c'.repeat(64),
        updatedAt: NOW,
      }),
      isCurrent: true,
      extractionStatus: 'complete' as const,
      extractedPages: [{ pageNumber: 1, text: 'verified evidence', regions: [] }],
      ecosHostedIndexStatus: 'Ready for ECOS' as const,
    };

    const synchronized = synchronizeSharedReferenceDocumentMetadata({
      sharedDocument: original,
      document: {
        id: 'plans-1',
        projectId: 'project-2375',
        name: 'civil-plans.pdf',
        category: 'Plans' as never,
        drawingNumber: 'C5',
        drawingRevision: '2',
        drawingStatus: 'For Construction',
        importedAt: NOW,
      },
      projectName: '2375 Compliance Project',
    });

    expect(synchronized).toMatchObject({
      drawingRevision: '2',
      isCurrent: false,
      extractionStatus: 'pending',
      ecosHostedIndexStatus: null,
    });
    expect(synchronized.extractedPages).toEqual([]);
  });

  it('does not make an uploaded schedule current without PM confirmation', () => {
    expect(referenceCategoryForProjectDocument('Schedule')).toBe('Schedules');
    expect(buildSharedReferenceDocument({
      document: {
        id: 'schedule-1',
        projectId: 'project-2321',
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
