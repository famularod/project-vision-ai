/**
 * Audit round 2, A10 pass 2, finding 4 (30 Sep 2026): starting an update from
 * a task on an older schedule sets the draft's project to the task's building
 * ("Building 2321") with the parent in scheduleProjectName. Capture scoped
 * its intelligence by the building, so it held no evidence at all (the Add
 * Photos "same photo as last time" guidance vanished) and an empty Project
 * Truth was saved under a made-up project id.
 *
 * Now capture is scoped by the draft's parent project, and Project Truth is
 * saved only for a project the owner has.
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
import {
  buildProjectIntelligenceAuthorityScope,
  captureIntelligenceProjectName,
  projectTruthPersistencePolicyFor,
} from '../../services/ReportAuthorityScope';
import type { ProjectUpdate, ScheduleItem } from '../../types';

const PARENT = '2321 Compliance Project';
const BUILDING = 'Building 2321';
const NOW = Date.parse('2026-09-30T15:00:00.000Z');
const DAY = 86_400_000;
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// An older schedule: the task names the building as its project.
const task = {
  id: 'task-canopy', projectName: BUILDING, scheduleProjectName: PARENT, locationName: 'Canopy A',
  taskName: 'Canopy steel erection', startDate: day(NOW - 10 * DAY), finishDate: day(NOW + 5 * DAY), milestone: '',
  owner: 'David', contractor: '', percentComplete: 30, priority: 'High', status: 'In Progress', notes: '',
  importedFrom: 'schedule.pdf', importedAt: '2026-09-01T08:00:00.000Z',
} as ScheduleItem;

function fromTask(id: string, notes: string, date: string): ProjectUpdate {
  // As createNewUpdateForScheduleTask builds it (App.tsx).
  return {
    id, projectName: BUILDING, scheduleProjectName: PARENT, scheduleItemId: task.id, scheduleTaskName: task.taskName,
    date, notes, recipients: { contactIds: [] }, status: id === 'draft' ? 'draft' : 'sent', selectedAreaName: 'Canopy A',
    photos: id === 'draft' ? [] : [{
      id: `${id}-photo`, uri: `file:///p/${id}.jpg`, caption: '', category: 'Update', actionRequired: '',
      actionOwner: '', actionDueDate: '', actionStatus: 'Closed', selectedAreaName: 'Canopy A',
      locationCapturedAt: new Date(NOW - 3 * DAY).toISOString(),
    }],
  } as unknown as ProjectUpdate;
}

const saved = [fromTask('earlier', 'Canopy columns set.', day(NOW - 3 * DAY))];
const draft = fromTask('draft', 'Canopy beams going up.', day(NOW));
const NONE: never[] = [];

function captureScope(selectedProjectName: string) {
  return buildProjectIntelligenceAuthorityScope({
    selectedProjectName,
    projectRecords: [{ name: PARENT }, { name: '2375 Compliance Project' }] as never,
    updates: saved,
    scheduleItems: [task],
    currentUpdate: draft,
    projectAreas: NONE,
    referenceDocuments: NONE,
    projectDocuments: NONE,
    captureMemories: NONE,
    contacts: { contacts: [] },
  });
}

describe('A10 pass 2 finding 4: capture from an older task is scoped by its parent project', () => {
  beforeEach(() => jest.useFakeTimers({ now: NOW }));
  afterEach(() => jest.useRealTimers());

  it('reproduces: scoped by the draft\'s building, capture holds nothing', () => {
    const byBuilding = captureScope(draft.projectName);
    expect(byBuilding.updates).toEqual([]);
    expect(byBuilding.scheduleItems).toEqual([]);
    expect(byBuilding.currentUpdate).toBeNull();
  });

  it('scoped by the parent, capture has the task, its earlier update and the draft', () => {
    expect(captureIntelligenceProjectName(draft)).toBe(PARENT);
    expect(captureIntelligenceProjectName({ projectName: 'Alpha Hangar', scheduleProjectName: '  ' })).toBe('Alpha Hangar');
    const scope = captureScope(captureIntelligenceProjectName(draft));
    expect(scope.updates.map(update => update.id)).toEqual(['earlier']);
    expect(scope.scheduleItems.map(item => item.id)).toEqual(['task-canopy']);
    expect(scope.currentUpdate?.id).toBe('draft');
    const runtime = buildRuntime({
      projectName: PARENT, projectNames: [PARENT], updates: scope.updates, scheduleItems: scope.scheduleItems,
      currentUpdate: scope.currentUpdate, projectAreas: scope.projectAreas, contacts: scope.contacts,
      referenceDocuments: scope.referenceDocuments, surface: 'capture',
    });
    expect(JSON.stringify(runtime)).toContain('Canopy columns set.');
  });

  it('Project Truth is saved only for a project the owner has', () => {
    const projects = [PARENT, '2375 Compliance Project'];
    expect(projectTruthPersistencePolicyFor(BUILDING, projects)).toBe('no_project_truth');
    expect(projectTruthPersistencePolicyFor('Current Project', projects)).toBe('no_project_truth');
    expect(projectTruthPersistencePolicyFor(PARENT, projects)).toBe('persist_project');
    expect(projectTruthPersistencePolicyFor(' 2321 compliance project ', projects)).toBe('persist_project');
  });
});
