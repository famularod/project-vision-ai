import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ReferenceDocument,
  ReferenceDocumentExtractedPage,
  ReferenceDocumentRegionEvidence,
} from '../types';
import {
  normalizeECOSSheetProvenance,
  sameECOSSheetProvenance,
  type ECOSNormalizedSheetProvenance,
} from './ECOSSheetProvenance';

export type ECOSCloudIndexSaveResult = Readonly<{
  status: 'saved' | 'unavailable' | 'failed';
  indexedPages: number;
  indexedChunks: number;
  message: string | null;
}>;

export async function replaceECOSDocumentCloudIndex({
  client,
  document,
}: {
  client: SupabaseClient;
  document: ReferenceDocument;
}): Promise<ECOSCloudIndexSaveResult> {
  if (!document.id || !document.extractedPages?.length) {
    return Object.freeze({
      status: 'unavailable',
      indexedPages: 0,
      indexedChunks: 0,
      message: 'No searchable pages were available for the shared index.',
    });
  }
  const { data, error } = await client.rpc('ecos_replace_document_index', {
    p_document_id: document.id,
    p_source_sha256: canonicalSha256(document.indexedContentSha256 || document.contentSha256),
    p_extraction_method: document.extractionMethod || null,
    p_pages: document.extractedPages,
  });
  if (error) {
    const unavailable = error.code === '42883' || error.code === 'PGRST202';
    return Object.freeze({
      status: unavailable ? 'unavailable' : 'failed',
      indexedPages: 0,
      indexedChunks: 0,
      message: unavailable
        ? 'The shared ECOS index migration has not been applied yet.'
        : error.message || 'The shared ECOS index could not be updated.',
    });
  }
  const row = Array.isArray(data) ? data[0] : data;
  return Object.freeze({
    status: 'saved',
    indexedPages: safeCount(row?.indexed_pages),
    indexedChunks: safeCount(row?.indexed_chunks),
    message: null,
  });
}

export async function searchECOSDocumentCloudIndex({
  client,
  question,
  documentIds,
  maximumResults = 12,
}: {
  client: SupabaseClient;
  question: string;
  documentIds?: readonly string[];
  maximumResults?: number;
}) {
  const hosted = await client.rpc('ecos_search_hosted_document_chunks', {
    p_search_query: question.trim(),
    p_document_ids: documentIds?.length ? [...new Set(documentIds)] : null,
    p_result_limit: Math.max(1, Math.min(50, maximumResults)),
  });
  if (!hosted.error && Array.isArray(hosted.data) && hosted.data.length > 0) {
    return hosted.data;
  }
  if (hosted.error && !rpcUnavailable(hosted.error)) {
    throw new Error(hosted.error.message || 'ECOS document search failed.');
  }
  const legacy = await client.rpc('ecos_search_document_chunks', {
    p_search_query: question.trim(),
    p_document_ids: documentIds?.length ? [...new Set(documentIds)] : null,
    p_result_limit: Math.max(1, Math.min(50, maximumResults)),
  });
  if (legacy.error) throw new Error(legacy.error.message || 'ECOS document search failed.');
  return Array.isArray(legacy.data) ? legacy.data : [];
}

function rpcUnavailable(error: { code?: string | null; message?: string | null }) {
  return error.code === '42883' || error.code === 'PGRST202' ||
    String(error.message || '').toLowerCase().includes('could not find the function');
}

export function hydrateECOSDocumentsFromCloudSearch(
  documents: readonly ReferenceDocument[],
  rows: readonly unknown[],
): ReferenceDocument[] {
  const documentsById = new Map(documents.map(document => [document.id, document]));
  const pagesByDocument = new Map<string, Map<number, {
    pageNumber: number;
    provenance: ECOSNormalizedSheetProvenance;
    provenanceConflict: boolean;
    sheetMappingConfidence: number | null;
    visualCoverage: ReferenceDocumentExtractedPage['visualCoverage'];
    text: string[];
    regions: NonNullable<ReferenceDocument['extractedPages']>[number]['regions'];
  }>>();
  rows.forEach(value => {
    const row = record(value);
    const documentId = textValue(row.document_id);
    const pageNumber = positiveInteger(row.page_number);
    const chunkText = textValue(row.chunk_text);
    if (!documentId || !pageNumber || !chunkText || !documentsById.has(documentId)) return;
    let pages = pagesByDocument.get(documentId);
    if (!pages) {
      pages = new Map();
      pagesByDocument.set(documentId, pages);
    }
    const metadata = record(row.metadata);
    const incomingProvenance = normalizeECOSSheetProvenance({
      pageNumber,
      sheetNumber: row.sheet_number,
      sheetMappingStatus: metadata.sheetMappingStatus,
      sheetMappingSource: metadata.sheetMappingSource,
      sheetMappingEvidence: metadata.sheetMappingEvidence,
      documentStructuralIdentity: metadata.documentStructuralIdentity,
      assurance: metadata.assurance ?? metadata.sheetMappingAssurance,
    }, {
      expectedPageNumber: pageNumber,
      requireAssurance: true,
      // Search returns only the matched region, not every page region. The
      // independently persisted Assurance proof remains authoritative here.
      requireNativeRegionBinding: false,
    });
    let page = pages.get(pageNumber);
    if (!page) {
      page = {
        pageNumber,
        provenance: incomingProvenance,
        provenanceConflict: false,
        sheetMappingConfidence: normalizedCoordinate(record(row.metadata).sheetMappingConfidence),
        visualCoverage: visualCoverage(record(row.metadata).visualCoverage),
        text: [],
        regions: [],
      };
      pages.set(pageNumber, page);
    } else if (!sameECOSSheetProvenance(page.provenance, incomingProvenance)) {
      // Never combine chunks that disagree about their page identity. Text
      // remains searchable by PDF page, while exact-sheet citation fails shut.
      page.provenanceConflict = true;
    }
    if (!page.text.includes(chunkText)) page.text.push(chunkText);
    const regionId = textValue(row.region_id);
    const x = normalizedCoordinate(metadata.x);
    const y = normalizedCoordinate(metadata.y);
    const width = normalizedCoordinate(metadata.width);
    const height = normalizedCoordinate(metadata.height);
    const rawSource = textValue(metadata.rawSource) || textValue(metadata.source) || null;
    if (
      regionId && x != null && y != null && width != null && height != null &&
      width > 0 && height > 0 && x + width <= 1.001 && y + height <= 1.001
    ) {
      page.regions!.push({
        id: regionId,
        label: chunkText,
        text: chunkText,
        factKind: metadata.factKind === 'drawing_fact' || metadata.factKind === 'sheet_identity'
          ? metadata.factKind
          : null,
        subject: textValue(metadata.subject) || null,
        location: textValue(metadata.location) || null,
        evidenceText: textValue(metadata.evidenceText) || null,
        areaNames: Array.isArray(metadata.areaNames)
          ? metadata.areaNames.map(textValue).filter(Boolean)
          : [],
        x,
        y,
        width,
        height,
        confidence: normalizedCoordinate(row.confidence),
        source: canonicalRegionSource(rawSource),
        rawSource,
        reconstructionMethod: textValue(metadata.reconstructionMethod) || null,
        evidenceSources: stringArray(metadata.evidenceSources),
        constituentEvidence: regionEvidenceArray(metadata.constituentEvidence),
        corroboratingEvidence: regionEvidenceArray(metadata.corroboratingEvidence),
      });
    }
  });

  return documents.map(document => {
    if ((document.extractedPages ?? []).length > 0) return document;
    const pages = [...(pagesByDocument.get(document.id)?.values() ?? [])]
      .sort((left, right) => left.pageNumber - right.pageNumber)
      .map(page => {
        const provenance = page.provenanceConflict
          ? normalizeECOSSheetProvenance({
              pageNumber: page.pageNumber,
              sheetMappingStatus: 'unverified',
            }, { expectedPageNumber: page.pageNumber })
          : page.provenance;
        return {
          pageNumber: page.pageNumber,
          sheetNumber: provenance.sheetNumber,
          sheetMappingStatus: provenance.sheetMappingStatus,
          sheetMappingConfidence: page.sheetMappingConfidence,
          sheetMappingSource: provenance.provenance.sheetMappingSource,
          sheetMappingEvidence: provenance.provenance.sheetMappingEvidence,
          documentStructuralIdentity: provenance.provenance.documentStructuralIdentity,
          assurance: provenance.provenance.assurance,
          visualCoverage: page.visualCoverage,
          title: page.text[0]?.slice(0, 160) || null,
          text: page.text.join('\n'),
          regions: page.regions,
        };
      });
    if (pages.length === 0) return document;
    return {
      ...document,
      extractedText: pages.map(page => page.text).filter(Boolean).join('\n\n'),
      extractedPages: pages,
    };
  });
}

function canonicalSha256(value: unknown) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

function safeCount(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function textValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function positiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function normalizedCoordinate(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : null;
}

function visualCoverage(value: unknown) {
  const data = record(value);
  if (typeof data.overviewAnalyzed !== 'boolean' || typeof data.coverageComplete !== 'boolean') return null;
  return {
    schemaVersion: textValue(data.schemaVersion) || undefined,
    evidenceVersion: textValue(data.evidenceVersion) || undefined,
    sourceSha256: canonicalSha256(data.sourceSha256) || undefined,
    pageNumber: positiveInteger(data.pageNumber) || undefined,
    overviewAnalyzed: data.overviewAnalyzed,
    requestedDeepReadRegionCount: safeCount(data.requestedDeepReadRegionCount),
    completedDeepReadRegionCount: safeCount(data.completedDeepReadRegionCount),
    coverageComplete: data.coverageComplete,
    completedDeepReadRegionKeys: stringArray(data.completedDeepReadRegionKeys),
    completedDeepReadRegionProofs: Array.isArray(data.completedDeepReadRegionProofs)
      ? data.completedDeepReadRegionProofs.flatMap(visualTileProof)
      : [],
    failureCodes: stringArray(data.failureCodes),
  };
}

function visualTileProof(value: unknown): NonNullable<
  NonNullable<ReferenceDocumentExtractedPage['visualCoverage']>['completedDeepReadRegionProofs']
> {
  const data = record(value);
  const bounds = record(data.bounds);
  const tileKey = textValue(data.tileKey);
  const sourceSha256 = canonicalSha256(data.sourceSha256);
  const evidenceVersion = textValue(data.evidenceVersion);
  const renderSha256 = canonicalSha256(data.renderSha256);
  const analysisInputSha256 = canonicalSha256(data.analysisInputSha256);
  const analysisSha256 = canonicalSha256(data.analysisSha256);
  const pageNumber = positiveInteger(data.pageNumber);
  const renderDpi = positiveInteger(data.renderDpi);
  const renderPixelWidth = positiveInteger(data.renderPixelWidth);
  const renderPixelHeight = positiveInteger(data.renderPixelHeight);
  const analysisRegionCount = safeCount(data.analysisRegionCount);
  const searchableRegionCount = safeCount(data.searchableRegionCount);
  const x = normalizedCoordinate(bounds.x);
  const y = normalizedCoordinate(bounds.y);
  const width = normalizedCoordinate(bounds.width);
  const height = normalizedCoordinate(bounds.height);
  if (
    data.state !== 'completed' || !tileKey || !sourceSha256 || !evidenceVersion ||
    !renderSha256 || !analysisInputSha256 || !analysisSha256 || !pageNumber ||
    !renderDpi || !renderPixelWidth || !renderPixelHeight ||
    x === null || y === null || width === null || height === null
  ) return [];
  return [{
    tileKey,
    bounds: { x, y, width, height },
    state: 'completed',
    pageNumber,
    sourceSha256,
    evidenceVersion,
    renderMethod: textValue(data.renderMethod),
    analysisMethod: textValue(data.analysisMethod),
    renderDpi,
    renderPixelWidth,
    renderPixelHeight,
    renderSha256,
    analysisInputSha256,
    analysisSha256,
    analysisRegionCount,
    analysisRegionIds: stringArray(data.analysisRegionIds),
    searchableRegionCount,
    searchableRegionIds: stringArray(data.searchableRegionIds),
    analysisDurationMs: safeCount(data.analysisDurationMs),
  }];
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    : [];
}

function canonicalRegionSource(value: string | null): 'embedded_text' | 'ocr' | 'vision' | null {
  if (value === 'deterministic_label_block') return 'ocr';
  return value === 'embedded_text' || value === 'ocr' || value === 'vision' ? value : null;
}

function regionEvidenceArray(value: unknown): ReferenceDocumentRegionEvidence[] {
  return Array.isArray(value)
    ? value.filter(item => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
      .map(item => ({ ...(item as Record<string, unknown>) }) as ReferenceDocumentRegionEvidence)
    : [];
}
