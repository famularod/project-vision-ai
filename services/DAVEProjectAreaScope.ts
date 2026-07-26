import type { ProjectArea, ProjectUpdate, ScheduleItem } from '../types';

export type DAVEProjectAreaScopeInput = {
  projectAreas: readonly ProjectArea[];
  projectName?: string | null;
  scheduleItems?: readonly ScheduleItem[];
  updates?: readonly ProjectUpdate[];
};

/**
 * Returns the areas that can be attributed to one project without guessing.
 *
 * New records carry projectName. A legacy unowned record is admitted only when
 * all exact task/update links identify one project. Ambiguous and unlinked
 * legacy areas remain available to global/admin tools, but are excluded from a
 * project-specific workflow until a person assigns them.
 */
export function projectAreasForProject({
  projectAreas,
  projectName,
  scheduleItems = [],
  updates = [],
}: DAVEProjectAreaScopeInput): ProjectArea[] {
  const target = normalizeName(projectName);
  if (!target) return [...projectAreas];

  return projectAreas.filter(area => {
    const explicitOwner = normalizeName(area.projectName);
    if (explicitOwner) return explicitOwner === target;

    const inferredOwners = inferLegacyAreaProjectNames(
      area,
      scheduleItems,
      updates,
    );
    return inferredOwners.length === 1 && inferredOwners[0] === target;
  });
}

export function inferLegacyAreaProjectNames(
  area: Pick<ProjectArea, 'id' | 'name'>,
  scheduleItems: readonly ScheduleItem[] = [],
  updates: readonly ProjectUpdate[] = [],
): string[] {
  const areaId = normalizeName(area.id);
  const areaName = normalizeName(area.name);
  const projects = new Map<string, string>();

  scheduleItems.forEach(item => {
    if (!areaName || normalizeName(item.locationName) !== areaName) return;
    addProject(
      projects,
      item.scheduleProjectName?.trim() || item.projectName,
    );
  });

  updates.forEach(update => {
    const matchesId = Boolean(
      areaId &&
      normalizeName(update.selectedAreaId) === areaId,
    );
    const matchesName = Boolean(
      areaName &&
      normalizeName(update.selectedAreaName) === areaName,
    );
    const photoMatches = update.photos.some(photo =>
      Boolean(
        (areaId && normalizeName(photo.selectedAreaId) === areaId) ||
        (areaName && normalizeName(photo.selectedAreaName) === areaName),
      ),
    );

    if (matchesId || matchesName || photoMatches) {
      addProject(
        projects,
        update.scheduleProjectName?.trim() || update.projectName,
      );
    }
  });

  return [...projects.keys()].sort();
}

export function explicitProjectAreaOwner(
  area: Pick<ProjectArea, 'projectName'>,
  activeProjects: readonly string[],
): string | null {
  const owner = normalizeName(area.projectName);
  if (!owner) return null;
  return activeProjects.find(project => normalizeName(project) === owner) || null;
}

function addProject(projects: Map<string, string>, value: string | null | undefined) {
  const normalized = normalizeName(value);
  if (normalized) projects.set(normalized, value!.trim());
}

function normalizeName(value: string | null | undefined) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}
