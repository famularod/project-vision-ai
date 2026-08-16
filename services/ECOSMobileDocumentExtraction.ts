import {
  isDaveTextRecognitionAvailable,
  recognizeTextFromImage,
} from '../modules/dave-text-recognition';
import type { ReferenceDocument } from '../types';

export type ECOSMobileDocumentExtraction = Pick<
  ReferenceDocument,
  | 'extractedText'
  | 'extractedPages'
  | 'extractionStatus'
  | 'extractionMethod'
  | 'extractionLimitations'
  | 'documentIntelligenceVersion'
  | 'indexedAt'
  | 'sourcePageCount'
  | 'searchablePageCount'
  | 'ocrPageCount'
  | 'extractionAverageConfidence'
  | 'indexedContentSha256'
>;

export async function extractECOSMobileDocument({
  uri,
  mimeType,
  fileName,
}: {
  uri: string;
  mimeType?: string | null;
  fileName: string;
}): Promise<ECOSMobileDocumentExtraction> {
  const indexedAt = new Date().toISOString();
  const isPdf = isNativePDFArtifact(mimeType, fileName, uri);
  try {
    // PDFs are always prepared by the protected hosted worker. Do not use a
    // runtime capability branch here: an older/stale native binary must not be
    // able to revive the uncancellable PDFKit extraction sink.
    if (isPdf) {
      return {
        extractedText: null,
        extractedPages: [],
        extractionStatus: 'not_supported',
        extractionMethod: null,
        extractionLimitations: [
          'PDF text preparation runs in the protected hosted ECOS worker; local PDF extraction is intentionally disabled.',
        ],
        documentIntelligenceVersion: 'ecos-document-intelligence/1.0',
        indexedAt,
        sourcePageCount: 0,
        searchablePageCount: 0,
        ocrPageCount: 0,
        extractionAverageConfidence: null,
        indexedContentSha256: null,
      };
    }
    if (mimeType?.startsWith('image/') && isDaveTextRecognitionAvailable()) {
      const recognized = await withTimeout(
        recognizeTextFromImage(uri),
        60_000,
        `Text recognition timed out for ${fileName}.`,
      );
      const extractedText = recognized.text.trim() || null;
      return {
        extractedText,
        extractedPages: extractedText ? [{
          pageNumber: 1,
          title: recognized.lines[0]?.slice(0, 160) || null,
          text: extractedText,
          regions: recognized.regions,
        }] : [],
        extractionStatus: extractedText ? 'complete' : 'failed',
        extractionMethod: extractedText ? 'local_ocr' : null,
        extractionLimitations: [],
        documentIntelligenceVersion: 'ecos-document-intelligence/1.0',
        indexedAt,
        sourcePageCount: 1,
        searchablePageCount: extractedText ? 1 : 0,
        ocrPageCount: extractedText ? 1 : 0,
        extractionAverageConfidence: extractedText ? recognized.averageConfidence : null,
        indexedContentSha256: null,
      };
    }
    return {
      extractedText: null,
      extractedPages: [],
      extractionStatus: 'not_supported',
      extractionMethod: null,
      extractionLimitations: ['This file type cannot be indexed by this mobile build.'],
      documentIntelligenceVersion: 'ecos-document-intelligence/1.0',
      indexedAt,
      sourcePageCount: 0,
      searchablePageCount: 0,
      ocrPageCount: 0,
      extractionAverageConfidence: null,
      indexedContentSha256: null,
    };
  } catch (error) {
    return {
      extractedText: null,
      extractedPages: [],
      extractionStatus: 'failed',
      extractionMethod: null,
      extractionLimitations: [error instanceof Error
        ? error.message
        : 'Local document extraction could not finish.'],
      documentIntelligenceVersion: 'ecos-document-intelligence/1.0',
      indexedAt,
      sourcePageCount: 0,
      searchablePageCount: 0,
      ocrPageCount: 0,
      extractionAverageConfidence: null,
      indexedContentSha256: null,
    };
  }
}

function isNativePDFArtifact(
  mimeType: string | null | undefined,
  ...locations: string[]
) {
  const normalizedMimeType = (mimeType || '').trim().toLowerCase();
  return normalizedMimeType.includes('pdf') || locations.some(value =>
    value.trim().toLowerCase().split(/[?#]/, 1)[0].endsWith('.pdf')
  );
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), milliseconds);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}
