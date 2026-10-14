import type { ProjectUpdate } from '../types';
import { isConstructionRelevantObservation } from './dave-construction-relevance';
import type { PIEPhotoProgressEvidence } from './PIEPhotoProgress';

/**
 * HIGH item 1 (the owner's instruction of 13 Oct 2026, the three high items): the phone's written report's own rules
 * for two things it prints, in one place, so that the report's fingerprint can read them by the same rules (next
 * change). Moved here from services/PIEReporter.ts as they were: which confirmed photo comparison the section WORK
 * AREAS / PHOTO NOTES quotes, and whether a note is the photo analysis's suggestion accepted word for word.
 */

/** A confirmed comparison older than this is history, not today's photo note (the same 7 days ProjectIntelligenceEngine treats as recent activity). */
export const REPORT_CURRENT_PHOTO_NOTE_DAYS = 7;

export function isEmptyRuntimeSummary(value: string) {
  return /no .*summarize|no .*evidence|not enough/i.test(value);
}

/**
 * The update's note is the photo analysis's own suggestion, accepted word for word: the written report then quotes
 * it only if it reads as construction work (F6).
 */
export function noteIsAcceptedPhotoSuggestion(update: Pick<ProjectUpdate, 'notes' | 'pieSuggestedNote' | 'pieSuggestedNoteAccepted'>): boolean {
  const suggestedNote = update.pieSuggestedNote?.trim() || '';
  return Boolean(update.pieSuggestedNoteAccepted && suggestedNote && suggestedNote === (update.notes || '').trim());
}

/**
 * The newest confirmed comparison. They come newest first by their photo's
 * moment, and several of ONE moment (two photos of one day that carry no
 * capture time) came in the order of this device's list. Build 232 item 2
 * part A: of those, the one whose update comes first in the report's own
 * order (`updates`: newest first by the update's date, then its id), so two
 * devices quote the same comparison.
 */
export function newestConfirmedComparison(
  accepted: readonly PIEPhotoProgressEvidence[] | null | undefined,
  updates: readonly ProjectUpdate[],
) {
  const newest = accepted?.[0];
  if (!accepted || !newest) return newest;
  const ofOneMoment = accepted.filter(item => item.acceptedAt === newest.acceptedAt);
  if (ofOneMoment.length < 2) return newest;
  const placeOf = (photoId: string): [number, number] => {
    for (let index = 0; index < updates.length; index += 1) {
      const within = updates[index].photos.findIndex(photo => photo.id === photoId);
      if (within >= 0) return [index, within];
    }
    return [Number.MAX_SAFE_INTEGER, 0];
  };
  return ofOneMoment
    .map((item, index) => ({ item, index, place: placeOf(item.currentPhotoId) }))
    .sort((left, right) => left.place[0] - right.place[0] || left.place[1] - right.place[1] || left.index - right.index)[0].item;
}

/**
 * The confirmed comparison the written report quotes as today's photo note, and the update its photo belongs to; or
 * null (audit round 2 H1: only a comparison the owner CONFIRMED is reported as fact). The newest confirmed one, if
 * its summary reads as construction work, its photo is one of this report's updates (`updates`, newest first) and it
 * is at most REPORT_CURRENT_PHOTO_NOTE_DAYS old at `reportAt`.
 */
export function confirmedComparisonQuoted(
  accepted: readonly PIEPhotoProgressEvidence[] | null | undefined,
  updates: readonly ProjectUpdate[],
  reportAt: number,
): Readonly<{ confirmed: PIEPhotoProgressEvidence; source: ProjectUpdate }> | null {
  const confirmed = newestConfirmedComparison(accepted, updates);
  if (!confirmed?.summary || isEmptyRuntimeSummary(confirmed.summary)) return null;
  if (!isConstructionRelevantObservation(confirmed.summary)) return null;
  // Its photo must belong to this report's updates; project and area come
  // from that update, never from the open draft.
  const source = updates.find(update =>
    update.photos.some(photo => photo.id === confirmed.currentPhotoId),
  );
  if (!source) return null;
  const seenAt = Date.parse(confirmed.acceptedAt || '');
  if (!Number.isFinite(seenAt)) return null;
  if (reportAt - seenAt > REPORT_CURRENT_PHOTO_NOTE_DAYS * 24 * 60 * 60 * 1000) return null;
  return { confirmed, source };
}
