import {
  buildVitruviusLookahead,
  vitruviusLookaheadCsv,
} from '../../services/VitruviusLookahead';
import type { ScheduleItem } from '../../types';

describe('VitruviusLookahead', () => {
  test('includes overdue, overlapping, and undated open work while excluding later and complete work', () => {
    const lookahead = buildVitruviusLookahead({
      items: [
        item('overdue', {
          taskName: 'Overdue paving',
          finishDate: '2026-07-23',
        }),
        item('active', {
          taskName: 'Install panels',
          startDate: '2026-07-27',
          finishDate: '2026-08-03',
          status: 'In Progress',
          percentComplete: 30,
        }),
        item('undated', {
          taskName: 'Assign layout review',
          startDate: '',
          finishDate: '',
        }),
        item('later', {
          taskName: 'Later work',
          startDate: '2026-09-01',
          finishDate: '2026-09-04',
        }),
        item('complete', {
          taskName: 'Complete work',
          status: 'Complete',
          percentComplete: 100,
        }),
      ],
      weeks: 3,
      today: new Date('2026-07-24T12:00:00.000Z'),
    });

    expect(lookahead.rangeStart).toBe('2026-07-24');
    expect(lookahead.rangeFinish).toBe('2026-08-13');
    expect(lookahead.rows.map(row => row.item.id)).toEqual([
      'overdue',
      'active',
      'undated',
    ]);
    expect(lookahead.overdueCount).toBe(1);
    expect(lookahead.undatedCount).toBe(1);
  });

  test('shows unresolved predecessor work as a blocker', () => {
    const lookahead = buildVitruviusLookahead({
      items: [
        item('predecessor', {
          taskName: 'Finish rough-in',
          startDate: '2026-07-24',
          finishDate: '2026-07-28',
        }),
        item('successor', {
          taskName: 'Close walls',
          startDate: '2026-07-29',
          finishDate: '2026-07-31',
          dependencies: [{ predecessorItemId: 'predecessor', type: 'FS' }],
        }),
      ],
      weeks: 3,
      today: new Date('2026-07-24T12:00:00.000Z'),
    });

    expect(lookahead.rows.find(row => row.item.id === 'successor')).toMatchObject({
      status: 'blocked',
      blockingPredecessorIds: ['predecessor'],
      blockingPredecessorNames: ['Finish rough-in'],
    });
    expect(lookahead.blockedCount).toBe(1);
  });

  test('exports PM-facing lookahead rows as escaped CSV', () => {
    const lookahead = buildVitruviusLookahead({
      items: [item('quoted', {
        taskName: 'Install "north" panels',
        contractor: 'ACME, Inc.',
      })],
      weeks: 6,
      today: new Date('2026-07-20T12:00:00.000Z'),
    });
    const csv = vitruviusLookaheadCsv(lookahead);

    expect(csv).toContain('"Project","Area","WBS","Task"');
    expect(csv).toContain('"Install ""north"" panels"');
    expect(csv).toContain('"ACME, Inc."');
  });
});

function item(
  id: string,
  overrides: Partial<ScheduleItem> = {},
): ScheduleItem {
  return {
    id,
    scheduleProjectName: '2321 Compliance Project',
    projectName: '2321 Compliance Project',
    projectTimeZone: 'America/Los_Angeles',
    locationName: 'North Lot',
    taskName: id,
    startDate: '2026-07-24',
    finishDate: '2026-07-25',
    milestone: '',
    owner: 'Project manager',
    contractor: '',
    durationDays: 2,
    percentComplete: 0,
    progressSource: 'project_manager',
    progressConfirmedAt: '2026-07-24T12:00:00.000Z',
    progressConfirmedBy: 'PM',
    priority: 'Medium',
    status: 'Not Started',
    notes: '',
    nextAction: '',
    activity: [],
    createdAt: '2026-07-24T12:00:00.000Z',
    updatedAt: '2026-07-24T12:00:00.000Z',
    ...overrides,
  };
}
