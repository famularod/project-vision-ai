// Owner answer Q9 (30 Sep 2026): a photo comparison's confidence is shown and
// scored lower when the two photos are only weakly comparable.

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

import { capPhotoComparisonConfidence } from '../../services/PhotoAssessment';
import {
  buildDisplayStateFromComparison,
  type PIEPhotoIntelligenceDisplayState,
} from '../../services/PIEPhotoVisionMobileWorkflow';
import { buildPhotoProgress } from '../../services/PIEPhotoProgress';
import type { ProjectUpdate, UpdatePhoto } from '../../types';

describe('capPhotoComparisonConfidence (owner answer Q9)', () => {
  it.each([
    ['high', 'weak', 'low'],
    ['medium', 'weak', 'low'],
    ['low', 'weak', 'low'],
    ['high', 'not_comparable', 'low'],
    ['medium', 'not_comparable', 'low'],
    ['low', 'not_comparable', 'low'],
  ] as const)('caps %s at low when comparability is %s', (confidence, comparability, expected) => {
    expect(capPhotoComparisonConfidence(confidence, comparability)).toBe(expected);
  });

  it.each([
    ['high', 'medium'],
    ['medium', 'medium'],
    ['low', 'low'],
  ] as const)('caps %s at most medium when comparability is probable', (confidence, expected) => {
    expect(capPhotoComparisonConfidence(confidence, 'probable')).toBe(expected);
  });

  it.each(['high', 'medium', 'low'])('leaves %s unchanged when comparability is strong', confidence => {
    expect(capPhotoComparisonConfidence(confidence, 'strong')).toBe(confidence);
  });

  it.each([
    ['unknown'],
    ['identical_bytes'],
    [''],
    [null],
    [undefined],
  ] as const)('leaves high unchanged when comparability is %p', comparability => {
    expect(capPhotoComparisonConfidence('high', comparability)).toBe('high');
  });

  it('reads comparability and confidence case-insensitively', () => {
    expect(capPhotoComparisonConfidence('High', ' Weak ')).toBe('low');
    expect(capPhotoComparisonConfidence('HIGH', 'Probable')).toBe('medium');
    expect(capPhotoComparisonConfidence('Medium', 'probable')).toBe('Medium');
  });

  it('never invents a confidence for a missing or unrecognized value', () => {
    expect(capPhotoComparisonConfidence(null, 'weak')).toBeNull();
    expect(capPhotoComparisonConfidence('unknown', 'weak')).toBe('unknown');
    expect(capPhotoComparisonConfidence('', 'probable')).toBe('');
  });
});

function comparisonRow(
  confidence: string,
  comparability: string,
): Record<string, unknown> {
  return {
    id: 'comparison-1',
    request_id: 'request-1',
    baseline_evidence_id: 'evidence-prior',
    current_evidence_id: 'evidence-current',
    comparability_classification: comparability,
    conclusion: 'material_visible_change',
    confidence,
    limitations: [],
    repeat_photo_guidance: [],
    object_additions: [{
      findingType: 'added',
      description: 'New conduit is visible along the west wall.',
      objectName: 'conduit',
      location: 'west wall',
      confidence: 0.9,
    }],
    object_removals: [],
    material_or_structural_changes: [],
    visible_concerns: [],
    deterministic_metrics: {},
    jarvis_result: { observationAccepted: true, progressDisposition: 'supported' },
  };
}

function mapped(confidence: string, comparability: string) {
  return buildDisplayStateFromComparison(comparisonRow(confidence, comparability), {
    selectedPriorPhotoId: 'prior',
    priorUpdateUsed: '2026-07-01',
  });
}

describe('comparison mapping point applies the Q9 cap', () => {
  it.each([
    ['high', 'weak', 'low'],
    ['high', 'not_comparable', 'low'],
    ['high', 'probable', 'medium'],
    ['high', 'strong', 'high'],
    ['medium', 'probable', 'medium'],
  ] as const)(
    'maps provider confidence %s with %s comparability to shown and scored %s',
    (providerConfidence, comparability, shown) => {
      const state = mapped(providerConfidence, comparability);

      expect(state.comparisonConfidence).toBe(shown);
      expect(state.comparability).toBe(comparability);
      // The provider's own confidence is kept, so nothing is lost.
      expect(state.providerComparisonConfidence).toBe(providerConfidence);
    },
  );

  it('keeps a missing provider confidence and comparability as unknown', () => {
    const state = buildDisplayStateFromComparison(
      { ...comparisonRow('high', 'weak'), confidence: null, comparability_classification: null },
      {},
    );

    expect(state.comparisonConfidence).toBe('unknown');
    expect(state.providerComparisonConfidence).toBe('unknown');
    expect(state.comparability).toBe('unknown');
  });
});

function photo(id: string, intelligence: PIEPhotoIntelligenceDisplayState | null): UpdatePhoto {
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

function progressFor(state: PIEPhotoIntelligenceDisplayState) {
  return buildPhotoProgress({
    projectName: 'Project A',
    updates: [
      update('prior-update', photo('prior', null)),
      update('current-update', photo('current', state)),
    ],
    now: new Date('2026-07-02T12:00:00.000Z'),
  });
}

describe('photo progress score uses the capped confidence (owner answer Q9)', () => {
  it('scores a probable comparison the AI rated high as medium, not 90', () => {
    const progress = progressFor(mapped('high', 'probable'));
    const [comparison] = progress.comparisons;

    expect(progress.comparisons).toHaveLength(1);
    expect(comparison.confidence).toBe('medium');
    expect(comparison.confidenceScore).toBe(65);
    expect(comparison.matchReasons).toContain('Comparability: probable');
    expect(comparison.matchReasons).toContain('Visual confidence: medium');
    expect(progress.comparisonConfidence).toBe('medium');
  });

  it('still scores a strong comparison the AI rated high as 90', () => {
    const progress = progressFor(mapped('high', 'strong'));
    const [comparison] = progress.comparisons;

    expect(comparison.confidence).toBe('high');
    expect(comparison.confidenceScore).toBe(90);
    expect(comparison.matchReasons).toContain('Visual confidence: high');
  });

  it('never scores or lists the raw provider confidence', () => {
    const state = mapped('high', 'probable');
    const progress = progressFor(state);

    expect(state.providerComparisonConfidence).toBe('high');
    expect(JSON.stringify(progress.comparisons[0].matchReasons)).not.toContain('high');
  });

  it('keeps weakly comparable pairs out of the progress score entirely', () => {
    // Existing policy (PhotoAssessment): only strong or probable pairs can be
    // reviewed; the Q9 cap is what their shown confidence reads.
    const state = mapped('high', 'weak');

    expect(state.comparisonConfidence).toBe('low');
    expect(progressFor(state).comparisons).toHaveLength(0);
  });
});
