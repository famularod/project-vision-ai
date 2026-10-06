import { buildDAVEProjectTruth } from '../../services/DAVEProjectTruth';
import { buildDAVEReportBriefing, buildDAVEReportSourceFingerprint, reportPeriodMovementLines } from '../../services/DAVEReportIntelligence';
import {
  buildDAVEReportSnapshot,
  compareDAVEReportSnapshots,
  daveReportSnapshotScopeKey,
  markReportSnapshotDelivered,
  reportBaselineSnapshot,
  reportSnapshotToSave,
  type DAVEReportSnapshot,
} from '../../services/DAVEReportSnapshot';
import { buildDAVEWebReportDraft } from '../../services/DAVEWebOperations';
import type { DAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { mergeApprovedScheduleImportItems, scheduleImportPairingQuestions, scheduleItemsVisibleBeforeImport, scheduleProgressCarriedOnActivation } from '../../services/ScheduleImportMerge';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';
import type { ReferenceDocument, ScheduleItem } from '../../types';

// Review N6 of reports (7 Oct 2026), finding 1 (Low, rare, new: caused by
// c65013a, the fix for N5 B). That fix barred EVERY row with earlier ids from
// the pairing by name. A task with a name of its own that one master left
// out and the next listed again (a new row), then re-dated by a later master
// (so the row has earlier ids, none of them in the last report), was said
// "removed from the current project plan" and "added to the project plan",
// and what really changed on it was not said: "Paint moved from 60% to 70%
// complete." was gone. The same report read before that last master still
// said it: the wording flipped when a later master re-dated the task.
// The ids decide only where a name leaves doubt (more than one task of that
// name in either report); a task with a name of its own still pairs by name.
// The CSV reader, the import's question and merge, Set Active, the shown list
// and the report builders are the app's own; phone and web are both checked.

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));

type State = { items: ScheduleItem[]; documents: ReferenceDocument[] };
const EMPTY: State = { items: [], documents: [] };
const shown = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents }) as ScheduleItem[];
const schedule = (id: string, importedAt: string, role?: 'lookahead'): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`, ...(role ? { scheduleRole: role } : {}),
}) as ReferenceDocument;
function rows(source: ReferenceDocument, lines: string[]): ScheduleItem[] {
  return (normalizeScheduleImport({
    contents: ['Task,Project,Area,Start,Finish,Percent Complete', ...lines].join('\n'), sourceName: source.originalFileName,
    mimeType: 'text/csv', projects: ['Alpha'], projectAreas: [], now: new Date(source.importedAt),
  }).items as ScheduleItem[]).map((item, index) => ({ ...item, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id }));
}
/** What David answers to "which same-named task is which": for each row of the file, by its start date, the saved task's start date, or 'new'. */
type Answers = Record<string, string>;
function approve(state: State, source: ReferenceDocument, lines: string[], answers?: Answers): State {
  const lookahead = source.scheduleRole === 'lookahead';
  const imported = rows(source, lines);
  const questions = scheduleImportPairingQuestions({ existing: shown(state), imported, overlay: lookahead });
  const pairingChoices: Record<string, string | null> = {};
  for (const question of questions) {
    if (!answers) { Object.assign(pairingChoices, question.guess); continue; }
    for (const row of question.rows) {
      const answer = answers[row.startDate];
      pairingChoices[row.id] = answer === 'new' ? null : question.saved.find(item => item.startDate === answer)!.id;
    }
  }
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items, imported, completionMatch: () => null, mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, [...state.documents, source], source.importBatchId || ''),
    approvedAt: source.importedAt, overlay: lookahead, ...(questions.length > 0 ? { pairingChoices } : {}),
  });
  return { items: [...merged.additions, ...merged.next], documents: lookahead ? [...state.documents, source] : scheduleDocumentsAfterActivation(source, [...state.documents, source], 'project') };
}
function record(state: State, startDate: string, percentComplete: number, at: string): State {
  const id = shown(state).find(item => item.taskName === 'Pour slab' && item.startDate === startDate)!.id;
  return {
    ...state,
    items: state.items.map(item => item.id === id ? {
      ...item, percentComplete, status: percentComplete >= 100 ? 'Complete' : percentComplete > 0 ? 'In Progress' : 'Not Started',
      progressSource: 'project_manager', progressConfirmedAt: at, progressConfirmedBy: 'David', updatedAt: at,
    } as ScheduleItem : item),
  };
}
type Report = { lines: string[]; completed: number; open: number; said: string[]; snapshot: DAVEReportSnapshot };
/** The report as the phone builds it from the tasks shown (`list`) and every saved task. */
function phoneReport(state: State, known: DAVEReportSnapshot | null, now: string, list: ScheduleItem[] = shown(state)): Report {
  const truth = buildDAVEProjectTruth({
    projectId: 'report:alpha', projectName: 'Alpha', updates: [], scheduleItems: list, projectAreas: [], referenceDocuments: state.documents, now,
    knownScheduleItems: state.items, knownScheduleDocuments: state.documents, reportLookaheadReplacement: true,
  });
  const fingerprint = buildDAVEReportSourceFingerprint([truth]);
  const briefing = buildDAVEReportBriefing({ truths: [truth], selectedProjectNames: ['Alpha'], previousSnapshot: reportBaselineSnapshot(known, fingerprint), scheduleItems: list });
  const snapshot = buildDAVEReportSnapshot({ truths: [truth], scopeKey: daveReportSnapshotScopeKey(['Alpha']), sourceFingerprint: fingerprint, capturedAt: now, reportFormat: 'project_manager' });
  const period = briefing.reportingPeriod;
  return { lines: period.changes.map(change => change.summary), completed: period.completeDelta, open: period.openDelta, said: reportPeriodMovementLines(briefing) ?? [], snapshot };
}
/** The same report as the web builds it. */
function webReport(state: State, known: DAVEReportSnapshot | null, now: string): Pick<Report, 'lines' | 'completed' | 'open' | 'said'> {
  const web = {
    projects: [{ id: 'report:alpha', name: 'Alpha' }], scheduleItems: shown(state), knownScheduleItems: state.items,
    projectUpdates: [], referenceDocuments: state.documents, refreshedAt: now, tasksPulledAt: now,
  } as unknown as DAVEWebReadOnlySnapshot;
  const truths = [buildDAVEProjectTruth({
    projectId: 'report:alpha', projectName: 'Alpha', updates: [], scheduleItems: shown(state), projectAreas: [], referenceDocuments: state.documents, now,
    knownScheduleItems: state.items, knownScheduleDocuments: state.documents, reportLookaheadReplacement: true,
  })];
  const briefing = buildDAVEWebReportDraft(web, null, { previousSnapshot: reportBaselineSnapshot(known, buildDAVEReportSourceFingerprint(truths)), waitingForOtherDevice: false });
  const period = briefing.reportingPeriod;
  return { lines: period.changes.map(change => change.summary), completed: period.completeDelta, open: period.openDelta, said: reportPeriodMovementLines(briefing) ?? [] };
}
const sent = (state: State, known: DAVEReportSnapshot | null, now: string) =>
  markReportSnapshotDelivered((reportSnapshotToSave(phoneReport(state, known, now).snapshot, known) ?? known) as DAVEReportSnapshot, now, 'phone');
const names = (state: State) => shown(state).map(item => item.taskName).sort();

const master = (number: number, importedAt: string) => schedule(`MASTER ${number}`, importedAt);
const FRAMING = 'Framing,Alpha,Lot,09/15/2026,09/25/2026,';
const paint = (start: string, finish: string) => `Paint,Alpha,Lot,${start},${finish},`;
const REMOVED = 'Paint was removed from the current project plan.';
const ADDED = 'Paint was added to the project plan.';
const paintLines = (report: Pick<Report, 'lines'>) => report.lines.filter(line => line.startsWith('Paint')).sort();
const thePaint = (state: State) => shown(state).filter(item => item.taskName === 'Paint');
/** He records progress on the one Paint in the list. */
function recordPaint(state: State, percentComplete: number, at: string): State {
  const [task] = thePaint(state);
  return {
    ...state,
    items: state.items.map(item => item.id === task.id ? {
      ...item, percentComplete, status: percentComplete >= 100 ? 'Complete' : percentComplete > 0 ? 'In Progress' : 'Not Started',
      progressSource: 'project_manager', progressConfirmedAt: at, progressConfirmedBy: 'David', updatedAt: at,
    } as ScheduleItem : item),
  };
}
/** Set Active on a master already saved (the app's own steps, as the reviewer's driver takes them). */
function setActive(state: State, target: ReferenceDocument, at: string): State {
  const saved = state.documents.find(document => document.id === target.id)!;
  const documents = (scheduleDocumentsAfterActivation as (...args: unknown[]) => ReferenceDocument[])(saved, state.documents, 'project', at);
  const carried = new Map(scheduleProgressCarriedOnActivation({ items: state.items, documentsBefore: state.documents, documentsAfter: documents, now: at }).map(item => [item.id, item]));
  return { items: state.items.map(item => carried.get(item.id) || item), documents };
}
const both = (state: State, known: DAVEReportSnapshot | null, now: string) => [phoneReport(state, known, now), webReport(state, known, now)];

describe('review N6 1 (Low): a task with a name of its own, left out and listed again, then re-dated, is still that task', () => {
  /** Master 1 lists Paint; he records 60%; the report goes out. Master 2 leaves Paint out; master 3 lists it again; he records 70%. */
  function leftOutAndListedAgain() {
    let state = approve(EMPTY, master(1, '2026-09-07T12:00:00.000Z'), [FRAMING, paint('10/01/2026', '10/05/2026')]);
    state = recordPaint(state, 60, '2026-09-08T08:00:00.000Z');
    const first = sent(state, null, '2026-09-08T15:00:00.000Z');
    state = approve(state, master(2, '2026-09-09T12:00:00.000Z'), [FRAMING]);
    expect(thePaint(state)).toEqual([]);
    state = approve(state, master(3, '2026-09-10T12:00:00.000Z'), [FRAMING, paint('10/03/2026', '10/07/2026')]);
    state = recordPaint(state, 70, '2026-09-10T14:00:00.000Z');
    return { state, first };
  }

  it('before a later master re-dates it: "moved from 60% to 70%" (it said so before the fix too)', () => {
    const { state, first } = leftOutAndListedAgain();
    for (const report of both(state, first, '2026-09-10T15:00:00.000Z')) {
      expect(paintLines(report)).toEqual(['Paint finish changed from 10/05/2026 to 10/07/2026.', 'Paint moved from 60% to 70% complete.']);
    }
  });

  it('after master 4 re-dates it: the same task, with its percent and its new finish; not removed and added', () => {
    const { state: before, first } = leftOutAndListedAgain();
    const state = approve(before, master(4, '2026-09-11T12:00:00.000Z'), [FRAMING, paint('10/05/2026', '10/09/2026')]);
    // The row master 4 made answers to master 3's row, which is not in the last report.
    expect(thePaint(state).map(item => (item.revisedFromTaskIds ?? []).length)).toEqual([1]);
    for (const report of both(state, first, '2026-09-12T15:00:00.000Z')) {
      expect(paintLines(report)).toEqual(['Paint finish changed from 10/05/2026 to 10/09/2026.', 'Paint moved from 60% to 70% complete.']);
      expect(report.lines).not.toContain(REMOVED);
      expect(report.lines).not.toContain(ADDED);
      expect(report.completed).toBe(0);
      expect(report.open).toBe(0);
    }
  });

  it('completed after the re-date: "Paint was completed.", and the count names it once', () => {
    const { state: before, first } = leftOutAndListedAgain();
    let state = approve(before, master(4, '2026-09-11T12:00:00.000Z'), [FRAMING, paint('10/05/2026', '10/09/2026')]);
    state = recordPaint(state, 100, '2026-09-11T14:00:00.000Z');
    for (const report of both(state, first, '2026-09-12T15:00:00.000Z')) {
      expect(report.lines).toContain('Paint was completed.');
      expect(report.lines).not.toContain(REMOVED);
      expect(report.lines).not.toContain(ADDED);
      expect(report.completed).toBe(1);
    }
  });

  it('hidden by Set Active, listed again by the next master and re-dated by the one after: still that task', () => {
    // Master 1 has no Paint; master 2 adds it; the report goes out.
    let state = approve(EMPTY, master(1, '2026-09-07T12:00:00.000Z'), [FRAMING]);
    state = approve(state, master(2, '2026-09-08T12:00:00.000Z'), [FRAMING, paint('10/01/2026', '10/05/2026')]);
    const first = sent(state, null, '2026-09-08T15:00:00.000Z');
    // He sets master 1 active again: Paint is not in the list. Master 3 lists it (a new row), master 4 re-dates it.
    state = setActive(state, master(1, '2026-09-07T12:00:00.000Z'), '2026-09-09T08:00:00.000Z');
    expect(thePaint(state)).toEqual([]);
    state = approve(state, master(3, '2026-09-09T12:00:00.000Z'), [FRAMING, paint('10/03/2026', '10/07/2026')]);
    state = approve(state, master(4, '2026-09-10T12:00:00.000Z'), [FRAMING, paint('10/05/2026', '10/09/2026')]);
    state = recordPaint(state, 40, '2026-09-10T14:00:00.000Z');
    expect(thePaint(state).map(item => (item.revisedFromTaskIds ?? []).length)).toEqual([1]);
    for (const report of both(state, first, '2026-09-11T15:00:00.000Z')) {
      expect(paintLines(report)).toEqual([
        'Paint changed from Not Started to In Progress.',
        'Paint finish changed from 10/05/2026 to 10/09/2026.',
        'Paint moved from 0% to 40% complete.',
      ]);
      expect(report.lines).not.toContain(REMOVED);
      expect(report.lines).not.toContain(ADDED);
    }
  });
});

describe('review N6 1: where the ids decide, on two reports as they are kept', () => {
  type Extra = Record<string, unknown>;
  const row = (id: string, taskName: string, areaName: string | null, percent: number, extra: Extra = {}) => ({
    taskId: id, taskName, areaName, owner: null, status: percent >= 100 ? 'Complete' : percent > 0 ? 'In Progress' : 'Not Started',
    percentComplete: percent, finishDate: '10/09/2026', urgency: 'not_urgent', approvalStatus: null, estimatedScheduleImpactDays: null, ...extra,
  });
  const kept = (projects: Record<string, unknown[]>, capturedAt: string) => buildDAVEReportSnapshot({
    truths: Object.entries(projects).map(([projectName, schedule]) => ({ projectName, schedule }) as never),
    scopeKey: 'tower', sourceFingerprint: capturedAt, capturedAt,
  });
  const lines = (previous: Record<string, unknown[]>, current: Record<string, unknown[]>, tasksLeftByLookahead: Parameters<typeof compareDAVEReportSnapshots>[0]['tasksLeftByLookahead'] = []) =>
    compareDAVEReportSnapshots({ previous: kept(previous, '2026-09-08T15:00:00.000Z'), current: kept(current, '2026-09-12T15:00:00.000Z'), tasksLeftByLookahead })
      .changes.map(change => change.summary).sort();
  /** Paint on a row that answers to another row made since the last report: its earlier ids are known, none is in that report. */
  const paintNow = row('paint-3', 'Paint', 'Lot', 70, { earlierTaskIds: ['paint-2'] });

  it('a task of that name in another AREA leaves no doubt: still paired by name', () => {
    expect(lines(
      { Tower: [row('paint-1', 'Paint', 'Lot', 60), row('deck-paint', 'Paint', 'Deck', 10)] },
      { Tower: [paintNow, row('deck-paint', 'Paint', 'Deck', 10)] },
    )).toEqual(['Paint moved from 60% to 70% complete.']);
  });

  it('a task of that name in another PROJECT leaves no doubt: still paired by name', () => {
    expect(lines(
      { Tower: [row('paint-1', 'Paint', 'Lot', 60)], Annex: [row('annex-paint', 'Paint', 'Lot', 10)] },
      { Tower: [paintNow], Annex: [row('annex-paint', 'Paint', 'Lot', 10)] },
    )).toEqual(['Paint moved from 60% to 70% complete.']);
  });

  it('two of that name in the EARLIER report only (a master\'s and a lookahead\'s own): the ids decide', () => {
    // The last report had the master's Pour slab (60%) and a lookahead's own. The master now lists one, which he
    // said is the lookahead's (it answers to a later row of the lookahead's): the master's own was dropped.
    const leftWithItsLookahead = [{ taskId: 'lookahead-1-pour', projectName: 'Tower', taskName: 'Pour slab', areaName: 'Lot', status: 'Not Started', percentComplete: 0, lookahead: 'LOOKAHEAD 1' }];
    expect(lines(
      { Tower: [row('master-pour', 'Pour slab', 'Lot', 60), row('lookahead-1-pour', 'Pour slab', 'Lot', 0, { lookaheadDetail: true })] },
      { Tower: [row('master-2-pour', 'Pour slab', 'Lot', 0, { earlierTaskIds: ['lookahead-2-pour'] })] },
      leftWithItsLookahead,
    )).toEqual(['Pour slab was added to the project plan.', 'Pour slab was removed from the current project plan.']);
  });

  it('two of that name in the report NOW only (the lookahead\'s, and one he called new): the ids decide', () => {
    expect(lines(
      { Tower: [row('master-pour', 'Pour slab', 'Lot', 60)] },
      { Tower: [
        row('master-2-pour-a', 'Pour slab', 'Lot', 0, { earlierTaskIds: ['lookahead-2-pour'] }),
        row('master-2-pour-b', 'Pour slab', 'Lot', 0, { notTaskIds: ['master-pour', 'lookahead-2-pour'] }),
      ] },
    )).toEqual(['Pour slab was added to the project plan.', 'Pour slab was added to the project plan.', 'Pour slab was removed from the current project plan.']);
  });

  it('a task with no area stated could be any of that name: the ids decide', () => {
    expect(lines(
      { Tower: [row('master-pour', 'Pour slab', 'Lot', 60), row('other-pour', 'Pour slab', null, 10)] },
      { Tower: [row('master-2-pour', 'Pour slab', 'Lot', 0, { earlierTaskIds: ['lookahead-2-pour'] }), row('other-pour', 'Pour slab', null, 10)] },
    )).toEqual(['Pour slab was added to the project plan.', 'Pour slab was removed from the current project plan.']);
  });
});
