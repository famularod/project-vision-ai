import {
  assert,
  assertEquals,
  assertFalse,
} from 'jsr:@std/assert@1.0.18';
import {
  assureAnswer,
  boundedSheetAssurance,
  boundedSourceLimitations,
  buildProviderInput,
  canonicalProjectId,
  documentMatchesProject,
  exactDrawingRevision,
  gatherEvidence,
  loadShadowPageRows,
  matchesExactProjectId,
  searchDocumentEvidence,
  trustedPageLimitations,
} from './index.ts';

const KNOWN_LIMITATION_CODE = 'structured_table_analysis_incomplete';
const KNOWN_LIMITATION_MESSAGE =
  'Some structured table content on the cited page could not be fully resolved. Review the cited page before relying on omitted rows or relationships.';
const GENERIC_LIMITATION_MESSAGE =
  'The cited page passed ECOS Assurance with a review limitation. Review the cited page before relying on potentially incomplete details.';
const PROJECT_ID = '2375abcd-0000-4000-8000-000000000001';

function pageAssurance(limitationCodes: unknown, accepted = true) {
  return {
    accepted,
    checks: { sheetMappingUsable: true },
    failureCodes: [],
    limitationCodes,
    evidenceVersion: 'ecos-hosted-evidence/1.3',
    confidence: 0.99,
  };
}

function documentSource(documentLimitations: readonly string[] = []) {
  return {
    id: 'document:drawing-a1:1:guardrail',
    sourceType: 'document' as const,
    recordId: 'drawing-a1',
    title: 'Current drawing A1, Page 1',
    excerpt: 'The current drawing requires guardrails at the parking edge.',
    updatedAt: '2026-08-09T20:00:00.000Z',
    score: 1,
    extractionConfidence: 0.99,
    documentLimitations,
  };
}

function proposedAnswer() {
  return {
    shortAnswer: 'The current drawing requires guardrails at the parking edge.',
    facts: [{
      statement: 'The current drawing requires guardrails at the parking edge.',
      classification: 'fact' as const,
      sourceIds: ['document:drawing-a1:1:guardrail'],
    }],
    limitations: [],
    conflicts: [],
    suggestedQuestions: [],
  };
}

function assure(documentLimitations: readonly string[], proposed = proposedAnswer()) {
  return assureAnswer({
    proposed,
    sources: [documentSource(documentLimitations)],
    projectId: PROJECT_ID,
    projectName: '2375 Compliance Project',
    question: 'What does the current drawing require for guardrails at the parking edge?',
    model: 'test-model',
  });
}

const SEARCH_DOCUMENTS = [{
  id: 'specification-1',
  projectId: PROJECT_ID,
  sourceSha256: 'a'.repeat(64),
  name: 'Current guardrail specification',
  category: 'Specification',
  revision: '1',
  drawingNumber: null,
  updatedAt: '2026-08-09T20:00:00.000Z',
  limitations: [],
}];

function hostedChunk() {
  return {
    job_id: '11111111-1111-4111-8111-111111111111',
    organization_id: 'org-a',
    project_id: PROJECT_ID,
    source_sha256: 'a'.repeat(64),
    evidence_version: 'ecos-hosted-evidence/1.3',
    document_id: 'specification-1',
    page_number: 1,
    region_id: 'guardrail-requirement',
    chunk_text: 'The current specification requires guardrails at the parking edge.',
    sheet_number: '',
    confidence: 0.99,
    rank: 1,
    metadata: {
      assurance: pageAssurance([]),
    },
  };
}

function hostedBookmarkChunk(strictReceipt: boolean) {
  const evidence = {
    id: 'bookmark-1-a101',
    pageNumber: 1,
    source: 'pdf_bookmark',
    text: 'A03-A101',
    normalizedBounds: null,
    ...(strictReceipt ? {
      renderedCorroborated: true,
      renderedCorroboratingRegionIds: ['rendered-a101'],
      renderedCorroboratingSources: ['sheet_identity_ocr_page_bound_validated'],
    } : {}),
  };
  return {
    ...hostedChunk(),
    sheet_number: 'A101',
    metadata: {
      assurance: pageAssurance([]),
      sheetMappingStatus: 'verified',
      sheetMappingSource: 'pdf_bookmark',
      sheetMappingEvidence: [evidence],
      documentStructuralIdentity: {
        sheetNumber: 'A101',
        source: 'pdf_bookmark',
        evidence: [evidence],
      },
    },
  };
}

function searchClient(hosted: (query: string) => { data: unknown; error: unknown }) {
  const rpcCalls: string[] = [];
  const tableCalls: string[] = [];
  return {
    rpcCalls,
    tableCalls,
    client: {
      rpc: async (name: string, args: Record<string, unknown>) => {
        rpcCalls.push(name);
        if (name === 'ecos_search_hosted_document_chunks') {
          return hosted(String(args.p_search_query || ''));
        }
        if (name === 'ecos_load_current_hosted_page_context') {
          return { data: [], error: null };
        }
        if (name === 'ecos_search_document_chunks') {
          return { data: [{ ...hostedChunk(), chunk_text: 'forged legacy hit' }], error: null };
        }
        throw new Error(`unexpected RPC: ${name}`);
      },
      from: (table: string) => {
        tableCalls.push(table);
        throw new Error(`unexpected legacy table read: ${table}`);
      },
    },
  };
}

function gatherClient(drawingRevision: unknown, embeddedDocumentId: unknown = 'drawing-1') {
  const rpcCalls: string[] = [];
  const sourceSha256 = 'b'.repeat(64);
  const referenceDocument = {
    id: 'drawing-1',
    name: 'Current drawing A1',
    category: 'Drawing',
    updated_at: '2026-08-09T20:00:00.000Z',
    document_data: {
      id: embeddedDocumentId,
      name: 'Current drawing A1',
      category: 'Drawing',
      projectId: PROJECT_ID,
      isCurrent: true,
      contentSha256: sourceSha256,
      indexedContentSha256: sourceSha256,
      ecosVerifiedIndexCommitVersion: 'ecos-verified-index-commit/1.0',
      ecosVerifiedIndexCommittedSha256: sourceSha256,
      documentIntelligenceVersion: 'ecos-document-intelligence/2.0',
      documentVisualIndexVersion: 'ecos-visual-index/3.0',
      drawingRevision,
    },
  };
  return {
    rpcCalls,
    client: {
      from: (table: string) => ({
        select: () => ({
          limit: async () => ({
            data: table === 'reference_documents' ? [referenceDocument] : [],
            error: null,
          }),
        }),
      }),
      rpc: async (name: string) => {
        rpcCalls.push(name);
        return { data: [], error: null };
      },
    },
  };
}

function shadowPageClient({ authorizeDuplicate = false } = {}) {
  const sourceOwnerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const currentProjectId = PROJECT_ID;
  const oldProjectId = '11111111-1111-4111-8111-111111111111';
  const sourceSha256 = 'c'.repeat(64);
  const rowsByTable: Record<string, unknown[]> = {
    reference_documents: [{
      id: 'drawing-shadow-1',
      owner_id: sourceOwnerId,
      category: 'Drawing',
      document_data: {
        id: 'drawing-shadow-1',
        category: 'Drawing',
        organizationId: 'org-a',
        projectId: currentProjectId,
        isCurrent: true,
        drawingStatus: 'For Construction',
        drawingRevision: 'Rev B',
        contentSha256: sourceSha256,
      },
    }],
    ecos_hosted_index_jobs: [{
      id: 'job-old-project',
      organization_id: 'org-a',
      project_id: oldProjectId,
      document_id: 'drawing-shadow-1',
      source_owner_id: sourceOwnerId,
      source_sha256: sourceSha256,
      source_revision: 'Rev A',
      committed_evidence_version: 'ecos-hosted-evidence/1.3',
      updated_at: '2026-08-09T22:00:00.000Z',
    }, {
      id: 'job-foreign-organization',
      organization_id: 'org-b',
      project_id: currentProjectId,
      document_id: 'drawing-shadow-1',
      source_owner_id: sourceOwnerId,
      source_sha256: sourceSha256,
      source_revision: 'Rev B',
      committed_evidence_version: 'ecos-hosted-evidence/1.3',
      updated_at: '2026-08-09T21:30:00.000Z',
    }, {
      id: 'job-current-project',
      organization_id: 'org-a',
      project_id: currentProjectId,
      document_id: 'drawing-shadow-1',
      source_owner_id: sourceOwnerId,
      source_sha256: sourceSha256,
      source_revision: 'Rev B',
      committed_evidence_version: 'ecos-hosted-evidence/1.3',
      updated_at: '2026-08-09T21:00:00.000Z',
    }, {
      id: 'job-current-project-duplicate',
      organization_id: 'org-a',
      project_id: currentProjectId,
      document_id: 'drawing-shadow-1',
      source_owner_id: sourceOwnerId,
      source_sha256: sourceSha256,
      source_revision: 'Rev B',
      committed_evidence_version: 'ecos-hosted-evidence/1.3',
      updated_at: '2026-08-09T20:30:00.000Z',
    }],
    ecos_hosted_index_pages: [{
      job_id: 'job-old-project',
      organization_id: 'org-a',
      project_id: oldProjectId,
      document_id: 'drawing-shadow-1',
      source_sha256: sourceSha256,
      page_number: 1,
      final_page_data: { title: 'STALE PROJECT A PAGE', text: 'stale project A evidence' },
      assurance_result: pageAssurance([]),
      unresolved_region_count: 0,
    }, {
      job_id: 'job-foreign-organization',
      organization_id: 'org-b',
      project_id: currentProjectId,
      document_id: 'drawing-shadow-1',
      source_sha256: sourceSha256,
      page_number: 1,
      final_page_data: { title: 'FOREIGN ORGANIZATION PAGE', text: 'foreign organization evidence' },
      assurance_result: pageAssurance([]),
      unresolved_region_count: 0,
    }, {
      job_id: 'job-current-project',
      organization_id: 'org-a',
      project_id: currentProjectId,
      document_id: 'drawing-shadow-1',
      source_sha256: sourceSha256,
      page_number: 1,
      final_page_data: { title: 'CURRENT PROJECT B PAGE', text: 'current project B evidence' },
      assurance_result: pageAssurance([]),
      unresolved_region_count: 0,
    }, {
      job_id: 'job-current-project-duplicate',
      organization_id: 'org-a',
      project_id: currentProjectId,
      document_id: 'drawing-shadow-1',
      source_sha256: sourceSha256,
      page_number: 1,
      final_page_data: { title: 'DUPLICATE CURRENT PAGE', text: 'ambiguous current evidence' },
      assurance_result: pageAssurance([]),
      unresolved_region_count: 0,
    }],
  };
  return {
    rpc(name: string, args: Record<string, unknown>) {
      assertEquals(name, 'ecos_hosted_job_matches_reference');
      assertEquals(args.p_require_current, true);
      const jobId = String(args.p_job_id || '');
      return Promise.resolve({
        data: jobId === 'job-current-project' ||
          (authorizeDuplicate && jobId === 'job-current-project-duplicate'),
        error: null,
      });
    },
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        order: () => chain,
        limit: async () => ({ data: rowsByTable[table] || [], error: null }),
      };
      return chain;
    },
  };
}

Deno.test('normalizes only bounded trusted accepted page limitation codes', () => {
  assertEquals(
    trustedPageLimitations(pageAssurance([
      KNOWN_LIMITATION_CODE,
      KNOWN_LIMITATION_CODE,
      '  structured_table_analysis_conflicted  ',
    ]), true),
    [
      KNOWN_LIMITATION_MESSAGE,
      'Some structured table content on the cited page has conflicting evidence. Review the cited page before relying on affected rows or relationships.',
    ],
  );
  assertEquals(trustedPageLimitations(pageAssurance(KNOWN_LIMITATION_CODE), true), []);
  assertEquals(trustedPageLimitations(pageAssurance([null, 1, {}, '', '   ']), true), []);
  assertEquals(trustedPageLimitations(pageAssurance(['x'.repeat(161)]), true), []);
  assertEquals(trustedPageLimitations(pageAssurance([KNOWN_LIMITATION_CODE], false), true), []);
  assertEquals(trustedPageLimitations(pageAssurance([KNOWN_LIMITATION_CODE]), false), []);
});

Deno.test('maps unknown internal codes to one customer-safe limitation without leaking diagnostics', () => {
  const rawInternalCode = 'provider_stack_trace_model_timeout_region_us_west';
  const bounded = boundedSheetAssurance(pageAssurance([
    rawInternalCode,
    'another_internal_provider_diagnostic',
  ]), true);
  assertEquals(bounded?.limitations, [GENERIC_LIMITATION_MESSAGE]);
  assertFalse(JSON.stringify(bounded).includes(rawInternalCode));
  assertFalse(JSON.stringify(bounded).includes('another_internal_provider_diagnostic'));
});

Deno.test('unions trusted page limits with existing document limits in the bounded provider input', () => {
  const assurance = boundedSheetAssurance(
    pageAssurance([KNOWN_LIMITATION_CODE]),
    true,
  );
  const pageLimitations = Array.isArray(assurance?.limitations)
    ? assurance.limitations
    : [];
  const limitations = boundedSourceLimitations([
    'The document extraction is partial.',
    ...pageLimitations,
    KNOWN_LIMITATION_MESSAGE,
  ]);
  const providerInput = JSON.parse(buildProviderInput({
    projectId: PROJECT_ID,
    projectName: '2375 Compliance Project',
    question: 'What does the drawing require?',
    sources: [documentSource(limitations)],
  }));

  assertEquals(providerInput.assurancePolicyVersion, 'ecos-project-answer-policy/2.8');
  assertEquals(providerInput.evidence[0].limitations, [
    'The document extraction is partial.',
    KNOWN_LIMITATION_MESSAGE,
  ]);
  assertFalse(JSON.stringify(providerInput).includes(KNOWN_LIMITATION_CODE));
});

Deno.test('trusted page limits deterministically prevent a high or plain-verified answer', () => {
  const limited = assure([KNOWN_LIMITATION_MESSAGE]);
  assertEquals(limited.confidence, 'medium');
  assertEquals(limited.assurance.status, 'verified_with_limits');
  assert(limited.limitations.includes(KNOWN_LIMITATION_MESSAGE));

  const clean = assure([]);
  assertEquals(clean.confidence, 'high');
  assertEquals(clean.assurance.status, 'verified');
  assertEquals(clean.limitations, []);
});

Deno.test('preserves trusted page limits when the provider proposes no acceptable fact', () => {
  const insufficient = assure([KNOWN_LIMITATION_MESSAGE], {
    shortAnswer: '',
    facts: [],
    limitations: [],
    conflicts: [],
    suggestedQuestions: [],
  });
  assertEquals(insufficient.confidence, 'low');
  assertEquals(insufficient.assurance.status, 'insufficient_evidence');
  assert(insufficient.limitations.includes(KNOWN_LIMITATION_MESSAGE));
});

Deno.test('treats every successful hosted empty search as authoritative over forged legacy hits', async () => {
  const fake = searchClient(() => ({ data: [], error: null }));
  const result = await searchDocumentEvidence(
    fake.client as never,
    PROJECT_ID,
    SEARCH_DOCUMENTS,
    'guardrail requirement',
    ['guardrail', 'requirement'],
  );

  assertEquals(result, []);
  assert(fake.rpcCalls.filter(name => name === 'ecos_search_hosted_document_chunks').length > 1);
  assertFalse(fake.rpcCalls.includes('ecos_search_document_chunks'));
  assertEquals(fake.tableCalls, []);
});

Deno.test('does not mix forged legacy rows into partial hosted search results or neighborhoods', async () => {
  const fake = searchClient(query => ({
    data: query === 'guardrail requirement' ? [hostedChunk()] : [],
    error: null,
  }));
  const result = await searchDocumentEvidence(
    fake.client as never,
    PROJECT_ID,
    SEARCH_DOCUMENTS,
    'guardrail requirement',
    ['guardrail', 'requirement'],
  );

  assertEquals(result.length, 1);
  assertEquals(result[0].excerpt.includes('forged legacy hit'), false);
  assertFalse(fake.rpcCalls.includes('ecos_search_document_chunks'));
  assertEquals(fake.tableCalls, []);
});

Deno.test('rejects primary hosted rows that omit exact job and organization authority', async () => {
  const { job_id: _jobId, organization_id: _organizationId, ...authorityLess } = hostedChunk();
  const fake = searchClient(query => ({
    data: query === 'guardrail requirement' ? [authorityLess] : [],
    error: null,
  }));
  const result = await searchDocumentEvidence(
    fake.client as never,
    PROJECT_ID,
    SEARCH_DOCUMENTS,
    'guardrail requirement',
    ['guardrail', 'requirement'],
  );

  assertEquals(result, []);
});

Deno.test('rejects all primary rows when query variants return two exact hosted jobs', async () => {
  const fake = searchClient(query => ({
    data: query === 'guardrail requirement'
      ? [hostedChunk()]
      : [{
          ...hostedChunk(),
          job_id: '22222222-2222-4222-8222-222222222222',
          organization_id: 'org-b',
        }],
    error: null,
  }));
  const result = await searchDocumentEvidence(
    fake.client as never,
    PROJECT_ID,
    SEARCH_DOCUMENTS,
    'guardrail requirement',
    ['guardrail', 'requirement'],
  );

  assertEquals(result, []);
});

Deno.test('downgrades bare bookmarks and retains only a strict hosted rendered receipt', async () => {
  const search = async (strictReceipt: boolean) => {
    const fake = searchClient(query => ({
      data: query === 'guardrail requirement'
        ? [hostedBookmarkChunk(strictReceipt)]
        : [],
      error: null,
    }));
    return await searchDocumentEvidence(
      fake.client as never,
      PROJECT_ID,
      SEARCH_DOCUMENTS,
      'guardrail requirement',
      ['guardrail', 'requirement'],
    );
  };

  const bare = await search(false);
  const strict = await search(true);
  assertEquals(bare.length, 1);
  assertEquals(bare[0].documentCitation?.sheetNumber, null);
  assertEquals(strict.length, 1);
  assertEquals(strict[0].documentCitation?.sheetNumber, 'A101');
  assertEquals(
    strict[0].documentProvenance?.sheetMappingEvidence?.[0]
      ?.renderedCorroborated,
    true,
  );
});

Deno.test('fails closed without legacy fallback when hosted search authority is unavailable', async () => {
  const fake = searchClient(() => ({
    data: null,
    error: { code: '42883', message: 'function unavailable' },
  }));
  const result = await searchDocumentEvidence(
    fake.client as never,
    PROJECT_ID,
    SEARCH_DOCUMENTS,
    'guardrail requirement',
    ['guardrail', 'requirement'],
  );

  assertEquals(result, []);
  assertFalse(fake.rpcCalls.includes('ecos_search_document_chunks'));
  assertEquals(fake.tableCalls, []);
});

Deno.test('rejects current drawing evidence without an exact bounded revision before search', async () => {
  for (const invalidRevision of [
    null,
    1,
    {},
    '',
    '   ',
    'Rev A\nforged',
    'R'.repeat(161),
  ]) {
    const fake = gatherClient(invalidRevision);
    const sources = await gatherEvidence(
      fake.client as never,
      PROJECT_ID,
      '2375 Compliance Project',
      'What does drawing A1 require?',
      { status: 'active', project_data: {}, updated_at: '2026-08-09T20:00:00.000Z' },
    );
    assertEquals(sources.some(source => source.sourceType === 'document'), false);
    assertEquals(fake.rpcCalls, []);
  }

  assertEquals(exactDrawingRevision('  Rev A  '), 'Rev A');
  assertEquals(exactDrawingRevision('Rev A\tforged'), null);
});

Deno.test('rejects owner-controlled embedded document ids that disagree with the durable row id', async () => {
  const fake = gatherClient('Rev A', 'drawing-forged');
  const sources = await gatherEvidence(
    fake.client as never,
    PROJECT_ID,
    '2375 Compliance Project',
    'What does drawing A1 require?',
    { status: 'active', project_data: {}, updated_at: '2026-08-09T20:00:00.000Z' },
  );
  assertEquals(sources.some(source => source.sourceType === 'document'), false);
  assertEquals(fake.rpcCalls, []);
});

Deno.test('shadow enrichment rejects a stale ready job from the old project identity', async () => {
  const rows = await loadShadowPageRows(
    shadowPageClient() as never,
    PROJECT_ID,
    ['drawing-shadow-1'],
    [1],
  );
  assertEquals(rows.length, 1);
  assertEquals(rows[0].title, 'CURRENT PROJECT B PAGE');
  assertEquals(rows[0].page_text, 'current project B evidence');
  assertFalse(JSON.stringify(rows).includes('STALE PROJECT A'));
  assertFalse(JSON.stringify(rows).includes('FOREIGN ORGANIZATION'));
});

Deno.test('shadow enrichment rejects ambiguous multiple exact ready jobs', async () => {
  const rows = await loadShadowPageRows(
    shadowPageClient({ authorizeDuplicate: true }) as never,
    PROJECT_ID,
    ['drawing-shadow-1'],
    [1],
  );
  assertEquals(rows, []);
});

Deno.test('matches project authority only by canonical raw UUID text', () => {
  assertEquals(canonicalProjectId(PROJECT_ID), PROJECT_ID);
  assertEquals(canonicalProjectId(` ${PROJECT_ID} `), null);
  assertEquals(canonicalProjectId(PROJECT_ID.toUpperCase()), null);
  assertEquals(canonicalProjectId('project-2375'), null);
  assert(matchesExactProjectId(PROJECT_ID, PROJECT_ID));
  assertFalse(matchesExactProjectId(PROJECT_ID, ` ${PROJECT_ID} `));
  assertFalse(matchesExactProjectId(PROJECT_ID, PROJECT_ID.toUpperCase()));
  assert(documentMatchesProject({ projectId: PROJECT_ID }, PROJECT_ID));
  assertFalse(documentMatchesProject({ projectId: ` ${PROJECT_ID} ` }, PROJECT_ID));
});
