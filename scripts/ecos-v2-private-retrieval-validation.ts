#!/usr/bin/env -S deno run --allow-env --allow-net --allow-read
// @ts-nocheck -- This operator runs under Deno and is checked with `deno check`.

import {
  ecosExpandedQuestionTokens,
  ecosQuestionDocumentAffinity,
  ecosQuestionLexicalQueries,
  ecosQuestionRetrievalVariants,
  ecosQuestionTokenVariants,
} from "../supabase/functions/_shared/ecos-question-language.ts";
import { ecosEvidenceQuestionContextScore } from "../supabase/functions/_shared/ecos-project-answer-policy.ts";
import { buildECOSDrawingEvidencePassages } from "../supabase/functions/_shared/ecos-drawing-evidence.ts";
import {
  ECOS_EMBEDDING_DIMENSIONS,
  ECOS_EMBEDDING_MODEL,
  ecosVectorLiteral,
  fuseECOSSemanticSearchResults,
  validateECOSQuestionEmbedding,
} from "../supabase/functions/_shared/ecos-semantic-retrieval.ts";

type JsonRecord = Record<string, unknown>;

const root = new URL("../", import.meta.url);
const matrix = await readJson(
  new URL("validation/ecos/ask-ecos-end-user-reliability-matrix.json", root),
);
const suites = await Promise.all(
  valuesArray(matrix.canonicalSuites).map(async (value) =>
    await readJson(new URL(text(value), root))
  ),
);
const canonicalCases = new Map<string, JsonRecord>();
for (const suite of suites) {
  for (const testCase of recordArray(suite.cases)) {
    canonicalCases.set(
      `${text(suite.projectName)}::${text(testCase.id)}`,
      testCase,
    );
  }
}

const supabaseUrl = required("SUPABASE_URL").replace(/\/+$/, "");
const serviceRoleKey = required("SUPABASE_SERVICE_ROLE_KEY");
const workerToken = required("ECOS_SERVICE_WORKER_TOKEN");
const validationConcurrency = boundedInteger(
  Deno.env.get("ECOS_RETRIEVAL_VALIDATION_CONCURRENCY"),
  1,
  6,
  6,
);
const summaryOnly = Deno.env.get("ECOS_RETRIEVAL_VALIDATION_SUMMARY_ONLY") ===
  "1";
const semanticVariantLimit = boundedInteger(
  Deno.env.get("ECOS_RETRIEVAL_SEMANTIC_VARIANT_LIMIT"),
  1,
  6,
  6,
);
const lexicalQueryLimit = boundedInteger(
  Deno.env.get("ECOS_RETRIEVAL_LEXICAL_QUERY_LIMIT"),
  1,
  20,
  20,
);
const documents = await loadDocuments();
const pageDossierCache = new Map<string, Promise<JsonRecord | null>>();
const familyFilter = text(Deno.env.get("ECOS_RETRIEVAL_FAMILY_FILTER"));
const attempts = recordArray(matrix.families).flatMap((family) => {
  const projectName = text(family.projectName);
  const canonicalCase = canonicalCases.get(
    `${projectName}::${text(family.canonicalCaseId)}`,
  );
  if (!canonicalCase) {
    throw new Error("private_retrieval_canonical_case_missing");
  }
  if (familyFilter && text(family.id) !== familyFilter) return [];
  return valuesArray(family.variants).map((question) => ({
    familyId: text(family.id),
    projectName,
    question: text(question),
    canonicalCase,
    semanticVariants: ecosQuestionRetrievalVariants(text(question)).slice(
      0,
      semanticVariantLimit,
    ),
  }));
});
const uniqueSemanticVariants = [
  ...new Set(attempts.flatMap((attempt) => attempt.semanticVariants)),
];
const embeddingByQuestion = new Map<string, readonly number[]>();
for (let offset = 0; offset < uniqueSemanticVariants.length; offset += 64) {
  const batch = uniqueSemanticVariants.slice(offset, offset + 64);
  const embeddings = await embed(batch);
  batch.forEach((question, index) =>
    embeddingByQuestion.set(question, embeddings[index])
  );
}

const results = await concurrentMap(
  attempts,
  validationConcurrency,
  async (attempt) => {
    const projectDocuments = documents.filter((document) =>
      documentMatchesProject(document.data, attempt.projectName)
    );
    if (projectDocuments.length === 0) {
      throw new Error(
        "private_retrieval_project_documents_missing",
      );
    }
    const documentIds = projectDocuments.map((document) => document.id);
    const semanticGroups: JsonRecord[][] = [];
    for (const variant of attempt.semanticVariants) {
      semanticGroups.push(
        await semanticSearch(
          embeddingByQuestion.get(variant) || [],
          documentIds,
        ),
      );
    }
    const fused = fuseECOSSemanticSearchResults(semanticGroups, 72);
    const lexicalRows: JsonRecord[] = [];
    const lexicalGroups: JsonRecord[][] = [];
    for (
      const queryBatch of chunkValues(
        ecosQuestionLexicalQueries(attempt.question).slice(
          0,
          lexicalQueryLimit,
        ),
        4,
      )
    ) {
      const batchGroups = await Promise.all(
        queryBatch.map((query) => lexicalSearch(query, documentIds)),
      );
      lexicalGroups.push(...batchGroups);
      lexicalRows.push(...batchGroups.flat());
    }
    const retrievalRows = [
      ...fused.map((row, index) => ({
        ...row,
        _retrieval_group: 0,
        _retrieval_position: index + 1,
      })),
      ...lexicalGroups.flatMap((group, groupIndex) =>
        group.map((row, index) => ({
          ...row,
          _retrieval_group: groupIndex + 1,
          _retrieval_position: index + 1,
        }))
      ),
    ];
    const rankedPages = rankRuntimePages(
      attempt.question,
      retrievalRows,
      projectDocuments,
    );
    const expectedEvidence = recordArray(
      attempt.canonicalCase.expectedEvidence,
    );
    const anchorChecks = expectedEvidence.map((expected) =>
      matchExpectedEvidence(
        expected,
        retrievalRows,
        projectDocuments,
      )
    );
    const evidenceChecks = await Promise.all(
      anchorChecks.map(async (anchor, index) => {
        const rank = anchor.matched === true
          ? rankedPages.findIndex((page) =>
            page.documentId === text(anchor.documentId) &&
            page.pageNumber === number(anchor.pageNumber)
          ) + 1
          : 0;
        const rankedPage = rank > 0 ? rankedPages[rank - 1] : null;
        const documentPages = rankedPage
          ? rankedPages.filter((page) =>
            page.documentId === rankedPage.documentId
          )
          : [];
        return {
          ...(await verifyExpectedDossier(
            expectedEvidence[index],
            anchor,
            attempt.question,
          )),
          runtimePageRank: rank || null,
          runtimePageSelected: rank > 0 && rank <= 16,
          runtimePageScore: rankedPage?.score ?? null,
          runtimePageContextScore: rankedPage?.contextScore ?? null,
          runtimePageTokenScore: rankedPage?.tokenScore ?? null,
          runtimePageBestRetrievalRank: rankedPage?.bestRank ?? null,
          runtimePageRowCount: rankedPage?.rowCount ?? null,
          runtimeDocumentPageRank: rankedPage
            ? documentPages.findIndex((page) =>
              page.pageNumber === rankedPage.pageNumber
            ) + 1
            : null,
          runtimeDocumentPageCount: documentPages.length || null,
          runtimeBestGroupPosition: rankedPage?.bestGroupPosition ?? null,
          runtimeTopTenGroupHitCount: rankedPage?.topTenGroupHitCount ?? null,
          runtimeCutoffScore: rankedPages[15]?.score ?? null,
        };
      }),
    );
    return {
      familyId: attempt.familyId,
      questionSha256: await sha256(attempt.question),
      semanticVariantCount: attempt.semanticVariants.length,
      fusedCandidateCount: fused.length,
      lexicalCandidateCount: lexicalRows.length,
      runtimeTopPages: rankedPages.slice(0, 18).map((page) => ({
        documentName: page.documentName,
        pageNumber: page.pageNumber,
        score: page.score,
        contextScore: page.contextScore,
        tokenScore: page.tokenScore,
        bestGroupPosition: page.bestGroupPosition,
        topTenGroupHitCount: page.topTenGroupHitCount,
      })),
      passed: evidenceChecks.every((check) => check.matched),
      evidenceChecks,
    };
  },
);

const failures = results.filter((result) => !result.passed);
console.log(JSON.stringify(
  {
    schemaVersion: "ecos-private-retrieval-validation/1.0",
    retrievalContract: "ecos-evidence-retrieval/2.3",
    validationConcurrency,
    semanticVariantLimit,
    lexicalQueryLimit,
    attemptCount: results.length,
    passedCount: results.length - failures.length,
    failedCount: failures.length,
    results: summaryOnly ? failures : results,
  },
  null,
  2,
));
if (failures.length > 0) Deno.exit(1);

function rankRuntimePages(
  question: string,
  rows: readonly JsonRecord[],
  documents: readonly { id: string; name: string; data: JsonRecord }[],
) {
  const documentNameById = new Map(
    documents.map((document) => [document.id, document.name]),
  );
  const rowsByPage = new Map<string, JsonRecord[]>();
  for (const row of rows) {
    const documentId = text(row.document_id);
    const pageNumber = positiveInteger(row.page_number);
    if (!documentId || pageNumber == null || !text(row.chunk_text)) continue;
    const key = `${documentId}:${pageNumber}`;
    rowsByPage.set(key, [...(rowsByPage.get(key) || []), row]);
  }
  const queryTokens = ecosExpandedQuestionTokens(question);
  const rankedPages = [...rowsByPage.entries()].map(([key, pageRows]) => {
    const separator = key.lastIndexOf(":");
    const combinedText = pageRows.map((row) => text(row.chunk_text)).filter(
      Boolean,
    ).join("\n");
    const bestRank = Math.max(0, ...pageRows.map((row) => number(row.rank)));
    const bestConfidence = Math.max(
      0,
      ...pageRows.map((row) => number(row.confidence)),
    );
    const contextScore = ecosEvidenceQuestionContextScore(
      question,
      combinedText,
    );
    const tokenScore = diagnosticSourceScore(combinedText, queryTokens);
    const bestGroupPosition = Math.min(
      ...pageRows.map((row) => positiveInteger(row._retrieval_position) || 999),
    );
    const topTenGroups = new Set(
      pageRows.flatMap((row) => {
        const group = positiveInteger(row._retrieval_group) ??
          (number(row._retrieval_group) === 0 ? 0 : null);
        const position = positiveInteger(row._retrieval_position);
        return group != null && position != null && position <= 10
          ? [group]
          : [];
      }),
    );
    const documentId = key.slice(0, separator);
    const documentName = documentNameById.get(documentId) || "";
    const documentAffinity = ecosQuestionDocumentAffinity(
      question,
      documentName,
    );
    return {
      documentId,
      documentName,
      pageNumber: Number(key.slice(separator + 1)),
      score: documentAffinity + contextScore * 2 + tokenScore + bestRank * 0.2 +
        bestConfidence * 0.08,
      documentAffinity,
      contextScore,
      tokenScore,
      bestRank,
      bestConfidence,
      rowCount: pageRows.length,
      bestGroupPosition,
      topTenGroupHitCount: topTenGroups.size,
    };
  }).sort((left, right) => right.score - left.score);
  const preferredPages = rankedPages.filter((page) =>
    page.documentAffinity > 0
  );
  return [
    ...(preferredPages.length > 0 ? preferredPages : rankedPages),
    ...(preferredPages.length > 0
      ? rankedPages.filter((page) => page.documentAffinity === 0)
      : []),
  ];
}

function diagnosticSourceScore(
  value: string,
  queryTokens: readonly string[],
) {
  if (queryTokens.length === 0) return 0;
  const normalized = value.toLowerCase();
  const matched = queryTokens.filter((token) =>
    ecosQuestionTokenVariants(token).some((variant) =>
      normalized.includes(variant)
    )
  );
  return matched.length / queryTokens.length;
}

function positiveInteger(value: unknown) {
  const candidate = Number(value);
  return Number.isInteger(candidate) && candidate > 0 ? candidate : null;
}

async function loadDocuments() {
  const response = await fetch(
    `${supabaseUrl}/rest/v1/rpc/ecos_list_hosted_shadow_reference_documents_v21`,
    {
      method: "POST",
      headers: { ...serviceHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ p_result_limit: 1000 }),
      signal: AbortSignal.timeout(120_000),
    },
  );
  if (!response.ok) {
    const diagnostics = (await response.text()).replace(/\s+/g, " ").slice(
      0,
      240,
    );
    throw new Error(
      `private_retrieval_document_inventory_failed:${response.status}:${diagnostics}`,
    );
  }
  return recordArray(await response.json()).flatMap((value) => {
    const id = text(value.document_id);
    const projectId = text(value.project_id);
    if (!id || !projectId) return [];
    return [{
      id,
      name: text(value.document_name),
      data: { projectId, isCurrent: true },
    }];
  });
}

async function embed(input: readonly string[]) {
  const response = await fetch(
    `${supabaseUrl}/functions/v1/ecos-embedding-provider`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        "x-ecos-worker-token": workerToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: ECOS_EMBEDDING_MODEL,
        input,
        dimensions: ECOS_EMBEDDING_DIMENSIONS,
        encoding_format: "float",
      }),
      signal: AbortSignal.timeout(120_000),
    },
  );
  if (!response.ok) throw new Error("private_retrieval_embedding_failed");
  const payload = record(await response.json());
  const rows = recordArray(payload.data).sort((left, right) =>
    number(left.index) - number(right.index)
  );
  if (
    rows.length !== input.length ||
    rows.some((row, index) => number(row.index) !== index)
  ) {
    throw new Error("private_retrieval_embedding_identity_failed");
  }
  return rows.map((row) => validateECOSQuestionEmbedding(row.embedding));
}

async function semanticSearch(
  embedding: readonly number[],
  documentIds: readonly string[],
) {
  const response = await fetch(
    `${supabaseUrl}/rest/v1/rpc/ecos_search_hosted_shadow_semantic_chunks_v22`,
    {
      method: "POST",
      headers: { ...serviceHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        p_query_embedding: ecosVectorLiteral([...embedding]),
        p_document_ids: documentIds,
        p_result_limit: 48,
      }),
      signal: AbortSignal.timeout(120_000),
    },
  );
  if (!response.ok) {
    const diagnostics = (await response.text()).replace(/\s+/g, " ").slice(
      0,
      240,
    );
    throw new Error(
      `private_retrieval_semantic_search_failed:${response.status}:${diagnostics}`,
    );
  }
  return recordArray(await response.json());
}

async function lexicalSearch(
  query: string,
  documentIds: readonly string[],
) {
  const response = await fetch(
    `${supabaseUrl}/rest/v1/rpc/ecos_search_hosted_shadow_chunks`,
    {
      method: "POST",
      headers: { ...serviceHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        p_search_query: query,
        p_document_ids: documentIds,
        p_result_limit: 24,
      }),
      signal: AbortSignal.timeout(120_000),
    },
  );
  if (!response.ok) {
    const diagnostics = (await response.text()).replace(/\s+/g, " ").slice(
      0,
      240,
    );
    throw new Error(
      `private_retrieval_lexical_search_failed:${response.status}:${diagnostics}`,
    );
  }
  return recordArray(await response.json());
}

function matchExpectedEvidence(
  expected: JsonRecord,
  rows: readonly Readonly<JsonRecord>[],
  documentsForProject: readonly {
    id: string;
    name: string;
    data: JsonRecord;
  }[],
) {
  const documentPattern = regex(text(expected.documentNamePattern));
  const expectedDocumentIds = new Set(
    documentsForProject
      .filter((document) => documentPattern.test(document.name))
      .map((document) => document.id),
  );
  const sheetPatterns = valuesArray(expected.sheetNumberPatterns).map((value) =>
    regex(text(value))
  );
  const pagePatterns = valuesArray(expected.pageNumberPatterns).map((value) =>
    regex(text(value))
  );
  const excerptPatterns = valuesArray(expected.excerptPatterns).map((value) =>
    regex(text(value))
  );
  const eligibleRows = rows.filter((row) => {
    if (!expectedDocumentIds.has(text(row.document_id))) return false;
    if (
      sheetPatterns.length > 0 &&
      !sheetPatterns.some((pattern) => pattern.test(text(row.sheet_number)))
    ) return false;
    if (
      pagePatterns.length > 0 &&
      !pagePatterns.some((pattern) =>
        pattern.test(String(number(row.page_number)))
      )
    ) return false;
    return true;
  });
  const rowsByPage = new Map<string, Readonly<JsonRecord>[]>();
  for (const row of eligibleRows) {
    const key = `${text(row.document_id)}:${number(row.page_number)}`;
    rowsByPage.set(key, [...(rowsByPage.get(key) || []), row]);
  }
  for (const [key, pageRows] of rowsByPage) {
    const combined = pageRows.map((row) => text(row.chunk_text)).join("\n");
    const matchedPatternCount = excerptPatterns.filter((pattern) =>
      pattern.test(combined)
    ).length;
    const boundedRegionCount = pageRows.filter((row) => {
      const metadata = record(row.metadata);
      return text(row.region_id) &&
        [metadata.x, metadata.y, metadata.width, metadata.height]
          .every((value) => Number.isFinite(Number(value)));
    }).length;
    if (
      expected.requireBoundedRegion === true && boundedRegionCount === 0
    ) continue;
    const [, pageNumber] = key.split(":");
    return {
      matched: true,
      documentId: text(pageRows[0]?.document_id),
      pageNumber: Number(pageNumber),
      evidenceRows: pageRows,
      sheetNumbers: [
        ...new Set(
          pageRows.map((row) => text(row.sheet_number)).filter(Boolean),
        ),
      ],
      boundedRegionCount,
      matchedPatternCount,
      expectedPatternCount: excerptPatterns.length,
    };
  }
  return {
    matched: false,
    candidateDocumentCount: expectedDocumentIds.size,
    eligibleRowCount: eligibleRows.length,
    missingPatternCount:
      excerptPatterns.filter((pattern) =>
        !eligibleRows.some((row) => pattern.test(text(row.chunk_text)))
      ).length,
  };
}

async function verifyExpectedDossier(
  expected: JsonRecord,
  anchor: JsonRecord,
  question: string,
) {
  if (anchor.matched !== true) {
    return {
      ...anchor,
      matched: false,
      anchorMatched: false,
      dossierMatched: false,
    };
  }
  const documentId = text(anchor.documentId);
  const pageNumber = number(anchor.pageNumber);
  const anchorRows = recordArray(anchor.evidenceRows);
  const {
    documentId: _documentId,
    evidenceRows: _evidenceRows,
    matchedPatternCount: anchorMatchedPatternCount,
    ...safeAnchor
  } = anchor;
  const page = await loadPageDossier(documentId, pageNumber);
  if (!page) {
    return {
      ...safeAnchor,
      matched: false,
      anchorMatched: true,
      dossierMatched: false,
    };
  }
  const finalPage = record(page.final_page_data);
  const sheetNumber = text(finalPage.sheetNumber);
  const sheetTitle = text(finalPage.sheetTitle) || text(finalPage.title);
  const pageIdentity = [
    sheetNumber ? `Sheet ${sheetNumber}` : `PDF page ${pageNumber}`,
    sheetTitle,
  ]
    .filter(Boolean).join(" — ");
  const passages = buildECOSDrawingEvidencePassages({
    pageText: text(finalPage.text),
    regions: recordArray(finalPage.regions),
    question,
    questionVariants: ecosQuestionRetrievalVariants(question),
    pageIdentity: pageIdentity ? `DRAWING PAGE CONTEXT: ${pageIdentity}.` : "",
    structuredTableAnalysis: finalPage.structuredTableAnalysis,
    maximumPassages: 6,
  });
  const anchorText = anchorRows.map((row) => text(row.chunk_text)).join("\n");
  const passageText = passages.map((passage) => passage.text).join("\n");
  const pageText = recordArray(finalPage.regions)
    .filter((region) => region.searchable !== false)
    .map((region) => text(region.text) || text(region.label))
    .join("\n");
  const combined = [anchorText, passageText].filter(Boolean).join("\n");
  const patterns = valuesArray(expected.excerptPatterns).map((value) =>
    regex(text(value))
  );
  const matchedPatternCount =
    patterns.filter((pattern) => pattern.test(combined)).length;
  const pageMatchedPatternCount =
    patterns.filter((pattern) => pattern.test(pageText)).length;
  const passageMatchedPatternCount =
    patterns.filter((pattern) => pattern.test(passageText)).length;
  const boundedAnchorCount = anchorRows.filter((row) => {
    const metadata = record(row.metadata);
    return text(row.region_id) &&
      [metadata.x, metadata.y, metadata.width, metadata.height]
        .every((value) => Number.isFinite(Number(value)));
  }).length;
  const boundedPassageCount =
    passages.filter((passage) =>
      passage.regionId && [passage.x, passage.y, passage.width, passage.height]
        .every((value) => Number.isFinite(Number(value)))
    ).length;
  const dossierMatched = matchedPatternCount === patterns.length &&
    (expected.requireBoundedRegion !== true ||
      boundedAnchorCount + boundedPassageCount > 0);
  const passageDiagnostics = passages.map((passage, index) => ({
    ordinal: index + 1,
    regionId: passage.regionId,
    score: passage.score,
    bounded: Boolean(
      passage.regionId &&
        [passage.x, passage.y, passage.width, passage.height]
          .every((value) => Number.isFinite(Number(value))),
    ),
    matchedPatternCount:
      patterns.filter((pattern) => pattern.test(passage.text)).length,
  }));
  const retrievalRowDiagnostics = [...new Map(
    anchorRows.map((row) => [
      `${text(row.region_id)}:${text(row.chunk_text).toLowerCase()}`,
      row,
    ]),
  ).values()]
    .map((row) => {
      const metadata = record(row.metadata);
      return {
        regionId: text(row.region_id) || null,
        score: ecosEvidenceQuestionContextScore(
              question,
              text(row.chunk_text),
            ) * 3 +
          diagnosticSourceScore(
            text(row.chunk_text),
            ecosExpandedQuestionTokens(question),
          ) + Math.max(0, number(row.rank)) * 0.2 +
          Math.max(0, number(row.confidence)) * 0.08,
        bounded: Boolean(
          text(row.region_id) &&
            [metadata.x, metadata.y, metadata.width, metadata.height]
              .every((value) => Number.isFinite(Number(value))),
        ),
        matchedPatternCount: patterns.filter((pattern) =>
          pattern.test(text(row.chunk_text))
        )
          .length,
      };
    })
    .sort((left, right) => right.score - left.score)
    .map((item, index) => ({ ordinal: index + 1, ...item }));
  return {
    ...safeAnchor,
    matched: dossierMatched,
    anchorMatched: true,
    dossierMatched,
    dossierPassageCount: passages.length,
    boundedAnchorCount,
    boundedPassageCount,
    anchorMatchedPatternCount,
    pageMatchedPatternCount,
    passageMatchedPatternCount,
    passageDiagnostics,
    retrievalRowDiagnostics,
    matchedPatternCount,
    expectedPatternCount: patterns.length,
  };
}

function loadPageDossier(documentId: string, pageNumber: number) {
  const key = `${documentId}:${pageNumber}`;
  const cached = pageDossierCache.get(key);
  if (cached) return cached;
  const request = (async () => {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/rpc/ecos_load_hosted_shadow_page_context_v21`,
      {
        method: "POST",
        headers: { ...serviceHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          p_document_ids: [documentId],
          p_page_numbers: [pageNumber],
          p_result_limit: 1,
        }),
        signal: AbortSignal.timeout(120_000),
      },
    );
    if (!response.ok) {
      const diagnostics = (await response.text()).replace(/\s+/g, " ").slice(
        0,
        240,
      );
      throw new Error(
        `private_dossier_context_failed:${response.status}:${diagnostics}`,
      );
    }
    return recordArray(await response.json())[0] || null;
  })();
  pageDossierCache.set(key, request);
  return request;
}

function documentMatchesProject(data: JsonRecord, projectName: string) {
  const projectIds: Readonly<Record<string, string>> = {
    "2375 Compliance Project": "72e941d8-8114-4082-a976-ae5b2b5daba9",
    "2321 Compliance Project": "607c7eed-5dea-4a5a-8b52-0f165c71c4b5",
  };
  return text(data.projectName) === projectName ||
    text(data.projectId) === projectIds[projectName] ||
    valuesArray(data.projectNames).some((value) => text(value) === projectName);
}

async function concurrentMap<T, R>(
  values: readonly T[],
  limit: number,
  operation: (value: T) => Promise<R>,
) {
  const result = new Array<R>(values.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, async () => {
      while (cursor < values.length) {
        const index = cursor;
        cursor += 1;
        result[index] = await operation(values[index]);
      }
    }),
  );
  return result;
}

function serviceHeaders() {
  return { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey };
}

function regex(value: string) {
  return new RegExp(value, "i");
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

async function readJson(url: URL) {
  return record(JSON.parse(await Deno.readTextFile(url)));
}

function required(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error("private_retrieval_configuration_missing");
  return value;
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function recordArray(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(record) : [];
}

function valuesArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function chunkValues<T>(values: readonly T[], size: number) {
  const result: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) {
    result.push(values.slice(offset, offset + size));
  }
  return result;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function number(value: unknown) {
  const candidate = Number(value);
  return Number.isFinite(candidate) ? candidate : 0;
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
) {
  const candidate = Number(value);
  if (!Number.isInteger(candidate)) return fallback;
  return Math.max(minimum, Math.min(maximum, candidate));
}
