import {
  projectUpdateBelongsToParentProject,
  projectUpdatesForParentProject,
} from '../../services/DAVEProjectUpdateScope';
import type { ProjectUpdate, ScheduleItem } from '../../types';

const PROJECT_A = '2375 Compliance Project';
const PROJECT_B = '2321 Compliance Project';

function scheduleItem(
  id: string,
  parent: string,
  area = 'Canopy A',
  projectId: string | null = null,
): ScheduleItem {
  return {
    id,
    projectId,
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

  it('fails closed for missing or ambiguous task ids', () => {
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

  it('rejects an explicit same-name sibling project id before every name fallback', () => {
    const sharedName = 'Shared Project';
    const exactSchedule = [
      scheduleItem('task-a', sharedName, 'Area A', 'project-a'),
      scheduleItem('task-b', sharedName, 'Area B', 'project-b'),
    ];
    const updateForB = update('update-b', {
      projectId: 'project-b',
      projectName: sharedName,
      scheduleProjectName: sharedName,
      scheduleItemId: 'task-b',
    });

    expect(projectUpdateBelongsToParentProject({
      update: updateForB,
      projectName: sharedName,
      selectedProjectId: 'project-a',
      scheduleItems: exactSchedule,
    })).toBe(false);
    expect(projectUpdateBelongsToParentProject({
      update: updateForB,
      projectName: sharedName,
      selectedProjectId: 'project-b',
      scheduleItems: exactSchedule,
    })).toBe(true);
  });

  it('admits a legacy update in exact scope only through one exact task binding', () => {
    const sharedName = 'Shared Project';
    const exactSchedule = [
      scheduleItem('task-a', sharedName, 'Area A', 'project-a'),
      scheduleItem('task-b', sharedName, 'Area B', 'project-b'),
    ];
    const taskLinkedLegacyUpdate = update('legacy-task-update', {
      projectId: null,
      projectName: sharedName,
      scheduleItemId: 'task-a',
    });
    const nameOnlyLegacyUpdate = update('legacy-name-update', {
      projectId: null,
      projectName: sharedName,
    });

    expect(projectUpdatesForParentProject(
      [taskLinkedLegacyUpdate, nameOnlyLegacyUpdate],
      sharedName,
      exactSchedule,
      'project-a',
    )).toEqual([taskLinkedLegacyUpdate]);
  });

  it('retains an exact update after a project rename', () => {
    const renamed = update('renamed-update', {
      projectId: 'project-a',
      projectName: 'Former Name',
    });

    expect(projectUpdatesForParentProject(
      [renamed],
      'Current Name',
      [],
      'project-a',
    )).toEqual([renamed]);
  });
});
