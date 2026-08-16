import { buildECOSDrawingEvidencePassages } from '../../supabase/functions/_shared/ecos-drawing-evidence';

describe('ECOS drawing evidence retrieval', () => {
  const question = 'How thick is the new concrete on the north side of 2375?';

  it('keeps the requested location with its nearby dimension and does not stitch a distant value into it', () => {
    const passages = buildECOSDrawingEvidencePassages({
      question,
      pageText: [
        '2375 NORTH LOT PLAN',
        'CONSTRUCT 6.0" THICK PCC PAVING',
        'CONSTRUCT 4" THICK PCC WALKWAY - SEE ARCHITECTURAL',
      ].join('\n'),
      regions: [{
        id: 'north-lot-title',
        text: '2375 NORTH LOT PLAN',
        x: 0.08,
        y: 0.10,
        width: 0.30,
        height: 0.04,
        confidence: 0.99,
        source: 'embedded_text',
      }, {
        id: 'north-lot-paving-note',
        text: 'CONSTRUCT 6.0" THICK PCC PAVING',
        x: 0.08,
        y: 0.18,
        width: 0.38,
        height: 0.04,
        confidence: 0.98,
        source: 'embedded_text',
      }, {
        id: 'distant-walkway-note',
        text: 'CONSTRUCT 4" THICK PCC WALKWAY - SEE ARCHITECTURAL',
        x: 0.58,
        y: 0.74,
        width: 0.36,
        height: 0.04,
        confidence: 0.98,
        source: 'embedded_text',
      }],
      maximumPassages: 3,
    });

    expect(passages[0]).toMatchObject({
      regionId: 'north-lot-paving-note',
      x: 0.08,
      y: 0.18,
      source: 'embedded_text',
    });
    expect(passages[0]?.text).toContain('2375 NORTH LOT PLAN');
    expect(passages[0]?.text).toContain('6.0" THICK PCC PAVING');
    expect(passages[0]?.text).not.toContain('4" THICK PCC WALKWAY');
    expect(passages.every(passage => !(
      passage.text.includes('6.0"') && passage.text.includes('4"')
    ))).toBe(true);
  });

  it('returns no measurement passage when the drawing lacks the requested subject', () => {
    expect(buildECOSDrawingEvidencePassages({
      question,
      pageText: '2375 NORTH LOT PLAN\n8" WATER MAIN',
      regions: [{
        id: 'north-lot-title',
        text: '2375 NORTH LOT PLAN',
        x: 0.1,
        y: 0.1,
        width: 0.3,
        height: 0.04,
      }, {
        id: 'water-main',
        text: '8" WATER MAIN',
        x: 0.1,
        y: 0.18,
        width: 0.3,
        height: 0.04,
      }],
    })).toEqual([]);
  });

  it('uses a bounded contiguous window when coordinates are unavailable', () => {
    const passages = buildECOSDrawingEvidencePassages({
      question,
      pageText: [
        '2375 NORTH LOT PLAN',
        'CONSTRUCTION NOTES',
        'CONSTRUCT 6" THICK PCC PAVING',
        'UNRELATED DETAIL',
      ].join('\n'),
      regions: [],
    });

    expect(passages).toHaveLength(1);
    expect(passages[0]?.text).toContain('2375 NORTH LOT PLAN');
    expect(passages[0]?.text).toContain('6" THICK PCC PAVING');
  });

  it('includes verified sheet identity context with each bounded proof passage', () => {
    const passages = buildECOSDrawingEvidencePassages({
      question,
      pageIdentity: 'DRAWING PAGE CONTEXT: Sheet C6 — PRECISE GRADING PLAN NORTH LOT PLAN.',
      pageText: 'CONSTRUCT 6.0" THICK PCC PAVING',
      regions: [{
        id: 'pcc-note',
        text: 'CONSTRUCT 6.0" THICK PCC PAVING',
        x: 0.6,
        y: 0.2,
        width: 0.2,
        height: 0.03,
        confidence: 0.98,
        source: 'vision',
      }],
    });

    expect(passages[0]?.text).toContain('Sheet C6 — PRECISE GRADING PLAN NORTH LOT PLAN');
    expect(passages[0]?.text).toContain('6.0" THICK PCC PAVING');
  });

  it('calculates a rectangular plan footprint from two same-sheet overall dimensions', () => {
    const passages = buildECOSDrawingEvidencePassages({
      question: 'How many square feet is Canopy A?',
      pageText: "CANOPY 'A' ANCHOR ROD PLAN\n122'-0\"\n52'-0\"\n26'-0\"",
      regions: [{
        id: 'plan-title', text: "CANOPY 'A' ANCHOR ROD PLAN",
        x: 0.7, y: 0.85, width: 0.2, height: 0.03, confidence: 0.99, source: 'embedded_text',
      }, {
        id: 'page-4-vision-overview-fact-1', text: "Overall horizontal dimension shown as 151'-4\"",
        x: 0.05, y: 0.05, width: 0.9, height: 0.9, confidence: 0.91, source: 'vision',
      }, {
        id: 'overall-width', text: "Overall horizontal dimension shown as 122'-0\"",
        x: 0.25, y: 0.76, width: 0.13, height: 0.02, confidence: 0.98, source: 'embedded_text',
      }, {
        id: 'overall-depth', text: "Overall vertical dimension shown as 52'-0\"",
        x: 0.08, y: 0.25, width: 0.02, height: 0.12, confidence: 0.98, source: 'embedded_text',
      }, {
        id: 'bay-depth', text: "Bay dimension shown as 26'-0\"",
        x: 0.12, y: 0.25, width: 0.02, height: 0.08, confidence: 0.98, source: 'embedded_text',
      }],
    });

    expect(passages[0]?.text).toContain("122'-0\" × 52'-0\" = 6,344 square feet");
    expect(passages[0]?.text).toContain('calculated from the cited drawing dimensions');
    expect(passages[0]?.contextRegionIds).toEqual(expect.arrayContaining([
      'overall-width',
      'overall-depth',
    ]));
  });

  it('joins the North Lot sheet context to each measured construction note without mixing values', () => {
    const passages = buildECOSDrawingEvidencePassages({
      question: 'How thick is the new concrete that was poured in the back of 2375 on the north side?',
      pageText: [
        '2375 NORTH LOT PLAN',
        'CONSTRUCTION NOTE 1: CONSTRUCT 6.0" THICK PCC PAVING',
        'CONSTRUCTION NOTE 14: CONSTRUCT 4" THICK PCC WALKWAY',
      ].join('\n'),
      regions: [{
        id: 'north-lot-plan', text: '2375 NORTH LOT PLAN',
        x: 0.05, y: 0.05, width: 0.22, height: 0.03, confidence: 0.99, source: 'ocr',
      }, {
        id: 'note-1', text: 'CONSTRUCTION NOTE 1: CONSTRUCT 6.0" THICK PCC PAVING',
        x: 0.65, y: 0.65, width: 0.3, height: 0.03, confidence: 0.94, source: 'ocr',
      }, {
        id: 'note-14', text: 'CONSTRUCTION NOTE 14: CONSTRUCT 4" THICK PCC WALKWAY',
        x: 0.65, y: 0.82, width: 0.3, height: 0.03, confidence: 0.94, source: 'ocr',
      }],
    });

    expect(passages.some(passage =>
      passage.text.includes('NORTH LOT PLAN') && passage.text.includes('6.0" THICK PCC PAVING')
    )).toBe(true);
    expect(passages.some(passage =>
      passage.text.includes('NORTH LOT PLAN') && passage.text.includes('4" THICK PCC WALKWAY')
    )).toBe(true);
    expect(passages.every(passage => !(
      passage.text.includes('6.0"') && passage.text.includes('4"')
    ))).toBe(true);
  });

  it('treats a deterministic label block as OCR without discarding its proof chain', () => {
    const passages = buildECOSDrawingEvidencePassages({
      question,
      pageText: '2375 NORTH LOT PLAN\nCONSTRUCT 6.0" THICK PCC PAVING',
      regions: [{
        id: 'label-block-1',
        text: '2375 NORTH LOT PLAN CONSTRUCT 6.0" THICK PCC PAVING',
        x: 0.08,
        y: 0.18,
        width: 0.4,
        height: 0.05,
        confidence: 0.97,
        source: 'deterministic_label_block',
        reconstructionMethod: 'trusted_same_ocr_block',
        evidenceSources: ['ocr'],
        constituentEvidence: [{ id: 'ocr-line-1', source: 'ocr' }],
        corroboratingEvidence: [{ id: 'native-note-1', source: 'embedded_text' }],
      }],
    });

    expect(passages[0]).toMatchObject({
      regionId: 'label-block-1',
      source: 'ocr',
      rawSource: 'deterministic_label_block',
      reconstructionMethod: 'trusted_same_ocr_block',
      evidenceSources: ['ocr'],
      constituentEvidence: [{ id: 'ocr-line-1' }],
      corroboratingEvidence: [{ id: 'native-note-1' }],
    });
  });

  it('does not fall back to raw page text when every supplied region is quarantined', () => {
    const passages = buildECOSDrawingEvidencePassages({
      question: 'Which canopy is intended to store hazardous waste?',
      pageText: 'CANOPY C — EXTERIOR HAZARDOUS MATERIAL STORAGE AREA',
      regions: [{
        id: 'raw-table-cell-1',
        text: 'CANOPY C — EXTERIOR HAZARDOUS MATERIAL STORAGE AREA',
        searchable: false,
        x: 0.2,
        y: 0.2,
        width: 0.4,
        height: 0.04,
        source: 'embedded_text',
      }],
    });

    expect(passages).toEqual([]);
  });

  it('uses a complete structured relationship without admitting its incomplete raw sibling', () => {
    const passages = buildECOSDrawingEvidencePassages({
      question,
      pageText: [
        '2375 NORTH LOT PLAN',
        'COMPLETE RELATIONSHIP: NEW PCC PAVING — 6.0 INCHES THICK',
        'INCOMPLETE RAW CELL: 4 INCHES',
      ].join('\n'),
      regions: [{
        id: 'structured-relationship-1',
        text: '2375 NORTH LOT PLAN — NEW PCC PAVING IS 6.0 INCHES THICK',
        searchable: true,
        x: 0.08,
        y: 0.18,
        width: 0.42,
        height: 0.05,
        source: 'vision',
      }, {
        id: 'raw-table-cell-incomplete',
        text: 'INCOMPLETE RAW CELL: 4 INCHES',
        searchable: false,
        x: 0.08,
        y: 0.22,
        width: 0.2,
        height: 0.03,
        source: 'embedded_text',
      }],
    });

    expect(passages).toHaveLength(1);
    expect(passages[0]?.text).toContain('6.0 INCHES THICK');
    expect(passages[0]?.text).not.toContain('4 INCHES');
    expect(passages[0]?.contextRegionIds).toContain('structured-relationship-1');
  });
});
