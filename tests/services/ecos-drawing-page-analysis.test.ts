import {
  ECOS_DRAWING_PAGE_ANALYSIS_SCHEMA_VERSION,
  ECOS_DRAWING_PAGE_ANALYSIS_TIMEOUT_MS,
  analyzeECOSDrawingPage,
  parseECOSDrawingPageAnalysis,
} from '../../services/ECOSDrawingPageAnalysis';

describe('ECOS drawing page visual analysis', () => {
  it('reports the exact stage when visual analysis times out', async () => {
    const response = new Response(JSON.stringify({ error: 'analysis_timeout' }), { status: 502 });
    const invoke = jest.fn().mockResolvedValue({ data: null, error: { context: response }, response });
    const client = {
      auth: {
        getSession: jest.fn().mockResolvedValue({
          data: { session: { access_token: 'token' } },
          error: null,
        }),
      },
      functions: {
        invoke,
      },
    } as never;

    await expect(analyzeECOSDrawingPage({
      client,
      input: {
        pageNumber: 1,
        documentName: 'Drawing.pdf',
        discipline: 'Civil',
        imageDataUrl: 'data:image/jpeg;base64,AA==',
        existingText: '',
      },
    })).rejects.toThrow('Vitruvius drawing analysis took too long to finish');
    expect(invoke).toHaveBeenCalledWith(
      'ecos-analyze-drawing-page',
      expect.objectContaining({ timeout: ECOS_DRAWING_PAGE_ANALYSIS_TIMEOUT_MS }),
    );
  });

  it('converts an aborted hosted-function request into a retryable analysis timeout', async () => {
    const client = {
      auth: {
        getSession: jest.fn().mockResolvedValue({
          data: { session: { access_token: 'token' } },
          error: null,
        }),
      },
      functions: {
        invoke: jest.fn().mockResolvedValue({
          data: null,
          error: {
            name: 'FunctionsFetchError',
            message: 'Failed to send a request to the Edge Function',
            context: { name: 'AbortError', message: 'The operation was aborted.' },
          },
          response: undefined,
        }),
      },
    } as never;

    await expect(analyzeECOSDrawingPage({
      client,
      input: {
        pageNumber: 6,
        documentName: 'Electrical.pdf',
        discipline: 'Electrical',
        imageDataUrl: 'data:image/jpeg;base64,AA==',
        existingText: '',
      },
    })).rejects.toMatchObject({ code: 'analysis_timeout' });
  });

  it('converts verified visual facts into searchable normalized regions', () => {
    expect(parseECOSDrawingPageAnalysis({
      schemaVersion: ECOS_DRAWING_PAGE_ANALYSIS_SCHEMA_VERSION,
      facts: [{
        subject: 'PCC paving',
        location: 'North Lot',
        statement: 'The north-lot PCC paving is specified as 6.0 inches thick.',
        evidenceText: 'Construction Note 1: CONSTRUCT 6.0\" THICK PCC PAVING',
        confidence: 0.98,
        bounds: { x: 620, y: 130, width: 160, height: 40 },
      }],
    }, 6)).toEqual({
      regions: [expect.objectContaining({
        id: 'page-6-vision-1',
        source: 'vision',
        x: 0.62,
        y: 0.13,
        width: 0.16,
        height: 0.04,
        confidence: 0.98,
        text: expect.stringContaining('CONSTRUCT 6.0\" THICK PCC PAVING'),
      })],
      deepReadRegions: [],
    });
  });

  it('drops facts that do not include visible evidence and a valid source region', () => {
    expect(parseECOSDrawingPageAnalysis({
      schemaVersion: ECOS_DRAWING_PAGE_ANALYSIS_SCHEMA_VERSION,
      facts: [{ statement: 'Maybe lighting exists.', evidenceText: '', confidence: 0.4, bounds: {} }],
    }, 1)).toEqual({ regions: [], deepReadRegions: [] });
  });

  it('maps deep-read tile coordinates back to exact page coordinates', () => {
    const result = parseECOSDrawingPageAnalysis({
      schemaVersion: ECOS_DRAWING_PAGE_ANALYSIS_SCHEMA_VERSION,
      facts: [{
        subject: 'Canopy lighting',
        location: 'Canopy A',
        statement: 'Fixture type 24 is shown within Canopy A.',
        evidenceText: '24',
        confidence: 0.97,
        bounds: { x: 300, y: 200, width: 200, height: 100 },
      }],
    }, 4, { x: 2 / 3, y: 0, width: 1 / 3, height: 0.5 });

    expect(result.regions[0]).toMatchObject({
      x: 2 / 3 + 0.1,
      y: 0.1,
      width: 1 / 15,
      height: 0.05,
      source: 'vision',
    });
  });
});
