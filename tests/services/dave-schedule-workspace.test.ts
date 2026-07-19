import {
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
});
