import {
  compactECOSDocumentIndexForCloud,
  compactECOSDocumentMetadataForCloud,
} from '../../services/ECOSDocumentIndexPersistence';
import type { ReferenceDocument } from '../../types';

describe('ECOS document index persistence', () => {
  it('keeps Drive source/readiness metadata without duplicating extracted pages in the operational row', () => {
    const compact = compactECOSDocumentMetadataForCloud({
      id: 'drive-drawing-1',
      name: 'A101',
      originalFileName: 'A101.pdf',
      uri: '',
      category: 'Drawing',
      notes: '',
      isCurrent: false,
      importedAt: '2026-08-04T12:00:00.000Z',
      extractionStatus: 'complete',
      sourcePageCount: 2,
      searchablePageCount: 2,
      extractedText: 'duplicated full text',
      extractedPages: [{ pageNumber: 1, text: 'page one', regions: [] }],
    });

    expect(compact).toMatchObject({
      extractionStatus: 'complete',
      sourcePageCount: 2,
      searchablePageCount: 2,
      extractedText: null,
      extractedPages: [],
    });
  });

  it('does not duplicate searchable text when exact page regions exist', () => {
    const text = 'Provide guardrails at every open parking edge.';
    const document: ReferenceDocument = {
      id: 'drawing-1',
      name: 'A101',
      originalFileName: 'A101.pdf',
      uri: 'file:///A101.pdf',
      category: 'Drawing',
      notes: '',
      isCurrent: true,
      importedAt: '2026-08-04T12:00:00.000Z',
      extractedText: text,
      extractionStatus: 'complete',
      extractedPages: [{
        pageNumber: 2,
        text,
        regions: [{
          id: 'line-1',
          label: text,
          text,
          areaNames: ['North Lot', 'North Lot'],
          x: 0.123456789,
          y: 0.2,
          width: 0.4,
          height: 0.05,
          confidence: 0.987654,
          source: 'embedded_text',
        }],
      }],
    };

    const compact = compactECOSDocumentIndexForCloud(document);

    expect(compact.extractedText).toBeNull();
    expect(compact.extractedPages?.[0].text).toBeNull();
    expect(compact.extractedPages?.[0].regions?.[0]).toMatchObject({
      text,
      label: null,
      areaNames: ['North Lot'],
      x: 0.12346,
      confidence: 0.9877,
    });
    expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify(document).length);
  });

  it('keeps page text when no trustworthy coordinates are available', () => {
    const compact = compactECOSDocumentIndexForCloud({
      id: 'legacy-1',
      name: 'Legacy specification',
      originalFileName: 'spec.pdf',
      uri: 'file:///spec.pdf',
      category: 'Specification',
      notes: '',
      isCurrent: true,
      importedAt: '2026-08-04T12:00:00.000Z',
      extractedText: 'Section 055200 requires guardrails.',
      extractedPages: [{
        pageNumber: 14,
        text: 'Section 055200 requires guardrails.',
        regions: [],
      }],
    });

    expect(compact.extractedText).toBeNull();
    expect(compact.extractedPages?.[0].text).toBe('Section 055200 requires guardrails.');
  });

  it('sanitizes legacy page metadata and regions before jsonb persistence', () => {
    const compact = compactECOSDocumentIndexForCloud({
      id: 'cad-export-1',
      name: 'Canopy drawing',
      originalFileName: 'canopy.pdf',
      uri: 'file:///canopy.pdf',
      category: 'Drawing',
      notes: '',
      isCurrent: true,
      importedAt: '2026-08-04T12:00:00.000Z',
      extractedPages: [{
        pageNumber: 1,
        sheetNumber: 'A\u000001',
        title: 'Canopy\u0007 A',
        text: 'Provide\u001F guardrails.',
        regions: [{
          id: 'line-1',
          text: 'Provide\u0000 guardrails.',
          x: 0.1,
          y: 0.2,
          width: 0.4,
          height: 0.05,
        }],
      }],
    });

    expect(compact.extractedPages?.[0]).toMatchObject({
      // A raw label without exact page-bound provenance must remain a
      // PDF-page-only citation after sanitization.
      sheetNumber: null,
      title: 'Canopy A',
      text: null,
      regions: [{ text: 'Provide guardrails.' }],
    });
    expect(JSON.stringify(compact)).not.toMatch(/\\u0000|\\u0007|\\u001f/i);
  });

  it('preserves exact page-bound sheet provenance through compact persistence', () => {
    const evidence = [{
      id: 'bookmark-e25',
      pageNumber: 11,
      source: 'pdf_bookmark' as const,
      text: 'E11-E-2.5',
      normalizedBounds: null,
      renderedCorroborated: true as const,
      renderedCorroboratingRegionIds: ['rendered-e25'],
      renderedCorroboratingSources: ['sheet_identity_ocr_page_bound_validated'],
    }];
    const compact = compactECOSDocumentIndexForCloud({
      id: 'drawing-2321-electrical',
      name: '2321 Electrical',
      originalFileName: 'electrical.pdf',
      uri: 'file:///electrical.pdf',
      category: 'Drawing',
      notes: '',
      isCurrent: true,
      importedAt: '2026-08-09T07:00:00.000Z',
      extractedPages: [{
        pageNumber: 11,
        sheetNumber: 'E-2.5',
        sheetMappingStatus: 'verified',
        sheetMappingSource: 'pdf_bookmark',
        sheetMappingEvidence: evidence,
        documentStructuralIdentity: {
          sheetNumber: 'E-2.5',
          source: 'pdf_bookmark',
          evidence,
        },
        assurance: {
          accepted: true,
          method: 'ecos-assurance-test/1.0',
          checks: { sheetMappingUsable: true },
          failureCodes: [],
        },
        text: 'CENTER TOTAL 35',
        regions: [{
          id: 'rendered-e25',
          text: 'E-2.5',
          searchable: true,
          x: 0.82,
          y: 0.9,
          width: 0.12,
          height: 0.04,
          source: 'ocr',
          rawSource: 'sheet_identity_ocr_page_bound_validated',
        }],
      }],
    });

    expect(compact.extractedPages?.[0]).toMatchObject({
      pageNumber: 11,
      sheetNumber: 'E-2.5',
      sheetMappingStatus: 'verified',
      sheetMappingSource: 'pdf_bookmark',
      sheetMappingEvidence: evidence,
      documentStructuralIdentity: {
        sheetNumber: 'E-2.5',
        source: 'pdf_bookmark',
        evidence,
      },
      assurance: {
        accepted: true,
        checks: { sheetMappingUsable: true },
      },
    });
  });

  it('downgrades cross-page sheet evidence instead of persisting a forged exact sheet', () => {
    const compact = compactECOSDocumentIndexForCloud({
      id: 'drawing-2321-forged',
      name: '2321 forged drawing',
      originalFileName: 'forged.pdf',
      uri: 'file:///forged.pdf',
      category: 'Drawing',
      notes: '',
      isCurrent: true,
      importedAt: '2026-08-09T07:00:00.000Z',
      extractedPages: [{
        pageNumber: 11,
        sheetNumber: 'E-2.5',
        sheetMappingStatus: 'verified',
        sheetMappingSource: 'pdf_bookmark',
        sheetMappingEvidence: [{
          id: 'bookmark-e25-wrong-page',
          pageNumber: 12,
          source: 'pdf_bookmark',
          text: 'E-2.5',
          normalizedBounds: null,
        }],
        text: 'CENTER TOTAL 35',
        regions: [],
      }],
    });

    expect(compact.extractedPages?.[0]).toMatchObject({
      pageNumber: 11,
      sheetNumber: null,
      sheetMappingStatus: 'unverified',
      sheetMappingSource: undefined,
      sheetMappingEvidence: undefined,
      documentStructuralIdentity: undefined,
    });
  });
});
