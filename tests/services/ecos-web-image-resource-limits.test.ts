import {
  ECOS_MAX_WEB_IMAGE_SOURCE_DIMENSION,
  preflightECOSWebImage,
} from '../../services/ECOSWebImageResourceLimits';
import { renderECOSWebDocumentProofPreview } from '../../services/ECOSWebDocumentProofPreview';

function png(
  width: number,
  height: number,
  frameCount = 1,
  animationControl = false,
  bitDepth = 8,
  colorType = 6,
) {
  const chunks: number[] = [];
  const chunk = (type: string, data: number[]) => {
    const length = data.length;
    chunks.push(
      (length >>> 24) & 0xff,
      (length >>> 16) & 0xff,
      (length >>> 8) & 0xff,
      length & 0xff,
      ...Array.from(type, character => character.charCodeAt(0)),
      ...data,
      0, 0, 0, 0,
    );
  };
  chunk('IHDR', [
    (width >>> 24) & 0xff, (width >>> 16) & 0xff, (width >>> 8) & 0xff, width & 0xff,
    (height >>> 24) & 0xff, (height >>> 16) & 0xff, (height >>> 8) & 0xff, height & 0xff,
    bitDepth, colorType, 0, 0, 0,
  ]);
  if (animationControl || frameCount > 1) {
    chunk('acTL', [
      (frameCount >>> 24) & 0xff,
      (frameCount >>> 16) & 0xff,
      (frameCount >>> 8) & 0xff,
      frameCount & 0xff,
      0, 0, 0, 0,
    ]);
  }
  chunk('IDAT', [0]);
  chunk('IEND', []);
  return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...chunks]);
}

function gif(
  width: number,
  height: number,
  frames: ReadonlyArray<Readonly<{
    left?: number;
    top?: number;
    width: number;
    height: number;
  }>>,
) {
  const little16 = (value: number) => [value & 0xff, (value >>> 8) & 0xff];
  const descriptors = frames.flatMap(frame => [
    0x2c,
    ...little16(frame.left || 0),
    ...little16(frame.top || 0),
    ...little16(frame.width),
    ...little16(frame.height),
    0,
    2, 1, 0, 0,
  ]);
  return new Uint8Array([
    ...Array.from('GIF89a', character => character.charCodeAt(0)),
    ...little16(width), ...little16(height),
    0, 0, 0,
    ...descriptors,
    0x3b,
  ]);
}

function webpLossless(width: number, height: number) {
  const little32 = (value: number) => [
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ];
  const packed = (width - 1) | ((height - 1) << 14);
  const chunk = [
    ...Array.from('VP8L', character => character.charCodeAt(0)),
    ...little32(5),
    0x2f, ...little32(packed),
    0,
  ];
  return new Uint8Array([
    ...Array.from('RIFF', character => character.charCodeAt(0)),
    ...little32(4 + chunk.length),
    ...Array.from('WEBP', character => character.charCodeAt(0)),
    ...chunk,
  ]);
}

function animatedWebp(width: number, height: number) {
  const little24 = (value: number) => [
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
  ];
  const chunk = [
    ...Array.from('VP8X', character => character.charCodeAt(0)),
    10, 0, 0, 0,
    0x02, 0, 0, 0,
    ...little24(width - 1),
    ...little24(height - 1),
  ];
  const riffLength = 4 + chunk.length;
  return new Uint8Array([
    ...Array.from('RIFF', character => character.charCodeAt(0)),
    riffLength & 0xff,
    (riffLength >>> 8) & 0xff,
    (riffLength >>> 16) & 0xff,
    (riffLength >>> 24) & 0xff,
    ...Array.from('WEBP', character => character.charCodeAt(0)),
    ...chunk,
  ]);
}

function bmp(width: number, height: number) {
  const rowBytes = Math.ceil((width * 24) / 32) * 4;
  const bytes = new Uint8Array(54 + rowBytes * height);
  const view = new DataView(bytes.buffer);
  bytes[0] = 0x42;
  bytes[1] = 0x4d;
  view.setUint32(2, bytes.length, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(30, 0, true);
  return bytes;
}

function jpeg(width: number, height: number) {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >>> 8) & 0xff, height & 0xff,
    (width >>> 8) & 0xff, width & 0xff,
    0x03,
    0x01, 0x11, 0x00,
    0x02, 0x11, 0x00,
    0x03, 0x11, 0x00,
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
    0xff, 0xd9,
  ]);
}

describe('ECOS web image pre-decode resource policy', () => {
  it('accepts supported static image headers without decoding', async () => {
    await expect(preflightECOSWebImage(png(4_032, 3_024), {
      declaredMimeType: 'image/png',
    })).resolves.toMatchObject({
      format: 'png',
      width: 4_032,
      height: 3_024,
      frameCount: 1,
      decodedByteLength: 4_032 * 3_024 * 4,
    });
    await expect(preflightECOSWebImage(png(64, 32, 1, false, 16, 6), {
      declaredMimeType: 'image/png',
    })).resolves.toMatchObject({
      decodedBytesPerPixel: 8,
      decodedByteLength: 64 * 32 * 8,
    });
    await expect(preflightECOSWebImage(jpeg(1_920, 1_080), {
      declaredMimeType: 'image/jpeg',
    })).resolves.toMatchObject({
      format: 'jpeg',
      width: 1_920,
      height: 1_080,
      frameCount: 1,
    });
    await expect(preflightECOSWebImage(gif(320, 200, [
      { width: 320, height: 200 },
    ]), { declaredMimeType: 'image/gif' })).resolves.toMatchObject({
      format: 'gif', width: 320, height: 200, frameCount: 1,
    });
    await expect(preflightECOSWebImage(webpLossless(640, 480), {
      declaredMimeType: 'image/webp',
    })).resolves.toMatchObject({
      format: 'webp', width: 640, height: 480, frameCount: 1,
    });
    await expect(preflightECOSWebImage(bmp(32, 16), {
      declaredMimeType: 'image/bmp',
    })).resolves.toMatchObject({
      format: 'bmp', width: 32, height: 16, frameCount: 1,
    });
  });

  it('rejects oversized dimensions and animated input before browser decode', async () => {
    await expect(preflightECOSWebImage(
      png(ECOS_MAX_WEB_IMAGE_SOURCE_DIMENSION + 1, 1),
    )).rejects.toThrow(/dimensions|resource/i);
    await expect(preflightECOSWebImage(
      png(4_096, 2_049, 1, false, 16, 6),
    )).rejects.toThrow(/decoded size/i);
    await expect(preflightECOSWebImage(png(64, 64, 2)))
      .rejects.toThrow(/frame|animated/i);
    await expect(preflightECOSWebImage(png(64, 64, 1, true)))
      .rejects.toThrow(/animated/i);
    await expect(preflightECOSWebImage(animatedWebp(64, 64)))
      .rejects.toThrow(/animated/i);
    await expect(preflightECOSWebImage(gif(64, 64, [
      { width: 64, height: 64 },
      { width: 64, height: 64 },
    ]))).rejects.toThrow(/frame|animated/i);
  });

  it('rejects a GIF frame whose decoder surface exceeds its logical canvas', async () => {
    await expect(preflightECOSWebImage(gif(1, 1, [
      { width: 8_192, height: 8_192 },
    ]))).rejects.toThrow(/malformed|incomplete/i);
  });

  it('rejects unsupported and MIME-confused image bytes', async () => {
    await expect(preflightECOSWebImage(new Uint8Array([0x49, 0x49, 0x2a, 0x00])))
      .rejects.toThrow(/supported image format/i);
    await expect(preflightECOSWebImage(png(32, 32), {
      declaredMimeType: 'image/jpeg',
    })).rejects.toThrow(/does not match/i);
  });

  it('honors cancellation and the absolute preflight deadline', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(preflightECOSWebImage(png(32, 32), {
      signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' });
    await expect(preflightECOSWebImage(png(32, 32), {
      deadlineMilliseconds: Date.now() - 1,
    })).rejects.toThrow(/deadline/i);
  });

  it('rejects an animated preview response before constructing a browser Blob', async () => {
    const bytes = png(64, 64, 2);
    let delivered = false;
    const reader = {
      read: jest.fn(async () => {
        if (delivered) return { done: true, value: undefined };
        delivered = true;
        return { done: false, value: bytes };
      }),
      cancel: jest.fn(async () => undefined),
      releaseLock: jest.fn(),
    };
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;
    const originalFetch = globalThis.fetch;
    const originalBlob = globalThis.Blob;
    const blob = jest.fn();
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: {} });
    Object.defineProperty(globalThis, 'Blob', { configurable: true, value: blob });
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: jest.fn(async () => ({
        ok: true,
        status: 200,
        headers: { get: () => String(bytes.byteLength) },
        body: { getReader: () => reader },
      })),
    });
    try {
      await expect(renderECOSWebDocumentProofPreview({
        url: 'https://example.test/proof.png',
        mimeType: 'image/png',
        fileName: 'proof.png',
        pageNumber: 1,
        bounds: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
      })).rejects.toThrow(/animated/i);
      expect(blob).not.toHaveBeenCalled();
      expect(reader.releaseLock).toHaveBeenCalled();
    } finally {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: originalWindow,
      });
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: originalDocument,
      });
      Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        value: originalFetch,
      });
      Object.defineProperty(globalThis, 'Blob', {
        configurable: true,
        value: originalBlob,
      });
    }
  });
});
