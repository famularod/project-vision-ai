import {
  createDAVEWebSupabaseGateway,
  DAVEWebArtifactAccessError,
  DAVEWebAuthorizationError,
  DAVEWebDocumentMutationError,
  DAVEWebTaskMutationError,
} from '../../services/DAVEWebSupabaseClient';
import type { ScheduleItem } from '../../types';

function queryWithRows(rows: unknown[]) {
  const query: Record<string, jest.Mock> = {};
  for (const method of ['select', 'eq', 'order']) {
    query[method] = jest.fn(() => query);
  }
  query.range = jest.fn(async () => ({ data: rows, error: null, status: 200, count: rows.length }));
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
  const from = jest.fn((table: string) => queries.get(table));
  const rpc = jest.fn(async () => ({ data: authorized, error: null, status: 200 }));
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
    createSignedUrl,
    storageFrom,
  };
}

describe('DAVE browser Supabase gateway', () => {
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
      'reference_documents',
      'dave_sync_tombstones',
      'dave_storage_cleanup_intents',
    ]);
    for (const query of fixture.queries.values()) {
      expect(query.eq).toHaveBeenCalledWith('owner_id', 'owner-1');
    }
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
      document_data: {
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
      project_name: '2375 Compliance Project',
      item_data: SCHEDULE_ITEM,
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

  test('restores the previous current-schedule state after a mid-sequence write failure', async () => {
    const previousA = referenceDocument('schedule-a', true, 'revision-a');
    const previousB = referenceDocument('schedule-b', true, 'revision-b');
    const selected = referenceDocument('schedule-c', false, 'revision-c');
    const preflight = mutationQuery({
      data: [
        { id: previousA.id, updated_at: 'revision-a' },
        { id: previousB.id, updated_at: 'revision-b' },
        { id: selected.id, updated_at: 'revision-c' },
      ],
      error: null,
    });
    const deactivateA = mutationQuery({ data: { updated_at: 'revision-a-new' }, error: null });
    const deactivateB = mutationQuery({ data: null, error: { message: 'fault: second write' } });
    const restoreA = mutationQuery({ data: { updated_at: 'revision-a-restored' }, error: null });
    const queries = [preflight, deactivateA, deactivateB, restoreA];
    const fixture = mutationClient(() => queries.shift()!);
    const gateway = createDAVEWebSupabaseGateway(fixture.client);

    await expect(
      gateway.setAuthorizedCurrentSchedule(selected, [previousA, previousB, selected]),
    ).rejects.toMatchObject<Partial<DAVEWebDocumentMutationError>>({
      code: 'write_failed',
      message: expect.stringMatching(/previous schedule selection was restored/i),
    });

    expect(deactivateA.update).toHaveBeenCalledWith(expect.objectContaining({
      document_data: expect.objectContaining({ id: 'schedule-a', isCurrent: false }),
    }));
    expect(restoreA.update).toHaveBeenCalledWith(expect.objectContaining({
      document_data: expect.objectContaining({ id: 'schedule-a', isCurrent: true }),
    }));
    expect(restoreA.eq).toHaveBeenCalledWith('updated_at', 'revision-a-new');
  });

  test('reports an honest recovery failure when current-schedule rollback also fails', async () => {
    const previousA = referenceDocument('schedule-a', true, 'revision-a');
    const previousB = referenceDocument('schedule-b', true, 'revision-b');
    const selected = referenceDocument('schedule-c', false, 'revision-c');
    const preflight = mutationQuery({
      data: [
        { id: previousA.id, updated_at: 'revision-a' },
        { id: previousB.id, updated_at: 'revision-b' },
        { id: selected.id, updated_at: 'revision-c' },
      ],
      error: null,
    });
    const deactivateA = mutationQuery({ data: { updated_at: 'revision-a-new' }, error: null });
    const deactivateB = mutationQuery({ data: null, error: { message: 'fault: second write' } });
    const failedRestoreA = mutationQuery({ data: null, error: { message: 'fault: rollback' } });
    const queries = [preflight, deactivateA, deactivateB, failedRestoreA];
    const fixture = mutationClient(() => queries.shift()!);
    const gateway = createDAVEWebSupabaseGateway(fixture.client);

    await expect(
      gateway.setAuthorizedCurrentSchedule(selected, [previousA, previousB, selected]),
    ).rejects.toMatchObject<Partial<DAVEWebDocumentMutationError>>({
      code: 'write_failed',
      message: expect.stringMatching(/automatic recovery could not be confirmed/i),
    });

    expect(failedRestoreA.update).toHaveBeenCalled();
  });
});

const SCHEDULE_ITEM: ScheduleItem = {
  id: 'task-1',
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
  const rpc = jest.fn(async () => ({ data: true, error: null, status: 200 }));
  const auth = {
    getUser: jest.fn(async () => ({ data: { user: { id: 'owner-1' } }, error: null })),
    getSession: jest.fn(async () => ({ data: { session: null }, error: null })),
    onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
    signInWithPassword: jest.fn(),
    signOut: jest.fn(async () => ({ error: null })),
  };
  return { client: { auth, from, rpc } as any, auth, from, rpc };
}
