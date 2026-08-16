export const ECOS_MAX_WEB_IMAGE_BYTES = 96 * 1024 * 1024;
export const ECOS_MAX_WEB_IMAGE_SOURCE_DIMENSION = 8_192;
export const ECOS_MAX_WEB_IMAGE_SOURCE_PIXELS = 16_000_000;
export const ECOS_MAX_WEB_IMAGE_DECODED_BYTES = 64_000_000;
export const ECOS_MAX_WEB_IMAGE_FRAMES = 1;
export const ECOS_WEB_IMAGE_PREFLIGHT_TIMEOUT_MILLISECONDS = 5_000;

const MAX_IMAGE_STRUCTURES = 65_536;
const STRUCTURE_YIELD_INTERVAL = 1_024;
const MAX_JPEG_MARKER_FILL_BYTES = 1_024;

export type ECOSWebImageFormat = 'jpeg' | 'png' | 'gif' | 'webp' | 'bmp';

export type ECOSWebImageMetadata = Readonly<{
  format: ECOSWebImageFormat;
  mimeType: string;
  width: number;
  height: number;
  frameCount: number;
  sourcePixelCount: number;
  decodedBytesPerPixel: number;
  decodedByteLength: number;
}>;

type ParsedImageHeader = Readonly<{
  format: ECOSWebImageFormat;
  mimeType: string;
  width: number;
  height: number;
  frameCount: number;
  decodedBytesPerPixel: number;
}>;

type ImagePreflightContext = {
  readonly signal?: AbortSignal;
  readonly deadlineMilliseconds: number;
  structureCount: number;
};

/**
 * Parses only bounded image container headers. No browser or native image
 * decoder receives the bytes until this format, frame, source-pixel, and
 * decoded-byte policy has succeeded.
 */
export async function preflightECOSWebImage(
  input: ArrayBuffer | Uint8Array,
  options: Readonly<{
    signal?: AbortSignal;
    deadlineMilliseconds?: number;
    declaredMimeType?: string | null;
  }> = {},
): Promise<ECOSWebImageMetadata> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const context: ImagePreflightContext = {
    signal: options.signal,
    deadlineMilliseconds: options.deadlineMilliseconds
      ?? Date.now() + ECOS_WEB_IMAGE_PREFLIGHT_TIMEOUT_MILLISECONDS,
    structureCount: 0,
  };
  await imagePreflightCheckpoint(context);
  if (bytes.byteLength < 4 || bytes.byteLength > ECOS_MAX_WEB_IMAGE_BYTES) {
    throw new Error('The image byte length exceeds protected preview resource limits.');
  }

  let parsed: ParsedImageHeader;
  if (matches(bytes, [0xff, 0xd8])) {
    parsed = await parseJpegHeader(bytes, context);
  } else if (matches(bytes, [137, 80, 78, 71, 13, 10, 26, 10])) {
    parsed = await parsePngHeader(bytes, context);
  } else if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') {
    parsed = await parseGifHeader(bytes, context);
  } else if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    parsed = await parseWebPHeader(bytes, context);
  } else if (ascii(bytes, 0, 2) === 'BM') {
    parsed = await parseBmpHeader(bytes, context);
  } else {
    throw new Error(
      'This file is not a supported image format for protected preview. Use JPEG, PNG, static GIF, WebP, or uncompressed BMP.',
    );
  }

  assertDeclaredMimeType(options.declaredMimeType, parsed.format);
  const { width, height, frameCount, decodedBytesPerPixel } = parsed;
  const sourcePixelCount = width * height;
  const decodedByteLength = sourcePixelCount * decodedBytesPerPixel;
  if (
    !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width < 1
    || height < 1
    || width > ECOS_MAX_WEB_IMAGE_SOURCE_DIMENSION
    || height > ECOS_MAX_WEB_IMAGE_SOURCE_DIMENSION
    || !Number.isSafeInteger(sourcePixelCount)
    || sourcePixelCount > ECOS_MAX_WEB_IMAGE_SOURCE_PIXELS
  ) {
    throw new Error('The image dimensions exceed protected preview resource limits.');
  }
  if (
    !Number.isSafeInteger(frameCount)
    || frameCount < 1
    || frameCount > ECOS_MAX_WEB_IMAGE_FRAMES
  ) {
    throw new Error('Animated or multi-frame images are not supported in protected preview.');
  }
  if (
    !Number.isSafeInteger(decodedByteLength)
    || decodedByteLength > ECOS_MAX_WEB_IMAGE_DECODED_BYTES
  ) {
    throw new Error('The image decoded size exceeds protected preview resource limits.');
  }
  await imagePreflightCheckpoint(context);
  return Object.freeze({
    ...parsed,
    sourcePixelCount,
    decodedByteLength,
  });
}

async function parseJpegHeader(
  bytes: Uint8Array,
  context: ImagePreflightContext,
): Promise<ParsedImageHeader> {
  let offset = 2;
  let width = 0;
  let height = 0;
  let frameHeaders = 0;
  let sawScan = false;
  while (offset < bytes.length) {
    await imagePreflightCheckpoint(context);
    if (bytes[offset] !== 0xff) throw malformedImage('JPEG');
    let markerFillBytes = 0;
    while (offset < bytes.length && bytes[offset] === 0xff) {
      offset += 1;
      markerFillBytes += 1;
      if (markerFillBytes > MAX_JPEG_MARKER_FILL_BYTES) {
        throw malformedImage('JPEG');
      }
    }
    if (offset >= bytes.length) throw malformedImage('JPEG');
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) throw malformedImage('JPEG');
    const segmentLength = readUint16BE(bytes, offset);
    if (segmentLength < 2 || segmentLength > bytes.length - offset) {
      throw malformedImage('JPEG');
    }
    const dataOffset = offset + 2;
    const dataLength = segmentLength - 2;
    if (isJpegStartOfFrame(marker)) {
      if (dataLength < 6) throw malformedImage('JPEG');
      frameHeaders += 1;
      height = readUint16BE(bytes, dataOffset + 1);
      width = readUint16BE(bytes, dataOffset + 3);
    }
    offset += segmentLength;
    if (marker === 0xda) {
      if (dataLength < 6) throw malformedImage('JPEG');
      sawScan = true;
      break;
    }
  }
  if (!sawScan || frameHeaders !== 1 || width < 1 || height < 1) {
    throw malformedImage('JPEG');
  }
  return {
    format: 'jpeg',
    mimeType: 'image/jpeg',
    width,
    height,
    frameCount: 1,
    decodedBytesPerPixel: 4,
  };
}

async function parsePngHeader(
  bytes: Uint8Array,
  context: ImagePreflightContext,
): Promise<ParsedImageHeader> {
  let offset = 8;
  let width = 0;
  let height = 0;
  let sawHeader = false;
  let sawImageData = false;
  let sawEnd = false;
  let decodedBytesPerPixel = 0;
  while (offset < bytes.length) {
    await imagePreflightCheckpoint(context);
    if (offset + 12 > bytes.length) throw malformedImage('PNG');
    const length = readUint32BE(bytes, offset);
    if (length > bytes.length - offset - 12) throw malformedImage('PNG');
    const type = ascii(bytes, offset + 4, 4);
    const dataOffset = offset + 8;
    if (type === 'IHDR') {
      if (sawHeader || offset !== 8 || length !== 13) throw malformedImage('PNG');
      width = readUint32BE(bytes, dataOffset);
      height = readUint32BE(bytes, dataOffset + 4);
      const bitDepth = bytes[dataOffset + 8];
      const colorType = bytes[dataOffset + 9];
      const compressionMethod = bytes[dataOffset + 10];
      const filterMethod = bytes[dataOffset + 11];
      const interlaceMethod = bytes[dataOffset + 12];
      const channelCount = pngChannelCount(colorType, bitDepth);
      if (
        channelCount == null
        || compressionMethod !== 0
        || filterMethod !== 0
        || (interlaceMethod !== 0 && interlaceMethod !== 1)
      ) throw malformedImage('PNG');
      // Browser canvases need at least RGBA8 storage. Preserve the larger
      // source precision for 16-bit RGB/RGBA so it cannot evade the decoded
      // byte budget by advertising only its pixel count.
      decodedBytesPerPixel = Math.max(4, Math.ceil(channelCount * bitDepth / 8));
      sawHeader = true;
    } else if (type === 'acTL') {
      if (length !== 8) throw malformedImage('PNG');
      throw animatedImage('PNG');
    } else if (type === 'fcTL') {
      throw animatedImage('PNG');
    } else if (type === 'IDAT') {
      if (!sawHeader) throw malformedImage('PNG');
      sawImageData = true;
    } else if (type === 'IEND') {
      if (length !== 0) throw malformedImage('PNG');
      sawEnd = true;
      offset += 12;
      break;
    }
    offset += length + 12;
  }
  if (!sawHeader || !sawImageData || !sawEnd || offset !== bytes.length) {
    throw malformedImage('PNG');
  }
  return {
    format: 'png',
    mimeType: 'image/png',
    width,
    height,
    frameCount: 1,
    decodedBytesPerPixel,
  };
}

async function parseGifHeader(
  bytes: Uint8Array,
  context: ImagePreflightContext,
): Promise<ParsedImageHeader> {
  if (bytes.length < 14) throw malformedImage('GIF');
  const width = readUint16LE(bytes, 6);
  const height = readUint16LE(bytes, 8);
  const packed = bytes[10];
  let offset = 13;
  if ((packed & 0x80) !== 0) {
    offset += 3 * (1 << ((packed & 0x07) + 1));
  }
  let frameCount = 0;
  let sawTrailer = false;
  while (offset < bytes.length) {
    await imagePreflightCheckpoint(context);
    const introducer = bytes[offset];
    if (introducer === 0x3b) {
      offset += 1;
      sawTrailer = true;
      break;
    }
    if (introducer === 0x21) {
      if (offset + 2 > bytes.length) throw malformedImage('GIF');
      offset = await skipGifSubBlocks(bytes, offset + 2, context);
      continue;
    }
    if (introducer !== 0x2c || offset + 10 > bytes.length) {
      throw malformedImage('GIF');
    }
    const frameLeft = readUint16LE(bytes, offset + 1);
    const frameTop = readUint16LE(bytes, offset + 3);
    const frameWidth = readUint16LE(bytes, offset + 5);
    const frameHeight = readUint16LE(bytes, offset + 7);
    if (
      frameWidth < 1
      || frameHeight < 1
      || frameLeft + frameWidth > width
      || frameTop + frameHeight > height
    ) {
      throw malformedImage('GIF');
    }
    frameCount += 1;
    const imagePacked = bytes[offset + 9];
    offset += 10;
    if ((imagePacked & 0x80) !== 0) {
      offset += 3 * (1 << ((imagePacked & 0x07) + 1));
    }
    if (offset >= bytes.length) throw malformedImage('GIF');
    offset += 1;
    offset = await skipGifSubBlocks(bytes, offset, context);
  }
  if (!sawTrailer || offset !== bytes.length || frameCount < 1) {
    throw malformedImage('GIF');
  }
  return {
    format: 'gif',
    mimeType: 'image/gif',
    width,
    height,
    frameCount,
    decodedBytesPerPixel: 4,
  };
}

async function skipGifSubBlocks(
  bytes: Uint8Array,
  initialOffset: number,
  context: ImagePreflightContext,
) {
  let offset = initialOffset;
  while (offset < bytes.length) {
    await imagePreflightCheckpoint(context);
    const length = bytes[offset];
    offset += 1;
    if (length === 0) return offset;
    if (length > bytes.length - offset) throw malformedImage('GIF');
    offset += length;
  }
  throw malformedImage('GIF');
}

async function parseWebPHeader(
  bytes: Uint8Array,
  context: ImagePreflightContext,
): Promise<ParsedImageHeader> {
  if (bytes.length < 20) throw malformedImage('WebP');
  const riffLength = readUint32LE(bytes, 4) + 8;
  if (riffLength !== bytes.length) throw malformedImage('WebP');
  let offset = 12;
  let width = 0;
  let height = 0;
  let imagePayloadCount = 0;
  let extendedHeaderCount = 0;
  let payloadWidth = 0;
  let payloadHeight = 0;
  while (offset < bytes.length) {
    await imagePreflightCheckpoint(context);
    if (offset + 8 > bytes.length) throw malformedImage('WebP');
    const type = ascii(bytes, offset, 4);
    const length = readUint32LE(bytes, offset + 4);
    const dataOffset = offset + 8;
    if (length > bytes.length - dataOffset) throw malformedImage('WebP');
    if (type === 'VP8X') {
      if (length !== 10 || extendedHeaderCount > 0) throw malformedImage('WebP');
      extendedHeaderCount += 1;
      if ((bytes[dataOffset] & 0x02) !== 0) throw animatedImage('WebP');
      width = readUint24LE(bytes, dataOffset + 4) + 1;
      height = readUint24LE(bytes, dataOffset + 7) + 1;
    } else if (type === 'VP8 ') {
      if (length < 10
          || !matches(bytes, [0x9d, 0x01, 0x2a], dataOffset + 3)) {
        throw malformedImage('WebP');
      }
      imagePayloadCount += 1;
      payloadWidth = readUint16LE(bytes, dataOffset + 6) & 0x3fff;
      payloadHeight = readUint16LE(bytes, dataOffset + 8) & 0x3fff;
    } else if (type === 'VP8L') {
      if (length < 5 || bytes[dataOffset] !== 0x2f) throw malformedImage('WebP');
      imagePayloadCount += 1;
      const packed = readUint32LE(bytes, dataOffset + 1);
      payloadWidth = (packed & 0x3fff) + 1;
      payloadHeight = ((packed >>> 14) & 0x3fff) + 1;
    } else if (type === 'ANIM') {
      throw animatedImage('WebP');
    } else if (type === 'ANMF') {
      throw animatedImage('WebP');
    }
    offset = dataOffset + length + (length % 2);
  }
  if (imagePayloadCount !== 1 || payloadWidth < 1 || payloadHeight < 1) {
    throw malformedImage('WebP');
  }
  if (!width) width = payloadWidth;
  if (!height) height = payloadHeight;
  if (
    offset !== bytes.length
    || width !== payloadWidth
    || height !== payloadHeight
  ) {
    throw malformedImage('WebP');
  }
  return {
    format: 'webp',
    mimeType: 'image/webp',
    width,
    height,
    frameCount: 1,
    decodedBytesPerPixel: 4,
  };
}

async function parseBmpHeader(
  bytes: Uint8Array,
  context: ImagePreflightContext,
): Promise<ParsedImageHeader> {
  await imagePreflightCheckpoint(context);
  if (bytes.length < 54) throw malformedImage('BMP');
  const dibHeaderBytes = readUint32LE(bytes, 14);
  if (dibHeaderBytes < 40 || dibHeaderBytes > bytes.length - 14) {
    throw malformedImage('BMP');
  }
  const pixelOffset = readUint32LE(bytes, 10);
  const width = readInt32LE(bytes, 18);
  const rawHeight = readInt32LE(bytes, 22);
  const height = Math.abs(rawHeight);
  const planes = readUint16LE(bytes, 26);
  const bitsPerPixel = readUint16LE(bytes, 28);
  const compression = readUint32LE(bytes, 30);
  if (
    width < 1
    || rawHeight === 0
    || pixelOffset < 14 + dibHeaderBytes
    || pixelOffset > bytes.length
    || planes !== 1
    || ![24, 32].includes(bitsPerPixel)
    || compression !== 0
  ) {
    throw malformedImage('BMP');
  }
  const rowBytes = Math.ceil((width * bitsPerPixel) / 32) * 4;
  const requiredBytes = pixelOffset + rowBytes * height;
  if (!Number.isSafeInteger(requiredBytes) || requiredBytes > bytes.length) {
    throw malformedImage('BMP');
  }
  return {
    format: 'bmp',
    mimeType: 'image/bmp',
    width,
    height,
    frameCount: 1,
    decodedBytesPerPixel: 4,
  };
}

function pngChannelCount(colorType: number, bitDepth: number): number | null {
  const legalDepths = colorType === 0
    ? [1, 2, 4, 8, 16]
    : colorType === 2
      ? [8, 16]
      : colorType === 3
        ? [1, 2, 4, 8]
        : colorType === 4 || colorType === 6
          ? [8, 16]
          : [];
  if (!legalDepths.includes(bitDepth)) return null;
  return colorType === 0 || colorType === 3
    ? 1
    : colorType === 2
      ? 3
      : colorType === 4
        ? 2
        : 4;
}

async function imagePreflightCheckpoint(context: ImagePreflightContext) {
  throwIfImagePreflightStopped(context);
  context.structureCount += 1;
  if (context.structureCount > MAX_IMAGE_STRUCTURES) {
    throw new Error('The image container has too many structures for protected preview.');
  }
  if (context.structureCount % STRUCTURE_YIELD_INTERVAL === 0) {
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    throwIfImagePreflightStopped(context);
  }
}

function throwIfImagePreflightStopped(context: ImagePreflightContext) {
  if (context.signal?.aborted) {
    const error = new Error('The protected image preview was cancelled.');
    error.name = 'AbortError';
    throw error;
  }
  if (!Number.isFinite(context.deadlineMilliseconds)
      || Date.now() >= context.deadlineMilliseconds) {
    throw new Error('Image header preparation exceeded its absolute deadline and was cancelled.');
  }
}

function assertDeclaredMimeType(
  declaredMimeType: string | null | undefined,
  detectedFormat: ECOSWebImageFormat,
) {
  const normalized = (declaredMimeType || '').trim().toLowerCase().split(';', 1)[0];
  if (!normalized || normalized === 'application/octet-stream') return;
  const declaredFormat: ECOSWebImageFormat | null =
    normalized === 'image/jpeg' || normalized === 'image/jpg' || normalized === 'image/pjpeg'
      ? 'jpeg'
      : normalized === 'image/png'
        ? 'png'
        : normalized === 'image/gif'
          ? 'gif'
          : normalized === 'image/webp'
            ? 'webp'
            : normalized === 'image/bmp' || normalized === 'image/x-ms-bmp'
              ? 'bmp'
              : null;
  if (!declaredFormat) {
    throw new Error('The declared image type is not supported for protected preview.');
  }
  if (declaredFormat !== detectedFormat) {
    throw new Error('The declared image type does not match its protected file header.');
  }
}

function isJpegStartOfFrame(marker: number) {
  return [
    0xc0, 0xc1, 0xc2, 0xc3,
    0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb,
    0xcd, 0xce, 0xcf,
  ].includes(marker);
}

function matches(bytes: Uint8Array, expected: readonly number[], offset = 0) {
  return expected.every((value, index) => bytes[offset + index] === value);
}

function ascii(bytes: Uint8Array, offset: number, length: number) {
  if (offset < 0 || length < 0 || offset + length > bytes.length) return '';
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function readUint16BE(bytes: Uint8Array, offset: number) {
  return dataView(bytes, offset, 2).getUint16(0, false);
}

function readUint16LE(bytes: Uint8Array, offset: number) {
  return dataView(bytes, offset, 2).getUint16(0, true);
}

function readUint24LE(bytes: Uint8Array, offset: number) {
  if (offset < 0 || offset + 3 > bytes.length) throw malformedImage('image');
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readUint32BE(bytes: Uint8Array, offset: number) {
  return dataView(bytes, offset, 4).getUint32(0, false);
}

function readUint32LE(bytes: Uint8Array, offset: number) {
  return dataView(bytes, offset, 4).getUint32(0, true);
}

function readInt32LE(bytes: Uint8Array, offset: number) {
  return dataView(bytes, offset, 4).getInt32(0, true);
}

function dataView(bytes: Uint8Array, offset: number, length: number) {
  if (offset < 0 || offset + length > bytes.length) throw malformedImage('image');
  return new DataView(bytes.buffer, bytes.byteOffset + offset, length);
}

function malformedImage(format: string) {
  return new Error(`The ${format} image header is malformed or incomplete.`);
}

function animatedImage(format: string) {
  return new Error(`Animated ${format} images are not supported in protected preview.`);
}
