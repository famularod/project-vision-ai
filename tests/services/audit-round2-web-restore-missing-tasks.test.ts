import { createDAVEWebSupabaseGateway } from '../../services/DAVEWebSupabaseClient';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

// Whole-app audit round 2 F8 (30 Sep 2026): Restore Missing Tasks treated
// every task the workspace does not show as missing. It now asks the cloud
// which of them still exist (a schedule that is not current hides its tasks)
// or were deleted on purpose, and leaves those alone.
describe('listAuthorizedUnrestorableScheduleItemIds (audit round 2 F8)', () => {
  function inQuery(result: { data: unknown[] | null; error: unknown }) {
    const chain: Record<string, jest.Mock> = {};
    chain.select = jest.fn(() => chain);
    chain.eq = jest.fn(() => chain);
    chain.in = jest.fn(async () => result);
    return chain;
  }

  function gatewayWith(
    scheduleRows: { data: unknown[] | null; error: unknown },
    tombstoneRows: { data: unknown[] | null; error: unknown },
  ) {
    const schedule = inQuery(scheduleRows);
    const tombstones = inQuery(tombstoneRows);
    const client = {
      auth: {
        getUser: jest.fn(async () => ({ data: { user: { id: 'owner-1' } }, error: null })),
        getSession: jest.fn(async () => ({ data: { session: null }, error: null })),
        onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
      },
      rpc: jest.fn(async () => ({ data: true, error: null, status: 200 })),
      from: jest.fn((table: string) => (table === 'schedule_items' ? schedule : tombstones)),
    } as any;
    return { gateway: createDAVEWebSupabaseGateway(client), schedule, tombstones };
  }

  test('returns the ids that still exist in the cloud or have a deletion record', async () => {
    const { gateway, schedule, tombstones } = gatewayWith(
      { data: [{ id: 'hidden-task' }], error: null },
      { data: [{ record_id: 'deleted-task' }], error: null },
    );

    const ids = await gateway.listAuthorizedUnrestorableScheduleItemIds([
      'hidden-task',
      'deleted-task',
      'gone-task',
    ]);

    expect([...ids].sort()).toEqual(['deleted-task', 'hidden-task']);
    expect(schedule.eq).toHaveBeenCalledWith('owner_id', 'owner-1');
    expect(schedule.in).toHaveBeenCalledWith('id', ['hidden-task', 'deleted-task', 'gone-task']);
    expect(tombstones.eq).toHaveBeenCalledWith('entity_type', 'schedule_item');
    expect(tombstones.in).toHaveBeenCalledWith('record_id', ['hidden-task', 'deleted-task', 'gone-task']);
  });

  test('restores nothing when the shared record cannot be checked', async () => {
    const { gateway } = gatewayWith(
      { data: null, error: { message: 'timeout' } },
      { data: [], error: null },
    );

    await expect(gateway.listAuthorizedUnrestorableScheduleItemIds(['gone-task']))
      .rejects.toThrow('The shared record could not be checked, so nothing was restored.');
  });
});
