import {
  groupScheduleWorkspaceItemsByProject,
  groupScheduleWorkspaceItemsByProjectAndArea,
  resolveScheduleWorkspaceTask,
  scheduleItemsForWorkspaceProject,
  scheduleWorkspaceProjectOptions,
} from '../../services/DAVEScheduleWorkspace';
import type { ScheduleItem } from '../../types';

const baseItem: ScheduleItem = {
  id: 'task-a',
  projectName: 'Project A',
  locationName: 'Canopy A',
  taskName: 'Install panels',
  startDate: '',
  finishDate: '07/30/2026',
  milestone: '',
  owner: '',
  contractor: '',
  percentComplete: 0,
  priority: 'Medium',
  status: 'Not Started',
  notes: '',
  createdAt: '2026-07-19T12:00:00.000Z',
};

describe('DAVE schedule workspace', () => {
  it('scopes tasks by their authoritative schedule project name', () => {
    const tasks = [
      baseItem,
      {
        ...baseItem,
        id: 'task-b',
        projectName: 'Imported schedule title',
        scheduleProjectName: 'Project B',
      },
    ];

    expect(scheduleItemsForWorkspaceProject(tasks, 'project b')).toEqual([
      tasks[1],
    ]);
    expect(scheduleItemsForWorkspaceProject(tasks, null)).toEqual(tasks);
  });

  it('builds stable project choices from projects and task truth', () => {
    const choices = scheduleWorkspaceProjectOptions(
      ['Project B', 'Project A', ' project a '],
      [{ ...baseItem, projectName: 'Project C' }],
    );

    expect(choices).toEqual(['Project A', 'Project B', 'Project C']);
  });

  it('preserves a valid task selection and falls back safely after filtering', () => {
    const tasks = [
      baseItem,
      { ...baseItem, id: 'task-b', taskName: 'Install rails' },
    ];

    expect(resolveScheduleWorkspaceTask(tasks, 'task-b')?.id).toBe('task-b');
    expect(resolveScheduleWorkspaceTask(tasks, 'missing')?.id).toBe('task-a');
    expect(resolveScheduleWorkspaceTask([], 'task-b')).toBeNull();
  });

  it('groups the All Projects task list under stable project headings', () => {
    const tasks = [
      { ...baseItem, id: 'task-b', projectName: 'Project B' },
      { ...baseItem, id: 'task-a2', projectName: 'Project A', taskName: 'Install rails' },
      { ...baseItem, id: 'task-a1', projectName: 'Project A' },
    ];

    expect(groupScheduleWorkspaceItemsByProject(tasks)).toEqual([
      {
        projectName: 'Project A',
        data: [tasks[1], tasks[2]],
      },
      {
        projectName: 'Project B',
        data: [tasks[0]],
      },
    ]);
  });

  it('groups open and completed views consistently by project and area', () => {
    const tasks = [
      { ...baseItem, id: 'task-b2', projectName: 'Project B', locationName: '' },
      { ...baseItem, id: 'task-a2', projectName: 'Project A', locationName: 'Canopy C' },
      { ...baseItem, id: 'task-a1', projectName: 'Project A', locationName: 'Canopy A' },
      { ...baseItem, id: 'task-b1', projectName: 'Project B', locationName: 'North Lot' },
    ];

    expect(groupScheduleWorkspaceItemsByProjectAndArea(tasks)).toEqual([
      {
        projectName: 'Project A',
        areaName: 'Canopy A',
        projectTaskCount: 2,
        isFirstAreaInProject: true,
        data: [tasks[2]],
      },
      {
        projectName: 'Project A',
        areaName: 'Canopy C',
        projectTaskCount: 2,
        isFirstAreaInProject: false,
        data: [tasks[1]],
      },
      {
        projectName: 'Project B',
        areaName: 'North Lot',
        projectTaskCount: 2,
        isFirstAreaInProject: true,
        data: [tasks[3]],
      },
      {
        projectName: 'Project B',
        areaName: 'No Area Assigned',
        projectTaskCount: 2,
        isFirstAreaInProject: false,
        data: [tasks[0]],
      },
    ]);
  });
});
