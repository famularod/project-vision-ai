import type {
  ProjectUpdate,
  ReferenceDocument,
  ReferenceDocumentRegion,
  UpdatePhoto,
} from '../types';
import { planReportDrawingCrop, reportDrawingCropBounds } from './ReportDrawingCrop';
import {
  convertedReportImageMimeType,
  detectReportImageSignature,
  reportImageNotPreparedMessage,
  type ReportImageFormat,
} from './ReportWordImageFormat';
import type {
  ReportWordMedia,
  ReportWordUnavailableMedia,
} from './ReportWordDocument';
import type { ReportDrawingReference } from './ReportDrawingReferences';

type ArtifactUrlResolver = (
  bucket: 'project-photos' | 'project-documents',
  path: string,
) => Promise<string>;

export type { ReportImageFormat } from './ReportWordImageFormat';

export type ResolvedReportWordMedia = Readonly<{
  media: readonly ReportWordMedia[];
  unavailableMedia: readonly ReportWordUnavailableMedia[];
}>;

/** pdf.js, loaded only when a drawing turns out to be a PDF. */
type PdfJsLoader = () => Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')>;

const loadBundledPdfJs: PdfJsLoader = () => import('pdfjs-dist/legacy/build/pdf.mjs');

export async function resolveWebReportWordMedia(args: {
  updates: readonly ProjectUpdate[];
  reportPhotoIds: readonly string[];
  drawingReferences: readonly ReportDrawingReference[];
  getArtifactUrl: ArtifactUrlResolver;
  /** The bundled pdf.js unless a test supplies a stand-in (jest cannot run its import). */
  loadPdfJs?: PdfJsLoader;
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
    const resolved = await resolveDrawing(reference, args.getArtifactUrl, args.loadPdfJs ?? loadBundledPdfJs);
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
  loadPdfJs: PdfJsLoader,
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
    // Judged by the shared rule before anything is fetched. With no region
    // at all the whole sheet was embedded as the excerpt (review pass 2 W3).
    reportDrawingCropBounds(reference.excerpt.region);
    const raster = await resolveProtectedArtifactWithRetry({
      bucket: 'project-documents',
      path,
      getArtifactUrl,
      render: url => rasterizeDrawingUrl(url, document, reference.excerpt.pageNumber, reference.excerpt.region, loadPdfJs),
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

/**
 * Whether a drawing file is a PDF or a picture is read from its first bytes,
 * as on the phone (Build 231 E1 item 5: its stored type decided, so a PDF
 * stored as a picture, or a picture stored as a PDF, was listed as left
 * out). Its stored type and name are asked only when its bytes are none this
 * app recognises.
 */
async function rasterizeDrawingUrl(
  url: string,
  documentRecord: ReferenceDocument,
  pageNumber: number,
  region: ReferenceDocumentRegion,
  loadPdfJs: PdfJsLoader,
) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Drawing download failed (${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const format = detectReportImageSignature(bytes);
  const isPdf = format === 'unknown' ? drawingIsStoredAsPdf(documentRecord) : format === 'pdf';
  return isPdf
    ? rasterizePdfExcerpt(bytes, pageNumber, region, loadPdfJs)
    : rasterizeImageBytes(bytes, response.headers.get('content-type'), region);
}

async function rasterizePdfExcerpt(
  bytes: Uint8Array,
  pageNumber: number,
  region: ReferenceDocumentRegion,
  loadPdfJs: PdfJsLoader,
) {
  const pdfjs = await loadPdfJs();
  if (typeof window !== 'undefined') {
    pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  }
  const pdf = await pdfjs.getDocument({
    data: bytes,
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
  return rasterizeImageBytes(bytes, response.headers.get('content-type'), region);
}

async function rasterizeImageBytes(
  bytes: Uint8Array,
  declaredMimeType: string | null,
  region?: ReferenceDocumentRegion,
) {
  const format = detectReportImageFormat(bytes, declaredMimeType);
  const sourceBlob = new Blob(
    [bytes.slice().buffer],
    { type: mimeTypeForReportImageFormat(format, declaredMimeType) },
  );
  const blob = format === 'heic'
    ? await convertHeicForWordReport(sourceBlob)
    : sourceBlob;
  // A picture this browser cannot open is listed as unavailable in the same
  // words the phone uses (independent review R07).
  const image = await loadImage(blob).catch(() => {
    throw new Error(reportImageNotPreparedMessage(detectReportImageSignature(bytes)));
  });
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

/**
 * What a downloaded picture is. Its own bytes decide; the type the cloud
 * declared is only a hint for how to try opening bytes nothing recognises.
 * Whatever is embedded is drawn again here and labelled from the result.
 */
export function detectReportImageFormat(
  bytes: Uint8Array,
  declaredMimeType?: string | null,
): ReportImageFormat {
  const format = detectReportImageSignature(bytes);
  if (format !== 'unknown') return format;

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

function mimeTypeForReportImageFormat(
  format: ReportImageFormat,
  declaredMimeType?: string | null,
) {
  if (format === 'jpeg') return 'image/jpeg';
  if (format === 'png') return 'image/png';
  if (format === 'gif') return 'image/gif';
  if (format === 'bmp') return 'image/bmp';
  if (format === 'webp') return 'image/webp';
  if (format === 'heic') return 'image/heic';
  if (format === 'tiff') return 'image/tiff';
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
  // The phone and iPad report crops by the same rule (independent review R06).
  const crop = planReportDrawingCrop(region, sourceCanvas);
  const output = document.createElement('canvas');
  output.width = crop.outputWidth;
  output.height = crop.outputHeight;
  const outputContext = output.getContext('2d');
  if (!outputContext) throw new Error('Drawing crop renderer is unavailable.');
  fillWhite(outputContext, output);
  outputContext.drawImage(
    sourceCanvas,
    crop.originX,
    crop.originY,
    crop.width,
    crop.height,
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
  fillWhite(outputContext, output);
  outputContext.drawImage(sourceCanvas, 0, 0, output.width, output.height);
  return canvasResult(output);
}

/**
 * A JPEG has no transparency, and a canvas saved as one puts its transparent
 * areas on black. The phone's image tool puts them on white. So a picture
 * with a transparent background is drawn on white here too, and the two
 * reports show the same thing (review pass 4 L5).
 */
function fillWhite(context: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
  context.fillStyle = '#FFFFFF';
  context.fillRect(0, 0, canvas.width, canvas.height);
}

async function canvasResult(canvas: HTMLCanvasElement) {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      value => value ? resolve(value) : reject(new Error('Image encoding failed.')),
      'image/jpeg',
      0.84,
    );
  });
  // The label is read from what the browser wrote, not assumed (independent review R07).
  const data = new Uint8Array(await blob.arrayBuffer());
  return {
    data,
    mimeType: convertedReportImageMimeType(data),
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

/** What the record says, for a file whose bytes are none this app recognises; the phone asks the same two things. */
function drawingIsStoredAsPdf(documentRecord: ReferenceDocument) {
  return (documentRecord.mimeType || '').toLowerCase().includes('pdf') ||
    (documentRecord.originalFileName || documentRecord.name || '').toLowerCase().endsWith('.pdf');
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
