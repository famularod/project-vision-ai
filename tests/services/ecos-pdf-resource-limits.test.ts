import {
  assertECOSPDFDecodedTextBudget,
  assertECOSPDFByteBudget,
  assertECOSPDFPageBudget,
  assertECOSPDFTextItemBudget,
  awaitECOSPDFLoadingTask,
  awaitECOSPDFOCRTask,
  awaitECOSPDFRenderTask,
  boundedECOSPDFRenderPlan,
  consumeECOSPDFDocumentDecodedTextBudget,
  consumeECOSPDFDocumentRegionBudget,
  createECOSPDFDocumentResourceBudget,
  ECOS_MAX_PDF_DOCUMENT_REGIONS,
  ECOS_MAX_PDF_DOCUMENT_TEXT_ITEMS,
  ECOS_MAX_PDF_TEXT_CHARACTERS_PER_PAGE,
  ECOS_MAX_PDF_TEXT_ITEMS_PER_PAGE,
  ECOS_MAX_WEB_PDF_BYTES,
  readBoundedECOSPDFTextItems,
  remainingECOSPDFDocumentMilliseconds,
} from '../../services/ECOSPDFResourceLimits';
import { readECOSBoundedResponseBytes } from '../../services/ECOSBoundedByteRead';

describe('ECOS PDF resource limits', () => {
  it('accepts a normal construction sheet before allocating its canvas', () => {
    expect(boundedECOSPDFRenderPlan({
      sourceWidth: 3_600,
      sourceHeight: 2_400,
      targetWidth: 2_600,
      targetHeight: 4_096,
    })).toEqual({ scale: 13 / 18, width: 2_600, height: 1_734 });
  });

  it.each([
    ['non-finite width', { sourceWidth: Number.POSITIVE_INFINITY, sourceHeight: 1_000 }],
    ['zero height', { sourceWidth: 1_000, sourceHeight: 0 }],
    ['extreme page dimension', { sourceWidth: 1_000_000, sourceHeight: 1_000 }],
    ['extreme aspect ratio', { sourceWidth: 100_000, sourceHeight: 100 }],
  ])('rejects %s before canvas allocation', (_label, geometry) => {
    expect(() => boundedECOSPDFRenderPlan({
      ...geometry,
      targetWidth: 2_600,
      targetHeight: 4_096,
    })).toThrow(/resource limits|dimensions/i);
  });

  it('rejects oversized bytes, page counts, and text-object collections', () => {
    expect(() => assertECOSPDFByteBudget(ECOS_MAX_WEB_PDF_BYTES + 1)).toThrow(/too large/i);
    expect(() => assertECOSPDFPageBudget(2_001)).toThrow(/too many pages/i);
    expect(() => assertECOSPDFTextItemBudget(ECOS_MAX_PDF_TEXT_ITEMS_PER_PAGE + 1))
      .toThrow(/too many text objects/i);
  });

  it('accepts bounded bytes, pages, and text objects', () => {
    expect(() => assertECOSPDFByteBudget(8 * 1024 * 1024)).not.toThrow();
    expect(() => assertECOSPDFPageBudget(100)).not.toThrow();
    expect(() => assertECOSPDFTextItemBudget(5_000)).not.toThrow();
  });

  it('rejects cumulative decoded characters and bytes', () => {
    expect(() => assertECOSPDFDecodedTextBudget({
      itemCount: 1,
      characterCount: ECOS_MAX_PDF_TEXT_CHARACTERS_PER_PAGE + 1,
      byteCount: 0,
    })).toThrow(/too much decoded text/i);
    expect(() => assertECOSPDFDecodedTextBudget({
      itemCount: 1,
      characterCount: 10,
      byteCount: 2_000_001,
    })).toThrow(/too much decoded text/i);
  });

  it('fails closed when 100 individually bounded pages exceed the document-global decoded budget', () => {
    const budget = createECOSPDFDocumentResourceBudget();
    const itemsPerPage = Math.floor(ECOS_MAX_PDF_DOCUMENT_TEXT_ITEMS / 100) + 1;
    expect(() => {
      for (let page = 0; page < 100; page += 1) {
        consumeECOSPDFDocumentDecodedTextBudget(budget, {
          itemCount: itemsPerPage,
          characterCount: itemsPerPage,
          byteCount: itemsPerPage,
        });
      }
    }).toThrow(/across the document/i);
  });

  it('fails closed when retained OCR regions exceed the document-global region budget', () => {
    const budget = createECOSPDFDocumentResourceBudget();
    const boundedPage = Array.from(
      { length: Math.floor(ECOS_MAX_PDF_DOCUMENT_REGIONS / 100) + 1 },
      (_, index) => ({ text: `region-${index}` }),
    );
    expect(() => {
      for (let page = 0; page < 100; page += 1) {
        consumeECOSPDFDocumentRegionBudget(budget, boundedPage);
      }
    }).toThrow(/across the document/i);
  });

  it('enforces one absolute document deadline across successive operations', () => {
    const budget = createECOSPDFDocumentResourceBudget(100, 1_000);
    expect(remainingECOSPDFDocumentMilliseconds(budget, 80, 1_010)).toBe(80);
    expect(remainingECOSPDFDocumentMilliseconds(budget, 80, 1_090)).toBe(10);
    expect(() => remainingECOSPDFDocumentMilliseconds(budget, 80, 1_100))
      .toThrow(/absolute document deadline/i);
  });

  it('cancels a streaming parser before oversized decoded text enters the app array', async () => {
    const cancel = jest.fn(async () => undefined);
    const reader = {
      read: jest.fn(async () => ({
        done: false,
        value: { items: [{ str: 'x'.repeat(ECOS_MAX_PDF_TEXT_CHARACTERS_PER_PAGE + 1) }] },
      })),
      cancel,
    };
    await expect(readBoundedECOSPDFTextItems(reader)).rejects.toThrow(/too much decoded text/i);
    expect(cancel).toHaveBeenCalled();
  });

  it('accepts bounded PDF.js text chunks and releases the stream lock', async () => {
    const chunks = [
      { done: false, value: { items: [{ str: 'Sheet A101' }] } },
      { done: false, value: { items: [{ str: 'Guardrail note' }] } },
      { done: true },
    ];
    const releaseLock = jest.fn();
    const reader = {
      read: jest.fn(async () => chunks.shift() ?? { done: true }),
      cancel: jest.fn(async () => undefined),
      releaseLock,
    };
    await expect(readBoundedECOSPDFTextItems(reader)).resolves.toEqual([
      { str: 'Sheet A101' },
      { str: 'Guardrail note' },
    ]);
    expect(releaseLock).toHaveBeenCalledTimes(1);
  });

  it('cancels parser streams that exceed their absolute wall deadline', async () => {
    const cancel = jest.fn(async () => undefined);
    const reader = {
      read: jest.fn(() => new Promise<never>(() => undefined)),
      cancel,
    };
    await expect(readBoundedECOSPDFTextItems(reader, 5)).rejects.toThrow(/timed out/i);
    expect(cancel).toHaveBeenCalled();
  });

  it('terminates loading, rendering, and OCR work instead of abandoning timed-out promises', async () => {
    const never = new Promise<never>(() => undefined);
    const destroy = jest.fn(async () => undefined);
    const cancel = jest.fn();
    const terminate = jest.fn(async () => undefined);

    await expect(awaitECOSPDFLoadingTask({ promise: never, destroy }, 5)).rejects.toThrow(/terminated/i);
    await expect(awaitECOSPDFRenderTask({ promise: never, cancel }, 5)).rejects.toThrow(/cancelled/i);
    await expect(awaitECOSPDFOCRTask(never, terminate, 5)).rejects.toThrow(/terminated/i);

    expect(destroy).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  it('cancels bounded network streams before oversized bytes are assembled', async () => {
    const cancel = jest.fn(async () => undefined);
    const reader = {
      read: jest.fn()
        .mockResolvedValueOnce({ done: false, value: new Uint8Array(8) })
        .mockResolvedValueOnce({ done: false, value: new Uint8Array(8) }),
      cancel,
      releaseLock: jest.fn(),
    };
    const response = {
      headers: new Headers(),
      body: { getReader: () => reader },
    } as unknown as Response;
    await expect(readECOSBoundedResponseBytes(response, {
      maximumBytes: 12,
      label: 'test document',
    })).rejects.toThrow(/too large/i);
    expect(cancel).toHaveBeenCalled();
    expect(reader.releaseLock).toHaveBeenCalled();
  });

  it('rejects rather than returning partial bytes when abort turns a pending read into done', async () => {
    const controller = new AbortController();
    let resolvePending: ((value: { done: true }) => void) | undefined;
    const reader = {
      read: jest.fn()
        .mockResolvedValueOnce({ done: false, value: new Uint8Array([1, 2, 3]) })
        .mockImplementationOnce(() => new Promise<{ done: true }>(resolve => {
          resolvePending = resolve;
        })),
      cancel: jest.fn(async () => {
        resolvePending?.({ done: true });
      }),
      releaseLock: jest.fn(),
    };
    const response = {
      headers: new Headers(),
      body: { getReader: () => reader },
    } as unknown as Response;
    const reading = readECOSBoundedResponseBytes(response, {
      maximumBytes: 12,
      label: 'test document',
      signal: controller.signal,
    });
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    await expect(reading).rejects.toMatchObject({ name: 'AbortError' });
    expect(reader.cancel).toHaveBeenCalled();
  });
});
