import {
  buildPhotoEvidenceDeduplicationPlan,
  decidePhotoEvidencePair,
  type ExistingPhotoEvidenceVersion,
} from '../../services/PhotoEvidenceDeduplication';

const ANALYZER_ID = 'pie-production-photo-vision';
const ANALYZER_VERSION = 'analyzer-v2';

function existing(
  overrides: Partial<ExistingPhotoEvidenceVersion> = {},
): ExistingPhotoEvidenceVersion {
  return {
    id: 'evidence-root',
    evidenceVersion: 1,
    analyzerId: ANALYZER_ID,
    analyzerVersion: 'analyzer-v1',
    processingState: 'succeeded',
    duplicateOfEvidenceId: null,
    currentAnalysisVersion: 'analyzer-v1',
    originalStoragePath: 'org/project/photo/evidence-root/original.jpg',
    ...overrides,
  };
}

describe('photo evidence byte deduplication', () => {
  it('creates version 1 as the canonical root for previously unseen bytes', () => {
    expect(buildPhotoEvidenceDeduplicationPlan({
      intendedEvidenceId: 'evidence-new',
      analyzerId: ANALYZER_ID,
      analyzerVersion: ANALYZER_VERSION,
      existingVersions: [],
    })).toEqual({
      mode: 'new_root',
      evidenceId: 'evidence-new',
      evidenceVersion: 1,
      duplicateOfEvidenceId: null,
      parentEvidenceIds: [],
      analyzerId: ANALYZER_ID,
      analyzerVersion: ANALYZER_VERSION,
      currentAnalysisVersion: null,
      analysisReuse: 'analysis_required',
      existingStoragePath: null,
    });
  });

  it('creates explicit lineage and advances evidence_version for reused bytes', () => {
    expect(buildPhotoEvidenceDeduplicationPlan({
      intendedEvidenceId: 'evidence-second-capture',
      analyzerId: ANALYZER_ID,
      analyzerVersion: ANALYZER_VERSION,
      existingVersions: [existing()],
    })).toEqual({
      mode: 'duplicate_lineage',
      evidenceId: 'evidence-second-capture',
      evidenceVersion: 2,
      duplicateOfEvidenceId: 'evidence-root',
      parentEvidenceIds: ['evidence-root'],
      analyzerId: ANALYZER_ID,
      analyzerVersion: ANALYZER_VERSION,
      currentAnalysisVersion: null,
      analysisReuse: 'analysis_required',
      existingStoragePath: 'org/project/photo/evidence-root/original.jpg',
    });
  });

  it('keeps all duplicate generations linked to the canonical root', () => {
    const plan = buildPhotoEvidenceDeduplicationPlan({
      intendedEvidenceId: 'evidence-third-capture',
      analyzerId: ANALYZER_ID,
      analyzerVersion: ANALYZER_VERSION,
      existingVersions: [
        existing(),
        existing({
          id: 'evidence-second-capture',
          evidenceVersion: 2,
          duplicateOfEvidenceId: 'evidence-root',
          currentAnalysisVersion: null,
          originalStoragePath: 'org/project/photo/evidence-root/original.jpg',
        }),
      ],
    });

    expect(plan.evidenceVersion).toBe(3);
    expect(plan.duplicateOfEvidenceId).toBe('evidence-root');
    expect(plan.parentEvidenceIds).toEqual(['evidence-root']);
  });

  it('is idempotent for the same evidence identity and does not invent another version', () => {
    const plan = buildPhotoEvidenceDeduplicationPlan({
      intendedEvidenceId: 'evidence-second-capture',
      analyzerId: ANALYZER_ID,
      analyzerVersion: ANALYZER_VERSION,
      existingVersions: [
        existing(),
        existing({
          id: 'evidence-second-capture',
          evidenceVersion: 2,
          duplicateOfEvidenceId: 'evidence-root',
          currentAnalysisVersion: ANALYZER_VERSION,
        }),
      ],
    });

    expect(plan.mode).toBe('idempotent_existing');
    expect(plan.evidenceVersion).toBe(2);
    expect(plan.duplicateOfEvidenceId).toBe('evidence-root');
    expect(plan.analysisReuse).toBe('current_version_available');
  });

  it('requires a new analyzer run when identical evidence only has an older analysis version', () => {
    const plan = buildPhotoEvidenceDeduplicationPlan({
      intendedEvidenceId: 'evidence-root',
      analyzerId: ANALYZER_ID,
      analyzerVersion: ANALYZER_VERSION,
      existingVersions: [existing()],
    });

    expect(plan.mode).toBe('idempotent_existing');
    expect(plan.currentAnalysisVersion).toBe('analyzer-v1');
    expect(plan.analysisReuse).toBe('analysis_required');
    expect(plan.analyzerVersion).toBe(ANALYZER_VERSION);
  });

  it('treats identical prior/current bytes as a conservative completed lineage result, not failure', () => {
    expect(decidePhotoEvidencePair({
      baselineEvidenceId: 'evidence-root',
      currentEvidenceId: 'evidence-second-capture',
      baselineContentHash: `sha256:${'a'.repeat(64)}`,
      currentContentHash: `sha256:${'a'.repeat(64)}`,
      baselineSizeBytes: 1_024,
      currentSizeBytes: 1_024,
    })).toEqual({
      kind: 'duplicate_bytes',
      analysisStatus: 'completed_with_limitations',
      projectProgress: 'unsupported',
      providerInvocationRequired: false,
    });
  });

  it('sends distinct non-empty evidence to analysis and rejects invalid identity pairs', () => {
    expect(decidePhotoEvidencePair({
      baselineEvidenceId: 'evidence-root',
      currentEvidenceId: 'evidence-current',
      baselineContentHash: `sha256:${'a'.repeat(64)}`,
      currentContentHash: `sha256:${'b'.repeat(64)}`,
      baselineSizeBytes: 1_024,
      currentSizeBytes: 2_048,
    }).kind).toBe('analyze');

    expect(() => decidePhotoEvidencePair({
      baselineEvidenceId: 'same-evidence',
      currentEvidenceId: 'same-evidence',
      baselineContentHash: `sha256:${'a'.repeat(64)}`,
      currentContentHash: `sha256:${'a'.repeat(64)}`,
      baselineSizeBytes: 1_024,
      currentSizeBytes: 1_024,
    })).toThrow('photo_pair_same_evidence_id');
  });
});
