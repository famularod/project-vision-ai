/**
 * Review N2 L6 (Low, an older rule, in Build 229; 5 Oct 2026): the older check, "Remote update changed after the
 * local pending change", ran before owner answer Q28's weighing and raised cards Q28 says should not exist: a card
 * whose two copies read the same in every part, a card when the other device had only added a late photo result
 * (Keep Cloud there dropped David's edit), and a card when he had changed nothing on this device that the cloud
 * did not already hold.
 *
 * An edit that keeps the copy it started from is now judged by Q28's weighing alone. The older check stays for an
 * edit with no such copy (one queued by Build 229), where it is all there is, and for a copy David chose to send.
 *
 * On the two-device rig of the Q28 test (tests/fixtures/field-update-two-device-rig.ts). Synthetic data.
 */
import { loadFieldUpdateTwoDeviceRig, type RigDevice, type RigUpdate } from '../fixtures/field-update-two-device-rig';

const rig = loadFieldUpdateTwoDeviceRig({ require, jest, dirname: __dirname });
const {
  IPAD_NOTE, PHONE_NOTE, UPDATE_ID, asBuild229, at, backgroundUpload, cardFails, cloudUpdate, conflictsOf, mockCloud, on, openAndSave, queueOf,
  refresh, setOnline, start, theUpdate, updatesSetter, waitingUpdateSync,
} = rig;

const AREA_B = { selectedAreaId: 'area-b', selectedAreaName: 'Area B' };
const shows = (update: RigUpdate | undefined) => update && { notes: update.notes, area: update.selectedAreaName };
const cards = async (device: RigDevice) => (await conflictsOf(device)).filter(conflict => conflict.entity === 'project_update').map(conflict => conflict.reason);
const resultInCloud = () => cloudUpdate()!.photos[0].photoIntelligence?.summary ?? null;
const cloudStamp = () => mockCloud.updates.get(UPDATE_ID)!.updatedAt;

/** The phone's analysis of its own photo finishes late, on a Sent card: the App's own handling, then the queue upload. */
async function lateResultGoesUp(phone: RigDevice) {
  on(phone);
  const saved = theUpdate(phone)!;
  const withResult = { ...saved, photos: saved.photos.map((photo: { id: string }) => photo.id === 'p0'
    ? { ...photo, photoIntelligence: { status: 'complete', summary: 'Slab poured', analyzedAt: new Date().toISOString(), completedAt: new Date().toISOString() } }
    : photo) } as RigUpdate;
  updatesSetter(phone)(phone.updates.map(update => update.id === UPDATE_ID ? withResult : update));
  await phone.m.sync.queueProjectUpdatePhotoAnalysis(withResult as never, 'p0', saved);
  await backgroundUpload(phone);
  expect(resultInCloud()).toBe('Slab poured');
}

describe('Review N2 L6: an edit that keeps the copy it started from is judged by Q28\'s weighing only', () => {
  it('the iPad\'s save landed with its answer lost, then the phone\'s late result touched the cloud\'s copy: the retry raises no card of two equal copies', async () => {
    const { phone, ipad } = await start();
    at('2026-09-08T08:00:00.000Z');
    cardFails(ipad);
    mockCloud.lostAnswers = 1; // weak signal: the write lands, its answer does not come back
    await openAndSave(ipad, () => ({ notes: IPAD_NOTE }));
    expect(shows(cloudUpdate())).toEqual({ notes: IPAD_NOTE, area: 'Area 0' });
    expect(await queueOf(ipad)).toHaveLength(1);
    at('2026-09-08T08:30:00.000Z');
    await lateResultGoesUp(phone); // the phone has not refreshed: only its result goes onto the cloud's copy
    at('2026-09-08T09:00:00.000Z');
    await backgroundUpload(ipad);
    await waitingUpdateSync(ipad);
    await refresh(ipad);
    await refresh(phone);

    expect(await cards(ipad)).toEqual([]);
    expect([shows(cloudUpdate()), shows(theUpdate(ipad)), shows(theUpdate(phone))]).toEqual(Array(3).fill({ notes: IPAD_NOTE, area: 'Area 0' }));
    expect(resultInCloud()).toBe('Slab poured'); // the phone's result is not sent over
    expect([theUpdate(ipad)!.status, await queueOf(ipad)]).toEqual(['sent', []]);
  });

  it('the other device only added a late photo result since: his edit goes up with no card, and the result stays', async () => {
    const { phone, ipad } = await start();
    at('2026-09-08T08:00:00.000Z');
    setOnline(ipad, false);
    cardFails(ipad);
    await openAndSave(ipad, () => ({ notes: IPAD_NOTE })); // saved with no signal
    at('2026-09-08T08:30:00.000Z');
    await lateResultGoesUp(phone);
    const stampOfResult = cloudStamp();
    at('2026-09-08T09:00:00.000Z');
    setOnline(ipad, true);
    await waitingUpdateSync(ipad);
    await refresh(phone);

    expect(await cards(ipad)).toEqual([]);
    expect([shows(cloudUpdate()), shows(theUpdate(phone))]).toEqual(Array(2).fill({ notes: IPAD_NOTE, area: 'Area 0' }));
    expect(resultInCloud()).toBe('Slab poured');
    expect(Date.parse(cloudStamp())).toBeGreaterThanOrEqual(Date.parse(stampOfResult)); // the cloud's copy does not read older than it was
    expect([theUpdate(ipad)!.status, await queueOf(ipad)]).toEqual(['sent', []]);
  });

  it('his save landed with its answer lost, then the phone changed another part: nothing of his is left to send, and no card', async () => {
    const { phone, ipad } = await start();
    at('2026-09-08T08:00:00.000Z');
    cardFails(ipad);
    mockCloud.lostAnswers = 1;
    await openAndSave(ipad, () => ({ notes: IPAD_NOTE }));
    await refresh(phone); // the phone hears the note
    at('2026-09-08T08:30:00.000Z');
    cardFails(phone);
    await openAndSave(phone, () => AREA_B);
    expect(shows(cloudUpdate())).toEqual({ notes: IPAD_NOTE, area: 'Area B' });
    at('2026-09-08T09:00:00.000Z');
    await backgroundUpload(ipad);
    await waitingUpdateSync(ipad);
    await refresh(ipad);

    expect(await cards(ipad)).toEqual([]);
    expect([shows(cloudUpdate()), shows(theUpdate(ipad))]).toEqual(Array(2).fill({ notes: IPAD_NOTE, area: 'Area B' }));
    expect([theUpdate(ipad)!.status, await queueOf(ipad)]).toEqual(['sent', []]);
  });

  it('the phone\'s own late result, taken into a copy the cloud\'s newer copy then settles, still reaches the cloud', async () => {
    const { phone, ipad } = await start();
    at('2026-09-08T08:00:00.000Z');
    cardFails(phone);
    mockCloud.lostAnswers = 1;
    await openAndSave(phone, () => ({ notes: PHONE_NOTE })); // lands, unanswered: the phone's copy still waits
    await refresh(ipad);
    at('2026-09-08T08:10:00.000Z');
    setOnline(phone, false);
    on(phone);
    const saved = theUpdate(phone)!;
    const withResult = { ...saved, photos: saved.photos.map((photo: { id: string }) => ({ ...photo,
      photoIntelligence: { status: 'complete', summary: 'Slab poured', analyzedAt: new Date().toISOString(), completedAt: new Date().toISOString() } })) } as RigUpdate;
    updatesSetter(phone)(phone.updates.map(update => update.id === UPDATE_ID ? withResult : update));
    await phone.m.sync.queueProjectUpdatePhotoAnalysis(withResult as never, 'p0', saved); // into the waiting copy
    at('2026-09-08T08:30:00.000Z');
    cardFails(ipad);
    await openAndSave(ipad, () => AREA_B);
    expect(resultInCloud()).toBeNull();
    at('2026-09-08T09:00:00.000Z');
    setOnline(phone, true);
    await waitingUpdateSync(phone);
    await refresh(phone);
    await refresh(ipad);

    expect(await cards(phone)).toEqual([]);
    expect([shows(cloudUpdate()), shows(theUpdate(phone)), shows(theUpdate(ipad))]).toEqual(Array(3).fill({ notes: PHONE_NOTE, area: 'Area B' }));
    expect([resultInCloud(), theUpdate(ipad)!.photos[0].photoIntelligence?.summary]).toEqual(Array(2).fill('Slab poured'));
    expect([theUpdate(phone)!.status, await queueOf(phone)]).toEqual(['sent', []]);
  });

  it('the same part changed on both since is still asked about, by Q28\'s rule', async () => {
    const { phone, ipad } = await start();
    at('2026-09-08T08:00:00.000Z');
    setOnline(ipad, false);
    cardFails(ipad);
    await openAndSave(ipad, () => ({ notes: IPAD_NOTE }));
    at('2026-09-08T08:30:00.000Z');
    cardFails(phone);
    await openAndSave(phone, () => ({ notes: 'Crew short Tuesday' }));
    at('2026-09-08T09:00:00.000Z');
    setOnline(ipad, true);
    await waitingUpdateSync(ipad);

    expect(await cards(ipad)).toEqual(['This update changed on this device and on another device since this edit began.']);
    expect(shows(cloudUpdate())).toEqual({ notes: 'Crew short Tuesday', area: 'Area 0' });
  });

  it('an edit queued by Build 229 (no copy it started from) keeps the older check: a newer cloud copy is asked about', async () => {
    const { phone, ipad } = await start();
    at('2026-09-08T08:00:00.000Z');
    setOnline(ipad, false);
    cardFails(ipad);
    await openAndSave(ipad, () => ({ notes: IPAD_NOTE }));
    asBuild229(ipad);
    at('2026-09-08T08:30:00.000Z');
    await lateResultGoesUp(phone);
    at('2026-09-08T09:00:00.000Z');
    setOnline(ipad, true);
    await waitingUpdateSync(ipad);

    expect(await cards(ipad)).toEqual(['Remote update changed after the local pending change.']);
    expect(shows(cloudUpdate())).toEqual({ notes: 'Pour', area: 'Area 0' });
  });
});
