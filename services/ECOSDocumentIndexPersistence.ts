import type {
  ReferenceDocument,
  ReferenceDocumentExtractedPage,
  ReferenceDocumentListedPageIndex,
  ReferenceDocumentRegion,
} from '../types';
import { canonicalReferenceCategory } from './AuthoritativeDocumentSystem';
import { sanitizeECOSDocumentText } from './ECOSDocumentTextSanitization';
import { withNormalizedECOSSheetProvenance } from './ECOSSheetProvenance';

const MAX_FALLBACK_TEXT_CHARACTERS = 100_000;
const MAX_REGION_TEXT_CHARACTERS = 1_200;

/**
 * Keeps the source file in protected Storage while sending only one compact
 * searchable representation through the operational JSON row. Page text is
 * not duplicated when exact line regions already contain the same content.
 */
export function compactECOSDocumentIndexForCloud(
  document: ReferenceDocument,
): ReferenceDocument {
  const pages = cloudFormOfPages(document);
  // High item 3 (b2): a drawing's row carries the citation slice under its own key (withCitationPageIndexForTheCloudRow).
  return withCitationPageIndexForTheCloudRow({
    ...document,
    extractedText: pages.length > 0
      ? null
      : clean(document.extractedText).slice(0, MAX_FALLBACK_TEXT_CHARACTERS) || null,
    extractedPages: pages,
  }, document);
}

/** The page index in the cut-down form the cloud's row holds. */
function cloudFormOfPages(document: ReferenceDocument): ReferenceDocumentExtractedPage[] {
  return (document.extractedPages ?? []).map(rawPage => {
    const normalizedPage = withNormalizedECOSSheetProvenance(rawPage, {
      // Local extraction precedes the database Assurance commit. Preserve the
      // exact producer evidence here; the commit boundary independently
      // requires and persists its acceptance proof.
      requireAssurance: false,
    });
    // Keep the explicit fail-closed status, but do not inflate every ordinary
    // PDF-page-only record with redundant null/empty exact-sheet fields.
    const page: typeof normalizedPage = normalizedPage.sheetMappingStatus === 'verified'
      ? normalizedPage
      : {
          ...normalizedPage,
          sheetMappingSource: normalizedPage.sheetMappingSource ?? undefined,
          sheetMappingEvidence: undefined,
          documentStructuralIdentity: undefined,
          assurance: normalizedPage.assurance ?? undefined,
        };
    const regions = (page.regions ?? []).map(region => {
      const text = clean(region.text).slice(0, MAX_REGION_TEXT_CHARACTERS) || null;
      const label = clean(region.label);
      return {
        ...region,
        label: label && label !== text ? label.slice(0, 240) : null,
        text,
        factKind: region.factKind === 'drawing_fact' || region.factKind === 'sheet_identity'
          ? region.factKind
          : null,
        subject: clean(region.subject).slice(0, 240) || null,
        location: clean(region.location).slice(0, 500) || null,
        evidenceText: clean(region.evidenceText).slice(0, MAX_REGION_TEXT_CHARACTERS) || null,
        areaNames: [...new Set((region.areaNames ?? []).map(clean).filter(Boolean))],
        x: rounded(region.x),
        y: rounded(region.y),
        width: rounded(region.width),
        height: rounded(region.height),
        confidence: region.confidence == null ? null : rounded(region.confidence, 4),
      };
    });
    return {
      ...page,
      sheetNumber: clean(page.sheetNumber).slice(0, 160) || null,
      title: clean(page.title).slice(0, 500) || null,
      // Regions already carry the exact searchable lines. Retain page text
      // only for older/fallback indexes that do not have trustworthy boxes.
      text: regions.length > 0
        ? null
        : clean(page.text).slice(0, MAX_FALLBACK_TEXT_CHARACTERS) || null,
      regions,
    };
  });
}

/**
 * Google Drive remains the source of the original PDF and the dedicated ECOS
 * page/chunk tables remain the searchable source. The operational document
 * row carries only readiness and source metadata so large extracted indexes
 * are not duplicated through routine workspace refreshes.
 */
export function compactECOSDocumentMetadataForCloud(
  document: ReferenceDocument,
): ReferenceDocument {
  return {
    ...document,
    extractedText: null,
    extractedPages: [],
  };
}

/**
 * Routine mobile startup and workspace refreshes need document identity and
 * readiness metadata, not every page-region proof. The authoritative index
 * remains in the dedicated ECOS page/chunk tables. Keeping this cache compact
 * prevents a large issued-drawing set from expanding into gigabytes of JS
 * objects while the app is opening.
 *
 * High item 3 (c): the copy of a drawing's index the document list last gave
 * (listedPageIndex) is saved with it, as it is. Nothing is made here of the
 * device's own reading or of a live change.
 */
export function compactECOSReferenceDocumentsForOperationalRead(
  documents: readonly ReferenceDocument[],
): ReferenceDocument[] {
  return documents.map(document => {
    const { listedPageIndex, ...rest } = withoutEarlierKeptIndex(document);
    const compact = compactECOSDocumentMetadataForCloud(rest);
    return listedPageIndex === undefined ? compact : { ...compact, listedPageIndex };
  });
}

/*
 * HIGH ITEM 3 (the owner's instruction of 13 Oct 2026, the three high items; review pass 3 (reports), P3-3).
 * Which drawing piece a report shows, and so its fingerprint, is read from the drawing's page index.
 *
 * THE RULE (option (c), the coordinator's decision): a report, on the phone, the iPad and the desktop alike, cites
 * a drawing piece only from the drawing's index AS THE DOCUMENT LIST GIVES IT, the one copy every device gets.
 * Never from the device's own reading, never from a live-change row, never from a copy made of either.
 *
 * HOW THE LIST CARRIES IT (option (b2), the coordinator's decision on Q52 B: app only, no database change). The live
 * list function returns document_data - 'extractedPages' and every other key as it is. So a drawing's row carries
 * the CITATION SLICE of its index under one key of its own, document_data.citationPageIndex
 * (CITATION_PAGE_INDEX_KEY): per page its number and sheet; per region only what a citation and the piece read (id,
 * label, work areas, confidence, box); the checksum of the file it was read from. A few hundred bytes a sheet.
 *  - WRITERS (withCitationPageIndexForTheCloudRow, inside compactECOSDocumentIndexForCloud, so every row a phone, an
 *    iPad or the desktop sends): the slice of the sender's own reading of the current file, else the copy the
 *    document carries or the list's copy it holds, for the current file only; else no key (a drawing it cannot
 *    index sends none). The device's own field never goes into a row.
 *  - THE ONE READER (listedPageIndexOfTheListRow): reads that key from a list row. Phone and iPad hold the result as
 *    ReferenceDocument.listedPageIndex (null: none); the desktop's loader does the same.
 *  - NO BACKFILL (high item 3e, the coordinator's decision, option A): every write of a document's row starts the
 *    cloud's own work on it (the hosted-preparation trigger can queue a full, paid preparation of a drawing), so
 *    the app writes a row only as part of something he does, and the key goes up only inside those writes.
 *    Drawings already in the cloud show their piece once added or read again on an updated iPhone or iPad.
 *  - Everything else of (c) stands: the merge keeps the list's verdict across live changes (DAVECloudRecovery); the
 *    Reports screens cite only from listedPageIndex (referenceDocumentsCitedAsListed); the desktop keeps, for a live
 *    change, the list's copy of the row it replaces (liveDocumentRowWithTheListedIndex); the report's truth gets the
 *    documents as before (withoutListedPageIndexes), so no fingerprint moves for a report without a piece.
 *  - An index is used and sent only for the file it was read from.
 */
export const CITATION_PAGE_INDEX_KEY = 'citationPageIndex' as const;
const slicesOfOwnReading = new WeakMap<readonly ReferenceDocumentExtractedPage[], ReferenceDocumentExtractedPage[]>();
const citedAsListedByDocument = new WeakMap<ReferenceDocument, ReferenceDocument>();
const normalizedListedPageIndexes = new WeakMap<object, ReferenceDocumentListedPageIndex | null>();

/** The documents as the document list gave them: a drawing holds the list's copy of its citation slice, or null. */
export function compactECOSReferenceDocumentsFromTheDocumentList(
  documents: readonly ReferenceDocument[],
): ReferenceDocument[] {
  return documents.map(document => {
    const { listedPageIndex: _neverInARow, citationPageIndex: _readBelow, ...row } = withoutEarlierKeptIndex(document);
    const compact = compactECOSDocumentMetadataForCloud(row);
    return isDrawing(row) ? { ...compact, listedPageIndex: listedPageIndexOfTheListRow(document) } : compact;
  });
}

/** THE ONE READER of the index as the document list carries it: document_data.citationPageIndex (null: none). */
export function listedPageIndexOfTheListRow(row: Partial<ReferenceDocument>): ReferenceDocumentListedPageIndex | null {
  return normalizeListedPageIndex(row[CITATION_PAGE_INDEX_KEY]);
}

/**
 * The citation slice of a drawing's own index, as the cloud's row would hold it, with the checksum of the file it
 * was read from; null for a document that is not a drawing or holds no index. Its pages are [] where the index names
 * no work area: indexed, and nothing to cite.
 */
export function citationPageIndexOfTheRowsOwnIndex(document: ReferenceDocument): ReferenceDocumentListedPageIndex | null {
  const source = document.extractedPages ?? [];
  if (!isDrawing(document) || source.length === 0) return null;
  let pages = slicesOfOwnReading.get(source);
  if (!pages) {
    pages = citationSliceOf(cloudFormOfPages(document));
    slicesOfOwnReading.set(source, pages);
  }
  return { sourceSha256: canonicalSha256(document.indexedContentSha256) ?? canonicalSha256(document.contentSha256), pages };
}

/**
 * The row a device sends of a document: a drawing with its citation slice under its own key, from the sender's own
 * reading, else the copy the document carries, else the list's copy it holds, for the current file only; else none.
 * The device's own fields never go into a row.
 */
export function withCitationPageIndexForTheCloudRow(
  row: ReferenceDocument,
  document: ReferenceDocument,
): ReferenceDocument {
  const { listedPageIndex: _deviceOnly, citationPageIndex: _chosenBelow, ...sent } = withoutEarlierKeptIndex(row);
  if (!isDrawing(document)) return sent;
  const slice = [
    citationPageIndexOfTheRowsOwnIndex(document),
    normalizeListedPageIndex(document.citationPageIndex),
    normalizeListedPageIndex(document.listedPageIndex),
  ].find(candidate => candidate && forTheCurrentFile(candidate, document));
  return slice ? { ...sent, [CITATION_PAGE_INDEX_KEY]: slice } : sent;
}

/** The phone's, the iPad's and the desktop's Reports: each drawing with the list's copy of its index as its index, or none. */
export function referenceDocumentsCitedAsListed(documents: ReferenceDocument[]): ReferenceDocument[] {
  return documents.map(document => {
    if (!isDrawing(document)) return document;
    const known = citedAsListedByDocument.get(document);
    if (known) return known;
    const listed = normalizeListedPageIndex(document.listedPageIndex);
    const pages = listed && forTheCurrentFile(listed, document) ? listed.pages : [];
    // The index handed to the citation is the slice, read from the file the slice names (the citation's own check
    // compares that with the document's file, as for any index).
    const cited = pages.length === 0
      ? (document.extractedPages ?? []).length === 0 ? document : { ...document, extractedPages: [] }
      : { ...document, extractedPages: pages, ...(listed?.sourceSha256 ? { indexedContentSha256: listed.sourceSha256 } : {}) };
    citedAsListedByDocument.set(document, cited);
    return cited;
  });
}

/** The desktop: a live-change row keeps the index the list gave for the row it replaces (both keys), never its own. */
export function liveDocumentRowWithTheListedIndex(
  candidate: Readonly<Record<string, unknown>>,
  held: unknown,
): Readonly<Record<string, unknown>> {
  const data = candidate.document_data;
  if (!isRecord(data)) return candidate;
  const { extractedPages: _live, [CITATION_PAGE_INDEX_KEY]: _liveSlice, ...rest } = data;
  const heldData = isRecord(held) && isRecord(held.document_data) ? held.document_data : null;
  const sameFile = heldData && canonicalSha256(heldData.contentSha256) === canonicalSha256(data.contentSha256);
  const listed: Record<string, unknown> = {};
  if (heldData && sameFile) {
    if ('extractedPages' in heldData) listed.extractedPages = heldData.extractedPages;
    if (CITATION_PAGE_INDEX_KEY in heldData) listed[CITATION_PAGE_INDEX_KEY] = heldData[CITATION_PAGE_INDEX_KEY];
  }
  return { ...candidate, document_data: { ...rest, ...listed } };
}

/**
 * The documents without the device's own field, as every build before held them: what a report's truth holds of
 * each document whole, so that its earlier (1.0) fingerprint is still the build before's (Build 230's) to the byte.
 */
export function withoutListedPageIndexes(documents: ReferenceDocument[]): ReferenceDocument[] {
  const held = (document: ReferenceDocument) =>
    'listedPageIndex' in document || 'keptPageIndex' in document || CITATION_PAGE_INDEX_KEY in document;
  if (!documents.some(held)) return documents;
  return documents.map(document => {
    if (!held(document)) return document;
    const { listedPageIndex: _listed, citationPageIndex: _key, ...asBefore } = withoutEarlierKeptIndex(document);
    return asBefore;
  });
}

/** Read back (saved documents, the backup, a list's result): null is the list's "none", kept as such. */
export function listedPageIndexField(value: unknown): { listedPageIndex?: ReferenceDocumentListedPageIndex | null } {
  if (value === null) return { listedPageIndex: null };
  const listed = normalizeListedPageIndex(value);
  return listed ? { listedPageIndex: listed } : {};
}

function isDrawing(document: Partial<ReferenceDocument>) {
  return canonicalReferenceCategory({ category: document.category ?? '' }) === 'drawing';
}

/**
 * The earlier high-3 commit kept, as keptPageIndex, an index made from the device's own reading or a live change:
 * never read, never sent.
 */
function withoutEarlierKeptIndex<T extends ReferenceDocument>(document: T): T {
  if (!('keptPageIndex' in document)) return document;
  const { keptPageIndex: _earlier, ...rest } = document as T & { keptPageIndex?: unknown };
  return rest as T;
}

function forTheCurrentFile(slice: ReferenceDocumentListedPageIndex, document: ReferenceDocument) {
  const file = canonicalSha256(document.contentSha256);
  return !slice.sourceSha256 || !file || slice.sourceSha256 === file;
}

/** Of pages in the cloud's form: the pages with a region a citation can pick, and of those regions only what it reads. */
function citationSliceOf(pages: readonly ReferenceDocumentExtractedPage[]): ReferenceDocumentExtractedPage[] {
  return pages.flatMap(page => {
    const regions = (page.regions ?? []).filter(citableRegion).map(sliceRegion);
    return regions.length ? [{ pageNumber: page.pageNumber, sheetNumber: page.sheetNumber ?? null, regions }] : [];
  });
}

function sliceRegion(region: ReferenceDocumentRegion): ReferenceDocumentRegion {
  return {
    id: region.id,
    label: region.label ?? null,
    areaNames: [...(region.areaNames ?? [])],
    confidence: region.confidence ?? null,
    x: region.x,
    y: region.y,
    width: region.width,
    height: region.height,
  } as ReferenceDocumentRegion;
}

/** What AuthoritativeDocumentSystem.selectAutomaticDrawingExcerpt can ever pick, whatever the work areas are. */
function citableRegion(region: ReferenceDocumentRegion) {
  return regionShape(region) && ((region.areaNames ?? []).length > 0 || Boolean(region.label)) &&
    region.width > 0 && region.height > 0 && (region.confidence ?? 0) > 0;
}

function regionShape(region: unknown): region is ReferenceDocumentRegion {
  const candidate = region as ReferenceDocumentRegion | null;
  return Boolean(candidate) && typeof candidate === 'object' && typeof candidate!.id === 'string' &&
    [candidate!.x, candidate!.y, candidate!.width, candidate!.height].every(Number.isFinite);
}

function normalizeListedPageIndex(value: unknown): ReferenceDocumentListedPageIndex | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (normalizedListedPageIndexes.has(value)) return normalizedListedPageIndexes.get(value) ?? null;
  const normalized = readListedPageIndex(value as Record<string, unknown>);
  normalizedListedPageIndexes.set(value, normalized);
  if (normalized) normalizedListedPageIndexes.set(normalized, normalized);
  return normalized;
}

/** A slice as saved or listed: kept only in the shape it was written in ([] pages: indexed, nothing to cite). */
function readListedPageIndex(record: Record<string, unknown>): ReferenceDocumentListedPageIndex | null {
  if (!Array.isArray(record.pages)) return null;
  const pages = record.pages.flatMap(value => {
    const page = value as ReferenceDocumentExtractedPage | null;
    if (!page || typeof page !== 'object' || !Number.isInteger(page.pageNumber) || !Array.isArray(page.regions)) return [];
    const regions = page.regions.filter(regionShape);
    return regions.length === page.regions.length ? [page] : [{ ...page, regions }];
  });
  const sourceSha256 = canonicalSha256(record.sourceSha256);
  const asSaved = Object.keys(record).length === 2 && record.sourceSha256 === sourceSha256 &&
    pages.length === record.pages.length && pages.every((page, index) => page === (record.pages as unknown[])[index]);
  return asSaved ? record as ReferenceDocumentListedPageIndex : { sourceSha256, pages };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function canonicalSha256(value: unknown) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

function clean(value: unknown) {
  return sanitizeECOSDocumentText(value);
}

function rounded(value: number, places = 5) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
