import {
  ecosProofPixelCrop,
  renderECOSWebProtectedPageProofPreview,
} from '../services/ECOSWebDocumentProofPreview';

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

describe('protected ECOS web page crop', () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;

  afterEach(() => {
    Object.assign(globalThis, { window: originalWindow, document: originalDocument });
  });

  it('renders and crops the protected page without downloading a document URL', async () => {
    const drawImage = jest.fn();
    const createElement = jest.fn((tag: string) => {
      if (tag === 'img') {
        const image: Record<string, unknown> = {
          naturalWidth: 1_000,
          naturalHeight: 2_000,
          onload: null,
          onerror: null,
        };
        Object.defineProperty(image, 'src', {
          set() {
            queueMicrotask(() => (image.onload as (() => void) | null)?.());
          },
        });
        return image;
      }
      return {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage }),
        toDataURL: () => 'data:image/jpeg;base64,cropped',
      };
    });
    Object.assign(globalThis, {
      window: {},
      document: { createElement },
    });

    await expect(renderECOSWebProtectedPageProofPreview({
      dataUrl: 'data:image/png;base64,AAAA',
      bounds: { x: 0.2, y: 0.3, width: 0.1, height: 0.05 },
    })).resolves.toEqual({
      dataUrl: 'data:image/jpeg;base64,cropped',
      width: 180,
      height: 260,
    });
    expect(createElement).toHaveBeenCalledWith('img');
    expect(drawImage).toHaveBeenCalledTimes(2);
  });

  it('rejects a non-PNG protected image before rendering', async () => {
    Object.assign(globalThis, { window: {}, document: {} });
    await expect(renderECOSWebProtectedPageProofPreview({
      dataUrl: 'https://example.com/drawing.png',
      bounds: { x: 0.2, y: 0.3, width: 0.1, height: 0.05 },
    })).rejects.toThrow('protected drawing image is invalid');
  });
});
