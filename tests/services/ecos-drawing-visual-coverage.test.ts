import {
  completedECOSDrawingTileKeys,
  ECOS_DRAWING_REQUIRED_TILE_KEYS,
  ecosDrawingAnalysisFailureCode,
  ecosDrawingTileKey,
  hasCompleteECOSDrawingVisualCoverage,
  runECOSDrawingAnalysisWithRetry,
} from '../../services/ECOSDrawingVisualCoverage';
import { ECOSDrawingPageAnalysisError } from '../../services/ECOSDrawingPageAnalysis';

const SOURCE_SHA = 'a'.repeat(64);

function completedVisualCoverage(pageNumber = 1) {
  const bounds = [
    { x: 0, y: 0, width: 1 / 3, height: 0.5 },
    { x: 1 / 3, y: 0, width: 1 / 3, height: 0.5 },
    { x: 2 / 3, y: 0, width: 1 / 3, height: 0.5 },
    { x: 0, y: 0.5, width: 1 / 3, height: 0.5 },
    { x: 1 / 3, y: 0.5, width: 1 / 3, height: 0.5 },
    { x: 2 / 3, y: 0.5, width: 1 / 3, height: 0.5 },
  ];
  const proofs = ECOS_DRAWING_REQUIRED_TILE_KEYS.map((tileKey, index) => {
    const regionId = `visual-tile-${tileKey}-word-${index}`;
    return {
      tileKey,
      bounds: bounds[index],
      state: 'completed' as const,
      pageNumber,
      sourceSha256: SOURCE_SHA,
      evidenceVersion: 'ecos-hosted-evidence/1.3',
      renderMethod: 'pymupdf_rgb_png',
      analysisMethod: 'tesseract_coordinate_ocr_psm11',
      renderDpi: 200,
      renderPixelWidth: 2400,
      renderPixelHeight: 1800,
      renderSha256: '1'.repeat(64),
      analysisInputSha256: '2'.repeat(64),
      analysisSha256: '3'.repeat(64),
      analysisRegionCount: 1,
      analysisRegionIds: [regionId],
      searchableRegionCount: 1,
      searchableRegionIds: [regionId],
    };
  });
  return {
    schemaVersion: 'ecos-visual-coverage/1.0',
    evidenceVersion: 'ecos-hosted-evidence/1.3',
    sourceSha256: SOURCE_SHA,
    pageNumber,
    overviewAnalyzed: true,
    requestedDeepReadRegionCount: 6,
    completedDeepReadRegionCount: 6,
    coverageComplete: true,
    completedDeepReadRegionKeys: [...ECOS_DRAWING_REQUIRED_TILE_KEYS],
    completedDeepReadRegionProofs: proofs,
    failureCodes: [],
  };
}

describe('ECOS drawing visual coverage recovery', () => {
  it('retries transient provider failures with bounded backoff', async () => {
    const operation = jest.fn()
      .mockRejectedValueOnce(new ECOSDrawingPageAnalysisError('analysis_provider_failed', 'temporary'))
      .mockRejectedValueOnce(new ECOSDrawingPageAnalysisError('analysis_timeout', 'temporary'))
      .mockResolvedValue({ verified: true });
    const wait = jest.fn().mockResolvedValue(undefined);
    const onStatus = jest.fn();

    await expect(runECOSDrawingAnalysisWithRetry(operation, { wait, onStatus }))
      .resolves.toEqual({ verified: true });
    expect(operation).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenNthCalledWith(1, 1_000);
    expect(wait).toHaveBeenNthCalledWith(2, 2_000);
    expect(onStatus.mock.calls.map(([status]) => status)).toEqual([
      expect.objectContaining({ state: 'attempting', attempt: 1, maximumAttempts: 8 }),
      expect.objectContaining({ state: 'waiting', attempt: 1, waitMilliseconds: 1_000 }),
      expect.objectContaining({ state: 'attempting', attempt: 2, maximumAttempts: 8 }),
      expect.objectContaining({ state: 'waiting', attempt: 2, waitMilliseconds: 2_000 }),
      expect.objectContaining({ state: 'attempting', attempt: 3, maximumAttempts: 8 }),
    ]);
  });

  it('honors the provider cooldown before retrying a rate-limited drawing page', async () => {
    const operation = jest.fn()
      .mockRejectedValueOnce(new ECOSDrawingPageAnalysisError(
        'analysis_rate_limited',
        'temporarily busy',
        45_000,
      ))
      .mockResolvedValue({ verified: true });
    const wait = jest.fn().mockResolvedValue(undefined);

    await expect(runECOSDrawingAnalysisWithRetry(operation, { wait }))
      .resolves.toEqual({ verified: true });
    expect(wait).toHaveBeenCalledWith(45_000);
  });

  it('does not retry authentication and request-contract failures', async () => {
    const error = new ECOSDrawingPageAnalysisError('signed_out', 'Sign in again.');
    const operation = jest.fn().mockRejectedValue(error);
    const wait = jest.fn().mockResolvedValue(undefined);

    await expect(runECOSDrawingAnalysisWithRetry(operation, { wait })).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
    expect(ecosDrawingAnalysisFailureCode(error)).toBe('signed_out');
  });

  it.each([
    'analysis_prepaid_credits_depleted',
    'analysis_quota_exhausted',
    'analysis_request_exceeds_rate_limit',
  ])(
    'does not repeat a provider-capacity failure that cannot succeed unchanged: %s',
    async code => {
      const error = new ECOSDrawingPageAnalysisError(code, 'capacity unavailable');
      const operation = jest.fn().mockRejectedValue(error);
      const wait = jest.fn().mockResolvedValue(undefined);

      await expect(runECOSDrawingAnalysisWithRetry(operation, { wait })).rejects.toBe(error);
      expect(operation).toHaveBeenCalledTimes(1);
      expect(wait).not.toHaveBeenCalled();
    },
  );

  it('requires the overview and every requested tile before reporting complete coverage', () => {
    const fiveTiles = {
      pageNumber: 1,
      visualCoverage: {
        ...completedVisualCoverage(),
        completedDeepReadRegionCount: 5,
        completedDeepReadRegionKeys: ECOS_DRAWING_REQUIRED_TILE_KEYS.slice(0, 5),
        completedDeepReadRegionProofs: completedVisualCoverage().completedDeepReadRegionProofs.slice(0, 5),
      },
    };
    const sixTiles = {
      pageNumber: 1,
      visualCoverage: completedVisualCoverage(),
    };

    expect(hasCompleteECOSDrawingVisualCoverage(fiveTiles)).toBe(false);
    expect(hasCompleteECOSDrawingVisualCoverage(sixTiles)).toBe(true);
    expect(completedECOSDrawingTileKeys(sixTiles)).toEqual(new Set(ECOS_DRAWING_REQUIRED_TILE_KEYS));
  });

  it('does not trust six completed counts when a deterministic tile key is missing', () => {
    expect(hasCompleteECOSDrawingVisualCoverage({
      pageNumber: 1,
      visualCoverage: {
        ...completedVisualCoverage(),
        completedDeepReadRegionKeys: [
          ...ECOS_DRAWING_REQUIRED_TILE_KEYS.slice(0, 5),
          '999:999:1:1',
        ],
      },
    })).toBe(false);
  });

  it.each([
    ['missing render hash', (coverage: ReturnType<typeof completedVisualCoverage>) => {
      coverage.completedDeepReadRegionProofs[2].renderSha256 = '';
    }],
    ['wrong method', (coverage: ReturnType<typeof completedVisualCoverage>) => {
      coverage.completedDeepReadRegionProofs[2].analysisMethod = 'counter_only';
    }],
    ['invalid dimensions', (coverage: ReturnType<typeof completedVisualCoverage>) => {
      coverage.completedDeepReadRegionProofs[2].renderPixelWidth = 0;
    }],
    ['duplicate analysis ids', (coverage: ReturnType<typeof completedVisualCoverage>) => {
      const proof = coverage.completedDeepReadRegionProofs[2];
      proof.analysisRegionIds = [proof.analysisRegionIds[0], proof.analysisRegionIds[0]];
      proof.analysisRegionCount = 2;
    }],
    ['searchable id not analyzed', (coverage: ReturnType<typeof completedVisualCoverage>) => {
      coverage.completedDeepReadRegionProofs[2].searchableRegionIds = ['not-analyzed'];
    }],
  ])('rejects fabricated proof material: %s', (_label, mutate) => {
    const coverage = completedVisualCoverage();
    mutate(coverage);
    expect(hasCompleteECOSDrawingVisualCoverage({ pageNumber: 1, visualCoverage: coverage })).toBe(false);
  });

  it('uses stable normalized keys to resume exact missing drawing tiles', () => {
    expect(ecosDrawingTileKey({ x: 1 / 3, y: 0.5, width: 1 / 3, height: 0.5 }))
      .toBe('333:500:333:500');
  });
});
