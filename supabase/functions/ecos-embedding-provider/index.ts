const PROVIDER_URL = 'https://api.openai.com/v1/embeddings';
const MODEL = 'text-embedding-3-small';
const DIMENSIONS = 1536;
const MAX_REQUEST_BYTES = 512 * 1024;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_INPUTS = 64;
const MAX_INPUT_CHARACTERS = 6_000;
const encoder = new TextEncoder();

type BridgeConfig = Readonly<{
  serviceRoleKey: string;
  workerToken: string;
  openAIKey: string;
  fetchImplementation?: typeof fetch;
}>;

export function createECOSEmbeddingProviderHandler(config: BridgeConfig) {
  validateSecret(config.serviceRoleKey);
  validateSecret(config.workerToken);
  validateSecret(config.openAIKey);
  const fetchImplementation = config.fetchImplementation || fetch;
  return async (request: Request) => {
    const send = (body: unknown, status: number) => new Response(JSON.stringify(body), {
      status,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
    if (request.method !== 'POST') return rejectRequest(request, send, 405);
    if (request.headers.has('origin')) return rejectRequest(request, send, 403);
    if (
      !await constantTimeMatches(request.headers.get('authorization'), `Bearer ${config.serviceRoleKey}`) ||
      !await constantTimeMatches(request.headers.get('x-ecos-worker-token'), config.workerToken)
    ) return rejectRequest(request, send, 403);
    const declaredBytes = Number(request.headers.get('content-length') || '0');
    if (Number.isFinite(declaredBytes) && declaredBytes > MAX_REQUEST_BYTES) {
      return rejectRequest(request, send, 413);
    }
    const controller = new AbortController();
    const stop = () => controller.abort();
    request.signal.addEventListener('abort', stop, { once: true });
    const timeout = setTimeout(stop, 90_000);
    try {
      const requestBytes = await readBoundedBody(request.body, MAX_REQUEST_BYTES, controller.signal);
      const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(requestBytes));
      const input = validateRequest(parsed);
      const provider = await fetchImplementation(PROVIDER_URL, {
        method: 'POST',
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${config.openAIKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: MODEL,
          input,
          dimensions: DIMENSIONS,
          encoding_format: 'float',
        }),
      });
      if (!provider.ok || provider.redirected) {
        cancelBody(provider.body);
        return send({ error: 'embedding_provider_unavailable' }, 502);
      }
      const responseBytes = await readBoundedBody(provider.body, MAX_RESPONSE_BYTES, controller.signal);
      const response = validateProviderResponse(
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(responseBytes)),
        input.length,
      );
      return send({ data: response }, 200);
    } catch {
      return send({ error: 'embedding_provider_unavailable' }, 502);
    } finally {
      clearTimeout(timeout);
      request.signal.removeEventListener('abort', stop);
      controller.abort();
    }
  };
}

function validateRequest(value: unknown) {
  if (!isRecord(value)) throw new Error('invalid_request');
  if (Object.keys(value).sort().join(',') !== 'dimensions,encoding_format,input,model') {
    throw new Error('invalid_request');
  }
  if (
    value.model !== MODEL || value.dimensions !== DIMENSIONS || value.encoding_format !== 'float' ||
    !Array.isArray(value.input) || value.input.length < 1 || value.input.length > MAX_INPUTS
  ) throw new Error('invalid_request');
  const inputs = value.input.map(item => {
    if (typeof item !== 'string') throw new Error('invalid_request');
    const normalized = item.trim();
    if (!normalized || normalized.length > MAX_INPUT_CHARACTERS) throw new Error('invalid_request');
    return normalized;
  });
  if (encoder.encode(JSON.stringify(inputs)).length > 384 * 1024) throw new Error('invalid_request');
  return inputs;
}

function validateProviderResponse(value: unknown, expected: number) {
  if (!isRecord(value) || !Array.isArray(value.data) || value.data.length !== expected) {
    throw new Error('invalid_provider_response');
  }
  const rows = value.data.map(row => {
    if (!isRecord(row) || !Number.isSafeInteger(row.index) || !Array.isArray(row.embedding)) {
      throw new Error('invalid_provider_response');
    }
    if (row.index as number < 0 || row.index as number >= expected || row.embedding.length !== DIMENSIONS) {
      throw new Error('invalid_provider_response');
    }
    const embedding = row.embedding.map(item => Number(item));
    const norm = embedding.reduce((sum, item) => sum + item * item, 0);
    if (embedding.some(item => !Number.isFinite(item) || Math.abs(item) > 10) || !Number.isFinite(norm) || norm <= 0) {
      throw new Error('invalid_provider_response');
    }
    return { index: row.index as number, embedding };
  }).sort((left, right) => left.index - right.index);
  if (rows.some((row, index) => row.index !== index)) throw new Error('invalid_provider_response');
  return rows;
}

async function readBoundedBody(
  body: ReadableStream<Uint8Array> | null,
  maximum: number,
  signal: AbortSignal,
) {
  if (!body) throw new Error('missing_body');
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      if (signal.aborted) throw new Error('aborted');
      const next = await reader.read();
      if (next.done) break;
      total += next.value.length;
      if (total > maximum) throw new Error('body_too_large');
      chunks.push(next.value);
    }
  } finally {
    try { await reader.cancel(); } catch { /* already closed */ }
    try { reader.releaseLock(); } catch { /* already released */ }
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

async function constantTimeMatches(actual: string | null, expected: string) {
  if (actual === null || actual.length > 10_000) return false;
  const [leftHash, rightHash] = await Promise.all([actual, expected].map(value =>
    crypto.subtle.digest('SHA-256', encoder.encode(value))
  ));
  const left = new Uint8Array(leftHash);
  const right = new Uint8Array(rightHash);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function validateSecret(value: string) {
  if (typeof value !== 'string' || !value.trim() || value.length > 12_288) {
    throw new Error('private_embedding_configuration_unavailable');
  }
}

function rejectRequest(
  request: Request,
  send: (body: unknown, status: number) => Response,
  status: number,
) {
  try { void request.body?.cancel().catch(() => {}); } catch { /* bounded */ }
  return send({ error: 'embedding_provider_unavailable' }, status);
}

function cancelBody(body: ReadableStream<Uint8Array> | null) {
  try { void body?.cancel().catch(() => {}); } catch { /* bounded */ }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

if (import.meta.main) {
  const required = (name: string) => {
    const value = Deno.env.get(name)?.trim();
    if (!value) throw new Error('private_embedding_configuration_unavailable');
    return value;
  };
  Deno.serve(createECOSEmbeddingProviderHandler({
    serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
    workerToken: required('ECOS_SERVICE_WORKER_TOKEN'),
    openAIKey: Deno.env.get('ECOS_OPENAI_API_KEY')?.trim() || required('PIE_OPENAI_API_KEY'),
  }));
}
