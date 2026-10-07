import type { DAVEWebReferenceDocument } from './DAVEWebReadOnlyRepository';
import { scheduleDocumentAddsToMaster, scheduleDocumentIsScheduleLike } from './PIEScheduleReconciliation';

export type DAVEWebDocumentGroups = Readonly<{
  currentSchedule: readonly DAVEWebReferenceDocument[];
  priorScheduleVersions: readonly DAVEWebReferenceDocument[];
  otherDocuments: readonly DAVEWebReferenceDocument[];
}>;

/**
 * The documents the web lists (owner answer Q44, 6 Oct 2026): a document the
 * cloud marks archived is hidden on every device and kept in the cloud, so it
 * is left out. `archivedDocumentIds` is the snapshot's; with none (before the
 * owner's database change) every document is listed, as before.
 */
export function daveWebListedDocuments<T extends Readonly<{ id: string }>>(
  documents: readonly T[],
  archivedDocumentIds: readonly string[] | null | undefined,
): readonly T[] {
  if (!archivedDocumentIds?.length) return documents;
  const archived = new Set(archivedDocumentIds);
  return documents.filter(document => !archived.has(document.id));
}

export function groupDAVEWebDocuments(
  documents: readonly DAVEWebReferenceDocument[],
): DAVEWebDocumentGroups {
  const ordered = [...documents].sort(compareDocumentRecency);
  const scheduleDocuments = ordered.filter(scheduleDocumentIsScheduleLike);

  // A lookahead is in effect by its role, whatever its flag (owner answer Q22), until newer ones replace it (Q25).
  const inEffect = daveWebDocumentInEffect;
  return Object.freeze({
    currentSchedule: Object.freeze(scheduleDocuments.filter(inEffect)),
    priorScheduleVersions: Object.freeze(scheduleDocuments.filter(document => !inEffect(document))),
    otherDocuments: Object.freeze(ordered.filter(document => !scheduleDocumentIsScheduleLike(document))),
  });
}

/**
 * A schedule in effect: current, or a lookahead, which is in effect by its
 * role whatever its flag (owner answer Q22) until newer lookaheads replace
 * it for every project it covers (owner answer Q25, 2 Oct 2026: then it is a
 * prior version, "Replaced by the lookahead of <date>").
 */
export function daveWebDocumentInEffect(document: DAVEWebReferenceDocument): boolean {
  return scheduleDocumentAddsToMaster(document) ? !document.lookaheadReplaced : document.isCurrent;
}

export function daveWebDocumentDeletionIsProtected(
  document: DAVEWebReferenceDocument,
): boolean {
  return Boolean(daveWebDocumentInEffect(document) && scheduleDocumentIsScheduleLike(document));
}

function compareDocumentRecency(
  left: DAVEWebReferenceDocument,
  right: DAVEWebReferenceDocument,
) {
  const difference = timestamp(right.importedAt) - timestamp(left.importedAt);
  return difference || left.name.localeCompare(right.name);
}

function timestamp(value: string | null | undefined) {
  const parsed = Date.parse(value || '');
  return Number.isNaN(parsed) ? 0 : parsed;
}
