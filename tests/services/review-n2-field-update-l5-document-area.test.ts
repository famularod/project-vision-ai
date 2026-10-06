/**
 * Review N2 L5 (Low, caused by 79a5ae1 on older normalising code; 5 Oct 2026): a card "Changed on another device:
 * Documents" when only one device was ever involved.
 *
 * A document attached before the update's area was chosen keeps no area of its own (App.tsx attaches it with the
 * draft's area at that moment). The update is sent so. When the app reads a saved update back (a relaunch, a
 * refresh), it files such a document under the update's area (normalizeUpdate), so the device's copy then differed
 * from the cloud's in its documents, and David's next edit of the update raised the card and waited for his choice.
 *
 * The two copies are now compared as the app itself reads them back: a document with no area or update of its own
 * is under the update's. A document another device really changed is still asked about.
 *
 * On the two-device rig of the Q28 test (tests/fixtures/field-update-two-device-rig.ts). Synthetic data.
 */
import { fieldUpdateConflictChanges, fieldUpdateEditAgainstCloud, fieldUpdateEditBaseOf, fieldUpdateMeaningParts } from '../../services/FieldUpdateEditBase';
import { loadFieldUpdateTwoDeviceRig, type RigDevice } from '../fixtures/field-update-two-device-rig';

const rig = loadFieldUpdateTwoDeviceRig({ require, jest, dirname: __dirname });
const {
  A, MOCK_PROJECT_ID, UPDATE_ID, at, cardFails, cloudUpdate, conflictsOf, openAndSave, queueOf, refresh, relaunchModules, start, startup,
  theUpdate, updatesSetter,
} = rig;

const cardsSay = async (device: RigDevice) => (await conflictsOf(device)).filter(conflict => conflict.entity === 'project_update')
  .map(conflict => fieldUpdateConflictChanges(conflict.localPayload, conflict.remotePayload));
/** A document as the App attaches one to a draft: under the draft's area at that moment. */
const attached = (id: string, areaId: string | null) => {
  const now = new Date().toISOString();
  return A.normalizeProjectDocument({
    id, projectId: MOCK_PROJECT_ID, updateId: UPDATE_ID, areaId, name: `${id}.pdf`, mimeType: 'application/pdf',
    status: 'uploaded', storagePath: `documents/${id}.pdf`, uploadedAt: now, createdAt: now,
  });
};
/** The app is closed and opened again: its saved updates are read back through the App's own normalizeStoredUpdateRecord. */
async function relaunch(device: RigDevice) {
  updatesSetter(device)(device.updates.map(update => A.normalizeStoredUpdateRecord(JSON.parse(JSON.stringify(update)))));
  relaunchModules(device);
  await startup(device);
}

describe('Review N2 L5: a document the app files under the update\'s area when it reads the update back is not another device\'s change', () => {
  /** The phone's update, sent with a document attached before its area was chosen: the document has no area of its own. */
  async function sentWithEarlyDocument() {
    const devices = await start();
    at('2026-09-08T08:00:00.000Z');
    cardFails(devices.phone);
    await openAndSave(devices.phone, () => ({ documents: [attached('d-early', null)] }));
    expect(cloudUpdate()).toMatchObject({ selectedAreaId: 'area-0', documents: [expect.objectContaining({ id: 'd-early', areaId: null })] });
    return devices;
  }

  it.each(['a relaunch', 'a refresh'] as const)('one device only: after %s, his next edit goes up with no card', async how => {
    const { phone } = await sentWithEarlyDocument();
    if (how === 'a relaunch') await relaunch(phone); else await refresh(phone);
    expect(theUpdate(phone)!.documents[0]).toMatchObject({ id: 'd-early', areaId: 'area-0' }); // read back under the update's area
    at('2026-09-08T09:00:00.000Z');
    cardFails(phone);
    await openAndSave(phone, () => ({ notes: 'Second pour Thursday' }));

    expect(cloudUpdate()).toMatchObject({ notes: 'Second pour Thursday' });
    expect(theUpdate(phone)!.status).toBe('sent');
    expect([await cardsSay(phone), await queueOf(phone)]).toEqual([[], []]);
  });

  it('the iPad, which only read the update, edits the note: it goes up with no card', async () => {
    const { phone, ipad } = await sentWithEarlyDocument();
    await refresh(ipad);
    at('2026-09-08T09:00:00.000Z');
    cardFails(ipad);
    await openAndSave(ipad, () => ({ notes: 'Second pour Thursday' }));
    await refresh(phone);

    expect([cloudUpdate()!.notes, theUpdate(phone)!.notes]).toEqual(Array(2).fill('Second pour Thursday'));
    expect([await cardsSay(ipad), await queueOf(ipad)]).toEqual([[], []]);
  });

  it('a document the iPad really added meanwhile is still asked about', async () => {
    const { phone, ipad } = await sentWithEarlyDocument();
    await relaunch(phone);
    await refresh(ipad);
    at('2026-09-08T08:30:00.000Z');
    cardFails(ipad);
    await openAndSave(ipad, card => ({ documents: [...card.documents, attached('d-ipad', 'area-0')] })); // the phone does not hear it
    at('2026-09-08T09:00:00.000Z');
    cardFails(phone);
    await openAndSave(phone, () => ({ notes: 'Second pour Thursday' }));

    expect(cloudUpdate()).toMatchObject({ notes: 'Pour', documents: [expect.objectContaining({ id: 'd-early' }), expect.objectContaining({ id: 'd-ipad' })] });
    expect(await cardsSay(phone)).toEqual(['Changed on this phone: Note. Changed on another device: Documents.']);
  });

  it('the documents are compared as the app reads them back: under the update\'s area and update when they name none', () => {
    const sent = { id: 'u1', notes: 'Pour', selectedAreaId: 'area-0', documents: [{ id: 'd1', name: 'Ticket.pdf', areaId: null }] };
    const readBack = { ...sent, documents: [{ id: 'd1', name: 'Ticket.pdf', areaId: 'area-0', updateId: 'u1' }] };
    expect(fieldUpdateMeaningParts(readBack).documents).toBe(fieldUpdateMeaningParts(sent).documents);
    expect(fieldUpdateEditAgainstCloud(fieldUpdateEditBaseOf(readBack, '2026-09-08T09:00:00.000Z'), { ...readBack, notes: 'Second pour' }, sent)).toBe('as-before');
    // A document filed elsewhere, renamed, or taken off is a change.
    const part = (documents: unknown[]) => fieldUpdateMeaningParts({ ...sent, documents }).documents;
    expect(part([{ id: 'd1', name: 'Ticket.pdf', areaId: 'area-9' }])).not.toBe(part(sent.documents));
    expect(part([{ id: 'd1', name: 'Delivery ticket.pdf', areaId: null }])).not.toBe(part(sent.documents));
    expect(part([])).not.toBe(part(sent.documents));
    // With no area on the update either, the document stays as it is.
    expect(fieldUpdateMeaningParts({ id: 'u1', documents: [{ id: 'd1', updateId: 'u1' }] }).documents)
      .toBe(fieldUpdateMeaningParts({ id: 'u1', documents: [{ id: 'd1', areaId: null }] }).documents);
  });
});
