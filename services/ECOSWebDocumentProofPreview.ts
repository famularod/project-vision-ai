import type { ECOSDesktopProofBounds } from './ECOSDesktopProofNavigation';

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
}: {
  url: string;
  mimeType?: string | null;
  fileName: string;
  pageNumber: number;
  bounds: ECOSDesktopProofBounds;
}): Promise<ECOSWebDocumentProofPreview> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('The exact drawing preview is available in the desktop web version.');
  }
  const normalizedMime = mimeType?.trim().toLowerCase() || '';
  const pdf = normalizedMime.includes('pdf') || fileName.toLowerCase().endsWith('.pdf');
  return pdf
    ? renderPdfRegion(url, pageNumber, bounds)
    : renderImageRegion(url, pageNumber, bounds);
}

export async function renderECOSWebProtectedPageProofPreview({
  dataUrl,
  bounds,
}: {
  dataUrl: string;
  bounds: ECOSDesktopProofBounds;
}): Promise<ECOSWebDocumentProofPreview> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('The exact drawing preview is available in the desktop web version.');
  }
  if (!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(dataUrl)) {
    throw new Error('The protected drawing image is invalid.');
  }
  const image = await loadImageUrl(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The drawing renderer is unavailable.');
  context.drawImage(image, 0, 0);
  return cropCanvas(canvas, bounds);
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
): Promise<ECOSWebDocumentProofPreview> {
  const bytes = await fetchArtifact(url, 'Drawing');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
  if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > pdf.numPages) {
    throw new Error(`The cited page ${pageNumber} is not present in this drawing.`);
  }
  const page = await pdf.getPage(pageNumber);
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = Math.max(1, Math.min(3, 2400 / Math.max(1, baseViewport.width)));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The drawing renderer is unavailable.');
  await page.render({ canvas, canvasContext: context, viewport } as never).promise;
  return cropCanvas(canvas, bounds);
}

async function renderImageRegion(
  url: string,
  pageNumber: number,
  bounds: ECOSDesktopProofBounds,
): Promise<ECOSWebDocumentProofPreview> {
  if (pageNumber !== 1) {
    throw new Error(`The cited page ${pageNumber} is not present in this image document.`);
  }
  const bytes = await fetchArtifact(url, 'Image');
  const blob = new Blob([bytes]);
  const image = await loadImage(blob);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The drawing renderer is unavailable.');
  context.drawImage(image, 0, 0);
  URL.revokeObjectURL(image.src);
  return cropCanvas(canvas, bounds);
}

async function fetchArtifact(url: string, label: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${label} download failed (${response.status}).`);
  return response.arrayBuffer();
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

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  return loadImageUrl(url, true);
}

function loadImageUrl(url: string, revoke = false): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = document.createElement('img');
    image.onload = () => resolve(image);
    image.onerror = () => {
      if (revoke) URL.revokeObjectURL(image.src);
      reject(new Error('The drawing image could not be decoded.'));
    };
    image.src = url;
  });
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
