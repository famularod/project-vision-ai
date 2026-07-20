import { createDAVEWebSupabaseGateway, DAVEWebAuthorizationError } from '../../services/DAVEWebSupabaseClient';

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
});
