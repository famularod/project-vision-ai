import type { SupabaseClient } from '@supabase/supabase-js';
import {
  hydrateECOSDocumentsFromCloudSearch,
  replaceECOSDocumentCloudIndex,
  searchECOSDocumentCloudIndex,
} from '../../services/ECOSDocumentCloudIndex';
import type { ReferenceDocument } from '../../types';

function drawing(): ReferenceDocument {
  return {
    id: 'drawing-a101',
    name: 'Life Safety Plan',
    originalFileName: 'A101.pdf',
    uri: '',
    category: 'Drawing',
    notes: '',
    isCurrent: true,
    importedAt: '2026-08-04T12:00:00.000Z',
    projectId: 'project-2321',
    contentSha256: 'a'.repeat(64),
    indexedContentSha256: 'a'.repeat(64),
    extractionMethod: 'embedded_text',
    extractedPages: [{
      pageNumber: 3,
      sheetNumber: 'A101',
      text: 'Provide guardrails at open parking edges.',
      regions: [{
        id: 'note-1',
        text: 'Provide guardrails at open parking edges.',
        x: 0.1,
        y: 0.2,
        width: 0.4,
        height: 0.05,
        confidence: 0.99,
        source: 'embedded_text',
      }],
    }],
  };
}

function bookmarkProvenance(pageNumber = 3, sheetNumber = 'A101') {
  const evidence = [{
    id: `bookmark-${pageNumber}-${sheetNumber}`,
    pageNumber,
    source: 'pdf_bookmark',
    text: sheetNumber,
    normalizedBounds: null,
  }];
  return {
    sheetMappingStatus: 'verified',
    sheetMappingSource: 'pdf_bookmark',
    sheetMappingEvidence: evidence,
    documentStructuralIdentity: {
      sheetNumber,
      source: 'pdf_bookmark',
      evidence,
    },
    assurance: {
      accepted: true,
      method: 'ecos-assurance-test/1.0',
      checks: { sheetMappingUsable: true },
      failureCodes: [],
    },
  };
}

describe('ECOS shared cloud document index', () => {
  it('replaces the owner-scoped page and chunk index through one atomic RPC', async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [{ indexed_pages: 1, indexed_chunks: 1 }],
      error: null,
    });
    const client = { rpc } as unknown as SupabaseClient;

    await expect(replaceECOSDocumentCloudIndex({ client, document: drawing() })).resolves.toEqual({
      status: 'saved',
      indexedPages: 1,
      indexedChunks: 1,
      message: null,
    });
    expect(rpc).toHaveBeenCalledWith('ecos_replace_document_index', expect.objectContaining({
      p_document_id: 'drawing-a101',
      p_source_sha256: 'a'.repeat(64),
      p_extraction_method: 'embedded_text',
      p_pages: drawing().extractedPages,
    }));
  });

  it('keeps uploads compatible until the migration is deployed', async () => {
    const client = {
      rpc: jest.fn().mockResolvedValue({
        data: null,
        error: { code: 'PGRST202', message: 'function not found' },
      }),
    } as unknown as SupabaseClient;

    await expect(replaceECOSDocumentCloudIndex({ client, document: drawing() })).resolves.toMatchObject({
      status: 'unavailable',
      indexedPages: 0,
      indexedChunks: 0,
    });
  });

  it('prefers the Assurance-approved hosted search RPC without reading rows directly', async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [{ document_id: 'drawing-a101', page_number: 3, rank: 0.8 }],
      error: null,
    });
    const client = { rpc } as unknown as SupabaseClient;

    await expect(searchECOSDocumentCloudIndex({
      client,
      question: 'guardrail requirement',
      documentIds: ['drawing-a101', 'drawing-a101'],
      maximumResults: 200,
    })).resolves.toHaveLength(1);
    expect(rpc).toHaveBeenCalledWith('ecos_search_hosted_document_chunks', {
      p_search_query: 'guardrail requirement',
      p_document_ids: ['drawing-a101'],
      p_result_limit: 50,
    });
  });

  it('hydrates exact cloud-search regions only for documents missing a local page index', () => {
    const source = drawing();
    const withoutPages = {
      ...source,
      extractedPages: [],
      searchablePageCount: 1,
      sourcePageCount: 1,
    };
    const hydrated = hydrateECOSDocumentsFromCloudSearch([withoutPages], [{
      document_id: source.id,
      page_number: 3,
      region_id: 'note-1',
      chunk_text: 'Provide guardrails at open parking edges.',
      sheet_number: 'A101',
      confidence: 0.99,
      metadata: {
        ...bookmarkProvenance(),
        x: 0.1,
        y: 0.2,
        width: 0.4,
        height: 0.05,
        source: 'deterministic_label_block',
        reconstructionMethod: 'trusted_same_ocr_block',
        evidenceSources: ['ocr'],
        constituentEvidence: [{
          id: 'ocr-line-1',
          text: 'Provide guardrails',
          source: 'ocr',
          confidence: 0.98,
          bounds: { x: 0.1, y: 0.2, width: 0.2, height: 0.02 },
        }],
        corroboratingEvidence: [{
          id: 'native-note-1',
          text: 'Provide guardrails at open parking edges.',
          source: 'embedded_text',
          confidence: 0.99,
          bounds: { x: 0.1, y: 0.2, width: 0.4, height: 0.05 },
        }],
        areaNames: ['North Lot'],
      },
    }]);

    expect(hydrated[0].extractedPages?.[0]).toMatchObject({
      pageNumber: 3,
      sheetNumber: 'A101',
      regions: [{
        id: 'note-1',
        x: 0.1,
        y: 0.2,
        width: 0.4,
        height: 0.05,
        source: 'ocr',
        rawSource: 'deterministic_label_block',
        reconstructionMethod: 'trusted_same_ocr_block',
        evidenceSources: ['ocr'],
        constituentEvidence: [{ id: 'ocr-line-1' }],
        corroboratingEvidence: [{ id: 'native-note-1' }],
        areaNames: ['North Lot'],
      }],
    });
  });

  it('fails exact-sheet hydration closed when page chunks disagree on provenance', () => {
    const source = { ...drawing(), extractedPages: [] };
    const base = {
      document_id: source.id,
      page_number: 3,
      confidence: 0.99,
      metadata: { ...bookmarkProvenance(), x: 0.1, y: 0.2, width: 0.2, height: 0.04 },
    };
    const hydrated = hydrateECOSDocumentsFromCloudSearch([source], [{
      ...base,
      region_id: 'note-1',
      chunk_text: 'First note.',
      sheet_number: 'A101',
    }, {
      ...base,
      region_id: 'note-2',
      chunk_text: 'Second note.',
      sheet_number: 'A102',
      metadata: {
        ...bookmarkProvenance(3, 'A102'),
        x: 0.3,
        y: 0.2,
        width: 0.2,
        height: 0.04,
      },
    }]);

    expect(hydrated[0].extractedPages?.[0]).toMatchObject({
      pageNumber: 3,
      sheetNumber: null,
      sheetMappingStatus: 'unverified',
      sheetMappingEvidence: [],
      documentStructuralIdentity: null,
    });
  });

  it('keeps searchable page text but strips a verified label without Assurance proof', () => {
    const source = { ...drawing(), extractedPages: [] };
    const provenance = bookmarkProvenance();
    const hydrated = hydrateECOSDocumentsFromCloudSearch([source], [{
      document_id: source.id,
      page_number: 3,
      region_id: 'note-1',
      chunk_text: 'Provide guardrails at open parking edges.',
      sheet_number: 'A101',
      confidence: 0.99,
      metadata: {
        ...provenance,
        assurance: { accepted: false, checks: { sheetMappingUsable: false } },
        x: 0.1,
        y: 0.2,
        width: 0.4,
        height: 0.05,
      },
    }]);

    expect(hydrated[0].extractedPages?.[0]).toMatchObject({
      pageNumber: 3,
      sheetNumber: null,
      sheetMappingStatus: 'unverified',
      text: 'Provide guardrails at open parking edges.',
    });
  });
});
