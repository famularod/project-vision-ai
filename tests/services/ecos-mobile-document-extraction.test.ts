const mockExtractTextFromPdf = jest.fn();
const mockRecognizeTextFromImage = jest.fn();

jest.mock('../../modules/dave-text-recognition', () => ({
  extractTextFromPdf: (...args: unknown[]) => mockExtractTextFromPdf(...args),
  recognizeTextFromImage: (...args: unknown[]) => mockRecognizeTextFromImage(...args),
  isDavePdfTextExtractionAvailable: () => true,
  isDaveTextRecognitionAvailable: () => true,
}));

import { extractECOSMobileDocument } from '../../services/ECOSMobileDocumentExtraction';

describe('ECOS mobile document extraction', () => {
  beforeEach(() => jest.clearAllMocks());

  it('preserves true PDF page and region identity instead of creating generic page one', async () => {
    mockExtractTextFromPdf.mockResolvedValue({
      text: 'Guardrail note',
      format: 'plain_text',
      pageCount: 3,
      pagesRead: 3,
      pages: [{
        pageNumber: 3,
        sheetNumber: 'A101',
        title: 'Life safety plan',
        text: 'Guardrail note',
        regions: [{
          id: 'page-3-line-1',
          label: 'Guardrail note',
          text: 'Guardrail note',
          areaNames: [],
          x: 0.1,
          y: 0.2,
          width: 0.3,
          height: 0.05,
          confidence: 0.99,
          source: 'embedded_text',
        }],
      }],
      extractionMethod: 'embedded_text',
      limitations: [],
    });

    const result = await extractECOSMobileDocument({
      uri: 'file:///A101.pdf',
      mimeType: 'application/pdf',
      fileName: 'A101.pdf',
    });

    expect(result.extractionStatus).toBe('complete');
    expect(result.extractedPages).toHaveLength(1);
    expect(result.extractedPages?.[0]).toMatchObject({
      pageNumber: 3,
      sheetNumber: 'A101',
      regions: [{ id: 'page-3-line-1', x: 0.1, y: 0.2 }],
    });
  });

  it('retains Vision OCR coordinates for imported images', async () => {
    mockRecognizeTextFromImage.mockResolvedValue({
      text: 'North Lot guardrail',
      lines: ['North Lot guardrail'],
      averageConfidence: 0.94,
      regions: [{
        id: 'image-line-1',
        label: 'North Lot guardrail',
        text: 'North Lot guardrail',
        areaNames: [],
        x: 0.12,
        y: 0.18,
        width: 0.4,
        height: 0.08,
        confidence: 0.94,
        source: 'ocr',
      }],
    });

    const result = await extractECOSMobileDocument({
      uri: 'file:///drawing.jpg',
      mimeType: 'image/jpeg',
      fileName: 'drawing.jpg',
    });

    expect(result.extractionMethod).toBe('local_ocr');
    expect(result.extractedPages?.[0].regions?.[0]).toMatchObject({
      id: 'image-line-1',
      confidence: 0.94,
      source: 'ocr',
    });
  });
});
