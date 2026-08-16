import type { ReferenceDocument } from '../types';
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

function clean(value: unknown) {
  return sanitizeECOSDocumentText(value);
}

function rounded(value: number, places = 5) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
