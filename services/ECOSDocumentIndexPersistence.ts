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
  const pages = (document.extractedPages ?? []).map(rawPage => {
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
  return {
    ...document,
    extractedText: pages.length > 0
      ? null
      : clean(document.extractedText).slice(0, MAX_FALLBACK_TEXT_CHARACTERS) || null,
    extractedPages: pages,
  };
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
 * HIGH ITEM 3 (the owner's instruction of 13 Oct 2026, the three high items; review pass 3 (reports), P3-3), AS
 * DECIDED AFTER THE LIVE LIST WAS READ (the coordinator's decision, option (c)).
 * Which drawing piece a report shows, and so its fingerprint, is read from the drawing's page index. On the live
 * system the cloud's document list (dave_list_reference_document_metadata) returns document_data without
 * extractedPages, while a live change carries the row whole and the device that read the file holds its own
 * reading. Each device therefore showed the piece at other moments, and a report read as changed, and was not known
 * across devices, each time the piece came or went.
 *
 * THE RULE: a report cites a drawing piece only from the drawing's index AS THE DOCUMENT LIST GIVES IT, the one
 * copy every device gets. Never from the device's own reading, never from a live-change row, never from a copy that
 * came from either. On the live system today the list carries none: no device shows a piece, so a report never
 * changes because of a drawing. If the list carries a citation slice under the key read below (option (b1)), every
 * device shows the same piece with no further app change.
 *  - THE ONE READER of the list's copy: listedPageIndexOfTheListRow (the only place that knows which key the list
 *    carries it under).
 *  - Phone and iPad: the list's copy is held as ReferenceDocument.listedPageIndex (null: the list carries none),
 *    saved and read back at launch, and the merge keeps the list's verdict across live changes
 *    (DAVECloudRecovery). The Reports screen cites only from it (referenceDocumentsCitedAsListed).
 *  - Desktop: a live-change row keeps the list's copy of the index of the row it replaces
 *    (liveDocumentRowWithTheListedIndex), so what it holds is only ever what its list gave.
 *  - Sent back (withListedPageIndexForTheCloudRow): where an edit would send the row with no index, the list's copy
 *    goes in its place, so that under (b1) an edit never removes it. Today it never has anything to send.
 *  - An index is used and sent only for the file it was read from.
 */
const listedPagesBySourcePages = new WeakMap<readonly ReferenceDocumentExtractedPage[], ReferenceDocumentExtractedPage[]>();
const citedAsListedByDocument = new WeakMap<ReferenceDocument, ReferenceDocument>();
const normalizedListedPageIndexes = new WeakMap<object, ReferenceDocumentListedPageIndex | null>();

/** The documents as the document list gave them: a drawing holds the part of the list's copy a citation reads, or null. */
export function compactECOSReferenceDocumentsFromTheDocumentList(
  documents: readonly ReferenceDocument[],
): ReferenceDocument[] {
  return documents.map(document => {
    const { listedPageIndex: _neverInARow, ...row } = withoutEarlierKeptIndex(document);
    const compact = compactECOSDocumentMetadataForCloud(row);
    return isDrawing(row) ? { ...compact, listedPageIndex: listedPageIndexOfTheListRow(row) } : compact;
  });
}

/**
 * THE ONE READER of the index as the document list carries it: today the key extractedPages (which the live list
 * leaves out, so: null). Of what it carries, the part a citation can be read from (citablePagesOf), with the
 * checksum of the file it was read from.
 */
export function listedPageIndexOfTheListRow(row: ReferenceDocument): ReferenceDocumentListedPageIndex | null {
  const source = row.extractedPages ?? [];
  if (source.length === 0) return null;
  let pages = listedPagesBySourcePages.get(source);
  if (!pages) {
    pages = citablePagesOf(compactECOSDocumentIndexForCloud({ ...row, extractedText: null }).extractedPages ?? []);
    listedPagesBySourcePages.set(source, pages);
  }
  return pages.length > 0
    ? { sourceSha256: canonicalSha256(row.indexedContentSha256) ?? canonicalSha256(row.contentSha256), pages }
    : null;
}

/** The phone's and iPad's Reports screen: each drawing with the list's copy of its index as its index, or none. */
export function referenceDocumentsCitedAsListed(documents: ReferenceDocument[]): ReferenceDocument[] {
  return documents.map(document => {
    if (!isDrawing(document)) return document;
    const known = citedAsListedByDocument.get(document);
    if (known) return known;
    const pages = listedPageIndexForThisFile(document)?.pages ?? [];
    const cited = pages.length === 0 && (document.extractedPages ?? []).length === 0
      ? document
      : { ...document, extractedPages: pages };
    citedAsListedByDocument.set(document, cited);
    return cited;
  });
}

/** The desktop: a live-change row of a document keeps the index the list gave for the row it replaces, never its own. */
export function liveDocumentRowWithTheListedIndex(
  candidate: Readonly<Record<string, unknown>>,
  held: unknown,
): Readonly<Record<string, unknown>> {
  const data = candidate.document_data;
  if (!isRecord(data)) return candidate;
  const { extractedPages: _live, ...rest } = data;
  const heldData = isRecord(held) && isRecord(held.document_data) ? held.document_data : null;
  const sameFile = heldData && canonicalSha256(heldData.contentSha256) === canonicalSha256(data.contentSha256);
  return {
    ...candidate,
    document_data: heldData && sameFile && 'extractedPages' in heldData ? { ...rest, extractedPages: heldData.extractedPages } : rest,
  };
}

/** The cloud's row of a document this device sends: the list's copy in the row's own place where the row has none. */
export function withListedPageIndexForTheCloudRow(
  row: ReferenceDocument,
  document: ReferenceDocument,
): ReferenceDocument {
  const { listedPageIndex: _deviceOnly, ...sent } = withoutEarlierKeptIndex(row);
  if ((sent.extractedPages ?? []).length > 0) return sent;
  const listed = listedPageIndexForThisFile(document);
  return listed ? { ...sent, extractedText: null, extractedPages: listed.pages } : sent;
}

/**
 * The documents without the device's own field, as every build before held them: what a report's truth holds of
 * each document whole, so that its earlier (1.0) fingerprint is still the build before's (Build 230's) to the byte.
 */
export function withoutListedPageIndexes(documents: ReferenceDocument[]): ReferenceDocument[] {
  if (!documents.some(document => 'listedPageIndex' in document || 'keptPageIndex' in document)) return documents;
  return documents.map(document => {
    if (!('listedPageIndex' in document) && !('keptPageIndex' in document)) return document;
    const { listedPageIndex: _listed, ...held } = withoutEarlierKeptIndex(document);
    return held;
  });
}

/** Read back (saved documents, the backup, a list's result): null is the list's "none", kept as such. */
export function listedPageIndexField(value: unknown): { listedPageIndex?: ReferenceDocumentListedPageIndex | null } {
  if (value === null) return { listedPageIndex: null };
  const listed = normalizeListedPageIndex(value);
  return listed ? { listedPageIndex: listed } : {};
}

function isDrawing(document: ReferenceDocument) {
  return canonicalReferenceCategory(document) === 'drawing';
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

function listedPageIndexForThisFile(document: ReferenceDocument) {
  if (!isDrawing(document)) return null;
  const listed = normalizeListedPageIndex(document.listedPageIndex);
  const file = canonicalSha256(document.contentSha256);
  return listed && (!listed.sourceSha256 || !file || listed.sourceSha256 === file) ? listed : null;
}

function citablePagesOf(pages: readonly ReferenceDocumentExtractedPage[]): ReferenceDocumentExtractedPage[] {
  return pages.flatMap(page => {
    const regions = page.regions ?? [];
    if (!regions.some(citableRegion)) return [];
    const provingSheet = new Set((page.sheetMappingEvidence ?? []).map(evidence => evidence?.id).filter(Boolean));
    const {
      visualCoverage: _coverage,
      sheetMappingCandidates: _candidates,
      text: _text,
      regions: _regions,
      ...kept
    } = page;
    return [{
      ...kept,
      text: null,
      regions: regions.filter(region => regionShape(region) && (citableRegion(region) || provingSheet.has(region.id))),
    }];
  });
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

function readListedPageIndex(record: Record<string, unknown>): ReferenceDocumentListedPageIndex | null {
  const pages = (Array.isArray(record.pages) ? record.pages : []).flatMap(value => {
    const page = value as ReferenceDocumentExtractedPage | null;
    if (!page || typeof page !== 'object' || !Number.isInteger(page.pageNumber) || !Array.isArray(page.regions)) return [];
    const regions = page.regions.filter(regionShape);
    return regions.length === page.regions.length ? [page] : [{ ...page, regions }];
  });
  if (!pages.some(page => (page.regions ?? []).some(citableRegion))) return null;
  const sourceSha256 = canonicalSha256(record.sourceSha256);
  const asSaved = Object.keys(record).length === 2 && record.sourceSha256 === sourceSha256 &&
    pages.length === (record.pages as unknown[]).length && pages.every((page, index) => page === (record.pages as unknown[])[index]);
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
