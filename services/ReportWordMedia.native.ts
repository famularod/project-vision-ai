import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Image } from 'react-native';
import { renderPdfExcerpt } from '../modules/dave-text-recognition';
import type {
  ProjectUpdate,
  UpdatePhoto,
} from '../types';
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
    const mimeType = normalizedMimeType(
      document.mimeType,
      document.originalFileName || document.name,
    );
    try {
      const raster = mimeType.includes('pdf')
        ? await localPdfExcerpt(reference)
        : await localRaster(document.uri, mimeType);
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
    const raster = await localRaster(
      photo.uri,
      normalizedMimeType(photo.mimeType, photo.fileName || photo.uri),
    );
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

async function localRaster(uri: string, mimeType: string) {
  const normalizedUri = uri.trim();
  if (!normalizedUri) throw new Error('The local image path is missing.');
  const file = new File(normalizedUri);
  if (!file.exists) throw new Error('The local image file is missing.');
  if (isHeicImage(normalizedUri, mimeType)) {
    return convertHeicRaster(normalizedUri);
  }
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

async function convertHeicRaster(uri: string) {
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
      throw new Error('The converted iPhone photo is missing.');
    }
    return {
      data: await renderedFile.bytes(),
      mimeType: 'image/jpeg',
      width: rendered.width,
      height: rendered.height,
    };
  } catch (error) {
    throw new Error(
      `The iPhone photo could not be prepared for the Word report. ${errorMessage(error, 'Image conversion failed.')}`,
    );
  } finally {
    if (renderedFile?.exists) renderedFile.delete();
  }
}

async function localPdfExcerpt(reference: ReportDrawingReference) {
  const documentUri = reference.excerpt.document.uri.trim();
  if (!documentUri) throw new Error('The current drawing file path is missing.');
  const source = new File(documentUri);
  if (!source.exists) throw new Error('The current drawing PDF is missing on this device.');

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
    return {
      data: await renderedFile.bytes(),
      mimeType: 'image/jpeg',
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
  const mimeType = normalizedMimeType(
    document.mimeType,
    document.originalFileName || document.name,
  );
  if (!mimeType.includes('pdf')) {
    const file = new File(document.uri);
    if (!file.exists) throw new Error('The current drawing image is missing on this device.');
    return document.uri;
  }
  const source = new File(document.uri);
  if (!source.exists) throw new Error('The current drawing PDF is missing on this device.');
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

function normalizedMimeType(
  mimeType: string | null | undefined,
  fileName: string | null | undefined,
) {
  const normalized = (mimeType || '').trim().toLowerCase();
  if (normalized.includes('heic') || normalized.includes('heif')) return 'image/heic';
  if (normalized.includes('png')) return 'image/png';
  if (normalized.includes('gif')) return 'image/gif';
  if (normalized.includes('bmp')) return 'image/bmp';
  if (normalized.includes('pdf')) return 'application/pdf';
  const lowerName = (fileName || '').toLowerCase();
  if (lowerName.endsWith('.heic') || lowerName.endsWith('.heif')) return 'image/heic';
  if (lowerName.endsWith('.png')) return 'image/png';
  if (lowerName.endsWith('.gif')) return 'image/gif';
  if (lowerName.endsWith('.bmp')) return 'image/bmp';
  if (lowerName.endsWith('.pdf')) return 'application/pdf';
  return 'image/jpeg';
}

function isHeicImage(uri: string, mimeType: string) {
  const normalizedUri = uri.toLowerCase().split(/[?#]/, 1)[0];
  const normalizedMimeType = mimeType.toLowerCase();
  return normalizedMimeType.includes('heic') ||
    normalizedMimeType.includes('heif') ||
    normalizedUri.endsWith('.heic') ||
    normalizedUri.endsWith('.heif');
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim()
    ? error.message.trim()
    : fallback;
}
