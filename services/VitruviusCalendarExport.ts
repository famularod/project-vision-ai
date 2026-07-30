import type { ScheduleItem } from '../types';
import { parseVitruviusScheduleDate } from './VitruviusGanttModel';

export type VitruviusCalendarExport = Readonly<{
  content: string;
  eventCount: number;
}>;

/**
 * Builds a portable iCalendar file from actionable schedule rows.
 *
 * Summary/phase rows are intentionally excluded because their child tasks
 * already describe the work. A finish-only item is exported on its finish
 * date so imported lookaheads without start dates remain useful.
 */
export function buildVitruviusCalendarExport(
  items: readonly ScheduleItem[],
): VitruviusCalendarExport {
  const events = items.flatMap(item => {
    if (item.isSummary) return [];
    const start = parseVitruviusScheduleDate(item.startDate)
      || parseVitruviusScheduleDate(item.finishDate);
    const finish = parseVitruviusScheduleDate(item.finishDate) || start;
    if (!start || !finish) return [];
    const eventFinish = finish.getTime() < start.getTime() ? start : finish;
    const description = [
      item.scheduleProjectName?.trim() || item.projectName.trim(),
      item.locationName.trim(),
      item.owner.trim() ? `Owner: ${item.owner.trim()}` : '',
      item.contractor.trim() ? `Company: ${item.contractor.trim()}` : '',
      item.status ? `Status: ${item.status} (${item.percentComplete}%)` : '',
      item.nextAction?.trim() ? `Next action: ${item.nextAction.trim()}` : '',
      item.notes.trim(),
    ].filter(Boolean).join('\n');
    return [[
      'BEGIN:VEVENT',
      `UID:${escapeCalendarText(`vitruvius-${item.id}`)}`,
      `DTSTAMP:${formatUtcTimestamp(new Date())}`,
      `DTSTART;VALUE=DATE:${formatCalendarDate(start)}`,
      `DTEND;VALUE=DATE:${formatCalendarDate(addUtcDays(eventFinish, 1))}`,
      `SUMMARY:${escapeCalendarText(item.taskName.trim() || 'Vitruvius schedule item')}`,
      `LOCATION:${escapeCalendarText(item.locationName.trim())}`,
      `DESCRIPTION:${escapeCalendarText(description)}`,
      item.isMilestone ? 'CATEGORIES:Milestone' : `CATEGORIES:${escapeCalendarText(item.itemType || 'Task')}`,
      'END:VEVENT',
    ].join('\r\n')];
  });

  return Object.freeze({
    content: [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Vitruvius Project Intelligence//Schedule//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:Vitruvius Schedule',
      ...events,
      'END:VCALENDAR',
      '',
    ].join('\r\n'),
    eventCount: events.length,
  });
}

function escapeCalendarText(value: string) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function formatCalendarDate(date: Date) {
  return [
    date.getUTCFullYear().toString().padStart(4, '0'),
    (date.getUTCMonth() + 1).toString().padStart(2, '0'),
    date.getUTCDate().toString().padStart(2, '0'),
  ].join('');
}

function formatUtcTimestamp(date: Date) {
  return `${formatCalendarDate(date)}T${[
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
  ].map(value => value.toString().padStart(2, '0')).join('')}Z`;
}

function addUtcDays(date: Date, days: number) {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}
