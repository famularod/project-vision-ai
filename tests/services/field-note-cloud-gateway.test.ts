import {
  createFieldNoteCloudGateway,
  normalizeFieldNoteCloudRow,
} from '../../services/FieldNoteCloudGateway';
import {
  createFieldNote,
  updateFieldNoteDetails,
} from '../../services/FieldNoteRepository';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

function cloudRow(overrides: Record<string, unknown> = {}) {
  return {
    owner_id: 'owner-1',
    id: 'note-1',
    original_text: 'Guardrail may be missing.',
    source: 'voice',
    project_id: null,
    project_name: null,
    location_name: 'North Lot',
    action_kind: 'safety_candidate',
    action_text: 'Review the exposed edge',
    status: 'open',
    revision: 1,
    created_at: '2026-08-03T15:00:00.000Z',
    updated_at: '2026-08-03T15:00:00.000Z',
    resolved_at: null,
    archived_at: null,
    ...overrides,
  };
}

function clientFixture() {
  const query: Record<string, jest.Mock> = {};
  for (const method of ['select', 'eq', 'order', 'insert', 'update']) {
    query[method] = jest.fn(() => query);
  }
  query.range = jest.fn(async () => ({ data: [cloudRow()], error: null, status: 200 }));
  query.single = jest.fn(async () => ({ data: cloudRow(), error: null, status: 201 }));
  query.maybeSingle = jest.fn(async () => ({
    data: cloudRow({ revision: 2, updated_at: '2026-08-03T15:05:00.000Z' }),
    error: null,
    status: 200,
  }));
  const from = jest.fn(() => query);
  return {
    client: { from } as any,
    from,
    query,
  };
}

describe('Field Note cloud gateway', () => {
  it('normalizes an owner-scoped cloud row as synchronized', () => {
    const note = normalizeFieldNoteCloudRow(cloudRow());

    expect(note.id).toBe('note-1');
    expect(note.projectName).toBeNull();
    expect(note.revision).toBe(1);
    expect(note.syncState).toBe('synced');
  });

  it('owner-filters paged reads without requesting an exact count', async () => {
    const fixture = clientFixture();
    const gateway = createFieldNoteCloudGateway(fixture.client, async () => 'owner-1');

    const notes = await gateway.list();

    expect(notes).toHaveLength(1);
    expect(fixture.from).toHaveBeenCalledWith('field_notes');
    expect(fixture.query.eq).toHaveBeenCalledWith('owner_id', 'owner-1');
    expect(fixture.query.range).toHaveBeenCalledWith(0, 499);
  });

  it('creates revision one with the authenticated owner id', async () => {
    const fixture = clientFixture();
    const gateway = createFieldNoteCloudGateway(fixture.client, async () => 'owner-1');
    const note = createFieldNote({
      id: 'note-1',
      text: 'Guardrail may be missing.',
      source: 'voice',
      locationName: 'North Lot',
      actionKind: 'safety_candidate',
      actionText: 'Review the exposed edge',
      now: '2026-08-03T15:00:00.000Z',
    });

    await gateway.create(note);

    expect(fixture.query.insert).toHaveBeenCalledWith(expect.objectContaining({
      owner_id: 'owner-1',
      id: 'note-1',
      revision: 1,
    }));
  });

  it('rejects a stale desktop edit instead of silently overwriting it', async () => {
    const fixture = clientFixture();
    fixture.query.maybeSingle
      .mockResolvedValueOnce({ data: null, error: null, status: 200 })
      .mockResolvedValueOnce({
        data: cloudRow({
          original_text: 'Changed on iPad',
          revision: 2,
          updated_at: '2026-08-03T15:04:00.000Z',
        }),
        error: null,
        status: 200,
      });
    const gateway = createFieldNoteCloudGateway(fixture.client, async () => 'owner-1');
    const cloud = normalizeFieldNoteCloudRow(cloudRow());
    const desktopEdit = updateFieldNoteDetails(cloud, {
      text: 'Changed on desktop',
      locationName: cloud.locationName,
      actionKind: cloud.actionKind,
      actionText: cloud.actionText,
      now: '2026-08-03T15:05:00.000Z',
    });

    await expect(gateway.update(desktopEdit, 1)).rejects.toMatchObject({
      code: 'conflict',
    });
    expect(fixture.query.eq).toHaveBeenCalledWith('revision', 1);
  });

  it('gives simultaneous realtime subscribers distinct channels and registers before subscribing', async () => {
    const events: string[] = [];
    const channels: Array<{
      on: jest.Mock;
      subscribe: jest.Mock;
    }> = [];
    const channel = jest.fn((topic: string) => {
      const nextChannel: { on: jest.Mock; subscribe: jest.Mock } = {
        on: jest.fn(),
        subscribe: jest.fn(),
      };
      nextChannel.on.mockImplementation(() => {
        events.push(`${topic}:on`);
        return nextChannel;
      });
      nextChannel.subscribe.mockImplementation(() => {
        events.push(`${topic}:subscribe`);
        return nextChannel;
      });
      channels.push(nextChannel);
      return nextChannel;
    });
    const removeChannel = jest.fn(async () => 'ok');
    const client = { channel, removeChannel } as any;
    const gateway = createFieldNoteCloudGateway(client, async () => 'owner-1');
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_785_863_230_285);

    try {
      const [unsubscribeFirst, unsubscribeSecond] = await Promise.all([
        gateway.subscribe(() => undefined),
        gateway.subscribe(() => undefined),
      ]);

      expect(channel).toHaveBeenCalledTimes(2);
      expect(channel.mock.calls[0][0]).not.toBe(channel.mock.calls[1][0]);
      expect(events).toEqual([
        `${channel.mock.calls[0][0]}:on`,
        `${channel.mock.calls[0][0]}:subscribe`,
        `${channel.mock.calls[1][0]}:on`,
        `${channel.mock.calls[1][0]}:subscribe`,
      ]);

      unsubscribeFirst();
      unsubscribeSecond();
      expect(removeChannel).toHaveBeenCalledTimes(2);
      expect(channels).toHaveLength(2);
    } finally {
      now.mockRestore();
    }
  });

  it('contains a realtime registration failure and reconnects on a fresh channel', async () => {
    jest.useFakeTimers();
    const statuses: string[] = [];
    const brokenChannel = {
      on: jest.fn(() => {
        throw new Error('cannot add `postgres_changes` callbacks after `subscribe()`.');
      }),
      subscribe: jest.fn(),
    };
    const recoveredChannel = {
      on: jest.fn(),
      subscribe: jest.fn(),
    };
    recoveredChannel.on.mockReturnValue(recoveredChannel);
    recoveredChannel.subscribe.mockReturnValue(recoveredChannel);
    const channel = jest.fn()
      .mockReturnValueOnce(brokenChannel)
      .mockReturnValueOnce(recoveredChannel);
    const removeChannel = jest.fn(async () => 'ok');
    const gateway = createFieldNoteCloudGateway(
      { channel, removeChannel } as any,
      async () => 'owner-1',
    );

    try {
      const unsubscribe = await gateway.subscribe(
        () => undefined,
        status => statuses.push(status),
      );

      expect(statuses).toEqual(['retrying']);
      await jest.advanceTimersByTimeAsync(1_000);
      expect(channel).toHaveBeenCalledTimes(2);
      expect(channel.mock.calls[0][0]).not.toBe(channel.mock.calls[1][0]);
      expect(recoveredChannel.on.mock.invocationCallOrder[0]).toBeLessThan(
        recoveredChannel.subscribe.mock.invocationCallOrder[0],
      );

      unsubscribe();
    } finally {
      jest.useRealTimers();
    }
  });
});
