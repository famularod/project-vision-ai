import {
  askECOSProjectQuestion,
  ECOS_PROJECT_QUESTION_SCHEMA_VERSION,
  ECOSProjectQuestionError,
  findECOSProjectReferenceMismatch,
  parseECOSProjectQuestionAnswer,
} from '../../services/ECOSProjectQuestion';

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => '55555555-5555-4555-8555-555555555555'),
}));

describe('ECOS project question contract', () => {
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
          sourceSha256: 'eef6c5b751dd6d235f174370c1ab34bdb4126a92378bdee16d69d19482b45a01',
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
            text: 'C2.01',
            normalizedBounds: null,
          }],
          documentStructuralIdentity: {
            sheetNumber: 'C2.01',
            source: 'pdf_bookmark',
            evidence: [{
              id: 'bookmark-3-c201',
              pageNumber: 3,
              source: 'pdf_bookmark',
              text: 'C2.01',
              normalizedBounds: null,
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
      diagnostics: diagnostics(),
    });

    expect(answer.assurance.status).toBe('verified');
    expect(answer.supportingEvidence[0]).toMatchObject({
      sourceType: 'document',
      documentCitation: {
        projectId: 'project-2375',
        sourceSha256: 'eef6c5b751dd6d235f174370c1ab34bdb4126a92378bdee16d69d19482b45a01',
        evidenceVersion: 'ecos-hosted-evidence/1.3',
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
          documentName: 'Electrical drawing',
          pageNumber: 11,
          sheetNumber: 'E-2.5',
          regionId: 'fixture-total',
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
      diagnostics: diagnostics(),
    });

    expect(answer.supportingEvidence[0]).toMatchObject({
      documentCitation: {
        pageNumber: 11,
        sheetNumber: null,
        regionId: 'fixture-total',
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

  it('does not mistake a year for a different project number', () => {
    expect(findECOSProjectReferenceMismatch(
      '2321 Compliance Project',
      'What work is scheduled at 2321 in 2026?',
    )).toBeNull();
  });

  it('sends the same versioned request contract used by the customer path', async () => {
    const invoke = jest.fn().mockImplementation(async (_name, { body }) => ({
      data: { ...answerPayload(), diagnostics: { ...diagnostics(), clientRequestId: body.clientRequestId, clientSurface: body.clientSurface } },
      error: null,
      response: null,
    }));
    await askECOSProjectQuestion({
      client: {
        auth: { getSession: jest.fn().mockResolvedValue({ data: { session: { access_token: 'token' } }, error: null }) },
        functions: { invoke },
      } as never,
      projectId: 'project-2375',
      projectName: '2375 Compliance Project',
      question: 'How thick is the north side concrete?',
    });

    expect(invoke).toHaveBeenCalledWith('ecos-ask-project', expect.objectContaining({
      body: expect.objectContaining({
        schemaVersion: 'ecos-project-question/2.0',
        clientRequestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        projectId: 'project-2375',
        projectName: '2375 Compliance Project',
        question: 'How thick is the north side concrete?',
      }),
    }));
  });

  it.each(['projectId', 'question', 'clientRequestId', 'clientSurface'])('rejects a successful response with a different %s', async field => {
    const invoke = jest.fn().mockImplementation(async (_name, { body }) => {
      const data = { ...answerPayload(), diagnostics: { ...diagnostics(), clientRequestId: body.clientRequestId, clientSurface: body.clientSurface } };
      if (field === 'projectId') data.projectId = 'different-project';
      if (field === 'question') data.question = 'A different question?';
      if (field === 'clientRequestId') data.diagnostics.clientRequestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      if (field === 'clientSurface') data.diagnostics.clientSurface = body.clientSurface === 'web' ? 'iphone' : 'web';
      return { data, error: null, response: null };
    });
    await expect(askECOSProjectQuestion({
      client: { auth: { getSession: jest.fn().mockResolvedValue({ data: { session: { access_token: 'token' } }, error: null }) }, functions: { invoke } } as never,
      projectId: 'project-2375', projectName: '2375 Compliance Project', question: 'How thick is the north side concrete?',
    })).rejects.toMatchObject({ code: 'response_identity_mismatch' });
  });

  it.each([
    ['proof_source_unavailable', 503, 'ECOS found relevant evidence, but the protected cited page is not ready to open yet. The answer was not completed.'],
    ['proof_authority_unavailable', 503, 'The protected proof service is temporarily unavailable. The answer was not completed.'],
    ['proof_authority_identity_mismatch', 409, 'ECOS could not match a cited reference to the current project document and page. The answer was not completed.'],
    ['answer_provider_unavailable', 503, 'The AI answering service is temporarily unavailable. Your project information is unchanged. Please try again shortly.'],
    ['answer_timed_out', 503, 'ECOS reached the time limit before it could finish checking the answer. Please try again; no answer has been verified.'],
    ['answer_research_unavailable', 503, 'ECOS could not complete the project evidence search because a required service failed. This does not mean your documents are missing. Please try again shortly.'],
    ['proof_authority_response_invalid', 502, 'ECOS rejected an invalid proof response. The answer was not completed.'],
  ])('explains the protected proof failure %s accurately', async (code, status, message) => {
    const response = new Response(JSON.stringify({ error: code }), {
      status,
      headers: { 'content-type': 'application/json' },
    });
    await expect(askECOSProjectQuestion({
      client: {
        auth: { getSession: jest.fn().mockResolvedValue({ data: { session: { access_token: 'token' } }, error: null }) },
        functions: { invoke: jest.fn().mockResolvedValue({ data: null, error: new Error('request failed'), response }) },
      } as never,
      projectId: 'project-2375',
      projectName: '2375 Compliance Project',
      question: 'How many square feet is Canopy A?',
    })).rejects.toMatchObject({ code, message });
  });
});

describe('server-owned Ask ECOS conversation transport', () => {
  const conversationId = '66666666-6666-4666-8666-666666666666';
  const priorTurnId = '77777777-7777-4777-8777-777777777777';
  const turnId = '88888888-8888-4888-8888-888888888888';
  const input = { projectId: 'project-2375', projectName: '2375 Compliance Project', question: 'And canopy C?', conversationId, priorTurnId };
  function clientFor(change: (data: Record<string, any>) => void = () => {}) {
    const invoke = jest.fn(async (_name, { body }) => {
      const data: Record<string, any> = {
        ...answerPayload(), question: body.question,
        diagnostics: { ...diagnostics(), clientRequestId: body.clientRequestId, clientSurface: body.clientSurface },
        conversation: { schemaVersion: 'ecos-agent-conversation-context/1.0', conversationId, turnId, priorTurnId: body.priorTurnId || null },
      };
      change(data);
      return { data, error: null, response: null };
    });
    return { invoke, client: { auth: { getSession: async () => ({ data: { session: { access_token: 'test-token' } }, error: null }) }, functions: { invoke } } as never };
  }
  it('sends IDs on first and follow-up turns and retains the server receipt', async () => {
    const { client, invoke } = clientFor();
    const first = await askECOSProjectQuestion({ ...input, priorTurnId: undefined, client });
    expect(first.conversation).toEqual({ conversationId, turnId, priorTurnId: null });
    const answer = await askECOSProjectQuestion({ ...input, client });
    expect(answer.conversation).toEqual({ conversationId, turnId, priorTurnId });
    expect(invoke.mock.calls[1][1].body).toEqual(expect.objectContaining({ question: 'And canopy C?', conversationId, priorTurnId }));
    expect(Object.keys(invoke.mock.calls[1][1].body).sort()).toEqual([
      'clientRequestId', 'clientSurface', 'conversationId', 'priorTurnId', 'projectId', 'projectName', 'question', 'schemaVersion',
    ]);
  });
  it.each(['missing', 'wrong-conversation', 'wrong-prior', 'invalid-turn', 'not-persisted'])('fails closed for %s conversation receipt', async kind => {
    const { client } = clientFor(data => {
      if (kind === 'missing') delete data.conversation;
      if (kind === 'wrong-conversation') data.conversation.conversationId = priorTurnId;
      if (kind === 'wrong-prior') data.conversation.priorTurnId = null;
      if (kind === 'invalid-turn') data.conversation.turnId = 'not-an-id';
      if (kind === 'not-persisted') data.diagnostics.persisted = false;
    });
    await expect(askECOSProjectQuestion({ ...input, client })).rejects.toMatchObject({ code: 'conversation_context_unavailable' });
  });
  it('keeps a standalone answer compatible with the unchanged non-conversational fallback', async () => {
    const { client } = clientFor(data => { delete data.conversation; });
    const result = await askECOSProjectQuestion({ ...input, question: 'What is the square footage of canopy C?', priorTurnId: undefined, client });
    expect(result.conversation).toBeUndefined();
    expect(result.answer).toBeTruthy();
  });
  it('does not accept a malformed receipt on an initial turn', async () => {
    const { client } = clientFor(data => { data.conversation = {}; });
    await expect(askECOSProjectQuestion({ ...input, priorTurnId: undefined, client })).rejects.toMatchObject({ code: 'conversation_context_unavailable' });
  });
  it.each([{ conversationId: undefined }, { conversationId: 'bad' }, { priorTurnId: 'bad' }])('rejects malformed references before invoking the server: %j', override => {
    const { client, invoke } = clientFor();
    return expect(askECOSProjectQuestion({ ...input, ...override, client })).rejects.toMatchObject({ code: 'conversation_context_invalid' }).then(() => {
      expect(invoke).not.toHaveBeenCalled();
    });
  });
});

function diagnostics() {
  return {
    schemaVersion: 'ecos-question-trace/1.0',
    traceId: '11111111-1111-4111-8111-111111111111',
    clientRequestId: '22222222-2222-4222-8222-222222222222',
    clientSurface: 'web',
    evidenceSnapshotId: '33333333-3333-4333-8333-333333333333',
    evidenceDossierId: '44444444-4444-4444-8444-444444444444',
    replayed: false,
    persisted: true,
  };
}

function answerPayload() {
  return {
    schemaVersion: ECOS_PROJECT_QUESTION_SCHEMA_VERSION,
    projectId: 'project-2375',
    projectName: '2375 Compliance Project',
    question: 'How thick is the north side concrete?',
    answer: 'The north side concrete is 6 inches thick.',
    confidence: 'high',
    facts: [],
    limitations: [],
    conflicts: [],
    suggestedQuestions: [],
    supportingEvidence: [],
    assurance: {
      status: 'verified',
      checkedSourceCount: 1,
      verifiedFactCount: 1,
      rejectedFactCount: 0,
      message: 'Verified.',
    },
    generatedAt: '2026-09-08T00:00:00.000Z',
    model: 'test-model',
    diagnostics: diagnostics(),
  };
}
