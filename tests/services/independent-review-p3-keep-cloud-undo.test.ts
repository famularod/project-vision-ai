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

/* Independent review pass 4 ------------------------------------------------------------------------------------- */

const keepPhoneOn = (conflictId: string, shown: unknown) => resolveScheduleItemSyncConflict(conflictId, 'keep_local', { cloudCopyShown: shown });

/** A card about one field: the web typed a note; the phone, which had not heard, typed its own. */
async function cardAboutTheNote() {
  const start: ScheduleItem = { ...phoneTask, notes: '' };
  mockPut({ ...start, notes: 'Web note.', updatedAt: '2026-09-29T12:00:00.000Z' });
  await queueScheduleItemRecord({ ...start, notes: 'Phone note.', updatedAt: '2026-09-30T10:00:00.000Z' }, false, ['notes', 'updatedAt'], start);
  await uploadPendingChanges();
  const [conflict] = await getSyncConflicts();
  expect(scheduleItemConflictFields(conflict.localPayload)).toEqual(['notes']);
  expect(cloudTask()).toMatchObject({ notes: 'Web note.' });
  mockUpsertScheduleItem.mockClear();
  mockGetScheduleItem.mockClear();
  return { start, conflict, shown: conflict.remotePayload as ScheduleItem };
}

/**
 * The record of what a task's new row took from the task (textFromTask) is bookkeeping: never an edit of his, never
 * on a card. A write that changed it alone between the screen's read and his tap made Keep Phone answer "The cloud
 * copy changed — review again" with nothing different to see (the pass-4 reviewer, by a forced run).
 */
describe('independent review pass 4: the record of what a row took from its task is not a change of the cloud copy', () => {
  const TOOK = { taskId: 'row-a', owner: '' };
  const TOOK_SINCE = { taskId: 'row-a', owner: '', contractor: 'noted since' };

  it('a whole-task card: the record alone changes between the screen\'s read and his tap; Keep Phone goes through the first time', async () => {
    mockPut({ ...phoneTask, notes: '', revisedFromTaskIds: ['row-x', 'row-a'], textFromTask: TOOK, updatedAt: '2026-09-29T12:00:00.000Z' });
    await runScheduleItemCloudSync(phoneTask);
    const [conflict] = await getSyncConflicts();
    const shown = conflict.remotePayload as ScheduleItem;
    expect(shown.textFromTask).toEqual(TOOK);
    ipadSets({ textFromTask: TOOK_SINCE });

    await expect(keepPhoneOn(conflict.id, shown)).resolves.toMatchObject({ notes: 'Phone note.' });

    expect(cloudTask()).toMatchObject({ notes: 'Phone note.' });
    await expect(getSyncConflicts()).resolves.toEqual([]);
  });

  it('a card about one field: the same; his note goes up and the row keeps the record as the cloud has it', async () => {
    const { conflict, shown } = await cardAboutTheNote();
    ipadSets({ textFromTask: TOOK_SINCE });

    await expect(keepPhoneOn(conflict.id, shown)).resolves.toMatchObject({ notes: 'Phone note.' });

    expect(cloudTask()).toMatchObject({ notes: 'Phone note.', textFromTask: TOOK_SINCE });
    await expect(getSyncConflicts()).resolves.toEqual([]);
  });

  it('a change of the record together with the text it describes is still a change: he reviews again', async () => {
    const { conflict, shown } = await cardAboutTheNote();
    ipadSets({ owner: MIKE, textFromTask: { taskId: 'row-a', owner: MIKE } });

    const error = await keepPhoneOn(conflict.id, shown).catch((caught: unknown) => caught);

    expect(syncConflictChoiceStopReason(error)).toBe('cloud_copy_changed');
    expect(cloudTask()).toMatchObject({ notes: 'Web note.', owner: MIKE });
  });

  it('Keep Cloud\'s undo still takes the record back with a whole copy of this phone\'s that landed: it describes the text being put back', async () => {
    const { conflict, shown } = await conflictWithWebCopy();
    // A whole copy of the task from this phone is on its way up when he chooses: its own owner, and its record of it.
    const whole: ScheduleItem = { ...phoneTask, owner: 'Ana', textFromTask: { taskId: 'row-a', owner: 'Ana' }, updatedAt: '2026-09-30T10:00:00.000Z' };
    await queueScheduleItemRecord(whole, false);
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

    await expect(resolveScheduleItemSyncConflict(conflict.id, 'keep_cloud', { cloudCopyShown: shown })).resolves.toMatchObject({ owner: '', notes: '' });

    // The copy landed (the cloud held "Ana" and the record of it) and is undone: the owner and note the screen showed.
    expect(mockUpsertScheduleItem).toHaveBeenCalledTimes(2);
    expect(cloudTask()).toMatchObject({ owner: shown.owner, notes: shown.notes, updatedAt: shown.updatedAt });
    // Left behind, the row would say it took "Ana" while holding no owner again.
    expect(cloudTask()).not.toHaveProperty('textFromTask');
  });
});

/**
 * Keep Phone reads the row by its id and checks it against the copy the screen showed; then its copy goes up through
 * the queue, whose upload reads the task LIST before it writes "only over the row as listed". A write by another
 * device between those two reads was the row as listed, so the kept copy went over it, with no card (the pass-4
 * reviewer, finding 1; pass 3 had closed only the moment after the list read).
 */
describe('independent review pass 4 (1): Keep Phone\'s copy is written only over the row version Keep Phone itself checked', () => {
  /** Another device writes the task after Keep Phone has read the row, just before the upload's read of the list is answered. */
  function anotherDeviceWritesBetweenKeepPhonesReadAndTheListRead(write: () => void) {
    const moment = { checked: false, done: false, version: null as string | null };
    mockGetScheduleItem.mockImplementation(async (id: string) => {
      const answer = await mockCloud.get(id);
      if (!moment.checked) moment.version = mockCloudRows.get(id)?.version ?? null;
      moment.checked = true;
      return answer;
    });
    mockListScheduleItems.mockImplementation(async () => {
      if (moment.checked && !moment.done) { moment.done = true; write(); }
      return mockCloud.list();
    });
    return moment;
  }

  it('a card about the note: the iPad retypes the note between the two reads; nothing is sent, and he reviews again with the corrected note', async () => {
    const { conflict, shown } = await cardAboutTheNote();
    const moment = anotherDeviceWritesBetweenKeepPhonesReadAndTheListRead(() => ipadSets({ notes: 'Web note, corrected.', owner: MIKE, updatedAt: '2026-09-30T11:00:00.000Z' }));

    const error = await keepPhoneOn(conflict.id, shown).catch((caught: unknown) => caught);

    expect(moment.done).toBe(true);
    // Settings: "The cloud copy changed — review again. Nothing was sent."
    expect(syncConflictChoiceStopReason(error)).toBe('cloud_copy_changed');
    // It was written over the row as listed: "Phone note." was in the cloud, the card closed, and he had never seen the correction.
    expect(cloudTask()).toMatchObject({ notes: 'Web note, corrected.', owner: MIKE });
    // The one write named the row Keep Phone had read, and the cloud refused it.
    expect(mockUpsertScheduleItem.mock.calls.map(call => call[1])).toEqual([{ ifUnchangedSince: moment.version }]);
    await expect(getSyncConflicts()).resolves.toEqual([expect.objectContaining({ id: conflict.id, remotePayload: expect.objectContaining({ notes: 'Web note, corrected.', owner: MIKE }) })]);
    await expect(getOfflineQueue()).resolves.toEqual([]);

    // He reviews it and chooses Keep Phone again: his note goes up, beside the iPad's owner.
    const [again] = await getSyncConflicts();
    await expect(keepPhoneOn(again.id, again.remotePayload)).resolves.toMatchObject({ notes: 'Phone note.' });
    expect(cloudTask()).toMatchObject({ notes: 'Phone note.', owner: MIKE });
    await expect(getSyncConflicts()).resolves.toEqual([]);
  });

  it('a whole-task card: the same moment; the iPad\'s note and owner are not replaced by the phone\'s whole copy', async () => {
    const { conflict, shown } = await conflictWithWebCopy();
    anotherDeviceWritesBetweenKeepPhonesReadAndTheListRead(() => ipadSets({ notes: 'Rebar inspected (typed on the iPad).', owner: MIKE, updatedAt: '2026-09-30T11:00:00.000Z' }));

    const error = await keepPhoneOn(conflict.id, shown).catch((caught: unknown) => caught);

    expect(syncConflictChoiceStopReason(error)).toBe('cloud_copy_changed');
    expect(cloudTask()).toMatchObject({ notes: 'Rebar inspected (typed on the iPad).', owner: MIKE });
    await expect(getSyncConflicts()).resolves.toEqual([expect.objectContaining({ id: conflict.id, remotePayload: expect.objectContaining({ owner: MIKE }) })]);
    await expect(getOfflineQueue()).resolves.toEqual([]);
  });

  it('the task is deleted between the two reads (its deletion record not heard yet): it is not sent back as new, and the conflict is closed', async () => {
    const { conflict, shown } = await conflictWithWebCopy();
    anotherDeviceWritesBetweenKeepPhonesReadAndTheListRead(() => { mockCloudRows.delete(phoneTask.id); });

    const error = await keepPhoneOn(conflict.id, shown).catch((caught: unknown) => caught);

    // The list and the read by id found no row, so the kept copy went up as a new task.
    expect(syncConflictChoiceStopReason(error)).toBe('record_deleted');
    expect(mockCloudRows.has(phoneTask.id)).toBe(false);
    await expect(getSyncConflicts()).resolves.toEqual([]);
    await expect(getOfflineQueue()).resolves.toEqual([]);
  });

  it('the row is only written again between the two reads (its stamp alone): the choice is made on it again and goes through', async () => {
    const { conflict, shown } = await cardAboutTheNote();
    anotherDeviceWritesBetweenKeepPhonesReadAndTheListRead(() => ipadSets({ updatedAt: '2026-09-30T11:00:00.000Z' }));

    await expect(keepPhoneOn(conflict.id, shown)).resolves.toMatchObject({ notes: 'Phone note.' });

    expect(cloudTask()).toMatchObject({ notes: 'Phone note.' });
    expect(mockUpsertScheduleItem).toHaveBeenCalledTimes(2); // one refused, one that landed
    await expect(getSyncConflicts()).resolves.toEqual([]);
    await expect(getOfflineQueue()).resolves.toEqual([]);
  });

  it('with nothing in between it is as it was: one write, and it names the version Keep Phone read', async () => {
    const { conflict, shown } = await cardAboutTheNote();
    const read = mockCloudRows.get(phoneTask.id)!.version;

    await expect(keepPhoneOn(conflict.id, shown)).resolves.toMatchObject({ notes: 'Phone note.' });

    expect(mockUpsertScheduleItem.mock.calls.map(call => call[1])).toEqual([{ ifUnchangedSince: read }]);
    expect(mockGetScheduleItem).toHaveBeenCalledTimes(1);
    expect(cloudTask()).toMatchObject({ notes: 'Phone note.' });
    await expect(getSyncConflicts()).resolves.toEqual([]);
  });
});

/* A card of fields, and what waits beside it ------------------------------------------------------------------- */

const WEB_NOTE = 'Inspector Thursday (typed on the web).';
/** A card about the owner: the web set "Bob"; this phone, which had not heard, set "Ana". */
async function cardAboutTheOwner() {
  const start: ScheduleItem = { ...phoneTask, notes: '', owner: '' };
  mockPut({ ...start, owner: 'Bob', updatedAt: '2026-09-29T12:00:00.000Z' });
  const mine: ScheduleItem = { ...start, owner: 'Ana', updatedAt: '2026-09-30T10:00:00.000Z' };
  await queueScheduleItemRecord(mine, false, ['owner', 'updatedAt'], start);
  await uploadPendingChanges();
  const [conflict] = await getSyncConflicts();
  expect(scheduleItemConflictFields(conflict.localPayload)).toEqual(['owner']);
  return { mine, conflict, shown: conflict.remotePayload as ScheduleItem };
}
/** Then he types a note on the task; it waits on the queue (the typing pause, or a moment with no signal). */
async function aNoteOfHisWaits(mine: ScheduleItem) {
  const noted: ScheduleItem = { ...mine, notes: 'Crew short (typed on this phone).', updatedAt: '2026-09-30T12:00:00.000Z' };
  await queueScheduleItemRecord(noted, false, ['notes', 'updatedAt'], mine);
  mockUpsertScheduleItem.mockClear();
  mockGetScheduleItem.mockClear();
  return noted;
}
const cards = async () => (await getSyncConflicts()).map(conflict => scheduleItemConflictFields(conflict.localPayload));
/** As a Keep Cloud that could not finish leaves it: the waiting edit off the queue, on the card. */
async function anUnfinishedKeepCloudLeftItOnTheCard(conflictId: string) {
  const [waiting] = await getOfflineQueue();
  const key = (containing: string) => [...mockStorage.keys()].find(name => JSON.stringify(mockStorage.get(name)).includes(containing))!;
  mockStorage.set(key(waiting.id), '[]');
  const conflictsKey = key(conflictId);
  mockStorage.set(conflictsKey, JSON.stringify((JSON.parse(mockStorage.get(conflictsKey)!) as Array<{ id: string; localPayload: object }>)
    .map(item => (item.id === conflictId ? { ...item, localPayload: { ...item.localPayload, withdrawnEdits: [waiting] } } : item))));
  await expect(getOfflineQueue()).resolves.toEqual([]);
  expect((await getSyncConflicts())[0].localPayload).toMatchObject({ withdrawnEdits: [waiting] });
}

/**
 * Keep Phone on a card about one field also sent, unweighed, this phone's newer edit of ANOTHER field of the task
 * that still waited on the queue: over what another device had typed there since, with no card about it (the pass-4
 * reviewer, finding 2, generator seed 1138; caused by 79a5ae1). When the automatic upload ran before his tap the edit
 * was weighed and the card asked about both. It now always goes through that upload first.
 */
describe('independent review pass 4 (2): Keep Phone decides only what the card asked about', () => {
  it('another device typed a note he has not heard, and his own note still waits: the note is not sent over it, and the card asks about both', async () => {
    const { mine, conflict, shown } = await cardAboutTheOwner();
    ipadSets({ notes: WEB_NOTE, updatedAt: '2026-09-30T11:00:00.000Z' });
    await aNoteOfHisWaits(mine);
    // Review Conflicts shows the card as the cloud has it now: Owner only.
    const seen = { ...shown, notes: WEB_NOTE, updatedAt: '2026-09-30T11:00:00.000Z' };

    const error = await keepPhoneOn(conflict.id, seen).catch((caught: unknown) => caught);

    // It went up with the kept copy: "Ana" and "Crew short", the web's note gone everywhere, and nothing had asked about the note.
    expect(syncConflictChoiceStopReason(error)).toBe('cloud_copy_changed');
    expect(cloudTask()).toMatchObject({ owner: 'Bob', notes: WEB_NOTE });
    // The one write is the waiting edit's own, as on any automatic upload: the row as the cloud has it, with its stamp.
    expect(mockUpsertScheduleItem.mock.calls.map(call => [call[0].owner, call[0].notes])).toEqual([['Bob', WEB_NOTE]]);
    // As when the automatic upload had run before his tap: one card, about the owner and the note.
    expect(await cards()).toEqual([['owner', 'notes']]);
    await expect(getOfflineQueue()).resolves.toEqual([]);

    // He is shown both and chooses Keep Phone: both go up.
    const [both] = await getSyncConflicts();
    await expect(keepPhoneOn(both.id, both.remotePayload)).resolves.toMatchObject({ owner: 'Ana', notes: 'Crew short (typed on this phone).' });
    expect(cloudTask()).toMatchObject({ owner: 'Ana', notes: 'Crew short (typed on this phone).' });
    await expect(getSyncConflicts()).resolves.toEqual([]);
  });

  it('only he changed the note: it goes up as any waiting edit, then the owner is decided, in the one tap and with no "review again"', async () => {
    const { mine, conflict, shown } = await cardAboutTheOwner();
    await aNoteOfHisWaits(mine);

    await expect(keepPhoneOn(conflict.id, shown)).resolves.toMatchObject({ owner: 'Ana', notes: 'Crew short (typed on this phone).' });

    expect(cloudTask()).toMatchObject({ owner: 'Ana', notes: 'Crew short (typed on this phone).' });
    // Two writes: the note, weighed and written over the row as listed; then the kept owner, over the row Keep Phone read.
    expect(mockUpsertScheduleItem).toHaveBeenCalledTimes(2);
    expect(mockUpsertScheduleItem.mock.calls[0][0]).toMatchObject({ owner: 'Bob', notes: 'Crew short (typed on this phone).' });
    await expect(getSyncConflicts()).resolves.toEqual([]);
    await expect(getOfflineQueue()).resolves.toEqual([]);
  });

  it('a newer value of the field the card asks about is still kept with the choice, as before', async () => {
    const { mine, conflict, shown } = await cardAboutTheOwner();
    await queueScheduleItemRecord({ ...mine, owner: 'Ana (crew B)', updatedAt: '2026-09-30T12:00:00.000Z' }, false, ['owner', 'updatedAt'], mine);
    mockUpsertScheduleItem.mockClear();

    await expect(keepPhoneOn(conflict.id, shown)).resolves.toMatchObject({ owner: 'Ana (crew B)' });

    expect(cloudTask()).toMatchObject({ owner: 'Ana (crew B)' });
    expect(mockUpsertScheduleItem).toHaveBeenCalledTimes(1);
    await expect(getSyncConflicts()).resolves.toEqual([]);
  });

  it('the waiting note cannot be sent now: nothing is decided, and the card and the note wait as they were', async () => {
    const { mine, conflict, shown } = await cardAboutTheOwner();
    await aNoteOfHisWaits(mine);
    mockUpsertScheduleItem.mockImplementation(async () => mockUnreadable());

    const error = await keepPhoneOn(conflict.id, shown).catch((caught: unknown) => caught);

    // Settings: "Conflict not resolved. Neither copy was changed."
    expect(error).toBeInstanceOf(Error);
    expect(syncConflictChoiceStopReason(error)).toBeNull();
    expect(cloudTask()).toMatchObject({ owner: 'Bob', notes: '' });
    expect(await cards()).toEqual([['owner']]);
    expect((await getOfflineQueue()).map(item => (item.payload as { changedFields?: string[] }).changedFields)).toEqual([['notes', 'updatedAt']]);
  });

  it('a note of his that an unfinished Keep Cloud left on the card is weighed too, not sent over the other device\'s', async () => {
    const { mine, conflict, shown } = await cardAboutTheOwner();
    ipadSets({ notes: WEB_NOTE, updatedAt: '2026-09-30T11:00:00.000Z' });
    await aNoteOfHisWaits(mine);
    await anUnfinishedKeepCloudLeftItOnTheCard(conflict.id);

    const error = await keepPhoneOn(conflict.id, { ...shown, notes: WEB_NOTE, updatedAt: '2026-09-30T11:00:00.000Z' }).catch((caught: unknown) => caught);

    expect(syncConflictChoiceStopReason(error)).toBe('cloud_copy_changed');
    expect(cloudTask()).toMatchObject({ owner: 'Bob', notes: WEB_NOTE });
    expect(await cards()).toEqual([['owner', 'notes']]);
    expect((await getSyncConflicts())[0].localPayload).not.toHaveProperty('withdrawnEdits');
    await expect(getOfflineQueue()).resolves.toEqual([]);
  });

  it('that note cannot be sent now: it waits on the queue and no longer on the card too, and goes up once when he chooses again', async () => {
    const { mine, conflict, shown } = await cardAboutTheOwner();
    await aNoteOfHisWaits(mine);
    await anUnfinishedKeepCloudLeftItOnTheCard(conflict.id);
    mockUpsertScheduleItem.mockImplementation(async () => mockUnreadable());

    const error = await keepPhoneOn(conflict.id, shown).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(syncConflictChoiceStopReason(error)).toBeNull();
    expect(cloudTask()).toMatchObject({ owner: 'Bob', notes: '' });
    expect(await cards()).toEqual([['owner']]);
    // In one place: left on the card as well, a later choice would put it on the queue and send it a second time,
    // from the copy he saw when he typed it, and it would be weighed against whatever was typed after it had landed.
    expect((await getSyncConflicts())[0].localPayload).not.toHaveProperty('withdrawnEdits');
    expect((await getOfflineQueue()).map(item => (item.payload as { changedFields?: string[] }).changedFields)).toEqual([['notes', 'updatedAt']]);

    mockUpsertScheduleItem.mockImplementation(mockCloud.upsert);
    mockUpsertScheduleItem.mockClear();
    await expect(keepPhoneOn(conflict.id, shown)).resolves.toMatchObject({ owner: 'Ana', notes: 'Crew short (typed on this phone).' });
    expect(cloudTask()).toMatchObject({ owner: 'Ana', notes: 'Crew short (typed on this phone).' });
    expect(mockUpsertScheduleItem).toHaveBeenCalledTimes(2);
    await expect(getSyncConflicts()).resolves.toEqual([]);
    await expect(getOfflineQueue()).resolves.toEqual([]);
  });

  it('the waiting edit also puts the cloud\'s own value in the field the card asks about: the card closes by itself, and he is told so', async () => {
    const { mine, conflict, shown } = await cardAboutTheOwner();
    await queueScheduleItemRecord({ ...mine, owner: 'Bob', notes: 'Crew short (typed on this phone).', updatedAt: '2026-09-30T12:00:00.000Z' }, false, ['owner', 'notes', 'updatedAt'], mine);

    const error = await keepPhoneOn(conflict.id, shown).catch((caught: unknown) => caught);

    // Settings: "This task's conflict closed by itself (an edit from this phone reached the cloud), so nothing was sent."
    expect(syncConflictChoiceStopReason(error)).toBe('conflict_closed');
    expect(cloudTask()).toMatchObject({ owner: 'Bob', notes: 'Crew short (typed on this phone).' });
    await expect(getSyncConflicts()).resolves.toEqual([]);
    await expect(getOfflineQueue()).resolves.toEqual([]);
  });

  it('a note saved in the last moment, after the waiting edits went up: the choice is not made over it, and it stays queued', async () => {
    const { mine, conflict, shown } = await cardAboutTheOwner();
    mockUpsertScheduleItem.mockClear();
    // He saves a note just as Keep Phone reads the row.
    mockGetScheduleItem.mockImplementationOnce(async (id: string) => {
      await queueScheduleItemRecord({ ...mine, notes: 'Crew short (typed on this phone).', updatedAt: '2026-09-30T12:00:00.000Z' }, false, ['notes', 'updatedAt'], mine);
      return mockCloud.get(id);
    });

    const error = await keepPhoneOn(conflict.id, shown).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(syncConflictChoiceStopReason(error)).toBeNull();
    expect(mockUpsertScheduleItem).not.toHaveBeenCalled();
    expect(cloudTask()).toMatchObject({ owner: 'Bob', notes: '' });
    expect(await cards()).toEqual([['owner']]);
    expect((await getOfflineQueue()).map(item => (item.payload as { changedFields?: string[] }).changedFields)).toEqual([['notes', 'updatedAt']]);

    // Chosen again: the note goes up first, then the owner.
    await expect(keepPhoneOn(conflict.id, shown)).resolves.toMatchObject({ owner: 'Ana' });
    expect(cloudTask()).toMatchObject({ owner: 'Ana', notes: 'Crew short (typed on this phone).' });
    await expect(getSyncConflicts()).resolves.toEqual([]);
  });
});

/* Follow-up 1: Keep Cloud ---------------------------------------------------------------------------------------- */

const NOTE = 'Crew short (typed on this phone).';
const keepCloudOn = (conflictId: string, shown: unknown) => resolveScheduleItemSyncConflict(conflictId, 'keep_cloud', { cloudCopyShown: shown });
const waitingFields = async () => (await getOfflineQueue())
  .map(item => [...((item.payload as { changedFields?: string[] }).changedFields ?? [])].sort());

/**
 * Keep Cloud took every waiting edit of the task off the queue. On a card about one field that discarded, on this
 * phone too, a newer edit of ANOTHER field: a note typed while the card asked about the owner was gone, and nothing
 * had asked about the note (the long-recorded "Keep Cloud withdraws newer queued edits", for a task's card of
 * fields). What waits beside the card now goes through the ordinary upload first, as for Keep Phone; Keep Cloud then
 * gives up what the card asks about, and nothing else.
 */
describe('independent review pass 4, follow-up 1: Keep Cloud on a card of fields gives up only what the card asked about', () => {
  it('only he changed the note: it goes up, the cloud\'s owner stays, in the one tap', async () => {
    const { mine, conflict, shown } = await cardAboutTheOwner();
    await aNoteOfHisWaits(mine);

    // It resolved with the cloud's row as it was: the note was taken off the queue and never sent.
    await expect(keepCloudOn(conflict.id, shown)).resolves.toMatchObject({ owner: 'Bob', notes: NOTE });

    expect(cloudTask()).toMatchObject({ owner: 'Bob', notes: NOTE });
    // One write, the note's own, weighed and written over the row as listed. Keep Cloud writes nothing.
    expect(mockUpsertScheduleItem).toHaveBeenCalledTimes(1);
    expect(mockUpsertScheduleItem.mock.calls[0][0]).toMatchObject({ owner: 'Bob', notes: NOTE });
    await expect(getSyncConflicts()).resolves.toEqual([]);
    await expect(getOfflineQueue()).resolves.toEqual([]);
  });

  it('another device typed a note too: nothing is forced and nothing is discarded; the card asks about both and he reviews again', async () => {
    const { mine, conflict, shown } = await cardAboutTheOwner();
    ipadSets({ notes: WEB_NOTE, updatedAt: '2026-09-30T11:00:00.000Z' });
    await aNoteOfHisWaits(mine);
    const seen = { ...shown, notes: WEB_NOTE, updatedAt: '2026-09-30T11:00:00.000Z' };

    const error = await keepCloudOn(conflict.id, seen).catch((caught: unknown) => caught);

    // Settings: "The cloud copy changed — review again. Nothing was sent."
    expect(syncConflictChoiceStopReason(error)).toBe('cloud_copy_changed');
    expect(cloudTask()).toMatchObject({ owner: 'Bob', notes: WEB_NOTE });
    expect(await cards()).toEqual([['owner', 'notes']]);
    await expect(getOfflineQueue()).resolves.toEqual([]);

    // He is shown both. Keep Cloud now gives up both: he was asked.
    const [both] = await getSyncConflicts();
    expect((both.localPayload as { itemData: ScheduleItem }).itemData).toMatchObject({ owner: 'Ana', notes: NOTE });
    await expect(keepCloudOn(both.id, both.remotePayload)).resolves.toMatchObject({ owner: 'Bob', notes: WEB_NOTE });
    expect(cloudTask()).toMatchObject({ owner: 'Bob', notes: WEB_NOTE });
    await expect(getSyncConflicts()).resolves.toEqual([]);
    await expect(getOfflineQueue()).resolves.toEqual([]);
  });

  it('a newer value of the field the card asks about is given up with the choice, as before, and nothing is written', async () => {
    const { mine, conflict, shown } = await cardAboutTheOwner();
    await queueScheduleItemRecord({ ...mine, owner: 'Ana (crew B)', updatedAt: '2026-09-30T12:00:00.000Z' }, false, ['owner', 'updatedAt'], mine);
    mockUpsertScheduleItem.mockClear();

    await expect(keepCloudOn(conflict.id, shown)).resolves.toMatchObject({ owner: 'Bob' });

    expect(cloudTask()).toMatchObject({ owner: 'Bob', notes: '' });
    expect(mockUpsertScheduleItem).not.toHaveBeenCalled();
    await expect(getSyncConflicts()).resolves.toEqual([]);
    await expect(getOfflineQueue()).resolves.toEqual([]);
  });

  it('one waiting record holds both, a newer owner and a note: the note goes up, the newer owner is given up, in the one tap', async () => {
    const { mine, conflict, shown } = await cardAboutTheOwner();
    await queueScheduleItemRecord({ ...mine, owner: 'Ana (crew B)', notes: NOTE, updatedAt: '2026-09-30T12:00:00.000Z' }, false, ['owner', 'notes', 'updatedAt'], mine);
    mockUpsertScheduleItem.mockClear();

    await expect(keepCloudOn(conflict.id, shown)).resolves.toMatchObject({ owner: 'Bob', notes: NOTE });

    expect(cloudTask()).toMatchObject({ owner: 'Bob', notes: NOTE });
    expect(mockUpsertScheduleItem.mock.calls.map(call => [call[0].owner, call[0].notes])).toEqual([['Bob', NOTE]]);
    await expect(getSyncConflicts()).resolves.toEqual([]);
    await expect(getOfflineQueue()).resolves.toEqual([]);
  });

  it('the waiting note cannot be sent now: nothing is decided and nothing is discarded; chosen again with signal, it goes through', async () => {
    const { mine, conflict, shown } = await cardAboutTheOwner();
    await aNoteOfHisWaits(mine);
    mockUpsertScheduleItem.mockImplementation(async () => mockUnreadable());

    const error = await keepCloudOn(conflict.id, shown).catch((caught: unknown) => caught);

    // Settings: "Conflict not resolved. Neither copy was changed." It had resolved, with the note gone from the queue.
    expect(error).toBeInstanceOf(Error);
    expect(syncConflictChoiceStopReason(error)).toBeNull();
    expect(cloudTask()).toMatchObject({ owner: 'Bob', notes: '' });
    expect(await cards()).toEqual([['owner']]);
    expect(await waitingFields()).toEqual([['notes', 'updatedAt']]);

    mockUpsertScheduleItem.mockImplementation(mockCloud.upsert);
    await expect(keepCloudOn(conflict.id, shown)).resolves.toMatchObject({ owner: 'Bob', notes: NOTE });
    expect(cloudTask()).toMatchObject({ owner: 'Bob', notes: NOTE });
    await expect(getSyncConflicts()).resolves.toEqual([]);
    await expect(getOfflineQueue()).resolves.toEqual([]);
  });

  it('the note\'s one try fails: the choice stops there with nothing changed, and does not go on to try it again by itself', async () => {
    const { mine, conflict, shown } = await cardAboutTheOwner();
    await aNoteOfHisWaits(mine);
    mockUpsertScheduleItem.mockImplementationOnce(async () => mockUnreadable());

    const error = await keepCloudOn(conflict.id, shown).catch((caught: unknown) => caught);

    // Going on, Keep Cloud's own upload step would send the note after all; whether the choice then held would
    // depend on that second try. It stops: he chooses again.
    expect(error).toBeInstanceOf(Error);
    expect(mockUpsertScheduleItem).toHaveBeenCalledTimes(1);
    expect(cloudTask()).toMatchObject({ owner: 'Bob', notes: '' });
    expect(await cards()).toEqual([['owner']]);
    expect(await waitingFields()).toEqual([['notes', 'updatedAt']]);
  });

  it('what an earlier Keep Cloud that could not finish left on the card stays given up: this one does not put it back on the queue', async () => {
    const { mine, conflict, shown } = await cardAboutTheOwner();
    await aNoteOfHisWaits(mine);
    await anUnfinishedKeepCloudLeftItOnTheCard(conflict.id);

    // Keep Phone sends such an edit first (he has chosen to keep his work). Keep Cloud leaves it where that earlier
    // choice put it: one of them may be in the cloud's row, for this choice to undo.
    await expect(keepCloudOn(conflict.id, shown)).resolves.toMatchObject({ owner: 'Bob', notes: '' });

    expect(mockUpsertScheduleItem).not.toHaveBeenCalled();
    expect(cloudTask()).toMatchObject({ owner: 'Bob', notes: '' });
    await expect(getSyncConflicts()).resolves.toEqual([]);
    await expect(getOfflineQueue()).resolves.toEqual([]);
  });

  it('a note saved in the last moment, after his newer owner was taken off the queue: it is not discarded, the owner waits again with it, and chosen again it goes through', async () => {
    const { mine, conflict, shown } = await cardAboutTheOwner();
    const newerOwner: ScheduleItem = { ...mine, owner: 'Ana (crew B)', updatedAt: '2026-09-30T12:00:00.000Z' };
    await queueScheduleItemRecord(newerOwner, false, ['owner', 'updatedAt'], mine);
    // Something else of this phone's waits, so Keep Cloud's own upload step has a pass to run.
    const other = mockCloudRows.get('task-other-1')!.item;
    await queueScheduleItemRecord({ ...other, notes: 'Other task note.', updatedAt: '2026-09-30T12:01:00.000Z' }, false, ['notes', 'updatedAt'], other);
    // The note is saved while that pass reads the task list (the second list read of the choice), and cannot be sent yet.
    mockListScheduleItems.mockImplementationOnce(mockCloud.list).mockImplementationOnce(async () => {
      await queueScheduleItemRecord({ ...newerOwner, notes: NOTE, updatedAt: '2026-09-30T12:02:00.000Z' }, false, ['notes', 'updatedAt'], newerOwner);
      return mockCloud.list();
    });
    mockUpsertScheduleItem.mockImplementation(async (item, options) => (item.id === phoneTask.id ? mockUnreadable() : mockCloud.upsert(item, options)));

    const error = await keepCloudOn(conflict.id, shown).catch((caught: unknown) => caught);

    // It resolved: the note was taken off the queue with the owner, and both were gone.
    expect(error).toBeInstanceOf(Error);
    expect(syncConflictChoiceStopReason(error)).toBeNull();
    expect(cloudTask()).toMatchObject({ owner: 'Bob', notes: '' });
    expect(await cards()).toEqual([['owner']]);
    const waiting = (await getOfflineQueue()).filter(item => (item.payload as { id: string }).id === phoneTask.id);
    expect(waiting).toHaveLength(1);
    expect(waiting[0].payload).toMatchObject({ itemData: { owner: 'Ana (crew B)', notes: NOTE } });
    expect([...(waiting[0].payload as { changedFields: string[] }).changedFields].sort()).toEqual(['notes', 'owner', 'updatedAt']);

    // Chosen again with signal: the note goes up, the newer owner is given up.
    mockUpsertScheduleItem.mockImplementation(mockCloud.upsert);
    const [open] = await getSyncConflicts();
    await expect(keepCloudOn(open.id, open.remotePayload)).resolves.toMatchObject({ owner: 'Bob', notes: NOTE });
    expect(cloudTask()).toMatchObject({ owner: 'Bob', notes: NOTE });
    await expect(getSyncConflicts()).resolves.toEqual([]);
    await expect(getOfflineQueue()).resolves.toEqual([]);
  });

  it('an edit of his that lands as he chooses and closes the card: its owner is undone, as before; its note, which the card never asked about, stays', async () => {
    const { mine, conflict, shown } = await cardAboutTheOwner();
    // A record with no copy it started from (as an older build queued them) goes up as it is: owner and note.
    await queueScheduleItemRecord({ ...mine, owner: 'Ana (crew B)', notes: NOTE, updatedAt: '2026-09-30T12:00:00.000Z' }, false, ['owner', 'notes', 'updatedAt']);
    mockUpsertScheduleItem.mockClear();
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
    // It lands just after Keep Cloud has read the card and what waits for the task.
    mockListScheduleItems.mockImplementationOnce(async () => {
      land();
      await inFlight;
      return mockCloud.list();
    });

    // The note was undone with the owner: gone from the cloud, and from this phone with the copy handed back.
    await expect(keepCloudOn(conflict.id, shown)).resolves.toMatchObject({ owner: 'Bob', notes: NOTE });

    expect(cloudTask()).toMatchObject({ owner: 'Bob', notes: NOTE });
    // The landing, then Keep Cloud's undo of the owner.
    expect(mockUpsertScheduleItem.mock.calls.map(call => [call[0].owner, call[0].notes])).toEqual([['Ana (crew B)', NOTE], ['Bob', NOTE]]);
    await expect(getSyncConflicts()).resolves.toEqual([]);
    await expect(getOfflineQueue()).resolves.toEqual([]);
  });

  it('a card about the whole task is as it was: Keep Cloud gives up everything of this phone\'s that waits for the task', async () => {
    const { conflict, shown } = await conflictWithWebCopy();
    await queueScheduleItemRecord({ ...phoneTask, owner: 'Ana', updatedAt: '2026-09-30T12:00:00.000Z' }, false, ['owner', 'updatedAt'], phoneTask);

    await expect(keepCloudOn(conflict.id, shown)).resolves.toMatchObject({ owner: '', notes: '' });

    expect(cloudTask()).toMatchObject({ owner: '', notes: '' });
    expect(mockUpsertScheduleItem).not.toHaveBeenCalled();
    await expect(getSyncConflicts()).resolves.toEqual([]);
    await expect(getOfflineQueue()).resolves.toEqual([]);
  });
});
