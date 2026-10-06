/**
 * Review N2 pass 4 (Low; already in Build 229, the refresh's rule unchanged since 80f5eb6; owner answer Q28, 6 Oct
 * 2026): a field update waiting in Review Conflicts lost David's copy from its card at the next refresh, realtime
 * echo or relaunch. The card showed the iPad's copy and was Sent underneath, as if his change did not exist, while
 * his edit still waited for his choice in Settings.
 *
 * The cause. A conflict takes the update's record off the queue. The refresh kept a card over the cloud's copy only
 * while a copy of it was queued, or its own upload had just landed; the realtime applier only while its exact copy
 * was queued. Neither looked at Review Conflicts.
 *
 * Now, while a copy of the update waits in Review Conflicts, its card stays as it is: his copy, "Needs Review" (the
 * card's status stays failed, which is what lets him open it and gives it its Retry), through a refresh, a realtime
 * echo and a relaunch, until he chooses. Once he has chosen, or the conflict is closed, the card follows the cloud
 * again.
 *
 * On the two-device rig of the Q28 test (tests/fixtures/field-update-two-device-rig.ts): App.tsx's own refresh and
 * the app's own realtime applier, wired for field updates as App.tsx wires it. Synthetic data.
 */
import { fieldUpdateConflictChanges } from '../../services/FieldUpdateEditBase';
import { fieldUpdateEcho, loadFieldUpdateTwoDeviceRig, type RigDevice } from '../fixtures/field-update-two-device-rig';

const rig = loadFieldUpdateTwoDeviceRig({ require, jest, dirname: __dirname });
const {
  IPAD_NOTE, UPDATE_ID, at, backgroundUpload, cardFails, chooseInSettings, cloudUpdate, conflictsOf, fullSync, on, openAndSave, queueOf, refresh,
  relaunchModules, setOnline, start, startup, theUpdate, waitingUpdateSync,
} = rig;

const card = (device: RigDevice) => {
  const update = theUpdate(device)!;
  return { notes: update.notes, area: update.selectedAreaName, status: update.status };
};
const inCloud = () => ({ notes: cloudUpdate()!.notes, area: cloudUpdate()!.selectedAreaName });
const cards = async (device: RigDevice) => (await conflictsOf(device)).filter(conflict => conflict.entity === 'project_update');
const area = (name: string) => ({ selectedAreaId: name.toLowerCase().replace(' ', '-'), selectedAreaName: name });
/** His copy as the card holds it while it waits: the note as it was, his area, and the status that reads "Needs Review". */
const HIS = { notes: 'Pour', area: 'Area B', status: 'failed' };
const IPADS = { notes: IPAD_NOTE, area: 'Area 0' };

/**
 * The iPad changes the note; the phone, offline, changes the area and saves; back online its edit goes to Review
 * Conflicts. `foundBy`: the card's own waiting-update sync, which leaves the card failed; or the upload pass (the
 * card's sync had checked its photos and was cut off before the record went up), which does not tell the card: it
 * goes on reading "Waiting to Sync" underneath.
 */
async function cardWaits(foundBy: 'waiting-update sync' | 'upload pass' = 'waiting-update sync') {
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
  if (foundBy === 'upload pass') {
    on(devices.phone);
    await devices.phone.m.sync.stageProjectUpdateForSync(theUpdate(devices.phone) as never);
    await backgroundUpload(devices.phone);
  } else {
    await waitingUpdateSync(devices.phone);
  }
  expect((await cards(devices.phone)).map(conflict => fieldUpdateConflictChanges(conflict.localPayload, conflict.remotePayload)))
    .toEqual(['Changed on this phone: Area. Changed on another device: Note.']);
  expect([card(devices.phone), inCloud(), await queueOf(devices.phone)])
    .toEqual([{ ...HIS, status: foundBy === 'upload pass' ? 'queued' : 'failed' }, IPADS, []]);
  at('2026-09-08T09:30:00.000Z');
  return devices;
}

/** A realtime event for the update's row as the cloud holds it now: the app's own applier, wired as App.tsx wires it. */
const echo = (device: RigDevice) => fieldUpdateEcho(rig, device);
const keep = async (device: RigDevice, choice: 'keep_local' | 'keep_cloud') => {
  await chooseInSettings(device, (await cards(device))[0].id, choice);
  await backgroundUpload(device);
  await waitingUpdateSync(device);
};

describe('Review N2 pass 4: a field update waiting in Review Conflicts keeps his copy on its card until he chooses', () => {
  it.each([
    ['a refresh', async (phone: RigDevice) => { await refresh(phone); }],
    ['the waiting-update sync, the upload pass, then a refresh', async (phone: RigDevice) => {
      await waitingUpdateSync(phone);
      await backgroundUpload(phone);
      await refresh(phone);
    }],
    ['two refreshes', async (phone: RigDevice) => { await refresh(phone); await refresh(phone); }],
    ['Sync Now', async (phone: RigDevice) => { await fullSync(phone); }],
    ['a relaunch', async (phone: RigDevice) => { relaunchModules(phone); await startup(phone); }],
    ['a relaunch, with a refresh the first thing that runs', async (phone: RigDevice) => { relaunchModules(phone); await refresh(phone, false); }],
    ['a realtime echo of the iPad\'s save', async (phone: RigDevice) => { await echo(phone); }],
    ['a relaunch, with a realtime echo the first thing that runs', async (phone: RigDevice) => { relaunchModules(phone); await echo(phone); }],
    ['a refresh, an echo, a relaunch and Sync Now, one after another', async (phone: RigDevice) => {
      await refresh(phone);
      await echo(phone);
      relaunchModules(phone);
      await startup(phone);
      await fullSync(phone);
    }],
  ] as const)('%s leaves his copy on the card, still "Needs Review"', async (_label, happens) => {
    const { phone } = await cardWaits();
    await happens(phone);

    expect(card(phone)).toEqual(HIS);
    // Nothing was sent, nothing is queued, and the choice still waits.
    expect([inCloud(), await queueOf(phone), (await cards(phone)).length]).toEqual([IPADS, [], 1]);
  });

  it.each([
    ['a refresh', async (phone: RigDevice) => { await refresh(phone); }],
    ['a relaunch', async (phone: RigDevice) => { relaunchModules(phone); await startup(phone); }],
    ['a realtime echo of the iPad\'s save', async (phone: RigDevice) => { await echo(phone); }],
    ['the waiting-update sync, then a refresh', async (phone: RigDevice) => { await waitingUpdateSync(phone); await refresh(phone); }],
  ] as const)('found by the upload pass, the card still "Waiting to Sync" underneath: %s leaves his copy on it', async (_label, happens) => {
    const { phone } = await cardWaits('upload pass');
    await happens(phone);

    expect(card(phone)).toEqual({ ...HIS, status: 'queued' });
    expect([inCloud(), await queueOf(phone), (await cards(phone)).length]).toEqual([IPADS, [], 1]);
  });

  it('the iPad changes the update again while the card waits: a refresh and an echo still leave his copy on the card', async () => {
    const { phone, ipad } = await cardWaits();
    cardFails(ipad);
    await openAndSave(ipad, () => ({ notes: 'iPad, again' }));
    at('2026-09-08T10:00:00.000Z');
    await echo(phone);
    expect(card(phone)).toEqual(HIS);
    await refresh(phone);

    expect(card(phone)).toEqual(HIS);
    expect([inCloud(), (await cards(phone)).length]).toEqual([{ notes: 'iPad, again', area: 'Area 0' }, 1]);
  });

  it('what the refresh is told: nothing until the queue is read after a relaunch, then the update until he chooses', async () => {
    const { phone } = await cardWaits();
    const held = () => phone.m.sync.projectUpdateUploadedSince(UPDATE_ID, Number.POSITIVE_INFINITY);
    expect(held()).toBe(true);
    relaunchModules(phone);
    on(phone);
    expect(held()).toBe(false); // a relaunch holds nothing in memory
    await phone.m.sync.getOfflineQueue(); // the refresh's own read, just before it decides
    expect(held()).toBe(true);
    expect(await phone.m.sync.fieldUpdateWaitsInReviewConflicts(UPDATE_ID)).toBe(true);
    expect(phone.m.sync.projectUpdateUploadedSince('another-update', Number.POSITIVE_INFINITY)).toBe(false);

    await keep(phone, 'keep_cloud');
    expect(held()).toBe(false);
    expect(await phone.m.sync.fieldUpdateWaitsInReviewConflicts(UPDATE_ID)).toBe(false);
  });

  it('Keep Phone after a refresh and a relaunch: his copy is the cloud\'s, on both devices, and the card reads Sent', async () => {
    const { phone, ipad } = await cardWaits();
    await refresh(phone);
    relaunchModules(phone);
    await startup(phone);
    at('2026-09-08T10:00:00.000Z');
    await keep(phone, 'keep_local');
    await refresh(phone);
    await refresh(ipad);

    expect([card(phone), card(ipad)]).toEqual(Array(2).fill({ notes: 'Pour', area: 'Area B', status: 'sent' }));
    expect([inCloud(), await queueOf(phone), await cards(phone)]).toEqual([{ notes: 'Pour', area: 'Area B' }, [], []]);
  });

  it('Keep Cloud after a refresh: the card takes the iPad\'s copy, Sent, and follows the cloud again from then on', async () => {
    const { phone, ipad } = await cardWaits();
    await refresh(phone);
    at('2026-09-08T10:00:00.000Z');
    await keep(phone, 'keep_cloud');
    expect([card(phone), inCloud(), await queueOf(phone), await cards(phone)]).toEqual([{ ...IPADS, status: 'sent' }, IPADS, [], []]);

    // No longer held: the iPad's next edit reaches the card by a refresh, and the one after it by an echo.
    await refresh(ipad);
    cardFails(ipad);
    await openAndSave(ipad, () => area('Area 3'));
    await refresh(phone);
    expect(card(phone)).toEqual({ notes: IPAD_NOTE, area: 'Area 3', status: 'sent' });
    cardFails(ipad);
    await openAndSave(ipad, () => area('Area 4'));
    await echo(phone);
    expect(card(phone)).toEqual({ notes: IPAD_NOTE, area: 'Area 4', status: 'sent' });
  });

  it('a card with no conflict is not held: the iPad\'s edit reaches a Sent card by a refresh and by an echo, as before', async () => {
    const { phone, ipad } = await start();
    at('2026-09-08T08:00:00.000Z');
    cardFails(ipad);
    await openAndSave(ipad, () => ({ notes: IPAD_NOTE }));
    await echo(phone);
    expect(card(phone)).toEqual({ notes: IPAD_NOTE, area: 'Area 0', status: 'sent' });
    cardFails(ipad);
    await openAndSave(ipad, () => area('Area 5'));
    await refresh(phone);
    expect(card(phone)).toEqual({ notes: IPAD_NOTE, area: 'Area 5', status: 'sent' });
  });
});
