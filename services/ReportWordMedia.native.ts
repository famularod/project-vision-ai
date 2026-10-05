import { File } from 'expo-file-system';
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
  reportImageNotPreparedMessage,
  reportWordEmbedMimeType,
  type ReportImageFormat,
} from './ReportWordImageFormat';
import type {
  ReportWordMedia,
  ReportWordUnavailableMedia,
} from './ReportWordDocument';
import type { ReportDrawingReference } from './ReportDrawingReferences';

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

async function localRaster(uri: string) {
  const normalizedUri = uri.trim();
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
 */
async function renderDrawingImageExcerpt(
  uri: string,
  region: ReferenceDocumentRegion,
) {
  const context = ImageManipulator.manipulate(uri);
  const upright = await context.renderAsync().catch(() => {
    throw new Error(reportImageNotPreparedMessage(localFileFormat(uri)));
  });
  const crop = planReportDrawingCrop(region, upright);
  context.crop({
    originX: crop.originX,
    originY: crop.originY,
    width: crop.width,
    height: crop.height,
  });
  if (crop.outputWidth !== crop.width || crop.outputHeight !== crop.height) {
    context.resize({ width: crop.outputWidth, height: crop.outputHeight });
  }
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

export async function renderNativeReportDrawingPreview(
  reference: ReportDrawingReference,
) {
  const document = reference.excerpt.document;
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
