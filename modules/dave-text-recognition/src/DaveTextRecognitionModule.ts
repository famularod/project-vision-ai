import { requireOptionalNativeModule } from 'expo';

export type DaveRecognizedText = {
  text: string;
  lines: string[];
  averageConfidence: number;
};

export type DaveExtractedPdfText = {
  text: string;
  format: 'microsoft_project_tsv' | 'plain_text';
  pageCount: number;
  pagesRead: number;
};

export type DaveRenderedPdfExcerpt = {
  uri: string;
  width: number;
  height: number;
};

type DaveTextRecognitionNativeModule = {
  recognizeText(imageUri: string): Promise<DaveRecognizedText>;
  extractTextFromPdf?(pdfUri: string): Promise<DaveExtractedPdfText>;
  renderPdfExcerpt?(
    pdfUri: string,
    pageNumber: number,
    x: number,
    y: number,
    width: number,
    height: number,
  ): Promise<DaveRenderedPdfExcerpt>;
};

function getNativeModule() {
  return requireOptionalNativeModule<DaveTextRecognitionNativeModule>(
    'DaveTextRecognition',
  );
}

export function isDaveTextRecognitionAvailable() {
  return Boolean(getNativeModule()?.recognizeText);
}

export function isDavePdfTextExtractionAvailable() {
  return Boolean(getNativeModule()?.extractTextFromPdf);
}

export function isDavePdfExcerptRenderingAvailable() {
  return Boolean(getNativeModule()?.renderPdfExcerpt);
}

export async function recognizeTextFromImage(imageUri: string) {
  const nativeModule = getNativeModule();

  if (!nativeModule) {
    throw new Error('DAVE text recognition is not included in this app build.');
  }

  return nativeModule.recognizeText(imageUri);
}

export async function extractTextFromPdf(pdfUri: string) {
  const nativeModule = getNativeModule();

  if (!nativeModule?.extractTextFromPdf) {
    throw new Error('DAVE PDF text extraction is not included in this app build.');
  }

  return nativeModule.extractTextFromPdf(pdfUri);
}

export async function renderPdfExcerpt(
  pdfUri: string,
  pageNumber: number,
  region: Readonly<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>,
) {
  const nativeModule = getNativeModule();

  if (!nativeModule?.renderPdfExcerpt) {
    throw new Error('Vitruvius PDF excerpt rendering is not included in this app build.');
  }

  return nativeModule.renderPdfExcerpt(
    pdfUri,
    pageNumber,
    region.x,
    region.y,
    region.width,
    region.height,
  );
}
