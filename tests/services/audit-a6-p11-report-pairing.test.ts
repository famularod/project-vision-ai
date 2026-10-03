/**
 * Whole-app audit A6 pass 11 L2 (30 Sep 2026), "since the last report", on
 * pass 10 L1 (same-named tasks pair the way with the fewest status,
 * completion and owner differences; a tie that says the same either way is
 * broken by finish order).
 *
 * Two "Inspection" tasks, Dana's, on Level 2: A 50% due Oct 1, B 10% due
 * Oct 20. A revised import: B completed on Oct 2; A still 50%, now due Oct
 * 30. Both ways of pairing them cost one completion and status change, and
 * say the same about status, completion and owner, so finish order paired A
 * with the completed task and B with the 50% one: the report printed
 * "Inspection moved from 10% to 50% complete." and two finish changes no
 * task made.
 *
 * Now a tie on those is broken by the least movement: the percent change of
 * tasks whose completion did not change, then how far the finish dates moved
 * (squared per task, so a schedule shifted past the gap between two tasks
 * still pairs them in finish order), then the fewest approval and schedule
 * impact changes. If ways that move as little would still print different
 * lines, the tasks stay added and removed.
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

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
  type DAVEReportSnapshot,
} from '../../services/DAVEReportSnapshot';
import { mergeApprovedScheduleImportItems } from '../../services/ScheduleImportMerge';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import type { PIEReportDraft } from '../../services/PIEReporter';
import type { ReferenceDocument, ScheduleItem } from '../../types';

const NOW = '2026-09-30T15:00:00.000Z';
const REPORT_SENT = '2026-09-23T15:00:00.000Z';

const task = (id: string, finishDate: string, percent: number, extra: Record<string, unknown> = {}) => ({
  taskId: id, taskName: 'Inspection', areaName: 'Level 2', owner: 'Dana',
  status: percent >= 100 ? 'Complete' : 'In Progress', percentComplete: percent,
  finishDate, urgency: 'not_urgent', approvalStatus: null, estimatedScheduleImpactDays: null, ...extra,
});
const at = (tasks: unknown[], capturedAt: string) => buildDAVEReportSnapshot({
  truths: [{ projectName: 'Tower', schedule: tasks } as never], scopeKey: 'tower', sourceFingerprint: capturedAt, capturedAt,
});
const compare = (previous: unknown[], current: unknown[]) => compareDAVEReportSnapshots({
  previous: at(previous, REPORT_SENT),
  current: at(current, NOW),
});
const summaries = (comparison: ReturnType<typeof compare>) => comparison.changes.map(change => change.summary);
const kinds = (comparison: ReturnType<typeof compare>) => comparison.changes.map(change => change.kind).sort();

describe('L2: a tie between same-named tasks goes to the way that moves them least', () => {
  // Changed on purpose by A6 pass 12 L1 (30 Sep 2026): how far the finish
  // dates moved now comes before the percent change, as finish order did in
  // pass 10 and as the import pairs a revision (file order). With nothing else
  // to tell them apart, the task due first (A, Oct 1) is the one completed on
  // Oct 2, which is how the import records it (row 1 revises row 1), so field
  // updates, Project Truth and the report name the same Inspection. Pass 11
  // pinned the other reading (B completed, A moved to Oct 30).
  it('one completed on Oct 2, the other 50% due Oct 30: paired by the least finish movement, as the import pairs them', () => {
    const comparison = compare(
      [task('a', '2026-10-01', 50), task('b', '2026-10-20', 10)],
      [task('b2', '2026-10-02', 100), task('a2', '2026-10-30', 50)],
    );
    expect(comparison).toMatchObject({ completeDelta: 1, openDelta: -1 });
    expect(summaries(comparison).sort()).toEqual([
      'Inspection finish changed from 2026-10-01 to 2026-10-02.',
      'Inspection finish changed from 2026-10-20 to 2026-10-30.',
      'Inspection moved from 10% to 50% complete.',
      'Inspection was completed.',
    ]);
  });

  it('percents tie, finish dates tell them apart: the way whose finish dates moved least', () => {
    const comparison = compare(
      [task('a', '2026-10-01', 20), task('b', '2026-11-01', 20)],
      [task('b2', '2026-10-28', 20), task('a2', '2026-10-03', 20)],
    );
    expect(summaries(comparison)).toEqual([
      'Inspection finish changed from 2026-10-01 to 2026-10-03.',
      'Inspection finish changed from 2026-11-01 to 2026-10-28.',
    ]);
  });

  it('a schedule shifted by more than the gap between them still pairs them in finish order', () => {
    const comparison = compare(
      [task('a', '2026-10-01', 0), task('b', '2026-10-02', 0)],
      [task('a2', '2026-10-03', 0), task('b2', '2026-10-04', 0)],
    );
    expect(summaries(comparison)).toEqual([
      'Inspection finish changed from 2026-10-01 to 2026-10-03.',
      'Inspection finish changed from 2026-10-02 to 2026-10-04.',
    ]);
  });

  it('a tie that would still print different progress lines stays added and removed', () => {
    const comparison = compare(
      [task('a', '2026-10-01', 10), task('b', '2026-10-01', 20)],
      [task('a2', '2026-10-01', 30), task('b2', '2026-10-01', 40)],
    );
    expect(kinds(comparison)).toEqual(['added', 'added', 'removed', 'removed']);
    expect(summaries(comparison).join('\n')).not.toMatch(/moved from \d+%/);
  });

  it('a tie that would print different approval lines goes to the way with fewer, and the same lines either way are kept', () => {
    const approved = (id: string, approvalStatus: string) => task(id, '2026-10-01', 20, { approvalStatus });
    const unchanged = compare(
      [approved('a', 'Approved'), approved('b', 'Pending')],
      [approved('a2', 'Approved'), approved('b2', 'Pending')],
    );
    expect(summaries(unchanged)).toEqual([]);
    const oneApproved = compare(
      [approved('a', 'Pending'), approved('b', 'Pending')],
      [approved('a2', 'Approved'), approved('b2', 'Pending')],
    );
    expect(summaries(oneApproved)).toEqual(['Inspection approval changed from Pending to Approved.']);
  });

  it('completed, reopened and owner lines stay as pass 10 had them', () => {
    // Dana's and Eli's: the owners still tell them apart, whatever the percents.
    const owners = compare(
      [task('a', '2026-10-01', 50), task('b', '2026-10-20', 10, { owner: 'Eli' })],
      [task('b2', '2026-10-02', 100, { owner: 'Eli' }), task('a2', '2026-10-30', 50)],
    );
    expect(summaries(owners).sort()).toEqual([
      'Inspection finish changed from 2026-10-01 to 2026-10-30.',
      'Inspection finish changed from 2026-10-20 to 2026-10-02.',
      'Inspection was completed.',
    ]);
    // Both reassigned, to whom unknown: still added and removed, though the percents would pick one.
    const reassigned = compare(
      [task('a', '2026-10-01', 50), task('b', '2026-10-20', 10, { owner: 'Eli' })],
      [task('a2', '2026-10-05', 50, { owner: 'Fay' }), task('b2', '2026-10-25', 10, { owner: 'Gus' })],
    );
    expect(kinds(reassigned)).toEqual(['added', 'added', 'removed', 'removed']);
    // One of two reopened: named once, at the percent it was reopened at.
    const reopened = compare(
      [task('a', '2026-10-01', 100), task('b', '2026-10-20', 100)],
      [task('a2', '2026-10-01', 100), task('b2', '2026-10-20', 60)],
    );
    expect(summaries(reopened)).toEqual(['Inspection was reopened at 60% complete.']);
  });
});

describe('L2 through the real import merge, in both report formats', () => {
  const row = (batch: string, id: string, finishDate: string, percent: number, sourceRowNumber: number) => {
    const imported = batch === 'tower-v1' ? '2026-09-01T08:00:00.000Z' : '2026-09-29T08:00:00.000Z';
    return {
      id, projectName: 'Tower', scheduleProjectName: 'Tower', locationName: 'Level 2',
      taskName: 'Inspection', startDate: '2026-09-01', finishDate, milestone: '', owner: 'Dana', contractor: 'Acme',
      percentComplete: percent, priority: 'Medium', status: percent >= 100 ? 'Complete' : 'In Progress',
      notes: '', importBatchId: batch, sourceDocumentId: `doc-${batch}`, importedFrom: `${batch}.pdf`,
      importedAt: imported, createdAt: imported, sourceRowNumber,
    } as unknown as ScheduleItem;
  };
  const scheduleDocument = (batch: string, isCurrent: boolean) => ({
    id: `doc-${batch}`, name: `${batch}.pdf`, originalFileName: `${batch}.pdf`, category: 'Schedules',
    projectName: 'Tower', importBatchId: batch, isCurrent, uri: `file:///docs/${batch}.pdf`, notes: '',
    importedAt: batch === 'tower-v1' ? '2026-09-01T08:00:00.000Z' : '2026-09-29T08:00:00.000Z',
  }) as unknown as ReferenceDocument;
  const truthOf = (scheduleItems: ScheduleItem[], now: string): DAVEProjectTruth => buildDAVEProjectTruth({
    projectId: 'report:tower', projectName: 'Tower', updates: [], scheduleItems, projectAreas: [], referenceDocuments: [], now,
  });
  const snapshotOf = (truth: DAVEProjectTruth, capturedAt: string): DAVEReportSnapshot => buildDAVEReportSnapshot({
    truths: [truth], scopeKey: daveReportSnapshotScopeKey(['Tower']),
    sourceFingerprint: buildDAVEReportSourceFingerprint([truth]), capturedAt, reportFormat: 'project_manager',
  });
  const draft = {
    id: 'draft-1', reportType: 'daily_project_update', audience: 'owner',
    title: 'Tower update', subject: 'Tower update', body: '', openingLine: '', closingLine: '',
    executiveSummary: [], sections: [], locationGroups: [], actionItems: [], imageReferences: [],
    risks: [], decisionsNeeded: [], confidence: 'high', reportReadiness: 'high',
    needsReview: false, reviewFlags: [], sourceEvidence: [], constructionUnderstanding: {},
    generatedAt: NOW,
  } as unknown as PIEReportDraft;

  // Changed on purpose by A6 pass 12 L1 (30 Sep 2026): the revised rows carry
  // the task each revises (revisedFromTaskIds: row 1 revises row 1), and the
  // report now pairs by those, as field updates and Project Truth do. Pass 11
  // pinned the report's own guess, which named the other Inspection completed.
  it('the revised file\'s row 1 is complete on Oct 2 and row 2 is 50% due Oct 30: the report follows the import\'s pairing', () => {
    const v1 = [
      row('tower-v1', 'tower-v1-inspection-1', '2026-10-01', 50, 1),
      row('tower-v1', 'tower-v1-inspection-2', '2026-10-20', 10, 2),
    ];
    const merged = mergeApprovedScheduleImportItems({
      existing: v1,
      imported: [
        row('tower-v2', 'tower-v2-inspection-1', '2026-10-02', 100, 1),
        row('tower-v2', 'tower-v2-inspection-2', '2026-10-30', 50, 2),
      ],
      completionMatch: () => null,
      mergeCompletion: item => item,
      approvedAt: '2026-09-29T08:00:00.000Z',
    });
    const shown = selectAuthoritativeScheduleItems({
      scheduleItems: [...merged.next, ...merged.additions],
      scheduleDocuments: [scheduleDocument('tower-v1', false), scheduleDocument('tower-v2', true)],
    }) as ScheduleItem[];
    const briefing = buildDAVEReportBriefing({
      truths: [truthOf(shown, NOW)],
      selectedProjectNames: ['Tower'],
      previousSnapshot: snapshotOf(truthOf(v1, REPORT_SENT), REPORT_SENT),
    });
    for (const format of ['project_manager', 'executive'] as const) {
      const body = enhanceDAVEReportDraft(draft, briefing, format).body;
      const start = body.indexOf('SINCE THE LAST APPROVED REPORT');
      const since = body.slice(start, body.indexOf('COMPLETED WORK', start));
      expect(since).toContain('+1 completed; -1 open;');
      expect(since).toContain('Tower: Inspection was completed.');
      expect(since).toContain('Tower: Inspection finish changed from 2026-10-01 to 2026-10-02.');
      expect(since).toContain('Tower: Inspection moved from 10% to 50% complete.');
      expect(since).toContain('Tower: Inspection finish changed from 2026-10-20 to 2026-10-30.');
      expect(since).not.toMatch(/was added|was removed|2026-10-01 to 2026-10-30|2026-10-20 to 2026-10-02/);
    }
  });
});
