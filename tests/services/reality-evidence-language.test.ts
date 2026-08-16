import {
  createRealityObject,
  type PIERealityObjectStatus,
  type PIERealityObjectType,
} from '../../services/PIERealityModel';
import {
  detectEvidenceConflicts,
  type PIEEvidenceQualityInput,
} from '../../services/PIEEvidenceQuality';

function inferredRealityStatus(
  summary: string,
  type: PIERealityObjectType = 'work_package',
): PIERealityObjectStatus {
  return createRealityObject({
    id: `reality-${summary}`,
    organizationId: 'org-1',
    projectId: 'project-1',
    type,
    name: 'Electrical rough-in',
    projectName: 'Project 1',
    summary,
    confidence: 'high',
    evidenceType: 'field_update',
    evidenceId: `evidence-${summary}`,
    classification: 'fact',
  }, '2026-07-18T12:00:00.000Z').currentStatus;
}

function evidence(id: string, summary: string): PIEEvidenceQualityInput {
  return {
    id,
    source: 'field_update',
    summary,
    projectName: 'Project 1',
    capturedAt: '2026-07-18T12:00:00.000Z',
  };
}

describe('typed assertion authority consumers', () => {
  describe('PIE Reality status inference', () => {
    it.each([
      ['is complete.', 'complete'],
      ['is not complete.', 'in_progress'],
      ['is incomplete.', 'in_progress'],
      ['has not started.', 'not_started'],
      ['is not approved.', 'needs_verification'],
      ['will be complete tomorrow.', 'needs_verification'],
      ['might be complete.', 'needs_verification'],
      ['will be complete if inspection passes.', 'needs_verification'],
      ['has a blocker that is not resolved.', 'blocked'],
      ['will be blocked tomorrow.', 'needs_verification'],
    ] as const)('maps %s to %s', (summary, expected) => {
      expect(inferredRealityStatus(summary)).toBe(expected);
    });

    it('does not turn explicit clear-safety language into a blocker', () => {
      expect(inferredRealityStatus(
        'No safety issues observed.',
        'safety_observation',
      )).not.toBe('blocked');
    });

    it('marks contradictory current language for review', () => {
      expect(inferredRealityStatus(
        'is complete, but Electrical rough-in is not complete.',
      )).toBe('contradicted');
    });
  });

  describe('PIE Evidence Quality conflict detection', () => {
    it('detects opposing current assertions for the same subject', () => {
      const conflicts = detectEvidenceConflicts([
        evidence('complete', 'Electrical rough-in is complete.'),
        evidence('blocked', 'Electrical rough-in is blocked.'),
      ]);

      expect(conflicts).toEqual([expect.objectContaining({
        evidenceIds: ['complete', 'blocked'],
        severity: 'high',
      })]);
    });

    it.each([
      'Electrical rough-in will be complete tomorrow.',
      'Electrical rough-in might be complete.',
      'Electrical rough-in will be complete if inspection passes.',
    ])('does not treat non-current completion as a conflicting fact: %s', summary => {
      expect(detectEvidenceConflicts([
        evidence('non-current', summary),
        evidence('blocked', 'Electrical rough-in is blocked.'),
      ])).toEqual([]);
    });

    it('does not call different subjects contradictory', () => {
      expect(detectEvidenceConflicts([
        evidence('canopy-a', 'Canopy A is complete.'),
        evidence('canopy-b', 'Canopy B is blocked.'),
      ])).toEqual([]);
    });

    it('does not turn clear-safety evidence into the negative side of a conflict', () => {
      expect(detectEvidenceConflicts([
        evidence('complete', 'Electrical rough-in is complete.'),
        evidence('safe', 'No safety issues observed.'),
      ])).toEqual([]);
    });

    it('detects a contradiction contained in one evidence record', () => {
      expect(detectEvidenceConflicts([
        evidence(
          'self-conflict',
          'Electrical rough-in is complete, but Electrical rough-in is not complete.',
        ),
      ])).toEqual([expect.objectContaining({
        evidenceIds: ['self-conflict'],
      })]);
    });
  });
});
