/**
 * Review N2 L7 (Low, a gap in 79a5ae1, owner answer Q28; 5 Oct 2026): after Keep Phone, a second card at once,
 * naming "another device" for parts David's own choice had just written.
 *
 * The cause. Keep Phone sends the copy the card was raised with, then the newer edit David saved while the card
 * waited. That newer edit is weighed against the cloud's copy by the copy it started from, and the cloud's copy is
 * now the one his choice wrote. When the newer edit did not start from that very copy, every part his choice wrote
 * read as changed by another device:
 * - he had saved again more than once while the card waited, and a late photo result came in between: the last
 *   save started from the card showing his own earlier, unsent save;
 * - or a refresh had put the cloud's copy on the card while it waited, and his later edit started from that.
 * With one later edit and nothing in between, the edit started from the card's own copy, and it was right.
 *
 * The copy a choice of his puts in the cloud is now remembered on the device (for the account, through a relaunch).
 * To an edit that began before it, a part the cloud holds as his choice wrote it is his own write. A change another
 * device makes afterwards is still asked about.
 *
 * On the two-device rig of the Q28 test (tests/fixtures/field-update-two-device-rig.ts). Synthetic data.
 */
import { fieldUpdateConflictChanges } from '../../services/FieldUpdateEditBase';
import { loadFieldUpdateTwoDeviceRig, type RigDevice, type RigUpdate } from '../fixtures/field-update-two-device-rig';

const rig = loadFieldUpdateTwoDeviceRig({ require, jest, dirname: __dirname });
const {
  IPAD_NOTE, PHONE_NOTE, UPDATE_ID, at, backgroundUpload, cardFails, chooseInSettings, cloudUpdate, conflictsOf, on, openAndSave, openOnly,
  queueOf, refresh, relaunchModules, saveOpened, setOnline, start, startup, theUpdate, updatesSetter, waitingUpdateSync,
} = rig;

const shows = (update: RigUpdate | undefined) => update && {
  notes: update.notes, area: update.selectedAreaName, task: update.scheduleItemId || '',
};
const cardsSay = async (device: RigDevice) => (await conflictsOf(device)).filter(conflict => conflict.entity === 'project_update')
  .map(conflict => fieldUpdateConflictChanges(conflict.localPayload, conflict.remotePayload));
const area = (name: string) => ({ selectedAreaId: name.toLowerCase().replace(' ', '-'), selectedAreaName: name });
const TASK = { scheduleItemId: 'task-9', scheduleTaskName: 'Task 9', scheduleProjectName: 'Alpha' };

/** The iPad moves the update to Area 1; the phone, which has not heard, changes the note: the card waits in Review Conflicts. */
async function cardWaits(note = PHONE_NOTE) {
  const devices = await start();
  at('2026-09-08T08:00:00.000Z');
  cardFails(devices.ipad);
  await openAndSave(devices.ipad, () => area('Area 1'));
  at('2026-09-08T08:30:00.000Z');
  cardFails(devices.phone);
  await openAndSave(devices.phone, () => ({ notes: note }));
  expect(await cardsSay(devices.phone)).toEqual(['Changed on this phone: Note. Changed on another device: Area.']);
  return devices;
}
/** Keep Phone in Settings, then the uploads the app runs after it. */
async function keepPhone(phone: RigDevice) {
  await chooseInSettings(phone, (await conflictsOf(phone)).find(conflict => conflict.entity === 'project_update')!.id, 'keep_local');
  await backgroundUpload(phone);
  await waitingUpdateSync(phone);
}
/** The phone's analysis of its own photo finishes while its card waits: the App's own handling. */
async function lateResultArrives(phone: RigDevice) {
  on(phone);
  const saved = theUpdate(phone)!;
  const withResult = { ...saved, photos: saved.photos.map((photo: { id: string }) => ({ ...photo,
    photoIntelligence: { status: 'complete', summary: 'Slab poured', analyzedAt: new Date().toISOString(), completedAt: new Date().toISOString() } })) } as RigUpdate;
  updatesSetter(phone)(phone.updates.map(update => update.id === UPDATE_ID ? withResult : update));
  await phone.m.sync.queueProjectUpdatePhotoAnalysis(withResult as never, 'p0', saved);
}

describe('Review N2 L7: Keep Phone does not come back as a new question about his own write', () => {
  it('he saved twice more while the card waited, a late photo result in between: Keep Phone ends with his latest copy and no second card', async () => {
    const { phone, ipad } = await cardWaits();
    at('2026-09-08T09:00:00.000Z');
    setOnline(phone, false);
    cardFails(phone);
    await openAndSave(phone, () => area('Area 7'));
    await lateResultArrives(phone);
    at('2026-09-08T09:30:00.000Z');
    setOnline(phone, true);
    cardFails(phone);
    await openAndSave(phone, () => TASK);
    expect(await conflictsOf(phone)).toHaveLength(1); // nothing automatic sent it
    at('2026-09-08T10:00:00.000Z');
    await keepPhone(phone);
    await refresh(ipad);

    expect(await cardsSay(phone)).toEqual([]);
    expect([shows(cloudUpdate()), shows(theUpdate(phone)), shows(theUpdate(ipad))]).toEqual(Array(3).fill({ notes: PHONE_NOTE, area: 'Area 7', task: 'task-9' }));
    expect([theUpdate(phone)!.status, await queueOf(phone)]).toEqual(['sent', []]);
  });

  it.each([
    ['he had typed a note', PHONE_NOTE],
    ['he had cleared the note: a part his choice leaves empty', ''],
  ] as const)('a refresh put the cloud\'s copy on the card while it waited, and he edited that (%s): Keep Phone ends with that edit and no second card', async (_label, note) => {
    const { phone, ipad } = await cardWaits(note);
    at('2026-09-08T09:00:00.000Z');
    await refresh(phone);
    expect(shows(theUpdate(phone))).toEqual({ notes: 'Pour', area: 'Area 1', task: '' }); // the iPad's copy, as the refresh shows it
    cardFails(phone);
    await openAndSave(phone, () => TASK);
    expect(await conflictsOf(phone)).toHaveLength(1);
    at('2026-09-08T10:00:00.000Z');
    await keepPhone(phone);
    await refresh(ipad);

    expect(await cardsSay(phone)).toEqual([]);
    expect([shows(cloudUpdate()), shows(theUpdate(phone)), shows(theUpdate(ipad))]).toEqual(Array(3).fill({ notes: 'Pour', area: 'Area 1', task: 'task-9' }));
    expect([theUpdate(phone)!.status, await queueOf(phone)]).toEqual(['sent', []]);
  });

  it('the same after a relaunch between his choice and the later edit going up', async () => {
    const { phone } = await cardWaits();
    at('2026-09-08T09:00:00.000Z');
    await refresh(phone);
    cardFails(phone);
    await openAndSave(phone, () => TASK);
    at('2026-09-08T10:00:00.000Z');
    // Keep Phone's own copy lands; the signal drops before the later edit goes up, and the app is closed.
    await chooseInSettingsThenOffline(phone);
    expect(shows(cloudUpdate())).toEqual({ notes: PHONE_NOTE, area: 'Area 0', task: '' });
    expect(await queueOf(phone)).toHaveLength(1);
    relaunchModules(phone);
    setOnline(phone, true);
    await startup(phone);
    await waitingUpdateSync(phone);

    expect(await cardsSay(phone)).toEqual([]);
    expect(shows(cloudUpdate())).toEqual({ notes: 'Pour', area: 'Area 1', task: 'task-9' });
    expect(await queueOf(phone)).toEqual([]);
  });

  it('Keep Phone whose own write lands with its answer lost says it was not resolved; Keep Phone again ends with his latest copy and no second card', async () => {
    const { phone, ipad } = await cardWaits();
    at('2026-09-08T09:00:00.000Z');
    await refresh(phone);
    cardFails(phone);
    await openAndSave(phone, () => TASK);
    at('2026-09-08T10:00:00.000Z');
    rig.mockCloud.lostAnswers = 1; // weak signal at the choice: its write lands, the answer does not come back
    const conflict = (await conflictsOf(phone)).find(item => item.entity === 'project_update')!;
    await expect(chooseInSettings(phone, conflict.id, 'keep_local')).rejects.toThrow(); // Settings: "Conflict not resolved"
    expect(shows(cloudUpdate())).toEqual({ notes: PHONE_NOTE, area: 'Area 0', task: '' }); // his copy is in the cloud all the same
    expect(await conflictsOf(phone)).toHaveLength(1);
    at('2026-09-08T10:05:00.000Z');
    await keepPhone(phone); // found in the cloud this time (the cloud receipt)
    await refresh(ipad);

    expect(await cardsSay(phone)).toEqual([]);
    expect([shows(cloudUpdate()), shows(theUpdate(phone)), shows(theUpdate(ipad))]).toEqual(Array(3).fill({ notes: 'Pour', area: 'Area 1', task: 'task-9' }));
    expect([theUpdate(phone)!.status, await queueOf(phone)]).toEqual(['sent', []]);
  });

  it('a change the iPad makes after his choice, before the later edit goes up, is asked about, and the card names that change alone', async () => {
    const { phone, ipad } = await cardWaits();
    at('2026-09-08T09:00:00.000Z');
    await refresh(phone);
    cardFails(phone);
    await openAndSave(phone, () => TASK);
    at('2026-09-08T10:00:00.000Z');
    await chooseInSettingsThenOffline(phone); // his choice is in the cloud: his note, Area 0; the later edit still waits
    await refresh(ipad);
    at('2026-09-08T11:00:00.000Z');
    cardFails(ipad);
    await openAndSave(ipad, () => ({ notes: IPAD_NOTE }));
    at('2026-09-08T12:00:00.000Z');
    setOnline(phone, true);
    await waitingUpdateSync(phone);

    // Not "Note, Area": the area the cloud holds is the one his own choice wrote.
    expect(await cardsSay(phone)).toEqual(['Changed on this phone: Task. Changed on another device: Note.']);
    expect(shows(cloudUpdate())).toEqual({ notes: IPAD_NOTE, area: 'Area 0', task: '' });
  });

  it('a change the iPad makes after his choice is still asked about of an edit begun after it', async () => {
    const { phone, ipad } = await cardWaits();
    at('2026-09-08T10:00:00.000Z');
    await keepPhone(phone); // the cloud: his note, Area 0
    expect(shows(cloudUpdate())).toEqual({ notes: PHONE_NOTE, area: 'Area 0', task: '' });
    await refresh(ipad);
    at('2026-09-08T11:00:00.000Z');
    cardFails(ipad);
    await openAndSave(ipad, () => area('Area 2'));
    await refresh(phone); // the phone hears Area 2
    at('2026-09-08T12:00:00.000Z');
    cardFails(ipad);
    await openAndSave(ipad, () => area('Area 0')); // and the iPad puts it back: the very value his choice wrote
    at('2026-09-08T13:00:00.000Z');
    cardFails(phone);
    await openAndSave(phone, () => ({ notes: IPAD_NOTE })); // an edit begun after his choice, from the copy showing Area 2

    expect(await cardsSay(phone)).toEqual(['Changed on this phone: Note. Changed on another device: Area.']);
    expect(shows(cloudUpdate())).toEqual({ notes: PHONE_NOTE, area: 'Area 0', task: '' });
  });

  it.each([
    ['its copy took in a late photo result of the phone\'s, so it was written', true],
    ['its copy was the cloud\'s as it stood, so it was found there', false],
  ] as const)('Keep Cloud is not such a write (%s): a draft opened before it and saved after it is asked about, and the iPad\'s copy stays', async (_label, lateResult) => {
    const { phone } = await cardWaits();
    at('2026-09-08T09:00:00.000Z');
    cardFails(phone);
    await openOnly(phone); // the draft starts from the card showing his own note
    if (lateResult) {
      setOnline(phone, false);
      await lateResultArrives(phone);
      setOnline(phone, true);
    }
    at('2026-09-08T10:00:00.000Z');
    await chooseInSettings(phone, (await conflictsOf(phone)).find(conflict => conflict.entity === 'project_update')!.id, 'keep_cloud');
    expect(shows(theUpdate(phone))).toEqual({ notes: 'Pour', area: 'Area 1', task: '' });
    if (lateResult) expect(cloudUpdate()!.photos[0].photoIntelligence).toMatchObject({ summary: 'Slab poured' });
    at('2026-09-08T11:00:00.000Z');
    await saveOpened(phone, () => TASK); // the note he chose to drop is still in this draft

    expect(await cardsSay(phone)).toEqual(['Changed on this phone: Task. Changed on another device: Note, Area.']);
    expect(shows(cloudUpdate())).toEqual({ notes: 'Pour', area: 'Area 1', task: '' });
  });
});

/** Keep Phone in Settings with the signal lost as soon as its own copy has landed: the later edit stays queued. */
async function chooseInSettingsThenOffline(phone: RigDevice) {
  const landed = rig.mockCloud.writes.length;
  const writes = rig.mockCloud.writes;
  const push = writes.push.bind(writes);
  writes.push = (...entries: string[]) => {
    const length = push(...entries);
    if (writes.length > landed) setOnline(phone, false);
    return length;
  };
  try {
    await chooseInSettings(phone, (await conflictsOf(phone)).find(conflict => conflict.entity === 'project_update')!.id, 'keep_local');
  } finally {
    writes.push = push;
  }
}
