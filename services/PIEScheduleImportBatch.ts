import type { ReferenceDocument, ScheduleItem } from '../types';
import { scheduleItemNeedsCompletionVerification } from './DAVECompletionVerification';
import {
  SCHEDULE_IMPORT_NEEDS_PROJECT,
  scheduleImportDateWarnings,
} from './ScheduleImportScopeGuard';
import { scheduleDatesToCheck } from './ScheduleInputLimits';
import { scheduleProjectScopeKey } from './PIEScheduleReconciliation';
import {
  bindScheduleImportBatch,
  scheduleItemsForExactImportBatch,
  scheduleItemsOfUnbatchedDocument,
  scheduleItemsOnlyInImportBatch,
} from './ScheduleImportProvenance';

export { scheduleItemsForExactImportBatch, scheduleItemsOfUnbatchedDocument, scheduleItemsOnlyInImportBatch };

export type PIEScheduleImportKind = 'schedule_file' | 'message_screenshots';

export type PIEScheduleImportBatch = {
  id: string;
  kind: PIEScheduleImportKind;
  sourceCount: number;
  sourceLabel: string;
  message: string;
  items: ScheduleItem[];
  documents: ReferenceDocument[];
  warnings?: string[];
  /**
   * David's answers at review to which saved task each same-named row is
   * (owner answer Q30, 2 Oct 2026): an imported row's id to the saved task's
   * id, or null for a new task (scheduleImportPairingQuestions).
   */
  pairingChoices?: Readonly<Record<string, string | null>> | null;
  /**
   * Open item 2.45: for each task the project check left waiting ("Needs Project"), by its id, the project name the
   * FILE gives it ('' for a blank Project cell), so its card can say so. Absent when no task waits (or the road does
   * not know the file's names: screenshots), and the cards read as before.
   */
  fileProjectNames?: Readonly<Record<string, string>>;
  /**
   * Open item 5.26: no task could be read from the PDF (no signal, or the service could not read it), so the review
   * holds one blank row. From a project's Documents the PDF is then kept as a card first, as any document added there.
   */
  nothingRead?: boolean;
};

/**
 * Open item 2.45: what a review card lists as a task's project. A task waiting for one says the name the file gives
 * it, in the computer's words (DAVEWebOperations' daveWebScheduleUploadRowProject), or that the file gives none; any
 * other task, or one the batch has no file name for, is listed as before.
 */
export function scheduleImportCardProject(batch: Pick<PIEScheduleImportBatch, 'fileProjectNames'> | null, item: Pick<ScheduleItem, 'id' | 'projectName'>): string {
  const named = batch?.fileProjectNames?.[item.id];
  if (named === undefined || (item.projectName || '').trim() !== SCHEDULE_IMPORT_NEEDS_PROJECT) return item.projectName;
  return named ? `${SCHEDULE_IMPORT_NEEDS_PROJECT} (the file names "${named}")` : `${SCHEDULE_IMPORT_NEEDS_PROJECT} (the file names no project)`;
}

/** Open item 2.45: under an opened card's Project box, while he types, the name the file gave the task; else null. */
export function scheduleImportCardFileProjectNote(batch: Pick<PIEScheduleImportBatch, 'fileProjectNames'> | null, item: Pick<ScheduleItem, 'id'>): string | null {
  const named = batch?.fileProjectNames?.[item.id];
  if (named === undefined) return null;
  return named ? `The file names "${named}".` : 'The file names no project.';
}

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

/**
 * 'date check': the row has its dates, but one names a real day outside 2000
 * through 2100, nearly always a mistyped year (review pass 1, L3). Like a
 * missing area or owner it marks the row for a look and does not stop the
 * import (scheduleImportItemHasCoreFacts does not ask about it).
 */
export type PIEScheduleImportReviewField =
  | 'task'
  | 'project'
  | 'area'
  | 'date'
  | 'date check'
  | 'owner';

export function scheduleImportReviewFields(
  item: ScheduleItem,
): PIEScheduleImportReviewField[] {
  const completionVerification = scheduleItemNeedsCompletionVerification(item);
  const hasDateDefect = scheduleImportDateWarnings(item).length > 0;
  const needsDate = hasDateDefect || (!completionVerification && !item.finishDate.trim());

  return [
    !item.taskName.trim() ? 'task' : null,
    !item.projectName.trim() ||
      item.projectName.trim() === SCHEDULE_IMPORT_NEEDS_PROJECT ? 'project' : null,
    !item.locationName.trim() ? 'area' : null,
    needsDate ? 'date' : null,
    !needsDate && scheduleDatesToCheck(item).length > 0 ? 'date check' : null,
    !item.owner.trim() ? 'owner' : null,
  ].filter(Boolean) as PIEScheduleImportReviewField[];
}

export function scheduleImportItemIsReady(item: ScheduleItem) {
  return scheduleImportReviewFields(item).length === 0;
}

export function scheduleImportItemHasCoreFacts(item: ScheduleItem) {
  if (
    !item.taskName.trim() ||
    !item.projectName.trim() ||
    item.projectName.trim() === SCHEDULE_IMPORT_NEEDS_PROJECT ||
    scheduleImportDateWarnings(item).length > 0
  ) {
    return false;
  }

  return Boolean(
    item.finishDate.trim() || scheduleItemNeedsCompletionVerification(item),
  );
}

export function scheduleImportItemIdentity(item: ScheduleItem) {
  return [
    item.taskName,
    item.finishDate,
    item.projectName,
    item.locationName,
    item.sourceActivityId,
    item.sourceWbsCode || item.wbsCode,
    item.sourceRowNumber,
  ]
    .map(value => (
      typeof value === 'number'
        ? Number.isFinite(value) ? String(Math.trunc(value)) : ''
        : (value || '').trim().toLowerCase().replace(/\s+/g, ' ')
    ))
    .join('|');
}

/**
 * A task the file gives twice (the same task, finish date, project, area and row) is listed once.
 * Open item 2.36 (review pass 1 H1S-1 on the phone; H2b's rule on the desktop): `waitingFileProjectNames` holds, for
 * each row the project check left waiting ("Needs Project"), the project name the FILE gives it (null for a row given
 * one of his projects). Such a row is compared by that name, so "Safety walk" on one day for "6101" and for "6102",
 * two names the app does not know, stays two rows; one name twice ("6101" and "6101", or "Shed Annex" and
 * "Shed-Annex" by scheduleProjectScopeKey) is still one row. A row given his project is compared by the project.
 */
export function dedupeScheduleImportItems(
  items: ScheduleItem[],
  waitingFileProjectNames?: readonly (string | null | undefined)[],
) {
  const seen = new Set<string>();

  return items.filter((item, index) => {
    const fileName = waitingFileProjectNames?.[index];
    const identity = scheduleImportItemIdentity(typeof fileName === 'string'
      ? { ...item, projectName: `${SCHEDULE_IMPORT_NEEDS_PROJECT}|${scheduleProjectScopeKey(fileName)}` }
      : item);
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
    // An archived parent is known, not missing: creating it made an active
    // copy of an archived project (whole-app audit A3 pass 2).
    missingNames: parentNames.filter(name => {
      const key = name.trim().toLowerCase();
      return !existingKeys.has(key) && !archivedKeys.has(key);
    }),
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
  // An archived project stays archived even when its schedule tasks still
  // name it as their parent; without this it came back as an active card.
  archivedProjects: readonly string[] = [],
) {
  const archivedKeys = new Set(archivedProjects.map(name => name.trim().toLowerCase()));
  const parentProjects = scheduleParentProjectNames(items)
    .filter(name => !archivedKeys.has(name.trim().toLowerCase()));
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
