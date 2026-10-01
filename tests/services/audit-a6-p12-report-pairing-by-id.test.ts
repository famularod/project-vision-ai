/**
 * Whole-app audit A6 pass 12 L1 (30 Sep 2026), "since the last report", on
 * pass 11 L2 (a tie between same-named tasks went to the least percent
 * movement first).
 *
 * Two "Inspection" tasks, Dana's, on Level 2: A 40% due Oct 1, B 60% due
 * Dec 1. A revised schedule re-dated both by a week, A now 55% and B lowered
 * to 50%. The percent-first tie-break paired A with B's row and B with A's:
 * "moved from 40% to 50%", "finish changed from 2026-10-01 to 2026-12-08",
 * "moved from 60% to 55%", "finish changed from 2026-12-01 to 2026-10-08",
 * none of which happened. The import had already recorded which saved task
 * each revised row replaces (revisedFromTaskIds, the ids field updates and
 * Project Truth resolve through), and the report never read it, so the
 * report and the rest of the app could disagree on which Inspection was
 * completed.
 *
 * Now each task in a report snapshot carries the ids it had before new
 * masters moved it (earlierTaskIds), and a task is paired by id first: a
 * current task whose own id, or one of its earlier ids, is an earlier
 * report's task is that task. Only tasks with no id link (rows saved before
 * the import kept earlier ids) are paired by the heuristic, which now puts
 * how far the finish dates moved before the percent change (finish order was
 * the pass 10 behaviour, and the import pairs a revision in file order). A
 * tie that would still print different lines stays added and removed.
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
import { scheduleTaskEarlierIds } from '../../services/ScheduleTaskRevisions';
import type { PIEReportDraft } from '../../services/PIEReporter';
import type { ReferenceDocument, ScheduleItem } from '../../types';

const NOW = '2026-09-30T15:00:00.000Z';
const REPORT_SENT = '2026-09-23T15:00:00.000Z';

const task = (id: string, finishDate: string, percent: number, extra: Record<string, unknown> = {}) => ({
  taskId: id, taskName: 'Inspection', areaName: 'Level 2', owner: 'Dana',
  status: percent >= 100 ? 'Complete' : 'In Progress', percentComplete: percent,
  finishDate, urgency: 'not_urgent', approvalStatus: null, estimatedScheduleImpactDays: null, ...extra,
});
/** A revised row that answers to the earlier ids `from` (as the import records them). */
const revised = (id: string, from: string[], finishDate: string, percent: number, extra: Record<string, unknown> = {}) =>
  task(id, finishDate, percent, { earlierTaskIds: from, ...extra });
const at = (tasks: unknown[], capturedAt: string) => buildDAVEReportSnapshot({
  truths: [{ projectName: 'Tower', schedule: tasks } as never], scopeKey: 'tower', sourceFingerprint: capturedAt, capturedAt,
});
const compare = (previous: unknown[], current: unknown[]) => compareDAVEReportSnapshots({
  previous: at(previous, REPORT_SENT),
  current: at(current, NOW),
});
const summaries = (comparison: ReturnType<typeof compare>) => comparison.changes.map(change => change.summary);
const kinds = (comparison: ReturnType<typeof compare>) => comparison.changes.map(change => change.kind).sort();

const TRUE_LINES = [
  'Inspection finish changed from 2026-10-01 to 2026-10-08.',
  'Inspection finish changed from 2026-12-01 to 2026-12-08.',
  'Inspection moved from 40% to 55% complete.',
  'Inspection moved from 60% to 50% complete.',
];

describe('L1 through the real import merge: a revised task is the task the import says it revises', () => {
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
  /** v1 approved and sent; the revised v2 rows approved; what the report shows now. */
  const revise = (v1: ScheduleItem[], v2: ScheduleItem[]) => {
    const merged = mergeApprovedScheduleImportItems({
      existing: v1,
      imported: v2,
      completionMatch: () => null,
      mergeCompletion: item => item,
      approvedAt: '2026-09-29T08:00:00.000Z',
    });
    return selectAuthoritativeScheduleItems({
      scheduleItems: [...merged.next, ...merged.additions],
      scheduleDocuments: [scheduleDocument('tower-v1', false), scheduleDocument('tower-v2', true)],
    }) as ScheduleItem[];
  };
  const since = (v1: ScheduleItem[], shown: ScheduleItem[], format: 'project_manager' | 'executive') => {
    const briefing = buildDAVEReportBriefing({
      truths: [truthOf(shown, NOW)],
      selectedProjectNames: ['Tower'],
      previousSnapshot: snapshotOf(truthOf(v1, REPORT_SENT), REPORT_SENT),
    });
    const body = enhanceDAVEReportDraft(draft, briefing, format).body;
    const start = body.indexOf('SINCE THE LAST APPROVED REPORT');
    return { briefing, text: body.slice(start, body.indexOf('COMPLETED WORK', start)) };
  };

  it('row 1 40%→55% (Oct 1→Oct 8), row 2 60%→50% (Dec 1→Dec 8): the four true lines, in both formats', () => {
    const v1 = [
      row('tower-v1', 'tower-v1-inspection-1', '2026-10-01', 40, 1),
      row('tower-v1', 'tower-v1-inspection-2', '2026-12-01', 60, 2),
    ];
    const shown = revise(v1, [
      row('tower-v2', 'tower-v2-inspection-1', '2026-10-08', 55, 1),
      row('tower-v2', 'tower-v2-inspection-2', '2026-12-08', 50, 2),
    ]);
    // Pin changed deliberately (whole-app audit A5 pass 17 M2, 1 Oct 2026): the import recorded which saved
    // task each revised row replaces by file order. Same-named tasks now pair by their calendar days, then
    // only the one left with the one left; with both moved it pairs neither, so the rows list no earlier
    // ids and the report pairs them by its own rule, which gives the same four true lines.
    expect(shown.map(item => [item.id, scheduleTaskEarlierIds(item)])).toEqual([
      ['tower-v2-inspection-1', []],
      ['tower-v2-inspection-2', []],
    ]);
    for (const format of ['project_manager', 'executive'] as const) {
      const { text } = since(v1, shown, format);
      expect(text).toContain('+0 completed; +0 open; +0 overdue.');
      expect(text.split('\n').filter(line => line.startsWith('• Tower: ')).sort()).toEqual(
        TRUE_LINES.map(line => `• Tower: ${line}`),
      );
      expect(text).not.toMatch(/2026-10-01 to 2026-12-08|2026-12-01 to 2026-10-08|40% to 50%|60% to 55%/);
    }
  });

  // Pin changed deliberately (whole-app audit A5 pass 17 M2, 1 Oct 2026): both rows were moved, which the
  // import now pairs with neither (see above). Row 2 stays on its dates here, so the import pairs it on its
  // days and row 1 as the one left: row 1 is revised (it carries the id it replaced), row 2 is the saved
  // task itself (never revised, it carries none).
  it('the snapshot\'s tasks carry the ids the import recorded; a task never revised carries none', () => {
    const v1 = [
      row('tower-v1', 'tower-v1-inspection-1', '2026-10-01', 40, 1),
      row('tower-v1', 'tower-v1-inspection-2', '2026-12-01', 60, 2),
    ];
    const shown = revise(v1, [
      row('tower-v2', 'tower-v2-inspection-1', '2026-10-08', 55, 1),
      row('tower-v2', 'tower-v2-inspection-2', '2026-12-01', 50, 2),
    ]);
    const now = snapshotOf(truthOf(shown, NOW), NOW);
    expect(now.tasks.map(item => [item.taskId, item.earlierTaskIds]).sort()).toEqual([
      ['tower-v1-inspection-2', undefined],
      ['tower-v2-inspection-1', ['tower-v1-inspection-1']],
    ]);
    const before = snapshotOf(truthOf(v1, REPORT_SENT), REPORT_SENT);
    expect(before.tasks.every(item => !('earlierTaskIds' in item))).toBe(true);
  });

  it('the report names the Inspection the import (and so field updates and Project Truth) says was completed', () => {
    // Pass 11's case: A 50% due Oct 1, B 10% due Oct 20; the revised file's
    // row 1 is complete on Oct 2 and row 2 is 50% due Oct 30. The import says
    // row 1 revises A: A was completed. The report now says the same.
    const v1 = [
      row('tower-v1', 'tower-v1-inspection-1', '2026-10-01', 50, 1),
      row('tower-v1', 'tower-v1-inspection-2', '2026-10-20', 10, 2),
    ];
    const shown = revise(v1, [
      row('tower-v2', 'tower-v2-inspection-1', '2026-10-02', 100, 1),
      row('tower-v2', 'tower-v2-inspection-2', '2026-10-30', 50, 2),
    ]);
    const { briefing, text } = since(v1, shown, 'project_manager');
    const completed = briefing.reportingPeriod.changes.filter(change => change.kind === 'completed');
    expect(completed).toHaveLength(1);
    const completedRow = shown.find(item => item.id === completed[0].taskId) as ScheduleItem;
    // Pin changed deliberately (whole-app audit A5 pass 17 M2, 1 Oct 2026): both rows moved, so the import
    // pairs neither and the row lists no earlier id (it listed A's); the report still names A as completed.
    expect(completedRow.id).toBe('tower-v2-inspection-1');
    expect(scheduleTaskEarlierIds(completedRow)).toEqual([]);
    expect(text).toContain('Tower: Inspection was completed.');
    expect(text).toContain('Tower: Inspection finish changed from 2026-10-01 to 2026-10-02.');
    expect(text).toContain('Tower: Inspection moved from 10% to 50% complete.');
    expect(text).toContain('Tower: Inspection finish changed from 2026-10-20 to 2026-10-30.');
    expect(text).not.toMatch(/was added|was removed/);
  });

  // Pin changed deliberately (whole-app audit A5 pass 17 M2, 1 Oct 2026): this asserted the import paired
  // row 1 with row 1 by file order, and the report followed it. By order alone, a CSV sorted by start date
  // gave one twin's progress to the other; with both moved, the import now pairs neither, so the rows list
  // no earlier ids and the report pairs them by its own rule (how little each finish moved).
  it('the file swapped two same-named tasks\' finish order: the import pairs neither, and the report pairs them by its own rule', () => {
    // Row 1 (A) slipped from Oct 1 to Oct 25; row 2 (B) was pulled in from Oct 20 to Oct 5.
    const v1 = [
      row('tower-v1', 'tower-v1-inspection-1', '2026-10-01', 20, 1),
      row('tower-v1', 'tower-v1-inspection-2', '2026-10-20', 20, 2),
    ];
    const shown = revise(v1, [
      row('tower-v2', 'tower-v2-inspection-1', '2026-10-25', 20, 1),
      row('tower-v2', 'tower-v2-inspection-2', '2026-10-05', 20, 2),
    ]);
    expect(shown.map(item => [item.id, scheduleTaskEarlierIds(item)])).toEqual([
      ['tower-v2-inspection-1', []],
      ['tower-v2-inspection-2', []],
    ]);
    for (const format of ['project_manager', 'executive'] as const) {
      const { text } = since(v1, shown, format);
      expect(text.split('\n').filter(line => line.startsWith('• Tower: ')).sort()).toEqual([
        '• Tower: Inspection finish changed from 2026-10-01 to 2026-10-05.',
        '• Tower: Inspection finish changed from 2026-10-20 to 2026-10-25.',
      ]);
    }
  });

  it('the earlier ids do not change the report\'s fingerprint (an approval or a send from an earlier build is the same content)', () => {
    const v1 = [
      row('tower-v1', 'tower-v1-inspection-1', '2026-10-01', 40, 1),
      row('tower-v1', 'tower-v1-inspection-2', '2026-12-01', 60, 2),
    ];
    const shown = revise(v1, [
      row('tower-v2', 'tower-v2-inspection-1', '2026-10-08', 55, 1),
      row('tower-v2', 'tower-v2-inspection-2', '2026-12-01', 50, 2),
    ]);
    // Row 2 kept on its dates, so row 1 is paired and lists an id (A5 pass 17 M2: both moved, neither is).
    expect(shown.some(item => scheduleTaskEarlierIds(item).length > 0)).toBe(true);
    const withoutIds = shown.map(({ revisedFromTaskIds: _ids, ...item }) => item as ScheduleItem);
    expect(buildDAVEReportSourceFingerprint([truthOf(shown, NOW)]))
      .toBe(buildDAVEReportSourceFingerprint([truthOf(withoutIds, NOW)]));
  });
});

describe('L1: pairing by id first', () => {
  it('the ids pair the tasks even where the finish dates would pair them the other way', () => {
    // A moved from Oct 1 to Oct 25 and B from Oct 20 to Oct 5, as the import recorded.
    const comparison = compare(
      [task('a', '2026-10-01', 0), task('b', '2026-10-20', 0)],
      [revised('a2', ['a'], '2026-10-25', 0), revised('b2', ['b'], '2026-10-05', 0)],
    );
    expect(summaries(comparison).sort()).toEqual([
      'Inspection finish changed from 2026-10-01 to 2026-10-25.',
      'Inspection finish changed from 2026-10-20 to 2026-10-05.',
    ]);
  });

  it('a task revised twice (A→B→C) is the task the earlier report had, whichever of A or B that was', () => {
    for (const earlier of ['a', 'b']) {
      const comparison = compare(
        [task(earlier, '2026-10-01', 40), task('other', '2026-12-01', 60)],
        [revised('c', ['a', 'b'], '2026-10-15', 70), revised('other2', ['other'], '2026-11-20', 30)],
      );
      expect(summaries(comparison).sort()).toEqual([
        'Inspection finish changed from 2026-10-01 to 2026-10-15.',
        'Inspection finish changed from 2026-12-01 to 2026-11-20.',
        'Inspection moved from 40% to 70% complete.',
        'Inspection moved from 60% to 30% complete.',
      ]);
    }
  });

  it('one linked by id and one saved before the ids were kept: the first by id, the other by the heuristic', () => {
    const comparison = compare(
      [task('a', '2026-10-01', 0), task('b', '2026-10-20', 0)],
      [revised('a2', ['a'], '2026-10-25', 0), task('b2', '2026-10-05', 0)],
    );
    expect(summaries(comparison).sort()).toEqual([
      'Inspection finish changed from 2026-10-01 to 2026-10-25.',
      'Inspection finish changed from 2026-10-20 to 2026-10-05.',
    ]);
  });

  it('two tasks answering to one earlier task: neither is taken for it (never a guess between two)', () => {
    const comparison = compare(
      [task('a', '2026-10-01', 40)],
      [revised('x', ['a'], '2026-10-08', 50), revised('y', ['a'], '2026-10-09', 60)],
    );
    expect(kinds(comparison)).toEqual(['added', 'added', 'removed']);
  });

  it('a task still shown under its own id is never also taken by a revised row', () => {
    const comparison = compare(
      [task('a', '2026-10-01', 40)],
      [task('a', '2026-10-01', 40), revised('x', ['a'], '2026-10-08', 50)],
    );
    expect(summaries(comparison)).toEqual(['Inspection was added to the project plan.']);
  });

  it('a report saved before this change (no earlier ids on its tasks, read back from storage) still reads correctly', () => {
    const saved = JSON.parse(JSON.stringify(at([task('a', '2026-10-01', 40), task('b', '2026-12-01', 60)], REPORT_SENT)));
    expect(saved.tasks.every((item: object) => !('earlierTaskIds' in item))).toBe(true);
    const now = at([revised('a2', ['a'], '2026-10-08', 55), revised('b2', ['b'], '2026-12-08', 50)], NOW);
    expect(compareDAVEReportSnapshots({ previous: saved as DAVEReportSnapshot, current: now }).changes.map(change => change.summary).sort())
      .toEqual(TRUE_LINES);
    // And a current snapshot read back the same way, with earlier ids that are not a list.
    const odd = JSON.parse(JSON.stringify(now));
    odd.tasks[0].earlierTaskIds = 'a';
    odd.tasks[1].earlierTaskIds = [null, 7, 'b'];
    expect(() => compareDAVEReportSnapshots({ previous: saved as DAVEReportSnapshot, current: odd as DAVEReportSnapshot }))
      .not.toThrow();
  });
});

describe('L1: tasks with no id link, paired by the heuristic', () => {
  it('a percent lowered on one while the other rises: finish distance before percent, so no change no task made', () => {
    expect(summaries(compare(
      [task('a', '2026-10-01', 40), task('b', '2026-12-01', 60)],
      [task('a2', '2026-10-08', 55), task('b2', '2026-12-08', 50)],
    )).sort()).toEqual(TRUE_LINES);
  });

  it('one task only: a revised row with a lower percent is still paired', () => {
    expect(summaries(compare([task('a', '2026-10-01', 60)], [task('a2', '2026-10-08', 50)])).sort()).toEqual([
      'Inspection finish changed from 2026-10-01 to 2026-10-08.',
      'Inspection moved from 60% to 50% complete.',
    ]);
  });

  it('two tasks both progressing: finish order kept', () => {
    expect(summaries(compare(
      [task('a', '2026-10-01', 40), task('b', '2026-12-01', 60)],
      [task('a2', '2026-10-08', 55), task('b2', '2026-12-08', 70)],
    )).sort()).toEqual([
      'Inspection finish changed from 2026-10-01 to 2026-10-08.',
      'Inspection finish changed from 2026-12-01 to 2026-12-08.',
      'Inspection moved from 40% to 55% complete.',
      'Inspection moved from 60% to 70% complete.',
    ]);
  });

  it('a tie that would still print different lines stays added and removed', () => {
    const comparison = compare(
      [task('a', '2026-10-01', 10), task('b', '2026-10-01', 20)],
      [task('a2', '2026-10-01', 30), task('b2', '2026-10-01', 40)],
    );
    expect(kinds(comparison)).toEqual(['added', 'added', 'removed', 'removed']);
  });
});
