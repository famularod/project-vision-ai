import * as FileSystem from 'expo-file-system/legacy';
import type {
  ReferenceDocument,
  ReferenceDocumentExtractedPage,
  ReferenceDocumentRegionEvidence,
} from '../types';
import { withNormalizedECOSSheetProvenance } from './ECOSSheetProvenance';
import { createProjectId } from './ProjectIdentity';
import { reconcileCurrentScheduleDocuments } from './PIEScheduleReconciliation';
import { isStartupReferenceDocumentRecord } from './StartupRecordValidation';
import { uploadPhoto } from './SupabaseService';
import {
  hashExpoFileSha256,
  MAX_PROJECT_DOCUMENT_FILE_BYTES,
  preflightExpoFileRead,
} from './FileSizePreflight';
import {
  isLegacyOwnedLocalFileReadDeleteAuthorized,
  resolveLegacyOwnedLocalFilePath,
} from './OwnedLocalFileRepository';
import { markNormalizedECOSHostedReceiptPageGraph } from './ECOSHostedPageGraphAuthority';

const REFERENCE_DOCUMENT_CATEGORIES = new Set([
  'Plans', 'Specifications', 'Permits', 'Inspection', 'Safety', 'Quality',
  'Contract', 'Change Order', 'RFI', 'Submittal', 'Environmental',
  'Electrical', 'Mechanical', 'Schedules', 'Schedule', 'Drawing', 'Scope',
  'Compliance', 'Permit Card', 'RFI / Field Decision', 'Vendor Document',
  'Report', 'Other',
]);
const REFERENCE_DOCUMENTS_FOLDER = 'project-documents';
const REFERENCE_DOCUMENTS_DIR = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}${REFERENCE_DOCUMENTS_FOLDER}/`
  : null;
const REFERENCE_DOCUMENT_BUCKET = 'project-documents';

export function resolveReferenceDocumentUri(uri: string) {
  if (!REFERENCE_DOCUMENTS_DIR || !uri) return '';
  return resolveLegacyOwnedLocalFilePath({
    ownedRoot: REFERENCE_DOCUMENTS_DIR,
    legacyFolderName: REFERENCE_DOCUMENTS_FOLDER,
    candidatePath: uri,
  }) || '';
}

export function normalizeReferenceDocument(
  value: Partial<ReferenceDocument>,
): ReferenceDocument {
  const category = stringOrNull(value.category) || 'Other';
  const importedAt = typeof value.importedAt === 'string'
    ? value.importedAt
    : new Date().toISOString();
  const normalized: ReferenceDocument = {
    id: stringOrNull(value.id) || createProjectId(),
    name: stringOrNull(value.name) || stringOrNull(value.originalFileName) || 'Reference Document',
    originalFileName: stringOrNull(value.originalFileName) || 'reference-document',
    uri: typeof value.uri === 'string' ? resolveReferenceDocumentUri(value.uri) : '',
    mimeType: stringOrNull(value.mimeType),
    category: REFERENCE_DOCUMENT_CATEGORIES.has(category) ? category : 'Other',
    notes: typeof value.notes === 'string' ? value.notes : '',
    isCurrent: Boolean(value.isCurrent),
    importedAt,
    projectId: stringOrNull(value.projectId),
    projectName: stringOrNull(value.projectName),
    projectNames: Array.isArray(value.projectNames)
      ? value.projectNames.filter((name): name is string => typeof name === 'string' && Boolean(name.trim()))
      : [],
    importBatchId: stringOrNull(value.importBatchId),
    storagePath: stringOrNull(value.storagePath),
    sizeBytes: finiteNumberOrNull(value.sizeBytes),
    contentSha256:
      canonicalSha256(value.contentSha256) ||
      canonicalSha256(value.webFileFingerprint),
    updatedAt: stringOrNull(value.updatedAt) || importedAt,
    cloudUpdatedAt: stringOrNull(value.cloudUpdatedAt),
    webFileFingerprint: stringOrNull(value.webFileFingerprint),
    webVersionGroupId: stringOrNull(value.webVersionGroupId),
    webContentReview: stringOrNull(value.webContentReview),
    webReport: isRecord(value.webReport) ? value.webReport : null,
    drawingNumber: stringOrNull(value.drawingNumber),
    drawingRevision: stringOrNull(value.drawingRevision),
    drawingDiscipline: stringOrNull(value.drawingDiscipline),
    drawingStatus:
      value.drawingStatus === 'Draft' ||
      value.drawingStatus === 'For Review' ||
      value.drawingStatus === 'For Construction' ||
      value.drawingStatus === 'As-Built' ||
      value.drawingStatus === 'Superseded'
        ? value.drawingStatus
        : null,
    drawingIssuedAt: stringOrNull(value.drawingIssuedAt),
    extractedText: stringOrNull(value.extractedText),
    extractionStatus:
      value.extractionStatus === 'pending' ||
      value.extractionStatus === 'complete' ||
      value.extractionStatus === 'partial' ||
      value.extractionStatus === 'needs_ocr' ||
      value.extractionStatus === 'failed' ||
      value.extractionStatus === 'not_supported'
        ? value.extractionStatus
        : null,
    extractionMethod:
      value.extractionMethod === 'embedded_text' ||
      value.extractionMethod === 'local_ocr' ||
      value.extractionMethod === 'embedded_text_and_ocr'
        ? value.extractionMethod
        : null,
    extractionLimitations: Array.isArray(value.extractionLimitations)
      ? value.extractionLimitations.filter(
          (item): item is string => typeof item === 'string' && Boolean(item.trim()),
        )
      : [],
    documentIntelligenceVersion:
      value.documentIntelligenceVersion === 'ecos-document-intelligence/1.0' ||
      value.documentIntelligenceVersion === 'ecos-document-intelligence/1.1' ||
      value.documentIntelligenceVersion === 'ecos-document-intelligence/1.2' ||
      value.documentIntelligenceVersion === 'ecos-document-intelligence/1.3' ||
      value.documentIntelligenceVersion === 'ecos-document-intelligence/1.4' ||
      value.documentIntelligenceVersion === 'ecos-document-intelligence/1.5' ||
      value.documentIntelligenceVersion === 'ecos-document-intelligence/2.0'
        ? value.documentIntelligenceVersion
        : null,
    documentVisualIndexVersion:
      value.documentVisualIndexVersion === 'ecos-visual-index/3.0'
        ? value.documentVisualIndexVersion
        : null,
    ecosVerifiedIndexCommitVersion:
      value.ecosVerifiedIndexCommitVersion === 'ecos-verified-index-commit/1.0'
        ? value.ecosVerifiedIndexCommitVersion
        : null,
    ecosVerifiedIndexCommittedAt: stringOrNull(value.ecosVerifiedIndexCommittedAt),
    ecosVerifiedIndexCommittedSha256: canonicalSha256(value.ecosVerifiedIndexCommittedSha256),
    ecosVerifiedIndexCommittedPageCount: nonNegativeIntegerOrNull(
      value.ecosVerifiedIndexCommittedPageCount,
    ),
    ecosVerifiedIndexPageGraphSha256: canonicalSha256(
      value.ecosVerifiedIndexPageGraphSha256,
    ),
    ecosHostedIndexStatus: hostedIndexStatusOrNull(value.ecosHostedIndexStatus),
    ecosHostedIndexProgressPercent: percentageOrNull(value.ecosHostedIndexProgressPercent),
    ecosHostedIndexCustomerMessage: stringOrNull(value.ecosHostedIndexCustomerMessage),
    ecosHostedIndexLimitationCount: nonNegativeIntegerOrNull(value.ecosHostedIndexLimitationCount),
    ecosHostedIndexSupportReference: stringOrNull(value.ecosHostedIndexSupportReference),
    ecosHostedIndexEvidenceVersion: stringOrNull(value.ecosHostedIndexEvidenceVersion),
    ecosHostedIndexUpdatedAt: stringOrNull(value.ecosHostedIndexUpdatedAt),
    indexedAt: stringOrNull(value.indexedAt),
    sourcePageCount: nonNegativeIntegerOrNull(value.sourcePageCount),
    searchablePageCount: nonNegativeIntegerOrNull(value.searchablePageCount),
    ocrPageCount: nonNegativeIntegerOrNull(value.ocrPageCount),
    extractionAverageConfidence: confidenceOrNull(value.extractionAverageConfidence),
    indexedContentSha256: canonicalSha256(value.indexedContentSha256),
    extractedPages: normalizeExtractedPages(value.extractedPages),
  };
  return markNormalizedECOSHostedReceiptPageGraph(value, normalized);
}

export function normalizeReferenceDocuments(value: unknown): ReferenceDocument[] {
  if (!Array.isArray(value)) return [];
  return reconcileCurrentScheduleDocuments(value
    .filter(isStartupReferenceDocumentRecord)
    .map(item => normalizeReferenceDocument(item as Partial<ReferenceDocument>)));
}

export async function ensureReferenceDocumentsDirectory() {
  if (!REFERENCE_DOCUMENTS_DIR) throw new Error('Reference document storage is unavailable.');
  const info = await FileSystem.getInfoAsync(REFERENCE_DOCUMENTS_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(REFERENCE_DOCUMENTS_DIR, { intermediates: true });
  }
  return REFERENCE_DOCUMENTS_DIR;
}

export function isStoredReferenceDocument(uri: string) {
  if (!REFERENCE_DOCUMENTS_DIR) return false;
  const resolved = resolveReferenceDocumentUri(uri);
  return Boolean(resolved && isLegacyOwnedLocalFileReadDeleteAuthorized({
    ownedRoot: REFERENCE_DOCUMENTS_DIR,
    legacyFolderName: REFERENCE_DOCUMENTS_FOLDER,
    candidatePath: resolved,
  }));
}

export function deleteStoredReferenceDocument(uri: string) {
  const resolved = resolveReferenceDocumentUri(uri);
  if (!isStoredReferenceDocument(resolved)) return Promise.resolve();
  return FileSystem.deleteAsync(resolved, { idempotent: true });
}

export async function prepareReferenceDocumentForCloud(
  document: ReferenceDocument,
): Promise<ReferenceDocument> {
  if (!document.uri) return document;
  const resolvedUri = resolveReferenceDocumentUri(document.uri);
  if (!resolvedUri) return document;
  const preflight = await preflightExpoFileRead({
    uri: resolvedUri,
    reportedSizeBytes: document.sizeBytes,
    maxBytes: MAX_PROJECT_DOCUMENT_FILE_BYTES,
  });
  const integrityHash = await hashExpoFileSha256({
    uri: resolvedUri,
    reportedSizeBytes: preflight.sizeBytes,
    maxBytes: MAX_PROJECT_DOCUMENT_FILE_BYTES,
  });
  const integrity = {
    sizeBytes: integrityHash.sizeBytes,
    contentSha256: integrityHash.sha256,
    updatedAt: new Date().toISOString(),
  };
  if (document.storagePath) return { ...document, ...integrity };
  const storagePath = `mobile/${document.id}/${sanitizeFilename(document.originalFileName)}`;
  const uploaded = await uploadPhoto({
    bucket: REFERENCE_DOCUMENT_BUCKET,
    path: storagePath,
    uri: resolvedUri,
    contentType: document.mimeType || 'application/octet-stream',
    upsert: true,
    reportedSizeBytes: preflight.sizeBytes,
    maxBytes: MAX_PROJECT_DOCUMENT_FILE_BYTES,
  });
  // Integrity metadata is local truth derived from the owned bytes. Preserve
  // it even when the cloud upload is unavailable so a later retry can safely
  // prove which file is being uploaded and recovered.
  if (!uploaded.ok || uploaded.stubbed) return { ...document, ...integrity };
  return {
    ...document,
    storagePath,
    ...integrity,
  };
}

function stringOrNull(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function finiteNumberOrNull(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nonNegativeIntegerOrNull(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}

function confidenceOrNull(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null;
}

function percentageOrNull(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
    ? value
    : null;
}

function hostedIndexStatusOrNull(
  value: unknown,
): ReferenceDocument['ecosHostedIndexStatus'] {
  return value === 'Waiting' ||
    value === 'Preparing' ||
    value === 'Prepared' ||
    value === 'Prepared with limitations' ||
    value === 'Ready for ECOS' ||
    value === 'Ready with limitations' ||
    value === 'Needs Review' ||
    value === 'Reconnect Files' ||
    value === 'Temporarily Unavailable'
    ? value
    : null;
}

function canonicalSha256(value: unknown) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

function normalizeExtractedPages(value: unknown): ReferenceDocument['extractedPages'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(page => {
    if (!isRecord(page)) return [];
    const pageNumber = finiteNumberOrNull(page.pageNumber);
    if (!pageNumber || pageNumber < 1) return [];
    const regions: NonNullable<ReferenceDocument['extractedPages']>[number]['regions'] = Array.isArray(page.regions)
      ? page.regions.flatMap(region => {
          if (!isRecord(region)) return [];
          const x = finiteNumberOrNull(region.x);
          const y = finiteNumberOrNull(region.y);
          const width = finiteNumberOrNull(region.width);
          const height = finiteNumberOrNull(region.height);
          if ([x, y, width, height].some(item => item === null)) return [];
          if (x! < 0 || y! < 0 || width! <= 0 || height! <= 0) return [];
          const rawSource = stringOrNull(region.rawSource) || stringOrNull(region.source);
          return [{
            id: stringOrNull(region.id) || createProjectId(),
            searchable: typeof region.searchable === 'boolean'
              ? region.searchable
              : undefined,
            label: stringOrNull(region.label),
            text: stringOrNull(region.text),
            factKind: region.factKind === 'drawing_fact' || region.factKind === 'sheet_identity'
              ? region.factKind
              : null,
            subject: stringOrNull(region.subject),
            location: stringOrNull(region.location),
            evidenceText: stringOrNull(region.evidenceText),
            areaNames: Array.isArray(region.areaNames)
              ? region.areaNames.filter((name): name is string =>
                  typeof name === 'string' && Boolean(name.trim()))
              : [],
            x: x!,
            y: y!,
            width: width!,
            height: height!,
            confidence: finiteNumberOrNull(region.confidence),
            source: canonicalRegionSource(rawSource),
            rawSource,
            reconstructionMethod: stringOrNull(region.reconstructionMethod),
            evidenceSources: Array.isArray(region.evidenceSources)
              ? region.evidenceSources.filter((source): source is string =>
                  typeof source === 'string' && Boolean(source.trim()))
              : [],
            constituentEvidence: regionEvidenceArray(region.constituentEvidence),
            corroboratingEvidence: regionEvidenceArray(region.corroboratingEvidence),
          }];
        })
      : [];
    return [withNormalizedECOSSheetProvenance({
      pageNumber,
      sheetNumber: stringOrNull(page.sheetNumber),
      sheetTitle: stringOrNull(page.sheetTitle),
      sheetMappingStatus: page.sheetMappingStatus === 'verified' ||
        page.sheetMappingStatus === 'conflicted' || page.sheetMappingStatus === 'unverified'
        ? page.sheetMappingStatus
        : null,
      sheetMappingConfidence: finiteNumberOrNull(page.sheetMappingConfidence),
      sheetMappingSource: page.sheetMappingSource as ReferenceDocumentExtractedPage['sheetMappingSource'],
      sheetMappingEvidence: Array.isArray(page.sheetMappingEvidence)
        ? page.sheetMappingEvidence as ReferenceDocumentExtractedPage['sheetMappingEvidence']
        : [],
      documentStructuralIdentity: isRecord(page.documentStructuralIdentity)
        ? page.documentStructuralIdentity as ReferenceDocumentExtractedPage['documentStructuralIdentity']
        : null,
      assurance: isRecord(page.assurance)
        ? page.assurance as ReferenceDocumentExtractedPage['assurance']
        : null,
      sheetMappingCandidates: Array.isArray(page.sheetMappingCandidates)
        ? page.sheetMappingCandidates.flatMap(candidate => {
            if (!isRecord(candidate)) return [];
            const sheetNumber = stringOrNull(candidate.sheetNumber);
            const score = finiteNumberOrNull(candidate.score);
            const confidence = finiteNumberOrNull(candidate.confidence);
            if (!sheetNumber || score === null || confidence === null) return [];
            return [{
              sheetNumber,
              score,
              confidence,
              evidenceRegionIds: Array.isArray(candidate.evidenceRegionIds)
                ? candidate.evidenceRegionIds.filter((id): id is string =>
                    typeof id === 'string' && Boolean(id.trim()))
                : [],
            }];
          })
        : [],
      visualCoverage: normalizeVisualCoverage(page.visualCoverage),
      title: stringOrNull(page.title),
      text: stringOrNull(page.text),
      regions,
    }, {
      requireAssurance: false,
    })];
  });
}

function normalizeVisualCoverage(
  value: unknown,
): NonNullable<ReferenceDocumentExtractedPage['visualCoverage']> | null {
  if (!isRecord(value)) return null;
  const proofs = Array.isArray(value.completedDeepReadRegionProofs)
    ? value.completedDeepReadRegionProofs.flatMap(normalizeVisualTileProof)
    : [];
  return {
    schemaVersion: stringOrNull(value.schemaVersion) ?? undefined,
    evidenceVersion: stringOrNull(value.evidenceVersion) ?? undefined,
    sourceSha256: canonicalSha256(value.sourceSha256) ?? undefined,
    pageNumber: nonNegativeIntegerOrNull(value.pageNumber) ?? undefined,
    overviewAnalyzed: value.overviewAnalyzed === true,
    requestedDeepReadRegionCount: Math.max(0, Math.floor(finiteNumberOrNull(value.requestedDeepReadRegionCount) ?? 0)),
    completedDeepReadRegionCount: Math.max(0, Math.floor(finiteNumberOrNull(value.completedDeepReadRegionCount) ?? 0)),
    coverageComplete: value.coverageComplete === true,
    completedDeepReadRegionKeys: Array.isArray(value.completedDeepReadRegionKeys)
      ? value.completedDeepReadRegionKeys.filter((item): item is string =>
          typeof item === 'string' && Boolean(item.trim()))
      : [],
    completedDeepReadRegionProofs: proofs,
    failureCodes: Array.isArray(value.failureCodes)
      ? value.failureCodes.filter((item): item is string =>
          typeof item === 'string' && Boolean(item.trim()))
      : [],
  };
}

function normalizeVisualTileProof(
  value: unknown,
): NonNullable<NonNullable<ReferenceDocumentExtractedPage['visualCoverage']>['completedDeepReadRegionProofs']> {
  if (!isRecord(value) || !isRecord(value.bounds) || value.state !== 'completed') return [];
  const x = finiteNumberOrNull(value.bounds.x);
  const y = finiteNumberOrNull(value.bounds.y);
  const width = finiteNumberOrNull(value.bounds.width);
  const height = finiteNumberOrNull(value.bounds.height);
  const pageNumber = nonNegativeIntegerOrNull(value.pageNumber);
  const renderDpi = nonNegativeIntegerOrNull(value.renderDpi);
  const renderPixelWidth = nonNegativeIntegerOrNull(value.renderPixelWidth);
  const renderPixelHeight = nonNegativeIntegerOrNull(value.renderPixelHeight);
  const analysisRegionCount = nonNegativeIntegerOrNull(value.analysisRegionCount);
  const searchableRegionCount = nonNegativeIntegerOrNull(value.searchableRegionCount);
  const tileKey = stringOrNull(value.tileKey);
  const sourceSha256 = canonicalSha256(value.sourceSha256);
  const evidenceVersion = stringOrNull(value.evidenceVersion);
  const renderMethod = stringOrNull(value.renderMethod);
  const analysisMethod = stringOrNull(value.analysisMethod);
  const renderSha256 = canonicalSha256(value.renderSha256);
  const analysisInputSha256 = canonicalSha256(value.analysisInputSha256);
  const analysisSha256 = canonicalSha256(value.analysisSha256);
  if (
    [x, y, width, height, pageNumber, renderDpi, renderPixelWidth, renderPixelHeight,
      analysisRegionCount, searchableRegionCount].some(item => item === null) ||
    !tileKey || !sourceSha256 || !evidenceVersion || !renderMethod || !analysisMethod ||
    !renderSha256 || !analysisInputSha256 || !analysisSha256
  ) return [];
  return [{
    tileKey,
    bounds: { x: x!, y: y!, width: width!, height: height! },
    state: 'completed',
    pageNumber: pageNumber!,
    sourceSha256,
    evidenceVersion,
    renderMethod,
    analysisMethod,
    renderDpi: renderDpi!,
    renderPixelWidth: renderPixelWidth!,
    renderPixelHeight: renderPixelHeight!,
    renderSha256,
    analysisInputSha256,
    analysisSha256,
    analysisRegionCount: analysisRegionCount!,
    analysisRegionIds: Array.isArray(value.analysisRegionIds)
      ? value.analysisRegionIds.filter((item): item is string => typeof item === 'string')
      : [],
    searchableRegionCount: searchableRegionCount!,
    searchableRegionIds: Array.isArray(value.searchableRegionIds)
      ? value.searchableRegionIds.filter((item): item is string => typeof item === 'string')
      : [],
    analysisDurationMs: nonNegativeIntegerOrNull(value.analysisDurationMs) ?? undefined,
  }];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function canonicalRegionSource(value: string | null): 'embedded_text' | 'ocr' | 'vision' | null {
  if (value === 'deterministic_label_block') return 'ocr';
  return value === 'embedded_text' || value === 'ocr' || value === 'vision' ? value : null;
}

function regionEvidenceArray(value: unknown): ReferenceDocumentRegionEvidence[] {
  return Array.isArray(value)
    ? value.filter(isRecord).map(item => ({ ...item }) as ReferenceDocumentRegionEvidence)
    : [];
}

function sanitizeFilename(filename: string) {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '-');
}
