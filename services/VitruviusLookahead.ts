import type { ScheduleItem } from '../types';
import { parseVitruviusScheduleDate } from './VitruviusGanttModel';
import {
  analyzeVitruviusCriticalPath,
} from './VitruviusScheduleAnalytics';
import { normalizeScheduleDependencies } from './VitruviusScheduleEngine';

export type VitruviusLookaheadWeeks = 3 | 6;

export type VitruviusLookaheadStatus =
  | 'overdue'
  | 'in_progress'
  | 'ready'
  | 'blocked'
  | 'undated';

export type VitruviusLookaheadItem = Readonly<{
  item: ScheduleItem;
  projectName: string;
  areaName: string;
  contractor: string;
  owner: string;
  startDate: string | null;
  finishDate: string | null;
  weekOf: string | null;
  daysUntilFinish: number | null;
  status: VitruviusLookaheadStatus;
  critical: boolean;
  blockingPredecessorIds: readonly string[];
  blockingPredecessorNames: readonly string[];
}>;

export type VitruviusLookahead = Readonly<{
  weeks: VitruviusLookaheadWeeks;
  rangeStart: string;
  rangeFinish: string;
  rows: readonly VitruviusLookaheadItem[];
  overdueCount: number;
  blockedCount: number;
  criticalCount: number;
  undatedCount: number;
}>;

export function buildVitruviusLookahead({
  items,
  weeks,
  today = new Date(),
}: {
  items: readonly ScheduleItem[];
  weeks: VitruviusLookaheadWeeks;
  today?: Date;
}): VitruviusLookahead {
  const todayDate = startOfUtcDay(today);
  const rangeFinishDate = addDays(todayDate, weeks * 7 - 1);
  const itemsById = new Map(items.map(item => [item.id, item]));
  const criticalIds = analyzeVitruviusCriticalPath(items).criticalItemIds;
  const rows = items
    .filter(item => item.isSummary !== true)
    .filter(item => item.status !== 'Complete' && item.percentComplete < 100)
    .flatMap(item => {
      const start = parseVitruviusScheduleDate(item.startDate);
      const finish = parseVitruviusScheduleDate(item.finishDate);
      const dated = Boolean(start || finish);
      const effectiveStart = start || finish;
      const effectiveFinish = finish || start;
      const overdue = Boolean(effectiveFinish && effectiveFinish.getTime() < todayDate.getTime());
      const overlapsWindow = Boolean(
        effectiveStart &&
        effectiveFinish &&
        effectiveStart.getTime() <= rangeFinishDate.getTime() &&
        effectiveFinish.getTime() >= todayDate.getTime(),
      );
      if (dated && !overdue && !overlapsWindow) return [];
      const blockers = normalizeScheduleDependencies(item.dependencies)
        .map(dependency => itemsById.get(dependency.predecessorItemId))
        .filter((predecessor): predecessor is ScheduleItem =>
          Boolean(
            predecessor &&
            predecessor.status !== 'Complete' &&
            predecessor.percentComplete < 100,
          ),
        );
      const status: VitruviusLookaheadStatus = !dated
        ? 'undated'
        : overdue
          ? 'overdue'
          : blockers.length > 0
            ? 'blocked'
            : item.status === 'In Progress'
              ? 'in_progress'
              : 'ready';
      return [Object.freeze({
        item,
        projectName: item.scheduleProjectName?.trim() || item.projectName?.trim() ||
          'Unassigned Project',
        areaName: item.locationName?.trim() || 'No area',
        contractor: item.contractor?.trim() || 'Unassigned',
        owner: item.owner?.trim() || 'Unassigned',
        startDate: formatDate(start),
        finishDate: formatDate(finish),
        weekOf: effectiveFinish ? formatDate(startOfWeek(effectiveFinish)) : null,
        daysUntilFinish: effectiveFinish
          ? calendarDaysBetween(todayDate, effectiveFinish)
          : null,
        status,
        critical: criticalIds.has(item.id),
        blockingPredecessorIds: Object.freeze(blockers.map(blocker => blocker.id)),
        blockingPredecessorNames: Object.freeze(blockers.map(blocker => blocker.taskName)),
      })];
    })
    .sort(compareLookaheadRows);

  return Object.freeze({
    weeks,
    rangeStart: formatDate(todayDate)!,
    rangeFinish: formatDate(rangeFinishDate)!,
    rows: Object.freeze(rows),
    overdueCount: rows.filter(row => row.status === 'overdue').length,
    blockedCount: rows.filter(row => row.status === 'blocked').length,
    criticalCount: rows.filter(row => row.critical).length,
    undatedCount: rows.filter(row => row.status === 'undated').length,
  });
}

export function vitruviusLookaheadCsv(
  lookahead: VitruviusLookahead,
): string {
  const header = [
    'Project',
    'Area',
    'WBS',
    'Task',
    'Start',
    'Finish',
    'Status',
    'Critical',
    'Contractor',
    'Owner',
    'Blocked By',
    'Percent Complete',
  ];
  const rows = lookahead.rows.map(row => [
    row.projectName,
    row.areaName,
    row.item.wbsCode || '',
    row.item.taskName,
    row.startDate || '',
    row.finishDate || '',
    lookaheadStatusLabel(row.status),
    row.critical ? 'Yes' : 'No',
    row.contractor,
    row.owner,
    row.blockingPredecessorNames.join('; '),
    String(row.item.percentComplete),
  ]);
  return [header, ...rows]
    .map(row => row.map(csvCell).join(','))
    .join('\n');
}

export function lookaheadStatusLabel(status: VitruviusLookaheadStatus) {
  if (status === 'in_progress') return 'In Progress';
  if (status === 'overdue') return 'Overdue';
  if (status === 'blocked') return 'Blocked';
  if (status === 'undated') return 'Needs Dates';
  return 'Ready';
}

function compareLookaheadRows(
  left: VitruviusLookaheadItem,
  right: VitruviusLookaheadItem,
) {
  const statusOrder = lookaheadStatusOrder(left.status) - lookaheadStatusOrder(right.status);
  if (statusOrder !== 0) return statusOrder;
  const finishOrder = (left.finishDate || '9999').localeCompare(right.finishDate || '9999');
  if (finishOrder !== 0) return finishOrder;
  const projectOrder = left.projectName.localeCompare(right.projectName, undefined, {
    numeric: true,
    sensitivity: 'base',
  });
  if (projectOrder !== 0) return projectOrder;
  const areaOrder = left.areaName.localeCompare(right.areaName, undefined, {
    numeric: true,
    sensitivity: 'base',
  });
  if (areaOrder !== 0) return areaOrder;
  return left.item.taskName.localeCompare(right.item.taskName);
}

function lookaheadStatusOrder(status: VitruviusLookaheadStatus) {
  if (status === 'overdue') return 0;
  if (status === 'blocked') return 1;
  if (status === 'in_progress') return 2;
  if (status === 'ready') return 3;
  return 4;
}

function csvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function startOfUtcDay(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function startOfWeek(value: Date) {
  const normalized = startOfUtcDay(value);
  const mondayOffset = (normalized.getUTCDay() + 6) % 7;
  return addDays(normalized, -mondayOffset);
}

function addDays(value: Date, days: number) {
  const result = new Date(value.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function calendarDaysBetween(left: Date, right: Date) {
  return Math.round((right.getTime() - left.getTime()) / 86_400_000);
}

function formatDate(value: Date | null) {
  return value ? value.toISOString().slice(0, 10) : null;
}
