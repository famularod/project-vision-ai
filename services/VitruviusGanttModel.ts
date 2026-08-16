import type { ScheduleItem } from '../types';
import { buildVitruviusScheduleHierarchy } from './VitruviusScheduleWorkspace';

export type VitruviusGanttZoom = 'day' | 'week' | 'month';

export type VitruviusGanttColumn = Readonly<{
  key: string;
  label: string;
  startDate: string;
  endDate: string;
  left: number;
  width: number;
}>;

export type VitruviusGanttRow = Readonly<{
  item: ScheduleItem;
  projectName: string;
  depth: number;
  childCount: number;
  startDate: string | null;
  finishDate: string | null;
  left: number | null;
  width: number | null;
  progressWidth: number | null;
  baselineLeft: number | null;
  baselineWidth: number | null;
  milestone: boolean;
  summary: boolean;
  datesDerivedFromChildren: boolean;
}>;

export type VitruviusGanttModel = Readonly<{
  zoom: VitruviusGanttZoom;
  rangeStart: string;
  rangeFinish: string;
  timelineWidth: number;
  dayWidth: number;
  todayLeft: number | null;
  columns: readonly VitruviusGanttColumn[];
  rows: readonly VitruviusGanttRow[];
}>;

export function buildVitruviusGanttModel({
  items,
  zoom,
  today = new Date(),
}: {
  items: readonly ScheduleItem[];
  zoom: VitruviusGanttZoom;
  today?: Date;
}): VitruviusGanttModel {
  const hierarchyRows = projectScheduleRows(items);
  const datesById = derivedScheduleDates(items);
  const realDates = [...datesById.values()]
    .flatMap(range => [range.start, range.finish])
    .filter((value): value is Date => Boolean(value));
  const todayDate = startOfUtcDay(today);
  const earliest = realDates.length > 0
    ? new Date(Math.min(...realDates.map(date => date.getTime())))
    : todayDate;
  const latest = realDates.length > 0
    ? new Date(Math.max(...realDates.map(date => date.getTime())))
    : addUtcDays(todayDate, 28);
  const rangeStartDate = startOfZoomRange(addUtcDays(earliest, -2), zoom);
  const rangeFinishDate = endOfZoomRange(addUtcDays(latest, 2), zoom);
  const totalDays = Math.max(1, calendarDayDifference(rangeStartDate, rangeFinishDate) + 1);
  const dayWidth = ganttDayWidth(zoom);
  const timelineWidth = totalDays * dayWidth;
  const rows = hierarchyRows.map(row => {
    const dates = datesById.get(row.item.id);
    const start = dates?.start || null;
    const finish = dates?.finish || null;
    const left = start
      ? calendarDayDifference(rangeStartDate, start) * dayWidth
      : null;
    const spanDays = start && finish
      ? Math.max(1, calendarDayDifference(start, finish) + 1)
      : null;
    const width = row.item.isMilestone && start
      ? Math.max(14, dayWidth * 0.7)
      : spanDays
        ? Math.max(dayWidth, spanDays * dayWidth)
        : null;
    const baselineStart = parseVitruviusScheduleDate(row.item.baselineStartDate);
    const baselineFinish = parseVitruviusScheduleDate(row.item.baselineFinishDate);
    const baselineLeft = baselineStart
      ? calendarDayDifference(rangeStartDate, baselineStart) * dayWidth
      : null;
    const baselineSpanDays = baselineStart && baselineFinish
      ? Math.max(1, calendarDayDifference(baselineStart, baselineFinish) + 1)
      : null;
    return Object.freeze({
      item: row.item,
      projectName: row.projectName,
      depth: row.depth,
      childCount: row.childCount,
      startDate: start ? formatIsoDate(start) : null,
      finishDate: finish ? formatIsoDate(finish) : null,
      left,
      width,
      progressWidth: width === null
        ? null
        : Math.max(0, Math.min(width, width * (row.item.percentComplete / 100))),
      baselineLeft,
      baselineWidth: baselineSpanDays
        ? Math.max(dayWidth, baselineSpanDays * dayWidth)
        : null,
      milestone: row.item.isMilestone === true,
      summary: row.item.isSummary === true || row.childCount > 0,
      datesDerivedFromChildren: Boolean(dates?.derived),
    });
  });
  const todayOffset = calendarDayDifference(rangeStartDate, todayDate);
  return Object.freeze({
    zoom,
    rangeStart: formatIsoDate(rangeStartDate),
    rangeFinish: formatIsoDate(rangeFinishDate),
    timelineWidth,
    dayWidth,
    todayLeft: todayOffset >= 0 && todayOffset < totalDays
      ? todayOffset * dayWidth + dayWidth / 2
      : null,
    columns: Object.freeze(
      buildColumns(rangeStartDate, rangeFinishDate, zoom, dayWidth),
    ),
    rows: Object.freeze(rows),
  });
}

function projectScheduleRows(items: readonly ScheduleItem[]) {
  const groups = new Map<string, ScheduleItem[]>();
  items.forEach(item => {
    const projectName = item.scheduleProjectName?.trim() || 'Unassigned Project';
    const group = groups.get(projectName);
    if (group) group.push(item);
    else groups.set(projectName, [item]);
  });
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right, undefined, {
      numeric: true,
      sensitivity: 'base',
    }))
    .flatMap(([projectName, projectItems]) =>
      buildVitruviusScheduleHierarchy(projectItems).rows.map(row => ({
        ...row,
        projectName,
      })),
    );
}

export function parseVitruviusScheduleDate(value: string | null | undefined): Date | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const iso = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  const us = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  const named = trimmed.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})$/);
  let year: number;
  let month: number;
  let day: number;
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else if (us) {
    month = Number(us[1]);
    day = Number(us[2]);
    const rawYear = Number(us[3]);
    year = rawYear < 100 ? 2000 + rawYear : rawYear;
  } else if (named) {
    const monthIndex = MONTHS.findIndex(monthName =>
      monthName.toLowerCase().startsWith(named[1].toLowerCase()),
    );
    if (monthIndex < 0) return null;
    year = Number(named[3]);
    month = monthIndex + 1;
    day = Number(named[2]);
  } else {
    return null;
  }
  const result = new Date(Date.UTC(year, month - 1, day));
  return result.getUTCFullYear() === year &&
    result.getUTCMonth() === month - 1 &&
    result.getUTCDate() === day
    ? result
    : null;
}

function derivedScheduleDates(items: readonly ScheduleItem[]) {
  type DerivedDateRange = {
    start: Date | null;
    finish: Date | null;
    derived: boolean;
  };
  const childrenByParent = new Map<string, ScheduleItem[]>();
  items.forEach(item => {
    const parentId = item.parentItemId?.trim();
    if (!parentId) return;
    const children = childrenByParent.get(parentId);
    if (children) children.push(item);
    else childrenByParent.set(parentId, [item]);
  });
  const result = new Map<string, DerivedDateRange>();
  const visiting = new Set<string>();
  const calculate = (item: ScheduleItem): DerivedDateRange => {
    const existing = result.get(item.id);
    if (existing) return existing;
    if (visiting.has(item.id)) {
      return { start: null, finish: null, derived: false };
    }
    visiting.add(item.id);
    const ownStart = parseVitruviusScheduleDate(item.startDate);
    const ownFinish = parseVitruviusScheduleDate(item.finishDate);
    const childRanges: DerivedDateRange[] = (childrenByParent.get(item.id) || []).map(calculate);
    const childStarts = childRanges
      .map(range => range.start)
      .filter((value): value is Date => Boolean(value));
    const childFinishes = childRanges
      .map(range => range.finish)
      .filter((value): value is Date => Boolean(value));
    const start = ownStart || (
      childStarts.length > 0
        ? new Date(Math.min(...childStarts.map(date => date.getTime())))
        : null
    );
    const finish = ownFinish || (
      childFinishes.length > 0
        ? new Date(Math.max(...childFinishes.map(date => date.getTime())))
        : start
    );
    const range: DerivedDateRange = {
      start,
      finish,
      derived: Boolean((!ownStart || !ownFinish) && childRanges.length > 0),
    };
    visiting.delete(item.id);
    result.set(item.id, range);
    return range;
  };
  items.forEach(calculate);
  return result;
}

function buildColumns(
  rangeStart: Date,
  rangeFinish: Date,
  zoom: VitruviusGanttZoom,
  dayWidth: number,
) {
  const columns: VitruviusGanttColumn[] = [];
  let cursor = new Date(rangeStart.getTime());
  while (cursor.getTime() <= rangeFinish.getTime()) {
    const columnStart = new Date(cursor.getTime());
    const naturalEnd = zoom === 'day'
      ? columnStart
      : zoom === 'week'
        ? addUtcDays(columnStart, 6)
        : new Date(Date.UTC(columnStart.getUTCFullYear(), columnStart.getUTCMonth() + 1, 0));
    const columnEnd = naturalEnd.getTime() > rangeFinish.getTime()
      ? rangeFinish
      : naturalEnd;
    const columnDays = calendarDayDifference(columnStart, columnEnd) + 1;
    columns.push(Object.freeze({
      key: `${zoom}:${formatIsoDate(columnStart)}`,
      label: columnLabel(columnStart, zoom),
      startDate: formatIsoDate(columnStart),
      endDate: formatIsoDate(columnEnd),
      left: calendarDayDifference(rangeStart, columnStart) * dayWidth,
      width: columnDays * dayWidth,
    }));
    cursor = addUtcDays(columnEnd, 1);
  }
  return columns;
}

function columnLabel(value: Date, zoom: VitruviusGanttZoom) {
  if (zoom === 'month') {
    return value.toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }
  if (zoom === 'week') {
    return `Week of ${value.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    })}`;
  }
  return value.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function startOfZoomRange(value: Date, zoom: VitruviusGanttZoom) {
  if (zoom === 'month') {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
  }
  if (zoom === 'week') {
    const mondayOffset = (value.getUTCDay() + 6) % 7;
    return addUtcDays(value, -mondayOffset);
  }
  return startOfUtcDay(value);
}

function endOfZoomRange(value: Date, zoom: VitruviusGanttZoom) {
  if (zoom === 'month') {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0));
  }
  if (zoom === 'week') {
    const sundayOffset = 7 - ((value.getUTCDay() + 6) % 7) - 1;
    return addUtcDays(value, sundayOffset);
  }
  return startOfUtcDay(value);
}

function ganttDayWidth(zoom: VitruviusGanttZoom) {
  if (zoom === 'day') return 38;
  if (zoom === 'week') return 16;
  return 5;
}

function startOfUtcDay(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function addUtcDays(value: Date, days: number) {
  const next = new Date(value.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function calendarDayDifference(left: Date, right: Date) {
  return Math.round((startOfUtcDay(right).getTime() - startOfUtcDay(left).getTime()) / 86_400_000);
}

function formatIsoDate(value: Date) {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;
