import { buildDAVEProjectTruth } from '../../services/DAVEProjectTruth';
import { buildDAVEReportBriefing, buildDAVEReportSourceFingerprint, enhanceDAVEReportDraft } from '../../services/DAVEReportIntelligence';
import {
  buildDAVEReportSnapshot,
  daveReportSnapshotScopeKey,
  markReportSnapshotDelivered,
  reportBaselineSnapshot,
  reportSnapshotToSave,
  type DAVEReportSnapshot,
} from '../../services/DAVEReportSnapshot';
import { buildDAVEWebReportDraft } from '../../services/DAVEWebOperations';
import type { DAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import type { PIEReportDraft } from '../../services/PIEReporter';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';
import type { ReferenceDocument, ScheduleItem } from '../../types';

/**
 * Owner answer 3 Oct 2026 (report wording after a lookahead is replaced).
 * Owner answer Q25 made the newest lookahead for a project replace the older
 * ones: the detail tasks only the older one listed leave the task list, and
 * a master task it had moved, that the newer one does not list, goes back to
 * the master schedule's dates. The written report then said, in 85% of
 * weekly reports, "<task> was removed from the current project plan", with
 * "-1 completed" for one that was done, and in 69% "<task> finish changed
 * from 10/12/2026 to 10/04/2026".
 *
 * David: (1) "Don't mention them": such detail tasks are not reported as
 * removed and never lower the completed count; one completed since the last
 * report is still listed as completed, once. (2) "Explain it": "T1 finish is
 * back to the master schedule's 10/04/2026 (the previous lookahead showed
 * 10/12/2026)", for start dates too. A task a new master drops, and any
 * ordinary date change, read as before. The real CSV normalizer, merge,
 * shown-schedule pick and report, on the phone's and the web's builders.
 * Synthetic data.
 */

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
  }).items as ScheduleItem[]).map((item, index) => ({
    ...item, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id,
  }));
}
function approve(state: State, source: ReferenceDocument, lines: string[]): State {
  const lookahead = source.scheduleRole === 'lookahead';
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items, imported: rows(source, lines), completionMatch: () => null, mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, [...state.documents, source], source.importBatchId || ''),
    approvedAt: source.importedAt, overlay: lookahead,
  });
  return {
    items: [...merged.additions, ...merged.next],
    documents: lookahead ? [...state.documents, source] : scheduleDocumentsAfterActivation(source, [...state.documents, source], 'project'),
  };
}
/** David records a percent on a task shown. */
function record(state: State, taskName: string, percentComplete: number, at: string): State {
  const id = shown(state).find(item => item.taskName === taskName)!.id;
  return {
    ...state,
    items: state.items.map(item => item.id === id ? {
      ...item, percentComplete, status: percentComplete >= 100 ? 'Complete' : 'In Progress', progressSource: 'project_manager',
      progressConfirmedAt: at, progressConfirmedBy: 'David', updatedAt: at,
    } as ScheduleItem : item),
  };
}

/** The phone's report truth: the tasks shown, with every saved task and schedule (as ReportsScreen gives them). */
function truthOf(state: State, now: string, withSaved = true) {
  return buildDAVEProjectTruth({
    projectId: 'report:alpha', projectName: 'Alpha', updates: [], scheduleItems: shown(state), projectAreas: [], referenceDocuments: state.documents, now,
    ...(withSaved ? { knownScheduleItems: state.items, knownScheduleDocuments: state.documents, reportLookaheadReplacement: true } : {}),
  });
}
const draft = {
  id: 'draft-1', reportType: 'daily_project_update', audience: 'owner', title: 'Alpha update', subject: 'Alpha update', body: '',
  openingLine: '', closingLine: '', executiveSummary: [], sections: [], locationGroups: [], actionItems: [], imageReferences: [], risks: [],
  decisionsNeeded: [], confidence: 'high', reportReadiness: 'high', needsReview: false, reviewFlags: [], sourceEvidence: [],
  constructionUnderstanding: {}, generatedAt: '2026-09-01T00:00:00.000Z',
} as unknown as PIEReportDraft;
function built(state: State, known: DAVEReportSnapshot | null, now: string, withSaved = true) {
  const truth = truthOf(state, now, withSaved);
  const fingerprint = buildDAVEReportSourceFingerprint([truth]);
  const briefing = buildDAVEReportBriefing({ truths: [truth], selectedProjectNames: ['Alpha'], previousSnapshot: reportBaselineSnapshot(known, fingerprint), scheduleItems: shown(state) });
  const snapshot = buildDAVEReportSnapshot({ truths: [truth], scopeKey: daveReportSnapshotScopeKey(['Alpha']), sourceFingerprint: fingerprint, capturedAt: now, reportFormat: 'project_manager' });
  const body = (format: 'project_manager' | 'executive') => enhanceDAVEReportDraft(draft, briefing, format).body;
  return {
    lines: briefing.recentChanges.map(change => change.summary).sort(),
    all: briefing.reportingPeriod.changes.map(change => change.summary).sort(),
    deltas: [briefing.reportingPeriod.completeDelta, briefing.reportingPeriod.openDelta, briefing.reportingPeriod.overdueDelta],
    snapshot, fingerprint, body,
  };
}
const send = (state: State, known: DAVEReportSnapshot | null, now: string) => {
  const report = built(state, known, now);
  return { report, sent: markReportSnapshotDelivered((reportSnapshotToSave(report.snapshot, known) ?? known) as DAVEReportSnapshot, now, 'phone') };
};
/** The facts move on (Roofing starts), so the next report counts from the one just sent. */
const nextWeek = (state: State, at: string) => record(state, 'Roofing', 5, at);
const ROOFING_STARTED = ['Roofing changed from Not Started to In Progress.', 'Roofing moved from 0% to 5% complete.'];
const REMOVED = /was removed from the current project plan/;
const CHANGED = /(start|finish) changed from/;

const F = schedule('MASTER F', '2026-09-07T12:00:00.000Z');
const L1 = schedule('LOOKAHEAD L1', '2026-09-08T12:00:00.000Z', 'lookahead');
const L2 = schedule('LOOKAHEAD L2', '2026-09-15T12:00:00.000Z', 'lookahead');
const L3 = schedule('LOOKAHEAD L3', '2026-09-22T12:00:00.000Z', 'lookahead');
const MASTER = [
  'Framing,Alpha,Lot,09/15/2026,09/25/2026,20',
  'Survey,Alpha,Lot,09/12/2026,09/14/2026,',
  'Roofing,Alpha,Lot,11/01/2026,11/10/2026,',
];
const onF = approve(EMPTY, F, MASTER);
/** Week 1: the lookahead moves Framing a week later and adds two detail tasks no master lists. */
const week1 = approve(onF, L1, [
  'Framing,Alpha,Lot,09/22/2026,10/02/2026,30',
  'Rebar delivery,Alpha,Lot,09/09/2026,09/10/2026,',
  'Formwork strip,Alpha,Lot,09/11/2026,09/12/2026,50',
]);
const WEEK2 = ['Inspections,Alpha,Lot,09/20/2026,09/21/2026,'];

describe('owner answer 3 Oct: the report after a newer lookahead replaces the old one', () => {
  it('detail tasks the replaced lookahead listed are not mentioned, and no count moves for them', () => {
    const r1 = send(week1, null, '2026-09-08T14:00:00.000Z');
    expect(shown(week1).map(item => item.taskName).sort()).toEqual(['Formwork strip', 'Framing', 'Rebar delivery', 'Roofing', 'Survey']);
    const week2 = approve(week1, L2, WEEK2);
    // Owner answer Q25: the detail tasks left the list, and Framing is on the master's dates again.
    expect(shown(week2).map(item => item.taskName).sort()).toEqual(['Framing', 'Inspections', 'Roofing', 'Survey']);
    const report = built(week2, r1.sent, '2026-09-15T14:00:00.000Z');
    expect(report.all.join('\n')).not.toMatch(REMOVED);
    expect(report.all.join('\n')).not.toMatch(CHANGED);
    expect(report.all).toEqual([
      "Framing finish is back to the master schedule's 09/25/2026 (the previous lookahead showed 10/02/2026).",
      "Framing start is back to the master schedule's 09/15/2026 (the previous lookahead showed 09/22/2026).",
      'Inspections was added to the project plan.',
    ]);
    // Inspections is one more open task; the two that left count as they stood.
    expect(report.deltas.slice(0, 2)).toEqual([0, 1]);
    // In the written report, both formats (the same text goes to Word, email, copy and Outlook).
    for (const format of ['project_manager', 'executive'] as const) {
      const body = report.body(format);
      expect(body).not.toMatch(REMOVED);
      expect(body).not.toMatch(CHANGED);
      expect(body).toContain("Framing finish is back to the master schedule's 09/25/2026 (the previous lookahead showed 10/02/2026).");
    }
    // Sent; the next report says nothing more of any of it.
    const r2 = markReportSnapshotDelivered(reportSnapshotToSave(report.snapshot, r1.sent) as DAVEReportSnapshot, '2026-09-15T15:00:00.000Z', 'phone');
    const next = built(nextWeek(week2, '2026-09-16T10:00:00.000Z'), r2, '2026-09-16T14:00:00.000Z');
    expect(next.all).toEqual(ROOFING_STARTED);
    expect(next.deltas.slice(0, 2)).toEqual([0, 0]);
  });

  it('a detail task that was complete when it left: the completed count does not go down', () => {
    const done = record(week1, 'Rebar delivery', 100, '2026-09-08T13:00:00.000Z');
    const r1 = send(done, null, '2026-09-08T14:00:00.000Z');
    const report = built(approve(done, L2, WEEK2), r1.sent, '2026-09-15T14:00:00.000Z');
    expect(report.all.join('\n')).not.toMatch(REMOVED);
    expect(report.all.join('\n')).not.toMatch(/Rebar delivery/);
    expect(report.deltas[0]).toBe(0);
    expect(report.body('project_manager')).not.toMatch(/-1 completed/);
  });

  it('one completed since the last report is listed as completed once, in the report that covers it', () => {
    const r1 = send(week1, null, '2026-09-08T14:00:00.000Z');
    // He completes Rebar delivery on Thursday; the next lookahead drops it on Tuesday, before the next report.
    const done = record(week1, 'Rebar delivery', 100, '2026-09-10T16:00:00.000Z');
    const week2 = approve(done, L2, WEEK2);
    const r2 = send(week2, r1.sent, '2026-09-15T14:00:00.000Z');
    expect(r2.report.all.filter(line => /Rebar delivery/.test(line))).toEqual(['Rebar delivery was completed.']);
    expect(r2.report.lines).toContain('Alpha: Rebar delivery was completed.');
    expect(r2.report.all.join('\n')).not.toMatch(REMOVED);
    // +1 completed (Rebar delivery); open: Inspections in, Rebar delivery out.
    expect(r2.report.deltas.slice(0, 2)).toEqual([1, 0]);
    // Never again: not in the next report, nor after the next lookahead.
    const moved = nextWeek(week2, '2026-09-16T10:00:00.000Z');
    const r3 = send(moved, r2.sent, '2026-09-16T14:00:00.000Z');
    expect(r3.report.all).toEqual(ROOFING_STARTED);
    expect(r3.report.deltas[0]).toBe(0);
    const week3 = approve(moved, L3, ['Punch walk,Alpha,Lot,09/28/2026,09/29/2026,']);
    const r4 = built(week3, r3.sent, '2026-09-22T14:00:00.000Z');
    expect(r4.all.join('\n')).not.toMatch(/Rebar delivery|Formwork strip/);
    expect(r4.all.join('\n')).not.toMatch(REMOVED);
    expect(r4.deltas[0]).toBe(0);
  });

  it('a detail task no report ever had (added, completed and gone between two reports) is still listed as completed, once', () => {
    const r0 = send(onF, null, '2026-09-07T14:00:00.000Z');
    const done = record(week1, 'Rebar delivery', 100, '2026-09-10T16:00:00.000Z');
    const week2 = approve(done, L2, WEEK2);
    const r2 = send(week2, r0.sent, '2026-09-15T14:00:00.000Z');
    expect(r2.report.all.filter(line => /Rebar delivery|Formwork strip/.test(line))).toEqual(['Rebar delivery was completed.']);
    expect(r2.report.deltas[0]).toBe(1);
    const r3 = built(nextWeek(week2, '2026-09-16T10:00:00.000Z'), r2.sent, '2026-09-16T14:00:00.000Z');
    expect(r3.all).toEqual(ROOFING_STARTED);
    expect(r3.deltas[0]).toBe(0);
    // Against a report saved before this change (it kept no record of replaced lookaheads) it is not guessed at.
    const { replacedLookaheads: _none, ...before } = r0.sent;
    expect(built(week2, before as DAVEReportSnapshot, '2026-09-15T14:00:00.000Z').all.join('\n')).not.toMatch(/Rebar delivery/);
  });

  it('a task a new master drops is still reported as removed, and its completed count still falls', () => {
    const done = record(onF, 'Survey', 100, '2026-09-08T13:00:00.000Z');
    const r1 = send(done, null, '2026-09-08T14:00:00.000Z');
    const G = schedule('MASTER G', '2026-09-15T12:00:00.000Z');
    const onG = approve(done, G, [MASTER[0], MASTER[2]]);
    const report = built(onG, r1.sent, '2026-09-15T14:00:00.000Z');
    expect(report.all).toEqual(['Survey was removed from the current project plan.']);
    expect(report.deltas[0]).toBe(-1);
  });

  it('an ordinary date change reads as before: a newer lookahead that lists the task with new dates, and a new master', () => {
    const r1 = send(week1, null, '2026-09-08T14:00:00.000Z');
    const relisted = approve(week1, L2, ['Framing,Alpha,Lot,09/29/2026,10/09/2026,30']);
    expect(built(relisted, r1.sent, '2026-09-15T14:00:00.000Z').all).toEqual(['Framing finish changed from 10/02/2026 to 10/09/2026.']);
    const r0 = send(onF, null, '2026-09-07T14:00:00.000Z');
    const G = schedule('MASTER G', '2026-09-15T12:00:00.000Z');
    const onG = approve(onF, G, ['Framing,Alpha,Lot,09/16/2026,09/28/2026,20', MASTER[1], MASTER[2]]);
    expect(built(onG, r0.sent, '2026-09-15T14:00:00.000Z').all).toEqual(['Framing finish changed from 09/25/2026 to 09/28/2026.']);
  });

  it('a task already back on the master\'s dates at the last report says nothing; listed again later, it reads as a change', () => {
    const r1 = send(week1, null, '2026-09-08T14:00:00.000Z');
    const week2 = approve(week1, L2, WEEK2);
    const r2 = send(week2, r1.sent, '2026-09-15T14:00:00.000Z');
    expect(built(nextWeek(week2, '2026-09-16T10:00:00.000Z'), r2.sent, '2026-09-16T14:00:00.000Z').all).toEqual(ROOFING_STARTED);
    const week3 = approve(week2, L3, ['Framing,Alpha,Lot,09/23/2026,10/05/2026,30']);
    expect(built(week3, r2.sent, '2026-09-22T14:00:00.000Z').all).toEqual(['Framing finish changed from 09/25/2026 to 10/05/2026.']);
  });

  it('against a report sent by the build before: no "removed" line, the finish is explained, and nothing is guessed about the start', () => {
    const r1 = send(week1, null, '2026-09-08T14:00:00.000Z');
    const { replacedLookaheads: _none, ...rest } = r1.sent;
    const before = { ...rest, tasks: rest.tasks.map(({ startDate: _start, replacedLookaheadDates: _dates, ...task }) => task) } as DAVEReportSnapshot;
    const report = built(approve(week1, L2, WEEK2), before, '2026-09-15T14:00:00.000Z');
    expect(report.all).toEqual([
      "Framing finish is back to the master schedule's 09/25/2026 (the previous lookahead showed 10/02/2026).",
      'Inspections was added to the project plan.',
    ]);
  });

  it('where and why a date comes from is not part of the fingerprint: an approval given before still stands', () => {
    const week2 = approve(week1, L2, WEEK2);
    expect(built(week2, null, '2026-09-15T14:00:00.000Z', true).fingerprint).toBe(built(week2, null, '2026-09-15T14:00:00.000Z', false).fingerprint);
    const saved = built(week2, null, '2026-09-15T14:00:00.000Z').snapshot;
    expect(saved.replacedLookaheads).toEqual(['batch-lookahead l1']);
    expect(built(week1, null, '2026-09-08T14:00:00.000Z').snapshot.replacedLookaheads).toEqual([]);
    // Only the task the lookahead had moved keeps its start and the replaced dates.
    expect(saved.tasks.filter(task => task.startDate !== undefined).map(task => [task.taskName, task.startDate, task.replacedLookaheadDates])).toEqual([
      ['Framing', '09/15/2026', { startDate: '09/22/2026', finishDate: '10/02/2026' }],
    ]);
    expect(built(week1, null, '2026-09-08T14:00:00.000Z').snapshot.tasks.filter(task => task.startDate !== undefined).map(task => [task.taskName, task.startDate]))
      .toEqual([['Framing', '09/22/2026']]);
  });

  it('a report built without every saved task says what it said before (no saved tasks, no way to tell why one left)', () => {
    const r1 = send(week1, null, '2026-09-08T14:00:00.000Z');
    const report = built(approve(week1, L2, WEEK2), r1.sent, '2026-09-15T14:00:00.000Z', false);
    expect(report.all.filter(line => REMOVED.test(line))).toEqual([
      'Formwork strip was removed from the current project plan.',
      'Rebar delivery was removed from the current project plan.',
    ]);
  });

  it('the web builds the same report from the same saved tasks and schedules', () => {
    const r1 = send(week1, null, '2026-09-08T14:00:00.000Z');
    const done = record(week1, 'Rebar delivery', 100, '2026-09-10T16:00:00.000Z');
    const week2 = approve(done, L2, WEEK2);
    const phone = built(week2, r1.sent, '2026-09-15T14:00:00.000Z');
    const web = buildDAVEWebReportDraft({
      projects: [{ id: 'report:alpha', name: 'Alpha' }],
      scheduleItems: shown(week2), knownScheduleItems: week2.items, projectUpdates: [], referenceDocuments: week2.documents,
      refreshedAt: '2026-09-15T14:00:00.000Z', tasksPulledAt: '2026-09-15T14:00:00.000Z',
    } as unknown as DAVEWebReadOnlySnapshot, null, { previousSnapshot: r1.sent, waitingForOtherDevice: false });
    expect(web.reportingPeriod.changes.map(change => change.summary).sort()).toEqual(phone.all);
    expect([web.reportingPeriod.completeDelta, web.reportingPeriod.openDelta, web.reportingPeriod.overdueDelta]).toEqual(phone.deltas);
    expect(phone.all).toContain('Rebar delivery was completed.');
  });
});
