import type { ECOSDesktopProofBounds } from './ECOSDesktopProofNavigation';
import { readECOSBoundedResponseBytes } from './ECOSBoundedByteRead';
import {
  ECOS_MAX_WEB_IMAGE_BYTES,
  ECOS_WEB_IMAGE_PREFLIGHT_TIMEOUT_MILLISECONDS,
  preflightECOSWebImage,
} from './ECOSWebImageResourceLimits';
import {
  assertECOSPDFPageBudget,
  awaitECOSPDFLoadingTask,
  awaitECOSPDFRenderTask,
  awaitECOSPDFWorkerTask,
  boundedECOSPDFRenderPlan,
  ECOS_MAX_PDF_RENDER_PIXELS,
  ECOS_MAX_WEB_PDF_BYTES,
} from './ECOSPDFResourceLimits';

export type ECOSWebDocumentProofPreview = Readonly<{
  dataUrl: string;
  width: number;
  height: number;
}>;

export type ECOSProofPixelCrop = Readonly<{
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
}>;

export async function renderECOSWebDocumentProofPreview({
  url,
  mimeType,
  fileName,
  pageNumber,
  bounds,
  signal,
}: {
  url: string;
  mimeType?: string | null;
  fileName: string;
  pageNumber: number;
  bounds: ECOSDesktopProofBounds;
  signal?: AbortSignal;
}): Promise<ECOSWebDocumentProofPreview> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('The exact drawing preview is available in the desktop web version.');
  }
  throwIfProofAborted(signal);
  const normalizedMime = mimeType?.trim().toLowerCase() || '';
  const pdf = normalizedMime.includes('pdf') || fileName.toLowerCase().endsWith('.pdf');
  return pdf
    ? renderPdfRegion(url, pageNumber, bounds, signal)
    : renderImageRegion(url, pageNumber, bounds, normalizedMime, signal);
}

export function ecosProofPixelCrop(
  sourceWidth: number,
  sourceHeight: number,
  bounds: ECOSDesktopProofBounds,
  padding = 0.04,
): ECOSProofPixelCrop {
  if (!Number.isFinite(sourceWidth) || sourceWidth <= 0 || !Number.isFinite(sourceHeight) || sourceHeight <= 0) {
    throw new Error('The source drawing dimensions are invalid.');
  }
  const x = clamp(bounds.x - padding, 0, 1);
  const y = clamp(bounds.y - padding, 0, 1);
  const right = clamp(bounds.x + bounds.width + padding, 0, 1);
  const bottom = clamp(bounds.y + bounds.height + padding, 0, 1);
  const sourceX = Math.floor(x * sourceWidth);
  const sourceY = Math.floor(y * sourceHeight);
  return Object.freeze({
    sourceX,
    sourceY,
    sourceWidth: Math.max(1, Math.ceil(right * sourceWidth) - sourceX),
    sourceHeight: Math.max(1, Math.ceil(bottom * sourceHeight) - sourceY),
  });
}

async function renderPdfRegion(
  url: string,
  pageNumber: number,
  bounds: ECOSDesktopProofBounds,
  signal?: AbortSignal,
): Promise<ECOSWebDocumentProofPreview> {
  const bytes = await fetchArtifact(url, 'Drawing', signal);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  throwIfProofAborted(signal);
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    maxImageSize: ECOS_MAX_PDF_RENDER_PIXELS,
    canvasMaxAreaInBytes: ECOS_MAX_PDF_RENDER_PIXELS * 4,
  } as never);
  let pdf: any;
  const abortLoadingTask = () => {
    void loadingTask.destroy().catch(() => undefined);
  };
  signal?.addEventListener('abort', abortLoadingTask, { once: true });
  if (signal?.aborted) {
    signal.removeEventListener('abort', abortLoadingTask);
    await loadingTask.destroy().catch(() => undefined);
    throwIfProofAborted(signal);
  }
  try {
    pdf = await awaitECOSPDFLoadingTask(loadingTask as never);
  } catch (error) {
    signal?.removeEventListener('abort', abortLoadingTask);
    await loadingTask.destroy().catch(() => undefined);
    throw error;
  }
  try {
    assertECOSPDFPageBudget(pdf.numPages);
    if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > pdf.numPages) {
      throw new Error(`The cited page ${pageNumber} is not present in this drawing.`);
    }
    const page: any = await awaitECOSPDFWorkerTask<any>(
      pdf.getPage(pageNumber),
      () => loadingTask.destroy(),
    );
    const baseViewport = page.getViewport({ scale: 1 });
    const renderPlan = boundedECOSPDFRenderPlan({
      sourceWidth: baseViewport.width,
      sourceHeight: baseViewport.height,
      targetWidth: Math.min(2_400, baseViewport.width * 3),
      targetHeight: Math.min(4_096, baseViewport.height * 3),
    });
    const viewport = page.getViewport({ scale: renderPlan.scale });
    const canvas = document.createElement('canvas');
    canvas.width = renderPlan.width;
    canvas.height = renderPlan.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The drawing renderer is unavailable.');
    const renderTask = page.render({ canvas, canvasContext: context, viewport } as never);
    const abortRenderTask = () => renderTask.cancel();
    signal?.addEventListener('abort', abortRenderTask, { once: true });
    try {
      await awaitECOSPDFRenderTask(renderTask);
    } finally {
      signal?.removeEventListener('abort', abortRenderTask);
    }
    return cropCanvas(canvas, bounds);
  } finally {
    try {
      await pdf.cleanup();
    } finally {
      signal?.removeEventListener('abort', abortLoadingTask);
      await loadingTask.destroy();
    }
  }
}

async function renderImageRegion(
  url: string,
  pageNumber: number,
  bounds: ECOSDesktopProofBounds,
  declaredMimeType: string,
  signal?: AbortSignal,
): Promise<ECOSWebDocumentProofPreview> {
  if (pageNumber !== 1) {
    throw new Error(`The cited page ${pageNumber} is not present in this image document.`);
  }
  const operation = createImageProofDeadline(signal);
  try {
    const bytes = await fetchArtifact(
      url,
      'Image',
      operation.signal,
      ECOS_MAX_WEB_IMAGE_BYTES,
    );
    const metadata = await preflightECOSWebImage(new Uint8Array(bytes), {
      declaredMimeType,
      signal: operation.signal,
      deadlineMilliseconds: Math.min(
        operation.deadlineMilliseconds,
        Date.now() + ECOS_WEB_IMAGE_PREFLIGHT_TIMEOUT_MILLISECONDS,
      ),
    });
    if (
      metadata.decodedBytesPerPixel < 4
      || metadata.decodedByteLength !==
        metadata.sourcePixelCount * metadata.decodedBytesPerPixel
    ) {
      throw new Error('The protected image decoded-size receipt is invalid.');
    }
    // Only now may the browser decoder receive the bytes. The canonical MIME
    // comes from the parsed header, not attacker-controlled record metadata.
    const blob = new Blob([bytes], { type: metadata.mimeType });
    const image = await loadImage(blob, operation.signal);
    try {
      throwIfProofAborted(operation.signal);
      if (
        image.naturalWidth !== metadata.width
        || image.naturalHeight !== metadata.height
      ) {
        throw new Error('The decoded image dimensions do not match its protected header.');
      }
      const renderPlan = boundedECOSPDFRenderPlan({
        sourceWidth: metadata.width,
        sourceHeight: metadata.height,
        targetWidth: Math.min(4_096, metadata.width),
        targetHeight: Math.min(4_096, metadata.height),
      });
      const canvas = document.createElement('canvas');
      canvas.width = renderPlan.width;
      canvas.height = renderPlan.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('The drawing renderer is unavailable.');
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return cropCanvas(canvas, bounds);
    } finally {
      URL.revokeObjectURL(image.src);
    }
  } finally {
    operation.dispose();
  }
}

function createImageProofDeadline(
  parentSignal?: AbortSignal,
  timeoutMilliseconds = 60_000,
) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const deadlineMilliseconds = Date.now() + timeoutMilliseconds;
  const timer = setTimeout(abort, timeoutMilliseconds);
  if (parentSignal?.aborted) controller.abort();
  else parentSignal?.addEventListener('abort', abort, { once: true });
  return Object.freeze({
    signal: controller.signal,
    deadlineMilliseconds,
    dispose: () => {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', abort);
    },
  });
}

async function fetchArtifact(
  url: string,
  label: string,
  signal?: AbortSignal,
  maximumBytes = ECOS_MAX_WEB_PDF_BYTES,
): Promise<ArrayBuffer> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 60_000);
  try {
    if (signal?.aborted) controller.abort();
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`${label} download failed (${response.status}).`);
    return await readECOSBoundedResponseBytes(response, {
      maximumBytes,
      label,
      timeoutMilliseconds: 60_000,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

function cropCanvas(
  source: HTMLCanvasElement,
  bounds: ECOSDesktopProofBounds,
): ECOSWebDocumentProofPreview {
  const crop = ecosProofPixelCrop(source.width, source.height, bounds);
  const scale = Math.min(1, 1800 / crop.sourceWidth, 1200 / crop.sourceHeight);
  const output = document.createElement('canvas');
  output.width = Math.max(1, Math.round(crop.sourceWidth * scale));
  output.height = Math.max(1, Math.round(crop.sourceHeight * scale));
  const context = output.getContext('2d');
  if (!context) throw new Error('The drawing crop renderer is unavailable.');
  context.drawImage(
    source,
    crop.sourceX,
    crop.sourceY,
    crop.sourceWidth,
    crop.sourceHeight,
    0,
    0,
    output.width,
    output.height,
  );
  return Object.freeze({
    dataUrl: output.toDataURL('image/jpeg', 0.88),
    width: output.width,
    height: output.height,
  });
}

function loadImage(blob: Blob, signal?: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = document.createElement('img');
    let settled = false;
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const abort = () => {
      if (settled) return;
      settled = true;
      image.onload = null;
      image.onerror = null;
      URL.revokeObjectURL(image.src);
      image.src = '';
      cleanup();
      const error = new Error('The drawing image preview was cancelled.');
      error.name = 'AbortError';
      reject(error);
    };
    image.onload = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(image);
    };
    image.onerror = () => {
      if (settled) return;
      settled = true;
      cleanup();
      URL.revokeObjectURL(image.src);
      reject(new Error('The drawing image could not be decoded.'));
    };
    image.src = URL.createObjectURL(blob);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
  });
}

function throwIfProofAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  const error = new Error('The exact drawing proof preview was cancelled.');
  error.name = 'AbortError';
  throw error;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
