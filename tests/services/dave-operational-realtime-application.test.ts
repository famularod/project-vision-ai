import {
  createDAVEOperationalRealtimeApplier,
  createDAVEOperationalRealtimeCommit,
  mergeProjectNames,
  replaceOperationalRecord,
} from '../../services/DAVEOperationalRealtimeApplication';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
  getAllKeys: jest.fn(async () => []),
  multiGet: jest.fn(async () => []),
}));

function baseOptions(overrides: Record<string, unknown> = {}) {
  const state = {
    projects: [], projectRecords: [], archivedProjects: [], deletedProjectNames: [],
    updates: [], deletedUpdates: [], tombstones: [], areas: [], scheduleItems: [], documents: [],
  };
  return {
    state,
    options: {
      isActive: () => true,
      snapshot: () => state,
      getPendingQueue: jest.fn(async () => []),
      normalizeUpdate: (value: unknown) => value,
      normalizeAreas: (value: unknown) => value,
      normalizeSchedule: (value: unknown) => value,
      normalizeDocuments: (value: unknown) => value,
      migrateSchedule: (value: unknown) => value,
      localPhotoUri: () => '',
      mergeProjectNames,
      mergeUpdates: ({ localUpdates }: { localUpdates: unknown[] }) => localUpdates,
      buildUpdateTombstone: jest.fn(),
      buildCloudDeletionBarrier: (updateId: string, deletedAt: string) => ({
        updateId, deletedAt, action: 'hide_cloud_update',
      }),
      upsertDeletedUpdate: (current: unknown[], next: unknown) => [...current, next],
      commitProjects: jest.fn(),
      commitDeletedProjects: jest.fn(),
      commitUpdates: jest.fn(),
      commitDeletedUpdates: jest.fn(),
      commitTombstones: jest.fn(),
      commitAreas: jest.fn(),
      commitSchedule: jest.fn(),
      commitDocuments: jest.fn(),
      ...overrides,
    },
  };
}

describe('DAVE operational realtime row application', () => {
  it('commits a delivered schedule row without requiring a collection pull', async () => {
    const { options } = baseOptions();
    const apply = createDAVEOperationalRealtimeApplier(options as never);

    await expect(apply('schedule_item', {
      eventType: 'UPDATE',
      newRow: {
        id: 'task-1',
        item_data: {
          id: 'task-1',
          projectName: '2321 Compliance Project',
          taskName: 'Verify enclosure',
          status: 'To Do',
          percentComplete: 0,
        },
      },
      oldRow: null,
      raw: null,
    })).resolves.toBe(true);

    expect(options.getPendingQueue).toHaveBeenCalledTimes(1);
    expect(options.commitSchedule).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'task-1', taskName: 'Verify enclosure' }),
    ]);
  });

  it('applies a durable update tombstone directly to visible and deleted state', async () => {
    const visibleUpdate = {
      id: 'update-1', projectName: '2321 Compliance Project', date: '2026-08-01',
      photos: [], notes: '', recipients: { contactIds: [] },
    };
    const { state, options } = baseOptions();
    state.updates = [visibleUpdate] as never;
    const apply = createDAVEOperationalRealtimeApplier(options as never);

    await expect(apply('sync_tombstone', {
      eventType: 'INSERT',
      newRow: {
        entity_type: 'project_update',
        record_id: 'update-1',
        deleted_at: '2026-08-01T10:00:00.000Z',
      },
      oldRow: null,
      raw: null,
    })).resolves.toBe(true);

    expect(options.getPendingQueue).not.toHaveBeenCalled();
    expect(options.commitUpdates).toHaveBeenCalledWith([]);
    expect(options.commitDeletedUpdates).toHaveBeenCalledWith([
      expect.objectContaining({ updateId: 'update-1' }),
    ]);
  });

  it('keeps record replacement and ref commits stable for unchanged values', () => {
    const current = [{ id: 'one', value: 1 }];
    expect(replaceOperationalRecord(current, { id: 'one', value: 1 }, row => row.id))
      .toBe(current);
    const ref = { current: current };
    const set = jest.fn();
    const commit = createDAVEOperationalRealtimeCommit(ref, set);
    const next = [{ id: 'two', value: 2 }];
    commit(next);
    expect(ref.current).toBe(next);
    expect(set).toHaveBeenCalledWith(next);
  });
});
