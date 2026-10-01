/**
 * Whole-app audit A7 pass 16 (1 Oct 2026): Keep Phone and Keep Cloud on a
 * task's conflict, and the upload of a task edit.
 *
 * L-1 Keep Cloud undid "phone edits" it found in the cloud's row whenever a
 *     field of the row equalled one of the phone's waiting edits, even when
 *     no edit had landed: a progress edit still waiting and the web's 60%
 *     share status and progressSource, so Keep Cloud wrote 60% back with
 *     "Not Started". It now undoes only when an edit of the phone's may have
 *     landed during the choice (its landing closes the conflict), or during
 *     an earlier Keep Cloud that could not finish (L-2).
 *
 * L-2 A Keep Cloud that could not finish put the phone's withdrawn edits
 *     back on the queue. Tasks have no automatic-send hold, so the next pass
 *     sent the edit David chose to discard and closed the conflict. They now
 *     wait on the conflict, not on the queue.
 *
 * Runs the real SyncService queue, upload and conflict store; the cloud is a
 * mocked row per task (as audit-r2-a7p15-task-conflict-reread.test.ts does).
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
const mockCopy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const mockOk = <T>(data: T) => ({ ok: true, configured: true, stubbed: false, data });
const mockUnreadable = () => ({ ok: false, configured: true, stubbed: false, data: null, error: 'Network request failed' });
const mockCloud = {
  list: async (): Promise<unknown> => mockOk([...mockCloudRows.values()].map(mockCopy)),
  get: async (id: string): Promise<unknown> => mockOk(mockCloudRows.has(id) ? mockCopy(mockCloudRows.get(id)!) : null),
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
  syncConflictChoiceStopReason,
  uploadPendingChanges,
} from '../../services/SyncService';

const phoneTask: ScheduleItem = {
  id: 'task-a7p16',
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
const NEWER = 'Pump truck booked (a newer phone edit).';

/** Another task of the schedule. */
function otherTask(n: number): ScheduleItem {
  return { ...phoneTask, id: `task-other-${n}`, taskName: `Other task ${n}`, notes: '', revisedFromTaskIds: null };
}

/** The phone's offline edit meets the web's newer copy: the conflict is saved, the cloud copy as it was then ("Cloud: Not Started · 0%"). */
async function conflictWithWebCopy() {
  mockCloudRows.set(phoneTask.id, {
    ...phoneTask, notes: '', revisedFromTaskIds: ['row-x', 'row-a'], updatedAt: '2026-09-29T12:00:00.000Z',
  });
  await runScheduleItemCloudSync(phoneTask);
  const [conflict] = await getSyncConflicts();
  expect(conflict).toMatchObject({ entity: 'schedule_item', localId: phoneTask.id });
  expect(await getOfflineQueue()).toEqual([]);
  mockUpsertScheduleItem.mockClear();
  return { conflict, shown: conflict.remotePayload as ScheduleItem };
}

/** A newer phone note edit is on its way up when David chooses; its upload lands when `land` is called. */
async function newerPhoneEditOnItsWayUp() {
  await queueScheduleItemRecord(
    { ...phoneTask, notes: NEWER, updatedAt: '2026-09-30T10:00:00.000Z' }, false, ['notes', 'updatedAt'],
  );
  let land!: () => void;
  const landing = new Promise<void>(resolve => { land = resolve; });
  let sending!: () => void;
  const sent = new Promise<void>(resolve => { sending = resolve; });
  mockUpsertScheduleItem.mockImplementationOnce(async (item: ScheduleItem) => {
    sending();
    await landing;
    return mockCloud.upsert(item);
  });
  const inFlight = uploadPendingChanges();
  await sent;
  return { land, inFlight };
}

/** The phone's upload already under way lands, and finishes, during Keep Cloud or Keep Phone's first read of the row. */
function landsDuringFirstRead({ land, inFlight }: { land: () => void; inFlight: Promise<unknown> }) {
  mockGetScheduleItem.mockImplementationOnce(async (id: string) => {
    land();
    await inFlight;
    return mockCloud.get(id);
  });
}

beforeEach(() => {
  mockStorage.clear();
  mockCloudRows.clear();
  mockListScheduleItems.mockReset().mockImplementation(mockCloud.list);
  mockGetScheduleItem.mockReset().mockImplementation(mockCloud.get);
  mockUpsertScheduleItem.mockReset().mockImplementation(mockCloud.upsert);
  mockCloudRows.set('task-other-1', otherTask(1));
  mockCloudRows.set('task-other-2', otherTask(2));
});


describe('L-1: Keep Cloud on a task writes nothing when no phone edit landed (audit A7 pass 16)', () => {
  it('a progress edit still waiting, then the web\'s 60%, with the screen still showing 0%: the 60% stays exactly as it is', async () => {
    const { conflict, shown } = await conflictWithWebCopy();
    // On weak signal David sets 30% on the phone during the conflict; it waits.
    await queueScheduleItemRecord({
      ...phoneTask,
      percentComplete: 30,
      status: 'In Progress',
      progressSource: 'project_manager',
      progressConfirmedAt: '2026-09-30T08:00:00.000Z',
      progressConfirmedBy: 'David',
      updatedAt: '2026-09-30T08:00:00.000Z',
    }, false, ['percentComplete', 'status', 'progressSource', 'progressConfirmedAt', 'progressConfirmedBy', 'updatedAt']);
    // Then he sets 60% on the web, with his manager rank.
    const web60: ScheduleItem = {
      ...shown,
      percentComplete: 60,
      status: 'In Progress',
      progressSource: 'project_manager',
      progressConfirmedAt: '2026-09-30T09:00:00.000Z',
      progressConfirmedBy: 'David',
      updatedAt: '2026-09-30T09:00:00.000Z',
    };
    mockCloudRows.set(phoneTask.id, web60);

    // It wrote 60% back with "Not Started", without progressSource and
    // progressConfirmedBy, and with the 0% copy's stamp.
    await expect(resolveScheduleItemSyncConflict(conflict.id, 'keep_cloud', { cloudCopyShown: shown }))
      .resolves.toEqual(web60);
    expect(mockUpsertScheduleItem).not.toHaveBeenCalled();
    expect(mockCloudRows.get(phoneTask.id)).toEqual(web60);
    await expect(getSyncConflicts()).resolves.toEqual([]);
    await expect(getOfflineQueue()).resolves.toEqual([]);
  });

  it('control: an edit that did land during the choice is still undone', async () => {
    const { conflict, shown } = await conflictWithWebCopy();
    landsDuringFirstRead(await newerPhoneEditOnItsWayUp());

    await expect(resolveScheduleItemSyncConflict(conflict.id, 'keep_cloud', { cloudCopyShown: shown }))
      .resolves.toEqual(shown);
    expect(mockCloudRows.get(phoneTask.id)).toEqual(shown);
    await expect(getSyncConflicts()).resolves.toEqual([]);
  });
});

describe('L-2: a Keep Cloud on a task that cannot finish leaves no discarded edit for an automatic pass to send (audit A7 pass 16)', () => {
  it('the second read fails after a landing: the next automatic pass sends nothing, the conflict stays, and Keep Cloud chosen again puts the screen\'s copy back', async () => {
    const { conflict, shown } = await conflictWithWebCopy();
    const { land, inFlight } = await newerPhoneEditOnItsWayUp();
    const [waiting] = await getOfflineQueue();
    // The phone's upload lands between Keep Cloud's two reads; then the signal drops.
    mockGetScheduleItem
      .mockImplementationOnce(async (id: string) => {
        const answer = await mockCloud.get(id);
        land();
        await inFlight;
        return answer;
      })
      .mockImplementationOnce(async () => mockUnreadable());

    // Settings: "Conflict not resolved. Neither copy was changed."
    await expect(resolveScheduleItemSyncConflict(conflict.id, 'keep_cloud', { cloudCopyShown: shown }))
      .rejects.toThrow('sync_conflict_cloud_copy_unreadable');
    expect(mockUpsertScheduleItem).toHaveBeenCalledTimes(1); // the phone's own upload; Keep Cloud wrote nothing
    // The edits David discarded wait on the conflict, not on the queue.
    await expect(getOfflineQueue()).resolves.toEqual([]);
    await expect(getSyncConflicts()).resolves.toEqual([{
      ...conflict, localPayload: { ...(conflict.localPayload as object), withdrawnEdits: [waiting] },
    }]);

    // The signal returns: an automatic pass runs. It re-sent the discarded
    // edit, which closed the conflict; Keep Cloud then said
    // sync_conflict_not_found.
    await uploadPendingChanges();
    expect(mockUpsertScheduleItem).toHaveBeenCalledTimes(1);
    await expect(getSyncConflicts()).resolves.toEqual([expect.objectContaining({ id: conflict.id })]);

    await expect(resolveScheduleItemSyncConflict(conflict.id, 'keep_cloud', { cloudCopyShown: shown }))
      .resolves.toEqual(shown);
    expect(mockCloudRows.get(phoneTask.id)).toEqual(shown);
    await expect(getSyncConflicts()).resolves.toEqual([]);
    await expect(getOfflineQueue()).resolves.toEqual([]);
  });

  it('Keep Cloud\'s restore lands but its answer is lost: it does not say "Neither copy was changed", and the discarded edit is never sent over the restore', async () => {
    const { conflict, shown } = await conflictWithWebCopy();
    landsDuringFirstRead(await newerPhoneEditOnItsWayUp());
    // The restore reaches the cloud; its answer is lost on weak signal.
    mockUpsertScheduleItem.mockImplementationOnce(async (item: ScheduleItem) => {
      await mockCloud.upsert(item);
      return mockUnreadable();
    });

    const error = await resolveScheduleItemSyncConflict(conflict.id, 'keep_cloud', { cloudCopyShown: shown })
      .catch((caught: unknown) => caught);
    // It was a plain failure, which Settings reads as "Neither copy was
    // changed", though the cloud now held the restore.
    expect(syncConflictChoiceStopReason(error)).toBe('save_unconfirmed');
    expect(mockCloudRows.get(phoneTask.id)).toEqual(shown);
    await expect(getOfflineQueue()).resolves.toEqual([]);

    // The automatic pass re-sent the put-back edit over the restore.
    await uploadPendingChanges();
    expect(mockCloudRows.get(phoneTask.id)).toEqual(shown);
    await expect(getSyncConflicts()).resolves.toEqual([expect.objectContaining({ id: conflict.id })]);

    // Chosen again: the cloud already holds the screen's copy, so nothing is written.
    mockUpsertScheduleItem.mockClear();
    await expect(resolveScheduleItemSyncConflict(conflict.id, 'keep_cloud', { cloudCopyShown: shown }))
      .resolves.toEqual(shown);
    expect(mockUpsertScheduleItem).not.toHaveBeenCalled();
    await expect(getSyncConflicts()).resolves.toEqual([]);
    await expect(getOfflineQueue()).resolves.toEqual([]);
  });
});
