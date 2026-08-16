import fs from 'node:fs';
import path from 'node:path';

describe('native untrusted PDF fail-closed contract', () => {
  const swift = fs.readFileSync(path.join(
    process.cwd(),
    'modules/dave-text-recognition/ios/DaveTextRecognitionModule.swift',
  ), 'utf8');
  const app = fs.readFileSync(path.join(process.cwd(), 'App.tsx'), 'utf8');
  const mobileExtraction = fs.readFileSync(path.join(
    process.cwd(),
    'services/ECOSMobileDocumentExtraction.ts',
  ), 'utf8');
  const moduleSource = fs.readFileSync(path.join(
    process.cwd(),
    'modules/dave-text-recognition/src/DaveTextRecognitionModule.ts',
  ), 'utf8');
  const moduleIndex = fs.readFileSync(path.join(
    process.cwd(),
    'modules/dave-text-recognition/index.ts',
  ), 'utf8');
  const evidenceHook = fs.readFileSync(path.join(
    process.cwd(),
    'hooks/use-ecos-document-evidence.ts',
  ), 'utf8');
  const reportMedia = fs.readFileSync(path.join(
    process.cwd(),
    'services/ReportWordMedia.native.ts',
  ), 'utf8');

  it('does not expose uncancellable PDFKit text extraction on native', () => {
    expect(swift).not.toContain('AsyncFunction("extractTextFromPdf")');
    expect(swift).not.toContain('selectionsByLine()');
    expect(swift).toContain('killable hosted worker');
  });

  it('has no application caller that can revive stale native PDF text extraction', () => {
    expect(app).not.toContain('extractTextFromPdf');
    expect(app).not.toContain('isDavePdfTextExtractionAvailable');
    expect(mobileExtraction).not.toContain('extractTextFromPdf');
    expect(mobileExtraction).not.toContain('isDavePdfTextExtractionAvailable');
    expect(moduleSource).not.toContain('extractTextFromPdf');
    expect(moduleSource).not.toContain('isDavePdfTextExtractionAvailable');
    expect(moduleIndex).not.toContain('extractTextFromPdf');
    expect(moduleIndex).not.toContain('isDavePdfTextExtractionAvailable');
    expect(app).toContain('PDF schedule imports always use the bounded server extractor');
    expect(mobileExtraction).toContain('PDFs are always prepared by the protected hosted worker');
  });

  it('does not register or call an in-process PDFKit proof renderer', () => {
    expect(swift).not.toContain('import PDFKit');
    expect(swift).not.toContain('PDFDocument(');
    expect(swift).not.toContain('page.thumbnail(');
    expect(swift).not.toContain('AsyncFunction("renderPdfExcerpt")');
    expect(moduleSource).not.toContain('renderPdfExcerpt');
    expect(moduleSource).not.toContain('isDavePdfExcerptRenderingAvailable');
    expect(moduleIndex).not.toContain('renderPdfExcerpt');
    expect(evidenceHook).not.toContain('renderPdfExcerpt');
    expect(reportMedia).not.toContain('renderPdfExcerpt');
    expect(reportMedia).toContain('PDF drawing excerpts require the protected desktop renderer');
  });

  it('preserves bounded image OCR and native image report proof', () => {
    expect(swift).toContain('AsyncFunction("recognizeText")');
    expect(swift).toContain('maximumRecognizedRegions');
    expect(swift).toContain('.prefix(maximumRecognizedRegions)');
    expect(swift).toContain('pdfFileSignature');
    expect(swift).toContain('try rejectNativePDFArtifact(at: imageUrl)');
    expect(swift.indexOf('try rejectNativePDFArtifact(at: imageUrl)'))
      .toBeLessThan(swift.indexOf('CGImageSourceCreateWithURL(imageUrl as CFURL'));
    expect(reportMedia).toContain('await localRaster(document.uri, mimeType)');
    expect(reportMedia).toContain('return document.uri');
  });
});
