export const ECOS_MAX_WEB_PDF_BYTES = 96 * 1024 * 1024;
export const ECOS_MAX_PDF_SOURCE_PAGES = 2_000;
export const ECOS_MAX_PDF_TEXT_ITEMS_PER_PAGE = 10_000;
export const ECOS_MAX_PDF_TEXT_CHARACTERS_PER_PAGE = 200_000;
export const ECOS_MAX_PDF_TEXT_BYTES_PER_PAGE = 800_000;
export const ECOS_MAX_PDF_DOCUMENT_TEXT_ITEMS = 50_000;
export const ECOS_MAX_PDF_DOCUMENT_TEXT_CHARACTERS = 2_000_000;
export const ECOS_MAX_PDF_DOCUMENT_TEXT_BYTES = 8_000_000;
export const ECOS_MAX_PDF_DOCUMENT_REGIONS = 50_000;
export const ECOS_MAX_PDF_DOCUMENT_REGION_CHARACTERS = 2_000_000;
export const ECOS_MAX_PDF_DOCUMENT_REGION_BYTES = 8_000_000;
export const ECOS_MAX_PDF_REGIONS_PER_PAGE = 10_000;
export const ECOS_MAX_PDF_SOURCE_DIMENSION = 200_000;
export const ECOS_MAX_PDF_ASPECT_RATIO = 100;
export const ECOS_MAX_PDF_RENDER_DIMENSION = 4_096;
export const ECOS_MAX_PDF_RENDER_PIXELS = 12_000_000;
export const ECOS_PDF_PARSE_TIMEOUT_MILLISECONDS = 30_000;
export const ECOS_PDF_RENDER_TIMEOUT_MILLISECONDS = 30_000;
export const ECOS_PDF_OCR_TIMEOUT_MILLISECONDS = 60_000;
export const ECOS_PDF_DOCUMENT_TIMEOUT_MILLISECONDS = 5 * 60_000;

export type ECOSPDFDocumentResourceBudget = {
  readonly deadlineMilliseconds: number;
  decodedItemCount: number;
  decodedCharacterCount: number;
  decodedByteCount: number;
  retainedRegionCount: number;
  retainedCharacterCount: number;
  retainedByteCount: number;
};

export function createECOSPDFDocumentResourceBudget(
  timeoutMilliseconds = ECOS_PDF_DOCUMENT_TIMEOUT_MILLISECONDS,
  nowMilliseconds = Date.now(),
): ECOSPDFDocumentResourceBudget {
  if (!Number.isFinite(timeoutMilliseconds) || timeoutMilliseconds <= 0 ||
      !Number.isFinite(nowMilliseconds)) {
    throw new Error('The protected PDF document deadline is invalid.');
  }
  return {
    deadlineMilliseconds: nowMilliseconds + timeoutMilliseconds,
    decodedItemCount: 0,
    decodedCharacterCount: 0,
    decodedByteCount: 0,
    retainedRegionCount: 0,
    retainedCharacterCount: 0,
    retainedByteCount: 0,
  };
}

export function remainingECOSPDFDocumentMilliseconds(
  budget: ECOSPDFDocumentResourceBudget,
  operationMaximumMilliseconds: number,
  nowMilliseconds = Date.now(),
) {
  const remaining = Math.floor(budget.deadlineMilliseconds - nowMilliseconds);
  if (!Number.isFinite(operationMaximumMilliseconds) || operationMaximumMilliseconds <= 0 || remaining <= 0) {
    throw new Error('PDF preparation exceeded its absolute document deadline and was cancelled.');
  }
  return Math.max(1, Math.min(operationMaximumMilliseconds, remaining));
}

export function consumeECOSPDFDocumentDecodedTextBudget(
  budget: ECOSPDFDocumentResourceBudget,
  input: Readonly<{ itemCount: number; characterCount: number; byteCount: number }>,
) {
  const nextItems = budget.decodedItemCount + input.itemCount;
  const nextCharacters = budget.decodedCharacterCount + input.characterCount;
  const nextBytes = budget.decodedByteCount + input.byteCount;
  if (![input.itemCount, input.characterCount, input.byteCount, nextItems, nextCharacters, nextBytes]
    .every(value => Number.isSafeInteger(value) && value >= 0) ||
      nextItems > ECOS_MAX_PDF_DOCUMENT_TEXT_ITEMS ||
      nextCharacters > ECOS_MAX_PDF_DOCUMENT_TEXT_CHARACTERS ||
      nextBytes > ECOS_MAX_PDF_DOCUMENT_TEXT_BYTES) {
    throw new Error('This PDF contains too much decoded text across the document for protected in-browser preparation.');
  }
  budget.decodedItemCount = nextItems;
  budget.decodedCharacterCount = nextCharacters;
  budget.decodedByteCount = nextBytes;
}

export function consumeECOSPDFDocumentRegionBudget(
  budget: ECOSPDFDocumentResourceBudget,
  regions: readonly Readonly<{ text?: unknown; label?: unknown }>[],
) {
  const encoder = new TextEncoder();
  let characterCount = 0;
  let byteCount = 0;
  for (const region of regions) {
    const text = typeof region.text === 'string'
      ? region.text
      : typeof region.label === 'string' ? region.label : '';
    characterCount += text.length;
    if (characterCount > ECOS_MAX_PDF_DOCUMENT_REGION_CHARACTERS) {
      throw new Error('This PDF contains too much retained region text for protected in-browser preparation.');
    }
    byteCount += encoder.encode(text).byteLength;
    if (byteCount > ECOS_MAX_PDF_DOCUMENT_REGION_BYTES) {
      throw new Error('This PDF contains too much retained region text for protected in-browser preparation.');
    }
  }
  const nextRegions = budget.retainedRegionCount + regions.length;
  const nextCharacters = budget.retainedCharacterCount + characterCount;
  const nextBytes = budget.retainedByteCount + byteCount;
  if (![nextRegions, nextCharacters, nextBytes].every(Number.isSafeInteger) ||
      nextRegions > ECOS_MAX_PDF_DOCUMENT_REGIONS ||
      nextCharacters > ECOS_MAX_PDF_DOCUMENT_REGION_CHARACTERS ||
      nextBytes > ECOS_MAX_PDF_DOCUMENT_REGION_BYTES) {
    throw new Error('This PDF contains too many retained regions across the document for protected in-browser preparation.');
  }
  budget.retainedRegionCount = nextRegions;
  budget.retainedCharacterCount = nextCharacters;
  budget.retainedByteCount = nextBytes;
}

export type ECOSPDFRenderPlan = Readonly<{
  scale: number;
  width: number;
  height: number;
}>;

export function assertECOSPDFByteBudget(
  byteLength: number,
  maximum = ECOS_MAX_WEB_PDF_BYTES,
) {
  if (!Number.isSafeInteger(byteLength) || byteLength < 1 || byteLength > maximum) {
    throw new Error('This PDF is too large for protected in-browser preparation. Optimize or split it, then retry.');
  }
}

export function assertECOSPDFPageBudget(
  pageCount: number,
  maximum = ECOS_MAX_PDF_SOURCE_PAGES,
) {
  if (!Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > maximum) {
    throw new Error('This PDF has too many pages for protected in-browser preparation. Split it, then retry.');
  }
}

export function assertECOSPDFTextItemBudget(
  itemCount: number,
  maximum = ECOS_MAX_PDF_TEXT_ITEMS_PER_PAGE,
) {
  if (!Number.isSafeInteger(itemCount) || itemCount < 0 || itemCount > maximum) {
    throw new Error('This PDF page contains too many text objects for protected in-browser preparation.');
  }
}

export function assertECOSPDFPageRegionBudget(
  regionCount: number,
  maximum = ECOS_MAX_PDF_REGIONS_PER_PAGE,
) {
  if (!Number.isSafeInteger(regionCount) || regionCount < 0 || regionCount > maximum) {
    throw new Error('This PDF page contains too many searchable regions for protected in-browser preparation.');
  }
}

export function assertECOSPDFDecodedTextBudget({
  itemCount,
  characterCount,
  byteCount,
}: Readonly<{
  itemCount: number;
  characterCount: number;
  byteCount: number;
}>) {
  assertECOSPDFTextItemBudget(itemCount);
  if (!Number.isSafeInteger(characterCount) || characterCount < 0 ||
      characterCount > ECOS_MAX_PDF_TEXT_CHARACTERS_PER_PAGE ||
      !Number.isSafeInteger(byteCount) || byteCount < 0 ||
      byteCount > ECOS_MAX_PDF_TEXT_BYTES_PER_PAGE) {
    throw new Error('This PDF page contains too much decoded text for protected in-browser preparation.');
  }
}

type ECOSCancellableTask<T> = Readonly<{
  promise: Promise<T>;
  cancel: () => void | Promise<unknown>;
  timeoutMilliseconds: number;
  timeoutMessage: string;
}>;

/**
 * Enforces a wall deadline at the actual kill boundary. The timeout path first
 * invokes the PDF worker/render/OCR cancellation primitive and then rejects;
 * callers never merely abandon a still-running parser promise.
 */
export function awaitECOSCancellableTask<T>({
  promise,
  cancel,
  timeoutMilliseconds,
  timeoutMessage,
}: ECOSCancellableTask<T>): Promise<T> {
  if (!Number.isFinite(timeoutMilliseconds) || timeoutMilliseconds <= 0) {
    throw new Error('The protected PDF operation deadline is invalid.');
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        void Promise.resolve(cancel()).catch(() => undefined);
      } catch {
        // Cancellation is best effort; the protected caller still fails closed.
      }
      reject(new Error(timeoutMessage));
    }, timeoutMilliseconds);
    promise.then(
      value => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function awaitECOSPDFLoadingTask<T>(
  loadingTask: Readonly<{ promise: Promise<T>; destroy: () => void | Promise<unknown> }>,
  timeoutMilliseconds = ECOS_PDF_PARSE_TIMEOUT_MILLISECONDS,
) {
  return awaitECOSCancellableTask({
    promise: loadingTask.promise,
    cancel: () => loadingTask.destroy(),
    timeoutMilliseconds,
    timeoutMessage: 'PDF parsing timed out and the protected worker was terminated.',
  });
}

export function awaitECOSPDFWorkerTask<T>(
  promise: Promise<T>,
  destroy: () => void | Promise<unknown>,
  timeoutMilliseconds = ECOS_PDF_PARSE_TIMEOUT_MILLISECONDS,
) {
  return awaitECOSCancellableTask({
    promise,
    cancel: destroy,
    timeoutMilliseconds,
    timeoutMessage: 'PDF page parsing timed out and the protected worker was terminated.',
  });
}

export function awaitECOSPDFRenderTask<T>(
  renderTask: Readonly<{ promise: Promise<T>; cancel: () => void }>,
  timeoutMilliseconds = ECOS_PDF_RENDER_TIMEOUT_MILLISECONDS,
) {
  return awaitECOSCancellableTask({
    promise: renderTask.promise,
    cancel: () => renderTask.cancel(),
    timeoutMilliseconds,
    timeoutMessage: 'PDF rendering timed out and the render task was cancelled.',
  });
}

export function awaitECOSPDFOCRTask<T>(
  promise: Promise<T>,
  terminate: () => void | Promise<unknown>,
  timeoutMilliseconds = ECOS_PDF_OCR_TIMEOUT_MILLISECONDS,
) {
  return awaitECOSCancellableTask({
    promise,
    cancel: terminate,
    timeoutMilliseconds,
    timeoutMessage: 'PDF OCR timed out and the OCR worker was terminated.',
  });
}

export type ECOSPDFTextStreamReader<T> = Readonly<{
  read: () => Promise<Readonly<{ done: boolean; value?: Readonly<{ items?: readonly T[] }> }>>;
  cancel: (reason?: unknown) => void | Promise<unknown>;
  releaseLock?: () => void;
}>;

/**
 * Consumes PDF.js text in bounded chunks. Counts are checked before any item
 * enters an application-owned array; limit/deadline failures cancel the
 * underlying stream rather than leaving the worker decoding in the background.
 */
export async function readBoundedECOSPDFTextItems<T extends Readonly<{ str?: unknown }>>(
  reader: ECOSPDFTextStreamReader<T>,
  timeoutMilliseconds = ECOS_PDF_PARSE_TIMEOUT_MILLISECONDS,
  documentBudget?: ECOSPDFDocumentResourceBudget,
): Promise<T[]> {
  const deadline = Date.now() + timeoutMilliseconds;
  const items: T[] = [];
  let characterCount = 0;
  let byteCount = 0;
  const encoder = new TextEncoder();
  try {
    while (true) {
      const remainingMilliseconds = deadline - Date.now();
      if (remainingMilliseconds <= 0) {
        await reader.cancel('PDF text streaming deadline exceeded.');
        throw new Error('PDF text streaming timed out and the parser stream was cancelled.');
      }
      const chunk = await awaitECOSCancellableTask({
        promise: reader.read(),
        cancel: () => reader.cancel('PDF text streaming deadline exceeded.'),
        timeoutMilliseconds: remainingMilliseconds,
        timeoutMessage: 'PDF text streaming timed out and the parser stream was cancelled.',
      });
      if (chunk.done) break;
      const chunkItems = Array.isArray(chunk.value?.items) ? chunk.value.items : [];
      for (const item of chunkItems) {
        const text = typeof item?.str === 'string' ? item.str : '';
        const nextCharacterCount = characterCount + text.length;
        // Check the cheap UTF-16 proxy before UTF-8 encoding can allocate an
        // attacker-controlled oversized buffer for one text object.
        assertECOSPDFDecodedTextBudget({
          itemCount: items.length + 1,
          characterCount: nextCharacterCount,
          byteCount,
        });
        const nextByteCount = byteCount + encoder.encode(text).byteLength;
        assertECOSPDFDecodedTextBudget({
          itemCount: items.length + 1,
          characterCount: nextCharacterCount,
          byteCount: nextByteCount,
        });
        if (documentBudget) {
          consumeECOSPDFDocumentDecodedTextBudget(documentBudget, {
            itemCount: 1,
            characterCount: text.length,
            byteCount: nextByteCount - byteCount,
          });
        }
        characterCount = nextCharacterCount;
        byteCount = nextByteCount;
        items.push(item);
      }
    }
    return items;
  } catch (error) {
    try {
      await reader.cancel(error);
    } catch {
      // The reader may already have been cancelled by the deadline path.
    }
    throw error;
  } finally {
    reader.releaseLock?.();
  }
}

/**
 * Produces a render plan before any canvas dimensions are assigned. Both the
 * source geometry and resulting allocation are bounded so a hostile PDF page
 * cannot turn a narrow target width into a multi-gigabyte canvas.
 */
export function boundedECOSPDFRenderPlan({
  sourceWidth,
  sourceHeight,
  targetWidth,
  targetHeight,
  maximumDimension = ECOS_MAX_PDF_RENDER_DIMENSION,
  maximumPixels = ECOS_MAX_PDF_RENDER_PIXELS,
}: Readonly<{
  sourceWidth: number;
  sourceHeight: number;
  targetWidth: number;
  targetHeight: number;
  maximumDimension?: number;
  maximumPixels?: number;
}>): ECOSPDFRenderPlan {
  const dimensions = [sourceWidth, sourceHeight, targetWidth, targetHeight, maximumDimension, maximumPixels];
  if (dimensions.some(value => !Number.isFinite(value) || value <= 0) ||
      sourceWidth > ECOS_MAX_PDF_SOURCE_DIMENSION ||
      sourceHeight > ECOS_MAX_PDF_SOURCE_DIMENSION) {
    throw new Error('The PDF page dimensions exceed protected rendering resource limits.');
  }
  const aspectRatio = Math.max(sourceWidth / sourceHeight, sourceHeight / sourceWidth);
  if (!Number.isFinite(aspectRatio) || aspectRatio > ECOS_MAX_PDF_ASPECT_RATIO) {
    throw new Error('The PDF page dimensions exceed protected rendering resource limits.');
  }
  const scale = Math.min(
    targetWidth / sourceWidth,
    targetHeight / sourceHeight,
    maximumDimension / sourceWidth,
    maximumDimension / sourceHeight,
    Math.sqrt(maximumPixels / (sourceWidth * sourceHeight)),
  );
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error('The PDF page dimensions exceed protected rendering resource limits.');
  }
  const width = Math.max(1, Math.ceil(sourceWidth * scale));
  const height = Math.max(1, Math.ceil(sourceHeight * scale));
  if (width > maximumDimension || height > maximumDimension || width * height > maximumPixels) {
    throw new Error('The PDF page canvas exceeds protected rendering resource limits.');
  }
  return Object.freeze({ scale, width, height });
}
