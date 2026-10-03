import {
  projectUpdateBelongsToParentProject,
  projectUpdatesForParentProject,
} from '../../services/DAVEProjectUpdateScope';
import type { ProjectUpdate, ScheduleItem } from '../../types';

const PROJECT_A = '2375 Compliance Project';
const PROJECT_B = '2321 Compliance Project';

function scheduleItem(id: string, parent: string, area = 'Canopy A'): ScheduleItem {
  return {
    id,
    scheduleProjectName: parent,
    projectName: area,
    locationName: area,
    taskName: `Task ${id}`,
    startDate: '',
    finishDate: '',
    milestone: '',
    owner: '',
    contractor: '',
    percentComplete: 0,
    priority: 'Medium',
    status: 'Not Started',
    notes: '',
    createdAt: '2026-07-22T12:00:00.000Z',
  };
}

function update(id: string, overrides: Partial<ProjectUpdate>): ProjectUpdate {
  return {
    id,
    projectName: 'Canopy A',
    date: '2026-07-22T12:00:00.000Z',
    photos: [],
    notes: '',
    recipients: { contactIds: [] },
    ...overrides,
  };
}

describe('DAVE parent-project update scope', () => {
  const scheduleItems = [
    scheduleItem('task-a', PROJECT_A),
    scheduleItem('task-b', PROJECT_B),
  ];

  it('uses exact task identity instead of a shared area label', () => {
    const updateForB = update('update-b', {
      scheduleItemId: 'task-b',
      scheduleProjectName: PROJECT_B,
    });

    expect(projectUpdateBelongsToParentProject({
      update: updateForB,
      projectName: PROJECT_A,
      scheduleItems,
    })).toBe(false);
    expect(projectUpdateBelongsToParentProject({
      update: updateForB,
      projectName: PROJECT_B,
      scheduleItems,
    })).toBe(true);
  });

  it('uses explicit parent metadata when no task id is present', () => {
    const updateForA = update('update-a', {
      scheduleProjectName: PROJECT_A,
    });

    expect(projectUpdatesForParentProject(
      [updateForA],
      PROJECT_A,
      scheduleItems,
    )).toEqual([updateForA]);
    expect(projectUpdatesForParentProject(
      [updateForA],
      PROJECT_B,
      scheduleItems,
    )).toEqual([]);
  });

  // A10 pass 2 F1 (30 Sep 2026), pin changed deliberately: a task id in none
  // of the given tasks (a revision re-created the task under a new id and hid
  // the old row) no longer fails closed; the update's own parent decides.
  // An ambiguous id still fails closed.
  it('lets the update\'s own parent decide a missing task id; fails closed for an ambiguous one', () => {
    const missing = update('missing', {
      scheduleItemId: 'missing-task',
      scheduleProjectName: PROJECT_A,
    });
    const duplicatedSchedule = [
      scheduleItem('duplicate', PROJECT_A),
      scheduleItem('duplicate', PROJECT_B),
    ];
    const ambiguous = update('ambiguous', { scheduleItemId: 'duplicate' });

    expect(projectUpdatesForParentProject(
      [missing],
      PROJECT_A,
      scheduleItems,
    )).toEqual([missing]);
    expect(projectUpdatesForParentProject(
      [missing],
      PROJECT_B,
      scheduleItems,
    )).toEqual([]);
    expect(projectUpdatesForParentProject(
      [ambiguous],
      PROJECT_A,
      duplicatedSchedule,
    )).toEqual([]);
  });

  it('admits a legacy area-only update only when one parent owns that area', () => {
    const uniqueLegacy = update('unique', { projectName: 'Unique Area' });
    const sharedLegacy = update('shared', { projectName: 'Canopy A' });
    const uniqueSchedule = [
      scheduleItem('unique-task', PROJECT_A, 'Unique Area'),
      ...scheduleItems,
    ];

    expect(projectUpdatesForParentProject(
      [uniqueLegacy, sharedLegacy],
      PROJECT_A,
      uniqueSchedule,
    ).map(item => item.id)).toEqual(['unique']);
  });
});
