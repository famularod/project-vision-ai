import { buildDAVEProjectTruth } from '../../services/DAVEProjectTruth';
import type { ProjectUpdate, ScheduleItem } from '../../types';

function update(id: string, projectId: string): ProjectUpdate {
  return {
    id,
    projectId,
    projectName: 'Shared Project',
    date: '2026-08-10T00:00:00.000Z',
    photos: [],
    notes: `${id} evidence`,
    recipients: { contactIds: [] },
    status: 'sent',
  };
}

function task(id: string, projectId: string): ScheduleItem {
  return {
    id,
    projectId,
    scheduleProjectName: 'Shared Project',
    projectName: 'Shared Project',
    locationName: '',
    taskName: id,
    startDate: '2026-08-10',
    finishDate: '2026-08-11',
    milestone: '',
    owner: '',
    contractor: '',
    percentComplete: 0,
    priority: 'High',
    status: 'Waiting',
    notes: '',
    createdAt: '2026-08-10T00:00:00.000Z',
  };
}

describe('DAVE Project Truth immutable project identity', () => {
  it('never persists same-name sibling updates or tasks under the selected project', () => {
    const truth = buildDAVEProjectTruth({
      projectId: 'project-a',
      projectName: 'Shared Project',
      updates: [update('update-b', 'project-b'), update('update-a', 'project-a')],
      scheduleItems: [task('task-b', 'project-b'), task('task-a', 'project-a')],
      now: '2026-08-10T01:00:00.000Z',
    });
    const serializedTruth = JSON.stringify(truth);

    expect(truth.schedule.map(item => item.taskId)).toEqual(['task-a']);
    expect(truth.evidence.records.map(item => item.sourceRecordId)).toContain('update-a');
    expect(serializedTruth).not.toContain('update-b');
    expect(serializedTruth).not.toContain('task-b');
  });

  it('retains exact project evidence across a display-name rename', () => {
    const renamedUpdate = {
      ...update('renamed-update-a', 'project-a'),
      projectName: 'Former Project Name',
    };
    const renamedTask = {
      ...task('renamed-task-a', 'project-a'),
      projectName: 'Former Project Name',
      scheduleProjectName: 'Former Project Name',
    };
    const truth = buildDAVEProjectTruth({
      projectId: 'project-a',
      projectName: 'Current Project Name',
      updates: [renamedUpdate],
      scheduleItems: [renamedTask],
      now: '2026-08-10T01:00:00.000Z',
    });

    expect(truth.schedule.map(item => item.taskId)).toEqual(['renamed-task-a']);
    expect(truth.evidence.records.map(item => item.sourceRecordId)).toContain('renamed-update-a');
  });
});
