export const ECOS_EMBEDDING_MODEL = 'text-embedding-3-small' as const;
export const ECOS_EMBEDDING_DIMENSIONS = 1536 as const;
const EMBEDDING_ENDPOINT = 'https://api.openai.com/v1/embeddings';
const EMBEDDING_TIMEOUT_MS = 15_000;

export class ECOSEmbeddingError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'ECOSEmbeddingError';
    this.code = code;
  }
}

export async function createECOSQuestionEmbedding(
  question: string,
  apiKey: string,
  fetchImplementation: typeof fetch = fetch,
) {
  const normalizedQuestion = question.replace(/\s+/g, ' ').trim().slice(0, 1_000);
  if (normalizedQuestion.length < 3) throw new ECOSEmbeddingError('semantic_question_invalid');
  if (!apiKey.trim()) throw new ECOSEmbeddingError('semantic_embedding_service_not_configured');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EMBEDDING_TIMEOUT_MS);
  try {
    const response = await fetchImplementation(EMBEDDING_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: ECOS_EMBEDDING_MODEL,
        input: normalizedQuestion,
        dimensions: ECOS_EMBEDDING_DIMENSIONS,
        encoding_format: 'float',
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new ECOSEmbeddingError(
        response.status === 429 || response.status >= 500
          ? 'semantic_embedding_temporarily_unavailable'
          : 'semantic_embedding_request_rejected',
      );
    }
    const payload = await response.json().catch(() => null);
    const rows = isRecord(payload) && Array.isArray(payload.data) ? payload.data : [];
    const row = rows.length === 1 && isRecord(rows[0]) ? rows[0] : null;
    return validateECOSQuestionEmbedding(row?.embedding);
  } catch (error) {
    if (error instanceof ECOSEmbeddingError) throw error;
    throw new ECOSEmbeddingError(
      error instanceof DOMException && error.name === 'AbortError'
        ? 'semantic_embedding_timed_out'
        : 'semantic_embedding_transport_failed',
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function createECOSQuestionEmbeddings(
  questions: readonly string[],
  apiKey: string,
  fetchImplementation: typeof fetch = fetch,
) {
  const normalizedQuestions = [...new Set(questions.map(question =>
    question.replace(/\s+/g, ' ').trim().slice(0, 1_000)
  ))].filter(question => question.length >= 3).slice(0, 6);
  if (normalizedQuestions.length === 0) throw new ECOSEmbeddingError('semantic_question_invalid');
  if (!apiKey.trim()) throw new ECOSEmbeddingError('semantic_embedding_service_not_configured');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EMBEDDING_TIMEOUT_MS);
  try {
    const response = await fetchImplementation(EMBEDDING_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: ECOS_EMBEDDING_MODEL,
        input: normalizedQuestions,
        dimensions: ECOS_EMBEDDING_DIMENSIONS,
        encoding_format: 'float',
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new ECOSEmbeddingError(
        response.status === 429 || response.status >= 500
          ? 'semantic_embedding_temporarily_unavailable'
          : 'semantic_embedding_request_rejected',
      );
    }
    const payload = await response.json().catch(() => null);
    const rows = isRecord(payload) && Array.isArray(payload.data) ? payload.data : [];
    if (rows.length !== normalizedQuestions.length) {
      throw new ECOSEmbeddingError('semantic_embedding_count_invalid');
    }
    const ordered = rows.map(row => isRecord(row) ? row : {}).sort((left, right) =>
      Number(left.index) - Number(right.index)
    );
    if (ordered.some((row, index) => Number(row.index) !== index)) {
      throw new ECOSEmbeddingError('semantic_embedding_order_invalid');
    }
    return Object.freeze(ordered.map(row => validateECOSQuestionEmbedding(row.embedding)));
  } catch (error) {
    if (error instanceof ECOSEmbeddingError) throw error;
    throw new ECOSEmbeddingError(
      error instanceof DOMException && error.name === 'AbortError'
        ? 'semantic_embedding_timed_out'
        : 'semantic_embedding_transport_failed',
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function fuseECOSSemanticSearchResults(
  groups: readonly (readonly unknown[])[],
  maximumResults = 72,
): ReadonlyArray<Readonly<Record<string, unknown>>> {
  const candidates = new Map<string, {
    row: Record<string, unknown>;
    bestSimilarity: number;
    reciprocalRank: number;
    variantHits: Set<number>;
  }>();
  groups.forEach((group, variantIndex) => {
    group.forEach((value, resultIndex) => {
      const row = isRecord(value) ? value : {};
      const documentId = cleanIdentity(row.document_id);
      const pageNumber = strictPositiveInteger(row.page_number);
      const regionId = cleanIdentity(row.region_id);
      const chunkText = typeof row.chunk_text === 'string' ? row.chunk_text.trim() : '';
      if (!documentId || pageNumber == null || !chunkText) return;
      const key = [documentId, pageNumber, regionId, chunkText].join('\u001f');
      const similarity = Number(row.rank);
      const boundedSimilarity = Number.isFinite(similarity) ? Math.max(-1, Math.min(1, similarity)) : 0;
      const existing = candidates.get(key) || {
        row,
        bestSimilarity: boundedSimilarity,
        reciprocalRank: 0,
        variantHits: new Set<number>(),
      };
      existing.bestSimilarity = Math.max(existing.bestSimilarity, boundedSimilarity);
      existing.reciprocalRank += 1 / (60 + resultIndex + 1);
      existing.variantHits.add(variantIndex);
      if (boundedSimilarity >= Number(existing.row.rank || 0)) existing.row = row;
      candidates.set(key, existing);
    });
  });
  const maximum = Math.max(1, Math.min(200, Math.floor(maximumResults)));
  return Object.freeze([...candidates.entries()].map(([key, candidate]) => {
    const metadata = isRecord(candidate.row.metadata) ? candidate.row.metadata : {};
    const fusedRank = Math.min(1.5,
      candidate.bestSimilarity +
      Math.min(0.12, candidate.variantHits.size * 0.03) +
      Math.min(0.12, candidate.reciprocalRank * 3)
    );
    return {
      key,
      row: {
        ...candidate.row,
        rank: fusedRank,
        metadata: {
          ...metadata,
          retrievalMode: 'semantic_multi_query',
          semanticVariantHitCount: candidate.variantHits.size,
          semanticBestSimilarity: candidate.bestSimilarity,
          semanticReciprocalRankFusion: candidate.reciprocalRank,
        },
      },
      fusedRank,
    };
  }).sort((left, right) => right.fusedRank - left.fusedRank || left.key.localeCompare(right.key))
    .slice(0, maximum)
    .map(candidate => Object.freeze(candidate.row)));
}

export function validateECOSQuestionEmbedding(value: unknown) {
  if (!Array.isArray(value) || value.length !== ECOS_EMBEDDING_DIMENSIONS) {
    throw new ECOSEmbeddingError('semantic_embedding_dimensions_invalid');
  }
  const result = value.map(item => Number(item));
  if (result.some(item => !Number.isFinite(item))) {
    throw new ECOSEmbeddingError('semantic_embedding_value_invalid');
  }
  return Object.freeze(result);
}

export function ecosVectorLiteral(value: readonly number[]) {
  const validated = validateECOSQuestionEmbedding([...value]);
  return `[${validated.join(',')}]`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanIdentity(value: unknown) {
  return typeof value === 'string' ? value.trim().slice(0, 1_000) : '';
}

function strictPositiveInteger(value: unknown) {
  const candidate = Number(value);
  return Number.isSafeInteger(candidate) && candidate > 0 ? candidate : null;
}
