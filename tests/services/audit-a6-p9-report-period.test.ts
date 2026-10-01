/**
 * Whole-app audit A6 pass 9 (30 Sep 2026), "since the last report".
 *
 * M1. "And N more changes." overcounted after every schedule revision. A
 *     revised task is a new row with a new createdAt, so the report added
 *     "Tower: Frame walls was updated." next to the real comparison line and
 *     counted both: a weekly update moving 8 tasks named 6 finish changes and
 *     said "And 10 more changes." (2 more existed); with 4 moved it named the
 *     5 real changes, added "Frame walls was updated." and "And 3 more
 *     changes." (none existed), in both formats. A task that already has a
 *     comparison line no longer gets a "was updated." line, and the count is
 *     taken after that, so it equals the lines not shown.
 * L1. Two same-named tasks in one area, both revised with their finish order
 *     swapped, were cross-paired: "+0 completed" yet "Inspection was
 *     completed." and "…was reopened", owners swapped. Same-named tasks pair
 *     in finish order only when each pair also agrees on status and owner;
 *     otherwise they are said as added and removed.
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

type RowOptions = Readonly<{
  percentComplete?: number;
  status?: string;
  locationName?: string;
  owner?: string;
  id?: string;
  updatedAt?: string;
}>;

function row(batch: string, taskName: string, finishDate: string, options: RowOptions = {}): ScheduleItem {
  const imported = batch === 'tower-v1' ? '2026-09-01T08:00:00.000Z' : '2026-09-29T08:00:00.000Z';
  return {
    id: options.id ?? `${batch}-${taskName.toLowerCase().replace(/\s+/g, '-')}`,
    projectName: 'Tower', scheduleProjectName: 'Tower', locationName: options.locationName ?? 'Level 2',
    taskName, startDate: '2026-09-01', finishDate, milestone: '', owner: options.owner ?? 'Dana', contractor: 'Acme',
    percentComplete: options.percentComplete ?? 40, priority: 'Medium', status: options.status ?? 'In Progress',
    notes: '', importBatchId: batch, sourceDocumentId: `doc-${batch}`, importedFrom: `${batch}.pdf`,
    importedAt: imported, createdAt: imported,
    ...(options.updatedAt ? { updatedAt: options.updatedAt } : {}),
  } as unknown as ScheduleItem;
}
const scheduleDocument = (batch: string, isCurrent: boolean) => ({
  id: `doc-${batch}`, name: `${batch}.pdf`, originalFileName: `${batch}.pdf`, category: 'Schedules',
  projectName: 'Tower', importBatchId: batch, isCurrent, uri: `file:///docs/${batch}.pdf`, notes: '',
  importedAt: batch === 'tower-v1' ? '2026-09-01T08:00:00.000Z' : '2026-09-29T08:00:00.000Z',
}) as unknown as ReferenceDocument;

/** The owner approves a revised file: the real merge, then the schedule the app shows. */
function approveRevision(existing: ScheduleItem[], revised: ScheduleItem[]) {
  const merged = mergeApprovedScheduleImportItems({
    existing,
    imported: revised,
    completionMatch: () => null,
    mergeCompletion: item => item,
    approvedAt: '2026-09-29T08:00:00.000Z',
  });
  return selectAuthoritativeScheduleItems({
    scheduleItems: [...merged.next, ...merged.additions],
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

/** The written report's "since" lines, in both formats. */
function sinceLines(scheduleItems: ScheduleItem[], previous: DAVEReportSnapshot) {
  const briefing = buildDAVEReportBriefing({
    truths: [truthOf(scheduleItems, NOW)],
    selectedProjectNames: ['Tower'],
    previousSnapshot: previous,
  });
  return (['project_manager', 'executive'] as const).map(format => {
    const body = enhanceDAVEReportDraft(draft, briefing, format).body;
    const start = body.indexOf('SINCE THE LAST APPROVED REPORT');
    return body.slice(start, body.indexOf('COMPLETED WORK', start)).split('\n').filter(line => line.startsWith('• '));
  });
}

describe('M1: "And N more changes." counts only the changes not shown', () => {
  const names = ['Frame walls', 'Pour slab', 'Set roof', 'Hang drywall', 'Tape drywall', 'Paint walls', 'Hang doors', 'Set trim'];
  const v1 = names.map((name, index) => row('tower-v1', name, `2026-10-${String(10 + index).padStart(2, '0')}`));
  const lastWeek = snapshotOf(truthOf(v1, REPORT_SENT), REPORT_SENT);

  it('a weekly update moving 8 tasks: six finish changes named, then "And 2 more changes." (not 10)', () => {
    const shown = approveRevision(v1, names.map((name, index) =>
      row('tower-v2', name, `2026-11-${String(10 + index).padStart(2, '0')}`)));
    // The premise: every moved task is a new row made at the import.
    expect(shown.every(item => item.id.startsWith('tower-v2-'))).toBe(true);
    for (const lines of sinceLines(shown, lastWeek)) {
      expect(lines).toHaveLength(8);
      expect(lines.slice(1, 7).every(line => / finish changed from /.test(line))).toBe(true);
      expect(lines.at(-1)).toBe('• And 2 more changes.');
      expect(lines.join('\n')).not.toContain('was updated.');
    }
  });

  it('4 moved, one completed: the five real changes and nothing else', () => {
    const shown = approveRevision(v1, names.map((name, index) => {
      if (index >= 4) return row('tower-v2', name, `2026-10-${String(10 + index).padStart(2, '0')}`);
      return row('tower-v2', name, `2026-11-${String(10 + index).padStart(2, '0')}`,
        index === 1 ? { percentComplete: 100, status: 'Complete' } : {});
    }));
    for (const lines of sinceLines(shown, lastWeek)) {
      expect(lines[0]).toMatch(/^• \+1 completed; /);
      expect(lines.slice(1)).toEqual(expect.arrayContaining([
        '• Tower: Pour slab was completed.',
        '• Tower: Frame walls finish changed from 2026-10-10 to 2026-11-10.',
        '• Tower: Pour slab finish changed from 2026-10-11 to 2026-11-11.',
        '• Tower: Set roof finish changed from 2026-10-12 to 2026-11-12.',
        '• Tower: Hang drywall finish changed from 2026-10-13 to 2026-11-13.',
      ]));
      expect(lines).toHaveLength(6);
      expect(lines.join('\n')).not.toContain('was updated.');
      expect(lines.join('\n')).not.toContain('more change');
    }
  });

  it('a task changed during the period with nothing the report compares still says it was updated', () => {
    const notesOnly = v1.map(item => item.taskName === 'Set trim'
      ? { ...item, notes: 'Trim delivered.', updatedAt: '2026-09-28T09:00:00.000Z' } as ScheduleItem
      : item);
    for (const lines of sinceLines(notesOnly, lastWeek)) {
      expect(lines.slice(1)).toEqual(['• Tower: Set trim was updated.']);
    }
  });

  it('the briefing count equals the comparison lines plus the updates of tasks without one', () => {
    const shown = approveRevision(v1, names.map((name, index) =>
      row('tower-v2', name, `2026-11-${String(10 + index).padStart(2, '0')}`)));
    const briefing = buildDAVEReportBriefing({
      truths: [truthOf(shown, NOW)],
      selectedProjectNames: ['Tower'],
      previousSnapshot: lastWeek,
    });
    expect(briefing.recentChangeCount).toBe(8);
    expect(briefing.recentChanges.map(change => change.source)).toEqual(Array(8).fill('approved_report_comparison'));
  });
});

describe('L1: same-named tasks whose finish order swapped are not cross-paired', () => {
  const task = (id: string, finishDate: string, owner: string, complete: boolean) => ({
    taskId: id, taskName: 'Inspection', areaName: 'Level 2', owner,
    status: complete ? 'Complete' : 'In Progress', percentComplete: complete ? 100 : 0,
    finishDate, urgency: 'not_urgent', approvalStatus: null, estimatedScheduleImpactDays: null,
  });
  const at = (tasks: unknown[], capturedAt: string) => buildDAVEReportSnapshot({
    truths: [{ projectName: 'Tower', schedule: tasks } as never], scopeKey: 'tower', sourceFingerprint: capturedAt, capturedAt,
  });

  it('Dana\'s open inspection moved later and Eli\'s completed one moved earlier: no "completed" or "reopened"', () => {
    const comparison = compareDAVEReportSnapshots({
      previous: at([task('a1', '2026-10-01', 'Dana', false), task('a2', '2026-11-01', 'Eli', true)], REPORT_SENT),
      current: at([task('b1', '2026-11-05', 'Dana', false), task('b2', '2026-10-05', 'Eli', true)], NOW),
    });
    expect(comparison.completeDelta).toBe(0);
    const kinds = comparison.changes.map(change => change.kind);
    expect(kinds).not.toContain('completed');
    expect(kinds).not.toContain('reopened');
    expect(kinds).not.toContain('owner');
    expect([...kinds].sort()).toEqual(['added', 'added', 'removed', 'removed']);
  });

  it('the same through the real import merge, in both report formats', () => {
    const inspection = (batch: string, id: string, finishDate: string, owner: string, complete: boolean, sourceRowNumber: number) => ({
      ...row(batch, 'Inspection', finishDate, { id, owner, ...(complete ? { percentComplete: 100, status: 'Complete' } : { percentComplete: 0, status: 'Not Started' }) }),
      sourceRowNumber,
    }) as ScheduleItem;
    const v1 = [
      inspection('tower-v1', 'tower-v1-inspection-1', '2026-10-01', 'Dana', false, 1),
      inspection('tower-v1', 'tower-v1-inspection-2', '2026-11-01', 'Eli', true, 2),
    ];
    const shown = approveRevision(v1, [
      inspection('tower-v2', 'tower-v2-inspection-1', '2026-11-05', 'Dana', false, 1),
      inspection('tower-v2', 'tower-v2-inspection-2', '2026-10-05', 'Eli', true, 2),
    ]);
    const lastWeek = snapshotOf(truthOf(v1, REPORT_SENT), REPORT_SENT);
    for (const lines of sinceLines(shown, lastWeek)) {
      expect(lines[0]).toMatch(/^• \+0 completed; /);
      const text = lines.join('\n');
      expect(text).not.toContain('Inspection was completed.');
      expect(text).not.toContain('was reopened');
      expect(text).not.toContain('owner changed');
    }
  });

  it('finish order kept, with the same status and owner each: still paired as finish changes', () => {
    const comparison = compareDAVEReportSnapshots({
      previous: at([task('a1', '2026-10-01', 'Dana', false), task('a2', '2026-11-01', 'Eli', true)], REPORT_SENT),
      current: at([task('b1', '2026-10-05', 'Dana', false), task('b2', '2026-11-05', 'Eli', true)], NOW),
    });
    expect(comparison.changes.map(change => change.summary)).toEqual([
      'Inspection finish changed from 2026-10-01 to 2026-10-05.',
      'Inspection finish changed from 2026-11-01 to 2026-11-05.',
    ]);
  });

  it('a single revised task still reports its own completion and owner change', () => {
    const comparison = compareDAVEReportSnapshots({
      previous: at([task('a1', '2026-10-01', 'Dana', false)], REPORT_SENT),
      current: at([task('b1', '2026-10-05', 'Eli', true)], NOW),
    });
    expect(comparison.changes.map(change => change.kind)).toEqual(['completed', 'finish_date', 'owner']);
  });
});
