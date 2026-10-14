import type {
  ReferenceDocument,
  ReferenceDocumentExtractedPage,
  ReferenceDocumentKeptPageIndex,
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
 */
export function compactECOSReferenceDocumentsForOperationalRead(
  documents: readonly ReferenceDocument[],
): ReferenceDocument[] {
  // High item 3: a drawing keeps the part of its page index a report cites from (see below), saved on the device
  // and taken from the cloud's row on download; everything else of the index is left out, as before.
  return documents.map(document => {
    const { keptPageIndex: _held, ...compact } = compactECOSDocumentMetadataForCloud(document);
    const kept = keptPageIndexOf(document);
    return kept ? { ...compact, keptPageIndex: kept } : compact;
  });
}

/*
 * HIGH ITEM 3 (the owner's instruction of 13 Oct 2026, the three high items; review pass 3 (reports), P3-3).
 * Which drawing a report cites, and so its fingerprint, is read from the drawing's page index. The phone held that
 * index only in the session that read the file: it saved and downloaded its documents without it (above), so after
 * the app had been closed its report no longer showed the piece of the drawing, and the iPad never had it, while the
 * desktop read it from the cloud's row. Neither device knew the report the other had sent.
 *
 * The coordinator's decision: every device holds the same page index for a drawing, and keeps it.
 *  - What is kept: of the index AS THE CLOUD'S ROW HOLDS IT (compactECOSDocumentIndexForCloud), the pages and regions
 *    a citation can be read from (a region that names a work area or carries a label of its own, with a size and a
 *    confidence), and on such a page the regions its sheet number is proved by; each kept one unchanged, in its
 *    order. The citation function picks from these exactly what it picks from the whole row. A drawing set's other
 *    lines are not kept, so the saved documents stay small (the reason the index was left out).
 *  - Where: ReferenceDocument.keptPageIndex, on the phone and the iPad only (in memory, in the saved documents, in
 *    the upload queue and the app's own backup). Never in the cloud's row: there the index has one place,
 *    document_data.extractedPages, the place the desktop reads.
 *  - Which copy wins: THE CLOUD'S ROW, at every download and live change, as for every other field of the index
 *    (DAVECloudRecovery.mergeCloudReferenceDocumentAuthority). A device that has read the file cites from its own
 *    reading until the cloud's copy comes back. And an index is used only for the file it was read from: one of
 *    another file (a new revision put in its place) is never cited and never sent.
 *  - Google Drive drawings (their row carries no index): nothing is kept, as before.
 */
const keptPagesBySourcePages = new WeakMap<readonly ReferenceDocumentExtractedPage[], ReferenceDocumentExtractedPage[]>();
const withKeptPageIndexByDocument = new WeakMap<ReferenceDocument, ReferenceDocument>();
/** The device's documents are cut down again at every render of the app (App.tsx's save): each kept index is read once. */
const normalizedKeptPageIndexes = new WeakMap<object, ReferenceDocumentKeptPageIndex | null>();

/** The page index this device keeps for a document: of its own index where it holds one, else the one it kept. */
export function keptPageIndexOf(document: ReferenceDocument): ReferenceDocumentKeptPageIndex | null {
  if (!keepsPageIndex(document)) return null;
  const source = document.extractedPages ?? [];
  if (source.length === 0) return normalizeKeptPageIndex(document.keptPageIndex);
  let pages = keptPagesBySourcePages.get(source);
  if (!pages) {
    pages = citablePagesOf(compactECOSDocumentIndexForCloud({ ...document, extractedText: null }).extractedPages ?? []);
    keptPagesBySourcePages.set(source, pages);
  }
  return pages.length > 0
    ? { sourceSha256: canonicalSha256(document.indexedContentSha256) ?? canonicalSha256(document.contentSha256), pages }
    : null;
}

/** A document as a report cites from it: its kept index in place of the one it does not hold. Otherwise itself. */
export function referenceDocumentWithKeptPageIndex(document: ReferenceDocument): ReferenceDocument {
  if ((document.extractedPages ?? []).length > 0 || !document.keptPageIndex) return document;
  const known = withKeptPageIndexByDocument.get(document);
  if (known) return known;
  const kept = keptPageIndexForThisFile(document);
  const cited = kept ? { ...document, extractedPages: kept.pages } : document;
  withKeptPageIndexByDocument.set(document, cited);
  return cited;
}

/** The cloud's row of a document this device sends: the kept index in the row's own place where the row has none. */
export function withKeptPageIndexForTheCloudRow(
  row: ReferenceDocument,
  document: ReferenceDocument,
): ReferenceDocument {
  const { keptPageIndex: _deviceOnly, ...sent } = row;
  if ((sent.extractedPages ?? []).length > 0) return sent;
  const kept = keptPageIndexForThisFile(document);
  return kept ? { ...sent, extractedText: null, extractedPages: kept.pages } : sent;
}

/**
 * The documents without the kept index, as every build before held them: what a report's truth holds of each
 * document whole, so that its earlier (1.0) fingerprint is still the build before's (Build 230's) to the byte.
 */
export function withoutKeptPageIndexes(documents: ReferenceDocument[]): ReferenceDocument[] {
  // The very list where no document holds one (the screen's list is then the app's own, as before).
  if (!documents.some(document => 'keptPageIndex' in document)) return documents;
  return documents.map(document => {
    if (!('keptPageIndex' in document)) return document;
    const { keptPageIndex: _kept, ...held } = document;
    return held;
  });
}

/** The kept index read back (saved documents, the backup, the queue): kept only if it has the shape it was saved in. */
export function keptPageIndexField(value: unknown): { keptPageIndex?: ReferenceDocumentKeptPageIndex } {
  const kept = normalizeKeptPageIndex(value);
  return kept ? { keptPageIndex: kept } : {};
}

function keepsPageIndex(document: ReferenceDocument) {
  return document.sourceProvider !== 'google_drive' && canonicalReferenceCategory(document) === 'drawing';
}

function keptPageIndexForThisFile(document: ReferenceDocument) {
  if (!keepsPageIndex(document)) return null;
  const kept = normalizeKeptPageIndex(document.keptPageIndex);
  const file = canonicalSha256(document.contentSha256);
  return kept && (!kept.sourceSha256 || !file || kept.sourceSha256 === file) ? kept : null;
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
      regions: regions.filter(region => keptRegionShape(region) && (citableRegion(region) || provingSheet.has(region.id))),
    }];
  });
}

/** What AuthoritativeDocumentSystem.selectAutomaticDrawingExcerpt can ever pick, whatever the work areas are. */
function citableRegion(region: ReferenceDocumentRegion) {
  return keptRegionShape(region) && ((region.areaNames ?? []).length > 0 || Boolean(region.label)) &&
    region.width > 0 && region.height > 0 && (region.confidence ?? 0) > 0;
}

function keptRegionShape(region: unknown): region is ReferenceDocumentRegion {
  const candidate = region as ReferenceDocumentRegion | null;
  return Boolean(candidate) && typeof candidate === 'object' && typeof candidate!.id === 'string' &&
    [candidate!.x, candidate!.y, candidate!.width, candidate!.height].every(Number.isFinite);
}

function normalizeKeptPageIndex(value: unknown): ReferenceDocumentKeptPageIndex | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (normalizedKeptPageIndexes.has(value)) return normalizedKeptPageIndexes.get(value) ?? null;
  const normalized = readKeptPageIndex(value as Record<string, unknown>);
  normalizedKeptPageIndexes.set(value, normalized);
  if (normalized) normalizedKeptPageIndexes.set(normalized, normalized);
  return normalized;
}

function readKeptPageIndex(record: Record<string, unknown>): ReferenceDocumentKeptPageIndex | null {
  const pages = (Array.isArray(record.pages) ? record.pages : []).flatMap(value => {
    const page = value as ReferenceDocumentExtractedPage | null;
    if (!page || typeof page !== 'object' || !Number.isInteger(page.pageNumber) || !Array.isArray(page.regions)) return [];
    const regions = page.regions.filter(keptRegionShape);
    return regions.length === page.regions.length ? [page] : [{ ...page, regions }];
  });
  if (!pages.some(page => (page.regions ?? []).some(citableRegion))) return null;
  const sourceSha256 = canonicalSha256(record.sourceSha256);
  const asSaved = Object.keys(record).length === 2 && record.sourceSha256 === sourceSha256 &&
    pages.length === (record.pages as unknown[]).length && pages.every((page, index) => page === (record.pages as unknown[])[index]);
  return asSaved ? record as ReferenceDocumentKeptPageIndex : { sourceSha256, pages };
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
