/**
 * R8 item 3 (the coordinator's decision on review pass 2, P2-3; High by the
 * false-match rule, caused by R5 item 1).
 *
 * A report that says a task is back in the project plan also says what
 * changed on it since it last stood ("Paint moved from 60% to 70%
 * complete."), and reads "how it last stood" from the row the task left on:
 * a hidden row, as it is saved now. That row was in no fingerprint. An edit
 * made to it on a device that had not yet heard of the newer master arrives
 * later, and the same report, still shown as already sent, said "from 50%".
 *
 * The decision: everything the returning-task sentences read is in version
 * 2.0 of the fingerprint. A change to any value they read makes it another
 * report, which is offered once.
 *
 * The real CSV reader (with Unique IDs), import merge, shown list, the one
 * report recipe and the report's comparison. Synthetic data.
 */
import { buildDAVELegacyReportSourceFingerprint, buildDAVEReportBriefing, buildDAVEReportSourceFingerprint } from '../../services/DAVEReportIntelligence';
import { buildDAVEReportProjectTruths } from '../../services/DAVEReportProjectTruths';
import {
  buildDAVEReportSnapshot, daveReportSnapshotScopeKey, markReportSnapshotDelivered, reportBaselineSnapshot, reportSnapshotToSave, type DAVEReportSnapshot,
} from '../../services/DAVEReportSnapshot';
import { reconcileDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';
import { buildDAVEWebReportTruths } from '../../services/DAVEWebOperations';
import type { DAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
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
/** The Reports screen for this saved data and saved period. */
function report(state: State, saved: DAVEReportSnapshot | null, at: string) {
  const truths = truthsOf(state, at);
  const fingerprint = buildDAVEReportSourceFingerprint(truths);
  const briefing = buildDAVEReportBriefing({ truths, selectedProjectNames: ['Alpha'], previousSnapshot: reportBaselineSnapshot(saved, fingerprint), scheduleItems: shown(state) });
  const snapshot = buildDAVEReportSnapshot({ truths, scopeKey: daveReportSnapshotScopeKey(['Alpha']), sourceFingerprint: fingerprint, capturedAt: at, reportFormat: 'project_manager' });
  const toSave = reportSnapshotToSave(snapshot, saved);
  return {
    truths, fingerprint,
    sent: (toSave ? markReportSnapshotDelivered(toSave, at, 'phone') : saved) as DAVEReportSnapshot,
    readsAsAlreadySent: Boolean(saved) && toSave === null,
    /** What the report says of Paint since the last report. */
    ofPaint: briefing.reportingPeriod.changes.map(change => String(change.summary)).filter(line => line.startsWith('Paint')),
  };
}

const TASKS = ['Drywall,Alpha,Lot,10/01/2026,10/04/2026,,102', 'Framing,Alpha,Lot,09/14/2026,09/18/2026,,103'];
/**
 * Master 1 lists Paint; he records 60% and report 1 is sent. Master 2 leaves Paint out: report 2 says it was removed,
 * and report 3 goes out. Master 4 lists Paint again, the same task by its Unique ID; he records 70%, and report 4,
 * "Paint is back ... moved from 60% to 70%", is sent.
 */
function paintIsBack() {
  let state = approve({ items: [], documents: [] }, master('MASTER M1', '2026-09-07T16:00:00.000Z'), ['Paint,Alpha,Lot,09/21/2026,09/25/2026,,101', ...TASKS]);
  state = records(state, 'MASTER M1-1', 60, '2026-09-07T18:00:00.000Z');
  const one = report(state, null, '2026-09-07T22:00:00.000Z');
  state = approve(state, master('MASTER M2', '2026-09-08T16:00:00.000Z'), TASKS);
  const two = report(state, one.sent, '2026-09-08T22:00:00.000Z');
  state = records(state, shown(state).find(item => item.taskName === 'Framing')!.id, 30, '2026-09-09T18:00:00.000Z');
  const three = report(state, two.sent, '2026-09-09T22:00:00.000Z');
  state = approve(state, master('MASTER M4', '2026-09-10T16:00:00.000Z'), ['Paint,Alpha,Lot,09/28/2026,10/02/2026,,101', ...TASKS]);
  state = records(state, shown(state).find(item => item.taskName === 'Paint')!.id, 70, '2026-09-10T18:00:00.000Z');
  const four = report(state, three.sent, '2026-09-10T22:00:00.000Z');
  return { state, two, three, four };
}
const AGAIN = '2026-09-10T22:30:00.000Z'; // the same evening: no date in the report has moved

describe('R8 item 3: what a report says of a task that is back is read from a row the fingerprint holds', () => {
  it('(the rig) report 2 said Paint was removed; report 4 says it is back and what changed since it last stood, read from its hidden first row', () => {
    const { state, two, four } = paintIsBack();
    expect(two.ofPaint).toEqual(['Paint was removed from the current project plan.']);
    expect(four.ofPaint).toEqual(['Paint is back in the project plan.', 'Paint moved from 60% to 70% complete.', 'Paint finish changed from 09/25/2026 to 10/02/2026.']);
    expect(shown(state).map(item => item.id)).not.toContain('MASTER M1-1');
    expect(four.truths[0].earlierRows?.map(row => [row.earlierTaskId, row.percentComplete])).toEqual([['MASTER M1-1', 60]]);
    // Opened again with nothing changed: the report already sent, as it was sent.
    const again = report(state, four.sent, AGAIN);
    expect([again.readsAsAlreadySent, again.ofPaint]).toEqual([true, four.ofPaint]);
  });

  it('the iPad, offline since before master 2, syncs an edit it had made to Paint\'s old row (50%): the report still says what report 1 listed, and it is offered once (7.17)', () => {
    const { state, three, four } = paintIsBack();
    const late = withRow(state, 'MASTER M1-1', { percentComplete: 50, progressConfirmedAt: '2026-09-08T09:00:00.000Z', updatedAt: '2026-09-08T09:00:00.000Z' });
    // Nothing he sees in the task list has changed.
    expect(shown(late).map(item => [item.id, item.percentComplete])).toEqual(shown(state).map(item => [item.id, item.percentComplete]));
    // The sentence was read from that row, and said "from 50%" (review pass 2, P2-3). Open item 7.17 (13 Oct 2026):
    // it is read from how report 1 listed Paint, kept with the reports since (saved, it cannot change under him), so
    // written again against the same period as report 4 it says what report 4 said. Expectation moved deliberately.
    expect(report(late, three.sent, AGAIN).ofPaint).toEqual(['Paint is back in the project plan.', 'Paint moved from 60% to 70% complete.', 'Paint finish changed from 09/25/2026 to 10/02/2026.']);
    // The fingerprint still holds the row, so it is not taken for the report he sent: offered once (the safe side).
    const again = report(late, four.sent, AGAIN);
    expect(again.fingerprint).not.toBe(four.fingerprint);
    expect(again.readsAsAlreadySent).toBe(false);
    // It is offered once, counted from the report he sent, and says nothing more of Paint: his list has not changed.
    expect(again.ofPaint).toEqual([]);
  });

  it.each([
    ['its percent', { percentComplete: 50 }],
    ['its status', { status: 'Waiting' }],
    ['its finish date', { finishDate: '09/26/2026' }],
    ['its owner', { owner: 'Dana' }],
    ['its contractor, when it has no owner', { contractor: 'Northside Painting' }],
    ['its approval status', { projectControls: { ...normalizeProjectControls(undefined), approvalStatus: 'Approved' } }],
    ['its schedule impact', { projectControls: { ...normalizeProjectControls(undefined), estimatedScheduleImpactDays: 3 } }],
    ['its name', { taskName: 'Painting' }],
    ['its area', { locationName: 'Deck' }],
    ['when it was imported', { importedAt: '2026-09-06T16:00:00.000Z' }],
    ['that a lookahead had added it', { importedAsLookahead: true }],
  ])('a change to any value those sentences read on the old row moves the fingerprint: %s', (_what, change) => {
    const { state, four } = paintIsBack();
    const changed = report(withRow(state, 'MASTER M1-1', change as Partial<ScheduleItem>), four.sent, AGAIN);
    expect(changed.fingerprint).not.toBe(four.fingerprint);
    expect(changed.readsAsAlreadySent).toBe(false);
  });

  it('and so does the old row being deleted (its schedule file removed with its tasks)', () => {
    const { state, four } = paintIsBack();
    const gone: State = { ...state, items: state.items.filter(item => item.id !== 'MASTER M1-1') };
    const changed = report(gone, four.sent, AGAIN);
    expect(changed.ofPaint).not.toEqual(four.ofPaint);
    expect(changed.fingerprint).not.toBe(four.fingerprint);
  });

  it('guard: what those sentences do not read leaves the report the one already sent: the old row\'s priority, its next action, its notes field, its own last-saved time', () => {
    const { state, four } = paintIsBack();
    for (const change of [{ priority: 'High' }, { nextAction: 'Call the painter' }, { notes: 'Two coats.' }, { updatedAt: '2026-09-08T09:00:00.000Z' }] as Partial<ScheduleItem>[]) {
      const again = report(withRow(state, 'MASTER M1-1', change), four.sent, AGAIN);
      expect([again.fingerprint, again.readsAsAlreadySent, again.ofPaint]).toEqual([four.fingerprint, true, four.ofPaint]);
    }
  });

  it('guard: a hidden row that no task shown answers to is not held: a change to it changes no report', () => {
    const { state, four } = paintIsBack();
    const stray = { ...state.items.find(item => item.id === 'MASTER M1-1')!, id: 'STRAY-1', taskName: 'Old survey', revisedFromTaskIds: undefined } as ScheduleItem;
    const withStray: State = { ...state, items: [...state.items, stray] };
    const before = report(withStray, four.sent, AGAIN);
    const after = report(withRow(withStray, 'STRAY-1', { percentComplete: 10 }), four.sent, AGAIN);
    expect(after.fingerprint).toBe(before.fingerprint);
    expect(after.ofPaint).toEqual(before.ofPaint);
  });

  it('the phone and the web hold the same earlier rows, and give the report one fingerprint', () => {
    const { state, four } = paintIsBack();
    const web = buildDAVEWebReportTruths({
      projects: [{ id: 'project-alpha-id', name: 'Alpha' }], scheduleItems: shown(state), knownScheduleItems: state.items,
      projectUpdates: [], referenceDocuments: state.documents, refreshedAt: AGAIN,
    } as unknown as DAVEWebReadOnlySnapshot, 'Alpha');
    expect(web[0].earlierRows).toEqual(four.truths[0].earlierRows);
    expect(buildDAVEReportSourceFingerprint(web)).toBe(four.fingerprint);
  });

  it('version 1.0 is as it was: the earlier rows are in today\'s version only', () => {
    const { state, four } = paintIsBack();
    const late = withRow(state, 'MASTER M1-1', { percentComplete: 50 });
    expect(buildDAVELegacyReportSourceFingerprint(truthsOf(late, AGAIN))).toBe(buildDAVELegacyReportSourceFingerprint(four.truths));
  });
});
