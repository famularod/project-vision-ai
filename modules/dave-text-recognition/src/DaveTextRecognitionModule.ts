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

type DaveTextRecognitionNativeModule = {
  recognizeText(imageUri: string): Promise<DaveRecognizedText>;
  extractTextFromPdf?(pdfUri: string): Promise<DaveExtractedPdfText>;
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
