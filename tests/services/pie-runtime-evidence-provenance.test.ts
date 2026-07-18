/**
 * Audit P1-02: runtime evidence must carry real captured timestamps from the
 * underlying evidence (never the analysis run time) and confirmation only
 * from actual user input, so quality scoring cannot award fabricated
 * freshness or double-counted confirmation.
 */

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

import { buildRuntimeEvidenceQualityInputs } from '../../services/PIECoreIntelligence';
import type { PIERuntimeState } from '../../services/PIERuntime';
import type { PIEMemoryRecallResult } from '../../services/PIEMemoryRecall';

const RUN_TIME = '2026-07-18T12:00:00.000Z';
const PHOTO_TIME = '2026-07-10T09:00:00.000Z';
const IMPORT_TIME = '2026-07-05T08:00:00.000Z';

function runtime(overrides: {
  photoTimestamp?: string | null;
  scheduleImportedAt?: string | null;
  userNote?: string | null;
} = {}): PIERuntimeState {
  return {
    generatedAt: RUN_TIME,
    projectName: 'Building 2321',
    projectNames: ['Building 2321'],
    recommendedWalkAreas: ['North Lot'],
    overallConfidence: 'medium',
    scheduleConfidence: 'medium',
    comparisonConfidence: 'medium',
    comparisonNeedsReview: false,
    lastComparison: null,
    scheduleSummary: { needsReviewCount: 0 },
    intelligentSummary: {
      whatChanged: 'Schedule and photos reviewed.',
      scheduleStatus: 'Schedule loaded.',
      photoEvidenceSummary: 'Photos reviewed.',
      gpsLocationConfidence: 'GPS confidence noted.',
      userUpdateSummary: 'Field notes summary.',
      risksAndIssues: 'One open issue.',
      safetySummary: 'No safety concerns recorded.',
    },
    evidenceFusionSummary: { summary: 'Fused summary.' },
    fusedEvidence: {
      scheduleEvidence: overrides.scheduleImportedAt !== null
        ? [{
            importedAt: overrides.scheduleImportedAt ?? IMPORT_TIME,
            sources: [],
          }]
        : [],
      photoEvidence: overrides.photoTimestamp !== null
        ? [{ timestamp: overrides.photoTimestamp ?? PHOTO_TIME }]
        : [],
      gpsEvidence: { gpsAvailable: false, confidenceScore: 0, sources: [] },
      userUpdateEvidence: overrides.userNote !== undefined
        ? [{ notes: overrides.userNote, date: null, sources: [] }]
        : [],
      issueEvidence: [],
      safetyEvidence: [],
      reportEvidence: [],
    },
  } as unknown as PIERuntimeState;
}

const memoryRecall = {
  memories: [],
  patterns: [],
  comparisons: [],
} as unknown as PIEMemoryRecallResult;

function itemById(items: { id: string }[], id: string) {
  const found = items.find(item => item.id === id);
  if (!found) throw new Error(`missing ${id}`);
  return found as { id: string; capturedAt?: string | null; userConfirmed?: boolean };
}

describe('runtime evidence provenance (audit P1-02)', () => {
  it('stamps photo evidence with the real photo time, not the run time', () => {
    const inputs = buildRuntimeEvidenceQualityInputs(runtime(), memoryRecall);

    expect(itemById(inputs, 'quality-photo').capturedAt).toBe(PHOTO_TIME);
    expect(itemById(inputs, 'quality-photo').capturedAt).not.toBe(RUN_TIME);
  });

  it('stamps schedule evidence with the real import time', () => {
    const inputs = buildRuntimeEvidenceQualityInputs(runtime(), memoryRecall);

    expect(itemById(inputs, 'quality-schedule').capturedAt).toBe(IMPORT_TIME);
  });

  it('leaves capturedAt null when no underlying timestamp exists', () => {
    const inputs = buildRuntimeEvidenceQualityInputs(
      runtime({ photoTimestamp: null, scheduleImportedAt: null }),
      memoryRecall,
    );

    expect(itemById(inputs, 'quality-gps').capturedAt).toBeNull();
    expect(itemById(inputs, 'quality-safety').capturedAt).toBeNull();
  });

  it('marks notes confirmed only when a real user note exists', () => {
    const withNote = buildRuntimeEvidenceQualityInputs(
      runtime({ userNote: 'Poured footing at north wall.' }),
      memoryRecall,
    );
    const withoutNote = buildRuntimeEvidenceQualityInputs(
      runtime({ userNote: '   ' }),
      memoryRecall,
    );

    expect(itemById(withNote, 'quality-notes').userConfirmed).toBe(true);
    expect(itemById(withoutNote, 'quality-notes').userConfirmed).toBe(false);
  });

  it('never marks derived issue and safety summaries as user-confirmed', () => {
    const inputs = buildRuntimeEvidenceQualityInputs(runtime(), memoryRecall);

    expect(itemById(inputs, 'quality-issues').userConfirmed).toBe(false);
    expect(itemById(inputs, 'quality-safety').userConfirmed).toBe(false);
  });
});
