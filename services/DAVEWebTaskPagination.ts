import type { ScheduleItem } from '../types';
import {
  groupScheduleWorkspaceItemsByProjectAndArea,
  type ScheduleWorkspaceProjectAreaGroup,
} from './DAVEScheduleWorkspace';

export const DAVE_WEB_TASK_PAGE_SIZE = 40;

export type DAVEWebTaskRenderGroup = Readonly<
  Omit<ScheduleWorkspaceProjectAreaGroup, 'data'> & {
    areaTaskCount: number;
    data: ScheduleItem[];
  }
>;

export type DAVEWebTaskRenderPage = Readonly<{
  groups: DAVEWebTaskRenderGroup[];
  totalTaskCount: number;
  renderedTaskCount: number;
  pageIndex: number;
  pageCount: number;
  firstRenderedTaskNumber: number;
  lastRenderedTaskNumber: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
}>;

export function buildDAVEWebTaskRenderPage(
  tasks: readonly ScheduleItem[],
  requestedPageIndex = 0,
  requestedPageSize = DAVE_WEB_TASK_PAGE_SIZE,
): DAVEWebTaskRenderPage {
  const totalTaskCount = tasks.length;
  const pageSize = Math.max(
    1,
    Math.floor(Number.isFinite(requestedPageSize) ? requestedPageSize : DAVE_WEB_TASK_PAGE_SIZE),
  );
  const pageCount = Math.ceil(totalTaskCount / pageSize);
  const pageIndex = pageCount === 0
    ? 0
    : Math.min(
        pageCount - 1,
        Math.max(0, Math.floor(Number.isFinite(requestedPageIndex) ? requestedPageIndex : 0)),
      );
  const windowStart = pageIndex * pageSize;
  const windowEnd = Math.min(totalTaskCount, windowStart + pageSize);
  const sourceGroups = groupScheduleWorkspaceItemsByProjectAndArea([...tasks]);
  const groups: DAVEWebTaskRenderGroup[] = [];
  let sourceCursor = 0;

  for (const group of sourceGroups) {
    const groupStart = sourceCursor;
    const groupEnd = groupStart + group.data.length;
    sourceCursor = groupEnd;
    if (groupEnd <= windowStart) continue;
    if (groupStart >= windowEnd) break;
    const data = group.data.slice(
      Math.max(0, windowStart - groupStart),
      Math.min(group.data.length, windowEnd - groupStart),
    );
    groups.push(Object.freeze({
      ...group,
      areaTaskCount: group.data.length,
      data,
    }));
  }

  const renderedTaskCount = groups.reduce((total, group) => total + group.data.length, 0);

  return Object.freeze({
    groups,
    totalTaskCount,
    renderedTaskCount,
    pageIndex,
    pageCount,
    firstRenderedTaskNumber: renderedTaskCount === 0 ? 0 : windowStart + 1,
    lastRenderedTaskNumber: windowStart + renderedTaskCount,
    hasPreviousPage: pageIndex > 0,
    hasNextPage: pageIndex + 1 < pageCount,
  });
}
