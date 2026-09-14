import type { ReferenceDocument } from '../types';
import { canonicalReferenceCategory } from './AuthoritativeDocumentSystem';
import type { ECOSDocumentCoverageSummary } from './ECOSDocumentCoverageSummary';
import { hasCompleteECOSDrawingVisualCoverage } from './ECOSDrawingVisualCoverage';

export type ECOSDocumentReadinessStatus =
  | 'ready'
  | 'ready_with_limitations'
  | 'not_current'
  | 'needs_metadata'
  | 'pending'
  | 'stale'
  | 'failed'
  | 'not_supported';

export type ECOSDocumentReadiness = Readonly<{
  status: ECOSDocumentReadinessStatus;
  label: string;
  detail: string;
  eligibleForAnswers: boolean;
  canMakeCurrent: boolean;
  sourcePageCount: number;
  indexedPageCount: number;
  searchablePageCount: number;
  pageCoveragePercent: number;
  verifiedSheetPageCount: number;
  conflictedSheetPageCount: number;
  fullVisualCoveragePageCount: number;
  averageConfidence: number | null;
  missingMetadata: readonly string[];
  limitations: readonly string[];
}>;

export function buildECOSDocumentReadiness(
  document: ReferenceDocument,
  cloudSummary: ECOSDocumentCoverageSummary | null = null,
): ECOSDocumentReadiness {
  const pages = document.extractedPages ?? [];
  const declaredSourcePageCount = positiveInteger(document.sourcePageCount);
  const isDrawing = canonicalReferenceCategory(document) === 'drawing';
  const extractionStatus = document.extractionStatus ?? 'pending';
  // Version labels alone cannot prove completion because older partial indexes
  // also used 2.0/3.0. Trust compact cloud metadata only when the database
  // commit trigger bound an exact source hash and page count to it.
  const hasCommittedCloudDrawingIndex = isDrawing &&
    pages.length === 0 &&
    extractionStatus === 'complete' &&
    document.documentIntelligenceVersion === 'ecos-document-intelligence/2.0' &&
    document.documentVisualIndexVersion === 'ecos-visual-index/3.0' &&
    document.ecosVerifiedIndexCommitVersion === 'ecos-verified-index-commit/1.0' &&
    declaredSourcePageCount > 0 &&
    positiveInteger(document.searchablePageCount) === declaredSourcePageCount &&
    positiveInteger(document.ecosVerifiedIndexCommittedPageCount) === declaredSourcePageCount &&
    canonicalSha256(document.ecosVerifiedIndexCommittedSha256) != null &&
    canonicalSha256(document.ecosVerifiedIndexCommittedSha256) ===
      canonicalSha256(document.indexedContentSha256);
  const indexedPageCount = pages.length ||
    positiveInteger(cloudSummary?.indexedPageCount) ||
    (hasCommittedCloudDrawingIndex ? declaredSourcePageCount : 0);
  const inferredSearchablePages = pages.filter(page =>
    clean(page.text) || (page.regions ?? []).some(region => clean(region.text || region.label)),
  ).length;
  const sourcePageCount = declaredSourcePageCount || indexedPageCount;
  const searchablePageCount = Math.min(
    sourcePageCount || Number.MAX_SAFE_INTEGER,
    positiveInteger(document.searchablePageCount) || inferredSearchablePages,
  );
  const pageCoveragePercent = sourcePageCount > 0
    ? Math.round((searchablePageCount / sourcePageCount) * 100)
    : 0;
  const verifiedSheetPageCount = isDrawing
    ? pages.length > 0
      ? pages.filter(page => page.sheetMappingStatus === 'verified' && clean(page.sheetNumber)).length
      : boundedSummaryCount(cloudSummary?.verifiedSheetPageCount, indexedPageCount)
    : 0;
  const conflictedSheetPageCount = isDrawing
    ? pages.length > 0
      ? pages.filter(page => page.sheetMappingStatus === 'conflicted').length
      : boundedSummaryCount(cloudSummary?.conflictedSheetPageCount, indexedPageCount)
    : 0;
  const fullVisualCoveragePageCount = isDrawing
    ? pages.length > 0
      ? pages.filter(hasCompleteECOSDrawingVisualCoverage).length
      : cloudSummary
        ? boundedSummaryCount(cloudSummary.fullVisualCoveragePageCount, indexedPageCount)
        : hasCommittedCloudDrawingIndex
          ? sourcePageCount
          : 0
    : 0;
  const averageConfidence = normalizedConfidence(document.extractionAverageConfidence) ??
    averageRegionConfidence(document);
  const missingMetadata = requiredMetadata(document);
  const hostedStatus = document.ecosHostedIndexStatus;
  const hostedHasLimitations = hostedStatus === 'Prepared with limitations' ||
    hostedStatus === 'Ready with limitations';
  const hostedLimitationDetail = clean(document.ecosHostedIndexCustomerMessage) ||
    hostedLimitationMessage(document.ecosHostedIndexLimitationCount);
  const hostedPreparationPassed = hostedStatus === 'Prepared' ||
    hostedStatus === 'Prepared with limitations' ||
    hostedStatus === 'Ready for ECOS' ||
    hostedStatus === 'Ready with limitations';
  const limitations = unique([
    ...(document.extractionLimitations ?? []).map(clean).filter(Boolean),
    ...(hostedHasLimitations
      ? [hostedLimitationDetail]
      : []),
    ...(sourcePageCount > searchablePageCount
      ? [`${sourcePageCount - searchablePageCount} source page${sourcePageCount - searchablePageCount === 1 ? '' : 's'} could not be searched.`]
      : []),
    ...(isDrawing && conflictedSheetPageCount > 0
      ? [`${conflictedSheetPageCount} drawing page${conflictedSheetPageCount === 1 ? ' has' : 's have'} conflicting sheet identity evidence. ECOS will cite the PDF page only.`]
      : []),
    ...(isDrawing && indexedPageCount > fullVisualCoveragePageCount
      ? [`${indexedPageCount - fullVisualCoveragePageCount} drawing page${indexedPageCount - fullVisualCoveragePageCount === 1 ? ' does' : 's do'} not have complete high-resolution visual tile coverage.`]
      : []),
  ]);
  const stale = Boolean(
    canonicalSha256(document.contentSha256) &&
    canonicalSha256(document.indexedContentSha256) &&
    canonicalSha256(document.contentSha256) !== canonicalSha256(document.indexedContentSha256),
  );
  const staleDrawingIndex = isDrawing &&
    (document.documentIntelligenceVersion !== 'ecos-document-intelligence/2.0' ||
      document.documentVisualIndexVersion !== 'ecos-visual-index/3.0');
  const hasCompleteDrawingVisualCoverage = !isDrawing || (
    sourcePageCount > 0 &&
    indexedPageCount === sourcePageCount &&
    fullVisualCoveragePageCount === sourcePageCount
  );
  const hasSearchableEvidence = searchablePageCount > 0;
  const hasCompleteSearchableCoverage = sourcePageCount > 0 &&
    searchablePageCount === sourcePageCount;
  const hasTrustedSearchableCoverage = hasCompleteSearchableCoverage && (
    pages.length > 0 || hasCommittedCloudDrawingIndex
  );
  const canMakeCurrent = missingMetadata.length === 0 && (
    (hostedPreparationPassed && !document.isCurrent) || (
      hasSearchableEvidence &&
      hasCompleteDrawingVisualCoverage &&
      !stale &&
      !staleDrawingIndex &&
      extractionStatus !== 'failed' &&
      extractionStatus !== 'not_supported'
    )
  );

  const base = {
    canMakeCurrent,
    sourcePageCount,
    indexedPageCount,
    searchablePageCount,
    pageCoveragePercent,
    verifiedSheetPageCount,
    conflictedSheetPageCount,
    fullVisualCoveragePageCount,
    averageConfidence,
    missingMetadata,
    limitations,
  };

  if (missingMetadata.length > 0) {
    return readiness(base, 'needs_metadata', 'Needs Review',
      `Add ${humanList(missingMetadata)} before ECOS can use this source.`, false);
  }
  if (hostedPreparationPassed && !document.isCurrent) {
    return readiness(
      base,
      'not_current',
      hostedHasLimitations ? 'Prepared with limitations — not current' : 'Prepared — not current',
      hostedHasLimitations
        ? `${hostedLimitationDetail} Make this exact revision current before Ask ECOS can use its verified evidence.`
        : 'Background preparation passed ECOS Assurance. Make this exact revision current before Ask ECOS can use it.',
      false,
    );
  }
  if (hostedStatus === 'Ready with limitations' && document.isCurrent) {
    return readiness(base, 'ready_with_limitations', 'Ready with limitations',
      hostedLimitationDetail, true);
  }
  if (hostedStatus === 'Ready for ECOS' && document.isCurrent) {
    return readiness(base, 'ready', 'Ready for ECOS',
      'The hosted index matches this current project revision and passed ECOS Assurance.', true);
  }
  if (hostedStatus === 'Prepared' && document.isCurrent) {
    return readiness(base, 'pending', 'Activating for ECOS',
      'This revision is prepared, but the hosted source has not yet been confirmed as the active current evidence source.', false);
  }
  if (hostedStatus === 'Prepared with limitations' && document.isCurrent) {
    return readiness(base, 'pending', 'Activating for ECOS',
      'This revision passed Assurance with review limitations, but the hosted source has not yet been confirmed as the active current evidence source.', false);
  }
  if (stale || staleDrawingIndex) {
    return readiness(base, 'stale', 'Preparing for ECOS',
      staleDrawingIndex
        ? 'This drawing uses an older index. Vitruvius will prepare it with the current evidence and assurance process before ECOS uses it.'
        : 'The searchable index does not match the current source file.', false);
  }
  if (extractionStatus === 'failed') {
    return readiness(base, 'failed', 'Needs Review',
      limitations[0] || 'No searchable document index could be created.', false);
  }
  if (extractionStatus === 'not_supported') {
    return readiness(base, 'not_supported', 'Needs Review',
      limitations[0] || 'This file is stored but cannot be searched by ECOS.', false);
  }
  if (!hasSearchableEvidence || extractionStatus === 'pending') {
    return readiness(base, 'pending', 'Preparing for ECOS',
      'Create or retry the searchable page index before making this source current.', false);
  }
  if (isDrawing && !hasCompleteDrawingVisualCoverage) {
    if (document.isCurrent && hasTrustedSearchableCoverage) {
      return readiness(base, 'ready_with_limitations', 'Ready with visual limitations',
        `${searchablePageCount} of ${sourcePageCount} pages are searchable and available to Ask ECOS. High-resolution visual analysis is complete for ${fullVisualCoveragePageCount} of ${sourcePageCount} pages, so questions that depend only on unindexed visual details may remain limited.`, true);
    }
    return readiness(base, 'pending', 'Preparing for ECOS',
      `${fullVisualCoveragePageCount} of ${sourcePageCount || indexedPageCount} drawing pages have complete high-resolution visual coverage. Searchable evidence remains unavailable until every source page is indexed.`, false);
  }
  if (!document.isCurrent) {
    return readiness(base, 'not_current', 'Indexed — not current',
      `${searchablePageCount} of ${sourcePageCount || indexedPageCount} pages are searchable. Make this revision current before ECOS uses it.`, false);
  }
  if (
    extractionStatus === 'partial' ||
    pageCoveragePercent < 100 ||
    limitations.length > 0 ||
    (averageConfidence != null && averageConfidence < 0.82) ||
    (isDrawing && conflictedSheetPageCount > 0)
  ) {
    return readiness(base, 'ready_with_limitations', 'Needs Review',
      `${searchablePageCount} of ${sourcePageCount || indexedPageCount} pages are searchable. Review the listed limitations.`, true);
  }
  return readiness(base, 'ready', 'Ready for ECOS',
    isDrawing
      ? `All ${sourcePageCount || indexedPageCount} pages are searchable with complete high-resolution visual coverage. ${verifiedSheetPageCount} page${verifiedSheetPageCount === 1 ? ' has' : 's have'} verified sheet identity.`
      : `All ${sourcePageCount || indexedPageCount} pages are searchable and tied to this source revision.`, true);
}

function hostedLimitationMessage(value: unknown) {
  const count = typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 1;
  return `${count} accepted page${count === 1 ? '' : 's'} passed ECOS Assurance with review limitations.`;
}

export function isECOSDocumentEligibleForAnswers(document: ReferenceDocument) {
  return buildECOSDocumentReadiness(document).eligibleForAnswers;
}

function readiness(
  base: Omit<ECOSDocumentReadiness, 'status' | 'label' | 'detail' | 'eligibleForAnswers'>,
  status: ECOSDocumentReadinessStatus,
  label: string,
  detail: string,
  eligibleForAnswers: boolean,
): ECOSDocumentReadiness {
  return Object.freeze({ ...base, status, label, detail, eligibleForAnswers });
}

function requiredMetadata(document: ReferenceDocument) {
  const missing: string[] = [];
  const hasProject = clean(document.projectId) || clean(document.projectName) ||
    (document.projectNames ?? []).some(name => clean(name));
  if (!hasProject) missing.push('a project assignment');
  if (canonicalReferenceCategory(document) === 'drawing') {
    if (!clean(document.drawingNumber)) missing.push('the drawing number');
    if (!clean(document.drawingRevision)) missing.push('the revision');
    if (!clean(document.drawingStatus)) missing.push('the issue status');
    if (document.drawingStatus === 'Superseded') missing.push('an issue status other than Superseded');
  }
  return missing;
}

function averageRegionConfidence(document: ReferenceDocument) {
  const values = (document.extractedPages ?? []).flatMap(page =>
    (page.regions ?? []).map(region => normalizedConfidence(region.confidence)).filter(
      (value): value is number => value != null,
    ),
  );
  if (values.length === 0) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10_000) / 10_000;
}

function normalizedConfidence(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : null;
}

function positiveInteger(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function boundedSummaryCount(value: unknown, indexedPageCount: number) {
  const parsed = positiveInteger(value);
  return Math.min(indexedPageCount, parsed);
}

function canonicalSha256(value: unknown) {
  const normalized = clean(value).toLowerCase();
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

function humanList(items: readonly string[]) {
  if (items.length <= 1) return items[0] || 'the required details';
  return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`;
}

function unique(items: readonly string[]) {
  return [...new Set(items)];
}

function clean(value: unknown) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}
