export const ECOS_EMBEDDING_MODEL = 'text-embedding-3-small' as const;
export const ECOS_EMBEDDING_DIMENSIONS = 1536 as const;
const EMBEDDING_ENDPOINT = 'https://api.openai.com/v1/embeddings';
const EMBEDDING_TIMEOUT_MS = 15_000;
const EMBEDDING_MAX_ATTEMPTS = 2;
const EMBEDDING_MAX_RETRY_DELAY_MS = 1_000;

export class ECOSEmbeddingError extends Error {
  readonly code: string;
  readonly status: number | null;
  readonly providerCode: string | null;
  readonly retryAfterSeconds: number | null;

  constructor(
    code: string,
    status: number | null = null,
    providerCode: string | null = null,
    retryAfterSeconds: number | null = null,
  ) {
    super(code);
    this.name = 'ECOSEmbeddingError';
    this.code = code;
    this.status = Number.isInteger(status) && Number(status) > 0
      ? Number(status)
      : null;
    this.providerCode = cleanProviderCode(providerCode);
    this.retryAfterSeconds = Number.isFinite(retryAfterSeconds) &&
        Number(retryAfterSeconds) >= 0
      ? Math.ceil(Number(retryAfterSeconds))
      : null;
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
    const response = await fetchEmbeddingWithRetry({
      apiKey,
      input: normalizedQuestion,
      signal: controller.signal,
      fetchImplementation,
    });
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
    const response = await fetchEmbeddingWithRetry({
      apiKey,
      input: normalizedQuestions,
      signal: controller.signal,
      fetchImplementation,
    });
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

async function fetchEmbeddingWithRetry(input: Readonly<{
  apiKey: string;
  input: string | readonly string[];
  signal: AbortSignal;
  fetchImplementation: typeof fetch;
}>) {
  for (let attempt = 1; attempt <= EMBEDDING_MAX_ATTEMPTS; attempt += 1) {
    const response = await input.fetchImplementation(EMBEDDING_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.apiKey.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: ECOS_EMBEDDING_MODEL,
        input: input.input,
        dimensions: ECOS_EMBEDDING_DIMENSIONS,
        encoding_format: 'float',
      }),
      signal: input.signal,
    });
    if (response.ok) return response;
    const providerFailure = await readProviderFailure(response);
    const transient = response.status === 429 || response.status >= 500;
    if (!transient || attempt >= EMBEDDING_MAX_ATTEMPTS) {
      throw new ECOSEmbeddingError(
        transient
          ? 'semantic_embedding_temporarily_unavailable'
          : 'semantic_embedding_request_rejected',
        response.status,
        providerFailure.providerCode,
        providerFailure.retryAfterSeconds,
      );
    }
    await response.body?.cancel().catch(() => undefined);
    await waitForEmbeddingRetry(
      providerFailure.retryAfterSeconds,
      input.signal,
    );
  }
  throw new ECOSEmbeddingError('semantic_embedding_temporarily_unavailable');
}

async function waitForEmbeddingRetry(
  retryAfterSeconds: number | null,
  signal: AbortSignal,
) {
  const delayMs = retryAfterSeconds == null
    ? 0
    : Math.min(
      EMBEDDING_MAX_RETRY_DELAY_MS,
      Math.max(0, retryAfterSeconds * 1_000),
  );
  if (delayMs <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal.removeEventListener('abort', abort);
      resolve();
    };
    const timer = setTimeout(finish, delayMs);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

async function readProviderFailure(response: Response) {
  const payload = await response.json().catch(() => null);
  const error = isRecord(payload) && isRecord(payload.error) ? payload.error : {};
  const retryAfterHeader = response.headers.get('retry-after');
  const retryAfter = retryAfterHeader == null ? Number.NaN : Number(retryAfterHeader);
  return {
    providerCode: cleanProviderCode(error.code) || cleanProviderCode(error.type),
    retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter >= 0
      ? Math.ceil(retryAfter)
      : null,
  };
}

function cleanProviderCode(value: unknown) {
  const cleaned = typeof value === 'string'
    ? value.trim().toLowerCase().slice(0, 80)
    : '';
  return cleaned && /^[a-z0-9._-]+$/.test(cleaned) ? cleaned : null;
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
