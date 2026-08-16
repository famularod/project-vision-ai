import { assertEquals } from 'jsr:@std/assert@1.0.18';
import {
  bookmarkTextMatchesSheetIdentity,
  ECOS_PDF_ANNOTATION_RENDERED_SOURCES,
  ECOS_RENDERED_SHEET_IDENTITY_SOURCES,
  renderedSheetIdentityMatchesCurrentRegions,
  renderedTextContainsExactSheetIdentity,
  strictNormalizedBounds,
  strictPDFAnnotationRenderedCorroboration,
  strictPositiveInteger,
  strictRenderedSheetIdentityCorroboration,
  validPDFAnnotationEvidenceId,
} from './ecos-sheet-provenance-validation.ts';

Deno.test('accepts exact numeric sheet-provenance page and bounds values', () => {
  assertEquals(strictPositiveInteger(6), 6);
  assertEquals(validPDFAnnotationEvidenceId('pdf-annotation-324-page-6', 6), true);
  assertEquals(strictNormalizedBounds({
    x: 0.952546,
    y: 0.907986,
    width: 0.013889,
    height: 0.013889,
  }), {
    x: 0.952546,
    y: 0.907986,
    width: 0.013889,
    height: 0.013889,
  });
});

Deno.test('accepts and preserves exact rendered OCR corroboration for PDF annotation identity', () => {
  assertEquals(strictPDFAnnotationRenderedCorroboration({
    renderedCorroborated: true,
    renderedCorroboratingRegionIds: ['rendered-c6'],
    renderedCorroboratingSources: ['sheet_identity_ocr_vertical_outline'],
  }), {
    renderedCorroborated: true,
    renderedCorroboratingRegionIds: ['rendered-c6'],
    renderedCorroboratingSources: ['sheet_identity_ocr_vertical_outline'],
  });
  assertEquals(ECOS_PDF_ANNOTATION_RENDERED_SOURCES.length, 5);
  assertEquals(ECOS_RENDERED_SHEET_IDENTITY_SOURCES.length, 5);
});

Deno.test('accepts an exact bookmark receipt bound to the current rendered region', () => {
  const receipt = {
    renderedCorroborated: true,
    renderedCorroboratingRegionIds: ['rendered-e-2.7'],
    renderedCorroboratingSources: ['sheet_identity_ocr_page_bound_validated'],
  } as const;
  const regions = [{
    id: 'rendered-e-2.7',
    text: 'SHEET NUMBER E-2.7',
    source: 'ocr',
    rawSource: 'sheet_identity_ocr_page_bound_validated',
    searchable: true,
  }];
  assertEquals(strictRenderedSheetIdentityCorroboration(receipt), receipt);
  assertEquals(
    renderedSheetIdentityMatchesCurrentRegions(receipt, regions, 'E-2.7'),
    true,
  );
  assertEquals(renderedTextContainsExactSheetIdentity('SHEET NUMBER E-2.7', 'E-2.7'), true);
  assertEquals(bookmarkTextMatchesSheetIdentity('E13-E2.7', 'E-2.7'), true);
  assertEquals(bookmarkTextMatchesSheetIdentity('A03-A101', 'A101'), true);
  assertEquals(bookmarkTextMatchesSheetIdentity('C06-C6', 'C6'), true);
  assertEquals(bookmarkTextMatchesSheetIdentity('A12A-A1.5A', 'A-1.5A'), true);
  assertEquals(bookmarkTextMatchesSheetIdentity('SIP SHT 2--', 'SIP-SHT-2'), true);
  assertEquals(renderedTextContainsExactSheetIdentity('SHEET NUMBER A-101', 'A101'), true);
});

Deno.test('rejects bookmark receipts with absent, stale, or non-exact rendered proof', () => {
  const receipt = {
    renderedCorroborated: true,
    renderedCorroboratingRegionIds: ['rendered-e-2.7'],
    renderedCorroboratingSources: ['sheet_identity_ocr_page_bound_validated'],
  };
  const region = {
    id: 'rendered-e-2.7',
    text: 'SHEET NUMBER E-2.7',
    rawSource: 'sheet_identity_ocr_page_bound_validated',
    searchable: true,
  };
  const adversaries: unknown[] = [
    [],
    [{ ...region, id: 'other' }],
    [region, region],
    [{ ...region, text: 'SHEET NUMBER E-2.70' }],
    [{ ...region, searchable: false }],
    [{ ...region, rawSource: 'title_block_ocr' }],
  ];
  for (const regions of adversaries) {
    assertEquals(
      renderedSheetIdentityMatchesCurrentRegions(receipt, regions, 'E-2.7'),
      false,
    );
  }
  assertEquals(renderedTextContainsExactSheetIdentity('E-2.70', 'E-2.7'), false);
  assertEquals(bookmarkTextMatchesSheetIdentity('E-2.7 LIGHTING', 'E-2.7'), false);
  assertEquals(bookmarkTextMatchesSheetIdentity('E13-E2.8', 'E-2.7'), false);
});

Deno.test('rejects fabricated or malformed PDF annotation rendered corroboration', () => {
  const valid = {
    renderedCorroborated: true,
    renderedCorroboratingRegionIds: ['rendered-c6'],
    renderedCorroboratingSources: ['fixed_visual_tile_coordinate_ocr'],
  };
  for (const value of [
    { ...valid, renderedCorroborated: false },
    { ...valid, renderedCorroboratingRegionIds: [] },
    { ...valid, renderedCorroboratingRegionIds: ['rendered-c6', 'rendered-c6'] },
    { ...valid, renderedCorroboratingSources: [] },
    { ...valid, renderedCorroboratingSources: ['pdf_annotation'] },
    { ...valid, renderedCorroboratingSources: ['title_block_ocr', 'title_block_ocr'] },
  ]) assertEquals(strictPDFAnnotationRenderedCorroboration(value), null);
});

Deno.test('rejects coerced, fractional, and non-finite page values', () => {
  for (const value of ['6', 6.9, true, false, Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
    assertEquals(strictPositiveInteger(value), null);
  }
  assertEquals(validPDFAnnotationEvidenceId('pdf-annotation-324-page-6', 6.9), false);
});

Deno.test('rejects string, boolean, non-finite, and out-of-range normalized bounds', () => {
  const valid = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 };
  const rejected: unknown[] = [
    { ...valid, x: '0.1' },
    { ...valid, y: true },
    { ...valid, width: Number.NaN },
    { ...valid, height: Number.POSITIVE_INFINITY },
    { ...valid, x: -0.1 },
    { ...valid, y: 1.1 },
    { ...valid, width: 0 },
    { ...valid, height: -0.1 },
    { x: 0.9, y: 0.2, width: 0.2, height: 0.4 },
    { x: 0.1, y: 0.9, width: 0.3, height: 0.2 },
    [],
    null,
  ];
  for (const value of rejected) assertEquals(strictNormalizedBounds(value), null);
});
