import {
  CURRENT_PHOTO_ANALYSIS_VERSIONS,
  compareImmutablePhotoCapturedAt,
  createPhotoAnalysisRunIdentity,
  createPhotoEvidenceIdentity,
  resolveImmutablePhotoCapturedAt,
  type PhotoAnalysisVersions,
} from '../../services/PhotoAnalysisIdentity';

const PRIOR_SHA = 'a'.repeat(64);
const CURRENT_SHA = 'b'.repeat(64);

const EVIDENCE_INPUT = {
  organizationId: 'organization-1',
  projectId: 'project-1',
  updateId: 'update-1',
  photoId: 'photo-1',
  contentSha256: CURRENT_SHA,
};

const RUN_INPUT = {
  organizationId: 'organization-1',
  projectId: 'project-1',
  priorEvidenceId: 'prior-evidence-1',
  currentEvidenceId: 'current-evidence-1',
  priorContentSha256: PRIOR_SHA,
  currentContentSha256: CURRENT_SHA,
};

describe('PhotoAnalysisIdentity', () => {
  it('changes evidence, staging-cache, request, and result-cache identity when bytes change under the same IDs', () => {
    const originalEvidence = createPhotoEvidenceIdentity(EVIDENCE_INPUT);
    const replacedSha = 'c'.repeat(64);
    const replacementEvidence = createPhotoEvidenceIdentity({
      ...EVIDENCE_INPUT,
      contentSha256: replacedSha,
    });
    const originalRun = createPhotoAnalysisRunIdentity(RUN_INPUT);
    const replacementRun = createPhotoAnalysisRunIdentity({
      ...RUN_INPUT,
      currentContentSha256: replacedSha,
      currentEvidenceId: replacementEvidence.evidenceId,
    });

    expect(replacementEvidence.evidenceId).not.toBe(originalEvidence.evidenceId);
    expect(replacementEvidence.stagingCacheKey).not.toBe(originalEvidence.stagingCacheKey);
    expect(replacementRun.requestId).not.toBe(originalRun.requestId);
    expect(replacementRun.cacheKey).not.toBe(originalRun.cacheKey);
  });

  it.each([
    'contractVersion',
    'analyzerVersion',
    'promptVersion',
    'schemaVersion',
    'policyVersion',
  ] as const)('changes analyzer-run request/cache identity when %s changes', field => {
    const original = createPhotoAnalysisRunIdentity(RUN_INPUT);
    const versions: PhotoAnalysisVersions = {
      ...CURRENT_PHOTO_ANALYSIS_VERSIONS,
      [field]: `${CURRENT_PHOTO_ANALYSIS_VERSIONS[field]}-next`,
    };
    const changed = createPhotoAnalysisRunIdentity({ ...RUN_INPUT, versions });

    expect(changed.requestId).not.toBe(original.requestId);
    expect(changed.cacheKey).not.toBe(original.cacheKey);
    expect(changed.requestId).toContain(`${field}=`);
  });

  it('prevents stale cache reuse for changed bytes or analyzer contracts', () => {
    const cache = new Map<string, string>();
    const original = createPhotoAnalysisRunIdentity(RUN_INPUT);
    cache.set(original.cacheKey, 'original-result');

    const changedBytes = createPhotoAnalysisRunIdentity({
      ...RUN_INPUT,
      currentContentSha256: 'c'.repeat(64),
    });
    const changedPolicy = createPhotoAnalysisRunIdentity({
      ...RUN_INPUT,
      versions: {
        ...CURRENT_PHOTO_ANALYSIS_VERSIONS,
        policyVersion: 'next-policy',
      },
    });

    expect(cache.get(changedBytes.cacheKey)).toBeUndefined();
    expect(cache.get(changedPolicy.cacheKey)).toBeUndefined();
  });

  it('uses canonical capturedAt and never substitutes analysis/import/send timestamps', () => {
    expect(resolveImmutablePhotoCapturedAt({
      capturedAt: '2026-07-17T09:30:00-07:00',
      locationCapturedAt: '2026-07-17T10:00:00-07:00',
      importedAt: '2026-07-18T00:00:00Z',
      sendResolvedAt: '2026-07-18T01:00:00Z',
    })).toMatchObject({
      value: '2026-07-17T09:30:00-07:00',
      status: 'valid',
      source: 'capturedAt',
    });

    expect(resolveImmutablePhotoCapturedAt({
      importedAt: '2026-07-18T00:00:00Z',
      analyzedAt: '2026-07-18T00:30:00Z',
      sendResolvedAt: '2026-07-18T01:00:00Z',
    })).toEqual({
      value: null,
      epochMs: null,
      status: 'missing',
      source: null,
    });
  });

  it('orders timezone-offset instants by absolute capture time', () => {
    const candidate = resolveImmutablePhotoCapturedAt({
      capturedAt: '2026-07-17T08:30:00-07:00',
    });
    const current = resolveImmutablePhotoCapturedAt({
      capturedAt: '2026-07-17T15:31:00Z',
    });

    expect(compareImmutablePhotoCapturedAt(candidate, current)).toBe('earlier');
  });

  it('rejects equal capture instants and missing/invalid times conservatively', () => {
    const equalPacific = resolveImmutablePhotoCapturedAt({
      capturedAt: '2026-07-17T08:30:00-07:00',
    });
    const equalUtc = resolveImmutablePhotoCapturedAt({
      capturedAt: '2026-07-17T15:30:00Z',
    });
    const missing = resolveImmutablePhotoCapturedAt({});
    const invalid = resolveImmutablePhotoCapturedAt({ capturedAt: '2026-07-17' });

    expect(compareImmutablePhotoCapturedAt(equalPacific, equalUtc)).toBe('equal');
    expect(compareImmutablePhotoCapturedAt(missing, equalUtc)).toBe('candidate_missing');
    expect(compareImmutablePhotoCapturedAt(invalid, equalUtc)).toBe('candidate_invalid');
    expect(compareImmutablePhotoCapturedAt(equalPacific, missing)).toBe('current_missing');
    expect(compareImmutablePhotoCapturedAt(equalPacific, invalid)).toBe('current_invalid');
  });

  it('accepts the legacy per-photo capture field without falling back to update time', () => {
    expect(resolveImmutablePhotoCapturedAt({
      locationCapturedAt: '2026-07-17T16:00:00Z',
    })).toMatchObject({
      value: '2026-07-17T16:00:00Z',
      status: 'valid',
      source: 'legacy_locationCapturedAt',
    });
  });
});
