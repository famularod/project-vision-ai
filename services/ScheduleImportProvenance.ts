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
  return items.filter(item => provenanceBatchId(item) === batchId);
}

export function scheduleImportDocumentOwnsItem(
  document: ReferenceDocument,
  item: ScheduleItem,
): boolean {
  const batchId = provenanceBatchId(document);
  return Boolean(batchId && provenanceBatchId(item) === batchId);
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
