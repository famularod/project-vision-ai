/**
 * The one image-format policy for a Word report (independent review R07),
 * used by the phone and iPad report, the desktop report and the Word builder.
 *
 * - What a file is comes from its own first bytes. A file name or a stored
 *   type is never believed: a WebP named photo.jpg is a WebP.
 * - Only JPEG, PNG, GIF and BMP go into the document as they are; those are
 *   the types the Word builder can declare.
 * - Anything else (HEIC, WebP, TIFF and the rest) is converted, and the
 *   result is labelled by reading it back. Only a JPEG or PNG is accepted.
 * - A file that cannot be converted is listed under Media Requiring Review.
 *   Bytes are never embedded under a type they are not.
 */
export type ReportImageFormat =
  | 'jpeg'
  | 'png'
  | 'gif'
  | 'bmp'
  | 'webp'
  | 'heic'
  | 'tiff'
  | 'pdf'
  | 'unknown';

/** How much of the start of a file is needed to tell what it is. */
export const REPORT_IMAGE_SIGNATURE_BYTES = 64;

const WORD_EMBEDS = {
  jpeg: { mimeType: 'image/jpeg', docxType: 'jpg' },
  png: { mimeType: 'image/png', docxType: 'png' },
  gif: { mimeType: 'image/gif', docxType: 'gif' },
  bmp: { mimeType: 'image/bmp', docxType: 'bmp' },
} as const;

type WordEmbeddedFormat = keyof typeof WORD_EMBEDS;
export type ReportWordImageMimeType = typeof WORD_EMBEDS[WordEmbeddedFormat]['mimeType'];
export type ReportWordDocxImageType = typeof WORD_EMBEDS[WordEmbeddedFormat]['docxType'];

const FORMAT_NAMES: Readonly<Record<ReportImageFormat, string>> = {
  jpeg: 'JPEG',
  png: 'PNG',
  gif: 'GIF',
  bmp: 'BMP',
  webp: 'WebP',
  heic: 'HEIC',
  tiff: 'TIFF',
  pdf: 'PDF',
  unknown: 'unrecognised',
};

const BMP_HEADER_SIZES = [12, 40, 52, 56, 64, 108, 124];

/** What the bytes are, read from their signature alone. */
export function detectReportImageSignature(bytes: Uint8Array): ReportImageFormat {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (bytes.length >= 6) {
    const signature = ascii(bytes, 0, 6);
    if (signature === 'GIF87a' || signature === 'GIF89a') return 'gif';
  }
  if (bytes.length >= 12
    && ascii(bytes, 0, 4) === 'RIFF'
    && ascii(bytes, 8, 4) === 'WEBP') {
    return 'webp';
  }
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === 'ftyp') {
    const brands = ascii(bytes, 8, Math.min(40, bytes.length - 8));
    if (/(heic|heix|hevc|hevx|heif|heim|heis|mif1|msf1)/.test(brands)) {
      return 'heic';
    }
  }
  if (startsWith(bytes, [0x49, 0x49, 0x2a, 0x00])
    || startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a])
    || startsWith(bytes, [0x49, 0x49, 0x2b, 0x00])
    || startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2b])) {
    return 'tiff';
  }
  if (bytes.length >= 5 && ascii(bytes, 0, 5) === '%PDF-') return 'pdf';
  // "BM" alone is two letters of text; the reserved zeros and a real header size make it a bitmap.
  if (bytes.length >= 18
    && ascii(bytes, 0, 2) === 'BM'
    && bytes[6] === 0 && bytes[7] === 0 && bytes[8] === 0 && bytes[9] === 0
    && bytes[15] === 0 && bytes[16] === 0 && bytes[17] === 0
    && BMP_HEADER_SIZES.includes(bytes[14])) {
    return 'bmp';
  }
  return 'unknown';
}

/** The label a picture carries when it goes into the document as it is, or null when it must be converted first. */
export function reportWordEmbedMimeType(format: ReportImageFormat): ReportWordImageMimeType | null {
  return isWordEmbedded(format) ? WORD_EMBEDS[format].mimeType : null;
}

/** The type the Word builder declares for these bytes, or null when it cannot embed them. */
export function reportWordDocxImageType(bytes: Uint8Array): ReportWordDocxImageType | null {
  const format = detectReportImageSignature(bytes);
  return isWordEmbedded(format) ? WORD_EMBEDS[format].docxType : null;
}

/**
 * The label for a picture this app has just converted, read from the result
 * itself. Throws unless the result really is a JPEG or a PNG.
 */
export function convertedReportImageMimeType(bytes: Uint8Array): 'image/jpeg' | 'image/png' {
  const format = detectReportImageSignature(bytes);
  if (format === 'jpeg') return 'image/jpeg';
  if (format === 'png') return 'image/png';
  throw new Error('The prepared image is not a JPEG or a PNG, so it was left out.');
}

/** Why a picture of this kind is missing from the report, in the same words on every device. */
export function reportImageNotPreparedMessage(format: ReportImageFormat): string {
  if (format === 'heic') return 'The iPhone photo could not be prepared for the Word report.';
  if (format === 'unknown' || format === 'pdf') {
    return 'This file is not a picture the Word report can use. It was left out.';
  }
  return `The ${FORMAT_NAMES[format]} image could not be prepared for the Word report.`;
}

/**
 * Why a picture drawing has no excerpt when the phone's image tool cannot
 * open a picture of an ordinary type (review pass 2 W1). Its first step
 * fails for a CMYK JPEG and for a 16-bit grey PNG, whatever is asked of it
 * next, so there is nothing to crop and no second way to try on the phone.
 * The whole sheet is not shown instead; the reason says what can be done.
 */
export function reportDrawingNotCroppedMessage(format: ReportImageFormat): string {
  if (!isWordEmbedded(format)) return reportImageNotPreparedMessage(format);
  return `The ${FORMAT_NAMES[format]} drawing could not be cropped on this device. ` +
    'If it was saved for print (CMYK) or as 16-bit grey, save it again as an ordinary colour picture.';
}

function isWordEmbedded(format: ReportImageFormat): format is WordEmbeddedFormat {
  return Object.prototype.hasOwnProperty.call(WORD_EMBEDS, format);
}

function startsWith(bytes: Uint8Array, signature: readonly number[]) {
  return bytes.length >= signature.length
    && signature.every((value, index) => bytes[index] === value);
}

function ascii(bytes: Uint8Array, offset: number, length: number) {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}
