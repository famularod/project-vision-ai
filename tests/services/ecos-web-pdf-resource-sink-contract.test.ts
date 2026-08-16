import fs from 'node:fs';
import path from 'node:path';

describe('web PDF resource limits protect real allocation sinks', () => {
  const extraction = fs.readFileSync(path.join(
    process.cwd(),
    'services/ECOSWebDocumentExtraction.ts',
  ), 'utf8');
  const preview = fs.readFileSync(path.join(
    process.cwd(),
    'services/ECOSWebDocumentProofPreview.ts',
  ), 'utf8');
  const desktop = fs.readFileSync(path.join(
    process.cwd(),
    'components/web-shell/desktop-read-only-shell.tsx',
  ), 'utf8');
  const previewComponent = fs.readFileSync(path.join(
    process.cwd(),
    'components/web-shell/desktop-document-proof-preview.tsx',
  ), 'utf8');
  const drive = fs.readFileSync(path.join(
    process.cwd(),
    'services/GoogleDriveWebProvider.ts',
  ), 'utf8');

  it('checks extraction bytes before copying them into the PDF worker', () => {
    const sink = extraction.slice(
      extraction.indexOf('async function extractPdf('),
      extraction.indexOf('function throwIfExtractionCancelled('),
    );
    expect(sink.indexOf('assertECOSPDFByteBudget(bytes.byteLength)'))
      .toBeLessThan(sink.indexOf('pdfjs.getDocument('));
    expect(sink.indexOf('assertECOSPDFPageBudget(pdf.numPages)'))
      .toBeLessThan(sink.indexOf('new Map(resumePages'));
    expect(sink).toContain('maxImageSize: ECOS_MAX_PDF_RENDER_PIXELS');
    expect(sink).toContain('canvasMaxAreaInBytes: ECOS_MAX_PDF_RENDER_PIXELS * 4');
    expect(sink).toContain('awaitECOSPDFLoadingTask(');
    expect(sink).toContain('awaitECOSPDFWorkerTask(');
    expect(sink).toContain('loadingTask.destroy()');
    expect(sink).toContain('createECOSPDFDocumentResourceBudget()');
    expect(sink).toContain('consumeECOSPDFDocumentRegionBudget(');
    expect(sink).toContain('remainingECOSPDFDocumentMilliseconds(');
  });

  it.each([
    ['OCR', 'async function ocrPdfPage(', 'export function shouldRunECOSTitleBlockOCR('],
    ['tile', 'async function renderPDFPageTileForVisualAnalysis(', 'async function renderPDFPageOverviewForVisualAnalysis('],
    ['overview', 'async function renderPDFPageOverviewForVisualAnalysis(', 'function visualCanvasDataUrl('],
  ])('plans the %s canvas before assigning dimensions', (_label, start, end) => {
    const sink = extraction.slice(extraction.indexOf(start), extraction.indexOf(end));
    expect(sink.indexOf('boundedECOSPDFRenderPlan(')).toBeGreaterThan(0);
    expect(sink.indexOf('boundedECOSPDFRenderPlan(')).toBeLessThan(sink.indexOf('canvas.width ='));
  });

  it('streams and cumulatively caps decoded text before creating searchable regions', () => {
    const sink = extraction.slice(
      extraction.indexOf('async function pdfTextLines('),
      extraction.indexOf('export function normalizedECOSPdfTextRegion('),
    );
    expect(sink).toContain('page.streamTextContent(');
    expect(sink).not.toContain('page.getTextContent(');
    expect(sink.indexOf('readBoundedECOSPDFTextItems(')).toBeLessThan(sink.indexOf('items.push('));
  });

  it('bounds OCR output and uses bounded linear row grouping after PDF.js streaming', () => {
    const ocrSink = extraction.slice(
      extraction.indexOf('function tesseractLines('),
      extraction.indexOf('function pageFromLines('),
    );
    expect(ocrSink).not.toContain('.flatMap(');
    expect(ocrSink.indexOf('assertECOSPDFTextItemBudget(seenLineCount)'))
      .toBeLessThan(ocrSink.indexOf('result.push({'));

    const mergeSink = extraction.slice(
      extraction.indexOf('export function mergeECOSPdfTextItems('),
      extraction.indexOf('function textLines('),
    );
    expect(mergeSink).not.toContain('rows.find(');
    expect(mergeSink).toContain('const row = rows.at(-1)');
    expect(mergeSink).toContain('assertECOSPDFPageRegionBudget(merged.length)');
  });

  it('cancels every PDF render and terminates OCR at wall deadlines', () => {
    expect(extraction).not.toMatch(/await page\.render\([\s\S]{0,240}\.promise/);
    expect(extraction.match(/awaitECOSPDFRenderTask\(/g)?.length).toBeGreaterThanOrEqual(3);
    expect(extraction.match(/awaitECOSPDFOCRTask\(/g)?.length).toBeGreaterThanOrEqual(3);
    expect(extraction).toContain('() => worker.terminate()');
  });

  it('streams proof bytes through the cap and plans the PDF canvas before allocation', () => {
    const fetchSink = preview.slice(
      preview.indexOf('async function fetchArtifact('),
      preview.indexOf('function cropCanvas('),
    );
    expect(fetchSink).toContain('readECOSBoundedResponseBytes(response');
    expect(fetchSink).toContain("fetch(url, { signal: controller.signal })");

    const pdfSink = preview.slice(
      preview.indexOf('async function renderPdfRegion('),
      preview.indexOf('async function renderImageRegion('),
    );
    expect(pdfSink.indexOf('assertECOSPDFPageBudget(pdf.numPages)'))
      .toBeLessThan(pdfSink.indexOf('pdf.getPage(pageNumber)'));
    expect(pdfSink.indexOf('boundedECOSPDFRenderPlan('))
      .toBeLessThan(pdfSink.indexOf('canvas.width ='));
    expect(pdfSink).toContain('awaitECOSPDFLoadingTask(');
    expect(pdfSink).toMatch(/awaitECOSPDFWorkerTask(?:<[^>]+>)?\(/);
    expect(pdfSink).toContain('awaitECOSPDFRenderTask(');
    expect(pdfSink).toContain("signal?.addEventListener('abort', abortLoadingTask");
    expect(pdfSink).toContain('throwIfProofAborted(signal)');
    expect(pdfSink).toMatch(
      /try \{\s*await pdf\.cleanup\(\);\s*\} finally \{[\s\S]{0,180}await loadingTask\.destroy\(\);/,
    );
  });

  it('preflights raster format, frames, pixels, and decoded bytes before browser decode', () => {
    const imageSink = preview.slice(
      preview.indexOf('async function renderImageRegion('),
      preview.indexOf('async function fetchArtifact('),
    );
    expect(imageSink).toContain('preflightECOSWebImage(');
    expect(imageSink.indexOf('preflightECOSWebImage('))
      .toBeLessThan(imageSink.indexOf('new Blob('));
    expect(imageSink.indexOf('preflightECOSWebImage('))
      .toBeLessThan(imageSink.indexOf('loadImage('));
    expect(imageSink).toContain('createImageProofDeadline(');
    expect(imageSink).toContain('operation.signal');
    expect(imageSink).toContain('ECOS_MAX_WEB_IMAGE_BYTES');
    expect(imageSink).toContain('ECOS_WEB_IMAGE_PREFLIGHT_TIMEOUT_MILLISECONDS');
    expect(imageSink).toContain('metadata.decodedByteLength');
  });

  it('preflights local files and streams reindex/Drive bytes before allocation', () => {
    const chooseSink = desktop.slice(
      desktop.indexOf('async function chooseUploadFile('),
      desktop.indexOf('async function chooseGoogleDriveFile('),
    );
    expect(chooseSink.indexOf('file.size > maximumSourceBytes'))
      .toBeLessThan(chooseSink.indexOf('await file.arrayBuffer()'));

    const reindexSink = desktop.slice(
      desktop.indexOf('async function performDocumentReindex('),
      desktop.indexOf('async function reindexDocument('),
    );
    expect(reindexSink).not.toContain('response.blob()');
    expect(reindexSink).not.toContain('blob.arrayBuffer()');
    expect(reindexSink.indexOf('readECOSBoundedResponseBytes(response'))
      .toBeLessThan(reindexSink.indexOf('new File([bytes]'));

    expect(drive).not.toContain('response.arrayBuffer()');
    expect(drive).toContain('readECOSBoundedResponseBytes(response');
  });

  it('aborts proof download/parser/render work when the cited proof switches or closes', () => {
    expect(previewComponent).toContain('const controller = new AbortController()');
    expect(previewComponent).toContain('signal: controller.signal');
    expect(previewComponent).toContain('controller.abort()');
  });
});
