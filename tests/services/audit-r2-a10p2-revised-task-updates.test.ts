/**
 * Audit round 2, A10 pass 2, finding 1 (30 Sep 2026): after a schedule
 * revision, a task's field updates, an open Safety Concern included,
 * disappeared from Home, the project workspace, the Daily Brief, the saved
 * Project Truth and the daily (PM and executive) and combined reports. A task
 * whose dates changed comes in as a new row with a new id and the old row is
 * hidden, so the update's task id pointed at no current task, and the scope
 * rule dropped every update whose task was not in the current schedule.
 *
 * Now a task id that is not in the current schedule decides nothing on its
 * own: the update's own parent project decides (its scheduleProjectName, then
 * its projectName). It is left out only when the id points to ANOTHER
 * project's task, current or hidden. Updates of a deleted task never get
 * here: the App removes them first (tombstones, DAVEDeletedTaskEvidence).
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

import { buildRuntime } from '../../services/PIERuntime';
import { buildDAVEProjectTruth } from '../../services/DAVEProjectTruth';
import { mergeApprovedScheduleImportItems } from '../../services/ScheduleImportMerge';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import {
  projectUpdateBelongsToParentProject,
  projectUpdatesForParentProject,
} from '../../services/DAVEProjectUpdateScope';
import {
  buildCombinedReportAuthorityScope,
  buildDailyReportAuthorityScope,
  buildProjectIntelligenceAuthorityScope,
} from '../../services/ReportAuthorityScope';
import type { ProjectUpdate, ReferenceDocument, ScheduleItem } from '../../types';

const NOW = Date.parse('2026-09-30T15:00:00.000Z');
const DAY = 86_400_000;
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const ALPHA = 'Alpha Hangar';
const BRAVO = 'Bravo Hangar';

function task(id: string, project: string, batch: string, finishInDays: number): ScheduleItem {
  return {
    id, projectName: project, scheduleProjectName: project, locationName: `${project} North Bay`,
    taskName: `${project} steel erection`, startDate: day(NOW - 20 * DAY), finishDate: day(NOW + finishInDays * DAY),
    milestone: '', owner: 'David', contractor: '', percentComplete: 40, priority: 'High', status: 'In Progress',
    notes: '', importBatchId: batch, sourceDocumentId: `doc-${batch}`, importedFrom: `${batch}.pdf`,
    importedAt: batch.endsWith('v2') ? '2026-09-20T08:00:00.000Z' : '2026-09-01T08:00:00.000Z',
  } as ScheduleItem;
}

function scheduleDocument(batch: string, project: string, isCurrent: boolean): ReferenceDocument {
  return {
    id: `doc-${batch}`, name: `${batch}.pdf`, originalFileName: `${batch}.pdf`, category: 'Schedules',
    projectName: project, importBatchId: batch, isCurrent, uri: `file:///docs/${batch}.pdf`, notes: '',
    importedAt: batch.endsWith('v2') ? '2026-09-20T08:00:00.000Z' : '2026-09-01T08:00:00.000Z',
  } as unknown as ReferenceDocument;
}

function safetyUpdate(id: string, overrides: Partial<ProjectUpdate>): ProjectUpdate {
  return {
    id, projectName: ALPHA, scheduleProjectName: ALPHA, date: day(NOW - 2 * DAY), status: 'sent',
    notes: 'Guardrail missing at the north bay mezzanine edge.', recipients: { contactIds: [] },
    selectedAreaName: `${ALPHA} North Bay`,
    photos: [{
      id: `${id}-photo`, uri: `file:///p/${id}.jpg`, caption: 'Open edge', category: 'Safety Concern',
      actionRequired: 'Guardrail missing at the north bay mezzanine edge', actionOwner: 'David',
      actionDueDate: '', actionStatus: 'Open', selectedAreaName: `${ALPHA} North Bay`,
      locationCapturedAt: new Date(NOW - 2 * DAY).toISOString(),
    }],
    ...overrides,
  } as unknown as ProjectUpdate;
}

// The owner's schedules: v1 of each project, then a revised v2 in which the
// steel erection task moved by a week (new row, new id; the v1 row is hidden).
const alphaV1 = task('alpha-steel-v1', ALPHA, 'alpha-v1', 3);
const bravoV1 = task('bravo-steel-v1', BRAVO, 'bravo-v1', 3);
function revise(existing: ScheduleItem[], revised: ScheduleItem) {
  const merged = mergeApprovedScheduleImportItems({
    existing,
    imported: [revised],
    completionMatch: () => null,
    mergeCompletion: item => item,
  });
  return [...merged.next, ...merged.additions];
}
const allScheduleItems = revise(
  revise([alphaV1, bravoV1], task('alpha-steel-v2', ALPHA, 'alpha-v2', 10)),
  task('bravo-steel-v2', BRAVO, 'bravo-v2', 10),
);
const referenceDocuments = [
  scheduleDocument('alpha-v1', ALPHA, false),
  scheduleDocument('alpha-v2', ALPHA, true),
  scheduleDocument('bravo-v1', BRAVO, false),
  scheduleDocument('bravo-v2', BRAVO, true),
];
const currentScheduleItems = selectAuthoritativeScheduleItems({
  scheduleItems: allScheduleItems,
  scheduleDocuments: referenceDocuments,
}) as ScheduleItem[];

const alphaSafety = safetyUpdate('alpha-safety', { scheduleItemId: 'alpha-steel-v1', scheduleTaskName: `${ALPHA} steel erection` });
// Bravo's own update on its revised task: stays Bravo's.
const bravoSafety = safetyUpdate('bravo-safety', {
  projectName: BRAVO, scheduleProjectName: BRAVO, scheduleItemId: 'bravo-steel-v1',
  notes: 'Bravo harness anchor missing.',
});
// Contradictory record: its task id is Bravo's (hidden) task while its own
// fields name Alpha. The task decides, as it does for a current task.
const pointsAtBravoTask = safetyUpdate('points-at-bravo-task', {
  scheduleItemId: 'bravo-steel-v1', notes: 'Linked to the Bravo task.',
});
const updates = [alphaSafety, bravoSafety, pointsAtBravoTask];
const projectRecords = [{ name: ALPHA }, { name: BRAVO }] as never;
const NONE: never[] = [];

function common() {
  return {
    projectRecords,
    updates,
    scheduleItems: currentScheduleItems,
    knownScheduleItems: allScheduleItems,
    projectAreas: NONE,
    referenceDocuments,
    projectDocuments: NONE,
    captureMemories: NONE,
    contacts: { contacts: [] },
  };
}

describe('A10 pass 2 finding 1: a revised task keeps its field updates', () => {
  beforeEach(() => jest.useFakeTimers({ now: NOW }));
  afterEach(() => jest.useRealTimers());

  it('reproduces the revision: the update\'s task is hidden and the revised task has a new id', () => {
    expect(allScheduleItems.map(item => item.id)).toEqual([
      'alpha-steel-v1', 'bravo-steel-v1', 'alpha-steel-v2', 'bravo-steel-v2',
    ]);
    expect(currentScheduleItems.map(item => item.id).sort()).toEqual(['alpha-steel-v2', 'bravo-steel-v2']);
  });

  it('Home, workspace and capture intelligence keep the safety concern; Home safety summary and Daily Brief show it', () => {
    const scope = buildProjectIntelligenceAuthorityScope({ ...common(), selectedProjectName: ALPHA, currentUpdate: null });
    expect(scope.updates.map(update => update.id)).toEqual(['alpha-safety']);
    const runtime = buildRuntime({
      projectName: ALPHA, projectNames: [ALPHA], updates: scope.updates, scheduleItems: scope.scheduleItems,
      currentUpdate: null, projectAreas: scope.projectAreas, contacts: scope.contacts,
      referenceDocuments: scope.referenceDocuments, surface: 'home',
    });
    expect(runtime.intelligentSummary.safetySummary).toBe('1 safety concern should be reviewed before communication.');

    const truth = buildDAVEProjectTruth({
      projectId: 'project-alpha-hangar', projectName: ALPHA, updates: scope.updates,
      scheduleItems: scope.scheduleItems, projectAreas: scope.projectAreas,
      referenceDocuments: scope.referenceDocuments, runtime, now: new Date(NOW).toISOString(),
    });
    expect(truth.intelligence.dailyBrief.attentionItems.map(item => item.text)).toContain('Safety observation requires review.');
    expect(JSON.stringify(truth)).toContain('Guardrail missing at the north bay mezzanine edge');
  });

  it('the PM and executive daily report and the combined report keep it', () => {
    const daily = buildDailyReportAuthorityScope({ ...common(), selectedProjectName: ALPHA, selectedProjectNames: [ALPHA], currentUpdate: null });
    expect(daily.updates.map(update => update.id)).toEqual(['alpha-safety']);
    const combined = buildCombinedReportAuthorityScope({ ...common(), selectedProjectNames: [ALPHA], currentUpdate: null });
    expect(combined.updates.map(update => update.id)).toEqual(['alpha-safety']);
    const both = buildCombinedReportAuthorityScope({ ...common(), selectedProjectNames: [ALPHA, BRAVO], currentUpdate: null });
    expect(both.updates.map(update => update.id).sort()).toEqual(['alpha-safety', 'bravo-safety', 'points-at-bravo-task']);
  });

  it('an update on another project\'s task, current or hidden, stays out', () => {
    const bravo = buildDailyReportAuthorityScope({ ...common(), selectedProjectName: BRAVO, selectedProjectNames: [BRAVO], currentUpdate: null });
    expect(bravo.updates.map(update => update.id).sort()).toEqual(['bravo-safety', 'points-at-bravo-task']);
    const onCurrentBravoTask = safetyUpdate('on-current-bravo-task', { scheduleItemId: 'bravo-steel-v2' });
    const alpha = buildDailyReportAuthorityScope({
      ...common(), updates: [...updates, onCurrentBravoTask],
      selectedProjectName: ALPHA, selectedProjectNames: [ALPHA], currentUpdate: null,
    });
    expect(alpha.updates.map(update => update.id)).toEqual(['alpha-safety']);
  });

  it('the Reports screen re-scope (current tasks only) and the Home/workspace update lists keep it too', () => {
    const reportsScreen = buildDailyReportAuthorityScope({
      selectedProjectName: ALPHA, selectedProjectNames: [ALPHA], projectRecords: [{ name: ALPHA }] as never,
      updates: [alphaSafety], scheduleItems: currentScheduleItems.filter(item => item.scheduleProjectName === ALPHA),
    });
    expect(reportsScreen.updates.map(update => update.id)).toEqual(['alpha-safety']);
    expect(projectUpdatesForParentProject([alphaSafety, bravoSafety], ALPHA, currentScheduleItems).map(update => update.id))
      .toEqual(['alpha-safety']);
    expect(projectUpdateBelongsToParentProject({ update: bravoSafety, projectName: ALPHA, scheduleItems: currentScheduleItems }))
      .toBe(false);
  });
});
