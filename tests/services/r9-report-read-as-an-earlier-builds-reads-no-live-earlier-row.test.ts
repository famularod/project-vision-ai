/**
 * R9 (the coordinator's decision, 12 Oct 2026; closes what R8 item 3 left open for a report Build 230 saved).
 *
 * A report that says a task is back in the project plan says what changed on it since it last stood, and reads
 * that from the row the task left on: a hidden row, as it is saved NOW. Today's fingerprint (2.0) holds that row
 * (R8 item 3). The fingerprint Build 230 wrote (1.0) does not, and a report Build 230 saved is still known by it.
 * So a report read under a 1.0 name said "Paint is back ... moved from 60% to 70%", where Build 230 had written
 * "Paint was added", and an edit to the hidden row arriving late from another device changed the sentence to
 * "from 50%" while the report still read as already sent.
 *
 * The decision: a returning-task sentence reads a live earlier row only when the report the comparison counts
 * from carries today's fingerprint version. Counted from a report an earlier build saved, and where today's
 * report is itself read as one an earlier build saved, no live earlier row is read: the task reads as Build 230
 * wrote it, "was added to the project plan". What is read from the SAVED report before is untouched. No name is
 * taken away, nothing is stored, no clock. From the first report sent on this build it works as before.
 *
 * The real CSV reader (with Unique IDs), import merge, shown list, the one report recipe, the phone's and the
 * web's own way of choosing what a report counts from, and the report's comparison. Synthetic data.
 */
import * as fs from 'fs';
import * as path from 'path';
import { buildDAVELegacyReportSourceFingerprint, buildDAVEReportBriefing, buildDAVEReportSourceFingerprint } from '../../services/DAVEReportIntelligence';
import { buildDAVEReportProjectTruths } from '../../services/DAVEReportProjectTruths';
import {
  buildDAVEReportSnapshot, compareDAVEReportSnapshots, daveReportSnapshotScopeKey, markReportSnapshotDelivered, reportBaselineSnapshot, reportReadAsEarlierVersionReport,
  reportSnapshotToSave, reportTaskEarlierRows, sameReportSource, type DAVEReportSnapshot,
} from '../../services/DAVEReportSnapshot';
import { reconcileDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';
import { buildDAVEWebReportDraft, buildDAVEWebReportTruths } from '../../services/DAVEWebOperations';
import type { DAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import { daveWebReportPeriodState } from '../../services/DAVEWebReportPeriod';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { mergeApprovedScheduleImportItems, scheduleImportReviewPairingQuestions, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';
import { normalizeProjectControls } from '../../services/VitruviusProjectControls';
import type { ReferenceDocument, ScheduleItem } from '../../types';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined), getAllKeys: jest.fn(async () => []), multiGet: jest.fn(async () => []) },
}));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));

type State = { items: ScheduleItem[]; documents: ReferenceDocument[] };
const shown = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents }) as ScheduleItem[];
const master = (id: string, importedAt: string): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`,
}) as ReferenceDocument;
/** The approval as the phone makes it, the review's questions answered as it guesses them (the tasks carry Unique IDs). */
function approve(state: State, source: ReferenceDocument, lines: string[]): State {
  const imported = (normalizeScheduleImport({
    contents: ['Task,Project,Area,Start,Finish,Percent Complete,Unique ID', ...lines].join('\n'), sourceName: source.originalFileName,
    mimeType: 'text/csv', projects: ['Alpha'], projectAreas: [], now: new Date(source.importedAt as string),
  }).items as ScheduleItem[]).map((item, index) => ({
    ...item, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id, projectControls: normalizeProjectControls(undefined), activity: [],
  } as ScheduleItem));
  let pairingChoices: Record<string, string | null> | undefined;
  scheduleImportReviewPairingQuestions({ saved: state.items, documents: [...state.documents, source], importBatchId: source.importBatchId || '', imported, overlay: false })
    .forEach(question => { pairingChoices = { ...(pairingChoices || {}), ...(question as unknown as { guess: Record<string, string | null> }).guess }; });
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items, imported, completionMatch: () => null, mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, [...state.documents, source], source.importBatchId || ''),
    approvedAt: source.importedAt as string, overlay: false, ...(pairingChoices ? { pairingChoices } : {}),
  });
  return {
    items: reconcileDAVEScheduleRecords([...merged.additions, ...merged.next]) as ScheduleItem[],
    documents: scheduleDocumentsAfterActivation(source, [...state.documents, source], 'project'),
  };
}
const records = (state: State, id: string, percent: number, at: string): State => ({ ...state, items: state.items.map(item => (item.id === id
  ? { ...item, percentComplete: percent, status: 'In Progress', progressSource: 'project_manager', progressConfirmedAt: at, progressConfirmedBy: 'David', updatedAt: at } as ScheduleItem : item)) });
const withRow = (state: State, id: string, change: Partial<ScheduleItem>): State => ({ ...state, items: state.items.map(item => (item.id === id ? { ...item, ...change } as ScheduleItem : item)) });
const truthsOf = (state: State, at: string) => buildDAVEReportProjectTruths({
  projects: [{ name: 'Alpha', projectId: 'report:alpha' }], projectRecords: [{ name: 'Alpha' }] as never, updates: [], scheduleItems: shown(state),
  knownScheduleItems: state.items, knownScheduleDocuments: state.documents, projectAreas: [], referenceDocuments: state.documents, now: at,
});
const paintLines = (briefing: ReturnType<typeof buildDAVEReportBriefing>) => briefing.reportingPeriod.changes.map(change => String(change.summary)).filter(line => line.startsWith('Paint'));
/** The phone's Reports screen for this saved data and saved period (screens/ReportsScreen.tsx). */
function report(state: State, saved: DAVEReportSnapshot | null, at: string) {
  const truths = truthsOf(state, at);
  const fingerprint = buildDAVEReportSourceFingerprint(truths);
  const briefing = buildDAVEReportBriefing({
    truths, selectedProjectNames: ['Alpha'], previousSnapshot: reportBaselineSnapshot(saved, fingerprint),
    readAsEarlierVersionReport: reportReadAsEarlierVersionReport(saved, fingerprint), scheduleItems: shown(state),
  });
  const snapshot = buildDAVEReportSnapshot({ truths, scopeKey: daveReportSnapshotScopeKey(['Alpha']), sourceFingerprint: fingerprint, capturedAt: at, reportFormat: 'project_manager' });
  const toSave = reportSnapshotToSave(snapshot, saved);
  return {
    truths, fingerprint,
    sent: (toSave ? markReportSnapshotDelivered(toSave, at, 'phone') : saved) as DAVEReportSnapshot,
    readsAsAlreadySent: Boolean(saved) && toSave === null,
    /** What the report says of Paint since the last report, and everything it says changed. */
    ofPaint: paintLines(briefing),
    changes: briefing.reportingPeriod.changes.map(change => String(change.summary)),
  };
}
/** The web's Reports page for the same (components/web-shell/desktop-read-only-shell.tsx): the period on this tab, then the report. */
function webPage(state: State, saved: DAVEReportSnapshot | null, at: string) {
  const snapshot = {
    projects: [{ id: 'project-alpha-id', name: 'Alpha' }], scheduleItems: shown(state), knownScheduleItems: state.items,
    projectUpdates: [], referenceDocuments: state.documents, refreshedAt: at,
  } as unknown as DAVEWebReadOnlySnapshot;
  const fingerprint = buildDAVEReportSourceFingerprint(buildDAVEWebReportTruths(snapshot, 'Alpha'));
  const period = daveWebReportPeriodState({ read: { status: 'loaded', snapshot: saved, shared: 'checked', approvalSavedHere: false }, fingerprint, pulledAt: at });
  const briefing = buildDAVEWebReportDraft(snapshot, 'Alpha', {
    previousSnapshot: period.previousSnapshot, waitingForOtherDevice: Boolean(period.behindSend), readAsEarlierVersionReport: period.readAsEarlierVersionReport,
  });
  return { readsAsAlreadySent: Boolean(saved) && sameReportSource(saved!.sourceFingerprint, fingerprint), ofPaint: paintLines(briefing), changes: briefing.reportingPeriod.changes.map(change => String(change.summary)) };
}
type Report = ReturnType<typeof report>;
/** A report as Build 230 saved it: the same saved report, under the fingerprint that build wrote for its facts (1.0). */
const asBuild230SavedIt = (made: Report): Report => ({ ...made, sent: { ...made.sent, sourceFingerprint: buildDAVELegacyReportSourceFingerprint(made.truths) } });

const TASKS = ['Drywall,Alpha,Lot,10/01/2026,10/04/2026,,102', 'Framing,Alpha,Lot,09/14/2026,09/18/2026,,103'];
const PAINT = (start: string, finish: string) => `Paint,Alpha,Lot,${start},${finish},,101`;
/**
 * Master 1 lists Paint; he records 60% and report 1 is sent. Master 2 leaves Paint out: report 2 says it was removed,
 * and report 3 goes out. Master 4 lists Paint again, the same task by its Unique ID; he records 70%, and report 4 is sent.
 * `onBuild230`: which of the four reports Build 230 made and saved (the others, this build).
 */
function paintIsBack(onBuild230: readonly number[]) {
  const made = (no: number, result: Report) => (onBuild230.includes(no) ? asBuild230SavedIt(result) : result);
  let state = approve({ items: [], documents: [] }, master('MASTER M1', '2026-09-07T16:00:00.000Z'), [PAINT('09/21/2026', '09/25/2026'), ...TASKS]);
  state = records(state, 'MASTER M1-1', 60, '2026-09-07T18:00:00.000Z');
  const one = made(1, report(state, null, '2026-09-07T22:00:00.000Z'));
  state = approve(state, master('MASTER M2', '2026-09-08T16:00:00.000Z'), TASKS);
  const two = made(2, report(state, one.sent, '2026-09-08T22:00:00.000Z'));
  state = records(state, shown(state).find(item => item.taskName === 'Framing')!.id, 30, '2026-09-09T18:00:00.000Z');
  const three = made(3, report(state, two.sent, '2026-09-09T22:00:00.000Z'));
  state = approve(state, master('MASTER M4', '2026-09-10T16:00:00.000Z'), [PAINT('09/28/2026', '10/02/2026'), ...TASKS]);
  state = records(state, shown(state).find(item => item.taskName === 'Paint')!.id, 70, '2026-09-10T18:00:00.000Z');
  const four = made(4, report(state, three.sent, '2026-09-10T22:00:00.000Z'));
  return { state, three, four };
}
const AGAIN = '2026-09-10T22:30:00.000Z'; // the same evening, after the update is installed: no date in the report has moved
/** The iPad, offline since before master 2, syncs an edit it had made to Paint's old row: 50%. Nothing in his task list changes. */
const lateEdit = (state: State) => withRow(state, 'MASTER M1-1', { percentComplete: 50, progressConfirmedAt: '2026-09-08T09:00:00.000Z', updatedAt: '2026-09-08T09:00:00.000Z' });
const WAS_ADDED = ['Paint was added to the project plan.'];
const IS_BACK = ['Paint is back in the project plan.', 'Paint moved from 60% to 70% complete.', 'Paint finish changed from 09/25/2026 to 10/02/2026.'];
const EARLIER_VERSION = /^dave-report-source\/1\.0:/;

// R10 (the coordinator's decision on review pass 3, P3-2): NO EARLIER-VERSION NAME EVER STANDS. Five tests of this file
// pinned what a report read UNDER a 1.0 name says ("today's report is the one already sent"). No report is read under
// one any more, so the second half of R9's rule (today's report read as one an earlier version saved) has nothing
// left to act on; it is left in the code. Each of the five now says what is true and is marked "R10". The first half
// (counted from a report an earlier version saved, no live earlier row is read) stands and is still tested below.
describe('R9: a report counted from, or read as, a report an earlier build saved reads no live earlier row', () => {
  it.each([
    ['every report so far was made on Build 230 (the device he updates)', [1, 2, 3, 4]],
    ['only report 4 was made on Build 230, counted from a report this build had saved (two devices on two builds)', [4]],
  ])('R10: report 4 saved under its 1.0 name, %s: today\'s report is NOT taken for it; counted from it, it says nothing of Paint, before and after the late edit', (_which, onBuild230) => {
    const { state, four } = paintIsBack(onBuild230);
    expect(four.sent.sourceFingerprint).toMatch(EARLIER_VERSION);
    for (const screen of [report, webPage]) {
      const today = screen(state, four.sent, AGAIN);
      // (This said "the one already sent ... says 'was added'".) It is another report, offered once.
      expect(today.readsAsAlreadySent).toBe(false);
      // Counted from Build 230's report 4, which has Paint as it is: nothing changed, and nothing read from a hidden row.
      expect(today.ofPaint).toEqual([]);
      const late = lateEdit(state);
      expect(shown(late).map(item => [item.id, item.percentComplete])).toEqual(shown(state).map(item => [item.id, item.percentComplete]));
      const after = screen(late, four.sent, AGAIN);
      expect(after.readsAsAlreadySent).toBe(false);
      expect(after.changes).toEqual(today.changes);
    }
  });

  it('the same task, where reports 3 and 4 were sent on this build: report 4 says "is back ... moved from 60% to 70%", as before', () => {
    const { state, four } = paintIsBack([1, 2]);
    expect(four.ofPaint).toEqual(IS_BACK);
    for (const screen of [report, webPage]) {
      const again = screen(state, four.sent, AGAIN);
      expect([again.readsAsAlreadySent, again.ofPaint]).toEqual([true, IS_BACK]);
      // And the late edit makes it another report, offered once (R8 item 3, unchanged).
      expect(screen(lateEdit(state), four.sent, AGAIN).readsAsAlreadySent).toBe(false);
    }
  });

  it('the first report made on this build, counted from Build 230\'s report 3: "was added", the same before and after it is sent', () => {
    const { state, three, four } = paintIsBack([1, 2, 3]);
    expect(three.sent.sourceFingerprint).toMatch(EARLIER_VERSION);
    expect(four.sent.sourceFingerprint).not.toMatch(EARLIER_VERSION);
    expect(four.ofPaint).toEqual(WAS_ADDED);
    for (const screen of [report, webPage]) {
      expect(screen(state, three.sent, AGAIN).ofPaint).toEqual(WAS_ADDED);
      const sent = screen(state, four.sent, AGAIN);
      expect([sent.readsAsAlreadySent, sent.ofPaint]).toEqual([true, WAS_ADDED]);
    }
  });

  it('after the update the same task leaves and comes back again: counted from reports sent on this build, "is back ... moved from 70% to 80%"', () => {
    const handedOver = paintIsBack([1, 2, 3, 4]);
    let state = approve(handedOver.state, master('MASTER M5', '2026-09-11T16:00:00.000Z'), TASKS);
    const five = report(state, handedOver.four.sent, '2026-09-11T22:00:00.000Z');
    expect(five.ofPaint).toEqual(['Paint was removed from the current project plan.']);
    state = records(state, shown(state).find(item => item.taskName === 'Framing')!.id, 50, '2026-09-12T18:00:00.000Z');
    const six = report(state, five.sent, '2026-09-12T22:00:00.000Z');
    state = approve(state, master('MASTER M7', '2026-09-13T16:00:00.000Z'), [PAINT('10/05/2026', '10/09/2026'), ...TASKS]);
    state = records(state, shown(state).find(item => item.taskName === 'Paint')!.id, 80, '2026-09-13T18:00:00.000Z');
    const seven = report(state, six.sent, '2026-09-13T22:00:00.000Z');
    expect(seven.ofPaint).toEqual(['Paint is back in the project plan.', 'Paint moved from 70% to 80% complete.', 'Paint finish changed from 10/02/2026 to 10/09/2026.']);
    expect(webPage(state, six.sent, '2026-09-13T22:00:00.000Z').ofPaint).toEqual(seven.ofPaint);
  });

  it('R10: what is read from the SAVED report before is untouched: counted from Build 230\'s reports, the first report on this build says "is back ... moved from 60% to 70%", whatever the hidden row says now', () => {
    // Master 1 lists Paint (60%), report 1. Master 2 leaves it out, report 2. Master 3 lists it again (70%), report 3: the
    // report before the one it counts from still has Paint, and "how it last stood" is read there. All on Build 230.
    // (This read report 3 again under its 1.0 name. Now: the update comes before report 3, which this build makes.)
    let state = approve({ items: [], documents: [] }, master('MASTER M1', '2026-09-07T16:00:00.000Z'), [PAINT('09/21/2026', '09/25/2026'), ...TASKS]);
    state = records(state, 'MASTER M1-1', 60, '2026-09-07T18:00:00.000Z');
    const one = asBuild230SavedIt(report(state, null, '2026-09-07T22:00:00.000Z'));
    state = approve(state, master('MASTER M2', '2026-09-08T16:00:00.000Z'), TASKS);
    const two = asBuild230SavedIt(report(state, one.sent, '2026-09-08T22:00:00.000Z'));
    state = approve(state, master('MASTER M3', '2026-09-09T16:00:00.000Z'), [PAINT('09/28/2026', '10/02/2026'), ...TASKS]);
    state = records(state, shown(state).find(item => item.taskName === 'Paint')!.id, 70, '2026-09-09T18:00:00.000Z');
    for (const screen of [report, webPage]) {
      const today = screen(state, two.sent, '2026-09-09T22:30:00.000Z');
      expect([today.readsAsAlreadySent, today.ofPaint]).toEqual([false, IS_BACK]);
      const after = screen(lateEdit(state), two.sent, '2026-09-09T22:30:00.000Z');
      expect([after.readsAsAlreadySent, after.ofPaint]).toEqual([false, IS_BACK]);
    }
    // And Build 230's own report 3, saved under its 1.0 name, is not taken for today's (it said "known ... is back").
    const three = asBuild230SavedIt(report(state, two.sent, '2026-09-09T22:00:00.000Z'));
    expect(report(state, three.sent, '2026-09-09T22:30:00.000Z').readsAsAlreadySent).toBe(false);
  });

  it('R10: a task a revised master only moved: Build 230\'s report is not taken for today\'s either (this said "known to the byte ... the hand-over is kept"); counted from it nothing is said of Paint', () => {
    let state = approve({ items: [], documents: [] }, master('MASTER M1', '2026-09-07T16:00:00.000Z'), [PAINT('09/21/2026', '09/25/2026'), ...TASKS]);
    state = records(state, 'MASTER M1-1', 60, '2026-09-07T18:00:00.000Z');
    const one = asBuild230SavedIt(report(state, null, '2026-09-07T22:00:00.000Z'));
    state = approve(state, master('MASTER M2', '2026-09-08T16:00:00.000Z'), [PAINT('09/28/2026', '10/02/2026'), ...TASKS]);
    state = records(state, shown(state).find(item => item.taskName === 'Paint')!.id, 70, '2026-09-08T18:00:00.000Z');
    const two = asBuild230SavedIt(report(state, one.sent, '2026-09-08T22:00:00.000Z'));
    // The facts hold an earlier row for Paint, as for a task that is back; the report does not read it.
    expect(two.truths[0].earlierRows?.map(row => row.earlierTaskId)).toEqual(['MASTER M1-1']);
    expect(two.ofPaint).toEqual(['Paint moved from 60% to 70% complete.', 'Paint finish changed from 09/25/2026 to 10/02/2026.']);
    for (const screen of [report, webPage]) {
      const today = screen(state, two.sent, '2026-09-08T22:30:00.000Z');
      expect(today.readsAsAlreadySent).toBe(false);
      expect(today.ofPaint).toEqual([]);
    }
  });

  it('the comparison itself: counted from a 1.0 report, or told today\'s report is read as one, it reads no live earlier row; otherwise it does', () => {
    const { state, three, four } = paintIsBack([]);
    const current = buildDAVEReportSnapshot({ truths: four.truths, scopeKey: daveReportSnapshotScopeKey(['Alpha']), sourceFingerprint: four.fingerprint, capturedAt: AGAIN });
    const earlierRows = reportTaskEarlierRows(four.truths);
    const says = (previous: DAVEReportSnapshot, readAs: boolean) => compareDAVEReportSnapshots({ current, previous, earlierRows, currentReadAsEarlierVersionReport: readAs })
      .changes.map(change => change.summary).filter(line => line.startsWith('Paint'));
    expect(shown(state).some(item => item.taskName === 'Paint')).toBe(true);
    expect(says(three.sent, false)).toEqual(IS_BACK);
    expect(says(three.sent, true)).toEqual(WAS_ADDED);
    expect(says({ ...three.sent, sourceFingerprint: 'dave-report-source/1.0:abc' }, false)).toEqual(WAS_ADDED);
    // The web's longer saved fingerprint ("<facts>:media-...") is read by its facts part.
    expect(says({ ...three.sent, sourceFingerprint: 'dave-report-source/1.0:abc:media-def' }, false)).toEqual(WAS_ADDED);
  });

  it('R10: "read as a report an earlier build saved" is never so now: no 1.0 fingerprint is a name of today\'s facts (this said it was, for Build 230\'s report 4); the question is left in place', () => {
    const { state, three, four } = paintIsBack([4]);
    const today = buildDAVEReportSourceFingerprint(truthsOf(state, AGAIN));
    expect(reportReadAsEarlierVersionReport(four.sent, today)).toBe(false);
    expect(reportReadAsEarlierVersionReport(three.sent, today)).toBe(false); // another report, and of this build
    expect(reportReadAsEarlierVersionReport({ ...four.sent, sourceFingerprint: today }, today)).toBe(false); // the same report saved by this build
    expect(reportReadAsEarlierVersionReport({ ...four.sent, sourceFingerprint: 'dave-report-source/1.0:other' }, today)).toBe(false); // a 1.0 report of other facts
    expect(reportReadAsEarlierVersionReport(null, today)).toBe(false);
    // The web's page is told the same by the period on its tab.
    const tab = (saved: DAVEReportSnapshot | null) => daveWebReportPeriodState({ read: { status: 'loaded', snapshot: saved, shared: 'checked', approvalSavedHere: false }, fingerprint: today, pulledAt: AGAIN }).readAsEarlierVersionReport;
    expect([tab(four.sent), tab(three.sent), tab(null)]).toEqual([false, false, false]);
    expect(daveWebReportPeriodState({ read: { status: 'loading' }, fingerprint: today, pulledAt: AGAIN }).readAsEarlierVersionReport).toBe(false);
  });

  it('pins: both screens tell the report so where they choose what it counts from', () => {
    const source = (file: string) => fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8').replace(/\s+/g, ' ');
    expect(source('screens/ReportsScreen.tsx')).toContain('readAsEarlierVersionReport: reportReadAsEarlierVersionReport(previousReportSnapshot, reportSourceFingerprint),');
    expect(source('components/web-shell/desktop-read-only-shell.tsx')).toContain('readAsEarlierVersionReport: periodReadAsEarlierVersionReport,');
    expect(source('components/web-shell/desktop-read-only-shell.tsx')).toContain('const periodReadAsEarlierVersionReport = period.readAsEarlierVersionReport;');
    expect(source('services/DAVEWebOperations.ts')).toContain('readAsEarlierVersionReport: period?.readAsEarlierVersionReport ?? false,');
  });
});
