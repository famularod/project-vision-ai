import type { ScheduleItem } from '../types';
import { parseFlexibleDate } from '../utils/date';

/**
 * A deliberately non-project value used only inside the import review flow.
 * `scheduleProjectName` is cleared at the same time so this label can never be
 * interpreted as a parent-project creation candidate.
 */
export const SCHEDULE_IMPORT_NEEDS_PROJECT = 'Needs Project';

export type ScheduleImportSelectedProject = Readonly<{
  id: string;
  name: string;
  aliases?: readonly string[];
}>;

export type ScheduleImportUnavailableProject = Readonly<{
  id?: string | null;
  name: string;
  state: 'archived' | 'deleted';
  aliases?: readonly string[];
}>;

export type ScheduleImportScopeWarningCode =
  | 'project_missing'
  | 'project_not_selected'
  | 'project_ambiguous'
  | 'project_archived'
  | 'project_deleted'
  | 'schedule_parent_not_selected'
  | 'schedule_parent_ambiguous'
  | 'schedule_parent_archived'
  | 'schedule_parent_deleted'
  | 'area_not_in_selected_project'
  | 'area_ambiguous'
  | 'invalid_start_date'
  | 'invalid_finish_date'
  | 'start_after_finish';

export type ScheduleImportScopeWarning = Readonly<{
  itemId: string;
  code: ScheduleImportScopeWarningCode;
  field: 'project' | 'schedule_parent' | 'area' | 'start_date' | 'finish_date' | 'date_range';
  sourceValue: string | null;
  message: string;
}>;

export type ScheduleImportScopeItemResult = Readonly<{
  item: ScheduleItem;
  originalProjectName: string;
  originalScheduleProjectName: string | null;
  selectedProjectId: string | null;
  assignment: 'selected_project' | 'needs_project';
  warnings: ScheduleImportScopeWarning[];
}>;

export type ValidateScheduleImportScopeParams = Readonly<{
  items: readonly ScheduleItem[];
  /**
   * The active, existing projects explicitly selected for this import.
   * Matching is limited to these records by immutable ID, canonical name, or
   * an explicitly supplied alias.
   */
  selectedProjects: readonly ScheduleImportSelectedProject[];
  selectedProjectAreas?: readonly Readonly<{
    projectId: string;
    areas: readonly Readonly<{ id: string; name: string }>[];
  }>[];
  /**
   * Known deleted/archived identities. These always win over selected-project
   * matches so stale or contradictory input can never restore a project.
   */
  unavailableProjects?: readonly ScheduleImportUnavailableProject[];
}>;

export type ScheduleImportScopeValidation = Readonly<{
  /** Safe copies that can enter the existing review flow. */
  items: ScheduleItem[];
  itemResults: ScheduleImportScopeItemResult[];
  warnings: ScheduleImportScopeWarning[];
  needsProjectCount: number;
  hasWarnings: boolean;
}>;

type MatchResult<T> =
  | { kind: 'none' }
  | { kind: 'one'; value: T }
  | { kind: 'ambiguous' };

function identityKey(value: string | null | undefined) {
  return (value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function identityValues(
  project: Readonly<{
    id?: string | null;
    name: string;
    aliases?: readonly string[];
  }>,
) {
  return [
    project.id || '',
    project.name,
    ...(project.aliases || []),
  ]
    .map(identityKey)
    .filter(Boolean);
}

function findIdentityMatch<T extends Readonly<{
  id?: string | null;
  name: string;
  aliases?: readonly string[];
}>>(
  sourceValue: string | null | undefined,
  projects: readonly T[],
): MatchResult<T> {
  const key = identityKey(sourceValue);
  if (!key) return { kind: 'none' };

  const matches = projects.filter(project =>
    identityValues(project).includes(key),
  );

  if (matches.length === 0) return { kind: 'none' };
  if (matches.length > 1) return { kind: 'ambiguous' };

  return { kind: 'one', value: matches[0] };
}

function warning(
  item: ScheduleItem,
  code: ScheduleImportScopeWarningCode,
  field: ScheduleImportScopeWarning['field'],
  sourceValue: string | null,
  message: string,
): ScheduleImportScopeWarning {
  return {
    itemId: item.id,
    code,
    field,
    sourceValue,
    message,
  };
}

function parseScheduleImportDate(value: string) {
  const flexible = parseFlexibleDate(value);
  if (flexible) return flexible;

  const displayMatch = value.trim().match(
    /^([a-z]{3,9})\s+(\d{1,2}),\s+(\d{4})$/i,
  );
  if (!displayMatch) return null;

  const monthIndex = [
    ['jan', 'january'],
    ['feb', 'february'],
    ['mar', 'march'],
    ['apr', 'april'],
    ['may'],
    ['jun', 'june'],
    ['jul', 'july'],
    ['aug', 'august'],
    ['sep', 'sept', 'september'],
    ['oct', 'october'],
    ['nov', 'november'],
    ['dec', 'december'],
  ].findIndex(monthNames =>
    monthNames.includes(displayMatch[1].toLowerCase()),
  );
  if (monthIndex < 0) return null;

  const day = Number(displayMatch[2]);
  const year = Number(displayMatch[3]);
  const date = new Date(year, monthIndex, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== monthIndex ||
    date.getDate() !== day
  ) {
    return null;
  }

  date.setHours(0, 0, 0, 0);
  return date;
}

function unavailableProjectWarning(
  item: ScheduleItem,
  unavailable: ScheduleImportUnavailableProject,
  sourceValue: string,
  field: 'project' | 'schedule_parent',
) {
  const isParent = field === 'schedule_parent';
  const stateLabel = unavailable.state === 'archived' ? 'archived' : 'deleted';
  const code: ScheduleImportScopeWarningCode = isParent
    ? unavailable.state === 'archived'
      ? 'schedule_parent_archived'
      : 'schedule_parent_deleted'
    : unavailable.state === 'archived'
      ? 'project_archived'
      : 'project_deleted';

  return warning(
    item,
    code,
    field,
    sourceValue,
    `${isParent ? 'Schedule parent' : 'Project'} "${sourceValue}" is ${stateLabel} and was not restored. Select an active project during review.`,
  );
}

/**
 * Returns date defects that must keep an imported row in review.
 *
 * A completion-verification claim may legitimately omit schedule dates, but
 * dates that are present still have to be valid and chronologically ordered.
 * Keeping this check in one shared helper prevents the review UI and the scope
 * guard from applying different approval rules.
 */
export function scheduleImportDateWarnings(item: ScheduleItem) {
  const warnings: ScheduleImportScopeWarning[] = [];
  const startValue = item.startDate.trim();
  const finishValue = item.finishDate.trim();
  const start = startValue ? parseScheduleImportDate(startValue) : null;
  const finish = finishValue ? parseScheduleImportDate(finishValue) : null;

  if (startValue && !start) {
    warnings.push(warning(
      item,
      'invalid_start_date',
      'start_date',
      startValue,
      `Start date "${startValue}" is invalid and needs review.`,
    ));
  }

  if (finishValue && !finish) {
    warnings.push(warning(
      item,
      'invalid_finish_date',
      'finish_date',
      finishValue,
      `Finish date "${finishValue}" is invalid and needs review.`,
    ));
  }

  if (start && finish && start.getTime() > finish.getTime()) {
    warnings.push(warning(
      item,
      'start_after_finish',
      'date_range',
      `${startValue} -> ${finishValue}`,
      `Start date "${startValue}" is after finish date "${finishValue}".`,
    ));
  }

  return warnings;
}

function guardScheduleParent({
  item,
  selectedProjects,
  unavailableProjects,
}: Readonly<{
  item: ScheduleItem;
  selectedProjects: readonly ScheduleImportSelectedProject[];
  unavailableProjects: readonly ScheduleImportUnavailableProject[];
}>) {
  const sourceValue = item.scheduleProjectName?.trim() || '';
  if (!sourceValue) {
    return {
      scheduleProjectName: null as string | null,
      selectedParent: null as ScheduleImportSelectedProject | null,
      warnings: [] as ScheduleImportScopeWarning[],
    };
  }

  const unavailableMatch = findIdentityMatch(sourceValue, unavailableProjects);
  if (unavailableMatch.kind === 'one') {
    return {
      scheduleProjectName: null,
      selectedParent: null,
      warnings: [
        unavailableProjectWarning(
          item,
          unavailableMatch.value,
          sourceValue,
          'schedule_parent',
        ),
      ],
    };
  }

  if (unavailableMatch.kind === 'ambiguous') {
    return {
      scheduleProjectName: null,
      selectedParent: null,
      warnings: [
        warning(
          item,
          'schedule_parent_ambiguous',
          'schedule_parent',
          sourceValue,
          `Schedule parent "${sourceValue}" matches more than one unavailable project record and needs review.`,
        ),
      ],
    };
  }

  const selectedMatch = findIdentityMatch(sourceValue, selectedProjects);
  if (selectedMatch.kind === 'one') {
    return {
      scheduleProjectName: selectedMatch.value.name,
      selectedParent: selectedMatch.value,
      warnings: [] as ScheduleImportScopeWarning[],
    };
  }

  return {
    scheduleProjectName: null,
    selectedParent: null,
    warnings: [
      warning(
        item,
        selectedMatch.kind === 'ambiguous'
          ? 'schedule_parent_ambiguous'
          : 'schedule_parent_not_selected',
        'schedule_parent',
        sourceValue,
        selectedMatch.kind === 'ambiguous'
          ? `Schedule parent "${sourceValue}" matches more than one selected project and needs review.`
          : `Schedule parent "${sourceValue}" is outside the selected active projects and was not added or restored.`,
      ),
    ],
  };
}

export function validateScheduleImportScope({
  items,
  selectedProjects,
  selectedProjectAreas,
  unavailableProjects = [],
}: ValidateScheduleImportScopeParams): ScheduleImportScopeValidation {
  const itemResults = items.map(item => {
    const originalProjectName = item.projectName;
    const originalScheduleProjectName = item.scheduleProjectName?.trim() || null;
    const parent = guardScheduleParent({
      item,
      selectedProjects,
      unavailableProjects,
    });
    const warnings = [...parent.warnings, ...scheduleImportDateWarnings(item)];
    const projectSource = originalProjectName.trim();
    let selectedProject: ScheduleImportSelectedProject | null = null;

    if (projectSource) {
      const unavailableMatch = findIdentityMatch(projectSource, unavailableProjects);

      if (unavailableMatch.kind === 'one') {
        warnings.unshift(unavailableProjectWarning(
          item,
          unavailableMatch.value,
          projectSource,
          'project',
        ));
      } else if (unavailableMatch.kind === 'ambiguous') {
        warnings.unshift(warning(
          item,
          'project_ambiguous',
          'project',
          projectSource,
          `Project "${projectSource}" matches more than one unavailable project record and needs review.`,
        ));
      } else {
        const selectedMatch = findIdentityMatch(projectSource, selectedProjects);

        if (selectedMatch.kind === 'one') {
          selectedProject = selectedMatch.value;
        } else {
          warnings.unshift(warning(
            item,
            selectedMatch.kind === 'ambiguous'
              ? 'project_ambiguous'
              : 'project_not_selected',
            'project',
            projectSource,
            selectedMatch.kind === 'ambiguous'
              ? `Project "${projectSource}" matches more than one selected project and needs review.`
              : `Project "${projectSource}" is outside the selected active projects and was left unassigned.`,
          ));
        }
      }
    } else if (parent.selectedParent) {
      selectedProject = parent.selectedParent;
    } else {
      warnings.unshift(warning(
        item,
        'project_missing',
        'project',
        null,
        'No active project was identified. Select a project during review.',
      ));
    }

    let safeLocationName = item.locationName;
    if (selectedProject && selectedProjectAreas) {
      const areaSource = item.locationName.trim();
      const projectAreaGroup = selectedProjectAreas.find(group =>
        identityKey(group.projectId) === identityKey(selectedProject?.id),
      );
      if (areaSource && projectAreaGroup) {
        const matchingAreas = projectAreaGroup.areas.filter(area =>
          [area.id, area.name].map(identityKey).includes(identityKey(areaSource)),
        );
        if (matchingAreas.length === 1) {
          safeLocationName = matchingAreas[0].name;
        } else {
          safeLocationName = '';
          warnings.push(warning(
            item,
            matchingAreas.length > 1
              ? 'area_ambiguous'
              : 'area_not_in_selected_project',
            'area',
            areaSource,
            matchingAreas.length > 1
              ? `Area "${areaSource}" is ambiguous for ${selectedProject.name}. Select the correct area during review.`
              : `Area "${areaSource}" does not belong to ${selectedProject.name}. Select an area for that project during review.`,
          ));
        }
      }
    }

    const safeItem: ScheduleItem = {
      ...item,
      projectName: selectedProject?.name || SCHEDULE_IMPORT_NEEDS_PROJECT,
      scheduleProjectName: parent.scheduleProjectName,
      locationName: safeLocationName,
    };

    return {
      item: safeItem,
      originalProjectName,
      originalScheduleProjectName,
      selectedProjectId: selectedProject?.id || null,
      assignment: selectedProject ? 'selected_project' : 'needs_project',
      warnings,
    } satisfies ScheduleImportScopeItemResult;
  });
  const warnings = itemResults.flatMap(result => result.warnings);

  return {
    items: itemResults.map(result => result.item),
    itemResults,
    warnings,
    needsProjectCount: itemResults.filter(
      result => result.assignment === 'needs_project',
    ).length,
    hasWarnings: warnings.length > 0,
  };
}
