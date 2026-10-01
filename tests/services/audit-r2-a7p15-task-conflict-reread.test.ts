/**
 * Whole-app audit A7 pass 15 (1 Oct 2026): Keep Phone and Keep Cloud on a
 * task's conflict, and the cloud copy they read.
 *
 * L-2 "Deleted on another device" was judged from a full read of the task
 *     list. That list pages by offset, newest first, so a row edited while it
 *     was read moved to page 0 and was skipped: the conflict closed with a
 *     false "This task was deleted on another device". The task's row is now
 *     read by its id; no row is a deletion, a failed read is not.
 *
 * Runs the real SyncService queue, upload and conflict store; the cloud is a
 * mocked row per task (as sync-tombstone-upload-gate.test.ts does).
 */
import type { ScheduleItem } from '../../types';

const mockStorage = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { mockStorage.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { mockStorage.delete(key); }),
    getAllKeys: jest.fn(async () => [...mockStorage.keys()]),
  },
}));

/** The cloud's task rows, by id. */
const mockCloudRows = new Map<string, ScheduleItem>();
/** The cloud cannot be read. */
let mockCloudUnreadable = false;
const mockCopy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const mockOk = <T>(data: T) => ({ ok: true, configured: true, stubbed: false, data });
const mockUnreadable = () => ({ ok: false, configured: true, stubbed: false, data: null, error: 'Network request failed' });
const mockCloud = {
  list: async (): Promise<unknown> => mockCloudUnreadable
    ? mockUnreadable()
    : mockOk([...mockCloudRows.values()].map(mockCopy)),
  get: async (id: string): Promise<unknown> => mockCloudUnreadable
    ? mockUnreadable()
    : mockOk(mockCloudRows.has(id) ? mockCopy(mockCloudRows.get(id)!) : null),
  upsert: async (item: ScheduleItem): Promise<unknown> => {
    mockCloudRows.set(item.id, mockCopy(item));
    return mockOk(item);
  },
};
const mockListScheduleItems = jest.fn(mockCloud.list);
const mockGetScheduleItem = jest.fn(mockCloud.get);
const mockUpsertScheduleItem = jest.fn(mockCloud.upsert);

jest.mock('../../services/SupabaseService', () => ({
  getSupabaseConfigurationStatus: () => ({ configured: true, message: 'Configured.' }),
  listProjects: async () => mockOk([{ id: '607c7eed-5dea-4a5a-8b52-0f165c71c4b5', name: '2321 Compliance Project' }]),
  listArchivedProjects: async () => mockOk([]),
  listDAVESyncTombstones: async () => mockOk([]),
  upsertDAVESyncTombstone: async () => mockOk(null),
  upsertDAVESyncTombstones: async (tombstones: unknown[]) => mockOk(tombstones),
  listScheduleItems: () => mockListScheduleItems(),
  getScheduleItem: (id: string) => mockGetScheduleItem(id),
  upsertScheduleItem: (item: ScheduleItem) => mockUpsertScheduleItem(item),
}));

import {
  getOfflineQueue,
  getSyncConflicts,
  queueScheduleItemRecord,
  resolveScheduleItemSyncConflict,
  runScheduleItemCloudSync,
} from '../../services/SyncService';

const phoneTask: ScheduleItem = {
  id: 'task-a7p15',
  itemType: 'Task',
  projectName: '2321 Compliance Project',
  locationName: '2321 North Lot',
  taskName: 'Pour slab',
  startDate: '2026-10-03',
  finishDate: '2026-10-07',
  milestone: '',
  owner: '',
  contractor: '',
  percentComplete: 0,
  priority: 'Medium',
  status: 'Not Started',
  notes: 'Phone note.',
  nextAction: '',
  activity: [],
  importedFrom: 'master-n.csv',
  importBatchId: 'batch-n',
  revisedFromTaskIds: ['row-a'],
  createdAt: '2026-09-28T08:00:00.000Z',
  updatedAt: '2026-09-28T09:00:00.000Z',
};

/** Another task of the schedule. */
function otherTask(n: number): ScheduleItem {
  return { ...phoneTask, id: `task-other-${n}`, taskName: `Other task ${n}`, notes: '', revisedFromTaskIds: null };
}

/** The phone's offline edit meets the web's newer copy: the conflict is saved, the cloud copy as it was then. */
async function conflictWithWebCopy() {
  mockCloudRows.set(phoneTask.id, {
    ...phoneTask, notes: '', revisedFromTaskIds: ['row-x', 'row-a'], updatedAt: '2026-09-29T12:00:00.000Z',
  });
  await runScheduleItemCloudSync(phoneTask);
  const [conflict] = await getSyncConflicts();
  expect(conflict).toMatchObject({ entity: 'schedule_item', localId: phoneTask.id });
  return conflict;
}

/** Meanwhile David entered 50% on the web. */
function webEnters50(conflict: { remotePayload?: unknown }): ScheduleItem {
  const row = {
    ...(conflict.remotePayload as ScheduleItem),
    percentComplete: 50,
    status: 'In Progress' as const,
    updatedAt: '2026-09-30T09:00:00.000Z',
  };
  mockCloudRows.set(row.id, row);
  return row;
}

beforeEach(() => {
  mockStorage.clear();
  mockCloudRows.clear();
  mockCloudUnreadable = false;
  mockListScheduleItems.mockReset().mockImplementation(mockCloud.list);
  mockGetScheduleItem.mockReset().mockImplementation(mockCloud.get);
  mockUpsertScheduleItem.mockReset().mockImplementation(mockCloud.upsert);
  mockCloudRows.set('task-other-1', otherTask(1));
  mockCloudRows.set('task-other-2', otherTask(2));
});

describe('L-2: Keep Cloud judges "deleted on another device" from the task\'s own row (audit A7 pass 15)', () => {
  it('a row edited while the list was read, which the list missed, is not called deleted: Keep Cloud keeps it', async () => {
    const conflict = await conflictWithWebCopy();
    const current = webEnters50(conflict);
    // The edit moved the row to page 0 after that page was read: the list
    // lost it and returned another row twice (a 1,200-row probe did this).
    mockListScheduleItems.mockImplementation(async () => mockOk([otherTask(1), otherTask(2), otherTask(2)]));
    mockListScheduleItems.mockClear();

    // It threw sync_conflict_record_deleted and closed the conflict.
    await expect(resolveScheduleItemSyncConflict(conflict.id, 'keep_cloud')).resolves.toEqual(current);
    expect(mockUpsertScheduleItem).not.toHaveBeenCalled();
    expect(mockCloudRows.get(phoneTask.id)).toEqual(current);
    await expect(getSyncConflicts()).resolves.toEqual([]);
    await expect(getOfflineQueue()).resolves.toEqual([]);
    // The row by its id, not the whole task table twice.
    expect(mockGetScheduleItem).toHaveBeenCalledWith(phoneTask.id);
    expect(mockListScheduleItems).not.toHaveBeenCalled();
  });

  it('a task the cloud no longer has still closes the conflict, writing nothing', async () => {
    const conflict = await conflictWithWebCopy();
    mockCloudRows.delete(phoneTask.id);

    await expect(resolveScheduleItemSyncConflict(conflict.id, 'keep_cloud'))
      .rejects.toThrow('sync_conflict_record_deleted');
    expect(mockUpsertScheduleItem).not.toHaveBeenCalled();
    await expect(getSyncConflicts()).resolves.toEqual([]);
  });

  it('a read that fails is not a deletion: nothing changes', async () => {
    const conflict = await conflictWithWebCopy();
    await queueScheduleItemRecord(
      { ...phoneTask, notes: 'A newer phone edit.', updatedAt: '2026-09-30T10:00:00.000Z' }, false, ['notes', 'updatedAt'],
    );
    const queued = await getOfflineQueue();
    mockCloudUnreadable = true;

    await expect(resolveScheduleItemSyncConflict(conflict.id, 'keep_cloud'))
      .rejects.toThrow('sync_conflict_cloud_copy_unreadable');
    expect(mockUpsertScheduleItem).not.toHaveBeenCalled();
    await expect(getSyncConflicts()).resolves.toEqual([conflict]);
    await expect(getOfflineQueue()).resolves.toEqual(queued);
  });
});
