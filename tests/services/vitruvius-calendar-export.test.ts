import { buildVitruviusCalendarExport } from '../../services/VitruviusCalendarExport';
import type { ScheduleItem } from '../../types';

function task(overrides: Partial<ScheduleItem> = {}): ScheduleItem {
  return {
    id: 'task-1',
    projectName: '2321 Compliance Project',
    scheduleProjectName: '2321 Compliance Project',
    locationName: 'North Lot',
    taskName: 'Place asphalt, stripe',
    startDate: '07/28/2026',
    finishDate: '07/29/2026',
    milestone: '',
    owner: 'David',
    contractor: 'Site Contractor',
    percentComplete: 25,
    priority: 'High',
    status: 'In Progress',
    notes: 'Coordinate access; confirm layout.',
    nextAction: 'Confirm paving crew',
    createdAt: '2026-07-28T08:00:00.000Z',
    ...overrides,
  };
}

describe('buildVitruviusCalendarExport', () => {
  it('exports actionable work as portable all-day calendar events', () => {
    const result = buildVitruviusCalendarExport([task()]);

    expect(result.eventCount).toBe(1);
    expect(result.content).toContain('BEGIN:VCALENDAR');
    expect(result.content).toContain('DTSTART;VALUE=DATE:20260728');
    expect(result.content).toContain('DTEND;VALUE=DATE:20260730');
    expect(result.content).toContain('SUMMARY:Place asphalt\\, stripe');
    expect(result.content).toContain('LOCATION:North Lot');
    expect(result.content).toContain('Coordinate access\\; confirm layout.');
  });

  it('excludes phase rows and undated work', () => {
    const result = buildVitruviusCalendarExport([
      task({ id: 'phase', isSummary: true }),
      task({ id: 'undated', startDate: '', finishDate: '' }),
    ]);

    expect(result.eventCount).toBe(0);
    expect(result.content).not.toContain('BEGIN:VEVENT');
  });

  it('uses a finish date when imported work has no start date', () => {
    const result = buildVitruviusCalendarExport([
      task({ startDate: '', finishDate: '2026-08-03' }),
    ]);

    expect(result.eventCount).toBe(1);
    expect(result.content).toContain('DTSTART;VALUE=DATE:20260803');
    expect(result.content).toContain('DTEND;VALUE=DATE:20260804');
  });
});
