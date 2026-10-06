/**
 * Review N2, recorded in pass 2 as L9a (Low, older; 5 Oct 2026): another device's later whole-copy save took a late
 * photo result off the cloud's copy.
 *
 * A whole copy of a field update went up exactly as its device held it. Photo analysis is left out of the comparison
 * of the two copies (owner answer Q28), so nothing stopped it; a device that had not yet heard the other device's
 * late result sent its copy without it, and the result was then on one device only, or on none.
 *
 * Every whole copy now goes up with the cloud's photo results that sending it would take off
 * (withCloudPhotoAnalysisResults). The rules, each tested below:
 * - the cloud's result for a photo this copy has no result for is kept;
 * - a newer result is never replaced by an older one, either way round;
 * - a finished result stands over a failed run, whichever is later (the rule there already was);
 * - a photo he removed does not come back, and neither does its result;
 * - a photo being analysed again goes up with the cloud's finished result, as a sync attempt already sent the
 *   standing result and not "analyzing" (A4 pass 28 L1);
 * - what cannot be decided from the two copies is left as it was: two results that carry no time, and a result with
 *   no time against a photo being analysed again. This copy's goes up, as a whole copy's always did; except for an
 *   edit older than the cloud's copy, and a copy that is otherwise the cloud's own, where the cloud's stays, as
 *   review N2 L6 already had it.
 *
 * On the two-device rig of the Q28 test (tests/fixtures/field-update-two-device-rig.ts). Synthetic data.
 */
import { withCloudPhotoAnalysisResults } from '../../services/FieldUpdatePhotoAnalysisPatch';
import { loadFieldUpdateTwoDeviceRig, type RigDevice, type RigUpdate } from '../fixtures/field-update-two-device-rig';

const rig = loadFieldUpdateTwoDeviceRig({ require, jest, dirname: __dirname });
const {
  IPAD_NOTE, UPDATE_ID, asBuild229, at, backgroundUpload, cardFails, cloudUpdate, conflictsOf, fullSync, mockCloud, on, openAndSave,
  queueOf, refresh, relaunchModules, setOnline, start, theUpdate, updatesSetter, waitingUpdateSync,
} = rig;

type Result = { status: string; summary?: string; updatedAt?: string; userReviewedAt?: string } | null;
const finished = (summary: string, updatedAt?: string): Result => ({ status: 'analysis_complete', summary, ...(updatedAt ? { updatedAt } : {}) });
const failedRun = (updatedAt: string): Result => ({ status: 'analysis_failed_retry', summary: 'failed', updatedAt });
const ANALYZING: Result = { status: 'analyzing' };
const resultOf = (update: RigUpdate | undefined, photoId = 'p0') =>
  (update?.photos || []).find((photo: { id: string }) => photo.id === photoId)?.photoIntelligence ?? null;
const shows = (update: RigUpdate | undefined) => update && { notes: update.notes, result: resultOf(update)?.summary ?? resultOf(update)?.status ?? null };

/** The phone's analysis of its own photo finishes late, on a Sent card: the App's own handling, then the queue upload. */
async function phoneResultGoesUp(phone: RigDevice, result: Result) {
  on(phone);
  const saved = theUpdate(phone)!;
  const withResult = { ...saved, pieStatus: 'complete', pieSummary: result?.summary, pieCompletedAt: new Date().toISOString(),
    photos: saved.photos.map((photo: { id: string }) => photo.id === 'p0' ? { ...photo, photoIntelligence: result } : photo) } as RigUpdate;
  updatesSetter(phone)(phone.updates.map(update => update.id === UPDATE_ID ? withResult : update));
  await phone.m.sync.queueProjectUpdatePhotoAnalysis(withResult as never, 'p0', saved);
  await backgroundUpload(phone);
  expect(resultOf(cloudUpdate())).toEqual(result);
}
/** The iPad's card, as it stands, holds this for the photo (a result of its own, or a run under way). */
function ipadCardHolds(ipad: RigDevice, result: Result) {
  updatesSetter(ipad)(ipad.updates.map(update => update.id === UPDATE_ID
    ? { ...update, photos: update.photos.map((photo: { id: string }) => photo.id === 'p0' ? { ...photo, photoIntelligence: result } : photo) } : update));
}
/** The iPad, which has not heard the phone's result, changes the note and saves. */
async function ipadSavesItsNote(ipad: RigDevice) {
  cardFails(ipad);
  await openAndSave(ipad, () => ({ notes: IPAD_NOTE }));
  expect(await conflictsOf(ipad)).toEqual([]);
  expect(cloudUpdate()!.notes).toBe(IPAD_NOTE);
}

describe('Review N2 (L9a): a whole copy goes up with the cloud\'s photo results it would otherwise take off', () => {
  it('the iPad had not heard the phone\'s late result: its note goes up and the result stays, on the cloud and on both devices', async () => {
    const { phone, ipad } = await start();
    at('2026-09-08T08:00:00.000Z');
    await phoneResultGoesUp(phone, finished('Slab poured', '2026-09-08T08:00:00.000Z'));
    at('2026-09-08T09:00:00.000Z');
    await ipadSavesItsNote(ipad);
    await refresh(phone);
    await refresh(ipad);

    expect([shows(cloudUpdate()), shows(theUpdate(phone)), shows(theUpdate(ipad))]).toEqual(Array(3).fill({ notes: IPAD_NOTE, result: 'Slab poured' }));
    expect(cloudUpdate()).toMatchObject({ pieStatus: 'complete', pieSummary: 'Slab poured' }); // the update's own summary with it
  });

  it('the same for a copy with no remembered starting copy (an edit queued by Build 229)', async () => {
    const { phone, ipad } = await start();
    at('2026-09-08T08:00:00.000Z');
    await phoneResultGoesUp(phone, finished('Slab poured', '2026-09-08T08:00:00.000Z'));
    at('2026-09-08T09:00:00.000Z');
    setOnline(ipad, false);
    cardFails(ipad);
    await openAndSave(ipad, () => ({ notes: IPAD_NOTE }));
    asBuild229(ipad);
    setOnline(ipad, true);
    await waitingUpdateSync(ipad);

    expect(shows(cloudUpdate())).toEqual({ notes: IPAD_NOTE, result: 'Slab poured' });
    expect([await conflictsOf(ipad), await queueOf(ipad)]).toEqual([[], []]);
  });

  it('a copy that is the cloud\'s copy but for a result the cloud holds sends nothing more', async () => {
    const { phone, ipad } = await start();
    at('2026-09-08T08:00:00.000Z');
    cardFails(ipad);
    mockCloud.lostAnswers = 1; // weak signal: the iPad's note lands, its answer does not come back
    await openAndSave(ipad, () => ({ notes: IPAD_NOTE }));
    at('2026-09-08T08:30:00.000Z');
    await phoneResultGoesUp(phone, finished('Slab poured', '2026-09-08T08:30:00.000Z'));
    at('2026-09-08T09:00:00.000Z');
    const writes = mockCloud.writes.length;
    await waitingUpdateSync(ipad);

    expect(mockCloud.writes.length).toBe(writes);
    expect(shows(cloudUpdate())).toEqual({ notes: IPAD_NOTE, result: 'Slab poured' });
    expect([await conflictsOf(ipad), await queueOf(ipad), theUpdate(ipad)!.status]).toEqual([[], [], 'sent']);
  });

  it('a newer result is never replaced by an older one: the cloud\'s later result stays; this copy\'s later result goes up', async () => {
    const older = finished('First look', '2026-09-08T07:00:00.000Z');
    const newer = finished('Slab poured', '2026-09-08T08:00:00.000Z');
    const cloudsIsNewer = await start();
    at('2026-09-08T08:00:00.000Z');
    ipadCardHolds(cloudsIsNewer.ipad, older);
    await phoneResultGoesUp(cloudsIsNewer.phone, newer);
    at('2026-09-08T09:00:00.000Z');
    await ipadSavesItsNote(cloudsIsNewer.ipad);
    expect(shows(cloudUpdate())).toEqual({ notes: IPAD_NOTE, result: 'Slab poured' });

    const copysIsNewer = await start();
    at('2026-09-08T08:00:00.000Z');
    ipadCardHolds(copysIsNewer.ipad, newer);
    await phoneResultGoesUp(copysIsNewer.phone, older);
    at('2026-09-08T09:00:00.000Z');
    await ipadSavesItsNote(copysIsNewer.ipad);
    expect(shows(cloudUpdate())).toEqual({ notes: IPAD_NOTE, result: 'Slab poured' });
  });

  it('a photo he removed does not come back, and neither does its result', async () => {
    const { phone, ipad } = await start();
    at('2026-09-08T08:00:00.000Z');
    await phoneResultGoesUp(phone, finished('Slab poured', '2026-09-08T08:00:00.000Z'));
    at('2026-09-08T09:00:00.000Z');
    cardFails(ipad);
    await openAndSave(ipad, () => ({ photos: [] }));
    await refresh(phone);

    expect(await conflictsOf(ipad)).toEqual([]);
    expect([cloudUpdate()!.photos, theUpdate(phone)!.photos]).toEqual([[], []]);
  });

  it('a photo the iPad is analysing again goes up with the cloud\'s finished result, not "analyzing"; its card keeps "Analyzing"', async () => {
    const { phone, ipad } = await start();
    at('2026-09-08T08:00:00.000Z');
    await phoneResultGoesUp(phone, finished('Slab poured', '2026-09-08T08:00:00.000Z'));
    at('2026-09-08T09:00:00.000Z');
    ipadCardHolds(ipad, ANALYZING);
    await ipadSavesItsNote(ipad);

    expect(shows(cloudUpdate())).toEqual({ notes: IPAD_NOTE, result: 'Slab poured' });
    expect(resultOf(theUpdate(ipad))).toEqual(ANALYZING);
  });

  it('what cannot be decided is left as it was: of two results that carry no time, this copy\'s goes up', async () => {
    const { phone, ipad } = await start();
    at('2026-09-08T08:00:00.000Z');
    ipadCardHolds(ipad, finished('The iPad\'s own'));
    await phoneResultGoesUp(phone, finished('The phone\'s own'));
    at('2026-09-08T09:00:00.000Z');
    await ipadSavesItsNote(ipad);

    expect(shows(cloudUpdate())).toEqual({ notes: IPAD_NOTE, result: 'The iPad\'s own' });
  });

  it('and where review N2 L6 already kept the cloud\'s, it still does: an edit older than the cloud\'s copy, and a copy that is otherwise the cloud\'s own', async () => {
    const olderEdit = await start();
    at('2026-09-08T08:00:00.000Z');
    ipadCardHolds(olderEdit.ipad, finished('The iPad\'s own'));
    setOnline(olderEdit.ipad, false);
    cardFails(olderEdit.ipad);
    await openAndSave(olderEdit.ipad, () => ({ notes: IPAD_NOTE })); // saved with no signal
    at('2026-09-08T08:30:00.000Z');
    await phoneResultGoesUp(olderEdit.phone, finished('The phone\'s own')); // the cloud's copy is now stamped later
    at('2026-09-08T09:00:00.000Z');
    setOnline(olderEdit.ipad, true);
    await waitingUpdateSync(olderEdit.ipad);
    expect([shows(cloudUpdate()), await conflictsOf(olderEdit.ipad)]).toEqual([{ notes: IPAD_NOTE, result: 'The phone\'s own' }, []]);

    const sameCopy = await start();
    at('2026-09-08T08:00:00.000Z');
    ipadCardHolds(sameCopy.ipad, finished('The iPad\'s own'));
    await phoneResultGoesUp(sameCopy.phone, finished('The phone\'s own'));
    at('2026-09-08T09:00:00.000Z');
    relaunchModules(sameCopy.ipad);
    const writes = mockCloud.writes.length;
    await fullSync(sameCopy.ipad); // Sync Now finds the Sent card unlike the cloud's copy, in its photo result alone
    expect(mockCloud.writes.length).toBe(writes);
    expect(shows(cloudUpdate())).toEqual({ notes: 'Pour', result: 'The phone\'s own' });
  });

  it('the rules, one by one', () => {
    const copyWith = (result: Result | undefined, more: Record<string, unknown> = {}) => ({ id: 'u1', notes: 'Mine', pieStatus: 'not_started',
      photos: [{ id: 'p0', caption: 'mine', ...(result === undefined ? {} : { photoIntelligence: result }) }], ...more });
    const cloudWith = (result: Result | undefined, more: Record<string, unknown> = {}) => ({ id: 'u1', notes: 'Theirs', pieStatus: 'complete',
      pieSummary: 'Cloud summary', pieCompletedAt: '2026-09-08T08:00:00.000Z',
      photos: [{ id: 'p0', caption: 'theirs', ...(result === undefined ? {} : { photoIntelligence: result }) }], ...more });
    const sent = (copy: object, cloud: unknown) => withCloudPhotoAnalysisResults(copy, cloud) as ReturnType<typeof copyWith>;
    const early = '2026-09-08T07:00:00.000Z';
    const late = '2026-09-08T08:00:00.000Z';

    // No result here: the cloud's finished one is kept, timed or not, with the update's summary; nothing else of the cloud's.
    for (const mine of [undefined, null] as const) {
      for (const theirs of [finished('Slab poured', late), finished('Slab poured')]) {
        expect(sent(copyWith(mine), cloudWith(theirs))).toEqual({ ...copyWith(mine), pieStatus: 'complete', pieSummary: 'Cloud summary',
          pieStartedAt: null, pieCompletedAt: late, photos: [{ id: 'p0', caption: 'mine', photoIntelligence: theirs }] });
      }
    }
    // A run still under way in the cloud is no result to keep; nor is none.
    for (const theirs of [ANALYZING, null, undefined] as const) {
      const copy = copyWith(undefined);
      expect(sent(copy, cloudWith(theirs))).toBe(copy);
    }
    // Both hold one: the later stands, whichever side it is on.
    expect(sent(copyWith(finished('Mine', early)), cloudWith(finished('Theirs', late))).photos[0].photoIntelligence).toEqual(finished('Theirs', late));
    const mineLater = copyWith(finished('Mine', late));
    expect(sent(mineLater, cloudWith(finished('Theirs', early)))).toBe(mineLater);
    // A finished result stands over a failed run, whichever is later.
    expect(sent(copyWith(failedRun(late)), cloudWith(finished('Theirs', early))).photos[0].photoIntelligence).toEqual(finished('Theirs', early));
    const mineFinished = copyWith(finished('Mine', early));
    expect(sent(mineFinished, cloudWith(failedRun(late)))).toBe(mineFinished);
    // The same result: the copy he reviewed last stands.
    const reviewed = copyWith({ ...finished('Same', late)!, userReviewedAt: '2026-09-08T09:00:00.000Z' });
    expect(sent(reviewed, cloudWith(finished('Same', late)))).toBe(reviewed);
    // Analysing again: the cloud's finished, timed result goes up; with no time on it, it cannot be weighed, and "analyzing" goes up as before.
    expect(sent(copyWith(ANALYZING), cloudWith(finished('Theirs', late))).photos[0].photoIntelligence).toEqual(finished('Theirs', late));
    const analysing = copyWith(ANALYZING);
    expect(sent(analysing, cloudWith(finished('Theirs')))).toBe(analysing);
    // Two results with no time cannot be put in order: this copy's goes up, as before.
    const untimed = copyWith(finished('Mine'));
    expect(sent(untimed, cloudWith(finished('Theirs')))).toBe(untimed);
    // Where the caller says the cloud's stays in that case (review N2 L6's two): it does, and so over "analyzing";
    // what can be put in order is decided the same.
    const staysClouds = (copy: object, cloud: unknown) => withCloudPhotoAnalysisResults(copy, cloud, { unorderedStaysClouds: true }) as ReturnType<typeof copyWith>;
    expect(staysClouds(untimed, cloudWith(finished('Theirs'))).photos[0].photoIntelligence).toEqual(finished('Theirs'));
    expect(staysClouds(analysing, cloudWith(finished('Theirs'))).photos[0].photoIntelligence).toEqual(finished('Theirs'));
    expect(staysClouds(mineLater, cloudWith(finished('Theirs', early)))).toBe(mineLater);
    expect(staysClouds(mineFinished, cloudWith(failedRun(late)))).toBe(mineFinished);
    // A photo this copy no longer lists is not added back, and its result goes with it.
    const removed = { id: 'u1', notes: 'Mine', photos: [] as unknown[] };
    expect(sent(removed, cloudWith(finished('Theirs', late)))).toBe(removed);
    const another = { id: 'u1', notes: 'Mine', photos: [{ id: 'p9' }] };
    expect(sent(another, cloudWith(finished('Theirs', late)))).toBe(another);
    // The update's summary: this copy's own stays when it holds a finished result itself and its summary is no earlier.
    const two = (first: Result, second: Result | undefined, more: Record<string, unknown>) => ({ id: 'u1', ...more,
      photos: [{ id: 'p0', photoIntelligence: first }, { id: 'p1', ...(second === undefined ? {} : { photoIntelligence: second }) }] });
    const ownSummaryLater = two(finished('Mine', late), undefined, { pieSummary: 'My summary', pieCompletedAt: '2026-09-08T08:30:00.000Z' });
    const cloudTwo = two(finished('Mine', late), finished('Theirs', early), { pieSummary: 'Cloud summary', pieCompletedAt: late });
    expect(sent(ownSummaryLater, cloudTwo)).toEqual({ ...ownSummaryLater, photos: cloudTwo.photos });
    const ownSummaryEarlier = { ...ownSummaryLater, pieCompletedAt: early };
    expect(sent(ownSummaryEarlier, cloudTwo)).toMatchObject({ pieSummary: 'Cloud summary', pieCompletedAt: late, photos: cloudTwo.photos });
    // Not a field update, or no cloud copy: as it is.
    expect(withCloudPhotoAnalysisResults(null, cloudTwo)).toBeNull();
    expect(sent(untimed, undefined)).toBe(untimed);
  });
});
