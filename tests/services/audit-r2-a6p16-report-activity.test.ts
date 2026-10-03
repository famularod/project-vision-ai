/**
 * Audit round 2, A6 pass 16 (1 Oct 2026): one Low finding in the client
 * report's "since the last report" section, caused by 131a9b9 (A6 pass 15
 * L1).
 *
 * L1: 131a9b9 compares the activity keys only when the earlier report's task
 * is the same row; a task a master change moved onto a different row goes by
 * the activity's time, so a note made before the earlier report is skipped.
 * A note that never reached any report was then dropped:
 *  (a) the iPad, offline, approves master M at 17:30 and at 17:45 notes M's
 *      Pour slab; the phone sends R1 under master F at 18:00 without M. The
 *      phone's next report said only "Pour slab finish changed ...". The
 *      same late note on Framing (a row M did not move) was said.
 *  (b) after R1 David notes F's Pour slab; M is approved and R2 goes out (M's
 *      new row has no notes, so R2 cannot say it); Set Active F and R3 said
 *      only the finish change. The reverse too: a note on M's row after R2,
 *      Set Active F and R3, Set Active M and R4 dropped it.
 *
 * A task paired with a different row of the earlier report is now checked
 * against the report before that one, which each saved report keeps: against
 * its own row there by the same-row key and time rule; with no own row there,
 * an activity newer than that report is new (no report that showed the row
 * was made after it). Approving keeps that report too, so the report's text
 * does not change when it is approved or sent. Known gap: a note older than
 * the report before the earlier one, on a row neither of those two reports
 * had, still goes by the time rule (switching masters back and forth more
 * than two reports deep).
 *
 * The scenarios run through the real import, Set Active, delete helper,
 * Project Truth and both report formats, as in audit-r2-a6p15-report-activity,
 * and through the approve/send snapshot chain the Reports screen uses
 * (reportSnapshotToSave, markReportSnapshotDelivered, reportBaselineSnapshot).
 * Synthetic data.
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined) },
}));

import type { ReferenceDocument, ScheduleItem } from '../../types';
import { buildDAVEProjectTruth, type DAVEProjectTruth } from '../../services/DAVEProjectTruth';
import {
  buildDAVEReportBriefing,
  buildDAVEReportSourceFingerprint,
  enhanceDAVEReportDraft,
} from '../../services/DAVEReportIntelligence';
import {
  buildDAVEReportSnapshot,
  compareDAVEReportSnapshots,
  daveReportSnapshotScopeKey,
  markReportSnapshotDelivered,
  reportBaselineSnapshot,
  reportSnapshotToSave,
  type DAVEReportSnapshot,
} from '../../services/DAVEReportSnapshot';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { scheduleDocumentIsScheduleLike, selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import type { PIEReportDraft } from '../../services/PIEReporter';
import {
  mergeApprovedScheduleImportItems,
  scheduleItemsVisibleBeforeImport,
  scheduleProgressCarriedOnActivation,
} from '../../services/ScheduleImportMerge';
import { scheduleItemsOnlyInImportBatch } from '../../services/ScheduleImportProvenance';
import { scheduleItemsAfterScheduleDeleted } from '../../services/ScheduleLookahead';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';

const BASELINE_SENT = '2026-09-15T18:00:00.000Z';
const SURVEY_NOTE_AT = '2026-09-18T15:00:00.000Z';
const FIRST_SENT = '2026-09-21T18:00:00.000Z';

const schedule = (id: string, importedAt: string): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`,
}) as ReferenceDocument;
const F = schedule('MASTER F', '2026-08-31T12:00:00.000Z');
const HEADER = 'Task,Project,Area,Start,Finish,% Complete';
const F_ROWS = [
  'Pour slab,Alpha,Lot,10/01/2026,10/05/2026,0%',
  'Framing,Alpha,Lot,10/10/2026,10/20/2026,0%',
  'Survey,Alpha,Lot,09/20/2026,09/25/2026,0%',
];
/** Master M moves Pour slab only. */
const M_ROWS = [
  'Pour slab,Alpha,Lot,10/02/2026,10/06/2026,0%',
  'Framing,Alpha,Lot,10/10/2026,10/20/2026,0%',
  'Survey,Alpha,Lot,09/20/2026,09/25/2026,0%',
];
function rows(source: ReferenceDocument, lines: string[]): ScheduleItem[] {
  return (normalizeScheduleImport({
    contents: [HEADER, ...lines].join('\n'), sourceName: source.originalFileName, mimeType: 'text/csv', projects: ['Alpha'],
    now: new Date(source.importedAt),
  }).items as ScheduleItem[]).map((row, index) => ({
    ...row, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id,
  }));
}
type State = { items: ScheduleItem[]; documents: ReferenceDocument[] };
/** Approving a master merges its rows (paired with the rows shown) and makes it current (App.tsx). */
function approve(state: State, source: ReferenceDocument, imported: ScheduleItem[]): State {
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items, imported, completionMatch: () => null, mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, [...state.documents, source], source.importBatchId || ''), approvedAt: source.importedAt,
  });
  return { items: [...merged.additions, ...merged.next], documents: scheduleDocumentsAfterActivation(source, [...state.documents, source], 'project') };
}
/** Set Active (App.tsx activateReferenceDocument): the documents, and the progress carried to the tasks now shown. */
function setActive(state: State, document: ReferenceDocument, now: string): State {
  const target = state.documents.find(saved => saved.id === document.id)!;
  const documentsAfter = scheduleDocumentsAfterActivation(target, state.documents, 'project');
  const carried = new Map(scheduleProgressCarriedOnActivation({ items: state.items, documentsBefore: state.documents, documentsAfter, now })
    .map(item => [item.id, item]));
  return { items: state.items.map(item => carried.get(item.id) || item), documents: documentsAfter };
}
/** "Delete PDF + Items": the shared delete helper the phone and the web run, stamping the tasks it writes ids onto. */
function deleteWithItems(state: State, document: ReferenceDocument, at: string): State {
  const removed = scheduleItemsOnlyInImportBatch(state.items, document, state.documents.filter(scheduleDocumentIsScheduleLike));
  const removedIds = new Set(removed.map(item => item.id));
  const documents = state.documents.filter(other => other.id !== document.id);
  const kept = state.items.filter(item => !removedIds.has(item.id));
  const saved = new Map(scheduleItemsAfterScheduleDeleted({ items: kept, removed, document, documents, updatedAt: at })
    .map(item => [item.id, item]));
  return { items: kept.map(item => saved.get(item.id) || item), documents };
}
const shown = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents }) as ScheduleItem[];
const shownNamed = (state: State, name: string) => shown(state).filter(item => item.taskName === name)[0];
const byId = (state: State, id: string) => state.items.find(item => item.id === id)!;
type Note = { id: string; message: string; author: string; createdAt: string };
/** David adds a note to a task (on whichever device), stamped when he made it. */
const noted = (state: State, id: string, noteId: string, message: string, createdAt: string): State => ({
  ...state,
  items: state.items.map(item => item.id === id
    ? { ...item, activity: [...(byId(state, id).activity ?? []), { id: noteId, message, author: 'David', createdAt } as Note], updatedAt: createdAt } as ScheduleItem
    : item),
});

const truthOf = (state: State, now: string): DAVEProjectTruth => buildDAVEProjectTruth({
  projectId: 'report:alpha', projectName: 'Alpha', updates: [], scheduleItems: shown(state), projectAreas: [], referenceDocuments: [], now,
});
const fingerprintOf = (state: State, at: string) => buildDAVEReportSourceFingerprint([truthOf(state, at)]);
const snapshotOf = (state: State, capturedAt: string): DAVEReportSnapshot => buildDAVEReportSnapshot({
  truths: [truthOf(state, capturedAt)], scopeKey: daveReportSnapshotScopeKey(['Alpha']), sourceFingerprint: fingerprintOf(state, capturedAt),
  capturedAt, reportFormat: 'project_manager',
});

const draft = {
  id: 'draft-1', reportType: 'daily_project_update', audience: 'owner',
  title: 'Alpha update', subject: 'Alpha update', body: '', openingLine: '', closingLine: '',
  executiveSummary: [], sections: [], locationGroups: [], actionItems: [], imageReferences: [],
  risks: [], decisionsNeeded: [], confidence: 'high', reportReadiness: 'high',
  needsReview: false, reviewFlags: [], sourceEvidence: [], constructionUnderstanding: {},
  generatedAt: FIRST_SENT,
} as unknown as PIEReportDraft;

/** The written report's "since" lines in both formats (they must agree), against the saved report as the screen reads it. */
function sinceLines(state: State, saved: DAVEReportSnapshot | null, now: string) {
  const previousSnapshot = reportBaselineSnapshot(saved, fingerprintOf(state, now));
  const briefing = buildDAVEReportBriefing({ truths: [truthOf(state, now)], selectedProjectNames: ['Alpha'], previousSnapshot });
  const [pm, executive] = (['project_manager', 'executive'] as const).map(format => {
    const body = enhanceDAVEReportDraft(draft, briefing, format).body;
    // Owner answer 2 Oct (report heading): the written report's heading is "SINCE THE LAST REPORT" (was "SINCE THE LAST APPROVED REPORT"); pin updated deliberately.
    const start = body.indexOf('SINCE THE LAST REPORT');
    return body.slice(start, body.indexOf('COMPLETED WORK', start)).split('\n').filter(line => line.startsWith('• '));
  });
  expect(executive).toEqual(pm);
  return pm;
}
/**
 * David approves the report on screen and sends it (the Reports screen's chain). Its text is the same before
 * the approval, once approved and once sent (an approval belongs to one exact text: A6 pass 3).
 */
function approveAndSend(saved: DAVEReportSnapshot | null, state: State, at: string) {
  const lines = saved ? sinceLines(state, saved, at) : [];
  const approved = reportSnapshotToSave(snapshotOf(state, at), saved);
  if (!approved) throw new Error('nothing new to approve');
  const sent = markReportSnapshotDelivered(approved, at);
  if (saved) {
    expect(sinceLines(state, approved, at)).toEqual(lines);
    expect(sinceLines(state, sent, at)).toEqual(lines);
  }
  return { lines, sent };
}
const linesAbout = (lines: readonly string[], name: string) => lines.filter(line => line.includes(`Alpha: ${name}`));

/** F current; the Sep 15 report; the phone notes Survey on Sep 18. */
function onF() {
  const state = approve({ items: [], documents: [] }, F, rows(F, F_ROWS));
  const baseline = approveAndSend(null, state, BASELINE_SENT).sent;
  const withSurvey = noted(state, shownNamed(state, 'Survey').id, 'survey-1', 'Survey stakes set.', SURVEY_NOTE_AT);
  return { state: withSurvey, baseline, fPour: shownNamed(state, 'Pour slab') };
}

describe('A6 p16 L1 (a): the other device\'s note on a row its master moved, made before the phone\'s send, is said', () => {
  const M = schedule('MASTER M', '2026-09-21T17:30:00.000Z');
  const IPAD_NOTE_AT = '2026-09-21T17:45:00.000Z';
  const NEXT_REPORT = '2026-09-23T15:00:00.000Z';

  function lateNoteCase() {
    const { state, baseline, fPour } = onF();
    // 18:00: the phone sends R1 under F; it has neither M nor the iPad's note.
    const first = approveAndSend(baseline, state, FIRST_SENT);
    expect(first.lines).toContain('• Alpha: Survey — Survey stakes set.');
    // The iPad, offline: approves M at 17:30 and notes M's Pour slab and Framing at 17:45. The phone receives them.
    const withM = approve(state, M, rows(M, M_ROWS));
    const mPour = shownNamed(withM, 'Pour slab');
    expect(mPour.id).not.toBe(fPour.id);
    expect(mPour.revisedFromTaskIds).toEqual([fPour.id]);
    const framing = shownNamed(withM, 'Framing');
    expect(framing.id).toBe(shownNamed(state, 'Framing').id);
    const received = noted(
      noted(withM, mPour.id, 'ipad-1', 'Pump truck booked for Friday.', IPAD_NOTE_AT),
      framing.id, 'ipad-2', 'Framing crew confirmed.', IPAD_NOTE_AT,
    );
    return { first, received };
  }

  it('the reviewer\'s case: the next report says the note with the finish change', () => {
    const { first, received } = lateNoteCase();
    const next = approveAndSend(first.sent, received, NEXT_REPORT);
    expect(linesAbout(next.lines, 'Pour slab')).toEqual([
      '• Alpha: Pour slab finish changed from 10/05/2026 to 10/06/2026.',
      '• Alpha: Pour slab — Pump truck booked for Friday.',
    ]);
  });

  it('the same late note on a row M did not move (Framing) is said, as before', () => {
    const { first, received } = lateNoteCase();
    expect(linesAbout(approveAndSend(first.sent, received, NEXT_REPORT).lines, 'Framing')).toEqual(['• Alpha: Framing — Framing crew confirmed.']);
  });

  it('and is not said again in the report after', () => {
    const { first, received } = lateNoteCase();
    const next = approveAndSend(first.sent, received, NEXT_REPORT);
    const later = noted(received, shownNamed(received, 'Survey').id, 'survey-2', 'Survey checked.', '2026-09-24T09:00:00.000Z');
    const after = approveAndSend(next.sent, later, '2026-09-25T15:00:00.000Z');
    expect(linesAbout(after.lines, 'Pour slab')).toEqual([]);
    expect(linesAbout(after.lines, 'Framing')).toEqual([]);
  });
});

describe('A6 p16 L1 (b): a note made while a row was shown, its master switched before the next report, is said when the row is back', () => {
  const M = schedule('MASTER M', '2026-09-24T12:00:00.000Z');
  const F_NOTE_AT = '2026-09-22T10:00:00.000Z';
  const SECOND_SENT = '2026-09-26T18:00:00.000Z';
  const M_NOTE_AT = '2026-09-27T09:00:00.000Z';
  const BACK_TO_F_AT = '2026-09-27T18:00:00.000Z';
  const THIRD_SENT = '2026-09-28T18:00:00.000Z';
  const BACK_TO_M_AT = '2026-09-29T09:00:00.000Z';
  const FOURTH_SENT = '2026-09-30T15:00:00.000Z';
  const TO_M = '• Alpha: Pour slab finish changed from 10/05/2026 to 10/06/2026.';
  const TO_F = '• Alpha: Pour slab finish changed from 10/06/2026 to 10/05/2026.';

  /** R1 under F; optionally a note on F's Pour slab; M approved; R2. */
  function switchCase(noteOnF: boolean) {
    const { state, baseline, fPour } = onF();
    const first = approveAndSend(baseline, state, FIRST_SENT);
    const afterFirst = noteOnF ? noted(state, fPour.id, 'f-1', 'Rebar inspection passed.', F_NOTE_AT) : state;
    const onM = approve(afterFirst, M, rows(M, M_ROWS));
    const mPour = shownNamed(onM, 'Pour slab');
    expect(mPour.activity ?? []).toEqual([]);
    // R2 cannot say F's note: M's new row has no notes.
    const second = approveAndSend(first.sent, onM, SECOND_SENT);
    expect(linesAbout(second.lines, 'Pour slab')).toEqual([TO_M]);
    return { onM, fPour, mPour, second };
  }

  it('the reviewer\'s case: a note on F\'s row after R1, M approved and R2 sent, Set Active F: R3 says it', () => {
    const { onM, fPour, second } = switchCase(true);
    const backOnF = setActive(onM, F, BACK_TO_F_AT);
    expect(shownNamed(backOnF, 'Pour slab').id).toBe(fPour.id);
    expect(linesAbout(approveAndSend(second.sent, backOnF, THIRD_SENT).lines, 'Pour slab')).toEqual([
      TO_F,
      '• Alpha: Pour slab — Rebar inspection passed.',
    ]);
  });

  it('Delete PDF + Items on M, then Set Active F: the same', () => {
    const { onM, fPour, second } = switchCase(true);
    const backOnF = setActive(deleteWithItems(onM, M, BACK_TO_F_AT), F, BACK_TO_F_AT);
    expect(shownNamed(backOnF, 'Pour slab').id).toBe(fPour.id);
    expect(linesAbout(approveAndSend(second.sent, backOnF, THIRD_SENT).lines, 'Pour slab')).toEqual([
      TO_F,
      '• Alpha: Pour slab — Rebar inspection passed.',
    ]);
  });

  it('the reverse: a note on M\'s row after R2, Set Active F and R3, Set Active M: R4 says it', () => {
    const { onM, mPour, second } = switchCase(false);
    const withNote = noted(onM, mPour.id, 'm-1', 'Pump booked.', M_NOTE_AT);
    const backOnF = setActive(withNote, F, BACK_TO_F_AT);
    const third = approveAndSend(second.sent, backOnF, THIRD_SENT);
    // M's row is hidden: R3 cannot say it.
    expect(linesAbout(third.lines, 'Pour slab')).toEqual([TO_F]);
    const backOnM = setActive(backOnF, M, BACK_TO_M_AT);
    expect(shownNamed(backOnM, 'Pour slab').id).toBe(mPour.id);
    expect(linesAbout(approveAndSend(third.sent, backOnM, FOURTH_SENT).lines, 'Pour slab')).toEqual([
      TO_M,
      '• Alpha: Pour slab — Pump booked.',
    ]);
  });

  it('a note said before the switch is not said again when the row comes back (p15 L1 still holds through the chain)', () => {
    const { onM, mPour, second } = switchCase(false);
    const withNote = noted(onM, mPour.id, 'm-1', 'Pump booked.', M_NOTE_AT);
    // R3 under M says it.
    const third = approveAndSend(second.sent, withNote, THIRD_SENT);
    expect(linesAbout(third.lines, 'Pour slab')).toEqual(['• Alpha: Pour slab — Pump booked.']);
    const backOnF = setActive(withNote, F, '2026-09-29T09:00:00.000Z');
    const fourth = approveAndSend(third.sent, backOnF, FOURTH_SENT);
    expect(linesAbout(fourth.lines, 'Pour slab')).toEqual([TO_F]);
    // Back to M: the report before the earlier one has M's row with this note.
    const backOnM = setActive(backOnF, M, '2026-10-01T09:00:00.000Z');
    expect(linesAbout(approveAndSend(fourth.sent, backOnM, '2026-10-01T15:00:00.000Z').lines, 'Pour slab')).toEqual([TO_M]);
  });

  it('recorded gap, safe side: two reports under F before going back to M, an old note is not said again', () => {
    const { onM, mPour, second } = switchCase(false);
    const withNote = noted(onM, mPour.id, 'm-1', 'Pump booked.', M_NOTE_AT);
    const third = approveAndSend(second.sent, withNote, THIRD_SENT);
    expect(linesAbout(third.lines, 'Pour slab')).toEqual(['• Alpha: Pour slab — Pump booked.']);
    const backOnF = setActive(withNote, F, '2026-09-29T09:00:00.000Z');
    const fourth = approveAndSend(third.sent, backOnF, FOURTH_SENT);
    const surveyed = noted(backOnF, shownNamed(backOnF, 'Survey').id, 'survey-2', 'Survey checked.', '2026-10-01T09:00:00.000Z');
    const fifth = approveAndSend(fourth.sent, surveyed, '2026-10-01T15:00:00.000Z');
    const backOnM = setActive(surveyed, M, '2026-10-02T09:00:00.000Z');
    // Neither of the two reports before has M's row; the note predates both, so the time rule decides: not said.
    expect(linesAbout(approveAndSend(fifth.sent, backOnM, '2026-10-02T15:00:00.000Z').lines, 'Pour slab')).toEqual([TO_M]);
  });
});

describe('A6 p16 L1: the saved report keeps the report before it', () => {
  const report = (fingerprint: string, capturedAt: string) => ({
    ...snapshotOf(approve({ items: [], documents: [] }, F, rows(F, F_ROWS)), capturedAt), sourceFingerprint: fingerprint,
  }) as DAVEReportSnapshot;

  it('approving keeps two reports back and no more; an unsent approval keeps the same; the version stays', () => {
    const r1 = markReportSnapshotDelivered(reportSnapshotToSave(report('f1', '2026-09-15T18:00:00.000Z'), null)!, '2026-09-15T18:00:00.000Z');
    const r2 = markReportSnapshotDelivered(reportSnapshotToSave(report('f2', '2026-09-21T18:00:00.000Z'), r1)!, '2026-09-21T18:00:00.000Z');
    expect(r2.supersedes?.sourceFingerprint).toBe('f1');
    expect(r2.supersedes).not.toHaveProperty('supersedes');
    const r3 = markReportSnapshotDelivered(reportSnapshotToSave(report('f3', '2026-09-26T18:00:00.000Z'), r2)!, '2026-09-26T18:00:00.000Z');
    expect(r3.supersedes?.sourceFingerprint).toBe('f2');
    expect(r3.supersedes?.supersedes?.sourceFingerprint).toBe('f1');
    const approved = reportSnapshotToSave(report('f4', '2026-09-28T18:00:00.000Z'), r3)!;
    expect(approved.supersedes?.sourceFingerprint).toBe('f3');
    expect(approved.supersedes?.supersedes?.sourceFingerprint).toBe('f2');
    expect(approved.supersedes?.supersedes).not.toHaveProperty('supersedes');
    // The baseline the screen reads, before the approval and after it, keeps the report before it.
    expect(reportBaselineSnapshot(r3, 'f4')?.supersedes?.sourceFingerprint).toBe('f2');
    expect(reportBaselineSnapshot(approved, 'f4')?.supersedes?.sourceFingerprint).toBe('f2');
    expect(reportBaselineSnapshot(approved, 'f5')?.supersedes?.sourceFingerprint).toBe('f2');
    // An approval replacing an unsent one keeps the same history.
    const replaced = reportSnapshotToSave(report('f5', '2026-09-29T18:00:00.000Z'), approved)!;
    expect(replaced.supersedes?.sourceFingerprint).toBe('f3');
    expect(replaced.supersedes?.supersedes?.sourceFingerprint).toBe('f2');
    expect(replaced.supersedes?.supersedes).not.toHaveProperty('supersedes');
    expect(replaced.version).toBe('dave-report-snapshot/1.0');
  });

  it('a report saved with no report before it (a first report, or an older build) keeps the time rule', () => {
    const { state, fPour } = onF();
    const M = schedule('MASTER M', '2026-09-21T17:30:00.000Z');
    // R1 saved with nothing before it.
    const first = snapshotOf(state, FIRST_SENT);
    const received = approve(state, M, rows(M, M_ROWS));
    const mPour = shownNamed(received, 'Pour slab');
    const withNote = noted(received, mPour.id, 'ipad-1', 'Pump truck booked for Friday.', '2026-09-21T17:45:00.000Z');
    const period = compareDAVEReportSnapshots({ current: snapshotOf(withNote, '2026-09-23T15:00:00.000Z'), previous: first });
    expect(period.newActivityTaskIds).not.toContain(mPour.id);
    expect(period.sameActivityTaskIds).not.toContain(mPour.id);
    expect(mPour.id).not.toBe(fPour.id);
  });
});
