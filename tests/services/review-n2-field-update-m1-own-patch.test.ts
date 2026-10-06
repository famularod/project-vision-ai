/**
 * Review N2 M1 (Medium, a gap in 79a5ae1, owner answer Q28; 5 Oct 2026): a field update changed on the iPad was
 * silently overwritten by the phone's edit, with no card, when the phone's own late photo result went up in between.
 *
 * The iPad changed the update's note and it went up; the phone had not refreshed. The phone's analysis of its own
 * photo finished and went up as the normal late-result patch (onto the cloud's copy, the iPad's note with it), while
 * the phone's card still showed the old note. Then David changed the area on the phone and saved: "the cloud is
 * newer only by this device's own patches" skipped the Q28 weighing, the phone's whole copy went up, and the iPad's
 * note was back to the old wording on every device. A document's finished upload in between did the same.
 *
 * This device's own patches no longer excuse another device's change: the edit is always weighed against the copy
 * it started from. What the skip was for stays: a change this device's own patch made is not another device's.
 *
 * On the two-device rig of the Q28 test (tests/fixtures/field-update-two-device-rig.ts). Synthetic data.
 */
import { fieldUpdateConflictChanges } from '../../services/FieldUpdateEditBase';
import { loadFieldUpdateTwoDeviceRig, type RigDevice, type RigUpdate } from '../fixtures/field-update-two-device-rig';

const rig = loadFieldUpdateTwoDeviceRig({ require, jest, dirname: __dirname });
const {
  A, IPAD_NOTE, MOCK_PROJECT_ID, UPDATE_ID, at, backgroundUpload, cardFails, cloudUpdate, conflictsOf, on, openAndSave, openOnly, queueOf, refresh, saveOpened, start, theUpdate, updatesSetter,
} = rig;

const AREA_B = { selectedAreaId: 'area-b', selectedAreaName: 'Area B' };
const shows = (update: RigUpdate | undefined) => update && {
  notes: update.notes, area: update.selectedAreaName, documents: (update.documents || []).map((document: { id: string }) => document.id),
};
const cardsSay = async (device: RigDevice) => (await conflictsOf(device)).filter(conflict => conflict.entity === 'project_update')
  .map(conflict => fieldUpdateConflictChanges(conflict.localPayload, conflict.remotePayload));
const document = (id: string, uploaded: boolean) => {
  const now = new Date().toISOString();
  return A.normalizeProjectDocument({
    id, projectId: MOCK_PROJECT_ID, updateId: UPDATE_ID, areaId: 'area-0', name: `${id}.pdf`, mimeType: 'application/pdf', createdAt: now,
    ...(uploaded ? { status: 'uploaded', storagePath: `documents/${id}.pdf`, uploadedAt: now } : { status: 'uploading' }),
  });
};

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
  expect(cloudUpdate()!.photos[0].photoIntelligence).toMatchObject({ summary: 'Slab poured' });
}

/** A change to one document of the phone's Sent card goes up as the App sends it: a patch on the cloud's copy. */
async function documentChangeGoesUp(phone: RigDevice, documentId: string, change: (card: RigUpdate) => RigUpdate) {
  on(phone);
  const changed = change(theUpdate(phone)!);
  updatesSetter(phone)(phone.updates.map(update => update.id === UPDATE_ID ? changed : update));
  await phone.m.sync.queueProjectUpdateDocumentChange(changed as never, documentId);
  await backgroundUpload(phone);
}

describe('Review N2 M1: this device\'s own late result or document change does not excuse another device\'s change', () => {
  it.each([
    ['its own late photo result went up in between', true],
    ['control: nothing went up in between', false],
  ] as const)('the iPad changes the note; the phone, which has not heard, changes the area (%s): Review Conflicts, the note stays', async (_label, lateResult) => {
    const { phone, ipad } = await start();
    at('2026-09-08T08:00:00.000Z');
    cardFails(ipad);
    await openAndSave(ipad, () => ({ notes: IPAD_NOTE }));
    at('2026-09-08T08:30:00.000Z');
    if (lateResult) await lateResultGoesUp(phone);
    expect(shows(theUpdate(phone))).toMatchObject({ notes: 'Pour', area: 'Area 0' }); // the phone has not heard the note
    at('2026-09-08T09:00:00.000Z');
    cardFails(phone);
    await openAndSave(phone, () => AREA_B);
    await refresh(ipad);

    expect(shows(cloudUpdate())).toMatchObject({ notes: IPAD_NOTE, area: 'Area 0' });
    expect(shows(theUpdate(ipad))).toMatchObject({ notes: IPAD_NOTE, area: 'Area 0' });
    expect(await cardsSay(phone)).toEqual(['Changed on this phone: Area. Changed on another device: Note.']);
    expect(shows(theUpdate(phone))).toMatchObject({ notes: 'Pour', area: 'Area B' }); // his own work waits on its card
    expect(theUpdate(phone)!.status).not.toBe('sent');
    if (lateResult) expect(cloudUpdate()!.photos[0].photoIntelligence).toMatchObject({ summary: 'Slab poured' });
  });

  it('a document\'s finished upload in between does not excuse it either', async () => {
    const { phone, ipad } = await start();
    at('2026-09-08T07:00:00.000Z');
    cardFails(phone);
    await openAndSave(phone, () => ({ documents: [document('d1', false)] }));
    await refresh(ipad);
    at('2026-09-08T08:00:00.000Z');
    cardFails(ipad);
    await openAndSave(ipad, () => ({ notes: IPAD_NOTE }));
    at('2026-09-08T08:30:00.000Z');
    await documentChangeGoesUp(phone, 'd1', card => ({ ...card, documents: card.documents.map((attached: { id: string }) => (
      { ...attached, status: 'uploaded', storagePath: 'documents/d1.pdf', uploadedAt: new Date().toISOString() })) }));
    expect(cloudUpdate()!.documents[0]).toMatchObject({ id: 'd1', status: 'uploaded' });
    at('2026-09-08T09:00:00.000Z');
    cardFails(phone);
    await openAndSave(phone, () => AREA_B);

    expect(shows(cloudUpdate())).toMatchObject({ notes: IPAD_NOTE, area: 'Area 0' });
    expect(await cardsSay(phone)).toEqual(['Changed on this phone: Area. Changed on another device: Note.']);
  });

  it('with no other device involved, an edit after its own late result goes up as before, with no card', async () => {
    const { phone, ipad } = await start();
    at('2026-09-08T08:30:00.000Z');
    await lateResultGoesUp(phone);
    at('2026-09-08T09:00:00.000Z');
    cardFails(phone);
    await openAndSave(phone, () => AREA_B);
    await refresh(ipad);

    expect([shows(cloudUpdate()), shows(theUpdate(ipad))]).toEqual(Array(2).fill({ notes: 'Pour', area: 'Area B', documents: [] }));
    expect(cloudUpdate()!.photos[0].photoIntelligence).toMatchObject({ summary: 'Slab poured' });
    expect(theUpdate(phone)!.status).toBe('sent');
    expect([await cardsSay(phone), await queueOf(phone)]).toEqual([[], []]);
  });

  it('a document this phone took off while the update was open is its own change: adding another goes up with no card', async () => {
    const { phone, ipad } = await start();
    at('2026-09-08T07:00:00.000Z');
    cardFails(phone);
    await openAndSave(phone, () => ({ documents: [document('d1', true)] }));
    await refresh(ipad);
    at('2026-09-08T09:00:00.000Z');
    cardFails(phone);
    await openOnly(phone); // the draft starts from the copy that lists d1
    // He deletes d1 (the App takes it off the draft and off the Sent card, and the removal goes up as a patch).
    phone.draftRef.current = { ...phone.draftRef.current, documents: [] };
    await documentChangeGoesUp(phone, 'd1', card => ({ ...card, documents: [] }));
    expect(shows(cloudUpdate())).toMatchObject({ documents: [] });
    await saveOpened(phone, () => ({ documents: [document('d2', true)] }));
    await refresh(ipad);

    expect([shows(cloudUpdate()), shows(theUpdate(ipad))]).toEqual(Array(2).fill({ notes: 'Pour', area: 'Area 0', documents: ['d2'] }));
    expect([await cardsSay(phone), await queueOf(phone)]).toEqual([[], []]);
  });

  it('the same removal does not hide the iPad\'s own change of the documents: that still goes to Review Conflicts', async () => {
    const { phone, ipad } = await start();
    at('2026-09-08T07:00:00.000Z');
    cardFails(phone);
    await openAndSave(phone, () => ({ documents: [document('d1', true)] }));
    await refresh(ipad);
    at('2026-09-08T09:00:00.000Z');
    cardFails(phone);
    await openOnly(phone);
    at('2026-09-08T09:10:00.000Z');
    cardFails(ipad);
    await openAndSave(ipad, card => ({ documents: [...card.documents, document('d3', true)] })); // the phone does not hear it
    at('2026-09-08T09:20:00.000Z');
    phone.draftRef.current = { ...phone.draftRef.current, documents: [] };
    await documentChangeGoesUp(phone, 'd1', card => ({ ...card, documents: [] }));
    expect(shows(cloudUpdate())).toMatchObject({ documents: ['d3'] });
    await saveOpened(phone, () => ({ documents: [document('d2', true)] }));

    expect(shows(cloudUpdate())).toMatchObject({ documents: ['d3'] });
    expect(await cardsSay(phone)).toEqual(['Changed on this phone: Documents. Changed on another device: Documents.']);
  });
});
