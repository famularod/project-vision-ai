import { buildECOSSheetMapping } from '../../services/ECOSSheetMapping';
import type { ReferenceDocumentRegion } from '../../types';

function region(
  id: string,
  text: string,
  source: ReferenceDocumentRegion['source'],
  x = 0.75,
  y = 0.85,
): ReferenceDocumentRegion {
  return { id, label: text, text, areaNames: [], x, y, width: 0.2, height: 0.04, confidence: 0.96, source };
}

describe('ECOS Sheet Mapping v2', () => {
  it('verifies a sheet only when strong title-block evidence agrees', () => {
    expect(buildECOSSheetMapping([
      region('ocr-sheet', 'SHEET NO. C6', 'ocr'),
      region('vision-sheet', 'Subject: Sheet identity. Fact: Sheet C6 is titled “North Lot Plan”. Visible evidence: C6 NORTH LOT PLAN', 'vision'),
    ])).toMatchObject({
      status: 'verified',
      sheetNumber: 'C6',
      sheetTitle: 'North Lot Plan',
    });
  });

  it('fails closed when two plausible sheet identities conflict', () => {
    const mapping = buildECOSSheetMapping([
      region('ocr-sheet', 'SHEET NO. F-2.1', 'ocr'),
      region('vision-sheet', 'Subject: Sheet identity. Fact: Sheet E-2.1 is titled “Lighting Plan”. Visible evidence: E-2.1 LIGHTING PLAN', 'vision'),
    ]);

    expect(mapping.status).toBe('conflicted');
    expect(mapping.sheetNumber).toBeNull();
    expect(mapping.limitations[0]).toContain('conflicted');
  });

  it('does not mistake a project or revision number for a verified sheet', () => {
    expect(buildECOSSheetMapping([
      region('project', 'PROJECT GP-2024-03571 REV 1', 'ocr'),
    ])).toMatchObject({ status: 'unverified', sheetNumber: null });
  });

  it('uses the lower title block instead of a match-line sheet reference', () => {
    expect(buildECOSSheetMapping([
      region('match-line', 'MATCH LINE — SEE SHEET C6', 'ocr', 0.29, 0.03),
      region('title-block', 'SOUTH LOT PLAN C5', 'ocr', 0.72, 0.91),
      region('page-count', 'SHEET 5 OF 8', 'ocr', 0.92, 0.96),
    ])).toMatchObject({
      status: 'verified',
      sheetNumber: 'C5',
    });
  });

  it('normalizes a unicode title-block dash in an electrical sheet number', () => {
    expect(buildECOSSheetMapping([
      region(
        'electrical-title-block',
        'ELECTRICAL SITE PLAN SHEET E—1.0',
        'ocr',
        0.32,
        0.95,
      ),
    ])).toMatchObject({
      status: 'verified',
      sheetNumber: 'E-1.0',
    });
  });

  it('accepts a numeric-only sheet identity only after independent visual verification', () => {
    expect(buildECOSSheetMapping([
      region(
        'vision-sheet',
        'Subject: Sheet identity. Fact: Sheet 4 is titled “Anchor Rod Plan”. Visible evidence: PAGE 4 ANCHOR ROD PLAN',
        'vision',
      ),
    ])).toMatchObject({
      status: 'verified',
      sheetNumber: '4',
      sheetTitle: 'Anchor Rod Plan',
    });

    expect(buildECOSSheetMapping([
      region('cross-reference', 'SEE SHEET 4 FOR DETAILS', 'ocr'),
    ])).toMatchObject({ status: 'unverified', sheetNumber: null });
  });

  it('does not accept an OCR sheet number that has a detached trailing digit', () => {
    expect(buildECOSSheetMapping([
      region('bad-ocr-title', 'SHEET NUMBER F 2 7', 'ocr'),
    ])).toMatchObject({ status: 'unverified', sheetNumber: null });
  });
});
