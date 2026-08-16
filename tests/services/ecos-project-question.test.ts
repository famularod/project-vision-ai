import {
  askECOSProjectQuestion,
  ECOS_PROJECT_QUESTION_SCHEMA_VERSION,
  ECOSProjectQuestionError,
  findECOSProjectReferenceMismatch,
  parseECOSProjectQuestionAnswer,
} from '../../services/ECOSProjectQuestion';

describe('ECOS project question contract', () => {
  function response(overrides: Record<string, unknown> = {}) {
    return {
      schemaVersion: ECOS_PROJECT_QUESTION_SCHEMA_VERSION,
      projectId: 'project-2321',
      projectName: '2321 Compliance Project',
      question: 'What does the drawing require?',
      answer: 'No verified answer.',
      confidence: 'low',
      facts: [],
      limitations: [],
      conflicts: [],
      suggestedQuestions: [],
      supportingEvidence: [],
      assurance: {
        status: 'insufficient_evidence',
        checkedSourceCount: 0,
        verifiedFactCount: 0,
        rejectedFactCount: 0,
        message: 'No verified answer.',
      },
      generatedAt: '2026-08-09T07:00:00.000Z',
      model: 'test-model',
      ...overrides,
    };
  }

  function clientReturning(data: unknown) {
    return {
      auth: { getSession: jest.fn().mockResolvedValue({
        data: { session: { access_token: 'test-token' } },
        error: null,
      }) },
      functions: { invoke: jest.fn().mockResolvedValue({ data, error: null, response: null }) },
    } as never;
  }

  function exactDocumentEvidence() {
    return {
      sourceType: 'document',
      recordId: 'drawing-1',
      summary: 'A101 drawing note',
      excerpt: 'INSTALL 6 INCH PCC PAVING',
      documentCitation: {
        documentId: 'drawing-1',
        projectId: 'project-2321',
        sourceSha256: 'a'.repeat(64),
        evidenceVersion: 'ecos-hosted-evidence/1.3',
        documentName: 'Architectural Plans',
        revision: '1',
        pageNumber: 1,
        sheetNumber: null,
        regionId: 'region-1',
        label: 'Architectural Plans, page 1',
      },
      documentRegion: {
        id: 'region-1',
        text: 'INSTALL 6 INCH PCC PAVING',
        x: 0.1,
        y: 0.2,
        width: 0.3,
        height: 0.05,
        source: 'ocr',
      },
    };
  }

  it('parses an assured answer with an exact drawing citation and crop coordinates', () => {
    const answer = parseECOSProjectQuestionAnswer({
      schemaVersion: ECOS_PROJECT_QUESTION_SCHEMA_VERSION,
      projectId: 'project-2375',
      projectName: '2375 Compliance Project',
      question: 'How thick is the north side concrete?',
      answer: 'The north side concrete is 6 inches thick.',
      confidence: 'high',
      facts: [{
        id: 'fact-1',
        statement: 'The north side concrete is 6 inches thick.',
        classification: 'fact',
        sourceIds: ['document:civil:3:note-4'],
      }],
      limitations: [],
      conflicts: [],
      suggestedQuestions: ['Which sheet shows the concrete section?'],
      supportingEvidence: [{
        sourceType: 'document',
        recordId: 'civil',
        summary: 'Civil Plans, Sheet C2.01, Rev 3',
        excerpt: 'NORTH SIDE: 6" PCC PAVEMENT',
        documentCitation: {
          documentId: 'civil',
          projectId: 'project-2375',
          sourceSha256: 'a'.repeat(64),
          evidenceVersion: 'ecos-hosted-evidence/1.3',
          documentName: 'Civil Plans',
          revision: '3',
          pageNumber: 3,
          sheetNumber: 'C2.01',
          regionId: 'note-4',
          label: 'Civil Plans, Sheet C2.01, Rev 3',
        },
        documentProvenance: {
          sheetNumber: 'C2.01',
          sheetMappingStatus: 'verified',
          sheetMappingSource: 'pdf_bookmark',
          sheetMappingEvidence: [{
            id: 'bookmark-3-c201',
            pageNumber: 3,
            source: 'pdf_bookmark',
            text: 'C03-C2.01',
            normalizedBounds: null,
            renderedCorroborated: true,
            renderedCorroboratingRegionIds: ['rendered-c201'],
            renderedCorroboratingSources: ['sheet_identity_ocr_page_bound_validated'],
          }],
          documentStructuralIdentity: {
            sheetNumber: 'C2.01',
            source: 'pdf_bookmark',
            evidence: [{
              id: 'bookmark-3-c201',
              pageNumber: 3,
              source: 'pdf_bookmark',
              text: 'C03-C2.01',
              normalizedBounds: null,
              renderedCorroborated: true,
              renderedCorroboratingRegionIds: ['rendered-c201'],
              renderedCorroboratingSources: ['sheet_identity_ocr_page_bound_validated'],
            }],
          },
          assurance: {
            accepted: true,
            method: 'ecos-assurance-test/1.0',
            checks: { sheetMappingUsable: true },
            failureCodes: [],
          },
        },
        documentRegion: {
          id: 'note-4',
          label: 'Concrete note',
          text: 'NORTH SIDE: 6" PCC PAVEMENT',
          areaNames: ['North Side'],
          x: 0.12,
          y: 0.24,
          width: 0.4,
          height: 0.08,
          confidence: 0.98,
          source: 'deterministic_label_block',
          reconstructionMethod: 'trusted_same_ocr_block',
          evidenceSources: ['ocr'],
          constituentEvidence: [{ id: 'ocr-line-1', source: 'ocr' }],
          corroboratingEvidence: [{ id: 'native-note-1', source: 'embedded_text' }],
        },
      }],
      assurance: {
        status: 'verified',
        checkedSourceCount: 12,
        verifiedFactCount: 1,
        rejectedFactCount: 0,
        message: 'ECOS Assurance matched the fact to the current drawing.',
      },
      generatedAt: '2026-08-04T20:00:00.000Z',
      model: 'gpt-5.6-terra',
    });

    expect(answer.assurance.status).toBe('verified');
    expect(answer.supportingEvidence[0]).toMatchObject({
      sourceType: 'document',
      documentCitation: {
        pageNumber: 3,
        sheetNumber: 'C2.01',
        regionId: 'note-4',
      },
      documentProvenance: {
        sheetNumber: 'C2.01',
        sheetMappingStatus: 'verified',
        sheetMappingSource: 'pdf_bookmark',
      },
      documentRegion: {
        x: 0.12,
        width: 0.4,
        source: 'ocr',
        rawSource: 'deterministic_label_block',
        reconstructionMethod: 'trusted_same_ocr_block',
        evidenceSources: ['ocr'],
        constituentEvidence: [{ id: 'ocr-line-1' }],
        corroboratingEvidence: [{ id: 'native-note-1' }],
      },
    });
  });

  it('retains document proof by PDF page but strips a sheet label without provenance', () => {
    const answer = parseECOSProjectQuestionAnswer({
      schemaVersion: ECOS_PROJECT_QUESTION_SCHEMA_VERSION,
      projectId: 'project-2321',
      projectName: '2321 Compliance Project',
      question: 'What is the fixture count?',
      answer: 'The evidence names a count but its sheet identity is not verified.',
      confidence: 'low',
      facts: [],
      limitations: ['Exact sheet identity is unavailable.'],
      conflicts: [],
      suggestedQuestions: [],
      supportingEvidence: [{
        sourceType: 'document',
        recordId: 'electrical',
        summary: 'Electrical drawing',
        excerpt: 'Fixture total 35',
        documentCitation: {
          documentId: 'electrical',
          projectId: 'project-2321',
          sourceSha256: 'b'.repeat(64),
          evidenceVersion: 'ecos-hosted-evidence/1.3',
          documentName: 'Electrical drawing',
          revision: '1',
          pageNumber: 11,
          sheetNumber: 'E-2.5',
          regionId: null,
          label: 'Electrical drawing, PDF page 11',
        },
      }],
      assurance: {
        status: 'verified_with_limits',
        checkedSourceCount: 1,
        verifiedFactCount: 0,
        rejectedFactCount: 1,
        message: 'Exact sheet identity was not independently verified.',
      },
      generatedAt: '2026-08-09T07:00:00.000Z',
      model: 'test-model',
    });

    expect(answer.supportingEvidence[0]).toMatchObject({
      documentCitation: {
        pageNumber: 11,
        sheetNumber: null,
        regionId: null,
      },
      documentProvenance: {
        sheetNumber: null,
        sheetMappingStatus: 'unverified',
      },
    });
  });

  it('fails closed when the server response contract is incompatible', () => {
    expect(() => parseECOSProjectQuestionAnswer({
      schemaVersion: 'unknown',
    })).toThrow(ECOSProjectQuestionError);
  });

  it('rejects document evidence whose immutable project binding mismatches the answer', () => {
    expect(() => parseECOSProjectQuestionAnswer({
      schemaVersion: ECOS_PROJECT_QUESTION_SCHEMA_VERSION,
      projectId: 'project-2321',
      projectName: '2321 Compliance Project',
      question: 'What does the drawing require?',
      answer: 'No verified answer.',
      confidence: 'low',
      facts: [],
      limitations: [],
      conflicts: [],
      suggestedQuestions: [],
      supportingEvidence: [{
        sourceType: 'document',
        recordId: 'drawing-1',
        summary: 'A101',
        documentCitation: {
          documentId: 'drawing-1',
          projectId: 'project-other',
          sourceSha256: 'a'.repeat(64),
          evidenceVersion: 'ecos-hosted-evidence/1.3',
          documentName: 'A101',
          revision: '1',
          pageNumber: 1,
          sheetNumber: null,
          regionId: null,
          label: 'A101, page 1',
        },
      }],
      assurance: {
        status: 'insufficient_evidence',
        checkedSourceCount: 1,
        verifiedFactCount: 0,
        rejectedFactCount: 1,
        message: 'No verified answer.',
      },
      generatedAt: '2026-08-09T07:00:00.000Z',
      model: 'test-model',
    })).toThrow(ECOSProjectQuestionError);
  });

  it('rejects document evidence without an exact page evidence version', () => {
    expect(() => parseECOSProjectQuestionAnswer({
      schemaVersion: ECOS_PROJECT_QUESTION_SCHEMA_VERSION,
      projectId: 'project-2321',
      projectName: '2321 Compliance Project',
      question: 'What does the drawing require?',
      answer: 'No verified answer.',
      confidence: 'low',
      facts: [],
      limitations: [],
      conflicts: [],
      suggestedQuestions: [],
      supportingEvidence: [{
        sourceType: 'document',
        recordId: 'drawing-1',
        summary: 'A101',
        documentCitation: {
          documentId: 'drawing-1',
          projectId: 'project-2321',
          sourceSha256: 'a'.repeat(64),
          documentName: 'A101',
          revision: '1',
          pageNumber: 1,
          sheetNumber: null,
          regionId: null,
          label: 'A101, page 1',
        },
      }],
      assurance: {
        status: 'insufficient_evidence',
        checkedSourceCount: 1,
        verifiedFactCount: 0,
        rejectedFactCount: 1,
        message: 'No verified answer.',
      },
      generatedAt: '2026-08-09T07:00:00.000Z',
      model: 'test-model',
    })).toThrow(ECOSProjectQuestionError);
  });

  it.each([
    ['record/document identity mismatch', (evidence: ReturnType<typeof exactDocumentEvidence>) => ({
      ...evidence,
      recordId: 'different-record',
    })],
    ['nonpositive page', (evidence: ReturnType<typeof exactDocumentEvidence>) => ({
      ...evidence,
      documentCitation: { ...evidence.documentCitation, pageNumber: 0 },
    })],
    ['missing revision', (evidence: ReturnType<typeof exactDocumentEvidence>) => ({
      ...evidence,
      documentCitation: { ...evidence.documentCitation, revision: '' },
    })],
    ['missing document name', (evidence: ReturnType<typeof exactDocumentEvidence>) => ({
      ...evidence,
      documentCitation: { ...evidence.documentCitation, documentName: '' },
    })],
    ['missing proof label', (evidence: ReturnType<typeof exactDocumentEvidence>) => ({
      ...evidence,
      documentCitation: { ...evidence.documentCitation, label: '' },
    })],
    ['region id without a region', (evidence: ReturnType<typeof exactDocumentEvidence>) => ({
      ...evidence,
      documentRegion: undefined,
    })],
    ['divergent region identity', (evidence: ReturnType<typeof exactDocumentEvidence>) => ({
      ...evidence,
      documentRegion: { ...evidence.documentRegion, id: 'region-other' },
    })],
    ['out-of-page region bounds', (evidence: ReturnType<typeof exactDocumentEvidence>) => ({
      ...evidence,
      documentRegion: { ...evidence.documentRegion, x: 0.9, width: 0.2 },
    })],
  ])('rejects a malformed document proof tuple: %s', (_label, mutate) => {
    expect(() => parseECOSProjectQuestionAnswer(response({
      supportingEvidence: [mutate(exactDocumentEvidence())],
    }))).toThrow(ECOSProjectQuestionError);
  });

  it('stops a wrong-project question before making a cloud or AI request', async () => {
    const getSession = jest.fn();
    const invoke = jest.fn();
    await expect(askECOSProjectQuestion({
      client: { auth: { getSession }, functions: { invoke } } as never,
      projectId: 'project-2321',
      projectName: '2321 Compliance Project',
      question: 'How thick is the new concrete on the north side of 2375?',
    })).rejects.toMatchObject({
      code: 'project_reference_mismatch',
      message: 'Project 2321 is selected, but this question names 2375. Select project 2375 above, then ask again.',
    });
    expect(getSession).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([
    ['project id', { projectId: 'project-other' }],
    ['project name', { projectName: '2321 Other Project' }],
    ['question', { question: 'What is installed today?' }],
  ])('rejects a late response whose %s does not match the exact request identity', async (_label, mismatch) => {
    await expect(askECOSProjectQuestion({
      client: clientReturning(response(mismatch)),
      projectId: 'project-2321',
      projectName: '2321 Compliance Project',
      question: 'What does the drawing require?',
    })).rejects.toMatchObject({ code: 'response_identity_mismatch' });
  });

  it('accepts normalized project-name casing but returns the request identity', async () => {
    const answer = await askECOSProjectQuestion({
      client: clientReturning(response({ projectName: '2321 compliance project' })),
      projectId: 'project-2321',
      projectName: '2321 Compliance Project',
      question: '  What   does the drawing require?  ',
    });

    expect(answer).toMatchObject({
      projectId: 'project-2321',
      projectName: '2321 Compliance Project',
      question: 'What does the drawing require?',
    });
  });

  it('reports a provider outage without claiming the project lacks evidence', async () => {
    const client = {
      auth: { getSession: jest.fn().mockResolvedValue({
        data: { session: { access_token: 'test-token' } },
        error: null,
      }) },
      functions: { invoke: jest.fn().mockResolvedValue({
        data: null,
        error: new Error('Edge request failed'),
        response: new Response(JSON.stringify({ error: 'answer_provider_failed' }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        }),
      }) },
    } as never;

    await expect(askECOSProjectQuestion({
      client,
      projectId: 'project-2321',
      projectName: '2321 Compliance Project',
      question: 'What does the drawing require?',
    })).rejects.toMatchObject({
      code: 'answer_provider_failed',
      message: 'The ECOS answer service was temporarily unavailable. This does not mean the project evidence lacks an answer. Try again shortly.',
    });
  });

  it('does not mistake a year for a different project number', () => {
    expect(findECOSProjectReferenceMismatch(
      '2321 Compliance Project',
      'What work is scheduled at 2321 in 2026?',
    )).toBeNull();
  });
});
