import type {
  ProjectUpdate,
  ReferenceDocument,
  ReferenceDocumentRegion,
  UpdatePhoto,
} from '../types';
import type {
  ReportWordMedia,
  ReportWordUnavailableMedia,
} from './ReportWordDocument';
import type { ReportDrawingReference } from './ReportDrawingReferences';

type ArtifactUrlResolver = (
  bucket: 'project-photos' | 'project-documents',
  path: string,
) => Promise<string>;

export type ReportImageFormat =
  | 'jpeg'
  | 'png'
  | 'gif'
  | 'webp'
  | 'heic'
  | 'unknown';

export type ResolvedReportWordMedia = Readonly<{
  media: readonly ReportWordMedia[];
  unavailableMedia: readonly ReportWordUnavailableMedia[];
}>;

export async function resolveWebReportWordMedia(args: {
  updates: readonly ProjectUpdate[];
  reportPhotoIds: readonly string[];
  drawingReferences: readonly ReportDrawingReference[];
  getArtifactUrl: ArtifactUrlResolver;
}): Promise<ResolvedReportWordMedia> {
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
    const resolved = await resolvePhoto(
      match.photo,
      match.update,
      displayNumber,
      args.getArtifactUrl,
    );
    if ('media' in resolved) media.push(resolved.media);
    else unavailableMedia.push(resolved.unavailable);
  }

  for (const reference of args.drawingReferences) {
    const resolved = await resolveDrawing(reference, args.getArtifactUrl);
    if ('media' in resolved) media.push(resolved.media);
    else unavailableMedia.push(resolved.unavailable);
  }

  return { media, unavailableMedia };
}

async function resolvePhoto(
  photo: UpdatePhoto,
  update: ProjectUpdate,
  displayNumber: number,
  getArtifactUrl: ArtifactUrlResolver,
): Promise<{ media: ReportWordMedia } | { unavailable: ReportWordUnavailableMedia }> {
  const path = photo.cloudStoragePath?.trim();
  const label = photo.caption?.trim() || `Project photo from ${photo.selectedAreaName || update.selectedAreaName || update.projectName}`;
  const numberedLabel = `Photo ${displayNumber} — ${label}`;
  if (!path) {
    return {
      unavailable: {
        id: photo.id,
        kind: 'photo',
        label: numberedLabel,
        reason: 'No protected cloud photo is attached to this report reference.',
      },
    };
  }
  try {
    const raster = await resolveProtectedImageWithRetry({
      bucket: 'project-photos',
      path,
      getArtifactUrl,
    });
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
        reason: errorMessage(error, 'The protected photo could not be read.'),
      },
    };
  }
}

async function resolveDrawing(
  reference: ReportDrawingReference,
  getArtifactUrl: ArtifactUrlResolver,
): Promise<{ media: ReportWordMedia } | { unavailable: ReportWordUnavailableMedia }> {
  const document = reference.excerpt.document;
  const label = `${reference.projectName} · ${reference.areaName} · ${reference.citation.label}`;
  const path = document.storagePath?.trim();
  if (!path) {
    return {
      unavailable: {
        id: reference.id,
        kind: 'drawing',
        label,
        reason: 'The current drawing record has no protected source file.',
      },
    };
  }
  try {
    const mimeType = normalizedDrawingMimeType(document);
    const raster = await resolveProtectedArtifactWithRetry({
      bucket: 'project-documents',
      path,
      getArtifactUrl,
      render: url => mimeType.includes('pdf')
        ? rasterizePdfExcerpt(url, reference.excerpt.pageNumber, reference.excerpt.region)
        : rasterizeImageUrl(url, reference.excerpt.region),
    });
    return {
      media: {
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
      },
    };
  } catch (error) {
    return {
      unavailable: {
        id: reference.id,
        kind: 'drawing',
        label,
        reason: errorMessage(error, 'The current drawing excerpt could not be rendered.'),
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

export async function resolveProtectedImageWithRetry(args: {
  bucket: 'project-photos' | 'project-documents';
  path: string;
  getArtifactUrl: ArtifactUrlResolver;
  region?: ReferenceDocumentRegion;
}) {
  return resolveProtectedArtifactWithRetry({
    bucket: args.bucket,
    path: args.path,
    getArtifactUrl: args.getArtifactUrl,
    render: url => rasterizeImageUrl(url, args.region),
  });
}

export async function resolveProtectedArtifactWithRetry<T>(args: {
  bucket: 'project-photos' | 'project-documents';
  path: string;
  getArtifactUrl: ArtifactUrlResolver;
  render: (url: string) => Promise<T>;
}): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const url = await args.getArtifactUrl(args.bucket, args.path);
      return await args.render(url);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('The protected project file could not be retrieved.');
}

async function rasterizePdfExcerpt(
  url: string,
  pageNumber: number,
  region: ReferenceDocumentRegion,
) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Drawing download failed (${response.status}).`);
  const bytes = await response.arrayBuffer();
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (typeof window !== 'undefined') {
    pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  }
  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
  }).promise;
  const safePageNumber = Math.max(1, Math.min(pageNumber, pdf.numPages));
  const page = await pdf.getPage(safePageNumber);
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = Math.max(1, Math.min(2.5, 1800 / Math.max(1, baseViewport.width)));
  const viewport = page.getViewport({ scale });
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = Math.ceil(viewport.width);
  sourceCanvas.height = Math.ceil(viewport.height);
  const context = sourceCanvas.getContext('2d');
  if (!context) throw new Error('Drawing renderer is unavailable.');
  await page.render({
    canvas: sourceCanvas,
    canvasContext: context,
    viewport,
  } as never).promise;
  return cropCanvas(sourceCanvas, region);
}

async function rasterizeImageUrl(
  url: string,
  region?: ReferenceDocumentRegion,
) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Image download failed (${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const declaredMimeType = response.headers.get('content-type');
  const format = detectReportImageFormat(bytes, declaredMimeType);
  const sourceBlob = new Blob(
    [bytes.slice().buffer],
    { type: mimeTypeForReportImageFormat(format, declaredMimeType) },
  );
  const blob = format === 'heic'
    ? await convertHeicForWordReport(sourceBlob)
    : sourceBlob;
  const image = await loadImage(blob);
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = image.naturalWidth;
  sourceCanvas.height = image.naturalHeight;
  const context = sourceCanvas.getContext('2d');
  if (!context) throw new Error('Image renderer is unavailable.');
  context.drawImage(image, 0, 0);
  URL.revokeObjectURL(image.src);
  return region
    ? cropCanvas(sourceCanvas, region)
    : resizeCanvas(sourceCanvas);
}

export function detectReportImageFormat(
  bytes: Uint8Array,
  declaredMimeType?: string | null,
): ReportImageFormat {
  if (bytes.length >= 3
    && bytes[0] === 0xff
    && bytes[1] === 0xd8
    && bytes[2] === 0xff) {
    return 'jpeg';
  }
  if (bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a) {
    return 'png';
  }
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

  const normalizedMimeType = (declaredMimeType || '').toLowerCase();
  if (normalizedMimeType.includes('heic') || normalizedMimeType.includes('heif')) {
    return 'heic';
  }
  if (normalizedMimeType.includes('jpeg') || normalizedMimeType.includes('jpg')) {
    return 'jpeg';
  }
  if (normalizedMimeType.includes('png')) return 'png';
  if (normalizedMimeType.includes('gif')) return 'gif';
  if (normalizedMimeType.includes('webp')) return 'webp';
  return 'unknown';
}

function ascii(bytes: Uint8Array, offset: number, length: number) {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

function mimeTypeForReportImageFormat(
  format: ReportImageFormat,
  declaredMimeType?: string | null,
) {
  if (format === 'jpeg') return 'image/jpeg';
  if (format === 'png') return 'image/png';
  if (format === 'gif') return 'image/gif';
  if (format === 'webp') return 'image/webp';
  if (format === 'heic') return 'image/heic';
  return declaredMimeType?.trim() || 'application/octet-stream';
}

async function convertHeicForWordReport(blob: Blob) {
  try {
    const { heicTo } = await import('heic-to');
    const converted = await heicTo({
      blob,
      type: 'image/jpeg',
      quality: 0.88,
    });
    if (!(converted instanceof Blob)) {
      throw new Error('The iPhone photo conversion returned no image.');
    }
    return converted;
  } catch (error) {
    const detail = errorMessage(error, 'The iPhone photo could not be converted.');
    throw new Error(`The iPhone photo could not be prepared for the Word report. ${detail}`);
  }
}

function cropCanvas(
  sourceCanvas: HTMLCanvasElement,
  region: ReferenceDocumentRegion,
) {
  const padding = 0.045;
  const x = clamp(region.x - padding, 0, 1);
  const y = clamp(region.y - padding, 0, 1);
  const right = clamp(region.x + region.width + padding, 0, 1);
  const bottom = clamp(region.y + region.height + padding, 0, 1);
  const sourceX = Math.floor(x * sourceCanvas.width);
  const sourceY = Math.floor(y * sourceCanvas.height);
  const sourceWidth = Math.max(1, Math.ceil((right - x) * sourceCanvas.width));
  const sourceHeight = Math.max(1, Math.ceil((bottom - y) * sourceCanvas.height));
  const scale = Math.min(1, 1600 / sourceWidth, 1200 / sourceHeight);
  const output = document.createElement('canvas');
  output.width = Math.max(1, Math.round(sourceWidth * scale));
  output.height = Math.max(1, Math.round(sourceHeight * scale));
  const outputContext = output.getContext('2d');
  if (!outputContext) throw new Error('Drawing crop renderer is unavailable.');
  outputContext.drawImage(
    sourceCanvas,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    output.width,
    output.height,
  );
  return canvasResult(output);
}

function resizeCanvas(sourceCanvas: HTMLCanvasElement) {
  const scale = Math.min(1, 1600 / sourceCanvas.width, 1200 / sourceCanvas.height);
  const output = document.createElement('canvas');
  output.width = Math.max(1, Math.round(sourceCanvas.width * scale));
  output.height = Math.max(1, Math.round(sourceCanvas.height * scale));
  const outputContext = output.getContext('2d');
  if (!outputContext) throw new Error('Image resize renderer is unavailable.');
  outputContext.drawImage(sourceCanvas, 0, 0, output.width, output.height);
  return canvasResult(output);
}

async function canvasResult(canvas: HTMLCanvasElement) {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      value => value ? resolve(value) : reject(new Error('Image encoding failed.')),
      'image/jpeg',
      0.84,
    );
  });
  return {
    data: new Uint8Array(await blob.arrayBuffer()),
    mimeType: 'image/jpeg',
    width: canvas.width,
    height: canvas.height,
  };
}

function loadImage(blob: Blob) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = document.createElement('img');
    image.onload = () => resolve(image);
    image.onerror = () => {
      URL.revokeObjectURL(image.src);
      reject(new Error('The image format could not be decoded.'));
    };
    image.src = URL.createObjectURL(blob);
  });
}

function normalizedDrawingMimeType(documentRecord: ReferenceDocument) {
  const declared = documentRecord.mimeType?.toLowerCase().trim();
  if (declared) return declared;
  return documentRecord.originalFileName.toLowerCase().endsWith('.pdf')
    ? 'application/pdf'
    : 'image/jpeg';
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === 'string' && error.trim()) return error.trim();
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string' &&
    error.message.trim()
  ) {
    return error.message.trim();
  }
  return fallback;
}
