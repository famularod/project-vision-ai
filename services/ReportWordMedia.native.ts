import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Image } from 'react-native';
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

const NATIVE_PDF_DRAWING_UNAVAILABLE =
  'PDF drawing excerpts require the protected desktop renderer; native in-process PDF rendering is intentionally disabled.';
const NATIVE_MAX_RASTER_BYTES = 96 * 1024 * 1024;

/**
 * Resolves report media that can be embedded directly on iPhone and iPad.
 * Field photos and current drawing excerpts are embedded from app-owned
 * storage. PDF excerpts fail closed on native because in-process PDF parsing
 * cannot enforce a killable complexity boundary.
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
      document.uri,
    );
    try {
      if (mimeType.includes('pdf')) {
        throw new Error(NATIVE_PDF_DRAWING_UNAVAILABLE);
      }
      const raster = await localRaster(document.uri, mimeType);
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
      normalizedMimeType(photo.mimeType, photo.fileName || photo.uri, photo.uri),
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
  if (isNativePDFArtifact(mimeType, normalizedUri)) {
    throw new Error(NATIVE_PDF_DRAWING_UNAVAILABLE);
  }
  const file = new File(normalizedUri);
  if (!file.exists) throw new Error('The local image file is missing.');
  const data = await protectedNativeRasterBytes(file);
  if (isHeicImage(normalizedUri, mimeType)) {
    return convertHeicRaster(normalizedUri);
  }
  const dimensions = await imageDimensions(normalizedUri);
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

export async function renderNativeReportDrawingPreview(
  reference: ReportDrawingReference,
) {
  const document = reference.excerpt.document;
  const mimeType = normalizedMimeType(
    document.mimeType,
    document.originalFileName || document.name,
    document.uri,
  );
  if (mimeType.includes('pdf')) {
    throw new Error(NATIVE_PDF_DRAWING_UNAVAILABLE);
  }
  const file = new File(document.uri);
  if (!file.exists) throw new Error('The current drawing image is missing on this device.');
  await protectedNativeRasterBytes(file);
  return document.uri;
}

async function protectedNativeRasterBytes(file: File) {
  if (
    typeof file.size === 'number'
    && Number.isFinite(file.size)
    && file.size > NATIVE_MAX_RASTER_BYTES
  ) {
    throw new Error('The local image exceeds protected native preview resource limits.');
  }
  const data = await file.bytes();
  if (data.byteLength > NATIVE_MAX_RASTER_BYTES) {
    throw new Error('The local image exceeds protected native preview resource limits.');
  }
  if (containsPDFSignature(data)) {
    throw new Error(NATIVE_PDF_DRAWING_UNAVAILABLE);
  }
  return data;
}

function containsPDFSignature(data: Uint8Array) {
  const scanLength = Math.min(data.byteLength, 1_024);
  for (let offset = 0; offset + 5 <= scanLength; offset += 1) {
    if (
      data[offset] === 0x25
      && data[offset + 1] === 0x50
      && data[offset + 2] === 0x44
      && data[offset + 3] === 0x46
      && data[offset + 4] === 0x2d
    ) return true;
  }
  return false;
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
  uri?: string | null,
) {
  const normalized = (mimeType || '').trim().toLowerCase();
  if (isNativePDFArtifact(normalized, fileName || '', uri || '')) {
    return 'application/pdf';
  }
  if (normalized.includes('heic') || normalized.includes('heif')) return 'image/heic';
  if (normalized.includes('png')) return 'image/png';
  if (normalized.includes('gif')) return 'image/gif';
  if (normalized.includes('bmp')) return 'image/bmp';
  const lowerName = (fileName || '').toLowerCase();
  if (lowerName.endsWith('.heic') || lowerName.endsWith('.heif')) return 'image/heic';
  if (lowerName.endsWith('.png')) return 'image/png';
  if (lowerName.endsWith('.gif')) return 'image/gif';
  if (lowerName.endsWith('.bmp')) return 'image/bmp';
  return 'image/jpeg';
}

function isNativePDFArtifact(
  mimeType: string | null | undefined,
  ...locations: string[]
) {
  const normalizedMimeType = (mimeType || '').trim().toLowerCase();
  return normalizedMimeType.includes('pdf') || locations.some(value =>
    value.trim().toLowerCase().split(/[?#]/, 1)[0].endsWith('.pdf')
  );
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
