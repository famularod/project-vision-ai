import {
  normalizeECOSSheetProvenance,
  sameECOSSheetProvenance,
  withNormalizedECOSSheetProvenance,
} from '../../services/ECOSSheetProvenance';

const assurance = {
  accepted: true,
  method: 'ecos-assurance/1.0',
  checks: { sheetMappingUsable: true },
  failureCodes: [],
};

function bookmarkPage(overrides: Record<string, unknown> = {}) {
  return {
    pageNumber: 11,
    sheetNumber: 'E-2.5',
    sheetMappingStatus: 'verified',
    sheetMappingSource: 'pdf_bookmark',
    sheetMappingEvidence: [{
      id: 'bookmark:11:E-2.5',
      pageNumber: 11,
      source: 'pdf_bookmark',
      text: 'E11-E2.5',
      normalizedBounds: null,
      renderedCorroborated: true,
      renderedCorroboratingRegionIds: ['rendered-e-2.5'],
      renderedCorroboratingSources: ['sheet_identity_ocr_page_bound_validated'],
    }],
    regions: [{
      id: 'rendered-e-2.5',
      text: 'SHEET NUMBER E-2.5',
      source: 'ocr',
      rawSource: 'sheet_identity_ocr_page_bound_validated',
      searchable: true,
      x: 0.92,
      y: 0.94,
      width: 0.06,
      height: 0.02,
    }],
    assurance,
    ...overrides,
  };
}

function nativePage(overrides: Record<string, unknown> = {}) {
  return {
    pageNumber: 2,
    sheetNumber: 'SB-1.1',
    sheetMappingStatus: 'verified',
    sheetMappingSource: 'native_title_band',
    sheetMappingEvidence: [{
      id: 'native-title:2',
      pageNumber: 2,
      source: 'embedded_text',
      text: 'SB-1.1 SIGN SCHEDULE',
      normalizedBounds: { x: 0.72, y: 0.91, width: 0.2, height: 0.025 },
    }],
    regions: [{
      id: 'native-title:2',
      text: 'SB-1.1 SIGN SCHEDULE',
      source: 'embedded_text',
      x: 0.72,
      y: 0.91,
      width: 0.2,
      height: 0.025,
    }],
    assurance,
    ...overrides,
  };
}

function annotationPage(overrides: Record<string, unknown> = {}) {
  return {
    pageNumber: 6,
    sheetNumber: 'C6',
    sheetMappingStatus: 'verified',
    sheetMappingSource: 'pdf_annotation_title_band',
    sheetMappingEvidence: [
      {
        id: 'pdf-annotation-324-page-6',
        pageNumber: 6,
        source: 'pdf_annotation',
        annotationSubtype: 'Square',
        text: 'C6',
        renderedCorroborated: true,
        renderedCorroboratingRegionIds: ['rendered-c6'],
        renderedCorroboratingSources: ['fixed_visual_tile_coordinate_ocr'],
        normalizedBounds: {
          x: 0.952546, y: 0.907986, width: 0.013889, height: 0.013889,
        },
      },
      {
        id: 'pdf-annotation-210-page-6',
        pageNumber: 6,
        source: 'pdf_annotation',
        annotationSubtype: 'Square',
        text: 'SHEET NO.',
        renderedCorroborated: true,
        renderedCorroboratingRegionIds: ['rendered-sheet-label'],
        renderedCorroboratingSources: ['fixed_visual_tile_coordinate_ocr'],
        normalizedBounds: {
          x: 0.946373, y: 0.893519, width: 0.02662, height: 0.009259,
        },
      },
    ],
    assurance,
    ...overrides,
  };
}

describe('ECOS sheet provenance', () => {
  it('accepts a bookmark only with exact current rendered sheet identity', () => {
    const normalized = normalizeECOSSheetProvenance(bookmarkPage());

    expect(normalized.verified).toBe(true);
    expect(normalized.provenance).toMatchObject({
      sheetNumber: 'E-2.5',
      sheetMappingStatus: 'verified',
      sheetMappingSource: 'pdf_bookmark',
      documentStructuralIdentity: {
        sheetNumber: 'E-2.5',
        source: 'pdf_bookmark',
        evidence: [{ id: 'bookmark:11:E-2.5', pageNumber: 11 }],
      },
      assurance: { accepted: true, checks: { sheetMappingUsable: true } },
    });
  });

  it('canonicalizes compact A101 bookmark and rendered spellings consistently', () => {
    const normalized = normalizeECOSSheetProvenance(bookmarkPage({
      sheetNumber: 'A101',
      sheetMappingEvidence: [{
        ...bookmarkPage().sheetMappingEvidence[0],
        text: 'A03-A101',
      }],
      regions: [{
        ...bookmarkPage().regions[0],
        text: 'SHEET NUMBER A-101',
      }],
    }));

    expect(normalized.verified).toBe(true);
    expect(normalized.sheetNumber).toBe('A101');
  });

  it('accepts one native title-band item only when it binds to the current page region', () => {
    expect(normalizeECOSSheetProvenance(nativePage()).verified).toBe(true);
  });

  it('accepts one exact PDF annotation title token plus adjacent label', () => {
    const normalized = normalizeECOSSheetProvenance(annotationPage());

    expect(normalized.verified).toBe(true);
    expect(normalized.provenance).toMatchObject({
      sheetNumber: 'C6',
      sheetMappingSource: 'pdf_annotation_title_band',
      documentStructuralIdentity: {
        sheetNumber: 'C6',
        source: 'pdf_annotation_title_band',
        evidence: [
          { source: 'pdf_annotation', text: 'C6', pageNumber: 6 },
          { source: 'pdf_annotation', text: 'SHEET NO.', pageNumber: 6 },
        ],
      },
    });
  });

  it.each([
    ['wrong evidence page', bookmarkPage({
      sheetMappingEvidence: [{
        id: 'bookmark:10:E-2.5', pageNumber: 10, source: 'pdf_bookmark',
        text: 'E11-E2.5', normalizedBounds: null,
      }],
    })],
    ['bookmark missing rendered corroboration receipt', bookmarkPage({
      sheetMappingEvidence: [{
        ...bookmarkPage().sheetMappingEvidence[0],
        renderedCorroborated: undefined,
        renderedCorroboratingRegionIds: undefined,
        renderedCorroboratingSources: undefined,
      }],
    })],
    ['bookmark prose does not encode the expected structural token', bookmarkPage({
      sheetMappingEvidence: [{
        ...bookmarkPage().sheetMappingEvidence[0],
        text: 'E-2.5 LIGHTING FIXTURE SCHEDULE',
      }],
    })],
    ['bookmark rendered support is absent from the current page', bookmarkPage({
      regions: [],
    })],
    ['bookmark rendered support id is duplicated on the current page', bookmarkPage({
      regions: [bookmarkPage().regions[0], bookmarkPage().regions[0]],
    })],
    ['bookmark rendered support reads a different exact sheet', bookmarkPage({
      regions: [{ ...bookmarkPage().regions[0], text: 'SHEET NUMBER E-2.50' }],
    })],
    ['bookmark rendered support is not searchable', bookmarkPage({
      regions: [{ ...bookmarkPage().regions[0], searchable: false }],
    })],
    ['bookmark rendered support source does not match the receipt', bookmarkPage({
      regions: [{ ...bookmarkPage().regions[0], rawSource: 'title_block_ocr' }],
    })],
    ['bookmark rendered receipt declares an unused source', bookmarkPage({
      sheetMappingEvidence: [{
        ...bookmarkPage().sheetMappingEvidence[0],
        renderedCorroboratingSources: [
          'sheet_identity_ocr_page_bound_validated',
          'title_block_ocr',
        ],
      }],
    })],
    ['duplicate evidence identifiers', bookmarkPage({
      sheetMappingEvidence: [
        { id: 'same', pageNumber: 11, source: 'pdf_bookmark', text: 'E-2.5', normalizedBounds: null },
        { id: 'same', pageNumber: 11, source: 'pdf_bookmark', text: 'LIGHTING', normalizedBounds: null },
      ],
    })],
    ['forged structural identity', bookmarkPage({
      documentStructuralIdentity: {
        sheetNumber: 'E-2.7',
        source: 'pdf_bookmark',
        evidence: [{
          id: 'bookmark:11:E-2.5', pageNumber: 11, source: 'pdf_bookmark',
          text: 'E11-E2.5', normalizedBounds: null,
        }],
      },
    })],
    ['rejected assurance', bookmarkPage({
      assurance: { accepted: false, checks: { sheetMappingUsable: true }, failureCodes: ['rejected'] },
    })],
    ['unusable sheet assurance', bookmarkPage({
      assurance: { accepted: true, checks: { sheetMappingUsable: false }, failureCodes: [] },
    })],
    ['native bounds mismatch', nativePage({
      regions: [{
        id: 'native-title:2', text: 'SB-1.1 SIGN SCHEDULE', source: 'embedded_text',
        x: 0.72, y: 0.8, width: 0.2, height: 0.025,
      }],
    })],
    ['annotation missing label', annotationPage({
      sheetMappingEvidence: [annotationPage().sheetMappingEvidence[0]],
    })],
    ['annotation conflicting token', annotationPage({
      sheetMappingEvidence: [
        { ...annotationPage().sheetMappingEvidence[0], text: 'C7' },
        annotationPage().sheetMappingEvidence[1],
      ],
    })],
    ['annotation forged source', annotationPage({
      sheetMappingEvidence: [
        { ...annotationPage().sheetMappingEvidence[0], source: 'embedded_text' },
        annotationPage().sheetMappingEvidence[1],
      ],
    })],
    ['annotation forged subtype', annotationPage({
      sheetMappingEvidence: [
        { ...annotationPage().sheetMappingEvidence[0], annotationSubtype: 'FreeText' },
        annotationPage().sheetMappingEvidence[1],
      ],
    })],
    ['annotation forged evidence identifier', annotationPage({
      sheetMappingEvidence: [
        { ...annotationPage().sheetMappingEvidence[0], id: 'forged-annotation-page-6' },
        annotationPage().sheetMappingEvidence[1],
      ],
    })],
    ['annotation missing rendered corroboration proof', annotationPage({
      sheetMappingEvidence: [
        {
          ...annotationPage().sheetMappingEvidence[0],
          renderedCorroborated: undefined,
          renderedCorroboratingRegionIds: undefined,
          renderedCorroboratingSources: undefined,
        },
        annotationPage().sheetMappingEvidence[1],
      ],
    })],
    ['annotation forged rendered corroboration boolean', annotationPage({
      sheetMappingEvidence: [
        { ...annotationPage().sheetMappingEvidence[0], renderedCorroborated: false },
        annotationPage().sheetMappingEvidence[1],
      ],
    })],
    ['annotation missing rendered support id', annotationPage({
      sheetMappingEvidence: [
        { ...annotationPage().sheetMappingEvidence[0], renderedCorroboratingRegionIds: [] },
        annotationPage().sheetMappingEvidence[1],
      ],
    })],
    ['annotation duplicate rendered support id', annotationPage({
      sheetMappingEvidence: [
        {
          ...annotationPage().sheetMappingEvidence[0],
          renderedCorroboratingRegionIds: ['rendered-c6', 'rendered-c6'],
        },
        annotationPage().sheetMappingEvidence[1],
      ],
    })],
    ['annotation forged rendered support source', annotationPage({
      sheetMappingEvidence: [
        { ...annotationPage().sheetMappingEvidence[0], renderedCorroboratingSources: ['pdf_annotation'] },
        annotationPage().sheetMappingEvidence[1],
      ],
    })],
    ['annotation duplicate rendered support source', annotationPage({
      sheetMappingEvidence: [
        {
          ...annotationPage().sheetMappingEvidence[0],
          renderedCorroboratingSources: ['title_block_ocr', 'title_block_ocr'],
        },
        annotationPage().sheetMappingEvidence[1],
      ],
    })],
    ['annotation evidence identifier for another page', annotationPage({
      sheetMappingEvidence: [
        { ...annotationPage().sheetMappingEvidence[0], id: 'pdf-annotation-324-page-7' },
        annotationPage().sheetMappingEvidence[1],
      ],
    })],
    ['annotation string evidence page', annotationPage({
      sheetMappingEvidence: [
        { ...annotationPage().sheetMappingEvidence[0], pageNumber: '6' },
        annotationPage().sheetMappingEvidence[1],
      ],
    })],
    ['annotation fractional evidence page', annotationPage({
      sheetMappingEvidence: [
        { ...annotationPage().sheetMappingEvidence[0], pageNumber: 6.9 },
        annotationPage().sheetMappingEvidence[1],
      ],
    })],
    ['annotation string normalized bound', annotationPage({
      sheetMappingEvidence: [
        {
          ...annotationPage().sheetMappingEvidence[0],
          normalizedBounds: {
            ...annotationPage().sheetMappingEvidence[0].normalizedBounds,
            x: '0.952546',
          },
        },
        annotationPage().sheetMappingEvidence[1],
      ],
    })],
    ['annotation boolean normalized bound', annotationPage({
      sheetMappingEvidence: [
        {
          ...annotationPage().sheetMappingEvidence[0],
          normalizedBounds: {
            ...annotationPage().sheetMappingEvidence[0].normalizedBounds,
            width: true,
          },
        },
        annotationPage().sheetMappingEvidence[1],
      ],
    })],
    ['annotation off-band', annotationPage({
      sheetMappingEvidence: [
        {
          ...annotationPage().sheetMappingEvidence[0],
          normalizedBounds: { x: 0.5, y: 0.5, width: 0.02, height: 0.02 },
        },
        annotationPage().sheetMappingEvidence[1],
      ],
    })],
  ])('downgrades %s to page-only provenance', (_label, value) => {
    const normalized = normalizeECOSSheetProvenance(value);

    expect(normalized).toMatchObject({
      verified: false,
      sheetNumber: null,
      sheetMappingStatus: 'unverified',
      provenance: {
        sheetNumber: null,
        sheetMappingSource: null,
        sheetMappingEvidence: [],
        documentStructuralIdentity: null,
      },
    });
  });

  it('retains coordinate-text diagnostics for an explicitly unverified page', () => {
    const normalized = normalizeECOSSheetProvenance({
      pageNumber: 4,
      sheetNumber: 'A-9.9',
      sheetMappingStatus: 'unverified',
      sheetMappingSource: 'coordinate_text',
      sheetMappingEvidence: [{ id: 'untrusted' }],
    });

    expect(normalized).toMatchObject({
      verified: false,
      sheetNumber: null,
      provenance: {
        sheetMappingStatus: 'unverified',
        sheetMappingSource: 'coordinate_text',
        sheetMappingEvidence: [],
      },
    });
  });

  it('produces stable fingerprints and immutable copies for equal evidence', () => {
    const first = normalizeECOSSheetProvenance(bookmarkPage());
    const second = normalizeECOSSheetProvenance(JSON.parse(JSON.stringify(bookmarkPage())));
    const page = withNormalizedECOSSheetProvenance(bookmarkPage() as never);

    expect(sameECOSSheetProvenance(first, second)).toBe(true);
    expect(Object.isFrozen(first.provenance)).toBe(true);
    expect(page.documentStructuralIdentity?.evidence).not.toBe(
      (bookmarkPage().sheetMappingEvidence as unknown[]),
    );
  });
});
