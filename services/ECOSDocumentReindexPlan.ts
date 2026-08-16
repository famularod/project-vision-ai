import type { DAVEWebReferenceDocument } from './DAVEWebReadOnlyRepository';
import { buildECOSDocumentReadiness } from './ECOSDocumentReadiness';
import { scheduleDocumentIsScheduleLike } from './PIEScheduleReconciliation';

const AUTOMATIC_REINDEX_STATUSES = new Set(['stale', 'failed', 'pending']);

export function documentCanBeAutomaticallyReindexed(document: DAVEWebReferenceDocument) {
  if (scheduleDocumentIsScheduleLike(document)) return false;
  if (document.extractionStatus === 'not_supported') return false;
  if (document.ecosHostedIndexStatus && [
    'Waiting', 'Preparing', 'Prepared', 'Prepared with limitations',
    'Ready for ECOS', 'Ready with limitations',
  ].includes(document.ecosHostedIndexStatus)) return false;
  const hasProtectedSource = Boolean(document.storagePath?.trim());
  const hasDriveSource = document.sourceProvider === 'google_drive' && Boolean(document.externalSource);
  const readiness = buildECOSDocumentReadiness(document);
  const incompleteCurrentDrawing = document.isCurrent &&
    document.documentIntelligenceVersion === 'ecos-document-intelligence/2.0' &&
    document.documentVisualIndexVersion === 'ecos-visual-index/3.0' &&
    readiness.sourcePageCount > 0 &&
    readiness.fullVisualCoveragePageCount < readiness.sourcePageCount;
  const automaticReadinessStatus = readiness.status === 'pending'
    ? document.extractionStatus === 'pending' || readiness.searchablePageCount === 0
    : AUTOMATIC_REINDEX_STATUSES.has(readiness.status);
  return (hasProtectedSource || hasDriveSource) &&
    (automaticReadinessStatus || incompleteCurrentDrawing);
}

export function buildECOSDocumentReindexPlan(
  documents: readonly DAVEWebReferenceDocument[],
  selectedProject: string | null = null,
) {
  const projectKey = normalizedProjectName(selectedProject);
  return documents
    .filter(document => !projectKey || documentProjectKeys(document).has(projectKey))
    .filter(documentCanBeAutomaticallyReindexed)
    .sort((left, right) => {
      const currentFirst = Number(right.isCurrent) - Number(left.isCurrent);
      if (currentFirst !== 0) return currentFirst;
      const pageDifference = boundedPageCount(left) - boundedPageCount(right);
      if (pageDifference !== 0) return pageDifference;
      const sizeDifference = boundedSize(left) - boundedSize(right);
      if (sizeDifference !== 0) return sizeDifference;
      return left.name.localeCompare(right.name);
    });
}

function documentProjectKeys(document: DAVEWebReferenceDocument) {
  return new Set([
    document.projectName,
    ...(document.projectNames || []),
  ].map(normalizedProjectName).filter(Boolean));
}

function normalizedProjectName(value: string | null | undefined) {
  return (value || '').trim().toLocaleLowerCase();
}

function boundedPageCount(document: DAVEWebReferenceDocument) {
  const pageCount = Number(document.sourcePageCount);
  return Number.isFinite(pageCount) && pageCount > 0 ? pageCount : Number.MAX_SAFE_INTEGER;
}

function boundedSize(document: DAVEWebReferenceDocument) {
  const size = Number(document.sizeBytes ?? document.externalSource?.sizeBytes);
  return Number.isFinite(size) && size >= 0 ? size : Number.MAX_SAFE_INTEGER;
}
