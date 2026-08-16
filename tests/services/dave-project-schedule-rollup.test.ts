import { scheduleTasksForParentProject } from '../../services/dave-project-schedule-rollup';
import type { ScheduleItem } from '../../types';

function task(id: string, projectId: string | null): ScheduleItem {
  return {
    id,
    projectId,
    scheduleProjectName: 'Shared Project',
    projectName: 'Shared Project',
    locationName: '',
    taskName: id,
    startDate: '',
    finishDate: '',
    milestone: '',
    owner: '',
    contractor: '',
    percentComplete: 0,
    priority: 'Medium',
    status: 'Not Started',
    notes: '',
    createdAt: '2026-08-10T00:00:00.000Z',
  };
}

describe('DAVE project schedule immutable scope', () => {
  it('selects only the exact project regardless of same-name array order', () => {
    const projectA = task('task-a', 'project-a');
    const projectB = task('task-b', 'project-b');
    const legacy = task('task-legacy', null);

    expect(scheduleTasksForParentProject(
      'Shared Project',
      [projectB, legacy, projectA],
      'project-a',
    )).toEqual([projectA]);
    expect(scheduleTasksForParentProject(
      'Shared Project',
      [projectA, legacy, projectB],
      'project-b',
    )).toEqual([projectB]);
  });

  it('retains name-only portfolio compatibility when no exact project is selected', () => {
    const legacy = task('task-legacy', null);

    expect(scheduleTasksForParentProject('Shared Project', [legacy])).toEqual([legacy]);
  });

  it('retains an exact task after a project rename', () => {
    const renamed = {
      ...task('task-a', 'project-a'),
      projectName: 'Former Name',
      scheduleProjectName: 'Former Name',
    };

    expect(scheduleTasksForParentProject('Current Name', [renamed], 'project-a')).toEqual([renamed]);
  });
});
