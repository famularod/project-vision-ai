import {
  eligibleECOSLegacyPageDocumentIds,
  filterECOSLegacyPageContextRows,
  loadECOSCurrentHostedPageContext,
} from '../../supabase/functions/_shared/ecos-current-hosted-page-context';
import { isECOSDrawingCategory } from '../../supabase/functions/_shared/ecos-document-category';

describe('ECOS exact-current hosted page context', () => {
  it('uses only the bounded authenticated RPC and normalizes duplicate inputs', async () => {
    const rpc = jest.fn(async () => ({
      data: [{ document_id: 'drawing-1', page_number: 6, page_text: 'verified page' }],
      error: null,
    }));
    const from = jest.fn(() => {
      throw new Error('raw hosted table reads are forbidden');
    });

    const rows = await loadECOSCurrentHostedPageContext({
      client: { rpc },
      projectId: ' project-2375 ',
      documentIds: [' drawing-1 ', 'drawing-1', '', 'drawing-2'],
      pageNumbers: [6, 6, 0, 7.8, Number.NaN],
    });

    expect(rows).toEqual([{ document_id: 'drawing-1', page_number: 6, page_text: 'verified page' }]);
    expect(rpc).toHaveBeenCalledWith('ecos_load_current_hosted_page_context', {
      p_project_id: 'project-2375',
      p_document_ids: ['drawing-1', 'drawing-2'],
      p_page_numbers: [6, 7],
    });
    expect(from).not.toHaveBeenCalled();
  });

  it('fails closed on authenticated permission errors instead of attempting a table fallback', async () => {
    const permissionError = {
      code: '42501',
      message: 'permission denied; could not find the function through this role',
    };
    const rpc = jest.fn(async () => ({ data: null, error: permissionError }));
    const from = jest.fn(() => {
      throw new Error('raw hosted table reads are forbidden');
    });

    await expect(loadECOSCurrentHostedPageContext({
      client: { rpc },
      projectId: 'project-2375',
      documentIds: ['drawing-1'],
      pageNumbers: [6],
    })).rejects.toEqual(permissionError);
    expect(from).not.toHaveBeenCalled();
  });

  it('allows an empty result only while the new RPC is unavailable during migration rollout', async () => {
    const rpc = jest.fn(async () => ({
      data: null,
      error: { code: '42883', message: 'function does not exist' },
    }));

    await expect(loadECOSCurrentHostedPageContext({
      client: { rpc },
      projectId: 'project-2375',
      documentIds: ['drawing-1'],
      pageNumbers: [6],
    })).resolves.toEqual([]);
  });

  it.each([
    ['42883', 'function does not exist'],
    ['PGRST202', 'could not find the function'],
  ])('excludes a forged legacy drawing when hosted context is unavailable (%s)', async (code, message) => {
    const drawingIds = new Set(['drawing-1']);
    const hostedRows = await loadECOSCurrentHostedPageContext({
      client: { rpc: jest.fn(async () => ({ data: null, error: { code, message } })) },
      projectId: 'project-2375',
      documentIds: ['drawing-1'],
      pageNumbers: [6],
    });
    const eligibleLegacyIds = eligibleECOSLegacyPageDocumentIds(['drawing-1'], drawingIds);
    const legacyRows = filterECOSLegacyPageContextRows({
      rows: [{
        document_id: 'drawing-1',
        page_number: 6,
        page_text: 'fabricated authenticated drawing fact',
        visual_coverage: { coverageComplete: true },
      }],
      hostedRows,
      drawingDocumentIds: drawingIds,
    });

    expect(hostedRows).toEqual([]);
    expect(eligibleLegacyIds).toEqual([]);
    expect(legacyRows).toEqual([]);
  });

  it('excludes a forged legacy drawing when the hosted RPC succeeds with an empty result', async () => {
    const drawingIds = new Set(['drawing-1']);
    const hostedRows = await loadECOSCurrentHostedPageContext({
      client: { rpc: jest.fn(async () => ({ data: [], error: null })) },
      projectId: 'project-2375',
      documentIds: ['drawing-1'],
      pageNumbers: [6],
    });

    expect(filterECOSLegacyPageContextRows({
      rows: [{
        document_id: 'drawing-1',
        page_number: 6,
        page_text: 'fabricated authenticated drawing fact',
        assurance_result: { accepted: true },
      }],
      hostedRows,
      drawingDocumentIds: drawingIds,
    })).toEqual([]);
  });

  it('retains a non-drawing legacy row while excluding hosted duplicates', () => {
    const drawingIds = new Set(['drawing-1']);
    expect(eligibleECOSLegacyPageDocumentIds(
      ['drawing-1', 'specification-1', 'specification-1'],
      drawingIds,
    )).toEqual(['specification-1']);
    expect(filterECOSLegacyPageContextRows({
      rows: [
        { document_id: 'specification-1', page_number: 2, page_text: 'legacy specification' },
        { document_id: 'specification-2', page_number: 3, page_text: 'duplicate' },
      ],
      hostedRows: [{ document_id: 'specification-2', page_number: 3 }],
      drawingDocumentIds: drawingIds,
    })).toEqual([{ document_id: 'specification-1', page_number: 2, page_text: 'legacy specification' }]);
  });

  it('treats the legacy Plans label as a drawing and excludes it from legacy page fallback', () => {
    const documents = [{ id: 'plans-1', category: 'Plans' }];
    const drawingIds = new Set(documents
      .filter(document => isECOSDrawingCategory(document.category))
      .map(document => document.id));

    expect(isECOSDrawingCategory('Plans')).toBe(true);
    expect(isECOSDrawingCategory(' drawing ')).toBe(true);
    expect(eligibleECOSLegacyPageDocumentIds(['plans-1'], drawingIds)).toEqual([]);
    expect(filterECOSLegacyPageContextRows({
      rows: [{ document_id: 'plans-1', page_number: 1, page_text: 'forged plans evidence' }],
      hostedRows: [],
      drawingDocumentIds: drawingIds,
    })).toEqual([]);
  });
});
