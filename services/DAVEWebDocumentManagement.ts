import type { DAVEWebReferenceDocument } from './DAVEWebReadOnlyRepository';
import { scheduleDocumentAddsToMaster, scheduleDocumentIsScheduleLike } from './PIEScheduleReconciliation';

export type DAVEWebDocumentGroups = Readonly<{
  currentSchedule: readonly DAVEWebReferenceDocument[];
  priorScheduleVersions: readonly DAVEWebReferenceDocument[];
  otherDocuments: readonly DAVEWebReferenceDocument[];
}>;

export function groupDAVEWebDocuments(
  documents: readonly DAVEWebReferenceDocument[],
): DAVEWebDocumentGroups {
  const ordered = [...documents].sort(compareDocumentRecency);
  const scheduleDocuments = ordered.filter(scheduleDocumentIsScheduleLike);

  // A lookahead is in effect by its role, whatever its flag (owner answer Q22).
  const inEffect = (document: DAVEWebReferenceDocument) => document.isCurrent || scheduleDocumentAddsToMaster(document);
  return Object.freeze({
    currentSchedule: Object.freeze(scheduleDocuments.filter(inEffect)),
    priorScheduleVersions: Object.freeze(scheduleDocuments.filter(document => !inEffect(document))),
    otherDocuments: Object.freeze(ordered.filter(document => !scheduleDocumentIsScheduleLike(document))),
  });
}

export function daveWebDocumentDeletionIsProtected(
  document: DAVEWebReferenceDocument,
): boolean {
  return Boolean((document.isCurrent || scheduleDocumentAddsToMaster(document)) && scheduleDocumentIsScheduleLike(document));
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
