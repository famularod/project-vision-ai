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
