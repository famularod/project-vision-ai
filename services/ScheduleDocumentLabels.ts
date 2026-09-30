import type { ReferenceDocument, ScheduleItem } from '../types';
import { scheduleItemImportBatchIds } from './ScheduleImportProvenance';

/**
 * Which projects a schedule document speaks for (whole-app audit A5 pass 2,
 * 30 Sep 2026). A document was labelled with every project the import could
 * have used, so two projects' schedules imported from the Schedule screen
 * each claimed both projects, and the newer one hid the other project's
 * tasks everywhere. A document is now labelled with the projects its
 * approved rows belong to.
 */
export function scheduleRowProjectNames(items: readonly ScheduleItem[]): string[] {
  const names = new Map<string, string>();
  items.forEach(item => {
    const name = (item.scheduleProjectName || item.projectName || '').trim();
    if (name && !names.has(name.toLowerCase())) names.set(name.toLowerCase(), name);
  });
  return [...names.values()];
}

/**
 * The documents after an approval. This import's documents take the
 * approved rows' projects; an Accept Selected approval that brings no
 * document widens the saved document of the same import to its rows'
 * projects. No other document is demoted: each project picks its own current
 * schedule (currentScheduleDocumentsByProject). A single project is named on
 * the document without a project id: a name slug there was refused by the
 * cloud's project check and the document never synced (A7 pass 3).
 */
export function scheduleDocumentsAfterApproval<T extends ReferenceDocument>({
  documents,
  approvedDocuments,
  approvedItems,
  updatedAt,
}: Readonly<{
  documents: readonly T[];
  approvedDocuments: readonly T[];
  approvedItems: readonly ScheduleItem[];
  updatedAt: string;
}>): T[] {
  const rowProjects = scheduleRowProjectNames(approvedItems);
  const approvedIds = new Set(approvedDocuments.map(document => document.id));
  const labelled = approvedDocuments.map(document =>
    withProjects(document, rowProjects.length > 0 ? rowProjects : document.projectNames || [], updatedAt));
  const approvedBatchIds = new Set(approvedItems.flatMap(scheduleItemImportBatchIds).map(key));
  const existing = documents
    .filter(document => !approvedIds.has(document.id))
    .map(document => {
      if (approvedDocuments.length > 0 || !approvedBatchIds.has(key(document.importBatchId))) return document;
      const union = mergeNames(document.projectNames || [], rowProjects);
      return union.length === (document.projectNames || []).length ? document : withProjects(document, union, updatedAt);
    });
  return [...labelled, ...existing];
}

/**
 * A one-time repair for documents saved before the rule above: a schedule
 * document labelled with projects none of its rows belong to is narrowed to
 * its rows' projects. A document with no rows, or whose rows cover its whole
 * label, is left as it is.
 */
export function narrowScheduleDocumentLabels<T extends ReferenceDocument>(
  documents: readonly T[],
  items: readonly ScheduleItem[],
  updatedAt: string,
): { documents: T[]; changed: T[] } {
  const changed: T[] = [];
  const next = documents.map(document => {
    const batchId = key(document.importBatchId);
    const label = document.projectNames || [];
    if (!batchId || label.length < 2) return document;
    const rows = items.filter(item => scheduleItemImportBatchIds(item).map(key).includes(batchId));
    const rowProjects = scheduleRowProjectNames(rows);
    if (rowProjects.length === 0) return document;
    const rowKeys = new Set(rowProjects.map(key));
    const narrowed = label.filter(name => rowKeys.has(key(name)));
    if (narrowed.length === 0 || narrowed.length === label.length) return document;
    const repaired = withProjects(document, narrowed, updatedAt);
    changed.push(repaired);
    return repaired;
  });
  return { documents: next, changed };
}

function withProjects<T extends ReferenceDocument>(document: T, projectNames: readonly string[], updatedAt: string): T {
  const names = mergeNames([], projectNames);
  return {
    ...document,
    projectNames: names,
    projectName: names.length === 1 ? names[0] : null,
    projectId: null,
    updatedAt,
  };
}

function mergeNames(base: readonly string[], extra: readonly string[]): string[] {
  const names = new Map<string, string>();
  [...base, ...extra].forEach(name => {
    const trimmed = name.trim();
    if (trimmed && !names.has(trimmed.toLowerCase())) names.set(trimmed.toLowerCase(), trimmed);
  });
  return [...names.values()];
}

function key(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase();
}
