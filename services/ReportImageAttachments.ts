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
  }>,
): Promise<ReportImageAttachments<TPhoto>> {
  const cited = reportCitedImages(input.report);
  const photos: TPhoto[] = [];
  const missing: number[] = [];
  const overLimit: number[] = [];
  for (const image of cited) {
    if (photos.length >= input.limit) {
      overLimit.push(image.imageNumber);
      continue;
    }
    const photo = await input.findPhoto(image.photoId).catch(() => null);
    if (photo && /^file:/i.test(photo.uri.trim())) {
      photos.push(photo);
    } else {
      missing.push(image.imageNumber);
    }
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
 * Whether a mail or SMS composer refused an attachment it could not read
 * (expo-mail-composer FileSystemReadPermission/FileSystemNotFound or a file
 * read error; expo-sms SMSFile/SMSUri/SMSMimeType). A send failure after the
 * composer opened is not one of these and must not be retried as text-only.
 */
export function isAttachmentReadError(error: unknown): boolean {
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
  const text = `${typeof code === 'string' ? code : ''} ${typeof message === 'string' ? message : ''}`;
  if (/SENDING|SEND_FAILED|UNAVAILABLE|IN_PROGRESS|PENDING|CANNOT_SEND/i.test(text)) return false;
  return /FILE|URI|MIME|ATTACH|couldn.t be opened|no such file|read permission/i.test(text);
}

function numberList(numbers: readonly number[]): string {
  return numbers.length === 1
    ? String(numbers[0])
    : `${numbers.slice(0, -1).join(', ')} and ${numbers[numbers.length - 1]}`;
}
