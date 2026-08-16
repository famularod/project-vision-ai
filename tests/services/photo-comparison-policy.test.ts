jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

import {
  analyzeProjectPhotoWithVision,
  type PIEPhotoIntelligenceDisplayState,
} from '../../services/PIEPhotoVisionMobileWorkflow';
import {
  photoDisplayResultCanBeReviewed,
  photoDisplayResultCanInformProject,
  photoDisplayResultIsReviewCandidate,
} from '../../services/PhotoAssessment';
import { buildPhotoProgress } from '../../services/PIEPhotoProgress';
import type { ProjectUpdate, UpdatePhoto } from '../../types';

function photo(id: string, intelligence: PIEPhotoIntelligenceDisplayState | null = null): UpdatePhoto {
  return {
    id,
    uri: `file:///photos/${id}.jpg`,
    caption: '',
    category: 'Update',
    actionRequired: '',
    actionOwner: '',
    actionDueDate: '',
    actionStatus: 'Open',
    selectedAreaId: 'area-a',
    selectedAreaName: 'Area A',
    locationCapturedAt: id === 'prior' ? '2026-07-01T10:00:00.000Z' : '2026-07-02T10:00:00.000Z',
    photoIntelligence: intelligence,
  };
}

function comparison(
  review: PIEPhotoIntelligenceDisplayState['userReview'] = null,
  overrides: Partial<PIEPhotoIntelligenceDisplayState> = {},
): PIEPhotoIntelligenceDisplayState {
  return {
    status: 'analysis_complete',
    title: 'Possible visible changes',
    summary: 'New conduit is visible along the west wall.',
    visibleChange: 'New conduit is visible along the west wall.',
    location: 'Area A',
    comparisonConfidence: 'high',
    comparability: 'strong',
    captureLimitations: [],
    projectProgress: 'unable_to_determine',
    assessmentDisposition: 'finding',
    repeatPhotoGuidance: null,
    authorityMessage: 'Visual observation only.',
    findings: [{
      findingType: 'added',
      description: 'New conduit is visible along the west wall.',
      objectName: 'conduit',
      baselineState: 'not visible',
      currentState: 'visible',
      location: 'west wall',
      confidence: 0.95,
      limitations: [],
      evidenceRegions: [],
      source: 'structured_provider',
    }],
    priorUpdateUsed: '2026-07-01',
    priorEvidenceId: 'evidence-prior',
    provenance: 'visual_only',
    userReview: review,
    userReviewedAt: review ? '2026-07-02T11:00:00.000Z' : null,
    diagnostics: {
      selectedPriorPhotoId: 'prior',
    } as PIEPhotoIntelligenceDisplayState['diagnostics'],
    updatedAt: '2026-07-02T10:05:00.000Z',
    ...overrides,
  };
}

function update(id: string, updatePhoto: UpdatePhoto): ProjectUpdate {
  return {
    id,
    projectName: 'Project A',
    date: updatePhoto.locationCapturedAt || '',
    photos: [updatePhoto],
    notes: '',
    recipients: { contactIds: [] },
    selectedAreaId: 'area-a',
    selectedAreaName: 'Area A',
  };
}

describe('photo comparison authority policy', () => {
  it('saves a first photo as a baseline without invoking cloud AI', async () => {
    const currentPhoto = photo('current');
    const result = await analyzeProjectPhotoWithVision({
      update: update('current-update', currentPhoto),
      photo: currentPhoto,
      priorUpdates: [],
    });

    expect(result.status).toBe('no_suitable_prior_photo');
    expect(result.diagnostics?.executedStages).toContain('baseline_saved_without_ai');
    expect(result.diagnostics?.edgeFunctionInvoked).toBe(false);
  });

  it('requires a trustworthy raw-pixel result and explicit confirmation for project use', () => {
    expect(photoDisplayResultIsReviewCandidate(comparison())).toBe(true);
    expect(photoDisplayResultCanBeReviewed(comparison())).toBe(true);
    expect(photoDisplayResultCanInformProject(comparison())).toBe(false);
    expect(photoDisplayResultCanInformProject(comparison('confirmed'))).toBe(true);
    expect(photoDisplayResultCanInformProject(comparison('incorrect'))).toBe(false);
    expect(photoDisplayResultCanInformProject(comparison('not_useful'))).toBe(false);
    expect(photoDisplayResultCanInformProject(comparison('confirmed', { comparability: 'weak' }))).toBe(false);
    expect(photoDisplayResultCanInformProject(comparison('confirmed', { provenance: 'caption_only' }))).toBe(false);
  });

  it('does not turn captions or status text into photo progress', () => {
    const prior = photo('prior');
    const current = {
      ...photo('current'),
      caption: 'Installed and complete with major progress',
      actionStatus: 'Closed' as const,
    };
    const result = buildPhotoProgress({
      projectName: 'Project A',
      updates: [update('prior-update', prior), update('current-update', current)],
    });

    expect(result.comparisons).toHaveLength(0);
    expect(result.comparisonNeedsReview).toBe(false);
    expect(result.acceptedEvidence).toHaveLength(0);
  });

  it('routes only confirmed provider findings into accepted evidence', () => {
    const prior = photo('prior');
    const unconfirmed = photo('current', comparison());
    const pending = buildPhotoProgress({
      projectName: 'Project A',
      updates: [update('prior-update', prior), update('current-update', unconfirmed)],
    });
    expect(pending.comparisons).toHaveLength(1);
    expect(pending.comparisonNeedsReview).toBe(true);
    expect(pending.acceptedEvidence).toHaveLength(0);

    const confirmed = photo('current', comparison('confirmed'));
    const accepted = buildPhotoProgress({
      projectName: 'Project A',
      updates: [update('prior-update', prior), update('current-update', confirmed)],
    });
    expect(accepted.comparisons).toHaveLength(1);
    expect(accepted.comparisonNeedsReview).toBe(false);
    expect(accepted.acceptedEvidence).toHaveLength(1);
    expect(accepted.missionFeed.evidence).toEqual([
      'New conduit is visible along the west wall.',
    ]);
  });
});
