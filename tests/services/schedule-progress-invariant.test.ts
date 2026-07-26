import {
  normalizeScheduleStatus,
  reconcileScheduleProgress,
  reconcileScheduleProgressEdit,
  scheduleProgressIsComplete,
} from '../../services/ScheduleProgressInvariant';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { scheduleTaskIsComplete } from '../../services/dave-project-schedule-rollup';
import { buildDAVEEvidenceCorrelations } from '../../services/DAVEEvidenceCorrelation';

describe('schedule progress invariant', () => {
  it.each([
    'Incomplete',
    'Not complete',
    'Not completed',
    'Not done',
    'Unfinished',
  ])('never parses %s as Complete', value => {
    expect(normalizeScheduleStatus(value)).not.toBe('Complete');
    expect(reconcileScheduleProgress(value, 50)).toEqual({
      status: 'In Progress',
      percentComplete: 50,
    });
  });

  it.each([
    'The work will be complete tomorrow',
    'The work might be complete',
    'The work should be complete if inspection passes',
  ])('does not promote future, uncertain, or conditional text: %s', value => {
    expect(normalizeScheduleStatus(value)).toBe('In Progress');
    expect(reconcileScheduleProgress(value, 70)).toEqual({
      status: 'In Progress',
      percentComplete: 70,
    });
  });

  it('makes Complete and 100 percent mutually consistent', () => {
    expect(reconcileScheduleProgress('Complete', 42)).toEqual({
      status: 'Complete',
      percentComplete: 100,
    });
    expect(reconcileScheduleProgress('In Progress', 100)).toEqual({
      status: 'Complete',
      percentComplete: 100,
    });
    expect(scheduleProgressIsComplete({ status: 'Complete', percentComplete: 100 })).toBe(true);
    expect(scheduleProgressIsComplete({ status: 'Complete', percentComplete: 99 })).toBe(false);
    expect(scheduleProgressIsComplete({ status: 'In Progress', percentComplete: 100 })).toBe(false);
  });

  it('moves positive progress out of Not Started and clamps unsafe values', () => {
    expect(reconcileScheduleProgress('Not Started', 25)).toEqual({
      status: 'In Progress',
      percentComplete: 25,
    });
    expect(reconcileScheduleProgress('Waiting', -20)).toEqual({
      status: 'Waiting',
      percentComplete: 0,
    });
  });

  it('allows either progress control to reopen a completed task', () => {
    expect(reconcileScheduleProgressEdit(
      { status: 'Complete', percentComplete: 100 },
      { status: 'In Progress' },
    )).toEqual({ status: 'In Progress', percentComplete: 99 });
    expect(reconcileScheduleProgressEdit(
      { status: 'Complete', percentComplete: 100 },
      { percentComplete: 50 },
    )).toEqual({ status: 'In Progress', percentComplete: 50 });
    expect(reconcileScheduleProgressEdit(
      { status: 'Complete', percentComplete: 100 },
      { status: 'Not Started' },
    )).toEqual({ status: 'Not Started', percentComplete: 0 });
  });

  it('applies exact status semantics to imported CSV rows', () => {
    const result = normalizeScheduleImport({
      contents: [
        'Task,Project,Area,Start,Finish,Milestone,Owner,Status,Notes,Contractor,WBS,Percent Complete',
        'Task A,Project A,Area A,07/18/2026,07/24/2026,,,Not complete,,,,80',
        'Task B,Project A,Area A,07/18/2026,07/24/2026,,,Not done,,,,25',
        'Task C,Project A,Area A,07/18/2026,07/24/2026,,,Complete,,,,10',
      ].join('\n'),
      sourceName: 'status.csv',
      mimeType: 'text/csv',
      now: new Date('2026-07-18T12:00:00-07:00'),
    });

    expect(result.items.map(item => [item.status, item.percentComplete])).toEqual([
      ['In Progress', 80],
      ['In Progress', 25],
      ['Complete', 100],
    ]);
  });

  it('fails closed on unnormalized contradictory completion records', () => {
    const base = {
      id: 'task-1',
      projectName: 'Project A',
      locationName: 'Area A',
      taskName: 'Task A',
      startDate: '',
      finishDate: '',
      milestone: '',
      owner: '',
      contractor: '',
      priority: 'Medium' as const,
      notes: '',
      createdAt: '2026-07-18T12:00:00Z',
    };

    expect(scheduleTaskIsComplete({
      ...base,
      status: 'Complete',
      percentComplete: 99,
    })).toBe(false);
    expect(scheduleTaskIsComplete({
      ...base,
      status: 'In Progress',
      percentComplete: 100,
    })).toBe(false);
    const correlation = buildDAVEEvidenceCorrelations({
      scheduleItems: [{
        ...base,
        status: 'In Progress',
        percentComplete: 100,
      }],
    });
    expect(correlation.tasks[0].evidence[0].stance).toBe('in_progress');
    expect(correlation.tasks[0].conclusion).not.toBe('verified_complete');
  });
});
