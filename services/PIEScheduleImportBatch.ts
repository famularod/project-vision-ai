import type { ReferenceDocument, ScheduleItem } from '../types';
import { parseFlexibleDate } from '../utils/date';
import { scheduleItemNeedsCompletionVerification } from './DAVECompletionVerification';
import { bindScheduleImportBatch } from './ScheduleImportProvenance';

export type PIEScheduleImportKind = 'schedule_file' | 'message_screenshots';

export type PIEScheduleImportBatch = {
  id: string;
  kind: PIEScheduleImportKind;
  sourceCount: number;
  sourceLabel: string;
  message: string;
  items: ScheduleItem[];
  documents: ReferenceDocument[];
};

/**
 * Binds every reviewed task and source document to the batch's immutable ID.
 * This must be called when the user approves an import, after review edits but
 * before records are persisted. Same-named files can then never own or remove
 * one another's tasks by filename coincidence.
 */
export function bindPIEScheduleImportBatchProvenance(
  batch: PIEScheduleImportBatch,
): PIEScheduleImportBatch {
  const bound = bindScheduleImportBatch({
    importBatchId: batch.id,
    items: batch.items,
    documents: batch.documents,
  });

  return {
    ...batch,
    items: bound.items,
    documents: bound.documents,
  };
}

export type PIEScheduleProjectGroup = {
  id: string;
  name: string;
  sourceName: string | null;
  items: ScheduleItem[];
};

export type PIEScheduleImportReviewField =
  | 'task'
  | 'project'
  | 'area'
  | 'date'
  | 'owner';

export function scheduleImportReviewFields(
  item: ScheduleItem,
): PIEScheduleImportReviewField[] {
  return [
    !item.taskName.trim() ? 'task' : null,
    !item.projectName.trim() ? 'project' : null,
    !item.locationName.trim() ? 'area' : null,
    !scheduleItemNeedsCompletionVerification(item) &&
      (!item.finishDate.trim() || !parseFlexibleDate(item.finishDate)) ? 'date' : null,
    !item.owner.trim() ? 'owner' : null,
  ].filter(Boolean) as PIEScheduleImportReviewField[];
}

export function scheduleImportItemIsReady(item: ScheduleItem) {
  return scheduleImportReviewFields(item).length === 0;
}

export function scheduleImportItemHasCoreFacts(item: ScheduleItem) {
  return Boolean(item.taskName.trim() && (
    parseFlexibleDate(item.finishDate) || scheduleItemNeedsCompletionVerification(item)
  ));
}

export function scheduleImportItemIdentity(item: ScheduleItem) {
  return [
    item.taskName,
    item.finishDate,
    item.projectName,
    item.locationName,
  ]
    .map(value => value.trim().toLowerCase().replace(/\s+/g, ' '))
    .join('|');
}

export function dedupeScheduleImportItems(items: ScheduleItem[]) {
  const seen = new Set<string>();

  return items.filter(item => {
    const identity = scheduleImportItemIdentity(item);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

export function scheduleImportBatchCounts(items: ScheduleItem[]) {
  const ready = items.filter(scheduleImportItemIsReady).length;

  return {
    total: items.length,
    ready,
    needsReview: items.length - ready,
  };
}

function scheduleFileSource(value: string | null | undefined) {
  const source = value?.trim() || '';
  return /\.(?:csv|json|pdf|text|tsv|txt|xls|xlsx)$/i.test(source) ? source : '';
}

function scheduleProjectNameFromSource(sourceName: string) {
  const readableName = sourceName
    .replace(/\.[^/.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return readableName || 'Imported Schedule Project';
}

export function buildScheduleProjectGroups(items: ScheduleItem[]): PIEScheduleProjectGroup[] {
  const groups = new Map<string, PIEScheduleProjectGroup>();

  items.forEach(item => {
    const sourceName = scheduleFileSource(item.importedFrom);
    const scheduleProjectName = item.scheduleProjectName?.trim() || '';
    const projectName = scheduleProjectName || item.projectName.trim() || (
      sourceName
        ? `${scheduleProjectNameFromSource(sourceName)} - Needs Assignment`
        : 'Unassigned Schedule'
    );
    const groupKey = `project:${projectName.toLowerCase()}`;
    const existing = groups.get(groupKey);

    if (existing) {
      existing.items.push(item);
      return;
    }

    groups.set(groupKey, {
      id: groupKey,
      name: projectName,
      sourceName: sourceName || null,
      items: [item],
    });
  });

  return Array.from(groups.values());
}

function uniqueProjectNames(values: string[]) {
  const seen = new Set<string>();

  return values.filter(value => {
    const normalized = value.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

export function scheduleParentProjectNames(items: ScheduleItem[]) {
  return uniqueProjectNames(
    items.map(item => item.scheduleProjectName?.trim() || ''),
  );
}

export type ScheduleParentActions = Readonly<{
  /** Parents that do not exist yet and should be created. */
  missingNames: string[];
  /**
   * Archived parents that may be reopened. Populated ONLY when
   * reopenArchivedParents is true (an explicit user transition, e.g. an
   * approved import into that project). Background schedule mutations must
   * never reopen an archived project (audit P1-57).
   */
  reopeningNames: string[];
}>;

export function resolveScheduleParentActions({
  parentNames,
  existingProjects,
  archivedProjects,
  reopenArchivedParents,
}: Readonly<{
  parentNames: string[];
  existingProjects: string[];
  archivedProjects: string[];
  reopenArchivedParents: boolean;
}>): ScheduleParentActions {
  const existingKeys = new Set(
    existingProjects.map(project => project.trim().toLowerCase()),
  );
  const archivedKeys = new Set(
    archivedProjects.map(project => project.trim().toLowerCase()),
  );

  return {
    missingNames: parentNames.filter(
      name => !existingKeys.has(name.trim().toLowerCase()),
    ),
    reopeningNames: reopenArchivedParents
      ? parentNames.filter(name => archivedKeys.has(name.trim().toLowerCase()))
      : [],
  };
}

export function scheduleProjectScopeNames(
  parentProjectName: string,
  items: ScheduleItem[],
) {
  const normalizedParent = parentProjectName.trim().toLowerCase();
  const childProjects = items
    .filter(item =>
      item.scheduleProjectName?.trim().toLowerCase() === normalizedParent,
    )
    .flatMap(item => [item.projectName.trim(), item.locationName.trim()])
    .filter(projectName => projectName.toLowerCase() !== normalizedParent);

  return uniqueProjectNames([parentProjectName, ...childProjects]);
}

export function scheduleOverviewProjectNames(
  activeProjects: string[],
  items: ScheduleItem[],
) {
  const parentProjects = scheduleParentProjectNames(items);
  const parentKeys = new Set(parentProjects.map(name => name.toLowerCase()));
  const childKeys = new Set(
    items
      .filter(item => item.scheduleProjectName?.trim())
      .flatMap(item => [item.projectName, item.locationName])
      .map(name => name.trim().toLowerCase())
      .filter(Boolean),
  );

  return uniqueProjectNames([
    ...parentProjects,
    ...activeProjects.filter(project => {
      const key = project.trim().toLowerCase();
      return parentKeys.has(key) || !childKeys.has(key);
    }),
  ]);
}
