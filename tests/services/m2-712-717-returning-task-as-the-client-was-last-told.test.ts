/**
 * Open items 7.12 and 7.17 (reports review pass 5, F2 and F6; the owner's authorisation of 13 Oct 2026): a task that
 * comes back into the project plan is told to the client as he was last told of it.
 *
 * 7.12 (F2): "<task> is back in the project plan." and "<task> finish changed from <date>" were said of a task NO
 *   report ever listed: it was put in the plan and taken out again between two reports, and the rule could only ask
 *   whether the row it left on was saved before the last report. The client was never given that date.
 * 7.17 (F6): a task out of the plan for two or more reports that came back on a row saved before the last report
 *   read "was added", though a report he holds listed it and a later one said it was removed, and what changed since
 *   it last stood was not said.
 *
 * Now each report saved keeps, with the period, the tasks earlier reports listed that its own plan does not hold,
 * each as the last report that listed it had it (`outOfPlan`, carried from report to report until the task is back;
 * the shared report record keeps the snapshot as it is: no database change). A task back in the plan is "back" and
 * compared with that, or, when no report listed it, "added". A report saved before this change reads as before.
 * The reviewer's own rig (notes/p5-reports/rv-back-never-listed.test.ts: the app's CSV import, merge, shown list and
 * report recipe) is kept below. Made-up names.
 */
import { buildDAVEProjectTruth } from '../../services/DAVEProjectTruth';
import * as RI from '../../services/DAVEReportIntelligence';
import * as RS from '../../services/DAVEReportSnapshot';
import { reconcileDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import * as Merge from '../../services/ScheduleImportMerge';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';
import { normalizeProjectControls } from '../../services/VitruviusProjectControls';
import { buildDAVEReportProjectTruths } from '../../services/DAVEReportProjectTruths';
import type { ReferenceDocument, ScheduleItem } from '../../types';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined),
  getAllKeys: jest.fn(async () => []), multiGet: jest.fn(async () => []),
}));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));

// ---------------------------------------------------------------------------------------------------------------
// The rule, on saved reports (the period's own objects, sent one after another as the app saves and marks them).
// ---------------------------------------------------------------------------------------------------------------
type Task = RS.DAVEReportSnapshotTask;
const t = (taskId: string, taskName: string, percent: number, finish: string): Task => Object.freeze({
  taskId, projectName: 'Alpha', taskName, areaName: 'Lot', owner: 'Sam', status: percent >= 100 ? 'Complete' : 'In Progress',
  percentComplete: percent, finishDate: finish, urgency: 'not_urgent', approvalStatus: null, estimatedScheduleImpactDays: null,
});
let fingerprints = 0;
const facts = (at: string, tasks: Task[]): RS.DAVEReportSnapshot => Object.freeze({
  ...RS.buildDAVEReportSnapshot({ truths: [], scopeKey: 'alpha', sourceFingerprint: `dave-report-source/3.0:f${(fingerprints += 1)}`, capturedAt: at, reportFormat: 'project_manager' }),
  tasks: Object.freeze(tasks),
});
/** The report on `current`'s facts against the period `saved`: what it says. */
const said = (current: RS.DAVEReportSnapshot, saved: RS.DAVEReportSnapshot | null, earlierRows: RS.DAVEReportTaskEarlierRow[] = []) =>
  RS.compareDAVEReportSnapshots({ current, previous: RS.reportBaselineSnapshot(saved, current.sourceFingerprint), earlierRows })
    .changes.map(change => change.summary);
/** Approved and sent: the period's report from now on. */
const send = (current: RS.DAVEReportSnapshot, saved: RS.DAVEReportSnapshot | null) =>
  RS.markReportSnapshotDelivered(RS.reportSnapshotToSave(current, saved) as RS.DAVEReportSnapshot, current.capturedAt, 'phone');
/** The same report as a build before this change saved it: no record of the tasks out of the plan. */
const asBefore = (saved: RS.DAVEReportSnapshot): RS.DAVEReportSnapshot => {
  const { outOfPlan: _record, supersedes, ...report } = saved as RS.DAVEReportSnapshot & { outOfPlan?: unknown };
  if (!supersedes) return Object.freeze(report) as RS.DAVEReportSnapshot;
  const { outOfPlan: _olderRecord, ...before } = supersedes as RS.DAVEReportSnapshot & { outOfPlan?: unknown };
  return Object.freeze({ ...report, supersedes: before }) as RS.DAVEReportSnapshot;
};
const FRAMING = t('101', 'Framing', 40, '09/18/2026');
const ROOFING = t('102', 'Roofing', 0, '09/25/2026');

describe('7.17 (F6): a task out of the plan for two or more reports is back, as the client was last told of it', () => {
  const PAINT = t('103', 'Paint', 60, '10/30/2026');
  const r1 = send(facts('2026-09-07T22:00:00.000Z', [FRAMING, ROOFING, PAINT]), null);
  const r2Facts = facts('2026-09-14T22:00:00.000Z', [FRAMING, ROOFING]);
  const r2 = send(r2Facts, r1);
  const r3 = send(facts('2026-09-21T22:00:00.000Z', [FRAMING, ROOFING]), r2);

  it('report 2 said it was removed, report 3 said nothing of it', () => {
    expect(said(r2Facts, r1)).toContain('Paint was removed from the current project plan.');
    expect(said(facts('2026-09-21T22:00:00.000Z', [FRAMING, ROOFING]), r2).filter(line => line.includes('Paint'))).toEqual([]);
  });

  it('back on its own row as it stood: "is back", nothing else (it read "was added")', () => {
    expect(said(facts('2026-09-28T22:00:00.000Z', [FRAMING, ROOFING, PAINT]), r3).filter(line => line.includes('Paint')))
      .toEqual(['Paint is back in the project plan.']);
  });

  it('back with what he changed since: "is back", and each change from how report 1 listed it', () => {
    const back = t('103', 'Paint', 70, '11/06/2026');
    expect(said(facts('2026-09-28T22:00:00.000Z', [FRAMING, ROOFING, back]), r3).filter(line => line.includes('Paint'))).toEqual([
      'Paint is back in the project plan.',
      'Paint moved from 60% to 70% complete.',
      'Paint finish changed from 10/30/2026 to 11/06/2026.',
    ]);
  });

  it('out for four reports: still known as report 1 listed it; once back, it is no longer carried', () => {
    const r4 = send(facts('2026-09-28T22:00:00.000Z', [FRAMING, ROOFING]), r3);
    const r5 = send(facts('2026-10-05T22:00:00.000Z', [FRAMING, ROOFING]), r4);
    const backFacts = facts('2026-10-12T22:00:00.000Z', [FRAMING, ROOFING, PAINT]);
    expect(said(backFacts, r5).filter(line => line.includes('Paint'))).toEqual(['Paint is back in the project plan.']);
    const r6 = send(backFacts, r5);
    expect((r6 as RS.DAVEReportSnapshot & { outOfPlan?: { tasks: Task[] } }).outOfPlan?.tasks.map(task => task.taskName)).toEqual([]);
  });

  it('the same, approved and not yet sent, then sent: one text', () => {
    const backFacts = facts('2026-09-28T22:00:00.000Z', [FRAMING, ROOFING, PAINT]);
    const approved = RS.reportSnapshotToSave(backFacts, r3) as RS.DAVEReportSnapshot;
    const sent = RS.markReportSnapshotDelivered(approved, backFacts.capturedAt, 'phone');
    expect(said(backFacts, approved)).toEqual(said(backFacts, r3));
    expect(said(backFacts, sent)).toEqual(said(backFacts, r3));
  });
});

describe('7.12 (F2): a task no report ever listed is "added", never "back"', () => {
  const ELECTRICAL_ROW_TUE: RS.DAVEReportTaskEarlierRow = Object.freeze({
    taskId: '203', earlierTaskId: '203-tue', savedAt: '2026-09-08T16:00:00.000Z', taskSavedAt: '2026-09-11T16:00:00.000Z',
    projectName: 'Alpha', taskName: 'Electrical rough', areaName: 'Lot', owner: 'Sam', status: 'Not Started',
    percentComplete: 0, finishDate: '09/19/2026', approvalStatus: null, estimatedScheduleImpactDays: null,
  });
  const ELECTRICAL = t('203', 'Electrical rough', 10, '09/21/2026');
  const r1 = send(facts('2026-09-07T22:00:00.000Z', [FRAMING, ROOFING]), null);
  // Tue a master adds it, Wed a corrected master leaves it out: report 2 is made Thu without it.
  const r2 = send(facts('2026-09-10T22:00:00.000Z', [FRAMING, ROOFING]), r1);
  const r3Facts = facts('2026-09-12T22:00:00.000Z', [FRAMING, ROOFING, ELECTRICAL]);

  it('report 3: "was added", and no change from a date the client was never given', () => {
    expect(said(r3Facts, r2, [ELECTRICAL_ROW_TUE]).filter(line => line.includes('Electrical rough')))
      .toEqual(['Electrical rough was added to the project plan.']);
  });

  it('against reports saved before this change it reads as it did (the rule as it was)', () => {
    expect(said(r3Facts, asBefore(r2), [ELECTRICAL_ROW_TUE]).filter(line => line.includes('Electrical rough'))).toEqual([
      'Electrical rough is back in the project plan.',
      'Electrical rough moved from 0% to 10% complete.',
      'Electrical rough changed from Not Started to In Progress.',
      'Electrical rough finish changed from 09/19/2026 to 09/21/2026.',
    ]);
  });

  it('a task listed before the record began, out since, still reads by its saved row (the rule as it was)', () => {
    // Report 1 was saved by a build before this change and listed Paint; report 2 (also before) said it removed;
    // report 3 is this build's first, so its record begins with report 2. Paint's row was saved before report 1.
    const PAINT_ROW: RS.DAVEReportTaskEarlierRow = Object.freeze({
      ...ELECTRICAL_ROW_TUE, taskId: '303', earlierTaskId: '303-old', savedAt: '2026-09-01T16:00:00.000Z', taskSavedAt: '2026-09-25T16:00:00.000Z',
      taskName: 'Paint', percentComplete: 60, status: 'In Progress', finishDate: '10/30/2026',
    });
    const old1 = asBefore(send(facts('2026-09-07T22:00:00.000Z', [FRAMING, ROOFING, t('303-old', 'Paint', 60, '10/30/2026')]), null));
    const old2 = asBefore(send(facts('2026-09-14T22:00:00.000Z', [FRAMING, ROOFING]), old1));
    const new3 = send(facts('2026-09-21T22:00:00.000Z', [FRAMING, ROOFING]), old2);
    expect(said(facts('2026-09-28T22:00:00.000Z', [FRAMING, ROOFING, t('303', 'Paint', 70, '10/30/2026')]), new3, [PAINT_ROW])
      .filter(line => line.includes('Paint'))).toEqual(['Paint is back in the project plan.', 'Paint moved from 60% to 70% complete.']);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The reviewer's rig (review pass 5, F2), kept: the app's own CSV import, merge, shown list and report recipe.
// ---------------------------------------------------------------------------------------------------------------
type State = { items: ScheduleItem[]; documents: ReferenceDocument[] };
const shown = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents }) as ScheduleItem[];
const master = (id: string, importedAt: string): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`,
}) as ReferenceDocument;
/** Approving a master on the phone (App.tsx): the review's questions answered as `answer` says, the merge, the saved rows. */
function approve(state: State, source: ReferenceDocument, lines: string[], answer: 'the app\'s guess' | 'The same task' = 'the app\'s guess'): State {
  const imported = (normalizeScheduleImport({
    contents: ['Task,Project,Area,Start,Finish,Percent Complete,Unique ID', ...lines].join('\n'), sourceName: source.originalFileName,
    mimeType: 'text/csv', projects: ['Alpha'], projectAreas: [], now: new Date(source.importedAt),
  } as never).items as ScheduleItem[]).map((item, index) => ({ ...item, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id }));
  let pairingChoices: Record<string, string | null> | undefined;
  (Merge.scheduleImportReviewPairingQuestions({ saved: state.items, documents: [...state.documents, source], importBatchId: source.importBatchId, imported, overlay: false } as never) as unknown as Array<{ returning?: boolean; rows: ScheduleItem[]; saved: ScheduleItem[]; guess: Record<string, string | null> }>).forEach(question => {
    const chosen = answer === 'The same task' && question.returning
      ? Object.fromEntries(question.rows.map((row, index) => [row.id, question.saved[index]?.id ?? null]))
      : question.guess;
    pairingChoices = { ...(pairingChoices || {}), ...chosen };
  });
  const merged = (Merge.mergeApprovedScheduleImportItems as unknown as (args: Record<string, unknown>) => { additions: ScheduleItem[]; next: ScheduleItem[] })({
    existing: state.items, imported, completionMatch: () => null, mergeCompletion: (item: ScheduleItem) => item,
    isCurrent: Merge.scheduleItemsVisibleBeforeImport(state.items, [...state.documents, source], source.importBatchId || ''),
    approvedAt: source.importedAt, overlay: false, ...(pairingChoices ? { pairingChoices } : {}),
  });
  const asSaved = (item: ScheduleItem) => ({ ...item, projectControls: normalizeProjectControls((item as { projectControls?: unknown }).projectControls as never), activity: (item as { activity?: unknown[] }).activity ?? [] }) as ScheduleItem;
  return {
    items: reconcileDAVEScheduleRecords([...merged.additions.map(asSaved), ...merged.next]) as ScheduleItem[],
    documents: scheduleDocumentsAfterActivation(source, [...state.documents, source], 'project'),
  };
}
/** The report as Reports writes it against the saved period; approved and sent. */
function report(state: State, saved: RS.DAVEReportSnapshot | null, at: string) {
  const items = shown(state);
  const truths = buildDAVEReportProjectTruths({
    projects: [{ name: 'Alpha', projectId: 'report:alpha' }], projectRecords: [{ name: 'Alpha' }], updates: [], scheduleItems: items,
    knownScheduleItems: state.items, knownScheduleDocuments: state.documents, projectAreas: [], referenceDocuments: state.documents, now: at,
  } as never);
  void buildDAVEProjectTruth;
  const fingerprint = RI.buildDAVEReportSourceFingerprint(truths);
  const briefing = RI.buildDAVEReportBriefing({ truths, selectedProjectNames: ['Alpha'], previousSnapshot: RS.reportBaselineSnapshot(saved, fingerprint), scheduleItems: items } as never);
  const snapshot = RS.buildDAVEReportSnapshot({ truths, scopeKey: RS.daveReportSnapshotScopeKey(['Alpha']), sourceFingerprint: fingerprint, capturedAt: at, reportFormat: 'project_manager' });
  const sent = RS.markReportSnapshotDelivered(RS.reportSnapshotToSave(snapshot, saved) as RS.DAVEReportSnapshot, at, 'phone');
  return { sent, listed: items.map(item => item.taskName).sort(), said: briefing.reportingPeriod.changes.map(change => change.summary) };
}

describe('the reviewer\'s rig: F2 through the app\'s own import and report recipe', () => {
  const run = (answer: 'the app\'s guess' | 'The same task', withIds: boolean) => {
    const id = (value: string) => (withIds ? value : '');
    let state: State = { items: [], documents: [] };
    state = approve(state, master('MASTER M1', '2026-09-07T16:00:00.000Z'), [`Framing,Alpha,Lot,09/14/2026,09/18/2026,,${id('101')}`, `Roofing,Alpha,Lot,09/21/2026,09/25/2026,,${id('102')}`]);
    const first = report(state, null, '2026-09-07T22:00:00.000Z');
    state = approve(state, master('MASTER M2', '2026-09-08T16:00:00.000Z'), [`Framing,Alpha,Lot,09/14/2026,09/18/2026,,${id('101')}`, `Roofing,Alpha,Lot,09/21/2026,09/25/2026,,${id('102')}`, `Electrical rough,Alpha,Lot,09/12/2026,09/19/2026,,${id('103')}`]);
    state = approve(state, master('MASTER M3', '2026-09-09T16:00:00.000Z'), [`Framing,Alpha,Lot,09/14/2026,09/18/2026,,${id('101')}`, `Roofing,Alpha,Lot,09/21/2026,09/25/2026,,${id('102')}`]);
    const second = report(state, first.sent, '2026-09-10T22:00:00.000Z');
    state = approve(state, master('MASTER M4', '2026-09-11T16:00:00.000Z'), [`Framing,Alpha,Lot,09/14/2026,09/18/2026,,${id('101')}`, `Roofing,Alpha,Lot,09/21/2026,09/25/2026,,${id('102')}`, `Electrical rough,Alpha,Lot,09/12/2026,09/21/2026,,${id('103')}`], answer);
    const third = report(state, second.sent, '2026-09-12T22:00:00.000Z');
    return { first, second, third };
  };

  it.each([
    ['files with Unique IDs (no question is asked)', 'the app\'s guess', true],
    ['files without Unique IDs, he answers "The same task"', 'The same task', false],
  ] as const)('%s: a reader who holds reports 1 and 2 has never seen the task, so report 3 says it was added', (_name, answer, withIds) => {
    const { first, second, third } = run(answer, withIds);
    expect(first.listed).toEqual(['Framing', 'Roofing']);
    expect(second.listed).toEqual(['Framing', 'Roofing']);
    expect(second.said.filter(line => line.includes('Electrical rough'))).toEqual([]);
    expect(third.listed).toEqual(['Electrical rough', 'Framing', 'Roofing']);
    expect(third.said.filter(line => line.includes('Electrical rough'))).toEqual(['Electrical rough was added to the project plan.']);
  });
});
