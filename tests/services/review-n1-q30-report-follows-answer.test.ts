import { buildDAVEProjectTruth } from '../../services/DAVEProjectTruth';
import { buildDAVEReportBriefing, buildDAVEReportSourceFingerprint } from '../../services/DAVEReportIntelligence';
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
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import {
  mergeApprovedScheduleImportItems,
  scheduleImportPairingQuestions,
  scheduleItemsVisibleBeforeImport,
  scheduleProgressCarriedOnActivation,
} from '../../services/ScheduleImportMerge';
import { scheduleTaskLinks } from '../../services/ScheduleTaskRevisions';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';
import type { ReferenceDocument, ScheduleItem } from '../../types';

/**
 * Review N1 M3 (3 Oct 2026, caused by 9a1c22d; the name pairing is older).
 * Owner answer Q30: the import review asks which same-named task is which.
 * When David answered "the first Pour slab was dropped, and this row is a
 * new one", the task list followed him, but the written report still paired
 * the new row with the dropped task by name: "Pour slab moved from 80% to 0%
 * complete.", "changed from In Progress to Not Started.", "finish changed
 * from 10/09/2026 to 10/23/2026." The report now follows his answer: the
 * dropped task is removed, the new one added, and no change is said between
 * them. The real CSV normalizer, merge, activation and report. Synthetic data.
 */

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));

type State = { items: ScheduleItem[]; documents: ReferenceDocument[] };
const EMPTY: State = { items: [], documents: [] };
const shown = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents }) as ScheduleItem[];

const schedule = (id: string, importedAt: string): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`,
}) as ReferenceDocument;
function rows(source: ReferenceDocument, lines: string[]): ScheduleItem[] {
  return (normalizeScheduleImport({
    contents: ['Task,Project,Area,Start,Finish,Percent Complete', ...lines].join('\n'), sourceName: source.originalFileName,
    mimeType: 'text/csv', projects: ['Alpha'], projectAreas: [], now: new Date(source.importedAt),
  }).items as ScheduleItem[]).map((item, index) => ({
    ...item, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id,
  }));
}
/** The approval with David's answers to the review's question (App.tsx passes them to the merge). */
function approve(state: State, source: ReferenceDocument, imported: ScheduleItem[], pairingChoices?: Record<string, string | null>): State {
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items, imported, completionMatch: () => null, mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, [...state.documents, source], source.importBatchId || ''),
    approvedAt: source.importedAt, overlay: false, pairingChoices,
  });
  return {
    items: [...merged.additions, ...merged.next],
    documents: scheduleDocumentsAfterActivation(source, [...state.documents, source], 'project'),
  };
}
function record(state: State, id: string, percentComplete: number, at: string): State {
  return {
    ...state,
    items: state.items.map(item => item.id === id ? {
      ...item, percentComplete, status: 'In Progress', progressSource: 'project_manager', progressConfirmedAt: at,
      progressConfirmedBy: 'David', updatedAt: at,
    } as ScheduleItem : item),
  };
}
/** Set Active on a saved master (the phone's carry of progress included). */
function setActive(state: State, source: ReferenceDocument, at: string): State {
  const documentsAfter = scheduleDocumentsAfterActivation(state.documents.find(document => document.id === source.id)!, state.documents, 'project', at);
  const carried = new Map(scheduleProgressCarriedOnActivation({ items: state.items, documentsBefore: state.documents, documentsAfter, now: at })
    .map(item => [item.id, item]));
  return { items: state.items.map(item => carried.get(item.id) || item), documents: documentsAfter };
}

const F = schedule('MASTER F', '2026-09-20T12:00:00.000Z');
const G = schedule('MASTER G', '2026-10-01T12:00:00.000Z');
const FIRST = 'Pour slab,Alpha,Lot,10/05/2026,10/09/2026,';
const SECOND = 'Pour slab,Alpha,Lot,10/12/2026,10/16/2026,';
const THIRD = 'Pour slab,Alpha,Lot,10/19/2026,10/23/2026,';
const FRAMING = 'Framing,Alpha,Lot,10/26/2026,10/30/2026,';
const onF = approve(EMPTY, F, rows(F, [FIRST, SECOND, FRAMING]));
const firstId = shown(onF).find(item => item.startDate === '10/05/2026')!.id;
const secondId = shown(onF).find(item => item.startDate === '10/12/2026')!.id;
// David's 80% on the first pour.
const withDavid = record(onF, firstId, 80, '2026-10-06T15:00:00.000Z');
const gRows = rows(G, [SECOND, THIRD, FRAMING]);
const rowOn = (start: string) => gRows.find(row => row.startDate === start)!.id;
/** "The first was dropped and a new one added": the row on 10/12 is the second pour; the row on 10/19 is new. */
const DROPPED_AND_NEW = { [rowOn('10/12/2026')]: secondId, [rowOn('10/19/2026')]: null };

function truthOf(state: State, now: string) {
  return buildDAVEProjectTruth({ projectId: 'report:alpha', projectName: 'Alpha', updates: [], scheduleItems: shown(state), projectAreas: [], referenceDocuments: [], now });
}
function built(state: State, known: DAVEReportSnapshot | null, now: string) {
  const truth = truthOf(state, now);
  const fingerprint = buildDAVEReportSourceFingerprint([truth]);
  const briefing = buildDAVEReportBriefing({ truths: [truth], selectedProjectNames: ['Alpha'], previousSnapshot: reportBaselineSnapshot(known, fingerprint), scheduleItems: shown(state) });
  const snapshot = buildDAVEReportSnapshot({ truths: [truth], scopeKey: daveReportSnapshotScopeKey(['Alpha']), sourceFingerprint: fingerprint, capturedAt: now, reportFormat: 'project_manager' });
  return {
    lines: briefing.recentChanges.map(change => change.summary).sort(),
    period: briefing.reportingPeriod,
    snapshot,
    fingerprint,
  };
}
const sent = (state: State, now: string) =>
  markReportSnapshotDelivered(reportSnapshotToSave(built(state, null, now).snapshot, null) as DAVEReportSnapshot, now, 'phone');
const NEVER_SAID = /moved from \d+% to \d+% complete|changed from In Progress|was reopened|was completed/;

describe('review N1 M3: the report follows David\'s answer to "which same-named task is which" (owner answer Q30)', () => {
  const r1 = sent(withDavid, '2026-10-07T12:00:00.000Z');

  it('the review asks; "dropped, and this row is new": the dropped task is removed, the new one added, no change between them', () => {
    const [question] = scheduleImportPairingQuestions({ existing: shown(withDavid), imported: gRows, overlay: false });
    expect(question).toBeTruthy();
    const state = approve(withDavid, G, gRows, DROPPED_AND_NEW);
    // The list follows him: the second pour on its days at 0%, and a new pour at 0%; David's 80% task is gone.
    expect(shown(state).filter(item => item.taskName === 'Pour slab').map(item => `${item.startDate} ${item.percentComplete}%`).sort())
      .toEqual(['10/12/2026 0%', '10/19/2026 0%']);
    const report = built(state, r1, '2026-10-08T12:00:00.000Z');
    expect(report.lines).toEqual([
      'Alpha: Pour slab was added to the project plan.',
      'Alpha: Pour slab was removed from the current project plan.',
    ]);
    expect(report.lines.join('\n')).not.toMatch(NEVER_SAID);
    expect(report.lines.join('\n')).not.toMatch(/finish changed/);
    // Three tasks before and three now, none complete: the counts do not move.
    expect([report.period.completeDelta, report.period.openDelta]).toEqual([0, 0]);
    // The next report, after it is sent, says nothing more of either.
    const r2 = markReportSnapshotDelivered(reportSnapshotToSave(report.snapshot, r1) as DAVEReportSnapshot, '2026-10-08T13:00:00.000Z', 'phone');
    expect(built(state, r2, '2026-10-09T12:00:00.000Z').lines).toEqual([]);
  });

  it('"every date slipped one week" (the app\'s guess, confirmed): each pour is compared with itself, as before', () => {
    const [question] = scheduleImportPairingQuestions({ existing: shown(withDavid), imported: gRows, overlay: false });
    const state = approve(withDavid, G, gRows, question.guess as Record<string, string | null>);
    expect(shown(state).filter(item => item.taskName === 'Pour slab').map(item => `${item.startDate} ${item.percentComplete}%`).sort())
      .toEqual(['10/12/2026 80%', '10/19/2026 0%']);
    const report = built(state, r1, '2026-10-08T12:00:00.000Z');
    expect(report.lines).toEqual([
      'Alpha: Pour slab finish changed from 10/09/2026 to 10/16/2026.',
      'Alpha: Pour slab finish changed from 10/16/2026 to 10/23/2026.',
    ]);
  });

  it('back on the old master: the new row is removed and the dropped task is back, never "moved from 0% to 80%"', () => {
    const onG = approve(withDavid, G, gRows, DROPPED_AND_NEW);
    const sentOnG = sent(onG, '2026-10-08T12:00:00.000Z');
    const back = setActive(onG, F, '2026-10-09T09:00:00.000Z');
    expect(shown(back).filter(item => item.taskName === 'Pour slab').map(item => `${item.startDate} ${item.percentComplete}%`).sort())
      .toEqual(['10/05/2026 80%', '10/12/2026 0%']);
    const report = built(back, sentOnG, '2026-10-09T12:00:00.000Z');
    expect(report.lines.join('\n')).not.toMatch(NEVER_SAID);
    expect(report.lines).toEqual(expect.arrayContaining([
      'Alpha: Pour slab was added to the project plan.',
      'Alpha: Pour slab was removed from the current project plan.',
    ]));
  });

  it('a field report filed on the dropped task links to no task, never to the row he called new (Project Truth\'s links)', () => {
    const state = approve(withDavid, G, gRows, DROPPED_AND_NEW);
    const linkOf = scheduleTaskLinks(shown(state), state.items);
    const onDropped = { scheduleItemId: firstId, scheduleTaskName: 'Pour slab', projectName: 'Alpha', scheduleProjectName: 'Alpha', selectedAreaName: 'Lot' };
    expect(linkOf(onDropped as never)).toBeNull();
    // One filed on the second pour follows it to its new row.
    const onSecond = { ...onDropped, scheduleItemId: secondId };
    expect(linkOf(onSecond as never)?.item.startDate).toBe('10/12/2026');
  });

  it('his answer is not part of what the report says: the same facts give the same fingerprint with and without it', () => {
    const state = approve(withDavid, G, gRows, DROPPED_AND_NEW);
    const answered = shown(state).find(item => (item.notRevisionOfTaskIds || []).length > 0);
    expect(answered?.notRevisionOfTaskIds?.slice().sort()).toEqual([firstId, secondId].sort());
    const without: State = { ...state, items: state.items.map(item => ({ ...item, notRevisionOfTaskIds: undefined })) };
    expect(built(state, null, '2026-10-08T12:00:00.000Z').fingerprint).toBe(built(without, null, '2026-10-08T12:00:00.000Z').fingerprint);
    // The saved report keeps it on the task, so the next comparison follows it too.
    const task = built(state, null, '2026-10-08T12:00:00.000Z').snapshot.tasks.find(candidate => candidate.taskId === answered?.id);
    expect(task?.notTaskIds?.slice().sort()).toEqual([firstId, secondId].sort());
    expect(built(without, null, '2026-10-08T12:00:00.000Z').snapshot.tasks.every(candidate => candidate.notTaskIds === undefined)).toBe(true);
  });

  it('tasks with no such answer still pair by name, as before (a row saved before the import kept earlier ids)', () => {
    const task = (taskId: string, finishDate: string, percentComplete: number, notTaskIds?: string[]) => ({
      taskId, projectName: 'Alpha', taskName: 'Pour slab', areaName: 'Lot', owner: null, status: 'In Progress', percentComplete,
      finishDate, urgency: 'not_urgent' as const, approvalStatus: null, estimatedScheduleImpactDays: null, ...(notTaskIds ? { notTaskIds } : {}),
    });
    const snapshot = (tasks: ReturnType<typeof task>[], capturedAt: string): DAVEReportSnapshot => ({
      version: r1.version, scopeKey: 'alpha', capturedAt, sourceFingerprint: capturedAt, tasks, deliveredAt: capturedAt,
    });
    const before = snapshot([task('old', '10/09/2026', 80)], '2026-10-07T12:00:00.000Z');
    const lines = (now: DAVEReportSnapshot) => compareDAVEReportSnapshots({ current: now, previous: before }).changes.map(change => change.summary);
    expect(lines(snapshot([task('new', '10/23/2026', 0)], '2026-10-08T12:00:00.000Z'))).toEqual([
      'Pour slab moved from 80% to 0% complete.',
      'Pour slab finish changed from 10/09/2026 to 10/23/2026.',
    ]);
    expect(lines(snapshot([task('new', '10/23/2026', 0, ['old'])], '2026-10-08T12:00:00.000Z'))).toEqual([
      'Pour slab was added to the project plan.',
      'Pour slab was removed from the current project plan.',
    ]);
  });
});
