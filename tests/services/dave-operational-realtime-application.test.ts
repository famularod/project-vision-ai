import {
  createDAVEOperationalRealtimeApplier,
  createDAVEOperationalRealtimeCommit,
  mergeProjectNames,
  replaceOperationalRecord,
} from '../../services/DAVEOperationalRealtimeApplication';
import fs from 'fs';
import path from 'path';

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
        project_id: '23212321-2321-4232-8232-232123212321',
        item_data: {
          id: 'task-1',
          projectId: '23212321-2321-4232-8232-232123212321',
          projectName: '2321 Compliance Project',
          scheduleProjectName: '2321 Compliance Project',
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

  it('quarantines a name-only realtime task instead of rebinding it by project name', async () => {
    const { options } = baseOptions();
    const apply = createDAVEOperationalRealtimeApplier(options as never);

    await expect(apply('schedule_item', {
      eventType: 'UPDATE',
      newRow: {
        id: 'legacy-task',
        project_id: null,
        item_data: {
          id: 'legacy-task',
          projectName: 'Shared Project',
          taskName: 'Legacy task',
          status: 'To Do',
          percentComplete: 0,
        },
      },
      oldRow: null,
      raw: null,
    })).resolves.toBe(false);

    expect(options.commitSchedule).not.toHaveBeenCalled();
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

  it('applies a project tombstone by immutable id without deleting a same-name sibling', async () => {
    const { state, options } = baseOptions();
    state.projects = ['Shared Project'] as never;
    state.projectRecords = [
      { id: 'project-selected', name: 'Shared Project' },
      { id: 'project-sibling', name: 'Shared Project' },
    ] as never;
    const apply = createDAVEOperationalRealtimeApplier(options as never);

    await expect(apply('sync_tombstone', {
      eventType: 'INSERT',
      newRow: {
        entity_type: 'project',
        record_id: 'project-selected',
        deleted_at: '2026-08-01T10:00:00.000Z',
      },
      oldRow: null,
      raw: null,
    })).resolves.toBe(true);

    expect(options.commitProjects).toHaveBeenCalledWith(
      [{ id: 'project-sibling', name: 'Shared Project' }],
      ['Shared Project'],
      [],
    );
    expect(options.commitDeletedProjects).not.toHaveBeenCalled();
  });

  it('treats a UUID-shaped legacy name as a broad barrier when no exact id authority exists', async () => {
    const deletedProjectId = '550e8400-e29b-41d4-a716-446655440000';
    const { state, options } = baseOptions();
    state.projects = [deletedProjectId] as never;
    state.projectRecords = [{
      id: '8b0f3c83-e8c3-4f5e-aec6-65a74436b4e2',
      name: deletedProjectId,
    }] as never;
    const apply = createDAVEOperationalRealtimeApplier(options as never);

    await expect(apply('sync_tombstone', {
      eventType: 'INSERT',
      newRow: {
        entity_type: 'project',
        record_id: deletedProjectId,
        deleted_at: '2026-08-01T10:00:00.000Z',
      },
      oldRow: null,
      raw: null,
    })).resolves.toBe(true);

    expect(options.commitProjects).toHaveBeenCalledWith(
      [],
      [],
      [],
    );
    expect(options.commitDeletedProjects).toHaveBeenCalledWith([deletedProjectId]);
  });

  it('classifies App tombstone hydration before deriving legacy name barriers', () => {
    const app = fs.readFileSync(path.join(process.cwd(), 'App.tsx'), 'utf8');
    expect(app).toContain('projectTombstoneUsesExactId');
    expect(app).toContain('legacyProjectTombstoneNames');
    expect(app).not.toContain('projectTombstoneKeys.has(nameKey)');
  });

  it('does not let an exact queued delete for A suppress a same-name B project row', async () => {
    const { options } = baseOptions({
      getPendingQueue: jest.fn(async () => [{
        entity: 'project',
        operation: 'delete',
        payload: { projectId: 'project-a', name: 'Shared Project' },
      }]),
    });
    const apply = createDAVEOperationalRealtimeApplier(options as never);

    await expect(apply('project', {
      eventType: 'INSERT',
      newRow: {
        id: 'project-b',
        name: 'Shared Project',
        archived: false,
        project_data: {},
      },
      oldRow: null,
      raw: null,
    })).resolves.toBe(true);

    expect(options.commitProjects).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'project-b', name: 'Shared Project' })],
      ['Shared Project'],
      [],
    );
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
