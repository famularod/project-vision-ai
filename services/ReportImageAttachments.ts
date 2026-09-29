/**
 * The photos a report cites as "See Image N", for the email and text paths.
 *
 * Code review, 27 Sep 2026: the report text said "See Image 3" but the email
 * and text carried no images at all. The numbering here is the report's own
 * (the work areas' imageReferences, the same numbers the Word report uses),
 * so attachment order matches the text. Anything that cannot be attached is
 * named in a note rather than silently missing.
 */
import type { PIEReportDraft } from './PIEReporter';

export type ReportCitedImage = Readonly<{ imageNumber: number; photoId: string }>;

export const REPORT_EMAIL_IMAGE_LIMIT = 20;
/**
 * Total bytes of original photos per message. Photos are stored at full
 * resolution, so 20 of them can exceed common mail limits (review pass 5).
 */
export const REPORT_MESSAGE_IMAGE_BYTES = 15 * 1024 * 1024;
/** Said when the composer refused the attachments and the text went alone. */
export const REPORT_IMAGES_NOT_ATTACHED =
  'The report images could not be attached on this device; they are in Vitruvius.';
export const REPORT_TEXT_IMAGE_LIMIT = 10;

/** Each cited image once, in image-number order. */
export function reportCitedImages(
  report: Pick<PIEReportDraft, 'locationGroups'>,
): ReportCitedImage[] {
  const byPhotoId = new Map<string, number>();
  for (const group of report.locationGroups) {
    for (const area of group.workAreas) {
      for (const reference of area.imageReferences) {
        const known = byPhotoId.get(reference.photoId);
        if (known === undefined || reference.imageNumber < known) {
          byPhotoId.set(reference.photoId, reference.imageNumber);
        }
      }
    }
  }
  return [...byPhotoId]
    .map(([photoId, imageNumber]) => ({ photoId, imageNumber }))
    .sort((left, right) => left.imageNumber - right.imageNumber);
}

export type ReportImageAttachments<TPhoto> = Readonly<{
  photos: TPhoto[];
  /** Empty when every cited image is attached; otherwise starts with a blank line. */
  note: string;
}>;

/**
 * Local photo files for the cited images, up to `limit`. `findPhoto` returns
 * the photo with a readable local uri, or null when its file is not on this
 * device (a cloud link cannot be attached).
 */
export async function resolveReportImageAttachments<TPhoto extends { uri: string }>(
  input: Readonly<{
    report: Pick<PIEReportDraft, 'locationGroups'>;
    limit: number;
    findPhoto: (photoId: string) => Promise<TPhoto | null>;
    /** File size in bytes, or null when unknown (counted as 0). */
    sizeOf?: (photo: TPhoto) => Promise<number | null>;
    maxTotalBytes?: number;
  }>,
): Promise<ReportImageAttachments<TPhoto>> {
  const cited = reportCitedImages(input.report);
  const photos: TPhoto[] = [];
  const missing: number[] = [];
  const overLimit: number[] = [];
  let totalBytes = 0;
  for (const image of cited) {
    if (photos.length >= input.limit) {
      overLimit.push(image.imageNumber);
      continue;
    }
    const photo = await input.findPhoto(image.photoId).catch(() => null);
    if (!photo || !/^file:/i.test(photo.uri.trim())) {
      missing.push(image.imageNumber);
      continue;
    }
    const size = input.sizeOf ? (await input.sizeOf(photo).catch(() => null)) ?? 0 : 0;
    if (input.maxTotalBytes !== undefined && totalBytes + size > input.maxTotalBytes) {
      overLimit.push(image.imageNumber);
      continue;
    }
    totalBytes += size;
    photos.push(photo);
  }
  const lines: string[] = [];
  if (missing.length > 0) {
    lines.push(missing.length === 1
      ? `Image ${missing[0]} could not be attached: its photo is not on this device.`
      : `Images ${numberList(missing)} could not be attached: their photos are not on this device.`);
  }
  if (overLimit.length > 0) {
    lines.push(overLimit.length === 1
      ? `Image ${overLimit[0]} is not attached, to keep this message a sendable size.`
      : `Images ${numberList(overLimit)} are not attached, to keep this message a sendable size.`);
  }
  return { photos, note: lines.length > 0 ? `\n\n${lines.join('\n')}` : '' };
}

/**
 * The JS error code Expo gives a Swift exception class: expo-modules-core
 * errorCodeFromString drops a trailing Error/Exception, puts "_" before every
 * capital that follows a character, and upper-cases, so SMSFileException is
 * ERR_S_MS_FILE, not ERR_SMS_FILE (review pass 5, 28 Sep 2026). A test checks
 * the Swift rule has not changed.
 */
export function expoErrorCode(swiftExceptionClass: string): string {
  const name = swiftExceptionClass.replace(/(Error|Exception)?(<.*>)?$/, '');
  // Non-overlapping, like NSRegularExpression: each match consumes both
  // characters, so "SMSFile" becomes "S_MS_File".
  return `ERR_${name.replace(/(.)([A-Z])/g, '$1_$2').toUpperCase()}`;
}

/**
 * Codes with which the iOS composers refuse, before opening, an attachment
 * they cannot read or add. A plain Swift error (Data(contentsOf:) on a missing
 * file) becomes ERR_UNEXPECTED, which these modules raise only while setting
 * up. Decided by code only: the message is localized and contains file paths
 * (review pass 4). A send failure after the composer opened (SendingFailed,
 * SMSSending) is not retried as text-only.
 */
const ATTACHMENT_READ_ERROR_CODES = new Set([
  ...[
    'FileSystemReadPermissionException', // expo-mail-composer
    'FileSystemNotFoundException',
    'SMSFileException', // expo-sms: iOS refused to add the attachment
    'SMSUriException',
    'SMSMimeTypeException',
  ].map(expoErrorCode),
  'ERR_UNEXPECTED',
]);

export function isAttachmentReadError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' && ATTACHMENT_READ_ERROR_CODES.has(code);
}

function numberList(numbers: readonly number[]): string {
  return numbers.length === 1
    ? String(numbers[0])
    : `${numbers.slice(0, -1).join(', ')} and ${numbers[numbers.length - 1]}`;
}
