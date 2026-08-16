import type { ProjectUpdate, ScheduleItem } from '../types';

type ParentScopedUpdate = Pick<
  ProjectUpdate,
  'projectId' | 'projectName' | 'scheduleItemId' | 'scheduleProjectName'
>;

type ParentScopedScheduleItem = Pick<
  ScheduleItem,
  'id' | 'projectId' | 'projectName' | 'scheduleProjectName'
> & Readonly<{
  locationName?: string | null;
}>;

export type DAVEProjectUpdateScopeInput = Readonly<{
  update: ParentScopedUpdate;
  projectName: string | null | undefined;
  selectedProjectId?: string | null;
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
  selectedProjectId,
  scheduleItems = [],
}: DAVEProjectUpdateScopeInput): boolean {
  const exactScopeWasSupplied = selectedProjectId !== undefined && selectedProjectId !== null;
  if (exactScopeWasSupplied) {
    const targetProjectId = immutableProjectId(selectedProjectId);
    if (!targetProjectId) return false;
    const updateProjectIdWasSupplied = update.projectId !== undefined && update.projectId !== null;
    const updateProjectId = immutableProjectId(update.projectId);
    if (updateProjectIdWasSupplied && updateProjectId !== targetProjectId) return false;

    const scheduleItemId = cleanText(update.scheduleItemId);
    if (scheduleItemId) {
      const matches = scheduleItems.filter(item => cleanText(item.id) === scheduleItemId);
      if (matches.length !== 1) return false;
      return immutableProjectId(matches[0].projectId) === targetProjectId;
    }

    // An exact update identity is sufficient even if the display name changed.
    // A name-only legacy row remains quarantined until an exact task repair can
    // establish its immutable parent above.
    return updateProjectId === targetProjectId;
  }

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
  selectedProjectId?: string | null,
): T[] {
  if (!cleanText(projectName) && selectedProjectId === undefined) return [...updates];
  return updates.filter(update =>
    projectUpdateBelongsToParentProject({
      update,
      projectName,
      selectedProjectId,
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

function immutableProjectId(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.length > 0 && value === value.trim()
    ? value
    : null;
}
