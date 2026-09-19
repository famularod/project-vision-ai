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

  it('uses deterministic question variants to bridge user wording into drawing terminology', () => {
    const passages = buildECOSDrawingEvidencePassages({
      question: 'What is the thickness of the new cement on the north lot?',
      questionVariants: [
        'What is the thickness of the new concrete on the north lot?',
        'What is the thickness of the new pcc on the north lot?',
      ],
      pageText: '2375 NORTH LOT PLAN\nCONSTRUCT 6.0" THICK PCC PAVING',
      regions: [{
        id: 'north-lot-pcc-note',
        text: '2375 NORTH LOT PLAN — CONSTRUCT 6.0" THICK PCC PAVING',
        x: 0.08,
        y: 0.18,
        width: 0.4,
        height: 0.05,
        confidence: 0.98,
        source: 'embedded_text',
      }],
    });

    expect(passages).toHaveLength(1);
    expect(passages[0]).toMatchObject({ regionId: 'north-lot-pcc-note' });
    expect(passages[0]?.text).toContain('6.0" THICK PCC PAVING');
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

  it('materializes a complete provenance-bound photometric row with role labels and units', () => {
    const constituents = [
      structuredConstituent('all', 'ALL', 0.10),
      structuredConstituent('avg', '2.8', 0.35),
      structuredConstituent('max', '21.1', 0.50),
      structuredConstituent('min', '0.0', 0.65),
    ];
    const passages = buildECOSDrawingEvidencePassages({
      question: 'What are the average, maximum, and minimum site photometric light levels?',
      pageText: 'ALL 2.8 21.1 0.0',
      regions: constituents.map((constituent) => ({
        id: constituent.id,
        text: constituent.text,
        ...constituent.bounds,
        confidence: constituent.confidence,
        source: constituent.source,
        searchable: false,
      })),
      pageIdentity: 'DRAWING PAGE CONTEXT: Sheet E-2.7.',
      structuredTableAnalysis: photometricAnalysis(constituents),
    });

    expect(passages).toHaveLength(1);
    expect(passages[0]?.text).toContain(
      'ALL site photometric light levels: average 2.8 fc; maximum 21.1 fc; minimum 0.0 fc',
    );
    expect(passages[0]).toMatchObject({
      regionId: expect.stringMatching(/^structured-dossier:/),
      rawSource: 'deterministic_structured_table_relationship',
      reconstructionMethod: 'complete_coordinate_bound_structured_table_relationship',
    });
    expect(passages[0]?.constituentEvidence).toHaveLength(4);
  });

  it.each([
    ['a conflicted relationship', { status: 'conflicted', conflictCodes: ['ambiguous_role:max'] }],
    ['a missing required role', { status: 'incomplete', missingRoles: ['min'] }],
    ['a non-fc measurement', { role: 'avg', unit: 'lux' }],
    ['a constituent mismatch', { role: 'max', text: '99.9' }],
  ] as Array<[string, {
    status?: string;
    conflictCodes?: string[];
    missingRoles?: string[];
    role?: string;
    unit?: string;
    text?: string;
  }]>)('fails closed for %s', (_label, mutation) => {
    const constituents = [
      structuredConstituent('all', 'ALL', 0.10),
      structuredConstituent('avg', '2.8', 0.35),
      structuredConstituent('max', '21.1', 0.50),
      structuredConstituent('min', '0.0', 0.65),
    ];
    const analysis = photometricAnalysis(constituents);
    const relationship = analysis.relationships[0] as Record<string, any>;
    if (mutation.status) relationship.status = mutation.status;
    if (mutation.conflictCodes) relationship.conflictCodes = mutation.conflictCodes;
    if (mutation.missingRoles) relationship.missingRoles = mutation.missingRoles;
    if (mutation.role && mutation.unit) relationship.roles[mutation.role].unit = mutation.unit;
    if (mutation.role && mutation.text) relationship.roles[mutation.role].constituents[0].text = mutation.text;

    expect(buildECOSDrawingEvidencePassages({
      question: 'What are the average, maximum, and minimum site photometric light levels?',
      pageText: 'ALL 2.8 21.1 0.0',
      regions: constituents.map((constituent) => ({
        id: constituent.id,
        text: constituent.text,
        ...constituent.bounds,
        confidence: constituent.confidence,
        source: constituent.source,
        searchable: false,
      })),
      structuredTableAnalysis: analysis,
    })).toEqual([]);
  });
});

function structuredConstituent(id: string, text: string, x: number) {
  return {
    id,
    text,
    bounds: { x, y: 0.20, width: 0.08, height: 0.03 },
    source: 'embedded_text',
    confidence: 0.98,
    duplicateRegionIds: [],
  };
}

function photometricAnalysis(constituents: ReturnType<typeof structuredConstituent>[]) {
  const byId = Object.fromEntries(constituents.map((item) => [item.id, item]));
  return {
    relationships: [{
      id: 'photometric-all',
      type: 'photometric_statistics',
      rowKey: 'ALL',
      status: 'complete',
      missingRoles: [],
      conflictCodes: [],
      roles: {
        description: { state: 'complete', value: 'ALL', unit: null, constituents: [{ ...byId.all }] },
        avg: { state: 'complete', value: 2.8, unit: 'fc', constituents: [{ ...byId.avg }] },
        max: { state: 'complete', value: 21.1, unit: 'fc', constituents: [{ ...byId.max }] },
        min: { state: 'complete', value: 0.0, unit: 'fc', constituents: [{ ...byId.min }] },
      },
      constituents: constituents.map((item) => ({ ...item })),
    }],
  };
}
