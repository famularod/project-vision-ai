import {
  createDAVEWebSupabaseGateway,
  DAVEWebArtifactAccessError,
  DAVEWebAuthorizationError,
  DAVEWebDocumentMutationError,
  DAVEWebTaskMutationError,
} from '../../services/DAVEWebSupabaseClient';
import type { DAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import {
  buildDAVEWebReportDraft,
  buildDAVEWebReportSource,
  formatDAVEWebReport,
} from '../../services/DAVEWebOperations';
import { ECOS_DRAWING_REQUIRED_TILE_KEYS } from '../../services/ECOSDrawingVisualCoverage';
import type { ScheduleItem } from '../../types';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

function queryWithRows(rows: unknown[]) {
  const query: Record<string, jest.Mock> = {};
  for (const method of ['select', 'eq', 'order']) {
    query[method] = jest.fn(() => query);
  }
  query.range = jest.fn(async () => ({ data: rows, error: null, status: 200, count: rows.length }));
  (query as any).fixtureRows = rows;
  return query;
}

function cleanupQueryWithRows(rows: unknown[] = []) {
  const query: Record<string, jest.Mock> = {};
  for (const method of ['select', 'eq', 'in', 'order']) {
    query[method] = jest.fn(() => query);
  }
  query.limit = jest.fn(async () => ({ data: rows, error: null, status: 200 }));
  return query;
}

function exactRowQuery(row: unknown) {
  const query: Record<string, jest.Mock> = {};
  for (const method of ['select', 'eq']) {
    query[method] = jest.fn(() => query);
  }
  query.maybeSingle = jest.fn(async () => ({ data: row, error: null, status: 200 }));
  return query;
}

function clientFixture({ authorized = true }: { authorized?: boolean } = {}) {
  const queries = new Map([
    ['projects', queryWithRows([{ id: 'p1' }])],
    ['schedule_items', queryWithRows([])],
    ['project_updates', queryWithRows([])],
    ['reference_documents', queryWithRows([])],
    ['dave_sync_tombstones', queryWithRows([])],
  ]);
  const cleanupQuery = cleanupQueryWithRows();
  const from = jest.fn((table: string) =>
    table === 'dave_storage_cleanup_intents' ? cleanupQuery : queries.get(table));
  const rpc = jest.fn(async (name: string) => {
    if (name === 'dave_is_app_owner') return { data: authorized, error: null, status: 200 };
    if (name === 'dave_list_reference_document_metadata') {
      return {
        data: (queries.get('reference_documents') as any)?.fixtureRows ?? [],
        error: null,
        status: 200,
      };
    }
    return { data: [], error: null, status: 200 };
  });
  const auth = {
    getUser: jest.fn(async () => ({ data: { user: { id: 'owner-1' } }, error: null })),
    getSession: jest.fn(async () => ({ data: { session: null }, error: null })),
    onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
    signInWithPassword: jest.fn(),
    signOut: jest.fn(async () => ({ error: null })),
  };
  const createSignedUrl = jest.fn(async (path: string) => ({
    data: { signedUrl: `https://signed.example/${path}` },
    error: null,
  }));
  const storageFrom = jest.fn(() => ({ createSignedUrl }));
  return {
    client: { auth, from, rpc, storage: { from: storageFrom } } as any,
    auth,
    from,
    rpc,
    queries,
    cleanupQuery,
    createSignedUrl,
    storageFrom,
  };
}

describe('DAVE browser Supabase gateway', () => {
  test('saves a Google Drive reference with a protected processing copy', async () => {
    const duplicateRead = queryWithRows([]);
    const documentInsert = mutationQuery({ data: null, error: null });
    let referenceDocumentCalls = 0;
    const from = jest.fn((table: string) => {
      if (table !== 'reference_documents') throw new Error(`Unexpected table ${table}`);
      referenceDocumentCalls += 1;
      return referenceDocumentCalls === 1 ? duplicateRead : documentInsert;
    });
    const rpc = jest.fn(async (name: string) => name === 'dave_is_app_owner'
      ? { data: true, error: null, status: 200 }
      : { data: { indexed_pages: 1, indexed_chunks: 1 }, error: null, status: 200 });
    const auth = {
      getUser: jest.fn(async () => ({ data: { user: { id: 'owner-1' } }, error: null })),
      getSession: jest.fn(async () => ({ data: { session: null }, error: null })),
      onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
      signInWithPassword: jest.fn(),
      signOut: jest.fn(async () => ({ error: null })),
    };
    const upload = jest.fn(async () => ({ data: { path: 'owner-1/drive/drive-drawing-1/A101.pdf' }, error: null }));
    const remove = jest.fn(async () => ({ data: [], error: null }));
    const storageFrom = jest.fn(() => ({ upload, remove }));
    const gateway = createDAVEWebSupabaseGateway({ auth, from, rpc, storage: { from: storageFrom } } as any);

    await gateway.saveAuthorizedLinkedReferenceDocument({
      bytes: new Uint8Array([1, 2, 3, 4]).buffer as ArrayBuffer,
      document: {
        id: 'drive-drawing-1',
        name: 'A101',
        originalFileName: 'A101.pdf',
        uri: '',
        mimeType: 'application/pdf',
        category: 'Drawing',
        notes: '',
        isCurrent: false,
        importedAt: '2026-08-04T12:00:00.000Z',
        sourceProvider: 'google_drive',
        externalSource: {
          provider: 'google_drive',
          fileId: 'drive-file-1',
          name: 'A101.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 4,
          modifiedTime: '2026-08-04T11:00:00.000Z',
          revisionId: 'revision-1',
          md5Checksum: 'drive-md5',
          resourceKey: null,
          webViewLink: 'https://drive.google.com/file/d/drive-file-1/view',
        },
        sizeBytes: 4,
        webFileFingerprint: 'a'.repeat(64),
        contentSha256: 'a'.repeat(64),
        extractedText: null,
        extractionStatus: 'pending',
        extractedPages: [],
      },
    });

    expect(storageFrom).toHaveBeenCalledWith('project-documents');
    expect(upload).toHaveBeenCalledWith(
      'owner-1/drive/drive-drawing-1/A101.pdf',
      expect.any(ArrayBuffer),
      expect.objectContaining({ contentType: 'application/pdf', upsert: false }),
    );
    expect(documentInsert.insert).toHaveBeenCalledWith(expect.objectContaining({
      id: 'drive-drawing-1',
      document_data: expect.objectContaining({
        sourceProvider: 'google_drive',
        externalSource: expect.objectContaining({ fileId: 'drive-file-1' }),
        extractedText: null,
        extractedPages: [],
        storagePath: 'owner-1/drive/drive-drawing-1/A101.pdf',
      }),
    }));
    expect(rpc).not.toHaveBeenCalledWith('ecos_replace_document_index', expect.anything());
    expect(rpc).toHaveBeenCalledWith('ecos_enqueue_hosted_index', {
      p_document_id: 'drive-drawing-1',
    });
  });

  test('checks the server owner function before reading any table', async () => {
    const fixture = clientFixture({ authorized: false });
    const gateway = createDAVEWebSupabaseGateway(fixture.client);

    await expect(gateway.loadAuthorizedRows()).rejects.toBeInstanceOf(DAVEWebAuthorizationError);
    expect(fixture.rpc).toHaveBeenCalledWith('dave_is_app_owner');
    expect(fixture.from).not.toHaveBeenCalled();
  });

  test('applies the authenticated owner id to every read collection', async () => {
    const fixture = clientFixture();
    const gateway = createDAVEWebSupabaseGateway(fixture.client);

    await gateway.loadAuthorizedRows();

    expect(fixture.from.mock.calls.map(call => call[0])).toEqual([
      'projects',
      'schedule_items',
      'project_updates',
      'dave_sync_tombstones',
    ]);
    for (const [table, query] of fixture.queries) {
      if (table === 'reference_documents') continue;
      expect(query.eq).toHaveBeenCalledWith('owner_id', 'owner-1');
    }
    expect(fixture.rpc).toHaveBeenCalledWith('dave_list_reference_document_metadata');
  });

  test('loads compact reference-document metadata through the owner-only RPC', async () => {
    const fixture = clientFixture();
    const referenceQuery = queryWithRows([{
      id: 'drawing-1',
      owner_id: 'owner-1',
      name: 'A101',
      category: 'Drawing',
      updated_at: '2026-08-13T20:00:00.000Z',
      document_data: {
        id: 'drawing-1',
        name: 'A101',
        originalFileName: 'A101.pdf',
        storagePath: 'owner-1/drawings/A101.pdf',
        sourcePageCount: 12,
      },
    }]);
    fixture.queries.set('reference_documents', referenceQuery);
    const gateway = createDAVEWebSupabaseGateway(fixture.client);

    const rows = await gateway.loadAuthorizedRows();

    expect(fixture.rpc).toHaveBeenCalledWith('dave_list_reference_document_metadata');
    expect(referenceQuery.select).not.toHaveBeenCalled();
    expect(rows.referenceDocuments).toEqual([
      expect.objectContaining({
        id: 'drawing-1',
        document_data: expect.objectContaining({
          id: 'drawing-1',
          name: 'A101',
          sourcePageCount: 12,
          storagePath: 'owner-1/drawings/A101.pdf',
        }),
      }),
    ]);
  });

  test('clears cached hosted Ready proof when the authorized status result is empty', async () => {
    const fixture = clientFixture();
    fixture.queries.set('reference_documents', queryWithRows([{
      id: 'drawing-1',
      document_data: {
        id: 'drawing-1',
        name: 'A101',
        ecosHostedIndexStatus: 'Ready for ECOS',
        ecosHostedIndexProgressPercent: 100,
        ecosHostedIndexEvidenceVersion: 'ecos-hosted-evidence/1.3',
        ecosVerifiedIndexCommitVersion: 'ecos-verified-index-commit/1.0',
        ecosVerifiedIndexCommittedSha256: 'a'.repeat(64),
      },
    }]));
    (fixture.rpc as jest.Mock).mockImplementation(async (name: string) => {
      if (name === 'dave_is_app_owner') return { data: true, error: null, status: 200 };
      if (name === 'dave_list_reference_document_metadata') {
        return { data: (fixture.queries.get('reference_documents') as any).fixtureRows, error: null, status: 200 };
      }
      return { data: [], error: null, status: 200 };
    });
    const gateway = createDAVEWebSupabaseGateway(fixture.client);

    const rows = await gateway.loadAuthorizedRows();

    expect((rows.referenceDocuments[0] as any).document_data).toMatchObject({
      ecosHostedIndexStatus: null,
      ecosHostedIndexProgressPercent: null,
      ecosHostedIndexEvidenceVersion: null,
      ecosVerifiedIndexCommitVersion: null,
      ecosVerifiedIndexCommittedSha256: null,
    });
  });

  test('rejects a reference row whose owner-controlled embedded id disagrees with its durable id', async () => {
    const fixture = clientFixture();
    fixture.queries.set('reference_documents', queryWithRows([
      {
        id: 'drawing-durable-a',
        document_data: {
          id: 'drawing-forged-b',
          name: 'A101',
          projectId: 'project-b',
          ecosHostedIndexStatus: 'Ready for ECOS',
        },
      },
      {
        id: 'drawing-malformed',
        document_data: {
          id: 7,
          name: 'A102',
          projectId: 'project-a',
          ecosHostedIndexStatus: 'Ready for ECOS',
        },
      },
    ]));
    const gateway = createDAVEWebSupabaseGateway(fixture.client);

    const rows = await gateway.loadAuthorizedRows();

    expect(rows.referenceDocuments).toEqual([]);
    expect(fixture.rpc).not.toHaveBeenCalledWith(
      'ecos_hosted_index_status_v2',
      expect.anything(),
    );
  });

  test('uses the durable row id when legacy document_data omits its duplicate id', async () => {
    const fixture = clientFixture();
    fixture.queries.set('reference_documents', queryWithRows([{
      id: 'drawing-durable-a',
      document_data: { name: 'A101', projectId: 'project-a' },
    }]));
    const gateway = createDAVEWebSupabaseGateway(fixture.client);

    const rows = await gateway.loadAuthorizedRows();

    expect((rows.referenceDocuments[0] as any).document_data.id).toBe('drawing-durable-a');
  });

  test('queries and overlays hosted status only for legitimate durable document ids', async () => {
    const fixture = clientFixture();
    fixture.queries.set('reference_documents', queryWithRows([
      {
        id: 'drawing-a',
        document_data: {
          id: 'drawing-a',
          name: 'A101',
          projectId: 'project-a',
          isCurrent: true,
        },
      },
      {
        id: 'drawing-row-c',
        document_data: {
          id: 'drawing-b',
          name: 'Forged B drawing',
          projectId: 'project-b',
          isCurrent: true,
        },
      },
    ]));
    (fixture.rpc as jest.Mock).mockImplementation(async (name: string) => {
      if (name === 'dave_is_app_owner') return { data: true, error: null, status: 200 };
      if (name === 'dave_list_reference_document_metadata') {
        return { data: (fixture.queries.get('reference_documents') as any).fixtureRows, error: null, status: 200 };
      }
      if (name === 'ecos_hosted_index_status_v2') {
        return {
          data: [
            {
              document_id: 'drawing-b',
              project_id: 'project-b',
              state: 'ready',
              customer_status: 'Ready for ECOS',
              committed_evidence_version: 'ecos-hosted-evidence/1.3',
            },
            {
              document_id: 'drawing-a',
              project_id: 'project-a',
              state: 'ready',
              customer_status: 'Ready for ECOS',
              committed_evidence_version: 'ecos-hosted-evidence/1.3',
            },
          ],
          error: null,
          status: 200,
        };
      }
      throw new Error(`Unexpected RPC ${name}`);
    });
    const gateway = createDAVEWebSupabaseGateway(fixture.client);

    const rows = await gateway.loadAuthorizedRows();

    expect(fixture.rpc).toHaveBeenCalledWith('ecos_hosted_index_status_v2', {
      p_document_ids: ['drawing-a'],
    });
    expect(rows.referenceDocuments).toHaveLength(1);
    expect(rows.referenceDocuments[0]).toMatchObject({
      id: 'drawing-a',
      document_data: expect.objectContaining({
        id: 'drawing-a',
        projectId: 'project-a',
        ecosHostedIndexStatus: 'Ready for ECOS',
      }),
    });
  });

  test('marks cached hosted Ready proof unavailable when both status RPCs are absent', async () => {
    const fixture = clientFixture();
    fixture.queries.set('reference_documents', queryWithRows([{
      id: 'drawing-1',
      document_data: {
        id: 'drawing-1',
        name: 'A101',
        ecosHostedIndexStatus: 'Ready for ECOS',
        ecosHostedIndexProgressPercent: 100,
        ecosHostedIndexEvidenceVersion: 'ecos-hosted-evidence/1.3',
        ecosVerifiedIndexCommitVersion: 'ecos-verified-index-commit/1.0',
      },
    }]));
    (fixture.rpc as jest.Mock).mockImplementation(async (name: string) => {
      if (name === 'dave_is_app_owner') return { data: true, error: null, status: 200 };
      if (name === 'dave_list_reference_document_metadata') {
        return { data: (fixture.queries.get('reference_documents') as any).fixtureRows, error: null, status: 200 };
      }
      return { data: null, error: { code: 'PGRST202', message: 'function not found' }, status: 404 };
    });
    const gateway = createDAVEWebSupabaseGateway(fixture.client);

    const rows = await gateway.loadAuthorizedRows();

    expect((rows.referenceDocuments[0] as any).document_data).toMatchObject({
      ecosHostedIndexStatus: 'Temporarily Unavailable',
      ecosHostedIndexProgressPercent: null,
      ecosHostedIndexEvidenceVersion: null,
      ecosVerifiedIndexCommitVersion: null,
    });
  });

  test('revokes cached Ready proof when a targeted refresh skips hosted status authority', async () => {
    const fixture = clientFixture();
    fixture.queries.set('reference_documents', queryWithRows([{
      id: 'drawing-1',
      document_data: {
        id: 'drawing-1',
        projectId: 'project-1',
        name: 'A101',
        isCurrent: true,
        ecosHostedIndexStatus: 'Ready for ECOS',
        ecosVerifiedIndexCommitVersion: 'ecos-verified-index-commit/1.0',
      },
    }]));
    (fixture.rpc as jest.Mock).mockImplementation(async (name: string) => {
      if (name === 'dave_is_app_owner') return { data: true, error: null, status: 200 };
      if (name === 'dave_list_reference_document_metadata') {
        return { data: (fixture.queries.get('reference_documents') as any).fixtureRows, error: null, status: 200 };
      }
      if (name === 'ecos_hosted_index_status_v2') {
        return {
          data: [{
            document_id: 'drawing-1',
            project_id: 'project-1',
            state: 'ready',
            customer_status: 'Ready for ECOS',
            completed_page_count: 1,
            source_page_count: 1,
            progress_percent: 100,
            limitation_count: 0,
            committed_evidence_version: 'ecos-hosted-evidence/1.3',
          }],
          error: null,
          status: 200,
        };
      }
      return { data: [], error: null, status: 200 };
    });
    const gateway = createDAVEWebSupabaseGateway(fixture.client);

    const initial = await gateway.loadAuthorizedRows();
    expect((initial.referenceDocuments[0] as any).document_data.ecosHostedIndexStatus)
      .toBe('Ready for ECOS');

    const targeted = await gateway.loadAuthorizedRows(['schedule_items']);
    expect((targeted.referenceDocuments[0] as any).document_data).toMatchObject({
      ecosHostedIndexStatus: 'Temporarily Unavailable',
      ecosHostedIndexEvidenceVersion: null,
      ecosVerifiedIndexCommitVersion: null,
    });
  });

  test('reuses cached collections for a targeted realtime refresh', async () => {
    const fixture = clientFixture();
    const gateway = createDAVEWebSupabaseGateway(fixture.client);

    const initial = await gateway.loadAuthorizedRows();
    fixture.from.mockClear();

    const targeted = await gateway.loadAuthorizedRows(['schedule_items']);

    expect(fixture.from.mock.calls.map(call => call[0])).toEqual(['schedule_items']);
    expect(targeted.projects).toBe(initial.projects);
    expect(targeted.projectUpdates).toBe(initial.projectUpdates);
    expect(targeted.referenceDocuments).toBe(initial.referenceDocuments);
    expect(targeted.syncTombstones).toBe(initial.syncTombstones);
  });

  test('loads and caches a bounded page summary for the selected drawing', async () => {
    const fixture = clientFixture();
    const pageQuery = queryWithRows([
      {
        page_number: 1,
        sheet_number: 'C1',
        sheet_mapping_status: 'verified',
        visual_coverage: {
          overviewAnalyzed: true,
          requestedDeepReadRegionCount: 6,
          completedDeepReadRegionCount: 6,
          coverageComplete: true,
          completedDeepReadRegionKeys: [...ECOS_DRAWING_REQUIRED_TILE_KEYS],
        },
      },
      {
        page_number: 2,
        sheet_number: null,
        sheet_mapping_status: 'conflicted',
        visual_coverage: {
          overviewAnalyzed: true,
          requestedDeepReadRegionCount: 6,
          completedDeepReadRegionCount: 1,
          coverageComplete: false,
        },
      },
    ]);
    fixture.queries.set('ecos_document_pages', pageQuery);
    const gateway = createDAVEWebSupabaseGateway(fixture.client);

    const first = await gateway.loadAuthorizedDocumentCoverageSummary('drawing-1', 'revision-1');
    const second = await gateway.loadAuthorizedDocumentCoverageSummary('drawing-1', 'revision-1');

    expect(first).toEqual({
      indexedPageCount: 2,
      fullVisualCoveragePageCount: 1,
      verifiedSheetPageCount: 1,
      conflictedSheetPageCount: 1,
    });
    expect(second).toBe(first);
    expect(fixture.from.mock.calls.filter(call => call[0] === 'ecos_document_pages')).toHaveLength(1);
    expect(pageQuery.select).toHaveBeenCalledWith(
      'page_number,sheet_number,sheet_mapping_status,visual_coverage',
    );
    expect(pageQuery.eq).toHaveBeenCalledWith('owner_id', 'owner-1');
    expect(pageQuery.eq).toHaveBeenCalledWith('document_id', 'drawing-1');
  });

  test('reuses the owner authorization check during its short session cache window', async () => {
    const fixture = clientFixture();
    const gateway = createDAVEWebSupabaseGateway(fixture.client);

    await gateway.loadAuthorizedRows();
    await gateway.createAuthorizedArtifactSignedUrl(
      'project-photos',
      'owner-1/project-a/photo.jpg',
    );

    expect(fixture.auth.getUser).toHaveBeenCalledTimes(1);
    expect(fixture.rpc).toHaveBeenCalledTimes(2);
    expect(fixture.rpc).toHaveBeenCalledWith('dave_is_app_owner');
    expect(fixture.rpc).toHaveBeenCalledWith('dave_list_reference_document_metadata');
  });

  test('authorizes and owner-filters the desktop Field Notes inbox', async () => {
    const fixture = clientFixture();
    const fieldNotesQuery = queryWithRows([{
      owner_id: 'owner-1',
      id: 'field-note-1',
      original_text: 'Review the exposed parking edge.',
      source: 'voice',
      project_id: null,
      project_name: null,
      location_name: 'North Lot',
      action_kind: 'safety_candidate',
      action_text: 'Confirm whether a guardrail is required',
      status: 'open',
      revision: 1,
      created_at: '2026-08-03T15:00:00.000Z',
      updated_at: '2026-08-03T15:00:00.000Z',
      resolved_at: null,
      archived_at: null,
    }]);
    fixture.queries.set('field_notes', fieldNotesQuery);
    const gateway = createDAVEWebSupabaseGateway(fixture.client);

    const notes = await gateway.fieldNotes.list();

    expect(notes).toHaveLength(1);
    expect(fixture.rpc).toHaveBeenCalledWith('dave_is_app_owner');
    expect(fieldNotesQuery.eq).toHaveBeenCalledWith('owner_id', 'owner-1');
  });

  test('applies a realtime task row without issuing a duplicate targeted table read', async () => {
    const fixture = clientFixture();
    const handlers = new Map<string, (payload: unknown) => void>();
    const realtimeChannel: { on: jest.Mock; subscribe: jest.Mock } = {
      on: jest.fn(),
      subscribe: jest.fn(),
    };
    realtimeChannel.on.mockImplementation(
      (_kind: string, configuration: { table: string }, handler: (payload: unknown) => void) => {
        handlers.set(configuration.table, handler);
        return realtimeChannel;
      },
    );
    realtimeChannel.subscribe.mockImplementation(() => realtimeChannel);
    fixture.client.channel = jest.fn(() => realtimeChannel);
    fixture.client.removeChannel = jest.fn().mockResolvedValue('ok');
    const gateway = createDAVEWebSupabaseGateway(fixture.client);

    await gateway.loadAuthorizedRows();
    await gateway.subscribeToAuthorizedOperationalChanges({ onChange: jest.fn() });
    fixture.from.mockClear();
    handlers.get('schedule_items')?.({
      eventType: 'UPDATE',
      new: { id: 'task-1', item_data: { id: 'task-1', taskName: 'Updated task' } },
      old: {},
    });

    const rows = await gateway.loadAuthorizedRows(['schedule_items']);
    expect(fixture.from).not.toHaveBeenCalled();
    expect(rows.scheduleItems).toEqual([
      expect.objectContaining({ id: 'task-1' }),
    ]);
  });

  test('runs storage cleanup and deletion-audit purge only when maintenance is requested', async () => {
    const fixture = clientFixture();
    const gateway = createDAVEWebSupabaseGateway(fixture.client);

    await gateway.loadAuthorizedRows();
    expect(fixture.from).not.toHaveBeenCalledWith('dave_storage_cleanup_intents');
    expect(fixture.rpc).not.toHaveBeenCalledWith('dave_purge_expired_deletion_audit');

    await gateway.runAuthorizedMaintenance();

    expect(fixture.from).toHaveBeenCalledWith('dave_storage_cleanup_intents');
    expect(fixture.rpc).toHaveBeenCalledWith('dave_purge_expired_deletion_audit');
  });

  test('creates short-lived URLs only for owner-scoped paths in allowlisted buckets', async () => {
    const fixture = clientFixture();
    const gateway = createDAVEWebSupabaseGateway(fixture.client);

    await expect(
      gateway.createAuthorizedArtifactSignedUrl(
        'project-photos',
        'owner-1/project-a/photo.jpg',
        600,
      ),
    ).resolves.toBe('https://signed.example/owner-1/project-a/photo.jpg');

    expect(fixture.rpc).toHaveBeenCalledWith('dave_is_app_owner');
    expect(fixture.storageFrom).toHaveBeenCalledWith('project-photos');
    expect(fixture.createSignedUrl).toHaveBeenCalledWith(
      'owner-1/project-a/photo.jpg',
      600,
    );
  });

  test('requests a bounded image transform for photo previews', async () => {
    const fixture = clientFixture();
    const gateway = createDAVEWebSupabaseGateway(fixture.client);

    await gateway.createAuthorizedArtifactSignedUrl(
      'project-photos',
      'owner-1/project-a/photo.jpg',
      600,
      { preview: true },
    );

    expect(fixture.createSignedUrl).toHaveBeenCalledWith(
      'owner-1/project-a/photo.jpg',
      600,
      { transform: { width: 960, quality: 72, resize: 'contain' } },
    );
  });

  test('rechecks an approved report photo against its exact project, update, id, path, and digest', async () => {
    const fixture = clientFixture();
    const exactPhoto = exactRowQuery({
      id: 'update-1',
      project_id: 'project-a',
      update_data: {
        id: 'update-1',
        projectId: 'project-a',
        photos: [{
          id: 'photo-1',
          cloudStoragePath: 'legacy/project-a/photo-1.jpg',
          photoIntelligence: {
            diagnostics: { currentImageSha256: 'a'.repeat(64) },
          },
        }],
      },
    });
    fixture.queries.set('project_updates', exactPhoto);
    const gateway = createDAVEWebSupabaseGateway(fixture.client);
    const receipt = {
      bucket: 'project-photos' as const,
      projectId: 'project-a',
      updateId: 'update-1',
      photoId: 'photo-1',
      storagePath: 'legacy/project-a/photo-1.jpg',
      contentSha256: 'a'.repeat(64),
    };

    await expect(gateway.createAuthorizedArtifactSignedUrl(
      'project-photos',
      receipt.storagePath,
      600,
      { reportPhotoSource: receipt },
    )).resolves.toBe('https://signed.example/legacy/project-a/photo-1.jpg');

    expect(exactPhoto.eq).toHaveBeenCalledWith('owner_id', 'owner-1');
    expect(exactPhoto.eq).toHaveBeenCalledWith('id', 'update-1');
    expect(fixture.createSignedUrl).toHaveBeenCalledWith(receipt.storagePath, 600);
  });

  test('rejects a report photo receipt without a canonical byte digest before querying', async () => {
    const fixture = clientFixture();
    const gateway = createDAVEWebSupabaseGateway(fixture.client);

    await expect(gateway.createAuthorizedArtifactSignedUrl(
      'project-photos',
      'owner-1/project-a/photo-1.jpg',
      600,
      {
        reportPhotoSource: {
          bucket: 'project-photos',
          projectId: 'project-a',
          updateId: 'update-1',
          photoId: 'photo-1',
          storagePath: 'owner-1/project-a/photo-1.jpg',
          contentSha256: null,
        },
      },
    )).rejects.toMatchObject({
      message: expect.stringMatching(/incomplete or malformed/i),
    });
    expect(fixture.from).not.toHaveBeenCalled();
    expect(fixture.storageFrom).not.toHaveBeenCalled();
  });

  test('rejects an approved report receipt after a same-owner photo path substitution', async () => {
    const fixture = clientFixture();
    fixture.queries.set('project_updates', exactRowQuery({
      id: 'update-1',
      project_id: 'project-a',
      update_data: {
        id: 'update-1',
        projectId: 'project-a',
        photos: [{
          id: 'photo-1',
          cloudStoragePath: 'owner-1/project-b/replacement.jpg',
        }],
      },
    }));
    const gateway = createDAVEWebSupabaseGateway(fixture.client);

    await expect(gateway.createAuthorizedArtifactSignedUrl(
      'project-photos',
      'owner-1/project-a/approved.jpg',
      600,
      {
        reportPhotoSource: {
          bucket: 'project-photos',
          projectId: 'project-a',
          updateId: 'update-1',
          photoId: 'photo-1',
          storagePath: 'owner-1/project-a/approved.jpg',
          contentSha256: 'a'.repeat(64),
        },
      },
    )).rejects.toMatchObject({
      message: expect.stringMatching(/storage object.*approved report source/i),
    });
    expect(fixture.storageFrom).not.toHaveBeenCalled();
  });

  test('rejects an approved report receipt when row and embedded project authority disagree', async () => {
    const fixture = clientFixture();
    fixture.queries.set('project_updates', exactRowQuery({
      id: 'update-1',
      project_id: 'project-b',
      update_data: {
        id: 'update-1',
        projectId: 'project-a',
        photos: [{
          id: 'photo-1',
          cloudStoragePath: 'owner-1/project-a/approved.jpg',
        }],
      },
    }));
    const gateway = createDAVEWebSupabaseGateway(fixture.client);

    await expect(gateway.createAuthorizedArtifactSignedUrl(
      'project-photos',
      'owner-1/project-a/approved.jpg',
      600,
      {
        reportPhotoSource: {
          bucket: 'project-photos',
          projectId: 'project-a',
          updateId: 'update-1',
          photoId: 'photo-1',
          storagePath: 'owner-1/project-a/approved.jpg',
          contentSha256: 'a'.repeat(64),
        },
      },
    )).rejects.toMatchObject({
      message: expect.stringMatching(/exact project and update/i),
    });
    expect(fixture.storageFrom).not.toHaveBeenCalled();
  });

  test('rejects an approved report receipt when the exact field update was archived after approval', async () => {
    const fixture = clientFixture();
    fixture.queries.set('project_updates', exactRowQuery({
      id: 'update-1',
      project_id: 'project-a',
      update_data: {
        id: 'update-1',
        projectId: 'project-a',
        isArchived: true,
        photos: [{
          id: 'photo-1',
          cloudStoragePath: 'owner-1/project-a/approved.jpg',
        }],
      },
    }));
    const gateway = createDAVEWebSupabaseGateway(fixture.client);

    await expect(gateway.createAuthorizedArtifactSignedUrl(
      'project-photos',
      'owner-1/project-a/approved.jpg',
      600,
      {
        reportPhotoSource: {
          bucket: 'project-photos',
          projectId: 'project-a',
          updateId: 'update-1',
          photoId: 'photo-1',
          storagePath: 'owner-1/project-a/approved.jpg',
          contentSha256: 'a'.repeat(64),
        },
      },
    )).rejects.toMatchObject({
      message: expect.stringMatching(/exact project and update/i),
    });
    expect(fixture.storageFrom).not.toHaveBeenCalled();
  });

  test('allows legacy mobile paths only after they are loaded from an owner record', async () => {
    const fixture = clientFixture();
    fixture.queries.set('project_updates', queryWithRows([{
      update_data: {
        photos: [{
          cloudStoragePath: '2375-Compliance-Project/update-1/photo-1.jpg',
        }],
      },
    }]));
    fixture.queries.set('reference_documents', queryWithRows([{
      id: 'schedule-document-1',
      document_data: {
        id: 'schedule-document-1',
        storagePath: 'project-documents/project-1/document-1/schedule.pdf',
      },
    }]));
    const gateway = createDAVEWebSupabaseGateway(fixture.client);

    await gateway.loadAuthorizedRows();

    await expect(
      gateway.createAuthorizedArtifactSignedUrl(
        'project-photos',
        '2375-Compliance-Project/update-1/photo-1.jpg',
      ),
    ).resolves.toBe(
      'https://signed.example/2375-Compliance-Project/update-1/photo-1.jpg',
    );
    await expect(
      gateway.createAuthorizedArtifactSignedUrl(
        'project-documents',
        'project-documents/project-1/document-1/schedule.pdf',
      ),
    ).resolves.toBe(
      'https://signed.example/project-documents/project-1/document-1/schedule.pdf',
    );
  });

  test('rejects unowned and traversal storage paths before requesting a signed URL', async () => {
    const fixture = clientFixture();
    const gateway = createDAVEWebSupabaseGateway(fixture.client);

    await expect(
      gateway.createAuthorizedArtifactSignedUrl(
        'project-documents',
        'another-owner/project/document.pdf',
      ),
    ).rejects.toBeInstanceOf(DAVEWebArtifactAccessError);
    await expect(
      gateway.createAuthorizedArtifactSignedUrl(
        'project-documents',
        'owner-1/../another-owner/document.pdf',
      ),
    ).rejects.toBeInstanceOf(DAVEWebArtifactAccessError);
    expect(fixture.storageFrom).not.toHaveBeenCalled();
  });

  test('checks owner authorization before attempting protected file access', async () => {
    const fixture = clientFixture({ authorized: false });
    const gateway = createDAVEWebSupabaseGateway(fixture.client);

    await expect(
      gateway.createAuthorizedArtifactSignedUrl(
        'project-documents',
        'owner-1/project/document.pdf',
      ),
    ).rejects.toBeInstanceOf(DAVEWebAuthorizationError);
    expect(fixture.storageFrom).not.toHaveBeenCalled();
  });

  test('subscribes the web workspace to owner-scoped operational changes', async () => {
    const fixture = clientFixture();
    let statusHandler: (status: string) => void = () => undefined;
    const realtimeChannel: { on: jest.Mock; subscribe: jest.Mock } = {
      on: jest.fn(),
      subscribe: jest.fn(),
    };
    realtimeChannel.on.mockImplementation(() => realtimeChannel);
    realtimeChannel.subscribe.mockImplementation((handler: (status: string) => void) => {
      statusHandler = handler;
      return realtimeChannel;
    });
    fixture.client.channel = jest.fn(() => realtimeChannel);
    fixture.client.removeChannel = jest.fn().mockResolvedValue('ok');
    const gateway = createDAVEWebSupabaseGateway(fixture.client);
    const entities: string[] = [];
    const statuses: string[] = [];

    const unsubscribe = await gateway.subscribeToAuthorizedOperationalChanges({
      onChange: entity => entities.push(entity),
      onStatus: status => statuses.push(status),
    });

    expect(fixture.rpc).toHaveBeenCalledWith('dave_is_app_owner');
    expect(realtimeChannel.on).toHaveBeenCalledTimes(6);
    expect(
      realtimeChannel.on.mock.calls.map(([, configuration]) => configuration.table),
    ).toEqual([
      'projects',
      'project_updates',
      'project_areas',
      'schedule_items',
      'reference_documents',
      'dave_sync_tombstones',
    ]);
    for (const [, configuration] of realtimeChannel.on.mock.calls) {
      expect(configuration.filter).toBe('owner_id=eq.owner-1');
    }
    statusHandler('SUBSCRIBED');
    expect(statuses).toEqual(['subscribed']);
    expect(entities).toEqual([]);

    unsubscribe();
    expect(fixture.client.removeChannel).toHaveBeenCalledWith(realtimeChannel);
  });

  test('creates tasks only after owner authorization and writes the explicit owner id', async () => {
    const query = mutationQuery({ data: { updated_at: '2026-07-19T18:00:01.000Z' }, error: null });
    const fixture = mutationClient(() => query);
    const gateway = createDAVEWebSupabaseGateway(fixture.client);

    await expect(gateway.createAuthorizedScheduleItem(SCHEDULE_ITEM)).resolves.toBe('2026-07-19T18:00:01.000Z');

    expect(fixture.rpc).toHaveBeenCalledWith('dave_is_app_owner');
    expect(query.insert).toHaveBeenCalledWith(expect.objectContaining({
      id: 'task-1',
      owner_id: 'owner-1',
      project_id: 'project-1',
      project_name: '2375 Compliance Project',
      item_data: SCHEDULE_ITEM,
    }));
  });

  test('rejects a name-only task before selecting a cloud row', async () => {
    const fixture = clientFixture();
    const gateway = createDAVEWebSupabaseGateway(fixture.client);

    await expect(gateway.createAuthorizedScheduleItem({
      ...SCHEDULE_ITEM,
      projectId: null,
    })).rejects.toMatchObject<Partial<DAVEWebTaskMutationError>>({
      code: 'conflict',
      message: expect.stringMatching(/exact project ID/i),
    });
    expect(fixture.from).not.toHaveBeenCalled();
  });

  test('rejects task mutations before touching tables when the account is not authorized', async () => {
    const fixture = clientFixture({ authorized: false });
    const gateway = createDAVEWebSupabaseGateway(fixture.client);

    await expect(gateway.createAuthorizedScheduleItem(SCHEDULE_ITEM)).rejects.toBeInstanceOf(DAVEWebAuthorizationError);
    expect(fixture.from).not.toHaveBeenCalled();
  });

  test('updates tasks only when the exact cloud revision still matches', async () => {
    const tombstoneQuery = mutationQuery({ data: null, error: null });
    const scheduleQuery = mutationQuery({ data: { updated_at: '2026-07-19T18:00:02.000Z' }, error: null });
    const fixture = mutationClient(table => table === 'dave_sync_tombstones' ? tombstoneQuery : scheduleQuery);
    const gateway = createDAVEWebSupabaseGateway(fixture.client);

    await gateway.updateAuthorizedScheduleItem(SCHEDULE_ITEM, '2026-07-19T18:00:01.000Z');

    expect(scheduleQuery.eq).toHaveBeenCalledWith('owner_id', 'owner-1');
    expect(scheduleQuery.eq).toHaveBeenCalledWith('updated_at', '2026-07-19T18:00:01.000Z');
  });

  test('returns an explicit conflict when a stale task revision no longer matches', async () => {
    const tombstoneQuery = mutationQuery({ data: null, error: null });
    const scheduleQuery = mutationQuery({ data: null, error: null });
    const fixture = mutationClient(table => table === 'dave_sync_tombstones' ? tombstoneQuery : scheduleQuery);
    const gateway = createDAVEWebSupabaseGateway(fixture.client);

    await expect(
      gateway.updateAuthorizedScheduleItem(SCHEDULE_ITEM, 'stale-revision'),
    ).rejects.toMatchObject<Partial<DAVEWebTaskMutationError>>({ code: 'conflict' });
  });

  test('deletes through the durable task tombstone without deleting the schedule row', async () => {
    const scheduleQuery = mutationQuery({ data: { updated_at: 'current-revision' }, error: null });
    const tombstoneCheck = mutationQuery({ data: null, error: null });
    const tombstoneWrite = mutationQuery({ data: null, error: null });
    let tombstoneCalls = 0;
    const fixture = mutationClient(table => {
      if (table === 'schedule_items') return scheduleQuery;
      tombstoneCalls += 1;
      return tombstoneCalls === 1 ? tombstoneCheck : tombstoneWrite;
    });
    const gateway = createDAVEWebSupabaseGateway(fixture.client);

    await gateway.deleteAuthorizedScheduleItem('task-1', 'current-revision');

    expect(tombstoneWrite.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        owner_id: 'owner-1',
        entity_type: 'schedule_item',
        record_id: 'task-1',
      }),
      { onConflict: 'owner_id,entity_type,record_id' },
    );
    expect(scheduleQuery.delete).not.toHaveBeenCalled();
  });

  test('deletes a document and its explicitly linked tasks through one durable tombstone write', async () => {
    const documentQuery = mutationQuery({ data: { updated_at: 'document-revision' }, error: null });
    const taskOwnershipQuery = mutationQuery({ data: [{ id: 'task-1', updated_at: 'task-revision' }], error: null });
    const tombstoneCheck = mutationQuery({ data: null, error: null });
    const tombstoneWrite = mutationQuery({ data: null, error: null });
    let tombstoneCalls = 0;
    const fixture = mutationClient(table => {
      if (table === 'reference_documents') return documentQuery;
      if (table === 'schedule_items') return taskOwnershipQuery;
      tombstoneCalls += 1;
      return tombstoneCalls === 1 ? tombstoneCheck : tombstoneWrite;
    });
    const gateway = createDAVEWebSupabaseGateway(fixture.client);

    await gateway.deleteAuthorizedReferenceDocument(
      'document-1',
      'document-revision',
      [{ id: 'task-1', cloudUpdatedAt: 'task-revision' }],
    );

    expect(taskOwnershipQuery.in).toHaveBeenCalledWith('id', ['task-1']);
    expect(tombstoneWrite.upsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({ entity_type: 'reference_document', record_id: 'document-1' }),
        expect.objectContaining({ entity_type: 'schedule_item', record_id: 'task-1' }),
      ],
      { onConflict: 'owner_id,entity_type,record_id' },
    );
    expect(documentQuery.delete).not.toHaveBeenCalled();
  });

  test('rejects document deletion when a linked task is no longer owner-visible', async () => {
    const documentQuery = mutationQuery({ data: { updated_at: 'document-revision' }, error: null });
    const taskOwnershipQuery = mutationQuery({ data: [], error: null });
    const tombstoneCheck = mutationQuery({ data: null, error: null });
    const fixture = mutationClient(table => {
      if (table === 'reference_documents') return documentQuery;
      if (table === 'schedule_items') return taskOwnershipQuery;
      return tombstoneCheck;
    });
    const gateway = createDAVEWebSupabaseGateway(fixture.client);

    await expect(
      gateway.deleteAuthorizedReferenceDocument(
        'document-1',
        'document-revision',
        [{ id: 'task-1', cloudUpdatedAt: 'task-revision' }],
      ),
    ).rejects.toBeInstanceOf(DAVEWebDocumentMutationError);
  });

  test('rejects a schedule import with a name-only task before storage or table access', async () => {
    const fixture = clientFixture();
    const gateway = createDAVEWebSupabaseGateway(fixture.client);

    await expect(gateway.uploadAuthorizedReferenceDocument({
      document: referenceDocument('document-1', false, null),
      bytes: new Uint8Array([1, 2, 3]).buffer,
      scheduleItems: [{ ...SCHEDULE_ITEM, projectId: null }],
    })).rejects.toMatchObject<Partial<DAVEWebDocumentMutationError>>({
      code: 'conflict',
      message: expect.stringMatching(/exact project ID/i),
    });

    expect(fixture.auth.getUser).not.toHaveBeenCalled();
    expect(fixture.from).not.toHaveBeenCalled();
    expect(fixture.storageFrom).not.toHaveBeenCalled();
  });

  test('rolls back the document row and protected file when linked task persistence fails', async () => {
    const documentInsert = mutationQuery({ data: null, error: null });
    const taskUpsert = mutationQuery({ data: null, error: { message: 'fault: task upsert' } });
    const tombstoneWrite = mutationQuery({ data: null, error: null });
    const documentDelete = mutationQuery({ data: { id: 'document-1' }, error: null });
    const tableQueries = new Map<string, Record<string, any>[]>([
      ['reference_documents', [documentInsert, documentDelete]],
      ['schedule_items', [taskUpsert]],
      ['dave_sync_tombstones', [tombstoneWrite]],
    ]);
    const fixture = mutationClient(table => tableQueries.get(table)!.shift()!);
    const storage = {
      upload: jest.fn(async () => ({ error: null })),
      remove: jest.fn(async () => ({ error: null })),
    };
    fixture.client.storage = { from: jest.fn(() => storage) };
    const gateway = createDAVEWebSupabaseGateway(fixture.client);

    await expect(
      gateway.uploadAuthorizedReferenceDocument({
        document: referenceDocument('document-1', false, null),
        bytes: new Uint8Array([1, 2, 3]).buffer,
        scheduleItems: [SCHEDULE_ITEM],
      }),
    ).rejects.toMatchObject<Partial<DAVEWebDocumentMutationError>>({
      code: 'write_failed',
      message: expect.stringMatching(/rolled back/i),
    });

    expect(tombstoneWrite.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        owner_id: 'owner-1',
        entity_type: 'reference_document',
        record_id: 'document-1',
      }),
      { onConflict: 'owner_id,entity_type,record_id' },
    );
    expect(documentDelete.delete).toHaveBeenCalled();
    expect(documentDelete.eq).toHaveBeenCalledWith('owner_id', 'owner-1');
    expect(documentDelete.eq).toHaveBeenCalledWith('id', 'document-1');
    expect(storage.remove).toHaveBeenCalledWith([
      'owner-1/web/document-1/schedule.pdf',
    ]);
  });

  test('reports an unconfirmed failed-import cleanup after exercising every compensating action', async () => {
    const documentInsert = mutationQuery({ data: null, error: null });
    const taskUpsert = mutationQuery({ data: null, error: { message: 'fault: task upsert' } });
    const tombstoneWrite = mutationQuery({ data: null, error: { message: 'fault: tombstone' } });
    const documentDelete = mutationQuery({ data: null, error: { message: 'fault: row delete' } });
    const tableQueries = new Map<string, Record<string, any>[]>([
      ['reference_documents', [documentInsert, documentDelete]],
      ['schedule_items', [taskUpsert]],
      ['dave_sync_tombstones', [tombstoneWrite]],
    ]);
    const fixture = mutationClient(table => tableQueries.get(table)!.shift()!);
    const storage = {
      upload: jest.fn(async () => ({ error: null })),
      remove: jest.fn(async () => ({ error: { message: 'fault: storage delete' } })),
    };
    fixture.client.storage = { from: jest.fn(() => storage) };
    const gateway = createDAVEWebSupabaseGateway(fixture.client);

    await expect(
      gateway.uploadAuthorizedReferenceDocument({
        document: referenceDocument('document-1', false, null),
        bytes: new Uint8Array([1, 2, 3]).buffer,
        scheduleItems: [SCHEDULE_ITEM],
      }),
    ).rejects.toMatchObject<Partial<DAVEWebDocumentMutationError>>({
      code: 'write_failed',
      message: expect.stringMatching(/automatic cleanup could not be confirmed/i),
    });

    expect(tombstoneWrite.upsert).toHaveBeenCalled();
    expect(documentDelete.delete).toHaveBeenCalled();
    expect(storage.remove).toHaveBeenCalled();
  });

  test('changes a current schedule through one atomic server activation', async () => {
    const previousA = referenceDocument('schedule-a', true, 'revision-a');
    const previousB = referenceDocument('schedule-b', true, 'revision-b');
    const selected = referenceDocument('schedule-c', false, 'revision-c');
    const fixture = mutationClient(() => mutationQuery({ data: null, error: null }));
    fixture.rpc
      .mockResolvedValueOnce({ data: true, error: null, status: 200 })
      .mockResolvedValueOnce({
        data: {
          document_id: selected.id,
          updated_at: '2026-08-09T07:30:00.000Z',
          changed_count: 3,
        },
        error: null,
        status: 200,
      });
    const gateway = createDAVEWebSupabaseGateway(fixture.client);

    await expect(gateway.setAuthorizedCurrentSchedule(
      selected,
      [previousA, previousB, selected],
    )).resolves.toBeUndefined();

    expect(fixture.rpc).toHaveBeenCalledWith('ecos_activate_current_reference_document', {
      p_document_id: selected.id,
      p_expected_updated_at: 'revision-c',
    });
    expect(fixture.from).not.toHaveBeenCalledWith('reference_documents');
  });

  test('fails closed when ECOS has not prepared the drawing revision', async () => {
    const previousA = referenceDocument('schedule-a', true, 'revision-a');
    const selected = referenceDocument('schedule-c', false, 'revision-c');
    const fixture = mutationClient(() => mutationQuery({ data: null, error: null }));
    fixture.rpc
      .mockResolvedValueOnce({ data: true, error: null, status: 200 })
      .mockResolvedValueOnce({
        data: null,
        error: { code: 'P0001', message: 'ecos_target_not_prepared' },
        status: 400,
      });
    const gateway = createDAVEWebSupabaseGateway(fixture.client);

    await expect(
      gateway.setAuthorizedCurrentDocument(selected, [previousA, selected]),
    ).rejects.toMatchObject<Partial<DAVEWebDocumentMutationError>>({
      code: 'write_failed',
      message: expect.stringMatching(/finish background preparation/i),
    });
    expect(fixture.from).not.toHaveBeenCalledWith('reference_documents');
  });

  test('uploads a task photo and creates a task-linked field update', async () => {
    const updateInsert = mutationQuery({ data: null, error: null });
    const fixture = taskPhotoMutationClient(updateInsert);
    const storage = {
      upload: jest.fn(async () => ({ error: null })),
      remove: jest.fn(async () => ({ error: null })),
    };
    fixture.client.storage = { from: jest.fn(() => storage) };
    const gateway = createDAVEWebSupabaseGateway(fixture.client);

    const updateId = await gateway.uploadAuthorizedTaskPhoto({
      task: SCHEDULE_ITEM,
      bytes: new Uint8Array([1, 2, 3]).buffer,
      fileName: 'handrails.jpg',
      mimeType: 'image/jpeg',
    });

    expect(fixture.client.storage.from).toHaveBeenCalledWith('project-photos');
    expect(storage.upload).toHaveBeenCalledWith(
      expect.stringMatching(/^owner-1\/web-updates\/web-task-update-/),
      expect.any(ArrayBuffer),
      { contentType: 'image/jpeg', upsert: false },
    );
    expect(updateInsert.insert).toHaveBeenCalledWith(expect.objectContaining({
      id: updateId,
      owner_id: 'owner-1',
      project_id: 'project-1',
      project_name: '2375 Compliance Project',
      area_name: 'Canopy C',
      idempotency_key: updateId,
      update_data: expect.objectContaining({
        projectId: 'project-1',
        scheduleItemId: 'task-1',
        scheduleTaskName: 'Install handrails',
        selectedAreaName: 'Canopy C',
        photos: [
          expect.objectContaining({
            fileName: 'handrails.jpg',
            mimeType: 'image/jpeg',
            cloudStoragePath: expect.stringMatching(/^owner-1\/web-updates\//),
            contentSha256: '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81',
          }),
        ],
      }),
    }));
    expect(storage.remove).not.toHaveBeenCalled();
  });

  test('rejects a task photo before storage when its project identity is name-only', async () => {
    const fixture = clientFixture();
    const gateway = createDAVEWebSupabaseGateway(fixture.client);

    await expect(gateway.uploadAuthorizedTaskPhoto({
      task: { ...SCHEDULE_ITEM, projectId: null },
      bytes: new Uint8Array([1, 2, 3]).buffer,
      fileName: 'handrails.jpg',
      mimeType: 'image/jpeg',
    })).rejects.toMatchObject<Partial<DAVEWebDocumentMutationError>>({
      code: 'conflict',
      message: expect.stringMatching(/exact project ID/i),
    });

    expect(fixture.storageFrom).not.toHaveBeenCalled();
    expect(fixture.from).not.toHaveBeenCalledWith('project_updates');
  });

  test('removes a task photo when its field-update record cannot be saved', async () => {
    const updateInsert = mutationQuery({
      data: null,
      error: { message: 'fault: project update insert' },
    });
    const fixture = taskPhotoMutationClient(updateInsert);
    const storage = {
      upload: jest.fn(async () => ({ error: null })),
      remove: jest.fn(async () => ({ error: null })),
    };
    fixture.client.storage = { from: jest.fn(() => storage) };
    const gateway = createDAVEWebSupabaseGateway(fixture.client);

    await expect(gateway.uploadAuthorizedTaskPhoto({
      task: SCHEDULE_ITEM,
      bytes: new Uint8Array([1, 2, 3]).buffer,
      fileName: 'handrails.jpg',
      mimeType: 'image/jpeg',
    })).rejects.toMatchObject<Partial<DAVEWebDocumentMutationError>>({
      code: 'write_failed',
      message: expect.stringMatching(/uploaded file was removed/i),
    });

    expect(storage.remove).toHaveBeenCalledWith([
      expect.stringMatching(/^owner-1\/web-updates\//),
    ]);
  });

  test('rejects a task photo before storage when the task snapshot is stale', async () => {
    const updateInsert = mutationQuery({ data: null, error: null });
    const fixture = taskPhotoMutationClient(updateInsert, {
      taskRow: currentTaskPhotoRow({ updated_at: '2026-07-19T18:00:02.000Z' }),
    });
    const storage = {
      upload: jest.fn(async () => ({ error: null })),
      remove: jest.fn(async () => ({ error: null })),
    };
    fixture.client.storage = { from: jest.fn(() => storage) };
    const gateway = createDAVEWebSupabaseGateway(fixture.client);

    await expect(gateway.uploadAuthorizedTaskPhoto({
      task: SCHEDULE_ITEM,
      bytes: new Uint8Array([1, 2, 3]).buffer,
      fileName: 'handrails.jpg',
      mimeType: 'image/jpeg',
    })).rejects.toMatchObject<Partial<DAVEWebDocumentMutationError>>({
      code: 'conflict',
      message: expect.stringMatching(/changed before the photo/i),
    });

    expect(storage.upload).not.toHaveBeenCalled();
    expect(updateInsert.insert).not.toHaveBeenCalled();
  });

  test('rejects a task photo before storage when its exact project is archived', async () => {
    const updateInsert = mutationQuery({ data: null, error: null });
    const fixture = taskPhotoMutationClient(updateInsert, {
      projectRow: { id: 'project-1', name: '2375 Compliance Project', archived: true },
    });
    const storage = {
      upload: jest.fn(async () => ({ error: null })),
      remove: jest.fn(async () => ({ error: null })),
    };
    fixture.client.storage = { from: jest.fn(() => storage) };
    const gateway = createDAVEWebSupabaseGateway(fixture.client);

    await expect(gateway.uploadAuthorizedTaskPhoto({
      task: SCHEDULE_ITEM,
      bytes: new Uint8Array([1, 2, 3]).buffer,
      fileName: 'handrails.jpg',
      mimeType: 'image/jpeg',
    })).rejects.toMatchObject<Partial<DAVEWebDocumentMutationError>>({
      code: 'conflict',
    });

    expect(storage.upload).not.toHaveBeenCalled();
    expect(updateInsert.insert).not.toHaveBeenCalled();
  });

  test('persists a same-name project report under the selected immutable project id', async () => {
    const reportInsert = mutationQuery({
      data: { updated_at: '2026-08-09T20:05:00.000Z' },
      error: null,
    });
    const fixture = mutationClient(table => {
      if (table !== 'reference_documents') throw new Error(`Unexpected table ${table}`);
      return reportInsert;
    });
    const gateway = createDAVEWebSupabaseGateway(fixture.client);
    const selection = { projectId: 'project-b', projectName: 'Shared Project' };
    const exactSnapshot = sameNameReportSnapshot();
    const source = buildDAVEWebReportSource(exactSnapshot, selection);
    const body = formatDAVEWebReport(
      buildDAVEWebReportDraft(exactSnapshot, selection),
      'project_manager',
    );

    expect(body).toContain('B only task');
    expect(body).not.toContain('A only task');
    expect(source).toMatchObject({
      scopeKey: 'project-id:project-b',
      taskIds: ['task-b'],
      updateIds: ['update-b'],
      documentIds: ['drawing-b'],
    });

    await gateway.saveAuthorizedReportArtifact({
      id: 'report-b',
      ...selection,
      report: {
        status: 'approved',
        title: 'Shared Project Report',
        body,
        generatedAt: '2026-08-09T20:00:00.000Z',
        sourceRefreshedAt: source.refreshedAt,
        sourceFingerprint: source.fingerprint,
        sourceScopeKey: source.scopeKey,
        sourceTaskIds: source.taskIds,
        sourceUpdateIds: source.updateIds,
        sourceDocumentIds: source.documentIds,
        sourceMedia: source.media,
        audit: [],
      },
    });

    expect(reportInsert.insert).toHaveBeenCalledWith(expect.objectContaining({
      id: 'report-b',
      document_data: expect.objectContaining({
        id: 'report-b',
        projectId: 'project-b',
        projectName: 'Shared Project',
        webVersionGroupId: 'report:project-b',
        webReport: expect.objectContaining({
          body: expect.stringContaining('B only task'),
          sourceScopeKey: 'project-id:project-b',
          sourceTaskIds: ['task-b'],
          sourceUpdateIds: ['update-b'],
          sourceDocumentIds: ['drawing-b'],
          sourceMedia: source.media,
        }),
      }),
    }));
  });

  test('fails closed before persistence when a report has no exact selected project id', async () => {
    const reportInsert = mutationQuery({ data: null, error: null });
    const fixture = mutationClient(() => reportInsert);
    const gateway = createDAVEWebSupabaseGateway(fixture.client);

    await expect(gateway.saveAuthorizedReportArtifact({
      id: 'portfolio-report',
      projectId: '' as never,
      projectName: null as never,
      report: {
        status: 'draft',
        title: 'Portfolio Report',
        body: 'Mixed project facts.',
        generatedAt: '2026-08-09T20:00:00.000Z',
        sourceRefreshedAt: '2026-08-09T19:59:00.000Z',
        sourceTaskIds: [],
        sourceUpdateIds: [],
        audit: [],
      },
    })).rejects.toMatchObject<Partial<DAVEWebDocumentMutationError>>({
      code: 'conflict',
      message: expect.stringMatching(/one exact project/i),
    });
    expect(fixture.from).not.toHaveBeenCalled();
  });
});

const SCHEDULE_ITEM: ScheduleItem & { cloudUpdatedAt: string } = {
  id: 'task-1',
  projectId: 'project-1',
  scheduleProjectName: '2375 Compliance Project',
  projectName: '2375 Compliance Project',
  locationName: 'Canopy C',
  taskName: 'Install handrails',
  startDate: '2026-07-20',
  finishDate: '2026-07-24',
  milestone: '',
  owner: 'PM',
  contractor: 'PLZ',
  percentComplete: 70,
  progressSource: 'project_manager',
  progressConfirmedAt: '2026-07-19T18:00:00.000Z',
  progressConfirmedBy: 'PM',
  priority: 'High',
  status: 'In Progress',
  notes: '',
  createdAt: '2026-07-19T18:00:00.000Z',
  updatedAt: '2026-07-19T18:00:00.000Z',
  cloudUpdatedAt: '2026-07-19T18:00:01.000Z',
};

function sameNameReportSnapshot(): DAVEWebReadOnlySnapshot {
  const taskForProject = (id: string, projectId: string, taskName: string) => ({
    ...SCHEDULE_ITEM,
    id,
    projectId,
    scheduleProjectName: 'Shared Project',
    projectName: 'Shared Project',
    taskName,
    cloudUpdatedAt: '2026-08-09T20:00:00.000Z',
  });
  const updateForProject = (id: string, projectId: string, notes: string) => ({
    id,
    projectName: 'Shared Project',
    areaName: 'Area',
    idempotencyKey: id,
    createdAt: '2026-08-09T20:00:00.000Z',
    updatedAt: '2026-08-09T20:00:00.000Z',
    ownerId: 'owner-1',
    updateData: {
      id,
      projectId,
      projectName: 'Shared Project',
      date: '2026-08-09T20:00:00.000Z',
      photos: [],
      notes,
      recipients: { contactIds: [] },
    },
  });
  const documentForProject = (id: string, projectId: string, name: string) => ({
    id,
    name,
    originalFileName: `${name}.pdf`,
    uri: '',
    mimeType: 'application/pdf',
    category: 'Drawing',
    notes: '',
    isCurrent: true,
    importedAt: '2026-08-09T20:00:00.000Z',
    projectId,
    projectName: 'Shared Project',
    projectNames: ['Shared Project'],
    importBatchId: null,
    cloudUpdatedAt: '2026-08-09T20:00:00.000Z',
    linkedScheduleItems: [],
  });
  return {
    projects: [
      { id: 'project-a', name: 'Shared Project' },
      { id: 'project-b', name: 'Shared Project' },
    ],
    scheduleItems: [
      taskForProject('task-a', 'project-a', 'A only task'),
      taskForProject('task-b', 'project-b', 'B only task'),
    ],
    projectUpdates: [
      updateForProject('update-a', 'project-a', 'A only update'),
      updateForProject('update-b', 'project-b', 'B only update'),
    ],
    referenceDocuments: [
      documentForProject('drawing-a', 'project-a', 'A only drawing'),
      documentForProject('drawing-b', 'project-b', 'B only drawing'),
    ],
    refreshedAt: '2026-08-09T20:05:00.000Z',
  } as DAVEWebReadOnlySnapshot;
}

function referenceDocument(
  id: string,
  isCurrent: boolean,
  cloudUpdatedAt: string | null,
) {
  return {
    id,
    name: `${id} schedule`,
    originalFileName: 'schedule.pdf',
    uri: '',
    mimeType: 'application/pdf',
    category: 'Schedules',
    notes: '',
    isCurrent,
    importedAt: '2026-07-19T18:00:00.000Z',
    projectId: null,
    projectName: '2375 Compliance Project',
    projectNames: ['2375 Compliance Project'],
    importBatchId: `batch-${id}`,
    cloudUpdatedAt,
  };
}

function mutationQuery(result: { data: unknown; error: unknown }) {
  const query: Record<string, any> = { error: result.error };
  for (const method of ['select', 'eq', 'insert', 'update', 'upsert', 'delete']) {
    query[method] = jest.fn(() => query);
  }
  query.single = jest.fn(async () => result);
  query.maybeSingle = jest.fn(async () => result);
  query.in = jest.fn(async () => result);
  return query;
}

function mutationClient(queryForTable: (table: string) => Record<string, any>) {
  const from = jest.fn(queryForTable);
  const rpc: jest.Mock = jest.fn(async () => ({ data: true, error: null, status: 200 }));
  const auth = {
    getUser: jest.fn(async () => ({ data: { user: { id: 'owner-1' } }, error: null })),
    getSession: jest.fn(async () => ({ data: { session: null }, error: null })),
    onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
    signInWithPassword: jest.fn(),
    signOut: jest.fn(async () => ({ error: null })),
  };
  return { client: { auth, from, rpc } as any, auth, from, rpc };
}

function currentTaskPhotoRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SCHEDULE_ITEM.id,
    project_id: SCHEDULE_ITEM.projectId,
    project_name: SCHEDULE_ITEM.scheduleProjectName,
    task_name: SCHEDULE_ITEM.taskName,
    item_data: SCHEDULE_ITEM,
    updated_at: SCHEDULE_ITEM.cloudUpdatedAt,
    ...overrides,
  };
}

function taskPhotoMutationClient(
  updateQuery: Record<string, any>,
  overrides: {
    taskRow?: unknown;
    projectRow?: unknown;
  } = {},
) {
  const taskAuthority = mutationQuery({
    data: overrides.taskRow ?? currentTaskPhotoRow(),
    error: null,
  });
  const projectAuthority = mutationQuery({
    data: overrides.projectRow ?? {
      id: 'project-1',
      name: '2375 Compliance Project',
      archived: false,
    },
    error: null,
  });
  return mutationClient(table => {
    if (table === 'schedule_items') return taskAuthority;
    if (table === 'projects') return projectAuthority;
    if (table === 'project_updates') return updateQuery;
    throw new Error(`Unexpected table ${table}`);
  });
}
