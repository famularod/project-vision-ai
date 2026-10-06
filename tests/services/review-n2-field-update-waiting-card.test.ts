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
 * The copy that lands is now kept as the copy its card starts from, as a Sent card's is, so the copy staged again
 * is weighed (owner answer Q28): the other device's edit stays.
 *
 * Not covered here, and written up in the fixer's notes: the same when the record's write lands with its answer
 * lost, which is settled by the cloud receipt, outside the code this fix was allowed to touch.
 *
 * On the two-device rig of the Q28 test (tests/fixtures/field-update-two-device-rig.ts). Synthetic data.
 */
import { loadFieldUpdateTwoDeviceRig, type RigDevice, type RigUpdate } from '../fixtures/field-update-two-device-rig';

const rig = loadFieldUpdateTwoDeviceRig({ require, jest, dirname: __dirname });
const {
  IPAD_NOTE, UPDATE_ID, at, backgroundUpload, cardFails, cloudUpdate, conflictsOf, mockCloud, openAndSave, queueOf, refresh, setOnline,
  start, theUpdate, updatesSetter, waitingUpdateSync,
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

/** The iPad's note: its own sync fails at the write, the upload retry lands it, and its card still reads waiting. */
async function landedByTheUploadRetry() {
  const devices = await start();
  at('2026-09-08T08:00:00.000Z');
  cardFails(devices.ipad);
  await withItsWriteFailing(devices.ipad, () => openAndSave(devices.ipad, () => ({ notes: IPAD_NOTE })));
  expect([shows(cloudUpdate()), (await queueOf(devices.ipad)).length]).toEqual([{ notes: 'Pour', area: 'Area 0' }, 1]);
  at('2026-09-08T08:10:00.000Z');
  await backgroundUpload(devices.ipad); // the pending-changes pass, not the card's own sync
  expect([shows(cloudUpdate()), await queueOf(devices.ipad)]).toEqual([{ notes: IPAD_NOTE, area: 'Area 0' }, []]);
  expect(theUpdate(devices.ipad)!.status).not.toBe('sent'); // nothing told the card
  return devices;
}

describe('Review N2 (seed 298): a card still waiting after its record went up is not sent again over the other device\'s edit', () => {
  it('the phone changes the area meanwhile: the iPad\'s waiting-update sync leaves it, with no card', async () => {
    const { phone, ipad } = await landedByTheUploadRetry();
    await refresh(phone);
    at('2026-09-08T08:30:00.000Z');
    cardFails(phone);
    await openAndSave(phone, () => AREA_B);
    expect(shows(cloudUpdate())).toEqual({ notes: IPAD_NOTE, area: 'Area B' });
    at('2026-09-08T09:00:00.000Z');
    const writes = updateWrites();
    await waitingUpdateSync(ipad); // the iPad has not heard the area
    await refresh(ipad);

    expect(updateWrites()).toBe(writes);
    expect([shows(cloudUpdate()), shows(theUpdate(ipad))]).toEqual(Array(2).fill({ notes: IPAD_NOTE, area: 'Area B' }));
    expect([await conflictsOf(ipad), await queueOf(ipad), theUpdate(ipad)!.status]).toEqual([[], [], 'sent']);
  });

  it('with nothing changed meanwhile, the waiting-update sync sends nothing more and the card reads sent', async () => {
    const { ipad } = await landedByTheUploadRetry();
    at('2026-09-08T09:00:00.000Z');
    const writes = updateWrites();
    await waitingUpdateSync(ipad);

    expect(updateWrites()).toBe(writes);
    expect([shows(cloudUpdate()), await conflictsOf(ipad), await queueOf(ipad), theUpdate(ipad)!.status])
      .toEqual([{ notes: IPAD_NOTE, area: 'Area 0' }, [], [], 'sent']);
  });

  it('a waiting card that holds work never sent (its queue record lost) still goes up, as before', async () => {
    const { ipad } = await landedByTheUploadRetry();
    at('2026-09-08T09:00:00.000Z');
    // He saved again and the queue write was lost: the card holds the new area, and nothing is queued for it.
    updatesSetter(ipad)(ipad.updates.map(update => update.id === UPDATE_ID ? { ...update, ...AREA_B, status: 'queued' } : update));
    await waitingUpdateSync(ipad);

    expect(shows(cloudUpdate())).toEqual({ notes: IPAD_NOTE, area: 'Area B' });
    expect([await conflictsOf(ipad), await queueOf(ipad), theUpdate(ipad)!.status]).toEqual([[], [], 'sent']);
  });
});
