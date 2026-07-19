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
