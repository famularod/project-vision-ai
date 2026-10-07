/**
 * Sync batch Y4, item 1 (the coordinator's decision on the ending).
 *
 * Four internal records share one reader (services/DurableLocalTransaction.ts). One that cannot be read at all was
 * refused at every start and every Retry Recovery, for good: "Writes are blocked until recovery", with nothing to
 * recover from and no way out but removing the app.
 *
 * - The restore's record: set aside (its bytes kept under another name), the app starts, and he is told once.
 * - A field update's save record: the same, because nothing of his can go with it (shown here at every write a save
 *   can stop at).
 * - A project deletion's record and the waiting uploads' record: NOT changed. Each still stops, and a test holds
 *   that; what each could lose is in the notes.
 *
 * Every path of a start ends in "the app starts" or in the refusal it always had, and a start closed at any step of
 * the setting aside is finished by the next start. Synthetic data only.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as fs from 'fs';
import * as path from 'path';
import { BACKUP_RESTORE_TRANSACTION_JOURNAL_KEY, BackupRestoreRecoveryRequiredError, createBackupRestoreRuntime } from '../../services/BackupRestoreRuntime';
import { createDurableLocalTransactionRepository } from '../../services/DurableLocalTransaction';
import {
  FieldUpdatePersistenceBlockedError,
  createFieldUpdateLocalPersistence,
  prepareFieldUpdateStatusSave,
  prepareQueuedFieldUpdateSave,
} from '../../services/FieldUpdateLocalPersistence';
import { assertLocalStorageKeysNotHeldForRecovery } from '../../services/LocalStorageMutationCoordinator';
import { PROJECT_DELETION_TRANSACTION_JOURNAL_KEY, createProjectDeletionTransactionRepository } from '../../services/ProjectDeletionTransaction';

const mockValues = new Map<string, string>();
/** `closedAt`: the app is closed at that write (1 = the next one): it and every later write fail until `reopen()`. */
const mockDevice = { closed: false, writes: 0, closedAt: -1, garbleNextWriteOf: '', dropWritesOf: '' };
jest.mock('@react-native-async-storage/async-storage', () => {
  const write = (apply: () => void) => {
    mockDevice.writes += 1;
    if (mockDevice.closed || mockDevice.writes === mockDevice.closedAt) { mockDevice.closed = true; throw new Error('device storage write failed'); }
    apply();
  };
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (key: string) => mockValues.get(key) ?? null),
      setItem: jest.fn(async (key: string, value: string) => {
        write(() => {
          if (key.startsWith(mockDevice.dropWritesOf) && mockDevice.dropWritesOf) return;
          if (key === mockDevice.garbleNextWriteOf) { mockDevice.garbleNextWriteOf = ''; mockValues.set(key, value.slice(0, 40)); return; }
          mockValues.set(key, value);
        });
      }),
      removeItem: jest.fn(async (key: string) => { write(() => mockValues.delete(key)); }),
      getAllKeys: jest.fn(async () => [...mockValues.keys()]),
    },
  };
});
const closeAppAtWrite = (write: number) => { mockDevice.writes = 0; mockDevice.closedAt = write; };
const reopen = () => { mockDevice.closed = false; mockDevice.closedAt = -1; };

const NOW = '2026-10-06T12:00:00.000Z';
const JOURNAL = 'some-journal';
const journalRecord = (over: Record<string, unknown> = {}) => ({
  version: 1, transactionId: 'transaction-0001', phase: 'applying', createdAt: NOW,
  operations: [{ kind: 'set', key: 'updates', value: '[{"id":"u1"}]' }, { kind: 'set', key: 'projects', value: '["Alpha"]' }],
  beforeValues: ['[{"id":"old"}]', '["Old"]'], appliedOperationIndexes: [0], skippedOperationIndexes: [], ...over,
});
/** Every way the one reader refuses a record outright. */
const UNREADABLE: Array<[string, string]> = [
  ['cut off part-way', JSON.stringify(journalRecord()).slice(0, 60)],
  ['empty', ''],
  ['the word null', 'null'],
  ['a list, not a record', '[]'],
  ['of a version this build does not know', JSON.stringify(journalRecord({ version: 2 }))],
  ['without its id', JSON.stringify(journalRecord({ transactionId: '' }))],
  ['dated with something that is not a date', JSON.stringify(journalRecord({ createdAt: 'yesterday' }))],
  ['at a step this build does not know', JSON.stringify(journalRecord({ phase: 'half' }))],
  ['holding an operation this build does not know', JSON.stringify(journalRecord({ operations: [{ kind: 'rename', key: 'updates' }], beforeValues: [null] }))],
  ['holding no operations', JSON.stringify(journalRecord({ operations: [], beforeValues: [] }))],
  ['holding fewer earlier values than operations', JSON.stringify(journalRecord({ beforeValues: [] }))],
  ['naming a step past its last one', JSON.stringify(journalRecord({ appliedOperationIndexes: [7] }))],
];
const CUT_OFF = UNREADABLE[0][1];

const asideKeysOf = (journalKey: string) => [...mockValues.keys()].filter(key => key.startsWith(`${journalKey}.unreadable.`));
const noticeKeyOf = (journalKey: string) => `${journalKey}.setAsideNotice`;
type SetAside = { setAsideIfUnreadable: () => Promise<{ asideKey: string } | null> };
const repository = (journalKey = JOURNAL) => createDurableLocalTransactionRepository({
  storage: AsyncStorage, journalKey, createTransactionId: () => 'transaction-0002', now: () => NOW,
});
const setAside = (journalKey = JOURNAL) => (repository(journalKey) as unknown as SetAside).setAsideIfUnreadable();

beforeEach(() => {
  mockValues.clear();
  Object.assign(mockDevice, { closed: false, writes: 0, closedAt: -1, garbleNextWriteOf: '', dropWritesOf: '' });
  try {
    // A new run of the app (the module is new in this batch: on the base there is nothing to reset).
    (require('../../services/RecoveryRecordNotices') as { resetRecoveryRecordNoticesForTests: () => void }).resetRecoveryRecordNoticesForTests();
  } catch { /* not there before this batch */ }
});

describe('sync batch Y4, item 1: a recovery record that cannot be read is kept under another name, not left where it blocks', () => {
  it.each(UNREADABLE)('a record that is %s: refused as before; set aside, its bytes are kept exactly and the next write goes through', async (_name, raw) => {
    mockValues.set(JOURNAL, raw).set('updates', '[{"id":"old"}]');
    await expect(repository().recover()).rejects.toMatchObject({ name: 'DurableLocalTransactionError', recoverable: false });
    await expect(repository().commit([{ kind: 'set', key: 'updates', value: '[]' }])).rejects.toMatchObject({ recoverable: false });
    expect(mockValues.get('updates')).toBe('[{"id":"old"}]');

    const result = await setAside();

    expect(asideKeysOf(JOURNAL)).toEqual([result?.asideKey]);
    expect(mockValues.get(result!.asideKey)).toBe(raw);
    expect(mockValues.has(JOURNAL)).toBe(false);
    expect(JSON.parse(mockValues.get(noticeKeyOf(JOURNAL)) as string)).toEqual({ asideKey: result!.asideKey });
    // Nothing else on the device was touched, and the store works again.
    expect(mockValues.get('updates')).toBe('[{"id":"old"}]');
    await expect(repository().recover()).resolves.toBeNull();
    await expect(repository().commit([{ kind: 'set', key: 'updates', value: '[]' }])).resolves.toMatchObject({ recovered: false });
  });

  it('a record that can be read is never set aside, at any of its steps: it is left for the recovery', async () => {
    for (const phase of ['prepared', 'applying', 'committed']) {
      mockValues.clear();
      const raw = JSON.stringify(journalRecord({ phase, appliedOperationIndexes: phase === 'prepared' ? [] : phase === 'applying' ? [0] : [0, 1] }));
      mockValues.set(JOURNAL, raw);
      mockDevice.writes = 0;
      await expect(setAside()).resolves.toBeNull();
      expect({ phase, journal: mockValues.get(JOURNAL), keys: mockValues.size, writes: mockDevice.writes }).toEqual({ phase, journal: raw, keys: 1, writes: 0 });
    }
  });

  it('with no record waiting nothing is written', async () => {
    await expect(setAside()).resolves.toBeNull();
    expect([mockValues.size, mockDevice.writes]).toEqual([0, 0]);
  });

  it('the app closed at each step of the setting aside: the next start finishes it, and there is one copy', async () => {
    // Its three writes: the copy, the note that it was set aside, the removal.
    const left: string[] = [];
    for (let step = 1; step <= 3; step += 1) {
      mockValues.clear();
      mockValues.set(JOURNAL, CUT_OFF);
      closeAppAtWrite(step);
      await expect(setAside()).rejects.toThrow();
      // Closed there: the record is still where it was (nothing is ever removed before its copy and its note exist).
      expect({ step, journal: mockValues.get(JOURNAL) }).toEqual({ step, journal: CUT_OFF });
      left.push(`${asideKeysOf(JOURNAL).length} copy, ${mockValues.has(noticeKeyOf(JOURNAL)) ? 'noted' : 'not noted'}`);
      reopen();

      const result = await setAside();

      expect({ step, copies: asideKeysOf(JOURNAL), journal: mockValues.has(JOURNAL), noted: mockValues.has(noticeKeyOf(JOURNAL)) })
        .toEqual({ step, copies: [result!.asideKey], journal: false, noted: true });
      expect(mockValues.get(result!.asideKey)).toBe(CUT_OFF);
    }
    expect(left).toEqual(['0 copy, not noted', '1 copy, not noted', '1 copy, noted']);
  });

  it('a name that already holds other bytes is never written over: the copy goes under the next name', async () => {
    mockValues.set(JOURNAL, CUT_OFF);
    const first = (await setAside())!.asideKey;
    mockValues.set(first, 'the bytes of an earlier record');
    mockValues.set(JOURNAL, CUT_OFF);

    const second = (await setAside())!.asideKey;

    expect(second).not.toBe(first);
    expect([mockValues.get(first), mockValues.get(second)]).toEqual(['the bytes of an earlier record', CUT_OFF]);
  });

  it('a device that does not keep the copy: the record is not removed, and it says so', async () => {
    mockValues.set(JOURNAL, CUT_OFF);
    mockDevice.dropWritesOf = `${JOURNAL}.unreadable.`;
    await expect(setAside()).rejects.toThrow('could not be kept under another name');
    expect([mockValues.get(JOURNAL), mockValues.size]).toEqual([CUT_OFF, 1]);
  });
});

/* The restore ---------------------------------------------------------------- */

const targetKeys = {
  updates: 'updates', projects: 'projects', archivedProjects: 'archived-projects', contacts: 'contacts', projectAreas: 'areas',
  referenceDocuments: 'reference-documents', projectDocuments: 'project-documents', scheduleItems: 'schedule-items',
  captureMemories: 'capture-memories', activeDraft: 'draft',
};
const barrierKeys = {
  deletedProjects: 'deleted-projects', deletedUpdates: 'deleted-updates', updateDeletionJournal: 'update-deletion-journal',
  projectDeletionCloudIntents: 'project-cloud-deletion-intents', projectDeletionFileCleanupIntents: 'project-file-cleanup-intents',
  daveSyncTombstones: 'dave-tombstones', fieldUpdateTransactionJournal: 'field-journal', projectDeletionTransactionJournal: 'project-journal',
};
const RESTORED_VALUES = {
  updates: [{ id: 'u1' }], projects: ['Alpha'], archivedProjects: [], contacts: {}, projectAreas: [], referenceDocuments: [],
  projectDocuments: [], scheduleItems: [], captureMemories: [], activeDraft: null,
};
const RESTORE = BACKUP_RESTORE_TRANSACTION_JOURNAL_KEY;
let ids = 0;
/** A start of the app: a new restore runtime over the same device storage. */
const restoreRuntime = (settleRestoredMedia?: () => Promise<unknown>) => createBackupRestoreRuntime({
  storage: AsyncStorage, targetKeys, barrierKeys, createTransactionId: () => `restore-${String(ids += 1).padStart(4, '0')}`, now: () => NOW,
  recoverProjectDeletion: async () => undefined, recoverFieldUpdate: async () => undefined, loadQueuedProjectDeletionNames: async () => [],
  ...(settleRestoredMedia ? { settleRestoredMedia } : {}),
});
const deviceBeforeRestore = () => {
  mockValues.clear();
  mockValues.set('updates', '[{"id":"old"}]').set('projects', '["Old"]').set('draft', '{"draft":"before the restore"}');
};
const listsOnDevice = () => Object.fromEntries(Object.values(targetKeys).map(key => [key, mockValues.get(key) ?? null]));

describe('sync batch Y4, item 1: a held restore whose record cannot be read no longer stops the app at every start', () => {
  it.each(UNREADABLE)('its record is %s: the app starts, the record is kept under another name, and the saved lists are as they were', async (_name, raw) => {
    deviceBeforeRestore();
    mockValues.set(RESTORE, raw);
    const before = listsOnDevice();
    const settled: string[] = [];

    // It threw "The durable local transaction journal is corrupt. Writes are blocked until recovery." at every start.
    await expect(restoreRuntime(async () => { settled.push(mockValues.has(RESTORE) ? 'record still waiting' : 'no record waiting'); })
      .recoverBeforeStartupReads()).resolves.toBeUndefined();

    expect(mockValues.has(RESTORE)).toBe(false);
    expect(asideKeysOf(RESTORE).map(key => mockValues.get(key))).toEqual([raw]);
    expect(listsOnDevice()).toEqual(before);
    // The restored files are settled as after any recovery, once no record waits.
    expect(settled).toEqual(['no record waiting']);
    // The lists are no longer held for a recovery: the app's own saves go through again.
    await expect(assertLocalStorageKeysNotHeldForRecovery(Object.values(targetKeys))).resolves.toBeUndefined();
  });

  it('every start after it starts too, and makes no second copy', async () => {
    deviceBeforeRestore();
    mockValues.set(RESTORE, CUT_OFF);
    for (let start = 1; start <= 3; start += 1) await expect(restoreRuntime().recoverBeforeStartupReads()).resolves.toBeUndefined();
    expect(asideKeysOf(RESTORE)).toHaveLength(1);
  });

  it('the app closed at each step of the setting aside: that start is refused as it was, the next start goes through, never a third state', async () => {
    for (let step = 1; step <= 3; step += 1) {
      deviceBeforeRestore();
      mockValues.set(RESTORE, CUT_OFF);
      const before = listsOnDevice();
      closeAppAtWrite(step);
      await expect(restoreRuntime().recoverBeforeStartupReads()).rejects.toThrow();
      expect({ step, record: mockValues.get(RESTORE), lists: listsOnDevice() }).toEqual({ step, record: CUT_OFF, lists: before });
      // Still held: nothing saves the restore's lists while its record waits.
      await expect(assertLocalStorageKeysNotHeldForRecovery(Object.values(targetKeys))).rejects.toThrow();
      reopen();

      await expect(restoreRuntime().recoverBeforeStartupReads()).resolves.toBeUndefined();

      expect({ step, record: mockValues.has(RESTORE), copies: asideKeysOf(RESTORE).map(key => mockValues.get(key)), lists: listsOnDevice() })
        .toEqual({ step, record: false, copies: [CUT_OFF], lists: before });
    }
  });

  it('while the device cannot write, every start is refused and nothing is removed; the first start at which it can goes through', async () => {
    deviceBeforeRestore();
    mockValues.set(RESTORE, CUT_OFF);
    mockDevice.closed = true;
    for (let start = 1; start <= 3; start += 1) await expect(restoreRuntime().recoverBeforeStartupReads()).rejects.toThrow();
    expect([mockValues.get(RESTORE), asideKeysOf(RESTORE)]).toEqual([CUT_OFF, []]);
    reopen();
    await expect(restoreRuntime().recoverBeforeStartupReads()).resolves.toBeUndefined();
    expect(mockValues.has(RESTORE)).toBe(false);
  });

  it('a held restore whose record can be read is finished as before, and nothing is set aside or said', async () => {
    deviceBeforeRestore();
    closeAppAtWrite(5);
    const error = await restoreRuntime().commit(() => ({ values: RESTORED_VALUES, result: 'ok' })).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BackupRestoreRecoveryRequiredError);
    reopen();

    await expect(restoreRuntime().recoverBeforeStartupReads()).resolves.toBeUndefined();

    expect([mockValues.get('updates'), mockValues.get('projects'), mockValues.has('draft')]).toEqual(['[{"id":"u1"}]', '["Alpha"]', false]);
    expect([mockValues.has(RESTORE), asideKeysOf(RESTORE), mockValues.has(noticeKeyOf(RESTORE))]).toEqual([false, [], false]);
  });

  it('wherever a restore\'s writes stopped, its record then unreadable: the start goes through and each list is the restore\'s or the one from before it', async () => {
    const outcomes: string[] = [];
    for (let stopAt = 2; stopAt <= 30; stopAt += 1) {
      deviceBeforeRestore();
      const before = listsOnDevice();
      closeAppAtWrite(stopAt);
      await restoreRuntime().commit(() => ({ values: RESTORED_VALUES, result: 'ok' })).catch(() => undefined);
      reopen();
      if (!mockValues.has(RESTORE)) continue;
      // The record is damaged where it lies: half of it is gone.
      const whole = mockValues.get(RESTORE) as string;
      mockValues.set(RESTORE, whole.slice(0, Math.floor(whole.length / 2)));
      const held = listsOnDevice();

      for (let start = 1; start <= 2; start += 1) await expect(restoreRuntime().recoverBeforeStartupReads()).resolves.toBeUndefined();

      expect({ stopAt, record: mockValues.has(RESTORE), lists: listsOnDevice() }).toEqual({ stopAt, record: false, lists: held });
      (Object.keys(targetKeys) as Array<keyof typeof targetKeys>).forEach(name => {
        const restored = RESTORED_VALUES[name] === null ? null : JSON.stringify(RESTORED_VALUES[name]);
        expect({ stopAt, name, isOneOfTheTwo: [restored, before[targetKeys[name]]].includes(held[targetKeys[name]]) }).toEqual({ stopAt, name, isOneOfTheTwo: true });
      });
      outcomes.push(Object.values(held).filter((value, index) => value !== Object.values(before)[index]).length > 0 ? 'partly restored' : 'not restored');
    }
    expect(outcomes.length).toBeGreaterThan(10);
    expect(new Set(outcomes)).toEqual(new Set(['partly restored', 'not restored']));
  });

  it('a restore asked for while such a record waits: the record is set aside first, and the restore is committed', async () => {
    deviceBeforeRestore();
    mockValues.set(RESTORE, CUT_OFF);

    await expect(restoreRuntime().commit(() => ({ values: RESTORED_VALUES, result: 'ok' }))).resolves.toBe('ok');

    expect([mockValues.get('updates'), mockValues.get('projects'), mockValues.has(RESTORE)]).toEqual(['[{"id":"u1"}]', '["Alpha"]', false]);
    expect(asideKeysOf(RESTORE).map(key => mockValues.get(key))).toEqual([CUT_OFF]);
  });

  it('a restore whose own record is damaged as it is written ends "recovery required", as before; the next start goes through', async () => {
    deviceBeforeRestore();
    const before = listsOnDevice();
    mockDevice.garbleNextWriteOf = RESTORE;

    const error = await restoreRuntime().commit(() => ({ values: RESTORED_VALUES, result: 'ok' })).catch((caught: unknown) => caught);

    // Not "failed": the lists may have been written. Its files are kept (independent review R01).
    expect(error).toBeInstanceOf(BackupRestoreRecoveryRequiredError);
    expect(mockValues.has(RESTORE)).toBe(true);
    await expect(restoreRuntime().recoverBeforeStartupReads()).resolves.toBeUndefined();
    expect([mockValues.has(RESTORE), asideKeysOf(RESTORE).length, listsOnDevice()]).toEqual([false, 1, before]);
  });
});

/* The sentence ---------------------------------------------------------------- */

type Notices = typeof import('../../services/RecoveryRecordNotices');
const notices = () => require('../../services/RecoveryRecordNotices') as Notices;
type Said = { title: string; message: string; ok: () => void };
const sayOnce = async (said: Said[]) => notices().sayRecoveryRecordsSetAsideOnce(AsyncStorage, 'field-journal',
  (title, message, buttons) => { said.push({ title, message, ok: buttons[0].onPress }); });
const flush = async () => { for (let turn = 0; turn < 5; turn += 1) await Promise.resolve(); };

describe('sync batch Y4, item 1: he is told once, in one plain sentence', () => {
  it('after the start that set the restore\'s record aside: said once, and never again once he has tapped OK', async () => {
    deviceBeforeRestore();
    mockValues.set(RESTORE, CUT_OFF);
    await restoreRuntime().recoverBeforeStartupReads();
    const said: Said[] = [];

    await sayOnce(said);
    // Retry Recovery runs the startup recovery again in the same run of the app.
    await sayOnce(said);

    expect(said.map(entry => [entry.title, entry.message])).toEqual([[
      'Restore not finished',
      // Review pass 1, sync: the lists left may be a mix (each one wholly the backup's or wholly the one from before it), and the sentence now says so.
      'A restore that was interrupted could not be finished because its record on this device could not be read, so your saved records were left as they are, which may be a mix of what the backup held and what was here before it: restore the backup again if anything is missing.',
    ]]);
    said[0].ok();
    await flush();
    expect(mockValues.has(noticeKeyOf(RESTORE))).toBe(false);
    // The copy stays: nothing is destroyed.
    expect(asideKeysOf(RESTORE)).toHaveLength(1);
    notices().resetRecoveryRecordNoticesForTests();
    await sayOnce(said);
    expect(said).toHaveLength(1);
  });

  it('the app closed while the sentence was on the screen: it is said again at the next start', async () => {
    deviceBeforeRestore();
    mockValues.set(RESTORE, CUT_OFF);
    await restoreRuntime().recoverBeforeStartupReads();
    const said: Said[] = [];
    await sayOnce(said);
    notices().resetRecoveryRecordNoticesForTests(); // closed before OK; a new run
    await restoreRuntime().recoverBeforeStartupReads();
    await sayOnce(said);
    expect(said.map(entry => entry.title)).toEqual(['Restore not finished', 'Restore not finished']);
  });

  it('nothing was set aside: nothing is said, and nothing is written', async () => {
    deviceBeforeRestore();
    await restoreRuntime().recoverBeforeStartupReads();
    const said: Said[] = [];
    mockDevice.writes = 0;
    await sayOnce(said);
    expect([said.length, mockDevice.writes]).toEqual([0, 0]);
  });

  it('a field update\'s save record set aside is said in its own sentence, after the restore\'s', async () => {
    deviceBeforeRestore();
    mockValues.set(RESTORE, CUT_OFF).set('field-journal', CUT_OFF);
    await fieldUpdateStore().recoverBeforeStartupReads();
    await restoreRuntime().recoverBeforeStartupReads();
    const said: Said[] = [];
    await sayOnce(said);
    expect(said.map(entry => entry.title)).toEqual(['Restore not finished', 'Update save not finished']);
    expect(said[1].message).toBe('A field update that was being saved when the app closed could not be finished because its record on this device could not be read, so your draft and your saved updates were left as they are: check the last update you sent, and send it again if it is missing.');
    // One sentence each, and no word of the machinery.
    said.forEach(entry => {
      expect(entry.message.match(/\./g)).toHaveLength(1);
      expect(entry.message).not.toMatch(/journal|transaction|corrupt|quarantin|error/i);
    });
  });

  it('App.tsx says it once the startup recovery has succeeded, and not when that recovery is refused', () => {
    const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');
    expect(app).toContain("import { sayRecoveryRecordsSetAsideOnce } from './services/RecoveryRecordNotices';");
    expect(app).toContain('backupRestoreRuntime.recoverBeforeStartupReads().then(() => sayRecoveryRecordsSetAsideOnce(AsyncStorage, FIELD_UPDATE_TRANSACTION_JOURNAL_KEY, Alert.alert)).catch(() => undefined);');
    expect(app.split('\n').length - 1).toBeLessThanOrEqual(21066);
  });
});

/* A field update's save ------------------------------------------------------- */

const FIELD_KEYS = { journal: 'field-journal', updates: 'updates', tombstones: 'deleted-updates', draft: 'draft' };
type Update = { id: string; status?: string; note?: string };
type Tombstone = { updateId: string };
let fieldIds = 0;
/** A start of the app: a new field-update store over the same device storage. */
const fieldUpdateStore = () => createFieldUpdateLocalPersistence<Update, Tombstone>({
  storage: AsyncStorage, keys: FIELD_KEYS, createTransactionId: () => `field-update-${String(fieldIds += 1).padStart(4, '0')}`, now: () => NOW,
  parseUpdate: value => value as Update, parseTombstone: value => value as Tombstone,
});
const DRAFT = JSON.stringify({ savedAt: NOW, draft: { id: 'u-new', note: 'his note' } });
const deviceBeforeSave = () => {
  mockValues.clear();
  mockValues.set('updates', '[{"id":"u-old","status":"sent"}]').set('draft', DRAFT);
};
const mergeVisibleUpdates = ({ localUpdates }: { localUpdates: Update[] }) => localUpdates;
const sendTheDraft = (store: ReturnType<typeof fieldUpdateStore>) => store.commit(snapshot => prepareQueuedFieldUpdateSave({
  snapshot, queuedUpdate: { id: 'u-new', status: 'queued', note: 'his note' }, currentUpdates: [{ id: 'u-old', status: 'sent' }],
  currentTombstones: [], keys: FIELD_KEYS, mergeVisibleUpdates,
}));
const savedUpdates = () => JSON.parse(mockValues.get('updates') ?? '[]') as Update[];

describe('sync batch Y4, item 1: a field update\'s save record that cannot be read no longer stops the app at every start', () => {
  it.each(UNREADABLE)('its record is %s: the app starts (it was blocked), and his draft and his saved updates are as they were', async (_name, raw) => {
    deviceBeforeSave();
    mockValues.set('field-journal', raw);

    await expect(fieldUpdateStore().recoverBeforeStartupReads()).resolves.toBeUndefined();

    expect([mockValues.get('updates'), mockValues.get('draft'), mockValues.has('field-journal')]).toEqual(['[{"id":"u-old","status":"sent"}]', DRAFT, false]);
    expect(asideKeysOf('field-journal').map(key => mockValues.get(key))).toEqual([raw]);
    expect(mockValues.has(noticeKeyOf('field-journal'))).toBe(true);
  });

  it('the app closed at each step of the setting aside: that start is blocked as it was, the next start goes through', async () => {
    for (let step = 1; step <= 3; step += 1) {
      deviceBeforeSave();
      mockValues.set('field-journal', CUT_OFF);
      closeAppAtWrite(step);
      await expect(fieldUpdateStore().recoverBeforeStartupReads()).rejects.toBeInstanceOf(FieldUpdatePersistenceBlockedError);
      expect({ step, record: mockValues.get('field-journal'), draft: mockValues.get('draft') }).toEqual({ step, record: CUT_OFF, draft: DRAFT });
      reopen();
      await expect(fieldUpdateStore().recoverBeforeStartupReads()).resolves.toBeUndefined();
      expect({ step, record: mockValues.has('field-journal'), copies: asideKeysOf('field-journal').length }).toEqual({ step, record: false, copies: 1 });
    }
  });

  it('nothing of his goes with it: at every write a Send can stop at, its record then unreadable, the update is in the saved list or still his draft', async () => {
    const where: string[] = [];
    for (let stopAt = 1; stopAt <= 14; stopAt += 1) {
      deviceBeforeSave();
      closeAppAtWrite(stopAt);
      await sendTheDraft(fieldUpdateStore()).catch(() => undefined);
      reopen();
      if (!mockValues.has('field-journal')) continue;
      const whole = mockValues.get('field-journal') as string;
      mockValues.set('field-journal', whole.slice(0, Math.floor(whole.length / 2)));

      await expect(fieldUpdateStore().recoverBeforeStartupReads()).resolves.toBeUndefined();

      const inList = savedUpdates().some(update => update.id === 'u-new' && update.note === 'his note');
      const stillDraft = mockValues.get('draft') === DRAFT;
      expect({ stopAt, kept: inList || stillDraft }).toEqual({ stopAt, kept: true });
      // And what was there before is there still.
      expect({ stopAt, old: savedUpdates().some(update => update.id === 'u-old') }).toEqual({ stopAt, old: true });
      where.push(inList && stillDraft ? 'both' : inList ? 'the saved list' : 'the draft');
    }
    // Every place a Send can stop is seen: before the list is written, after it, and after the draft is gone.
    expect(new Set(where)).toEqual(new Set(['the draft', 'both', 'the saved list']));
  });

  it('a result that was not written leaves the update waiting to be sent, at every write its save can stop at', async () => {
    let seen = 0;
    for (let stopAt = 1; stopAt <= 12; stopAt += 1) {
      mockValues.clear();
      mockValues.set('updates', '[{"id":"u-new","status":"queued","note":"his note"}]');
      closeAppAtWrite(stopAt);
      await fieldUpdateStore().commit(snapshot => prepareFieldUpdateStatusSave({
        snapshot, update: { id: 'u-new', status: 'sent', note: 'his note' }, expectedUpdate: { id: 'u-new', status: 'queued', note: 'his note' },
        currentUpdates: [{ id: 'u-new', status: 'queued', note: 'his note' }], currentTombstones: [], keys: FIELD_KEYS, mergeVisibleUpdates,
        reconcile: (current, _expected, result) => ({ updates: current.map(update => update.id === result.id ? result : update), applied: true }),
      })).catch(() => undefined);
      reopen();
      if (!mockValues.has('field-journal')) continue;
      seen += 1;
      mockValues.set('field-journal', CUT_OFF);

      await expect(fieldUpdateStore().recoverBeforeStartupReads()).resolves.toBeUndefined();

      expect({ stopAt, updates: savedUpdates().map(update => [update.id, update.note, ['queued', 'sent'].includes(update.status ?? '')]) })
        .toEqual({ stopAt, updates: [['u-new', 'his note', true]] });
    }
    expect(seen).toBeGreaterThan(3);
  });

  it('a save made while such a record waits is blocked, as before; after the next start it goes through', async () => {
    deviceBeforeSave();
    mockValues.set('field-journal', CUT_OFF);
    const blocked = await sendTheDraft(fieldUpdateStore()).catch((caught: unknown) => caught);
    expect(blocked).toBeInstanceOf(FieldUpdatePersistenceBlockedError);
    expect([mockValues.get('field-journal'), mockValues.get('draft'), asideKeysOf('field-journal')]).toEqual([CUT_OFF, DRAFT, []]);

    const store = fieldUpdateStore();
    await store.recoverBeforeStartupReads();
    await expect(sendTheDraft(store)).resolves.toMatchObject({ applied: true });
    expect([savedUpdates().map(update => update.id), mockValues.has('draft')]).toEqual([['u-new', 'u-old'], false]);
  });

  it('a record that CAN be read, whose list has been saved again since, still stops: that one may hold his newer edit (not changed)', async () => {
    deviceBeforeSave();
    closeAppAtWrite(5);
    await sendTheDraft(fieldUpdateStore()).catch(() => undefined);
    reopen();
    expect(JSON.parse(mockValues.get('field-journal') as string)).toMatchObject({ appliedOperationIndexes: [0] });
    mockValues.set('updates', '[{"id":"u-old","status":"sent"},{"id":"saved-meanwhile"}]');

    await expect(fieldUpdateStore().recoverBeforeStartupReads()).rejects.toBeInstanceOf(FieldUpdatePersistenceBlockedError);

    expect([mockValues.has('field-journal'), asideKeysOf('field-journal'), mockValues.has(noticeKeyOf('field-journal'))]).toEqual([true, [], false]);
  });
});

/* Not built ------------------------------------------------------------------- */

describe('sync batch Y4, item 1: the two records that are NOT set aside (each could lose something of his: see the notes)', () => {
  it('a project deletion\'s record that cannot be read still stops, and nothing is set aside', async () => {
    mockValues.set(PROJECT_DELETION_TRANSACTION_JOURNAL_KEY, CUT_OFF);
    const deletion = createProjectDeletionTransactionRepository({ storage: AsyncStorage, createTransactionId: () => 'deletion-0001', now: () => NOW });
    await expect(deletion.recover()).rejects.toMatchObject({ code: 'journal_corrupt' });
    expect([mockValues.get(PROJECT_DELETION_TRANSACTION_JOURNAL_KEY), mockValues.size]).toEqual([CUT_OFF, 1]);
  });

  it('only the restore and a field update\'s save ask for it: the project deletion and the waiting uploads do not', () => {
    const source = (file: string) => fs.readFileSync(path.resolve(__dirname, '../../services', file), 'utf8');
    const asks = (file: string) => (source(file).match(/\.setAsideIfUnreadable\(\)/g) ?? []).length;
    expect({
      restore: asks('BackupRestoreRuntime.ts'), fieldUpdate: asks('FieldUpdateLocalPersistence.ts'),
      projectDeletion: asks('ProjectDeletionRuntime.ts') + asks('ProjectDeletionTransaction.ts'), waitingUploads: asks('SyncService.ts'),
    }).toEqual({ restore: 1, fieldUpdate: 1, projectDeletion: 0, waitingUploads: 0 });
  });
});
