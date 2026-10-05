/**
 * The one crop rule for a cited drawing area in a Word report (independent
 * review R06). The phone and iPad report and the desktop report both call it,
 * so the same citation shows the same part of the sheet on each.
 *
 * - A region is measured from the top-left corner of the upright sheet (any
 *   camera rotation already applied), as fractions from 0 through 1.
 * - A margin is added on every side so the excerpt keeps the nearby drawing
 *   context, then the area is held inside the sheet: a region at an edge is
 *   cut at that edge.
 * - A region with a missing or non-numeric coordinate, no width or height, or
 *   no part on the sheet is invalid. It throws, and each report lists the
 *   drawing as unavailable instead of showing the whole sheet as an excerpt.
 *
 * The native PDF renderer (modules/dave-text-recognition, Swift) crops with
 * the same margin, edge rule and smallest size.
 */
export const REPORT_DRAWING_CROP_PADDING = 0.045;
export const REPORT_DRAWING_CROP_MIN_PIXELS = 2;
export const REPORT_DRAWING_CROP_MAX_WIDTH = 1600;
export const REPORT_DRAWING_CROP_MAX_HEIGHT = 1200;
export const REPORT_DRAWING_INVALID_REGION_MESSAGE =
  'The cited drawing area has invalid coordinates.';

export type ReportDrawingCropRegion = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export type ReportDrawingCropBounds = Readonly<{
  left: number;
  top: number;
  right: number;
  bottom: number;
}>;

export type ReportDrawingCrop = Readonly<{
  /** The part of the upright source picture to keep, in whole pixels. */
  originX: number;
  originY: number;
  width: number;
  height: number;
  /** The size the kept part is saved at for Word. */
  outputWidth: number;
  outputHeight: number;
}>;

/** The cited area with its margin, held inside the sheet, as fractions. */
export function reportDrawingCropBounds(
  region: ReportDrawingCropRegion | null | undefined,
): ReportDrawingCropBounds {
  const values = [region?.x, region?.y, region?.width, region?.height];
  if (!values.every(value => typeof value === 'number' && Number.isFinite(value))) {
    throw new Error(REPORT_DRAWING_INVALID_REGION_MESSAGE);
  }
  const { x, y, width, height } = region as ReportDrawingCropRegion;
  if (width <= 0 || height <= 0) {
    throw new Error(REPORT_DRAWING_INVALID_REGION_MESSAGE);
  }
  const left = clamp(x - REPORT_DRAWING_CROP_PADDING);
  const top = clamp(y - REPORT_DRAWING_CROP_PADDING);
  const right = clamp(x + width + REPORT_DRAWING_CROP_PADDING);
  const bottom = clamp(y + height + REPORT_DRAWING_CROP_PADDING);
  // A region wholly off the sheet has nothing left once it is held inside it.
  if (x >= 1 || y >= 1 || x + width <= 0 || y + height <= 0 || right <= left || bottom <= top) {
    throw new Error(REPORT_DRAWING_INVALID_REGION_MESSAGE);
  }
  return { left, top, right, bottom };
}

/**
 * The pixels to keep from an upright source picture of the given size, and
 * the size to save them at.
 */
export function planReportDrawingCrop(
  region: ReportDrawingCropRegion | null | undefined,
  source: Readonly<{ width: number; height: number }>,
): ReportDrawingCrop {
  const bounds = reportDrawingCropBounds(region);
  const sourceWidth = Math.floor(source.width);
  const sourceHeight = Math.floor(source.height);
  if (!(sourceWidth >= 1) || !(sourceHeight >= 1)) {
    throw new Error('The drawing image has no readable size.');
  }
  const originX = Math.min(sourceWidth - 1, Math.floor(bounds.left * sourceWidth));
  const originY = Math.min(sourceHeight - 1, Math.floor(bounds.top * sourceHeight));
  const width = Math.min(
    sourceWidth - originX,
    Math.ceil((bounds.right - bounds.left) * sourceWidth),
  );
  const height = Math.min(
    sourceHeight - originY,
    Math.ceil((bounds.bottom - bounds.top) * sourceHeight),
  );
  if (width < REPORT_DRAWING_CROP_MIN_PIXELS || height < REPORT_DRAWING_CROP_MIN_PIXELS) {
    throw new Error(REPORT_DRAWING_INVALID_REGION_MESSAGE);
  }
  const scale = Math.min(
    1,
    REPORT_DRAWING_CROP_MAX_WIDTH / width,
    REPORT_DRAWING_CROP_MAX_HEIGHT / height,
  );
  return {
    originX,
    originY,
    width,
    height,
    outputWidth: Math.max(1, Math.round(width * scale)),
    outputHeight: Math.max(1, Math.round(height * scale)),
  };
}

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}
