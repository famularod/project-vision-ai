/**
 * Whole-app audit A6 pass 8 (30 Sep 2026), "since the last report".
 *
 * M2. A weekly schedule update that moves a task's dates saves the task as a
 *     new row with the file's id (ScheduleImportMerge), and the report period
 *     matched tasks by id. Frame walls moved from Oct 20 to Nov 3 read as
 *     "Tower: Frame walls was added to the project plan." and "…was removed
 *     from the current project plan.", with no finish change, and a revised
 *     task completed in the file was not reported as completed. Those false
 *     lines filled the six "since" lines of both formats. Now a task the
 *     previous report had and the current plan lost is paired with the new
 *     row of the same name, project and area (as the import pairs them), and
 *     the two are compared as one task.
 * L1. A completion took two of the six lines ("X was completed." and "X
 *     changed from In Progress to Complete."), so "+4 completed" named three.
 *     The status line is dropped when the task has a completed or reopened
 *     line, and "And N more changes." says what was cut.
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
} from '../../services/DAVEReportSnapshot';
import { mergeApprovedScheduleImportItems } from '../../services/ScheduleImportMerge';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import type { PIEReportDraft } from '../../services/PIEReporter';
import type { ReferenceDocument, ScheduleItem } from '../../types';

const NOW = '2026-09-30T15:00:00.000Z';
const REPORT_SENT = '2026-09-23T15:00:00.000Z';

function row(
  batch: string,
  taskName: string,
  finishDate: string,
  progress: Readonly<{ percentComplete?: number; status?: string; locationName?: string }> = {},
): ScheduleItem {
  return {
    id: `${batch}-${taskName.toLowerCase().replace(/\s+/g, '-')}`,
    projectName: 'Tower', scheduleProjectName: 'Tower', locationName: progress.locationName ?? 'Level 2',
    taskName, startDate: '2026-09-01', finishDate, milestone: '', owner: 'Dana', contractor: 'Acme',
    percentComplete: progress.percentComplete ?? 40, priority: 'Medium', status: progress.status ?? 'In Progress',
    notes: '', importBatchId: batch, sourceDocumentId: `doc-${batch}`, importedFrom: `${batch}.pdf`,
    importedAt: batch === 'tower-v1' ? '2026-09-01T08:00:00.000Z' : '2026-09-29T08:00:00.000Z',
    createdAt: batch === 'tower-v1' ? '2026-09-01T08:00:00.000Z' : '2026-09-29T08:00:00.000Z',
  } as unknown as ScheduleItem;
}
const scheduleDocument = (batch: string, isCurrent: boolean) => ({
  id: `doc-${batch}`, name: `${batch}.pdf`, originalFileName: `${batch}.pdf`, category: 'Schedules',
  projectName: 'Tower', importBatchId: batch, isCurrent, uri: `file:///docs/${batch}.pdf`, notes: '',
  importedAt: batch === 'tower-v1' ? '2026-09-01T08:00:00.000Z' : '2026-09-29T08:00:00.000Z',
}) as unknown as ReferenceDocument;

const V1 = [
  row('tower-v1', 'Frame walls', '2026-10-20'),
  row('tower-v1', 'Pour slab', '2026-10-27'),
  row('tower-v1', 'Set roof', '2026-11-10'),
  row('tower-v1', 'Hang drywall', '2026-11-17'),
];

/** The owner approves a revised file: the real merge, then the schedule the app shows. */
function approveRevision(existing: ScheduleItem[], revised: ScheduleItem[]) {
  const merged = mergeApprovedScheduleImportItems({
    existing,
    imported: revised,
    completionMatch: () => null,
    mergeCompletion: item => item,
    approvedAt: '2026-09-29T08:00:00.000Z',
  });
  const all = [...merged.next, ...merged.additions];
  return selectAuthoritativeScheduleItems({
    scheduleItems: all,
    scheduleDocuments: [scheduleDocument('tower-v1', false), scheduleDocument('tower-v2', true)],
  }) as ScheduleItem[];
}

const truthOf = (scheduleItems: ScheduleItem[], now: string): DAVEProjectTruth => buildDAVEProjectTruth({
  projectId: 'report:tower',
  projectName: 'Tower',
  updates: [],
  scheduleItems,
  projectAreas: [],
  referenceDocuments: [],
  now,
});
const snapshotOf = (truth: DAVEProjectTruth, capturedAt: string) => buildDAVEReportSnapshot({
  truths: [truth],
  scopeKey: daveReportSnapshotScopeKey(['Tower']),
  sourceFingerprint: buildDAVEReportSourceFingerprint([truth]),
  capturedAt,
  reportFormat: 'project_manager',
});

const draft = {
  id: 'draft-1', reportType: 'daily_project_update', audience: 'owner',
  title: 'Tower update', subject: 'Tower update', body: '', openingLine: '', closingLine: '',
  executiveSummary: [], sections: [], locationGroups: [], actionItems: [], imageReferences: [],
  risks: [], decisionsNeeded: [], confidence: 'high', reportReadiness: 'high',
  needsReview: false, reviewFlags: [], sourceEvidence: [], constructionUnderstanding: {},
  generatedAt: NOW,
} as unknown as PIEReportDraft;

/** The written report's "since" section, in both formats. */
function sinceSections(scheduleItems: ScheduleItem[], previousTruth: DAVEProjectTruth) {
  const truth = truthOf(scheduleItems, NOW);
  const briefing = buildDAVEReportBriefing({
    truths: [truth],
    selectedProjectNames: ['Tower'],
    previousSnapshot: snapshotOf(previousTruth, REPORT_SENT),
  });
  return (['project_manager', 'executive'] as const).map(format => {
    const body = enhanceDAVEReportDraft(draft, briefing, format).body;
    const start = body.indexOf('SINCE THE LAST APPROVED REPORT');
    return body.slice(start, body.indexOf('COMPLETED WORK', start));
  });
}

const lastWeek = truthOf(V1, REPORT_SENT);

describe('M2: a schedule revision reads as what changed, not as tasks removed and added', () => {
  it('the real merge gives a task on new dates a new id (the premise)', () => {
    const shown = approveRevision(V1, [
      row('tower-v2', 'Frame walls', '2026-11-03'),
      row('tower-v2', 'Pour slab', '2026-10-27'),
      row('tower-v2', 'Set roof', '2026-11-10'),
      row('tower-v2', 'Hang drywall', '2026-11-17'),
    ]);
    const frame = shown.find(item => item.taskName === 'Frame walls') as ScheduleItem;
    expect(frame.id).toBe('tower-v2-frame-walls');
    expect(frame.finishDate).toBe('2026-11-03');
    // The unchanged tasks keep their ids.
    expect(shown.find(item => item.taskName === 'Pour slab')?.id).toBe('tower-v1-pour-slab');
  });

  it('Frame walls moved Oct 20 to Nov 3: "finish changed", not "added" and "removed"', () => {
    const shown = approveRevision(V1, [
      row('tower-v2', 'Frame walls', '2026-11-03'),
      row('tower-v2', 'Pour slab', '2026-10-27'),
      row('tower-v2', 'Set roof', '2026-11-10'),
      row('tower-v2', 'Hang drywall', '2026-11-17'),
    ]);
    const comparison = compareDAVEReportSnapshots({
      current: snapshotOf(truthOf(shown, NOW), NOW),
      previous: snapshotOf(lastWeek, REPORT_SENT),
    });
    expect(comparison.changes.map(change => change.summary)).toEqual([
      'Frame walls finish changed from 2026-10-20 to 2026-11-03.',
    ]);
    expect(comparison).toMatchObject({ completeDelta: 0, openDelta: 0 });
    for (const section of sinceSections(shown, lastWeek)) {
      expect(section).toContain('Tower: Frame walls finish changed from 2026-10-20 to 2026-11-03.');
      expect(section).not.toMatch(/was added to the project plan|was removed from the current project plan/);
    }
  });

  it('a weekly update: completions on revised tasks are reported, and the six lines are true in both formats', () => {
    const shown = approveRevision(V1, [
      row('tower-v2', 'Frame walls', '2026-11-03'),
      row('tower-v2', 'Pour slab', '2026-10-24', { percentComplete: 100, status: 'Complete' }),
      row('tower-v2', 'Set roof', '2026-11-14'),
      row('tower-v2', 'Hang drywall', '2026-11-21'),
    ]);
    const comparison = compareDAVEReportSnapshots({
      current: snapshotOf(truthOf(shown, NOW), NOW),
      previous: snapshotOf(lastWeek, REPORT_SENT),
    });
    expect(comparison.completeDelta).toBe(1);
    expect(comparison.changes.map(change => change.summary)).toEqual(expect.arrayContaining([
      'Pour slab was completed.',
      'Pour slab finish changed from 2026-10-27 to 2026-10-24.',
      'Frame walls finish changed from 2026-10-20 to 2026-11-03.',
      'Set roof finish changed from 2026-11-10 to 2026-11-14.',
      'Hang drywall finish changed from 2026-11-17 to 2026-11-21.',
    ]));
    expect(comparison.changes.map(change => change.kind)).not.toContain('added');
    expect(comparison.changes.map(change => change.kind)).not.toContain('removed');
    for (const section of sinceSections(shown, lastWeek)) {
      expect(section).toContain('+1 completed; ');
      expect(section).toContain('Tower: Pour slab was completed.');
      expect(section).not.toMatch(/was added to the project plan|was removed from the current project plan/);
    }
  });

  it('a task really added or removed is still said; a same-named task in another area is another task', () => {
    const shown = approveRevision(V1, [
      row('tower-v2', 'Frame walls', '2026-10-20'),
      row('tower-v2', 'Pour slab', '2026-10-27'),
      row('tower-v2', 'Set roof', '2026-11-10'),
      // Hang drywall left the plan; Paint walls joined it; Frame walls on Level 3 is a new task.
      row('tower-v2', 'Paint walls', '2026-12-01'),
      row('tower-v2', 'Frame walls', '2026-11-03', { locationName: 'Level 3' }),
    ]);
    const summaries = compareDAVEReportSnapshots({
      current: snapshotOf(truthOf(shown, NOW), NOW),
      previous: snapshotOf(lastWeek, REPORT_SENT),
    }).changes.map(change => change.summary);
    expect(summaries).toEqual(expect.arrayContaining([
      'Paint walls was added to the project plan.',
      'Frame walls was added to the project plan.',
      'Hang drywall was removed from the current project plan.',
    ]));
    expect(summaries.filter(summary => summary.startsWith('Frame walls'))).toEqual(['Frame walls was added to the project plan.']);
  });

  it('two same-named tasks that both moved pair in finish order; one of two cannot pair with either', () => {
    const task = (id: string, finishDate: string, areaName: string | null = 'Level 2') => ({
      taskId: id, taskName: 'Inspection', areaName, owner: '', status: 'In Progress', percentComplete: 40,
      finishDate, urgency: 'not_urgent', approvalStatus: null, estimatedScheduleImpactDays: null,
    });
    const at = (tasks: unknown[], capturedAt: string) => buildDAVEReportSnapshot({
      truths: [{ projectName: 'Tower', schedule: tasks } as never], scopeKey: 'tower', sourceFingerprint: capturedAt, capturedAt,
    });
    const both = compareDAVEReportSnapshots({
      previous: at([task('a1', '2026-10-01'), task('a2', '2026-11-01')], REPORT_SENT),
      current: at([task('b1', '2026-10-05'), task('b2', '2026-11-05')], NOW),
    });
    expect(both.changes.map(change => change.summary)).toEqual([
      'Inspection finish changed from 2026-10-01 to 2026-10-05.',
      'Inspection finish changed from 2026-11-01 to 2026-11-05.',
    ]);
    // Two before, one now: which one it is cannot be told, so nothing is paired.
    const oneOfTwo = compareDAVEReportSnapshots({
      previous: at([task('a1', '2026-10-01'), task('a2', '2026-11-01')], REPORT_SENT),
      current: at([task('b1', '2026-10-05')], NOW),
    });
    expect(oneOfTwo.changes.map(change => change.kind).sort()).toEqual(['added', 'removed', 'removed']);
    // A previous task with no area pairs with the same task now given one, as the import pairs them.
    const areaFilled = compareDAVEReportSnapshots({
      previous: at([task('a1', '2026-10-01', null)], REPORT_SENT),
      current: at([task('b1', '2026-10-05')], NOW),
    });
    expect(areaFilled.changes.map(change => change.kind).sort()).toEqual(['area', 'finish_date']);
  });
});

describe('L1: each completion takes one line, and what is cut is counted', () => {
  it('four completions: four named lines, no status repeats, and "And N more changes." for the rest', () => {
    const tasks = ['Frame walls', 'Pour slab', 'Set roof', 'Hang drywall'];
    const plan = (done: boolean) => tasks.map((name, index) =>
      row('tower-v1', name, `2026-10-2${index}`, done ? { percentComplete: 100, status: 'Complete' } : {}));
    const before = truthOf(plan(false), REPORT_SENT);
    const now = plan(true);
    const comparison = compareDAVEReportSnapshots({
      current: snapshotOf(truthOf(now, NOW), NOW),
      previous: snapshotOf(before, REPORT_SENT),
    });
    expect(comparison.changes.map(change => change.kind)).toEqual(['completed', 'completed', 'completed', 'completed']);
    for (const section of sinceSections(now, before)) {
      expect(section).toContain('+4 completed; ');
      for (const name of tasks) expect(section).toContain(`Tower: ${name} was completed.`);
      expect(section).not.toContain('changed from In Progress to Complete');
      expect(section).not.toContain('more change');
    }
  });

  it('more than six lines: the first six, then "And N more changes."', () => {
    const tasks = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map(letter => `Task ${letter}`);
    const plan = (moved: boolean) => tasks.map(name =>
      row('tower-v1', name, moved ? '2026-12-01' : '2026-11-01'));
    const before = truthOf(plan(false), REPORT_SENT);
    const now = plan(true).map(item => ({ ...item, id: item.id }));
    for (const section of sinceSections(now, before)) {
      const lines = section.split('\n').filter(line => line.startsWith('• '));
      // The movement line, six changes, and the count of the rest.
      expect(lines).toHaveLength(8);
      expect(lines.at(-1)).toBe('• And 2 more changes.');
    }
  });
});
