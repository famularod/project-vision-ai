import {
  createDAVEWebSupabaseGateway,
  DAVEWebArtifactAccessError,
  DAVEWebAuthorizationError,
  DAVEWebDocumentMutationError,
  DAVEWebTaskMutationError,
} from '../../services/DAVEWebSupabaseClient';
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

function clientFixture({ authorized = true }: { authorized?: boolean } = {}) {
  let referenceDocumentRows: unknown[] = [];
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
  const rpc: jest.Mock = jest.fn(async (name: string) => {
    if (name === 'dave_is_app_owner') {
      return { data: authorized, error: null, status: 200 };
    }
    if (name === 'dave_list_reference_document_metadata') {
      return { data: referenceDocumentRows, error: null, status: 200 };
    }
    return { data: null, error: null, status: 200 };
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
    setReferenceDocumentRows(rows: unknown[]) {
      referenceDocumentRows = rows;
    },
    createSignedUrl,
    storageFrom,
  };
}

describe('DAVE browser Supabase gateway', () => {
  test('lets the SIGNED_IN auth event own authorization invalidation after password sign-in', async () => {
    const fixture = clientFixture();
    fixture.auth.signInWithPassword.mockResolvedValue({
      data: {
        session: {
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          expires_in: 3600,
          token_type: 'bearer',
          user: { id: 'owner-1' },
        },
      },
      error: null,
    });
    const gateway = createDAVEWebSupabaseGateway(fixture.client);

    await gateway.loadAuthorizedRows();
    await expect(gateway.signIn('owner@example.com', 'password')).resolves.toMatchObject({
      ok: true,
    });
    await gateway.loadAuthorizedRows();

    expect(fixture.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'owner@example.com',
      password: 'password',
    });
    expect(fixture.rpc.mock.calls.filter(([name]) => name === 'dave_is_app_owner')).toHaveLength(1);
  });

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

  test('loads reference document metadata through the bounded owner RPC', async () => {
    const fixture = clientFixture();
    fixture.setReferenceDocumentRows([{
      id: 'document-1',
      owner_id: 'owner-1',
      name: 'A101',
      document_data: { id: 'document-1', name: 'A101' },
    }]);
    const gateway = createDAVEWebSupabaseGateway(fixture.client);

    const rows = await gateway.loadAuthorizedRows();

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
    expect(rows.referenceDocuments).toEqual([
      expect.objectContaining({ id: 'document-1', name: 'A101' }),
    ]);
  });

  test('fails closed when bounded reference document metadata cannot be loaded', async () => {
    const fixture = clientFixture();
    fixture.rpc.mockImplementation(async (name: string) => name === 'dave_is_app_owner'
      ? { data: true, error: null, status: 200 }
      : { data: null, error: { message: 'statement timeout' }, status: 500 });
    const gateway = createDAVEWebSupabaseGateway(fixture.client);

    await expect(gateway.loadAuthorizedRows()).rejects.toThrow(
      'Authorized reference document metadata could not be loaded.',
    );
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

  test('checks desktop owner authorization before loading one exact proof identity', async () => {
    const fixture = clientFixture();
    const sourceSha256 = 'a'.repeat(64);
    fixture.rpc.mockImplementation(async (name: string) => {
      if (name === 'dave_is_app_owner') return { data: true, error: null, status: 200 };
      if (name === 'dave_verify_current_ecos_document_proof') {
        return {
          data: [{
            document_id: 'drawing-1',
            project_id: 'project-1',
            source_sha256: sourceSha256,
            evidence_version: 'ecos-hosted-evidence/1.3',
            source_revision: '1',
            page_number: 6,
            sheet_number: 'C6',
            region_id: 'region-1',
            region_bounds: { x: 0.1, y: 0.2, width: 0.3, height: 0.1 },
          }],
          error: null,
          status: 200,
        };
      }
      return { data: null, error: null, status: 200 };
    });
    const gateway = createDAVEWebSupabaseGateway(fixture.client);

    const result = await gateway.loadAuthorizedDocumentProof({
      id: 'drawing-1',
      name: 'C6',
      originalFileName: 'C6.pdf',
      uri: '',
      mimeType: 'application/pdf',
      category: 'Drawing',
      notes: '',
      isCurrent: true,
      importedAt: '2026-09-13T00:00:00.000Z',
      projectId: 'project-1',
      contentSha256: sourceSha256,
      webFileFingerprint: sourceSha256,
      indexedContentSha256: sourceSha256,
      drawingRevision: '1',
      ecosVerifiedIndexCommitVersion: 'ecos-verified-index-commit/1.0',
      ecosVerifiedIndexCommittedSha256: sourceSha256,
      ecosVerifiedIndexCommittedPageCount: 8,
      sourcePageCount: 8,
      extractedPages: [],
    }, {
      documentId: 'drawing-1',
      projectId: 'project-1',
      sourceSha256,
      evidenceVersion: 'ecos-hosted-evidence/1.3',
      revision: '1',
      pageNumber: 6,
      sheetNumber: 'C6',
      regionId: 'region-1',
    });

    expect(fixture.auth.getUser).toHaveBeenCalledTimes(1);
    expect(fixture.rpc).toHaveBeenNthCalledWith(1, 'dave_is_app_owner');
    expect(fixture.rpc).toHaveBeenNthCalledWith(2, 'dave_verify_current_ecos_document_proof', expect.any(Object));
    expect(result.document.extractedPages).toEqual([
      expect.objectContaining({ pageNumber: 6, regions: [expect.objectContaining({ id: 'region-1' })] }),
    ]);
    expect(result.protectedPage).toBeNull();
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

  test('allows legacy mobile paths only after they are loaded from an owner record', async () => {
    const fixture = clientFixture();
    fixture.queries.set('project_updates', queryWithRows([{
      update_data: {
        photos: [{
          cloudStoragePath: '2375-Compliance-Project/update-1/photo-1.jpg',
        }],
      },
    }]));
    fixture.setReferenceDocumentRows([{
      document_data: {
        storagePath: 'project-documents/project-1/document-1/schedule.pdf',
      },
    }]);
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
      project_id: '607c7eed-5dea-4a5a-8b52-0f165c71c4b5',
      project_name: '2375 Compliance Project',
      item_data: expect.objectContaining({
        projectId: '607c7eed-5dea-4a5a-8b52-0f165c71c4b5',
      }),
    }));
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

    expect(scheduleQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      project_id: '607c7eed-5dea-4a5a-8b52-0f165c71c4b5',
      item_data: expect.objectContaining({
        projectId: '607c7eed-5dea-4a5a-8b52-0f165c71c4b5',
      }),
    }));
    expect(scheduleQuery.eq).toHaveBeenCalledWith('owner_id', 'owner-1');
    expect(scheduleQuery.eq).toHaveBeenCalledWith('updated_at', '2026-07-19T18:00:01.000Z');
  });

  test('shows the acknowledged desktop percentage instead of the stale cached percentage', async () => {
    const fixture = clientFixture();
    fixture.queries.set('schedule_items', queryWithRows([{
      id: SCHEDULE_ITEM.id,
      owner_id: 'owner-1',
      project_name: SCHEDULE_ITEM.projectName,
      task_name: SCHEDULE_ITEM.taskName,
      item_data: { ...SCHEDULE_ITEM, percentComplete: 20 },
      updated_at: '2026-07-19T18:00:01.000Z',
    }]));
    const gateway = createDAVEWebSupabaseGateway(fixture.client);
    await gateway.loadAuthorizedRows();

    fixture.queries.set('dave_sync_tombstones', mutationQuery({ data: null, error: null }));
    fixture.queries.set('schedule_items', mutationQuery({
      data: { updated_at: '2026-07-19T18:00:02.000Z' },
      error: null,
    }));
    await gateway.updateAuthorizedScheduleItem(
      { ...SCHEDULE_ITEM, percentComplete: 25 },
      '2026-07-19T18:00:01.000Z',
    );
    fixture.from.mockClear();

    const rows = await gateway.loadAuthorizedRows(['schedule_items']);

    expect(fixture.from).not.toHaveBeenCalled();
    expect(rows.scheduleItems).toEqual([
      expect.objectContaining({
        id: SCHEDULE_ITEM.id,
        updated_at: '2026-07-19T18:00:02.000Z',
        item_data: expect.objectContaining({ percentComplete: 25 }),
      }),
    ]);
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
    const fixture = mutationClient(() => updateInsert);
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
      project_name: '2375 Compliance Project',
      area_name: 'Canopy C',
      idempotency_key: updateId,
      update_data: expect.objectContaining({
        scheduleItemId: 'task-1',
        scheduleTaskName: 'Install handrails',
        selectedAreaName: 'Canopy C',
        photos: [
          expect.objectContaining({
            fileName: 'handrails.jpg',
            mimeType: 'image/jpeg',
            cloudStoragePath: expect.stringMatching(/^owner-1\/web-updates\//),
          }),
        ],
      }),
    }));
    expect(storage.remove).not.toHaveBeenCalled();
  });

  test('removes a task photo when its field-update record cannot be saved', async () => {
    const updateInsert = mutationQuery({
      data: null,
      error: { message: 'fault: project update insert' },
    });
    const fixture = mutationClient(() => updateInsert);
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
});

const SCHEDULE_ITEM: ScheduleItem = {
  id: 'task-1',
  projectId: '607c7eed-5dea-4a5a-8b52-0f165c71c4b5',
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
};

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
