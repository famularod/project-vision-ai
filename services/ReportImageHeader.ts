import type { ReportImageFormat } from './ReportWordImageFormat';

/**
 * How large a picture is, read from the few bytes at the start of its file
 * that say so, without opening the picture (review pass 1, L6 and L7).
 *
 * The phone's image tool cannot tell a picture's size without loading its
 * whole file into memory, and for a picture stored turned it redraws the
 * picture upright at full size before it answers. So the two questions the
 * Word report asks before it opens a picture are answered here instead:
 * "does this photo need to be made smaller at all?" and "is this scan too
 * large to open?".
 *
 * Read here: JPEG, PNG, GIF, BMP, WebP and ordinary TIFF. A header
 * describes dimensions; it does not prove that the picture can be decoded.
 * Not read here (null, and the caller asks the device as before): HEIC and
 * HEIF, AVIF, BigTIFF, a PNG that says it is stored turned, and any file
 * whose size fields cannot be read. Some damaged files still have size fields.
 *
 * The size returned is the picture's size as it is shown upright: a JPEG or
 * TIFF that states a standard orientation has its width and height swapped.
 * JPEG metadata this reader cannot resolve is left to the device, while
 * readReportImageHeaderInfo retains the pixel budget for the early guard.
 */
export type ReportImageBytes = Readonly<{
  /** Up to `length` bytes starting at `offset`; fewer, or none, at the end of the file. */
  read(offset: number, length: number): Uint8Array;
}>;

export type ReportImageHeaderSize = Readonly<{ width: number; height: number }>;

export type ReportImageHeaderInfo = ReportImageHeaderSize & Readonly<{
  /** False: width/height are the encoded frame's dimensions, for its pixel budget only. */
  displaySizeKnown: boolean;
}>;

/** The most header segments, chunks or directory entries walked before giving up. */
const MAX_STEPS = 512;
/** The most of one EXIF block read to find the orientation. */
const MAX_EXIF_BYTES = 65_536;
/** Bound all EXIF payload reads in one JPEG, not just each block individually. */
const MAX_JPEG_EXIF_BYTES = 262_144;

export function readReportImageHeaderSize(
  format: ReportImageFormat,
  bytes: ReportImageBytes,
): ReportImageHeaderSize | null {
  const info = readReportImageHeaderInfo(format, bytes);
  return info?.displaySizeKnown ? { width: info.width, height: info.height } : null;
}

/**
 * Dimensions for the early pixel guard even when upright dimensions need
 * the platform's metadata reader. A quarter turn never changes pixel count.
 */
export function readReportImageHeaderInfo(
  format: ReportImageFormat,
  bytes: ReportImageBytes,
): ReportImageHeaderInfo | null {
  try {
    const size = sizeFor(format, bytes);
    if (!size) return null;
    const { width, height } = size;
    return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0
      ? { width, height, displaySizeKnown: size.displaySizeKnown }
      : null;
  } catch {
    return null;
  }
}

function sizeFor(format: ReportImageFormat, bytes: ReportImageBytes) {
  if (format === 'jpeg') return jpegSize(bytes);
  const size = format === 'png' ? pngSize(bytes)
    : format === 'gif' ? gifSize(bytes)
    : format === 'bmp' ? bmpSize(bytes)
    : format === 'webp' ? webpSize(bytes)
    : format === 'tiff' ? tiffSize(bytes)
    : null;
  return size ? { ...size, displaySizeKnown: true } : null;
}

/** Stored on its side: EXIF orientations 5 to 8 swap width and height when shown. */
function upright(width: number, height: number, orientation: number | null) {
  return orientation !== null && orientation >= 5 && orientation <= 8
    ? { width: height, height: width }
    : { width, height };
}

function jpegSize(bytes: ReportImageBytes) {
  let offset = 2;
  let orientation: number | null = null;
  let orientationCount = 0;
  let uncertain = false;
  let frameSize: ReportImageHeaderSize | null = null;
  let exifBytesLeft = MAX_JPEG_EXIF_BYTES;
  const finish = (): ReportImageHeaderInfo | null => frameSize && (uncertain
    ? { ...frameSize, displaySizeKnown: false }
    : { ...upright(frameSize.width, frameSize.height, orientation), displaySizeKnown: true });
  for (let step = 0; step < MAX_STEPS; step += 1) {
    const head = bytes.read(offset, 4);
    if (head.length < 2 || head[0] !== 0xff) return finish();
    const marker = head[1];
    // A fill byte before a marker.
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    // Markers that stand alone, with no length after them.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      offset += 2;
      continue;
    }
    // Metadata may follow the frame, so scan through to the image data/end.
    if (marker === 0xd9 || marker === 0xda) return finish();
    if (head.length < 4) { uncertain = true; return finish(); }
    const length = (head[2] << 8) | head[3];
    if (length < 2) { uncertain = true; return finish(); }
    if (isJpegFrameMarker(marker)) {
      const frame = bytes.read(offset + 4, 5);
      if (length < 7 || frame.length < 5) { uncertain = true; return finish(); }
      const stated = { width: (frame[3] << 8) | frame[4], height: (frame[1] << 8) | frame[2] };
      if (frameSize) uncertain = true;
      // Conflicting frames cannot resolve display shape, but the largest
      // stated pixel budget must still reach the guard before decoding.
      if (!frameSize || stated.width * stated.height > frameSize.width * frameSize.height) frameSize = stated;
    }
    if (marker === 0xe1) {
      const prefix = bytes.read(offset + 4, Math.min(length - 2, 6));
      if (startsWithText(prefix, 'Exif\0\0') && exifBytesLeft > 0) {
        const block = bytes.read(offset + 4, Math.min(length - 2, MAX_EXIF_BYTES, exifBytesLeft));
        exifBytesLeft -= block.length;
        const directory = tiffDirectory(windowOf(block, 6), true);
        if (block.length !== length - 2 || !directory || directory.orientationUncertain) uncertain = true;
        if (directory?.orientation !== null && directory?.orientation !== undefined) {
          orientationCount += 1;
          if (orientationCount > 1) uncertain = true;
          orientation = directory.orientation;
        }
      } else {
        // Includes XMP (attribute/element/namespace/precedence variations).
        // Do not guess XML semantics or assume APP1 contains only EXIF.
        uncertain = true;
      }
    }
    offset += 2 + length;
  }
  uncertain = true;
  return finish();
}

/** Start-of-frame markers carry the size; C4, C8 and CC are other tables in the same range. */
function isJpegFrameMarker(marker: number) {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function pngSize(bytes: ReportImageBytes) {
  const header = bytes.read(8, 16);
  if (header.length < 16 || !startsWithText(header.subarray(4), 'IHDR')) return null;
  const width = uint32(header, 8, false);
  const height = uint32(header, 12, false);
  // A PNG may say it is stored turned (an eXIf chunk before the picture data). Rare; the device is asked then.
  let offset = 8;
  for (let step = 0; step < MAX_STEPS; step += 1) {
    const chunk = bytes.read(offset, 8);
    if (chunk.length < 8) break;
    const length = uint32(chunk, 0, false);
    const type = text(chunk, 4, 4);
    if (type === 'IDAT' || type === 'IEND') break;
    if (type === 'eXIf') {
      const stated = tiffDirectory(windowOf(bytes.read(offset + 8, Math.min(length, MAX_EXIF_BYTES)), 0))?.orientation ?? null;
      if (stated !== null && stated !== 1) return null;
    }
    offset += 12 + length;
  }
  return { width, height };
}

function gifSize(bytes: ReportImageBytes) {
  const screen = bytes.read(6, 4);
  return screen.length < 4 ? null : { width: uint16(screen, 0, true), height: uint16(screen, 2, true) };
}

function bmpSize(bytes: ReportImageBytes) {
  const header = bytes.read(14, 12);
  if (header.length < 8) return null;
  // The oldest header (12 bytes) keeps both as 16-bit numbers.
  if (uint32(header, 0, true) === 12) {
    return { width: uint16(header, 4, true), height: uint16(header, 6, true) };
  }
  if (header.length < 12) return null;
  // A negative height only means the rows are stored top to bottom.
  return { width: int32(header, 4, true), height: Math.abs(int32(header, 8, true)) };
}

function webpSize(bytes: ReportImageBytes) {
  const header = bytes.read(12, 18);
  if (header.length < 8) return null;
  const kind = text(header, 0, 4);
  if (kind === 'VP8X' && header.length >= 18) {
    return { width: uint24(header, 12) + 1, height: uint24(header, 15) + 1 };
  }
  if (kind === 'VP8 ' && header.length >= 18
    && header[11] === 0x9d && header[12] === 0x01 && header[13] === 0x2a) {
    return { width: uint16(header, 14, true) & 0x3fff, height: uint16(header, 16, true) & 0x3fff };
  }
  if (kind === 'VP8L' && header.length >= 13 && header[8] === 0x2f) {
    const packed = uint32(header, 9, true);
    return { width: (packed & 0x3fff) + 1, height: ((packed >>> 14) & 0x3fff) + 1 };
  }
  return null;
}

function tiffSize(bytes: ReportImageBytes) {
  const directory = tiffDirectory(bytes);
  if (!directory || directory.width === null || directory.height === null) return null;
  return upright(directory.width, directory.height, directory.orientation);
}

/**
 * The first directory of a TIFF structure: a TIFF file itself, or the EXIF
 * block inside a JPEG or PNG. Gives the width, height and orientation it
 * names, each null when it does not.
 */
function tiffDirectory(bytes: ReportImageBytes, standardOrientationOnly = false) {
  const header = bytes.read(0, 8);
  if (header.length < 8) return null;
  const little = header[0] === 0x49 && header[1] === 0x49;
  if (!little && !(header[0] === 0x4d && header[1] === 0x4d)) return null;
  // 42 is an ordinary TIFF; 43 (BigTIFF) is laid out differently and is not read.
  if (uint16(header, 2, little) !== 42) return null;
  const start = uint32(header, 4, little);
  const counted = bytes.read(start, 2);
  if (counted.length < 2) return null;
  const statedCount = uint16(counted, 0, little);
  const count = Math.min(statedCount, MAX_STEPS);
  const entries = bytes.read(start + 2, count * 12);
  let width: number | null = null;
  let height: number | null = null;
  let orientation: number | null = null;
  let orientationUncertain = standardOrientationOnly && (statedCount > MAX_STEPS || entries.length < count * 12);
  let orientations = 0;
  for (let at = 0; at + 12 <= entries.length; at += 12) {
    const tag = uint16(entries, at, little);
    if (tag !== 256 && tag !== 257 && tag !== 274) continue;
    const type = uint16(entries, at + 2, little);
    if (tag === 274 && standardOrientationOnly) {
      orientations += 1;
      // EXIF 274 is SHORT/count1. Other encodings and duplicates are
      // delegated to the actual platform instead of predicting its policy.
      if (type !== 3 || uint32(entries, at + 4, little) !== 1 || orientations > 1) orientationUncertain = true;
    }
    if (uint32(entries, at + 4, little) !== 1) continue;
    // A short number (type 3) sits in the first two bytes of the value; a long one (type 4) fills it.
    const value = type === 3 ? uint16(entries, at + 8, little) : type === 4 ? uint32(entries, at + 8, little) : null;
    if (value === null) continue;
    if (tag === 256) width = value;
    else if (tag === 257) height = value;
    else if (value >= 1 && value <= 8) orientation = value;
    else if (standardOrientationOnly) orientationUncertain = true;
  }
  return { width, height, orientation, orientationUncertain };
}

/** The same bytes, counted from `from`. */
function windowOf(block: Uint8Array, from: number): ReportImageBytes {
  return {
    read: (offset, length) => block.subarray(from + offset, from + offset + Math.max(0, length)),
  };
}

function startsWithText(bytes: Uint8Array, value: string) {
  return bytes.length >= value.length && text(bytes, 0, value.length) === value;
}

function text(bytes: Uint8Array, offset: number, length: number) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function uint16(bytes: Uint8Array, offset: number, little: boolean) {
  return little
    ? bytes[offset] | (bytes[offset + 1] << 8)
    : (bytes[offset] << 8) | bytes[offset + 1];
}

function uint24(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function uint32(bytes: Uint8Array, offset: number, little: boolean) {
  const [a, b, c, d] = little
    ? [bytes[offset + 3], bytes[offset + 2], bytes[offset + 1], bytes[offset]]
    : [bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]];
  return ((a * 0x1000000) + ((b << 16) | (c << 8) | d)) >>> 0;
}

function int32(bytes: Uint8Array, offset: number, little: boolean) {
  return uint32(bytes, offset, little) | 0;
}
