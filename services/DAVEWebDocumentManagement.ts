import type { DAVEWebReferenceDocument } from './DAVEWebReadOnlyRepository';
import { scheduleDocumentIsScheduleLike } from './PIEScheduleReconciliation';

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

  return Object.freeze({
    currentSchedule: Object.freeze(scheduleDocuments.filter(document => document.isCurrent)),
    priorScheduleVersions: Object.freeze(scheduleDocuments.filter(document => !document.isCurrent)),
    otherDocuments: Object.freeze(ordered.filter(document => !scheduleDocumentIsScheduleLike(document))),
  });
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
