import {
  parseInstant,
  parsePlainDate,
  plainDateAtInstant,
  plainDateDueState,
  plainDateEndOfDayInstant,
  plainDateRelativeDays,
  projectCalendarDate,
  projectTimeZoneOrDefault,
} from '../../services/ProjectDateTime';
import { buildProjectCommitments } from '../../services/DAVEProjectCommitments';
import { buildDAVEProjectScheduleRollup } from '../../services/dave-project-schedule-rollup';
import { buildDAVEProjectTruth } from '../../services/DAVEProjectTruth';
import type { ScheduleItem } from '../../types';

describe('project PlainDate and Instant semantics', () => {
  it('keeps calendar dates distinct from absolute timestamps', () => {
    expect(parsePlainDate('2026-07-17')).toBe('2026-07-17');
    expect(parsePlainDate('07/17/2026')).toBe('2026-07-17');
    expect(parsePlainDate('2026-07-17T00:00:00Z')).toBeNull();
    expect(parseInstant('2026-07-17')).toBeNull();
    expect(parseInstant('2026-07-17T00:00:00Z')).toBe('2026-07-17T00:00:00.000Z');
    expect(projectCalendarDate('2026-07-17T23:00:00-07:00', 'America/Los_Angeles')).toBe('2026-07-17');
  });

  it('keeps a due-today item open through project-local end of day', () => {
    const zone = projectTimeZoneOrDefault('America/Los_Angeles');
    expect(plainDateDueState('2026-07-17', '2026-07-18T00:30:00.000Z', zone)).toBe('due_today');
    expect(plainDateDueState('2026-07-17', '2026-07-18T06:59:59.999Z', zone)).toBe('due_today');
    expect(plainDateEndOfDayInstant('2026-07-17', zone)).toBe('2026-07-18T06:59:59.999Z');
    expect(plainDateDueState('2026-07-17', '2026-07-18T07:00:00.000Z', zone)).toBe('overdue');
  });

  it('uses calendar days across 23-hour and 25-hour DST dates', () => {
    const zone = projectTimeZoneOrDefault('America/Los_Angeles');
    expect(plainDateEndOfDayInstant('2026-03-08', zone)).toBe('2026-03-09T06:59:59.999Z');
    expect(plainDateRelativeDays('2026-03-09', '2026-03-08T08:00:00.000Z', zone)).toBe(1);
    expect(plainDateEndOfDayInstant('2026-11-01', zone)).toBe('2026-11-02T07:59:59.999Z');
    expect(plainDateRelativeDays('2026-11-02', '2026-11-01T07:00:00.000Z', zone)).toBe(1);
  });

  it('uses the project timezone in zones west and east of UTC', () => {
    const instant = '2026-07-17T02:00:00.000Z';
    expect(plainDateAtInstant(instant, 'America/Los_Angeles')).toBe('2026-07-16');
    expect(plainDateAtInstant(instant, 'Asia/Tokyo')).toBe('2026-07-17');
    expect(plainDateDueState('2026-07-16', instant, 'America/Los_Angeles')).toBe('due_today');
    expect(plainDateDueState('2026-07-16', instant, 'Asia/Tokyo')).toBe('overdue');
    expect(plainDateDueState('2026-07-17', instant, 'America/Los_Angeles')).toBe('upcoming');
    expect(plainDateDueState('2026-07-17', instant, 'Asia/Tokyo')).toBe('due_today');
  });

  it('fails closed on invalid dates, instants, and timezones', () => {
    expect(parsePlainDate('2026-02-30')).toBeNull();
    expect(plainDateDueState('2026-02-30', new Date(), 'America/Los_Angeles')).toBe('invalid');
    expect(plainDateAtInstant('2026-07-17', 'America/Los_Angeles')).toBeNull();
    expect(plainDateAtInstant(new Date(), 'Not/A_TimeZone')).toBeNull();
  });

  it('keeps field commitments open until project-local end of day', () => {
    const input = {
      projectId: 'project-1',
      projectName: 'Project 1',
      now: '2026-07-18T06:30:00.000Z',
      updates: [{
        id: 'update-1',
        projectName: 'Project 1',
        photos: [{
          id: 'photo-1',
          category: 'Open Issue',
          actionRequired: 'Confirm inspection',
          actionDueDate: '2026-07-17',
          actionStatus: 'Open',
        }],
      }],
    };
    expect(buildProjectCommitments({
      ...input,
      projectTimeZone: 'America/Los_Angeles',
    })[0].status).toBe('Open');
    expect(buildProjectCommitments({
      ...input,
      projectTimeZone: 'Asia/Tokyo',
    })[0].status).toBe('Overdue');
  });

  it('uses each schedule item project timezone for overdue rollups', () => {
    const item: ScheduleItem = {
      id: 'schedule-1',
      projectName: 'Project 1',
      locationName: 'Area 1',
      taskName: 'Confirm inspection',
      startDate: '2026-07-16',
      finishDate: '2026-07-17',
      milestone: '',
      owner: '',
      contractor: '',
      percentComplete: 50,
      priority: 'Medium',
      status: 'In Progress',
      notes: '',
      createdAt: '2026-07-16T12:00:00.000Z',
    };
    const now = new Date('2026-07-18T06:30:00.000Z');
    expect(buildDAVEProjectScheduleRollup({
      projectName: 'Project 1',
      items: [{ ...item, projectTimeZone: 'America/Los_Angeles' }],
      now,
    })).toMatchObject({ overdueCount: 0, dueSoonCount: 1 });
    expect(buildDAVEProjectScheduleRollup({
      projectName: 'Project 1',
      items: [{ ...item, projectTimeZone: 'Asia/Tokyo' }],
      now,
    })).toMatchObject({ overdueCount: 1, dueSoonCount: 0 });
  });

  it('propagates project timezone through Truth and Reasoning authority', () => {
    const scheduleItem: ScheduleItem = {
      id: 'schedule-truth-1',
      scheduleProjectName: 'Project 1',
      projectName: 'Project 1',
      locationName: 'Area 1',
      taskName: 'Confirm inspection',
      startDate: '2026-07-16',
      finishDate: '2026-07-17',
      milestone: '',
      owner: 'Project manager',
      contractor: '',
      percentComplete: 50,
      priority: 'Medium',
      status: 'In Progress',
      notes: '',
      createdAt: '2026-07-16T12:00:00.000Z',
    };
    const input = {
      projectId: 'project-1',
      projectName: 'Project 1',
      updates: [],
      scheduleItems: [scheduleItem],
      now: '2026-07-18T06:30:00.000Z',
    };
    const west = buildDAVEProjectTruth({
      ...input,
      projectTimeZone: 'America/Los_Angeles',
    });
    const east = buildDAVEProjectTruth({ ...input, projectTimeZone: 'Asia/Tokyo' });
    expect(west.schedule[0].urgency).toBe('due_soon');
    expect(east.schedule[0].urgency).toBe('overdue');
    expect(west.reasoning.decisions[0].recommendation.consequenceOfInaction)
      .toMatch(/unsupported task status/i);
    expect(east.reasoning.decisions[0].recommendation.consequenceOfInaction)
      .toMatch(/overdue or incorrect/i);
  });
});
