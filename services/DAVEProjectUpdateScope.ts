import type { ProjectUpdate, ScheduleItem } from '../types';

type ParentScopedUpdate = Pick<
  ProjectUpdate,
  'projectName' | 'scheduleItemId' | 'scheduleProjectName'
>;

type ParentScopedScheduleItem = Pick<
  ScheduleItem,
  'id' | 'projectName' | 'scheduleProjectName'
> & Readonly<{
  locationName?: string | null;
}>;

export type DAVEProjectUpdateScopeInput = Readonly<{
  update: ParentScopedUpdate;
  projectName: string | null | undefined;
  scheduleItems?: readonly ParentScopedScheduleItem[];
}>;

/**
 * Attributes an update to one parent project without treating a shared
 * area/location label as parent identity.
 *
 * Exact task identity is strongest and fails closed when missing or
 * ambiguous. Explicit parent metadata is next. Legacy area-only records are
 * admitted only when the complete schedule assigns that area to one parent.
 */
export function projectUpdateBelongsToParentProject({
  update,
  projectName,
  scheduleItems = [],
}: DAVEProjectUpdateScopeInput): boolean {
  const target = normalizeName(projectName);
  if (!target) return false;

  const scheduleItemId = cleanText(update.scheduleItemId);
  if (scheduleItemId) {
    const matches = scheduleItems.filter(item => cleanText(item.id) === scheduleItemId);
    if (matches.length !== 1) return false;
    return scheduleParentName(matches[0]) === target;
  }

  const explicitParent = normalizeName(update.scheduleProjectName);
  if (explicitParent) return explicitParent === target;

  const updateProject = normalizeName(update.projectName);
  if (!updateProject) return false;
  if (updateProject === target) return true;

  const owners = new Set<string>();
  scheduleItems.forEach(item => {
    const matchesLegacyArea =
      normalizeName(item.projectName) === updateProject ||
      normalizeName(item.locationName) === updateProject;
    if (!matchesLegacyArea) return;
    const parent = scheduleParentName(item);
    if (parent) owners.add(parent);
  });
  return owners.size === 1 && owners.has(target);
}

export function projectUpdatesForParentProject<T extends ParentScopedUpdate>(
  updates: readonly T[],
  projectName: string | null | undefined,
  scheduleItems: readonly ParentScopedScheduleItem[] = [],
): T[] {
  if (!cleanText(projectName)) return [...updates];
  return updates.filter(update =>
    projectUpdateBelongsToParentProject({
      update,
      projectName,
      scheduleItems,
    }),
  );
}

function scheduleParentName(item: ParentScopedScheduleItem): string {
  return normalizeName(item.scheduleProjectName) || normalizeName(item.projectName);
}

function cleanText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeName(value: string | null | undefined): string {
  return cleanText(value).toLowerCase();
}
