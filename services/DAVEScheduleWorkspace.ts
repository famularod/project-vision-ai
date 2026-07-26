import type { ScheduleItem } from '../types';

function normalizedProjectName(value: string | null | undefined) {
  return value?.trim().toLowerCase() || '';
}

export function scheduleItemProjectName(item: ScheduleItem) {
  return item.scheduleProjectName?.trim() || item.projectName.trim();
}

export function scheduleItemsForWorkspaceProject(
  items: ScheduleItem[],
  projectName: string | null,
) {
  const normalizedFilter = normalizedProjectName(projectName);
  if (!normalizedFilter) return items;

  return items.filter(item =>
    normalizedProjectName(scheduleItemProjectName(item)) === normalizedFilter,
  );
}

export function scheduleWorkspaceProjectOptions(
  projects: string[],
  items: ScheduleItem[],
) {
  const byNormalizedName = new Map<string, string>();

  [...projects, ...items.map(scheduleItemProjectName)].forEach(projectName => {
    const trimmed = projectName.trim();
    const normalized = normalizedProjectName(trimmed);
    if (!normalized || byNormalizedName.has(normalized)) return;
    byNormalizedName.set(normalized, trimmed);
  });

  return [...byNormalizedName.values()].sort((left, right) =>
    left.localeCompare(right),
  );
}

export type ScheduleWorkspaceProjectGroup = Readonly<{
  projectName: string;
  data: ScheduleItem[];
}>;

export type ScheduleWorkspaceProjectAreaGroup = Readonly<{
  projectName: string;
  areaName: string;
  projectTaskCount: number;
  isFirstAreaInProject: boolean;
  data: ScheduleItem[];
}>;

export function groupScheduleWorkspaceItemsByProject(
  items: ScheduleItem[],
): ScheduleWorkspaceProjectGroup[] {
  const groups = new Map<string, ScheduleItem[]>();

  items.forEach(item => {
    const projectName = scheduleItemProjectName(item) || 'No project';
    const existing = groups.get(projectName);
    if (existing) existing.push(item);
    else groups.set(projectName, [item]);
  });

  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([projectName, data]) => Object.freeze({ projectName, data }));
}

function scheduleItemAreaName(item: ScheduleItem) {
  return item.locationName?.trim() || 'No Area Assigned';
}

export function groupScheduleWorkspaceItemsByProjectAndArea(
  items: ScheduleItem[],
): ScheduleWorkspaceProjectAreaGroup[] {
  return groupScheduleWorkspaceItemsByProject(items).flatMap(projectGroup => {
    const areas = new Map<string, ScheduleItem[]>();

    projectGroup.data.forEach(item => {
      const areaName = scheduleItemAreaName(item);
      const existing = areas.get(areaName);
      if (existing) existing.push(item);
      else areas.set(areaName, [item]);
    });

    return [...areas.entries()]
      .sort(([left], [right]) => {
        if (left === 'No Area Assigned') return 1;
        if (right === 'No Area Assigned') return -1;
        return left.localeCompare(right);
      })
      .map(([areaName, data], index) => Object.freeze({
        projectName: projectGroup.projectName,
        areaName,
        projectTaskCount: projectGroup.data.length,
        isFirstAreaInProject: index === 0,
        data,
      }));
  });
}

export function resolveScheduleWorkspaceTask(
  items: ScheduleItem[],
  selectedTaskId: string | null,
) {
  if (selectedTaskId) {
    const selected = items.find(item => item.id === selectedTaskId);
    if (selected) return selected;
  }

  return items[0] || null;
}
