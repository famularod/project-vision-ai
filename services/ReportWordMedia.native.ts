import { fromByteArray } from 'base64-js';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Image } from 'react-native';
import { renderPdfExcerpt } from '../modules/dave-text-recognition';
import type {
  ProjectUpdate,
  ReferenceDocument,
  ReferenceDocumentRegion,
  UpdatePhoto,
} from '../types';
import {
  planReportDrawingCrop,
  reportDrawingCropBounds,
} from './ReportDrawingCrop';
import {
  convertedReportImageMimeType,
  detectReportImageSignature,
  REPORT_IMAGE_SIGNATURE_BYTES,
  reportDrawingNotCroppedMessage,
  reportImageNotPreparedMessage,
  reportWordEmbedMimeType,
  type ReportImageFormat,
} from './ReportWordImageFormat';
import type {
  ReportWordMedia,
  ReportWordUnavailableMedia,
} from './ReportWordDocument';
import type { ReportDrawingReference } from './ReportDrawingReferences';

/**
 * A drawing record with no file path at all (review pass 2 W4: it was listed
 * with the reason "Cannot read properties of undefined (reading 'trim')").
 */
const DRAWING_HAS_NO_FILE = 'This drawing has no file on this device, so its excerpt was left out.';

export type ResolvedNativeReportWordMedia = Readonly<{
  media: readonly ReportWordMedia[];
  unavailableMedia: readonly ReportWordUnavailableMedia[];
}>;

/**
 * Resolves report media that can be embedded directly on iPhone and iPad.
 * Field photos and current drawing excerpts are embedded from app-owned
 * storage. PDF excerpts are rendered locally with Apple PDFKit so the source
 * bytes never leave the device.
 */
export async function resolveNativeReportWordMedia(args: {
  updates: readonly ProjectUpdate[];
  reportPhotoIds: readonly string[];
  drawingReferences: readonly ReportDrawingReference[];
}): Promise<ResolvedNativeReportWordMedia> {
  const media: ReportWordMedia[] = [];
  const unavailableMedia: ReportWordUnavailableMedia[] = [];
  const photosById = new Map(
    args.updates.flatMap(update =>
      update.photos.map(photo => [photo.id, { photo, update }] as const)),
  );

  for (const [index, photoId] of args.reportPhotoIds.entries()) {
    const displayNumber = index + 1;
    const match = photosById.get(photoId);
    if (!match) {
      unavailableMedia.push({
        id: photoId,
        kind: 'photo',
        label: `Photo ${displayNumber}`,
        reason: 'The referenced photo is not present in the current authorized project record.',
      });
      continue;
    }
    const resolved = await resolvePhoto(match.photo, match.update, displayNumber);
    if ('media' in resolved) media.push(resolved.media);
    else unavailableMedia.push(resolved.unavailable);
  }

  for (const reference of args.drawingReferences) {
    const document = reference.excerpt.document;
    const label = `${reference.projectName} · ${reference.areaName} · ${reference.citation.label}`;
    try {
      if (!document.uri?.trim()) throw new Error(DRAWING_HAS_NO_FILE);
      const raster = drawingIsPdf(document)
        ? await localPdfExcerpt(reference)
        : await localDrawingImageExcerpt(document.uri, reference.excerpt.region);
      media.push({
        id: reference.id,
        kind: 'drawing',
        caption: `${reference.projectName} — ${reference.areaName}`,
        data: raster.data,
        mimeType: raster.mimeType,
        width: raster.width,
        height: raster.height,
        projectName: reference.projectName,
        areaName: reference.areaName,
        reasonForInclusion:
          `This excerpt comes from the current drawing reference mapped to ${reference.areaName} ` +
          'and is included so the reader can verify the reported work location.',
        citation: reference.citation.label,
      });
    } catch (error) {
      unavailableMedia.push({
        id: reference.id,
        kind: 'drawing',
        label,
        reason: errorMessage(error, 'The current drawing image is not available on this device.'),
      });
    }
  }

  return { media, unavailableMedia };
}

async function resolvePhoto(
  photo: UpdatePhoto,
  update: ProjectUpdate,
  displayNumber: number,
): Promise<{ media: ReportWordMedia } | { unavailable: ReportWordUnavailableMedia }> {
  const label = photo.caption?.trim()
    || `Project photo from ${photo.selectedAreaName || update.selectedAreaName || update.projectName}`;
  const numberedLabel = `Photo ${displayNumber} — ${label}`;
  try {
    const raster = await localRaster(photo.uri);
    return {
      media: {
        id: photo.id,
        kind: 'photo',
        displayNumber,
        caption: label,
        data: raster.data,
        mimeType: raster.mimeType,
        width: raster.width,
        height: raster.height,
        projectName: update.projectName,
        areaName: photo.selectedAreaName || update.selectedAreaName,
        linkedTaskName: update.scheduleTaskName,
        recordedAt: update.date,
        reasonForInclusion: photoReasonForInclusion(update, photo),
      },
    };
  } catch (error) {
    return {
      unavailable: {
        id: photo.id,
        kind: 'photo',
        label: numberedLabel,
        reason: errorMessage(error, 'The referenced photo is not available on this device.'),
      },
    };
  }
}

function photoReasonForInclusion(
  update: ProjectUpdate,
  photo: UpdatePhoto,
): string {
  const area = photo.selectedAreaName?.trim() || update.selectedAreaName?.trim();
  const task = update.scheduleTaskName?.trim();
  if (task) {
    return `This photo is attached to the field update for ${task}` +
      `${area ? ` in ${area}` : ''} and supports the recorded project condition.`;
  }
  return `This photo is attached to a field update for ${area || update.projectName} ` +
    'and supports the recorded project condition.';
}

/**
 * What a local file is, from its own first bytes (independent review R07: a
 * WebP or HEIC was embedded as it was under the label image/jpeg, because the
 * label came from the file name and stored type). A file that is missing
 * reads as unknown.
 */
function localFileFormat(uri: string): ReportImageFormat {
  const file = new File(uri.trim());
  if (!uri.trim() || !file.exists) return 'unknown';
  const handle = file.open();
  try {
    return detectReportImageSignature(handle.readBytes(REPORT_IMAGE_SIGNATURE_BYTES));
  } finally {
    handle.close();
  }
}

/**
 * Whether a drawing file is a PDF. Its stored type and name are asked only
 * when its bytes are none this app recognises.
 */
function drawingIsPdf(document: ReferenceDocument) {
  const format = localFileFormat(document.uri);
  if (format !== 'unknown') return format === 'pdf';
  return (document.mimeType || '').toLowerCase().includes('pdf') ||
    (document.originalFileName || document.name || '').toLowerCase().endsWith('.pdf');
}

async function localRaster(uri: string | null | undefined) {
  const normalizedUri = (uri || '').trim();
  if (!normalizedUri) throw new Error('The local image path is missing.');
  const file = new File(normalizedUri);
  if (!file.exists) throw new Error('The local image file is missing.');
  const format = localFileFormat(normalizedUri);
  const mimeType = reportWordEmbedMimeType(format);
  if (!mimeType) return convertedRaster(normalizedUri, format);
  const [data, dimensions] = await Promise.all([
    file.bytes(),
    imageDimensions(normalizedUri),
  ]);
  return {
    data,
    mimeType,
    width: dimensions.width,
    height: dimensions.height,
  };
}

/**
 * Converts a picture Word cannot take as it is (HEIC, WebP, TIFF and the
 * rest) to JPEG, and labels the result by reading it back.
 */
async function convertedRaster(uri: string, format: ReportImageFormat) {
  let renderedFile: File | null = null;
  try {
    const context = ImageManipulator.manipulate(uri);
    const imageRef = await context.renderAsync();
    const rendered = await imageRef.saveAsync({
      compress: 0.88,
      format: SaveFormat.JPEG,
    });
    renderedFile = new File(rendered.uri);
    if (!renderedFile.exists) {
      throw new Error('The converted image is missing.');
    }
    const data = await renderedFile.bytes();
    return {
      data,
      mimeType: convertedReportImageMimeType(data),
      width: rendered.width,
      height: rendered.height,
    };
  } catch (error) {
    throw new Error(format === 'heic'
      ? `${reportImageNotPreparedMessage(format)} ${errorMessage(error, 'Image conversion failed.')}`
      : reportImageNotPreparedMessage(format));
  } finally {
    if (renderedFile?.exists) renderedFile.delete();
  }
}

/**
 * Crops a drawing kept as a picture to its cited area. The manipulator turns
 * the picture upright as it loads it, so the size read here is the size the
 * area was measured on (independent review R06: the whole sheet was embedded
 * and described as an excerpt).
 *
 * The excerpt is always redrawn at its own size before it is saved (Build
 * 231 E1 item 4). The image tool Build 231 has (expo-image-manipulator
 * 57.0.21) opens a picture saved for print (CMYK) or as 16-bit grey, which
 * 57.0.20 could not, and a crop keeps the picture's form: a CMYK crop saved
 * as it was is a CMYK JPEG, which Word does not show reliably. The redraw
 * makes it an ordinary 8-bit colour picture. When the tool cannot open the
 * picture at all, it is left out and the reason says why.
 */
async function renderDrawingImageExcerpt(
  uri: string,
  region: ReferenceDocumentRegion,
) {
  const context = ImageManipulator.manipulate(uri);
  const upright = await context.renderAsync().catch(() => {
    throw new Error(reportDrawingNotCroppedMessage(localFileFormat(uri)));
  });
  const crop = planReportDrawingCrop(region, upright);
  context.crop({
    originX: crop.originX,
    originY: crop.originY,
    width: crop.width,
    height: crop.height,
  });
  context.resize({ width: crop.outputWidth, height: crop.outputHeight });
  const excerpt = await context.renderAsync();
  return excerpt.saveAsync({ compress: 0.88, format: SaveFormat.JPEG });
}

async function localDrawingImageExcerpt(
  uri: string,
  region: ReferenceDocumentRegion,
) {
  const normalizedUri = uri.trim();
  if (!normalizedUri) throw new Error('The local image path is missing.');
  if (!new File(normalizedUri).exists) throw new Error('The local image file is missing.');
  const rendered = await renderDrawingImageExcerpt(normalizedUri, region);
  const renderedFile = new File(rendered.uri);
  try {
    if (!renderedFile.exists) {
      throw new Error('The cited drawing excerpt could not be prepared.');
    }
    const data = await renderedFile.bytes();
    return {
      data,
      mimeType: convertedReportImageMimeType(data),
      width: rendered.width,
      height: rendered.height,
    };
  } finally {
    if (renderedFile.exists) renderedFile.delete();
  }
}

async function localPdfExcerpt(reference: ReportDrawingReference) {
  const documentUri = reference.excerpt.document.uri.trim();
  if (!documentUri) throw new Error('The current drawing file path is missing.');
  const source = new File(documentUri);
  if (!source.exists) throw new Error('The current drawing PDF is missing on this device.');
  // One rule decides whether the cited area is usable, for a PDF as for a picture.
  reportDrawingCropBounds(reference.excerpt.region);

  const rendered = await renderPdfExcerpt(
    documentUri,
    reference.excerpt.pageNumber,
    reference.excerpt.region,
  );
  const renderedFile = new File(rendered.uri);
  try {
    if (!renderedFile.exists) {
      throw new Error('The cited drawing excerpt could not be prepared.');
    }
    const data = await renderedFile.bytes();
    return {
      data,
      mimeType: convertedReportImageMimeType(data),
      width: rendered.width,
      height: rendered.height,
    };
  } finally {
    if (renderedFile.exists) renderedFile.delete();
  }
}

/**
 * The on-screen preview kept for each drawing reference (review pass 2 W2:
 * every showing of a preview wrote a new JPEG to the cache and nothing ever
 * removed one). There is one file per reference. It is made once, reused
 * while the drawing file and the cited area are unchanged, and removed when
 * a new one replaces it. The Reports screen lets go of a picture before it
 * asks for another, so a file still on screen is never removed. Files left
 * by an earlier run of the app are cleared the first time one is made.
 */
const DRAWING_PREVIEW_FOLDER = 'report-drawing-previews';
const drawingPreviews = new Map<string, Readonly<{ madeFrom: string; uri: string }>>();
const drawingPreviewsBeingMade = new Map<string, Readonly<{ madeFrom: string; uri: Promise<string> }>>();
let earlierDrawingPreviewsCleared = false;
let drawingPreviewsMade = 0;

export async function renderNativeReportDrawingPreview(
  reference: ReportDrawingReference,
) {
  const madeFrom = drawingPreviewSource(reference);
  const kept = drawingPreviews.get(reference.id);
  if (kept?.madeFrom === madeFrom && (!isKeptFile(kept.uri) || new File(kept.uri).exists)) return kept.uri;
  // Asked for twice at once: one picture is made, and both get it.
  const beingMade = drawingPreviewsBeingMade.get(reference.id);
  if (beingMade?.madeFrom === madeFrom) return beingMade.uri;
  const uri = makeDrawingPreview(reference, madeFrom);
  drawingPreviewsBeingMade.set(reference.id, { madeFrom, uri });
  try {
    return await uri;
  } finally {
    if (drawingPreviewsBeingMade.get(reference.id)?.uri === uri) {
      drawingPreviewsBeingMade.delete(reference.id);
    }
  }
}

/** What a preview was made from: the drawing file as it is now, the page and the cited area. */
function drawingPreviewSource(reference: ReportDrawingReference) {
  const { document, pageNumber, region } = reference.excerpt;
  const file = document.uri ? new File(document.uri) : null;
  return JSON.stringify([
    document.uri,
    file?.exists ? [file.size, file.modificationTime] : null,
    pageNumber,
    region?.x,
    region?.y,
    region?.width,
    region?.height,
  ]);
}

async function makeDrawingPreview(reference: ReportDrawingReference, madeFrom: string) {
  const uri = await keepDrawingPreview(await renderDrawingPreviewFile(reference));
  const replaced = drawingPreviews.get(reference.id);
  drawingPreviews.set(reference.id, { madeFrom, uri });
  if (replaced && replaced.uri !== uri && isKeptFile(replaced.uri)) {
    const earlier = new File(replaced.uri);
    if (earlier.exists) earlier.delete();
  }
  return uri;
}

/** Whether a preview is a file in the preview folder, not a picture handed to the screen as data. */
function isKeptFile(uri: string) {
  return !uri.startsWith('data:');
}

/**
 * Moves a new preview out of the image tool's cache into the app's own
 * preview folder. If that cannot be done, the screen is given the picture
 * itself and no file is kept: left where it was made, it would be a file no
 * later run of the app knows to clear (review pass 3 W2r).
 */
async function keepDrawingPreview(madeUri: string) {
  const made = new File(madeUri);
  try {
    const folder = new Directory(Paths.cache, DRAWING_PREVIEW_FOLDER);
    folder.create({ intermediates: true, idempotent: true });
    if (!earlierDrawingPreviewsCleared) {
      // Nothing made in this run of the app is in the folder yet, so nothing in it is on screen.
      earlierDrawingPreviewsCleared = true;
      for (const entry of folder.list()) {
        if (entry instanceof File) entry.delete();
      }
    }
    drawingPreviewsMade += 1;
    const kept = new File(folder, `preview-${Date.now()}-${drawingPreviewsMade}.jpg`);
    await made.move(kept);
    return kept.uri;
  } catch {
    try {
      const picture = await made.bytes();
      return `data:${convertedReportImageMimeType(picture)};base64,${fromByteArray(picture)}`;
    } finally {
      if (made.exists) made.delete();
    }
  }
}

async function renderDrawingPreviewFile(reference: ReportDrawingReference) {
  const document = reference.excerpt.document;
  if (!document.uri?.trim()) throw new Error(DRAWING_HAS_NO_FILE);
  if (!drawingIsPdf(document)) {
    const file = new File(document.uri);
    if (!file.exists) throw new Error('The current drawing image is missing on this device.');
    return (await renderDrawingImageExcerpt(document.uri, reference.excerpt.region)).uri;
  }
  const source = new File(document.uri);
  if (!source.exists) throw new Error('The current drawing PDF is missing on this device.');
  reportDrawingCropBounds(reference.excerpt.region);
  const rendered = await renderPdfExcerpt(
    document.uri,
    reference.excerpt.pageNumber,
    reference.excerpt.region,
  );
  return rendered.uri;
}

function imageDimensions(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    Image.getSize(
      uri,
      (width, height) => resolve({ width, height }),
      error => reject(error),
    );
  });
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim()
    ? error.message.trim()
    : fallback;
}
