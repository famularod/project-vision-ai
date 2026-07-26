import {
  buildVitruviusGanttModel,
  parseVitruviusScheduleDate,
} from '../../services/VitruviusGanttModel';
import type { ScheduleItem } from '../../types';

describe('VitruviusGanttModel', () => {
  test('builds aligned bars, progress, and a milestone across a padded timeline', () => {
    const model = buildVitruviusGanttModel({
      items: [
        item('task-a', {
          taskName: 'Prepare subgrade',
          startDate: '2026-07-20',
          finishDate: '2026-07-22',
          percentComplete: 50,
          baselineStartDate: '2026-07-19',
          baselineFinishDate: '2026-07-21',
        }),
        item('milestone', {
          taskName: 'Ready for paving',
          startDate: '2026-07-23',
          finishDate: '2026-07-23',
          durationDays: 0,
          isMilestone: true,
        }),
      ],
      zoom: 'day',
      today: new Date('2026-07-21T12:00:00.000Z'),
    });

    const task = model.rows.find(row => row.item.id === 'task-a');
    const milestone = model.rows.find(row => row.item.id === 'milestone');
    expect(model.rangeStart).toBe('2026-07-18');
    expect(model.dayWidth).toBe(38);
    expect(task).toMatchObject({
      startDate: '2026-07-20',
      finishDate: '2026-07-22',
      left: 76,
      width: 114,
      progressWidth: 57,
      baselineLeft: 38,
      baselineWidth: 114,
      milestone: false,
    });
    expect(milestone?.milestone).toBe(true);
    expect(milestone?.width).toBeGreaterThanOrEqual(14);
    expect(model.todayLeft).toBe(133);
  });

  test('derives summary dates from children and keeps project schedules grouped', () => {
    const phase = item('phase', {
      taskName: 'Site work',
      startDate: '',
      finishDate: '',
      isSummary: true,
      wbsCode: '1',
      scheduleProjectName: '2375 Compliance Project',
    });
    const child = item('child', {
      taskName: 'Install hand rails',
      startDate: '2026-08-03',
      finishDate: '2026-08-06',
      parentItemId: phase.id,
      wbsCode: '1.1',
      scheduleProjectName: '2375 Compliance Project',
    });
    const otherProject = item('other', {
      taskName: 'Place asphalt',
      scheduleProjectName: '2321 Compliance Project',
      startDate: '2026-07-27',
      finishDate: '2026-07-28',
    });
    const model = buildVitruviusGanttModel({
      items: [child, phase, otherProject],
      zoom: 'week',
      today: new Date('2026-07-24T12:00:00.000Z'),
    });

    expect(model.rows.map(row => row.projectName)).toEqual([
      '2321 Compliance Project',
      '2375 Compliance Project',
      '2375 Compliance Project',
    ]);
    expect(model.rows.find(row => row.item.id === phase.id)).toMatchObject({
      startDate: '2026-08-03',
      finishDate: '2026-08-06',
      datesDerivedFromChildren: true,
      summary: true,
    });
    expect(model.columns[0]?.label).toMatch(/^Week of /);
  });

  test('uses progressively smaller day widths for week and month views', () => {
    const source = [item('task')];
    const day = buildVitruviusGanttModel({ items: source, zoom: 'day' });
    const week = buildVitruviusGanttModel({ items: source, zoom: 'week' });
    const month = buildVitruviusGanttModel({ items: source, zoom: 'month' });

    expect(day.dayWidth).toBeGreaterThan(week.dayWidth);
    expect(week.dayWidth).toBeGreaterThan(month.dayWidth);
    expect(month.columns[0]?.label).toMatch(/\d{4}/);
  });

  test('keeps undated work visible without inventing a bar', () => {
    const model = buildVitruviusGanttModel({
      items: [item('undated', { startDate: '', finishDate: '' })],
      zoom: 'month',
    });

    expect(model.rows[0]).toMatchObject({
      startDate: null,
      finishDate: null,
      left: null,
      width: null,
    });
  });

  test('parses supported schedule dates without timezone drift', () => {
    expect(parseVitruviusScheduleDate('July 24, 2026')?.toISOString()).toBe(
      '2026-07-24T00:00:00.000Z',
    );
    expect(parseVitruviusScheduleDate('7/24/26')?.toISOString()).toBe(
      '2026-07-24T00:00:00.000Z',
    );
    expect(parseVitruviusScheduleDate('2026-02-30')).toBeNull();
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
    startDate: '2026-07-20',
    finishDate: '2026-07-21',
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
