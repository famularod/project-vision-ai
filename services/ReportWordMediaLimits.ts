import {
  REPORT_DRAWING_CROP_MAX_HEIGHT,
  REPORT_DRAWING_CROP_MAX_WIDTH,
} from './ReportDrawingCrop';

/**
 * How large a picture may be on its way into a Word report (independent
 * review F04, Build 229: the phone and iPad put every photo in at full size,
 * a 12-megapixel photo as 4032 x 3024 px and several megabytes, while the
 * desktop made each one 1600 x 1200 px at most).
 *
 * - A photo, and a drawing excerpt, is at most 1600 x 1200 px. That is the
 *   size the desktop report already makes them and the size a picture
 *   drawing's excerpt already had on the phone, so the two reports now
 *   carry the same pictures. Across the 6.5 in a page leaves, 1600 px is
 *   about 245 dots per inch, which prints sharp.
 * - A photo that is already within that size goes in as it is only when its
 *   file is 1.5 MB or less; a larger file (an uncompressed BMP, a PNG of a
 *   photo) is saved again as a JPEG. A 1600 x 1200 JPEG at the quality the
 *   report uses is usually 0.3 to 0.6 MB, so a report with 40 photos stays
 *   near 20 MB instead of well over 100 MB.
 * - A drawing kept as a picture is not opened for cropping above 160
 *   megapixels. Cropping needs the picture decoded, at about 4 bytes a
 *   pixel: 160 megapixels is about 640 MB. A 36 x 48 in sheet scanned at
 *   300 dots per inch is 155.5 megapixels and is still taken; the same
 *   sheet at 400 dpi (276 megapixels, about 1.1 GB decoded) is left out
 *   with the reason, rather than risk iOS closing the app mid-report.
 *
 * What a real iPhone and iPad can decode without being closed was not
 * measured; these are the limits to try on the devices.
 */
export const REPORT_PICTURE_MAX_WIDTH = REPORT_DRAWING_CROP_MAX_WIDTH;
export const REPORT_PICTURE_MAX_HEIGHT = REPORT_DRAWING_CROP_MAX_HEIGHT;
export const REPORT_PHOTO_AS_IS_MAX_BYTES = 1_500_000;
export const REPORT_DRAWING_SCAN_MAX_PIXELS = 160_000_000;

/** The size a picture goes into the report at: never larger than it is, never beyond 1600 x 1200. */
export function reportPictureFit(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, REPORT_PICTURE_MAX_WIDTH / width, REPORT_PICTURE_MAX_HEIGHT / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Whether a picture is already no larger than the report takes. */
export function reportPictureFits(width: number, height: number): boolean {
  return width <= REPORT_PICTURE_MAX_WIDTH && height <= REPORT_PICTURE_MAX_HEIGHT;
}

export function reportDrawingScanTooLarge(width: number, height: number): boolean {
  return width * height > REPORT_DRAWING_SCAN_MAX_PIXELS;
}

/** Why a very large scan has no excerpt, and what to do. */
export function reportDrawingScanTooLargeMessage(width: number, height: number): string {
  const size = `${width.toLocaleString('en-US')} x ${height.toLocaleString('en-US')} pixels`;
  return `This drawing picture is too large to crop on this device (${size}). ` +
    'Save it at a lower resolution and its excerpt will be included.';
}
