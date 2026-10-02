import type { ReferenceDocument, ScheduleItem } from '../types';

export type ScheduleImportProvenance = Readonly<{
  importBatchId: string;
  sourceDocumentId: string | null;
}>;

type ProvenancedScheduleItem = ScheduleItem & Partial<ScheduleImportProvenance>;
type ProvenancedReferenceDocument = ReferenceDocument & Pick<ScheduleImportProvenance, 'importBatchId'>;

export function bindScheduleImportBatch({
  importBatchId,
  items,
  documents,
}: {
  importBatchId: string;
  items: readonly ScheduleItem[];
  documents: readonly ReferenceDocument[];
}): {
  items: ProvenancedScheduleItem[];
  documents: ProvenancedReferenceDocument[];
} {
  const batchId = importBatchId.trim();
  if (!batchId) throw new Error('Schedule import requires an immutable batch ID.');

  const boundDocuments = documents.map(document => ({
    ...document,
    importBatchId: batchId,
  }));

  return {
    documents: boundDocuments,
    items: items.map(item => ({
      ...item,
      importBatchId: batchId,
      sourceDocumentId: exactSourceDocumentId(item, boundDocuments),
    })),
  };
}

export function scheduleItemsForExactImportBatch(
  items: readonly ScheduleItem[],
  document: ReferenceDocument,
): ScheduleItem[] {
  const batchId = provenanceBatchId(document);
  if (!batchId) return [];
  return items.filter(item => scheduleItemImportBatchIds(item).includes(batchId));
}

/**
 * The task with every later import either copy says it belongs to, the union
 * the merge of two copies keeps. "Keep Phone" on a task conflict uploaded the
 * phone's copy verbatim, dropping a revision another device had re-homed the
 * task into, so the task disappeared everywhere while that revision was
 * current (whole-app audit A5 pass 3 F6 (30 Sep 2026)). The same object when
 * the other copy adds nothing.
 */
export function withScheduleImportMembershipOf(
  item: ScheduleItem,
  other: Pick<ScheduleItem, 'alsoImportedInBatchIds' | 'alsoImportedSourceRow' | 'importBatchId'> | null | undefined,
): ScheduleItem {
  const own = item.alsoImportedInBatchIds || [];
  const added = (other?.alsoImportedInBatchIds || []).filter(batchId => !own.includes(batchId));
  const row = laterScheduleImportSourceRow(item, other);
  if (added.length === 0 && row === item.alsoImportedSourceRow) return item;
  return {
    ...item,
    ...(added.length > 0 ? { alsoImportedInBatchIds: [...new Set([...own, ...added])] } : {}),
    ...(row ? { alsoImportedSourceRow: row } : {}),
  };
}

/**
 * The row number the task's latest import gave it (alsoImportedSourceRow,
 * A5 pass 19 L4), of two copies: the one from an import the other copy does
 * not know, or the only one (whole-app audit A7 pass 22 L-3: Full Sync wrote
 * a device's copy from before the revision without it, and at the next
 * Microsoft Project revision the twins swapped David's percents).
 */
export function laterScheduleImportSourceRow(
  item: Pick<ScheduleItem, 'alsoImportedInBatchIds' | 'alsoImportedSourceRow' | 'importBatchId'>,
  other: Pick<ScheduleItem, 'alsoImportedInBatchIds' | 'alsoImportedSourceRow' | 'importBatchId'> | null | undefined,
): ScheduleItem['alsoImportedSourceRow'] {
  const own = item.alsoImportedSourceRow;
  const theirs = other?.alsoImportedSourceRow;
  if (!theirs || own?.importBatchId === theirs.importBatchId) return own;
  if (!own) return theirs;
  const knows = (copy: typeof item, batchId: string) => scheduleItemImportBatchIds(copy as ScheduleItem).includes(batchId);
  return knows(item, theirs.importBatchId) || !knows(other!, own.importBatchId) ? own : theirs;
}

/**
 * The batches an imported task belongs to: its own import, then any later
 * import it was found unchanged in.
 */
export function scheduleItemImportBatchIds(item: ScheduleItem): string[] {
  return [item.importBatchId, ...(item.alsoImportedInBatchIds || [])]
    .map(value => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean);
}

/**
 * The tasks deleting this schedule document takes: those no other schedule
 * document still contains. A task unchanged across revisions belongs to each
 * of them and stays with the others (whole-app audit A5 pass 2: "Delete PDF
 * + Items" on a revision deleted the unchanged tasks carried from the
 * previous one, on every device).
 */
export function scheduleItemsOnlyInImportBatch(
  items: readonly ScheduleItem[],
  document: ReferenceDocument,
  documents: readonly ReferenceDocument[],
): ScheduleItem[] {
  const batchId = provenanceBatchId(document);
  if (!batchId) return [];
  const otherBatchIds = new Set(documents
    .filter(candidate => candidate.id !== document.id)
    .map(provenanceBatchId)
    .filter((value): value is string => Boolean(value) && value !== batchId));
  return items.filter(item => {
    const batches = scheduleItemImportBatchIds(item);
    return batches.includes(batchId) && !batches.some(batch => otherBatchIds.has(batch));
  });
}

/**
 * The tasks deleting a schedule document with no import batch takes: those
 * naming it as their source and, by file name, only tasks with no import
 * batch or source of their own. The phone's upload of a schedule PDF is such
 * a document, and "Import This Schedule" records the same file name on every
 * imported task, so "Delete PDF + Items" on the upload copy deleted the
 * imported schedule's tasks on every device (whole-app audit A8 pass 2 #1
 * (30 Sep 2026)).
 */
export function scheduleItemsOfUnbatchedDocument(
  items: readonly ScheduleItem[],
  document: ReferenceDocument,
): ScheduleItem[] {
  return items.filter(item => {
    const sourceDocumentId = item.sourceDocumentId?.trim();
    if (sourceDocumentId) return sourceDocumentId === document.id;
    if (scheduleItemImportBatchIds(item).length > 0) return false;
    return Boolean(item.importedFrom) &&
      (item.importedFrom === document.originalFileName || item.importedFrom === document.name);
  });
}

export function scheduleImportDocumentOwnsItem(
  document: ReferenceDocument,
  item: ScheduleItem,
): boolean {
  const batchId = provenanceBatchId(document);
  return Boolean(batchId && scheduleItemImportBatchIds(item).includes(batchId));
}

function exactSourceDocumentId(
  item: ScheduleItem,
  documents: readonly ReferenceDocument[],
): string | null {
  if (documents.length === 1) return documents[0].id;
  const sourceName = item.importedFrom?.trim().toLocaleLowerCase() || '';
  if (!sourceName) return null;
  const matches = documents.filter(document =>
    [document.originalFileName, document.name]
      .map(value => value.trim().toLocaleLowerCase())
      .includes(sourceName),
  );
  return matches.length === 1 ? matches[0].id : null;
}

function provenanceBatchId(value: ScheduleItem | ReferenceDocument): string | null {
  const candidate = (value as ScheduleItem & ReferenceDocument & Partial<ScheduleImportProvenance>)
    .importBatchId;
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null;
}

/**
 * Owner answer Q25 (2 Oct 2026), with the reviewers' A10 pass 3 L1: a
 * lookahead's detail tasks (those it added, which no master lists) are
 * listed, but the master sets the project's scope, so they do not change its
 * % Complete: adding detail never makes the project look less done.
 *
 * A task is such detail when a lookahead added it (importedAsLookahead) and
 * every import it belongs to is a lookahead: known by the notes of the tasks
 * lookaheads restated and by the tasks they added (as the merge knows them,
 * A6 pass 19 M2). A master that lists it later makes it the master's. Given
 * the tasks of the projects measured; returns those that set the scope, or
 * every task when none does (a project with lookaheads only).
 */
export function scheduleTasksSettingProjectScope<T extends ScheduleItem>(items: readonly T[]): T[] {
  const detail = scheduleTaskAddedByLookaheadsOnly(items);
  const scope = items.filter(item => !detail(item));
  return scope.length > 0 ? scope : [...items];
}

/** Whether a task is a lookahead's detail (scheduleTasksSettingProjectScope), given the tasks it is measured with. */
export function scheduleTaskAddedByLookaheadsOnly(items: readonly ScheduleItem[]): (item: ScheduleItem) => boolean {
  const batchKey = (value: unknown) => (typeof value === 'string' ? value.trim().toLowerCase() : '');
  const lookaheads = new Set([
    ...items.flatMap(item => (Array.isArray(item.lookaheadOverlay?.lookaheads) ? item.lookaheadOverlay!.lookaheads : [])
      .map(entry => batchKey(entry?.batchId))),
    ...items.filter(item => item.importedAsLookahead === true).map(item => batchKey(item.importBatchId)),
  ].filter(Boolean));
  return item => {
    if (item.importedAsLookahead !== true) return false;
    const imports = scheduleItemImportBatchIds(item).map(batchKey).filter(Boolean);
    return imports.length > 0 && imports.every(batch => lookaheads.has(batch));
  };
}
