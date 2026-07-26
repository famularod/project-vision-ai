import {
  createDraftLocationCaptureTarget,
  isDraftLocationCaptureTargetCurrent,
} from '../../services/draft-location-capture-target';

describe('draft location capture target', () => {
  const originalDraft = {
    id: 'draft-1',
    projectName: '2375 Compliance Project',
  };

  it('accepts only the current generation for the same draft and project', () => {
    const target = createDraftLocationCaptureTarget(originalDraft, 3);

    expect(isDraftLocationCaptureTargetCurrent(target, originalDraft, 3)).toBe(true);
    expect(isDraftLocationCaptureTargetCurrent(target, originalDraft, 4)).toBe(false);
  });

  it('rejects a result after the user starts a new draft', () => {
    const target = createDraftLocationCaptureTarget(originalDraft, 1);

    expect(isDraftLocationCaptureTargetCurrent(
      target,
      { ...originalDraft, id: 'draft-2' },
      1,
    )).toBe(false);
  });

  it('rejects a result after the draft moves to another project', () => {
    const target = createDraftLocationCaptureTarget(originalDraft, 1);

    expect(isDraftLocationCaptureTargetCurrent(
      target,
      { ...originalDraft, projectName: '2321 Compliance Project' },
      1,
    )).toBe(false);
  });

  it('normalizes harmless project-name casing and whitespace', () => {
    const target = createDraftLocationCaptureTarget(originalDraft, 2);

    expect(isDraftLocationCaptureTargetCurrent(
      target,
      { ...originalDraft, projectName: ' 2375 compliance project ' },
      2,
    )).toBe(true);
  });
});
