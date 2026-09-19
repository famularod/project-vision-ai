import {
  assertEquals,
  assertRejects,
  assertThrows,
} from 'jsr:@std/assert@1';
import {
  createECOSQuestionEmbedding,
  createECOSQuestionEmbeddings,
  ECOS_EMBEDDING_DIMENSIONS,
  ECOS_EMBEDDING_MODEL,
  ECOSEmbeddingError,
  ecosVectorLiteral,
  fuseECOSSemanticSearchResults,
  validateECOSQuestionEmbedding,
} from './ecos-semantic-retrieval.ts';

Deno.test('semantic retrieval sends one bounded, server-authenticated embedding request', async () => {
  let capturedUrl = '';
  let capturedAuthorization = '';
  let capturedBody: Record<string, unknown> = {};
  const embedding = Array.from({ length: ECOS_EMBEDDING_DIMENSIONS }, (_, index) => index / 10_000);
  const fetchImplementation: typeof fetch = (_input, init) => {
    capturedUrl = String(_input);
    capturedAuthorization = String(new Headers(init?.headers).get('Authorization'));
    capturedBody = JSON.parse(String(init?.body));
    return Promise.resolve(new Response(JSON.stringify({
      data: [{ index: 0, embedding }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  };

  const result = await createECOSQuestionEmbedding(
    '  How thick is the new cement on the north lot?  ',
    'server-secret',
    fetchImplementation,
  );

  assertEquals(capturedUrl, 'https://api.openai.com/v1/embeddings');
  assertEquals(capturedAuthorization, 'Bearer server-secret');
  assertEquals(capturedBody, {
    model: ECOS_EMBEDDING_MODEL,
    input: 'How thick is the new cement on the north lot?',
    dimensions: ECOS_EMBEDDING_DIMENSIONS,
    encoding_format: 'float',
  });
  assertEquals(result.length, ECOS_EMBEDDING_DIMENSIONS);
});

Deno.test('semantic retrieval rejects malformed vectors and never pads them', () => {
  assertThrows(
    () => validateECOSQuestionEmbedding([0.1, 0.2]),
    ECOSEmbeddingError,
    'semantic_embedding_dimensions_invalid',
  );
  assertThrows(
    () => ecosVectorLiteral([...Array(ECOS_EMBEDDING_DIMENSIONS - 1).fill(0), Number.NaN]),
    ECOSEmbeddingError,
    'semantic_embedding_value_invalid',
  );
});

Deno.test('semantic retrieval fails closed when the provider rejects the request', async () => {
  await assertRejects(
    () => createECOSQuestionEmbedding('Where is the RFI?', 'server-secret', () =>
      Promise.resolve(new Response('{}', { status: 429 }))),
    ECOSEmbeddingError,
    'semantic_embedding_temporarily_unavailable',
  );
});

Deno.test('semantic retrieval embeds bounded natural-language variants in one request', async () => {
  let capturedBody: Record<string, unknown> = {};
  const vector = (seed: number) => Array.from(
    { length: ECOS_EMBEDDING_DIMENSIONS },
    (_, index) => seed + index / 100_000,
  );
  const result = await createECOSQuestionEmbeddings([
    'What is the thickness of the new cement on the north lot?',
    'What is the thickness of the new concrete on the north lot?',
    'north lot PCC paving thickness',
  ], 'server-secret', (_input, init) => {
    capturedBody = JSON.parse(String(init?.body));
    return Promise.resolve(new Response(JSON.stringify({
      data: [
        { index: 0, embedding: vector(0.01) },
        { index: 1, embedding: vector(0.02) },
        { index: 2, embedding: vector(0.03) },
      ],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  });

  assertEquals(capturedBody.input, [
    'What is the thickness of the new cement on the north lot?',
    'What is the thickness of the new concrete on the north lot?',
    'north lot PCC paving thickness',
  ]);
  assertEquals(result.length, 3);
  assertEquals(result[2]?.[0], 0.03);
});

Deno.test('semantic fusion promotes evidence found strongly by a construction-language variant', () => {
  const target = {
    document_id: 'civil',
    page_number: 6,
    region_id: 'construction-note-1',
    chunk_text: 'CONSTRUCT 6.0\" THICK PCC PAVING',
    rank: 0.43,
    metadata: { sheetMappingStatus: 'verified' },
  };
  const distractor = (variant: number, index: number, rank: number) => ({
    document_id: 'architectural',
    page_number: variant * 100 + index + 1,
    region_id: `region-${variant}-${index}`,
    chunk_text: `Generic concrete detail ${variant}-${index}`,
    rank,
    metadata: {},
  });
  const original = Array.from({ length: 35 }, (_, index) => distractor(0, index, 0.60 - index / 300));
  original.splice(18, 0, target);
  const concrete = Array.from({ length: 35 }, (_, index) => distractor(1, index, 0.61 - index / 300));
  concrete.splice(29, 0, { ...target, rank: 0.46 });
  const pcc = Array.from({ length: 35 }, (_, index) => distractor(2, index, 0.62 - index / 300));
  pcc.splice(2, 0, { ...target, rank: 0.61 });

  const fused = fuseECOSSemanticSearchResults([original, concrete, pcc]);
  const targetIndex = fused.findIndex(row => row.region_id === 'construction-note-1');
  assertEquals(targetIndex, 0);
  assertEquals((fused[0]?.metadata as Record<string, unknown>).semanticVariantHitCount, 3);
  assertEquals((fused[0]?.metadata as Record<string, unknown>).retrievalMode, 'semantic_multi_query');
});
