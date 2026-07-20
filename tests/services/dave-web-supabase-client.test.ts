import {
  createDAVEWebSupabaseGateway,
  DAVEWebAuthorizationError,
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
  return { client: { auth, from, rpc } as any, auth, from, rpc, queries };
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
    ]);
    for (const query of fixture.queries.values()) {
      expect(query.eq).toHaveBeenCalledWith('owner_id', 'owner-1');
    }
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

function mutationQuery(result: { data: unknown; error: unknown }) {
  const query: Record<string, any> = { error: result.error };
  for (const method of ['select', 'eq', 'insert', 'update', 'upsert', 'delete']) {
    query[method] = jest.fn(() => query);
  }
  query.single = jest.fn(async () => result);
  query.maybeSingle = jest.fn(async () => result);
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
