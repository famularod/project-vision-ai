import { ecosProofPixelCrop } from '../services/ECOSWebDocumentProofPreview';

describe('ECOS web document proof crop', () => {
  it('adds bounded context around the exact normalized drawing region', () => {
    expect(ecosProofPixelCrop(1_000, 2_000, {
      x: 0.2,
      y: 0.3,
      width: 0.1,
      height: 0.05,
    })).toEqual({
      sourceX: 160,
      sourceY: 520,
      sourceWidth: 180,
      sourceHeight: 260,
    });
  });

  it('clamps padding at drawing edges without moving outside the page', () => {
    expect(ecosProofPixelCrop(500, 500, {
      x: 0,
      y: 0,
      width: 0.05,
      height: 0.05,
    })).toEqual({
      sourceX: 0,
      sourceY: 0,
      sourceWidth: 45,
      sourceHeight: 45,
    });
  });

  it('rejects invalid source dimensions', () => {
    expect(() => ecosProofPixelCrop(0, 500, {
      x: 0.1,
      y: 0.1,
      width: 0.1,
      height: 0.1,
    })).toThrow('source drawing dimensions are invalid');
  });
});
