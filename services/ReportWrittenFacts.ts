import type { ProjectUpdate, ScheduleItem, UpdatePhoto } from '../types';
import { isConstructionRelevantObservation } from './dave-construction-relevance';
import { extractScheduleEvidence, fieldUpdatesNewestFirst, whatChangedForWrittenReport } from './PIEEvidenceFusion';
import { buildPhotoProgress, type PIEPhotoProgressEvidence } from './PIEPhotoProgress';
import { scheduleLineAsWritten, type DAVEWrittenScheduleLine } from './ReportScheduleLine';
import { reportWordPhotoDescription } from './ReportWordMediaDescription';

/**
 * HIGH item 1 (the owner's instruction of 13 Oct 2026, the three high items; the Build 232 round's F2 to F6b): what
 * the phone's written report prints of a project's own records that the report's Project Truth does not hold.
 *
 * The section WORK AREAS / PHOTO NOTES is written from the field updates and tasks themselves (services/
 * PIEReporter.ts), not from Project Truth. "Your other device already sent this report" is said by the report's
 * fingerprint, and the fingerprint is worked out from Project Truth, so whatever the section reads that Project Truth
 * does not keep could change the report under "already sent". These are those things, read by the writer's own
 * rules (the same functions, here), from the project's records, on the phone and on the desktop alike: the desktop
 * prints no such section, but it must work out the same value for the same records.
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

/**
 * What the written report prints of a project's records beyond what its Project Truth holds, as the report's
 * fingerprint holds it (version 3.0). Each part is a value both devices hold the same: the desktop's loader keeps a
 * photo's kind as an issue, a safety concern or neither, and an action's status as open, in progress, waiting or
 * closed (DAVEWebReadOnlyRepository normalizeWebPhoto), and so does this.
 */
export type DAVEWrittenReportFacts = Readonly<{
  /**
   * F2, F2b: each task's own schedule line as the section prints it (ReportScheduleLine): as a problem
   * or as a next step with its owner, where it prints as one (the area it prints under is the task's own). HIGH item
   * 1d (open item 7.55): its notes, owner or contractor and priority (a "Please confirm the current status" line) are
   * held only as printed there. Its priority and milestone name also rank the section's "Schedule focus" sentence,
   * held as written (`scheduleFocus`).
   */
  tasks: readonly Readonly<{ taskId: string; line: DAVEWrittenScheduleLine }>[];
  /**
   * F5, F6: each update's photos IN THEIR OWN ORDER (the image numbers, "Latest photo"), each photo's kind and asked
   * action; whether its note is the accepted suggestion. And the names it was filed under: the report takes an update
   * for the project's by its task as well, and Project Truth then holds it under the project's own name, while the
   * section heads its lines, and numbers its photos, by the names the update carries (review pass 3, part A).
   */
  updates: readonly Readonly<{
    updateId: string;
    filedUnder: string;
    scheduleProjectName: string;
    noteIsAcceptedPhotoSuggestion: boolean;
    /** `place`: the photo's place in its update (the fingerprint holds every list as a set, so the order is held by this). */
    photos: readonly Readonly<{ photoId: string; place: number; kind: 'issue' | 'safety' | 'photo'; actionRequired: string; actionOwner: string; actionStatus: string }>[];
  }>[];
  /**
   * F3: the section's "Schedule focus" sentence as the writer writes it ("Schedule focus: Pour slab (due
   * 10/17/2026)."), or null. It names a task from the day it comes within two weeks: it moves the morning the
   * sentence does, and only then.
   */
  scheduleFocus: string | null;
  /**
   * F4, F6b: the confirmed comparison the section quotes, or null. It is quoted for 7 days from its photo: it moves
   * the morning the quote leaves the report, and when its summary is reworded.
   */
  quotedComparison: Readonly<{ photoId: string; summary: string; areaName: string }> | null;
  /**
   * HIGH item 1f: each photo of each of the report's updates as the Word report prints it (its caption, where and when it
   * was recorded, the task it was recorded against, why it is there: ReportWordMediaDescription, the Word builders' own
   * description), with its place in its update. The desktop's Word file prints every photo of the report's updates, in
   * either format, so the report holds them in either format.
   */
  wordPhotos: readonly Readonly<{
    updateId: string;
    photoId: string;
    place: number;
    caption: string;
    projectName: string | null;
    areaName: string | null;
    linkedTaskName: string | null;
    recordedAt: string | null;
    reasonForInclusion: string;
  }>[];
  /**
   * HIGH item 1f: what decides each drawing excerpt's picture in the Word files and on the Reports screen, beside its
   * citation (DAVEProjectTruth `drawingCitations`: document, revision, page, region id, label): the part of the page it
   * shows. Set by the report recipe (DAVEReportProjectTruths) from the same drawing references.
   */
  wordDrawings?: readonly Readonly<{ referenceId: string; pageNumber: number; region: Readonly<{ x: number; y: number; width: number; height: number }> }>[];
}>;

const photoKind = (category: unknown): 'issue' | 'safety' | 'photo' =>
  (category === 'Open Issue' ? 'issue' : category === 'Safety Concern' ? 'safety' : 'photo');
const actionStatusAsKept = (status: unknown) =>
  (status === 'In Progress' || status === 'Waiting' || status === 'Closed' ? status : 'Open');
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

/**
 * The written report's own facts of one project, from its field updates and tasks (as the device holds them, with
 * the names they were filed under), at `now`.
 */
export function buildWrittenReportFacts({
  projectName,
  updates,
  scheduleItems,
  now,
}: {
  projectName: string;
  updates: readonly ProjectUpdate[];
  scheduleItems: readonly ScheduleItem[];
  now: string;
}): DAVEWrittenReportFacts {
  const moment = new Date(now);
  const newestFirst = fieldUpdatesNewestFirst(updates);
  const focus = whatChangedForWrittenReport({
    userUpdateEvidence: [],
    photoEvidence: [],
    scheduleEvidence: extractScheduleEvidence({ projectName, scheduleItems: [...scheduleItems], now: moment }),
  });
  const quoted = confirmedComparisonQuoted(
    buildPhotoProgress({ projectName, updates: [...updates], now: moment }).acceptedEvidence,
    newestFirst,
    moment.getTime(),
  );
  return {
    tasks: scheduleItems.map(item => ({
      taskId: item.id,
      line: scheduleLineAsWritten(item),
    })),
    updates: updates.map(update => ({
      updateId: update.id,
      filedUnder: text(update.projectName),
      scheduleProjectName: text(update.scheduleProjectName),
      noteIsAcceptedPhotoSuggestion: noteIsAcceptedPhotoSuggestion(update),
      photos: (update.photos ?? []).map((photo: UpdatePhoto, place: number) => ({
        photoId: photo.id,
        place,
        kind: photoKind(photo.category),
        actionRequired: text(photo.actionRequired),
        actionOwner: text(photo.actionOwner),
        actionStatus: actionStatusAsKept(photo.actionStatus),
      })),
    })),
    scheduleFocus: focus.startsWith('Schedule focus:') ? focus : null,
    quotedComparison: quoted
      ? { photoId: quoted.confirmed.currentPhotoId, summary: quoted.confirmed.summary, areaName: text(quoted.confirmed.areaName) }
      : null,
    wordPhotos: updates.flatMap(update => (update.photos ?? []).map((photo: UpdatePhoto, place: number) => {
      const described = reportWordPhotoDescription(photo, update);
      // As the Word file reads each: trimmed, and nothing where it has nothing (it prints no "Area:" or "Task:" then).
      return {
        updateId: update.id,
        photoId: photo.id,
        place,
        caption: described.caption,
        projectName: text(described.projectName) || null,
        areaName: text(described.areaName) || null,
        linkedTaskName: text(described.linkedTaskName) || null,
        recordedAt: text(described.recordedAt) || null,
        reasonForInclusion: described.reasonForInclusion,
      };
    })),
  };
}
