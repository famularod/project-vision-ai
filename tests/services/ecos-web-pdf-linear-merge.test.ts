import { mergeECOSPdfTextItems } from '../../services/ECOSWebDocumentExtraction';

describe('ECOS web PDF text grouping remains bounded', () => {
  it('groups a worst-case set of unique rows without rescanning prior rows', () => {
    const lines = Array.from({ length: 5_000 }, (_, index) => ({
      text: `Unique row ${index}`,
      x: 0.01,
      y: index * 0.007,
      width: 0.02,
      height: 0.002,
      confidence: 1,
      source: 'embedded_text' as const,
    }));
    expect(mergeECOSPdfTextItems(lines)).toHaveLength(lines.length);
  });
});
