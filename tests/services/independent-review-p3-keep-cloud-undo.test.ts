/**
 * Independent review pass 3 (P3-2): Keep Cloud's undo is written only over the
 * row it was worked out on.
 *
 * When David chooses Keep Cloud and an edit of this phone's had already
 * reached the cloud (an upload under way when he chose), Keep Cloud reads the
 * row and writes it back with that edit undone. That write was the one task
 * write still made without a condition: an edit another device made in the
 * instant between the read and the write was replaced, with no card, and a
 * task deleted in that instant was written back.
 *
 * It is now made only if the row is still the one that was read (the row's
 * version, as every other task write). Refused, nothing is written: the row is
 * read again and the undo worked out on it, twice at most; a row that keeps
 * changing leaves the choice to be made again, and says so.
 *
 * Runs the real SyncService queue, upload and conflict store, as
 * audit-r2-a7p16-task-conflict.test.ts does; the cloud here keeps a version
 * for each row and makes a conditional write in one step, as the real one
 * does. Synthetic data only.
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

/** The cloud's task rows, by id, each with the version its last write gave it. */
const mockCloudRows = new Map<string, { item: ScheduleItem; version: string }>();
const mockClock = { writes: 0 };
const mockCopy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const mockOk = <T>(data: T) => ({ ok: true, configured: true, stubbed: false, data });
const mockUnreadable = () => ({ ok: false, configured: true, stubbed: false, data: null, error: 'Network request failed' });
/** Any write of a row, by any device, gives it a new version. */
const mockPut = (item: ScheduleItem) => {
  mockClock.writes += 1;
  mockCloudRows.set(item.id, { item: mockCopy(item), version: `2026-10-01T08:00:00.${String(mockClock.writes).padStart(6, '0')}+00:00` });
};
/** A row as the app reads it: the task, with the row's version beside it and never in it. */
const mockRead = (id: string): ScheduleItem | null => {
  const row = mockCloudRows.get(id);
  return row ? jest.requireActual('../../services/CloudRowVersion').withCloudRowVersion(mockCopy(row.item), row.version) : null;
};
const mockCloud = {
  list: async (): Promise<unknown> => mockOk([...mockCloudRows.keys()].map(id => mockRead(id))),
  get: async (id: string): Promise<unknown> => mockOk(mockRead(id)),
  /** A write made only under its condition, in one step. */
  upsert: async (item: ScheduleItem, options?: { onlyIfAbsent?: boolean; ifUnchangedSince?: string | null }): Promise<unknown> => {
    const current = mockCloudRows.get(item.id);
    if ((options?.onlyIfAbsent && current) || (options?.ifUnchangedSince && current?.version !== options.ifUnchangedSince)) {
      return {
        ok: false, configured: true, stubbed: false, data: null, status: 409,
        code: options.onlyIfAbsent ? 'schedule_item_already_in_cloud' : 'cloud_row_changed_since_read',
        error: 'This task changed in the cloud while the sync was running. This copy was not sent over it.',
      };
    }
    mockPut(item);
    return mockOk(mockRead(item.id));
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
  listReferenceDocuments: async () => mockOk([]),
  upsertDAVESyncTombstone: async () => mockOk(null),
  upsertDAVESyncTombstones: async (tombstones: unknown[]) => mockOk(tombstones),
  listScheduleItems: () => mockListScheduleItems(),
  getScheduleItem: (id: string) => mockGetScheduleItem(id),
  getScheduleItemsByIds: async (ids: string[]) => mockOk(ids.flatMap(id => (mockCloudRows.has(id) ? [mockRead(id)] : []))),
  upsertScheduleItem: (item: ScheduleItem, options?: { onlyIfAbsent?: boolean; ifUnchangedSince?: string | null }) => mockUpsertScheduleItem(item, options),
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
import { scheduleItemConflictFields } from '../../services/ScheduleItemEditBase';

const phoneTask: ScheduleItem = {
  id: 'task-p3-keep-cloud',
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
const MIKE = 'Mike (set on the iPad)';
const cloudTask = () => mockCloudRows.get(phoneTask.id)?.item;
/** A task copy without its stamp: what it says. */
const says = (item: ScheduleItem | undefined) => (item ? { ...item, updatedAt: null } : item);

/** The phone's offline edit meets the web's newer copy: the conflict is saved with the cloud copy as it was then. */
async function conflictWithWebCopy() {
  mockPut({ ...phoneTask, notes: '', revisedFromTaskIds: ['row-x', 'row-a'], updatedAt: '2026-09-29T12:00:00.000Z' });
  await runScheduleItemCloudSync(phoneTask);
  const [conflict] = await getSyncConflicts();
  expect(conflict).toMatchObject({ entity: 'schedule_item', localId: phoneTask.id });
  expect(await getOfflineQueue()).toEqual([]);
  mockUpsertScheduleItem.mockClear();
  return { conflict, shown: conflict.remotePayload as ScheduleItem };
}

/**
 * David taps Keep Cloud while a newer note of this phone's is on its way up; it lands during Keep Cloud's first read
 * of the row. So the cloud holds an edit he has just discarded, and Keep Cloud has it to undo.
 */
async function keepCloudWithAnEditOfThisPhonesLanded() {
  const { conflict, shown } = await conflictWithWebCopy();
  await queueScheduleItemRecord(
    { ...phoneTask, notes: NEWER, updatedAt: '2026-09-30T10:00:00.000Z' }, false, ['notes', 'updatedAt'],
  );
  let land!: () => void;
  const landing = new Promise<void>(resolve => { land = resolve; });
  let sending!: () => void;
  const sent = new Promise<void>(resolve => { sending = resolve; });
  mockUpsertScheduleItem.mockImplementationOnce(async (item, options) => {
    sending();
    await landing;
    return mockCloud.upsert(item, options);
  });
  const inFlight = uploadPendingChanges();
  await sent;
  mockGetScheduleItem.mockImplementationOnce(async (id: string) => {
    land();
    await inFlight;
    return mockCloud.get(id);
  });
  const [waiting] = await getOfflineQueue();
  return { conflict, shown, waiting, choose: () => resolveScheduleItemSyncConflict(conflict.id, 'keep_cloud', { cloudCopyShown: shown }) };
}

/** Another device writes the task just before each of Keep Cloud's next `times` writes is answered. */
function anotherDeviceWritesBeforeKeepCloudWrites(times: number, write: (nth: number) => void) {
  let done = 0;
  mockUpsertScheduleItem.mockImplementation(async (item, options) => {
    if (done < times) write(done += 1);
    return mockCloud.upsert(item, options);
  });
}
const ipadSets = (patch: Partial<ScheduleItem>) => mockPut({ ...cloudTask()!, ...patch });
/** Keep Cloud's own writes: every task write after the phone's upload that was already under way. */
const keepCloudWrites = () => mockUpsertScheduleItem.mock.calls.slice(1);

beforeEach(() => {
  mockStorage.clear();
  mockCloudRows.clear();
  mockClock.writes = 0;
  mockListScheduleItems.mockReset().mockImplementation(mockCloud.list);
  mockGetScheduleItem.mockReset().mockImplementation(mockCloud.get);
  mockUpsertScheduleItem.mockReset().mockImplementation(mockCloud.upsert);
  mockPut({ ...phoneTask, id: 'task-other-1', taskName: 'Other task 1', notes: '', revisedFromTaskIds: null });
});

describe('independent review pass 3 (P3-2): Keep Cloud\'s undo is written only over the row it was worked out on', () => {
  it('with nothing else happening it is as it was: two reads, one write, the screen\'s copy back; the write names the row it read', async () => {
    const { shown, choose } = await keepCloudWithAnEditOfThisPhonesLanded();

    await expect(choose()).resolves.toEqual(shown);

    expect(cloudTask()).toEqual(shown);
    expect(mockGetScheduleItem).toHaveBeenCalledTimes(2);
    expect(keepCloudWrites()).toHaveLength(1);
    // The condition is the version of the row Keep Cloud read last: the row with the phone's edit in it.
    expect(keepCloudWrites()[0][1]).toEqual({ ifUnchangedSince: expect.stringMatching(/^2026-10-01T08:00:00\.\d{6}\+00:00$/) });
    await expect(getSyncConflicts()).resolves.toEqual([]);
    await expect(getOfflineQueue()).resolves.toEqual([]);
  });

  it('the iPad sets the owner in the instant between Keep Cloud\'s read and its write: the owner stays, the discarded note is undone', async () => {
    const { shown, choose } = await keepCloudWithAnEditOfThisPhonesLanded();
    anotherDeviceWritesBeforeKeepCloudWrites(1, () => ipadSets({ owner: MIKE, updatedAt: '2026-09-30T11:00:00.000Z' }));

    const kept = await choose();

    // It was written back as the row Keep Cloud had read, with the note undone: the iPad's owner was gone, with no card.
    expect(says(cloudTask())).toEqual(says({ ...shown, owner: MIKE }));
    expect(says(kept)).toEqual(says({ ...shown, owner: MIKE }));
    // The first write was refused and wrote nothing; the row was read once more; the second write went over that row.
    expect(keepCloudWrites()).toHaveLength(2);
    expect(mockGetScheduleItem).toHaveBeenCalledTimes(3);
    expect(keepCloudWrites()[0][1]).not.toEqual(keepCloudWrites()[1][1]);
    await expect(getSyncConflicts()).resolves.toEqual([]);
    await expect(getOfflineQueue()).resolves.toEqual([]);
  });

  it('the iPad types its own note in that instant: there is nothing of this phone\'s left to undo, and the iPad\'s note is not touched', async () => {
    const { shown, choose } = await keepCloudWithAnEditOfThisPhonesLanded();
    anotherDeviceWritesBeforeKeepCloudWrites(1, () => ipadSets({ notes: 'Rebar inspected (typed on the iPad).', updatedAt: '2026-09-30T11:00:00.000Z' }));

    const kept = await choose();

    const ipads = { ...shown, notes: 'Rebar inspected (typed on the iPad).', updatedAt: '2026-09-30T11:00:00.000Z' };
    expect(cloudTask()).toEqual(ipads);
    expect(kept).toEqual(ipads);
    // One write, refused; then the row as it is holds no edit of this phone's, and nothing more is written.
    expect(keepCloudWrites()).toHaveLength(1);
    await expect(getSyncConflicts()).resolves.toEqual([]);
  });

  it('the task is deleted on another device in that instant: it is not written back, and the conflict is closed', async () => {
    const { choose } = await keepCloudWithAnEditOfThisPhonesLanded();
    anotherDeviceWritesBeforeKeepCloudWrites(1, () => { mockCloudRows.delete(phoneTask.id); });

    const error = await choose().catch((caught: unknown) => caught);

    // The write went as a plain save: the deleted task was back in the cloud.
    expect(syncConflictChoiceStopReason(error)).toBe('record_deleted');
    expect(mockCloudRows.has(phoneTask.id)).toBe(false);
    await expect(getSyncConflicts()).resolves.toEqual([]);
    await expect(getOfflineQueue()).resolves.toEqual([]);
  });

  it('a task another device keeps writing: after two more tries nothing is written, he is told the cloud copy changed, and the choice made again goes through', async () => {
    const { conflict, shown, waiting, choose } = await keepCloudWithAnEditOfThisPhonesLanded();
    anotherDeviceWritesBeforeKeepCloudWrites(3, nth => ipadSets({ owner: `Mike ${nth}`, updatedAt: `2026-09-30T11:0${nth}:00.000Z` }));

    const error = await choose().catch((caught: unknown) => caught);

    // Settings: "The cloud copy changed — review again. Nothing was sent."
    expect(syncConflictChoiceStopReason(error)).toBe('cloud_copy_changed');
    expect(keepCloudWrites()).toHaveLength(3);
    expect(mockGetScheduleItem).toHaveBeenCalledTimes(4);
    // Nothing of Keep Cloud's was written: the row is as the iPad left it, the phone's note still in it.
    expect(cloudTask()).toMatchObject({ owner: 'Mike 3', notes: NEWER });
    // The conflict is as it was, with the edit he discarded waiting on it and not on the queue.
    await expect(getOfflineQueue()).resolves.toEqual([]);
    await expect(getSyncConflicts()).resolves.toEqual([{
      ...conflict, localPayload: { ...(conflict.localPayload as object), withdrawnEdits: [waiting] },
    }]);
    // An automatic pass sends nothing meanwhile.
    await uploadPendingChanges();
    expect(keepCloudWrites()).toHaveLength(3);

    // The iPad stops. Chosen again, the note is undone and the iPad's owner stays.
    await expect(resolveScheduleItemSyncConflict(conflict.id, 'keep_cloud', { cloudCopyShown: shown })).resolves.toMatchObject({ owner: 'Mike 3', notes: '' });
    expect(says(cloudTask())).toEqual(says({ ...shown, owner: 'Mike 3' }));
    await expect(getSyncConflicts()).resolves.toEqual([]);
    await expect(getOfflineQueue()).resolves.toEqual([]);
  });

  it('the row cannot be read again after a refused write: nothing was written, and the conflict is as it was', async () => {
    const { conflict, waiting, choose } = await keepCloudWithAnEditOfThisPhonesLanded();
    anotherDeviceWritesBeforeKeepCloudWrites(1, () => {
      ipadSets({ owner: MIKE });
      // Keep Cloud's two reads are done; the next read of the row is the one after the refusal, and it fails.
      mockGetScheduleItem.mockImplementationOnce(async () => mockUnreadable());
    });

    // Settings: "Conflict not resolved. Neither copy was changed."
    await expect(choose()).rejects.toThrow('sync_conflict_cloud_copy_unreadable');

    expect(cloudTask()).toMatchObject({ owner: MIKE, notes: NEWER });
    expect(keepCloudWrites()).toHaveLength(1);
    await expect(getSyncConflicts()).resolves.toEqual([{
      ...conflict, localPayload: { ...(conflict.localPayload as object), withdrawnEdits: [waiting] },
    }]);
  });
});

/* Keep Phone ----------------------------------------------------------------------------------------------------- */

/**
 * Keep Phone checks the cloud's row before it sends the phone's copy: when the row is not the copy the screen showed,
 * nothing is sent and David reviews again. The kept copy then goes up through the queue, written only over the row as
 * it was listed (pass 2). But refused, it was read again and sent all the same, since a kept copy is not weighed: it
 * went whole over what another device had written in the moment after Keep Phone's check. Found while looking for
 * P3-2's like (by a run: the iPad's newest note and its owner were gone, with no card).
 */
describe('independent review pass 3: Keep Phone\'s copy is not sent over a row that changed after Keep Phone checked it', () => {
  const keepPhone = (conflictId: string, shown: unknown) => resolveScheduleItemSyncConflict(conflictId, 'keep_local', { cloudCopyShown: shown });

  it('with nothing else happening it is as it was: one read, one write that names the row, the phone\'s copy in the cloud', async () => {
    const { conflict, shown } = await conflictWithWebCopy();

    await expect(keepPhone(conflict.id, shown)).resolves.toMatchObject({ notes: 'Phone note.' });

    expect(cloudTask()).toMatchObject({ notes: 'Phone note.', revisedFromTaskIds: ['row-x', 'row-a'] });
    expect(mockGetScheduleItem).toHaveBeenCalledTimes(1);
    expect(mockUpsertScheduleItem.mock.calls.map(call => call[1])).toEqual([{ ifUnchangedSince: expect.any(String) }]);
    await expect(getSyncConflicts()).resolves.toEqual([]);
    await expect(getOfflineQueue()).resolves.toEqual([]);
  });

  it('the iPad writes the task in the moment after Keep Phone\'s check: nothing is sent, and David reviews again with the iPad\'s copy', async () => {
    const { conflict, shown } = await conflictWithWebCopy();
    anotherDeviceWritesBeforeKeepCloudWrites(1, () => ipadSets({ notes: 'Rebar inspected (typed on the iPad).', owner: MIKE, updatedAt: '2026-09-30T11:00:00.000Z' }));

    const error = await keepPhone(conflict.id, shown).catch((caught: unknown) => caught);

    // Settings: "The cloud copy changed — review again. Nothing was sent."
    expect(syncConflictChoiceStopReason(error)).toBe('cloud_copy_changed');
    const ipads = { ...shown, notes: 'Rebar inspected (typed on the iPad).', owner: MIKE, updatedAt: '2026-09-30T11:00:00.000Z' };
    // The phone's copy went over it: "Phone note." and no owner, with no card, and the conflict closed.
    expect(cloudTask()).toEqual(ipads);
    // One write, refused; it was not made again.
    expect(mockUpsertScheduleItem).toHaveBeenCalledTimes(1);
    // The conflict is still open and now shows the cloud's copy as it is; nothing of the choice waits on the queue.
    await expect(getSyncConflicts()).resolves.toEqual([{ ...conflict, remotePayload: ipads, remoteChangedAt: ipads.updatedAt }]);
    await expect(getOfflineQueue()).resolves.toEqual([]);
    // An automatic pass sends nothing meanwhile.
    await uploadPendingChanges();
    expect(mockUpsertScheduleItem).toHaveBeenCalledTimes(1);

    // He reviews it and chooses Keep Phone again, now against the iPad's copy: his copy goes up.
    await expect(keepPhone(conflict.id, ipads)).resolves.toMatchObject({ notes: 'Phone note.' });
    expect(cloudTask()).toMatchObject({ notes: 'Phone note.' });
    await expect(getSyncConflicts()).resolves.toEqual([]);
  });

  it('the task is deleted on another device in that moment: it is not written back, and the conflict is closed', async () => {
    const { conflict, shown } = await conflictWithWebCopy();
    anotherDeviceWritesBeforeKeepCloudWrites(1, () => { mockCloudRows.delete(phoneTask.id); });

    const error = await keepPhone(conflict.id, shown).catch((caught: unknown) => caught);

    expect(syncConflictChoiceStopReason(error)).toBe('record_deleted');
    expect(mockCloudRows.has(phoneTask.id)).toBe(false);
    await expect(getSyncConflicts()).resolves.toEqual([]);
    await expect(getOfflineQueue()).resolves.toEqual([]);
  });

  it('the row is written again in that moment but still says what the screen showed (a stamp only): the choice is made on it again, and goes through', async () => {
    const { conflict, shown } = await conflictWithWebCopy();
    anotherDeviceWritesBeforeKeepCloudWrites(1, () => ipadSets({ updatedAt: '2026-09-30T11:00:00.000Z' }));

    await expect(keepPhone(conflict.id, shown)).resolves.toMatchObject({ notes: 'Phone note.' });

    expect(cloudTask()).toMatchObject({ notes: 'Phone note.' });
    // One write refused, one that landed; nothing to review, since nothing he was shown had changed.
    expect(mockUpsertScheduleItem).toHaveBeenCalledTimes(2);
    await expect(getSyncConflicts()).resolves.toEqual([]);
    await expect(getOfflineQueue()).resolves.toEqual([]);
  });

  it('a row rewritten like that before every write: two more tries, then it is reported as a choice that did not go through, and nothing was sent', async () => {
    const { conflict, shown } = await conflictWithWebCopy();
    anotherDeviceWritesBeforeKeepCloudWrites(9, nth => ipadSets({ updatedAt: `2026-09-30T11:0${nth}:00.000Z` }));

    const error = await keepPhone(conflict.id, shown).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(syncConflictChoiceStopReason(error)).toBeNull();
    expect(mockUpsertScheduleItem).toHaveBeenCalledTimes(3);
    expect(cloudTask()).toMatchObject({ notes: '' });
    await expect(getSyncConflicts()).resolves.toEqual([conflict]);
    await expect(getOfflineQueue()).resolves.toEqual([]);
  });

  it('rewritten twice with nothing changed, then changed before the third write: he is told the cloud copy changed, and shown it', async () => {
    const { conflict, shown } = await conflictWithWebCopy();
    anotherDeviceWritesBeforeKeepCloudWrites(3, nth => ipadSets(nth < 3 ? { updatedAt: `2026-09-30T11:0${nth}:00.000Z` } : { owner: MIKE, updatedAt: '2026-09-30T11:03:00.000Z' }));

    const error = await keepPhone(conflict.id, shown).catch((caught: unknown) => caught);

    expect(syncConflictChoiceStopReason(error)).toBe('cloud_copy_changed');
    expect(mockUpsertScheduleItem).toHaveBeenCalledTimes(3);
    expect(cloudTask()).toMatchObject({ owner: MIKE, notes: '' });
    await expect(getSyncConflicts()).resolves.toEqual([expect.objectContaining({ id: conflict.id, remotePayload: expect.objectContaining({ owner: MIKE }) })]);
    await expect(getOfflineQueue()).resolves.toEqual([]);
  });

  it('a kept copy that landed with its answer lost is not called a changed cloud copy: reported as before, with no further read', async () => {
    const { conflict, shown } = await conflictWithWebCopy();
    mockUpsertScheduleItem.mockImplementationOnce(async (item, options) => {
      await mockCloud.upsert(item, options);
      return mockUnreadable();
    });

    const error = await keepPhone(conflict.id, shown).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(syncConflictChoiceStopReason(error)).toBeNull();
    expect(cloudTask()).toMatchObject({ notes: 'Phone note.' });
    // Only a write the cloud refused sends Keep Phone back to the row.
    expect(mockGetScheduleItem).toHaveBeenCalledTimes(1);
    await expect(getSyncConflicts()).resolves.toEqual([expect.objectContaining({ id: conflict.id, remotePayload: conflict.remotePayload })]);
  });

  it('the row cannot be read after the refused write: nothing was sent, reported as a choice that did not go through, the conflict as it was', async () => {
    const { conflict, shown } = await conflictWithWebCopy();
    anotherDeviceWritesBeforeKeepCloudWrites(1, () => ipadSets({ owner: MIKE, updatedAt: '2026-09-30T11:00:00.000Z' }));
    mockGetScheduleItem
      .mockImplementationOnce(mockCloud.get)                 // Keep Phone's check
      .mockImplementationOnce(async () => mockUnreadable()); // the read after the refusal

    const error = await keepPhone(conflict.id, shown).catch((caught: unknown) => caught);

    // Settings: "Conflict not resolved. Neither copy was changed."
    expect(error).toBeInstanceOf(Error);
    expect(syncConflictChoiceStopReason(error)).toBeNull();
    expect(cloudTask()).toMatchObject({ owner: MIKE, notes: '' });
    expect(mockUpsertScheduleItem).toHaveBeenCalledTimes(1);
    await expect(getSyncConflicts()).resolves.toEqual([conflict]);
    await expect(getOfflineQueue()).resolves.toEqual([]);
  });

  it('a card about one field (the note changed on both): the iPad sets the owner in that moment; nothing is sent, and chosen again his note goes up beside the owner', async () => {
    // The web typed a note; the phone, which had not heard, typed its own: Review Conflicts asks about the note.
    const start: ScheduleItem = { ...phoneTask, notes: '' };
    mockPut({ ...start, notes: 'Web note.', updatedAt: '2026-09-29T12:00:00.000Z' });
    await queueScheduleItemRecord({ ...start, notes: 'Phone note.', updatedAt: '2026-09-30T10:00:00.000Z' }, false, ['notes', 'updatedAt'], start);
    await uploadPendingChanges();
    const [conflict] = await getSyncConflicts();
    expect(scheduleItemConflictFields(conflict.localPayload)).toEqual(['notes']);
    expect(cloudTask()).toMatchObject({ notes: 'Web note.' });
    mockUpsertScheduleItem.mockClear();
    anotherDeviceWritesBeforeKeepCloudWrites(1, () => ipadSets({ owner: MIKE, updatedAt: '2026-09-30T11:00:00.000Z' }));

    const error = await keepPhone(conflict.id, conflict.remotePayload).catch((caught: unknown) => caught);

    expect(syncConflictChoiceStopReason(error)).toBe('cloud_copy_changed');
    expect(cloudTask()).toMatchObject({ notes: 'Web note.', owner: MIKE });
    expect(mockUpsertScheduleItem).toHaveBeenCalledTimes(1);
    const [again] = await getSyncConflicts();
    expect(again).toMatchObject({ id: conflict.id, remotePayload: { notes: 'Web note.', owner: MIKE } });
    await expect(getOfflineQueue()).resolves.toEqual([]);

    await expect(keepPhone(again.id, again.remotePayload)).resolves.toMatchObject({ notes: 'Phone note.' });
    // Only the field he was asked about goes up: the iPad's owner stays in the cloud's row.
    expect(cloudTask()).toMatchObject({ notes: 'Phone note.', owner: MIKE });
    await expect(getSyncConflicts()).resolves.toEqual([]);
  });
});
