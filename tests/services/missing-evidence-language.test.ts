import { findMissingEvidence } from '../../services/PIEMissingEvidence';

describe('missing evidence language', () => {
  it('does not treat a sentence-valued schedule summary as a work-area label', () => {
    const result = findMissingEvidence({
      projectName: '2321 Compliance Project',
      schedulePriority: 'No critical path candidates are currently identified.',
      hasAnyPhoto: false,
      hasCurrentPhoto: true,
      hasLocation: true,
      hasSchedule: true,
      hasOwner: true,
      hasDecision: true,
      hasInspectionStatus: true,
      hasSafetyConfirmation: true,
      hasProgressNote: true,
      hasDocument: true,
      hasReportReview: true,
    });

    const photoGap = result.items.find(item => item.type === 'missing_photo');

    expect(photoGap?.nextCaptureAction).toBe(
      'Capture one current photo for the priority work area.',
    );
    expect(photoGap?.nextCaptureAction).not.toContain('identified..');
  });

  it('preserves a concise schedule work-area label', () => {
    const result = findMissingEvidence({
      projectName: '2375 Compliance Project',
      schedulePriority: 'Canopy C',
      hasAnyPhoto: false,
      hasCurrentPhoto: true,
      hasLocation: true,
      hasSchedule: true,
      hasOwner: true,
      hasDecision: true,
      hasInspectionStatus: true,
      hasSafetyConfirmation: true,
      hasProgressNote: true,
      hasDocument: true,
      hasReportReview: true,
    });

    const photoGap = result.items.find(item => item.type === 'missing_photo');

    expect(photoGap?.nextCaptureAction).toBe('Capture one current photo for Canopy C.');
  });
});
