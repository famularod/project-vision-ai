/**
 * Review N2, found explaining the reviewer's seed 298 (Low, older than owner answer Q28; 5 Oct 2026): a card still
 * reading "Waiting to Sync" after its record had already gone up was sent again whole, over a later edit made on
 * the other device, with no card.
 *
 * In the reviewer's sequence the rig itself kept the card waiting (a photo it added was not in the App's stored
 * form, so Sync Now never matched the card to the cloud's copy). The app reaches the same state by itself: the
 * record's own write fails with nothing landed (the signal drops), the upload retry lands it later, and that pass
 * does not tell the card, which goes on reading "Waiting to Sync". The waiting-update sync then finds nothing queued
 * for the card and stages it again with no copy to start from, stamped now; if the other device edited the update
 * in between and this device has not heard, the whole copy goes over that edit.
 *
 * The same when the record's write lands with its answer lost: the upload retry finds it in the cloud (the cloud
 * receipt) and takes the queue record off, and the card goes on waiting.
 *
 * The copy this device put in the cloud, or found there, is now remembered as the copy its card starts from, as a
 * Sent card's is, so the copy staged again is weighed (owner answer Q28): the other device's edit stays. It has its
 * own remembered entry: an update he had opened again and not saved does not displace it.
 *
 * On the two-device rig of the Q28 test (tests/fixtures/field-update-two-device-rig.ts). Synthetic data.
 */
import { loadFieldUpdateTwoDeviceRig, type RigDevice, type RigUpdate } from '../fixtures/field-update-two-device-rig';

const rig = loadFieldUpdateTwoDeviceRig({ require, jest, dirname: __dirname });
const {
  IPAD_NOTE, UPDATE_ID, at, backgroundUpload, cardFails, cloudUpdate, conflictsOf, fullSync, mockCloud, mockStores, openAndSave,
  openOnly, queueOf, refresh, relaunchModules, setOnline, start, theUpdate, updatesSetter, waitingUpdateSync,
} = rig;

const AREA_B = { selectedAreaId: 'area-b', selectedAreaName: 'Area B' };
const shows = (update: RigUpdate | undefined) => update && { notes: update.notes, area: update.selectedAreaName };
const updateWrites = () => mockCloud.writes.filter(write => write.endsWith(`:update:${UPDATE_ID}`)).length;

/** The signal drops after the cloud's copy is read and before this device's own write: nothing lands. */
async function withItsWriteFailing(device: RigDevice, run: () => Promise<void>) {
  const updates = mockCloud.updates;
  const read = updates.get.bind(updates);
  updates.get = key => {
    const row = read(key);
    setOnline(device, false);
    return row;
  };
  try {
    await run();
  } finally {
    updates.get = read;
    setOnline(device, true);
  }
}

const HOW_IT_WAS_SENT = [
  ['its write failed with nothing landed, and the upload retry landed it', 'landed by the retry'],
  ['its write landed with the answer lost, and the upload retry found it in the cloud', 'found by the receipt'],
] as const;
type HowSent = typeof HOW_IT_WAS_SENT[number][1];

/** The iPad's note is in the cloud, sent by a pass that is not the card's own sync, and its card still reads waiting. */
async function sentWithoutTellingTheCard(how: HowSent = 'landed by the retry') {
  const devices = await start();
  at('2026-09-08T08:00:00.000Z');
  cardFails(devices.ipad);
  if (how === 'landed by the retry') {
    await withItsWriteFailing(devices.ipad, () => openAndSave(devices.ipad, () => ({ notes: IPAD_NOTE })));
    expect(shows(cloudUpdate())).toEqual({ notes: 'Pour', area: 'Area 0' });
  } else {
    mockCloud.lostAnswers = 1; // weak signal: the write lands, its answer does not come back
    await openAndSave(devices.ipad, () => ({ notes: IPAD_NOTE }));
    expect(shows(cloudUpdate())).toEqual({ notes: IPAD_NOTE, area: 'Area 0' });
  }
  expect(await queueOf(devices.ipad)).toHaveLength(1);
  at('2026-09-08T08:10:00.000Z');
  await backgroundUpload(devices.ipad); // the pending-changes pass, not the card's own sync
  expect([shows(cloudUpdate()), await queueOf(devices.ipad)]).toEqual([{ notes: IPAD_NOTE, area: 'Area 0' }, []]);
  expect(theUpdate(devices.ipad)!.status).not.toBe('sent'); // nothing told the card
  return devices;
}
/** The phone hears the iPad's note and changes the area; the iPad does not hear that. */
async function phoneChangesTheArea(phone: RigDevice) {
  await refresh(phone);
  at('2026-09-08T08:30:00.000Z');
  cardFails(phone);
  await openAndSave(phone, () => AREA_B);
  expect(shows(cloudUpdate())).toEqual({ notes: IPAD_NOTE, area: 'Area B' });
}
/** What this device remembers of the update, by the kind of entry (the copy he opened, a choice, the copy in the cloud). */
function remembered(device: RigDevice): string[] {
  const stored = JSON.parse(mockStores.get(device.name)!.get('projectVisionAI.fieldUpdateEditBases.v1') ?? '{}') as Record<string, Record<string, unknown>>;
  return Object.values(stored).flatMap(entries => Object.keys(entries)).map(key => key.replace(UPDATE_ID, 'update')).sort();
}

describe('Review N2 (seed 298): a card still waiting after its record went up is not sent again over the other device\'s edit', () => {
  it.each(HOW_IT_WAS_SENT)('%s; the phone changes the area meanwhile: the iPad\'s waiting-update sync leaves it, with no card', async (_label, how) => {
    const { phone, ipad } = await sentWithoutTellingTheCard(how);
    await phoneChangesTheArea(phone);
    at('2026-09-08T09:00:00.000Z');
    const writes = updateWrites();
    await waitingUpdateSync(ipad); // the iPad has not heard the area
    await refresh(ipad);

    expect(updateWrites()).toBe(writes);
    expect([shows(cloudUpdate()), shows(theUpdate(ipad))]).toEqual(Array(2).fill({ notes: IPAD_NOTE, area: 'Area B' }));
    expect([await conflictsOf(ipad), await queueOf(ipad), theUpdate(ipad)!.status]).toEqual([[], [], 'sent']);
  });

  it.each(HOW_IT_WAS_SENT)('%s; he had opened the update again and not saved it: the phone\'s area still stays', async (_label, how) => {
    const { phone, ipad } = await sentWithoutTellingTheCard(how);
    // He opens the card (it read "Sync failed" for that moment) and backs out: the copy he opened is remembered.
    const status = theUpdate(ipad)!.status;
    cardFails(ipad);
    await openOnly(ipad);
    ipad.draftRef.current = { id: '', status: 'draft' };
    updatesSetter(ipad)(ipad.updates.map(update => update.id === UPDATE_ID ? { ...update, status } : update));
    expect(remembered(ipad)).toEqual(['update', 'update\nin cloud']);
    await phoneChangesTheArea(phone);
    at('2026-09-08T09:00:00.000Z');
    const writes = updateWrites();
    await waitingUpdateSync(ipad);
    await refresh(ipad);

    expect(updateWrites()).toBe(writes);
    expect([shows(cloudUpdate()), shows(theUpdate(ipad))]).toEqual(Array(2).fill({ notes: IPAD_NOTE, area: 'Area B' }));
    expect([await conflictsOf(ipad), await queueOf(ipad), theUpdate(ipad)!.status]).toEqual([[], [], 'sent']);
  });

  it('the same after the app was closed and opened again with no signal, so nothing refreshed the card', async () => {
    const { phone, ipad } = await sentWithoutTellingTheCard('found by the receipt');
    await phoneChangesTheArea(phone);
    setOnline(ipad, false);
    relaunchModules(ipad); // nothing held in memory of what this device put in the cloud
    at('2026-09-08T09:00:00.000Z');
    setOnline(ipad, true);
    const writes = updateWrites();
    await waitingUpdateSync(ipad);

    expect(updateWrites()).toBe(writes);
    expect(shows(cloudUpdate())).toEqual({ notes: IPAD_NOTE, area: 'Area B' });
    expect([await conflictsOf(ipad), await queueOf(ipad)]).toEqual([[], []]);
  });

  it('a Sent card\'s copy put in the cloud is not remembered so: only a card that still owes its sync needs it', async () => {
    const { phone } = await start();
    expect(remembered(phone)).toEqual(['update\nin cloud']); // its first send, by a card that was waiting
    mockStores.get('phone')!.delete('projectVisionAI.fieldUpdateEditBases.v1');
    at('2026-09-08T08:00:00.000Z');
    // The Sent card holds a photo result whose own patch was lost: Sync Now sends the card.
    updatesSetter(phone)(phone.updates.map(update => update.id === UPDATE_ID ? { ...update, photos: update.photos.map((photo: { id: string }) => ({ ...photo,
      photoIntelligence: { status: 'analysis_complete', summary: 'Slab poured', updatedAt: new Date().toISOString() } })) } : update));
    relaunchModules(phone);
    await fullSync(phone);

    expect(cloudUpdate()!.photos[0].photoIntelligence).toMatchObject({ summary: 'Slab poured' });
    expect([theUpdate(phone)!.status, remembered(phone)]).toEqual(['sent', []]);
  });

  it('with nothing changed meanwhile, the waiting-update sync sends nothing more and the card reads sent', async () => {
    const { ipad } = await sentWithoutTellingTheCard();
    at('2026-09-08T09:00:00.000Z');
    const writes = updateWrites();
    await waitingUpdateSync(ipad);

    expect(updateWrites()).toBe(writes);
    expect([shows(cloudUpdate()), await conflictsOf(ipad), await queueOf(ipad), theUpdate(ipad)!.status])
      .toEqual([{ notes: IPAD_NOTE, area: 'Area 0' }, [], [], 'sent']);
  });

  it('a waiting card that holds work never sent (its queue record lost) still goes up, as before', async () => {
    const { ipad } = await sentWithoutTellingTheCard();
    at('2026-09-08T09:00:00.000Z');
    // He saved again and the queue write was lost: the card holds the new area, and nothing is queued for it.
    updatesSetter(ipad)(ipad.updates.map(update => update.id === UPDATE_ID ? { ...update, ...AREA_B, status: 'queued' } : update));
    await waitingUpdateSync(ipad);

    expect(shows(cloudUpdate())).toEqual({ notes: IPAD_NOTE, area: 'Area B' });
    expect([await conflictsOf(ipad), await queueOf(ipad), theUpdate(ipad)!.status]).toEqual([[], [], 'sent']);
  });
});
