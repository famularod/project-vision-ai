/**
 * Review N2 pass 4, the observation (6 Oct 2026; owner answer Q28): an update reopened and saved while its conflict
 * waits, then Keep Phone. In 8 of the reviewer's 400 field-update sequences the part David had just chosen to keep
 * was replaced at once by a stale value, with no second card.
 *
 * What happened in those sequences. The phone's copy K (his area) waited in Review Conflicts. A refresh put the
 * cloud's copy C on the card, Sent underneath (the Low finding of the same pass). The generator then forced that
 * card open, changed the note and saved: a copy made of C with his new note, which still had the cloud's area.
 * Keep Phone sends K, then the edit saved while the card waited. To that later edit, what his choice had just
 * written counts as his own write (review N2 L7), so it went up whole with no card, and its stale area went over
 * the area Keep Phone had kept.
 *
 * Whether the app can get there. An update opens for editing only when its card reads failed ("Sync failed", or
 * "Needs Review" over it); a Sent card opens read-only (App.tsx openSavedUpdate). The one whole-copy save in the app
 * is the save of that open draft. So the loss needs a card that holds the cloud's copy, while his own copy waits,
 * and that reads failed. Before the fix the refresh put the cloud's copy there, but as Sent; and nothing turns a
 * Sent card to failed: every Retry is offered only on a waiting or failed card, and a retry reached any other way
 * is left for review with the card as it was. The generator's forced open is the only way in.
 *
 * With the Low fixed the first step is gone as well: the waiting card keeps his copy, so what he reopens is his
 * copy, his later edit holds everything Keep Phone keeps, and Keep Phone ends with it. These tests try each way in:
 * the reviewer's sequence after a refresh, a relaunch and a realtime echo, forced open exactly as the generator
 * forces it; the app's own way of opening the card; and a card an earlier build had already turned to the cloud's
 * copy, against every step that could make it editable.
 *
 * On the two-device rig of the Q28 test (tests/fixtures/field-update-two-device-rig.ts). Synthetic data.
 */
import { fieldUpdateConflictChanges } from '../../services/FieldUpdateEditBase';
import { fieldUpdateEcho, loadFieldUpdateTwoDeviceRig, type RigDevice, type RigUpdate } from '../fixtures/field-update-two-device-rig';

const rig = loadFieldUpdateTwoDeviceRig({ require, jest, dirname: __dirname });
const {
  A, IPAD_NOTE, UPDATE_ID, appRetry, at, backgroundUpload, cardFails, chooseInSettings, cloudUpdate, conflictsOf, fullSync, on, openAndSave, openOnly,
  queueOf, refresh, relaunchModules, setOnline, start, startup, theUpdate, updatesSetter, waitingUpdateSync,
} = rig;

const shows = (update: RigUpdate | undefined) => update && { notes: update.notes, area: update.selectedAreaName };
const cards = async (device: RigDevice) => (await conflictsOf(device)).filter(conflict => conflict.entity === 'project_update');
const cardsSay = async (device: RigDevice) => (await cards(device)).map(conflict => fieldUpdateConflictChanges(conflict.localPayload, conflict.remotePayload));
const area = (name: string) => ({ selectedAreaId: name.toLowerCase().replace(' ', '-'), selectedAreaName: name });
const echo = (device: RigDevice) => fieldUpdateEcho(rig, device);
const HIS = { notes: 'Pour', area: 'Area B' };
const IPADS = { notes: IPAD_NOTE, area: 'Area 0' };

/** The iPad changes the note; the phone, offline, changes the area and saves; back online its edit goes to Review Conflicts. */
async function cardWaits() {
  const devices = await start();
  at('2026-09-08T08:00:00.000Z');
  setOnline(devices.phone, false);
  cardFails(devices.ipad);
  await openAndSave(devices.ipad, () => ({ notes: IPAD_NOTE }));
  at('2026-09-08T08:30:00.000Z');
  cardFails(devices.phone);
  await openAndSave(devices.phone, () => area('Area B'));
  at('2026-09-08T09:00:00.000Z');
  setOnline(devices.phone, true);
  await waitingUpdateSync(devices.phone);
  expect(await cardsSay(devices.phone)).toEqual(['Changed on this phone: Area. Changed on another device: Note.']);
  at('2026-09-08T09:30:00.000Z');
  return devices;
}
/** His choice in Settings, then the uploads the app runs after it. */
async function choose(device: RigDevice, choice: 'keep_local' | 'keep_cloud') {
  await chooseInSettings(device, (await cards(device))[0].id, choice);
  await backgroundUpload(device);
  await waitingUpdateSync(device);
}
/** David taps the card: the App's own openSavedUpdate. Whether it opened for editing (it became the draft). */
async function opensForEditing(device: RigDevice): Promise<boolean> {
  await openOnly(device).catch(() => undefined); // the rig's own check fails when it did not open
  const opened = device.draftRef.current.id === UPDATE_ID;
  device.draftRef.current = { id: '', status: 'draft' };
  return opened;
}
const WHILE_IT_WAITS = [
  ['a refresh', async (phone: RigDevice) => { await refresh(phone); }],
  ['the waiting-update sync, the upload pass and a refresh', async (phone: RigDevice) => {
    await waitingUpdateSync(phone);
    await backgroundUpload(phone);
    await refresh(phone);
  }],
  ['a relaunch', async (phone: RigDevice) => { relaunchModules(phone); await startup(phone); }],
  ['a realtime echo of the iPad\'s save', async (phone: RigDevice) => { await echo(phone); }],
  ['Sync Now', async (phone: RigDevice) => { await fullSync(phone); }],
] as const;

describe('Review N2 pass 4: an update reopened and saved while its conflict waits', () => {
  it.each(WHILE_IT_WAITS)('the reviewer\'s sequence, forced open as its generator forces it, after %s: Keep Phone ends with the area he chose and his new note', async (_label, happens) => {
    const { phone, ipad } = await cardWaits();
    await happens(phone);
    cardFails(phone); // the generator's step; the waiting card reads failed already
    await openAndSave(phone, () => ({ notes: 'Second pour' }));
    // Held for his choice: nothing went up, and the one card still waits.
    expect([shows(cloudUpdate()), (await cards(phone)).length]).toEqual([IPADS, 1]);
    at('2026-09-08T10:00:00.000Z');
    await choose(phone, 'keep_local');
    await refresh(ipad);

    const kept = { notes: 'Second pour', area: 'Area B' }; // not "Area 0", the cloud's area the refresh used to put on the card
    expect([shows(cloudUpdate()), shows(theUpdate(phone)), shows(theUpdate(ipad))]).toEqual(Array(3).fill(kept));
    expect([await cardsSay(phone), await queueOf(phone), theUpdate(phone)!.status]).toEqual([[], [], 'sent']);
  });

  it.each(WHILE_IT_WAITS)('after %s the app itself opens the waiting card for editing, and what opens is his copy', async (_label, happens) => {
    const { phone } = await cardWaits();
    await happens(phone);
    await openOnly(phone); // no forcing: App.tsx's own openSavedUpdate, on the card as it reads

    expect(shows(phone.draftRef.current)).toEqual(HIS);
  });

  it('the same sequence ending with Keep Cloud: the iPad\'s copy everywhere, and nothing of the phone\'s is sent', async () => {
    const { phone, ipad } = await cardWaits();
    await refresh(phone);
    await openAndSave(phone, () => ({ notes: 'Second pour' }));
    const writes = rig.mockCloud.writes.length;
    at('2026-09-08T10:00:00.000Z');
    await choose(phone, 'keep_cloud');
    await refresh(ipad);

    expect([shows(cloudUpdate()), shows(theUpdate(phone)), shows(theUpdate(ipad))]).toEqual(Array(3).fill(IPADS));
    expect(rig.mockCloud.writes.slice(writes).filter(write => write.startsWith('phone:update:'))).toEqual([]);
    expect([await cardsSay(phone), await queueOf(phone), theUpdate(phone)!.status]).toEqual([[], [], 'sent']);
  });

  it('a card an earlier build\'s refresh had already turned to the cloud\'s copy never opens for editing, whatever runs, and Keep Phone still ends with his copy', async () => {
    const { phone, ipad } = await cardWaits();
    // As Build 229's refresh left it: the cloud's copy on the card, Sent underneath, his copy waiting in Settings.
    on(phone);
    updatesSetter(phone)(phone.updates.map(update => update.id === UPDATE_ID
      ? { ...A.normalizeStoredUpdateRecord(cloudUpdate()), status: 'sent' } as RigUpdate : update));
    const steps: ReadonlyArray<readonly [string, () => Promise<unknown>]> = [
      ['as it was left', async () => undefined],
      ['a refresh', () => refresh(phone)],
      ['a realtime echo', () => echo(phone)],
      ['the waiting-update sync', () => waitingUpdateSync(phone)],
      ['the upload pass', () => backgroundUpload(phone)],
      ['a retry reached without its button', () => { on(phone); return appRetry(phone)(theUpdate(phone)!, { automatic: true }); }],
      ['a relaunch', async () => { relaunchModules(phone); await startup(phone); }],
      ['Sync Now', () => fullSync(phone)],
    ];
    for (const [label, step] of steps) {
      await step();
      // Still the cloud's copy, still Sent, so it opens read-only; nothing went up and nothing is queued.
      expect([label, shows(theUpdate(phone)), theUpdate(phone)!.status, await opensForEditing(phone)]).toEqual([label, IPADS, 'sent', false]);
      expect([label, shows(cloudUpdate()), await queueOf(phone), (await cards(phone)).length]).toEqual([label, IPADS, [], 1]);
    }
    at('2026-09-08T10:00:00.000Z');
    await choose(phone, 'keep_local');
    await refresh(ipad);

    expect([shows(cloudUpdate()), shows(theUpdate(phone)), shows(theUpdate(ipad))]).toEqual(Array(3).fill(HIS));
    expect([await cardsSay(phone), await queueOf(phone), theUpdate(phone)!.status]).toEqual([[], [], 'sent']);
  });
});
