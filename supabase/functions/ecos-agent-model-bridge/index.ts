const MAX_REQUEST_BYTES = 768 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const PROVIDER_TIMEOUT_MS = 35_000;
const encoder = new TextEncoder();

const PROVIDERS = Object.freeze({
  openai: Object.freeze({
    url: "https://api.openai.com/v1/responses",
    models: new Set(["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"]),
    reasoningEfforts: new Set(["low", "medium", "high"]),
    acceptsResearchedMaxMessages: true,
    temperature: null,
  }),
  deepseek: Object.freeze({
    url: "https://api.deepseek.com/responses",
    models: new Set(["deepseek-v4-flash"]),
    // V4 Flash currently rejects required function-tool selection whenever
    // thinking is enabled. Ask ECOS must force a research tool before it can
    // answer, so this private bridge admits only the provider's non-thinking
    // mode for the entire stateless tool transcript.
    reasoningEfforts: new Set(["none"]),
    acceptsResearchedMaxMessages: false,
    temperature: 0,
  }),
});

type ProviderName = keyof typeof PROVIDERS;

type BridgeConfig = Readonly<{
  serviceRoleKey: string;
  workerToken: string;
  provider: ProviderName;
  providerKey: string;
  fetchImplementation?: typeof fetch;
}>;

/**
 * One private provider call per request. The multi-turn agent loop runs in
 * Cloud Run; this narrow bridge only keeps the provider credential inside the
 * existing Supabase secret boundary.
 */
export function createECOSAgentModelBridgeHandler(config: BridgeConfig) {
  validateSecret(config.serviceRoleKey);
  validateWorkerToken(config.workerToken);
  validateSecret(config.providerKey);
  const providerConfig = PROVIDERS[config.provider];
  if (!providerConfig) {
    throw new Error("private_agent_model_configuration_unavailable");
  }
  const fetchImplementation = config.fetchImplementation || fetch;
  return async (request: Request) => {
    const send = (body: unknown, status: number, extra?: HeadersInit) =>
      new Response(JSON.stringify(body), {
        status,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          ...Object.fromEntries(new Headers(extra)),
        },
      });
    if (request.method !== "POST") return reject(request, send, 405);
    if (request.headers.has("origin")) return reject(request, send, 403);
    if (
      !await constantTimeMatches(
        request.headers.get("authorization"),
        `Bearer ${config.serviceRoleKey}`,
      ) ||
      !await constantTimeMatches(
        request.headers.get("x-ecos-worker-token"),
        config.workerToken,
      )
    ) return reject(request, send, 403);
    const declaredBytes = Number(request.headers.get("content-length") || "0");
    if (Number.isFinite(declaredBytes) && declaredBytes > MAX_REQUEST_BYTES) {
      return reject(request, send, 413);
    }

    const controller = new AbortController();
    const stop = () => controller.abort();
    if (request.signal.aborted) controller.abort();
    else request.signal.addEventListener("abort", stop, { once: true });
    const timeout = setTimeout(stop, PROVIDER_TIMEOUT_MS);
    let phase = "read_request";
    try {
      const requestBytes = await readBoundedBody(
        request.body,
        MAX_REQUEST_BYTES,
        controller.signal,
      );
      phase = "parse_request";
      const payload = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(requestBytes),
      );
      validateProviderRequest(payload, providerConfig);
      phase = "provider_request";
      const providerPayload = providerConfig.temperature === null
        ? payload
        : { ...payload, temperature: providerConfig.temperature };
      const provider = await fetchImplementation(providerConfig.url, {
        method: "POST",
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${config.providerKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(providerPayload),
      });
      if (!provider.ok || provider.redirected) {
        const retryAfter = safeRetryAfter(provider.headers.get("retry-after"));
        logSafeProviderDiagnostic({
          event: "ecos_agent_model_bridge_provider_http_failure",
          phase,
          providerStatus: provider.status,
          redirected: provider.redirected,
        });
        cancelBody(provider.body);
        return send(
          { error: "agent_model_provider_unavailable" },
          provider.status === 429 ? 429 : 502,
          retryAfter == null
            ? undefined
            : { "Retry-After": String(retryAfter) },
        );
      }
      phase = "read_provider_response";
      const responseBytes = await readBoundedBody(
        provider.body,
        MAX_RESPONSE_BYTES,
        controller.signal,
      );
      phase = "parse_provider_response";
      const response = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(responseBytes),
      );
      phase = "validate_provider_response";
      try {
        validateProviderResponse(response, payload, providerConfig);
      } catch (error) {
        logSafeProviderDiagnostic({
          event: "ecos_agent_model_bridge_provider_response_rejected",
          phase,
          ...safeProviderResponseMetadata(response),
        });
        throw error;
      }
      if (
        providerConfig.acceptsResearchedMaxMessages &&
        isAcceptedMaxMessagesResponse(response, payload)
      ) {
        console.info(JSON.stringify({
          event: "ecos_agent_model_bridge_bounded_incomplete_accepted",
          phase,
          ...safeProviderResponseMetadata(response),
        }));
      }
      return send(response, 200);
    } catch (error) {
      logSafeProviderDiagnostic({
        event: "ecos_agent_model_bridge_failure",
        phase,
        failureCode: safeBridgeFailureCode(error, controller.signal.aborted),
      });
      return send(
        { error: "agent_model_provider_unavailable" },
        controller.signal.aborted ? 504 : 502,
      );
    } finally {
      clearTimeout(timeout);
      request.signal.removeEventListener("abort", stop);
      controller.abort();
    }
  };
}

function validateProviderRequest(
  value: unknown,
  providerConfig: typeof PROVIDERS[ProviderName],
) {
  if (!isRecord(value)) throw new Error("invalid_request");
  const expected = [
    "input",
    "instructions",
    "max_output_tokens",
    "model",
    "parallel_tool_calls",
    "reasoning",
    "store",
    "text",
    "tool_choice",
    "tools",
  ];
  if (Object.keys(value).sort().join(",") !== expected.join(",")) {
    throw new Error("invalid_request");
  }
  if (
    !providerConfig.models.has(String(value.model)) || value.store !== false ||
    value.parallel_tool_calls !== false ||
    !["auto", "required", "none"].includes(String(value.tool_choice)) ||
    !Number.isSafeInteger(value.max_output_tokens) ||
    Number(value.max_output_tokens) < 1 ||
    Number(value.max_output_tokens) > 6_000 ||
    typeof value.instructions !== "string" ||
    !value.instructions.trim() ||
    encoder.encode(value.instructions).length > 24 * 1024 ||
    !Array.isArray(value.input) || value.input.length < 1 ||
    value.input.length > 64 || !Array.isArray(value.tools) ||
    value.tools.length > 8
  ) throw new Error("invalid_request");
  const reasoning = isRecord(value.reasoning) ? value.reasoning : {};
  if (
    Object.keys(reasoning).join(",") !== "effort" ||
    !providerConfig.reasoningEfforts.has(String(reasoning.effort))
  ) throw new Error("invalid_request");
  for (const tool of value.tools) {
    if (!isRecord(tool) || tool.type !== "function") {
      throw new Error("invalid_request");
    }
    if (
      typeof tool.name !== "string" ||
      !/^[a-z][a-z0-9_]{2,63}$/.test(tool.name) ||
      typeof tool.description !== "string" ||
      encoder.encode(tool.description).length > 4 * 1024 ||
      tool.strict !== true || !isRecord(tool.parameters)
    ) throw new Error("invalid_request");
  }
  const text = isRecord(value.text) ? value.text : {};
  const format = isRecord(text.format) ? text.format : {};
  if (
    Object.keys(text).join(",") !== "format" ||
    format.type !== "json_schema" || format.strict !== true ||
    typeof format.name !== "string" ||
    !/^[a-zA-Z0-9_-]{1,64}$/.test(format.name) ||
    !isRecord(format.schema)
  ) throw new Error("invalid_request");
}

function validateProviderResponse(
  value: unknown,
  requestPayload: unknown,
  providerConfig: typeof PROVIDERS[ProviderName],
) {
  if (
    !isRecord(value) || value.error ||
    (value.status !== "completed" &&
      !(providerConfig.acceptsResearchedMaxMessages &&
        isAcceptedMaxMessagesResponse(value, requestPayload))) ||
    !Array.isArray(value.output) ||
    (value.usage !== undefined && !isRecord(value.usage))
  ) throw new Error("invalid_provider_response");
}

/**
 * The provider can stop after its internal message ceiling even though it has
 * already emitted one completed structured answer. Passing that exact bounded
 * shape onward is safe: the runtime still parses the strict JSON schema and
 * ECOS Assurance still verifies every factual claim and citation. Incomplete
 * reasoning, tool calls, truncated text, and all other stop reasons remain
 * rejected.
 */
function isAcceptedMaxMessagesResponse(
  value: unknown,
  requestPayload?: unknown,
) {
  if (!isRecord(value) || value.status !== "incomplete" || value.error) {
    return false;
  }
  const request = isRecord(requestPayload) ? requestPayload : {};
  if (
    request.tool_choice === "required" || !Array.isArray(request.input) ||
    !request.input.some((item) =>
      isRecord(item) && item.type === "function_call_output"
    )
  ) return false;
  const incomplete = isRecord(value.incomplete_details)
    ? value.incomplete_details
    : {};
  if (incomplete.reason !== "max_messages" || !Array.isArray(value.output)) {
    return false;
  }
  return value.output.some((item) => {
    if (
      !isRecord(item) || item.type !== "message" ||
      item.status !== "completed" || !Array.isArray(item.content)
    ) return false;
    return item.content.some((content) =>
      isRecord(content) && content.type === "output_text" &&
      typeof content.text === "string" && content.text.trim().length > 0 &&
      encoder.encode(content.text).byteLength <= MAX_RESPONSE_BYTES
    );
  });
}

function safeProviderResponseMetadata(value: unknown) {
  if (!isRecord(value)) {
    return { providerResponseShape: "non_object" };
  }
  const incomplete = isRecord(value.incomplete_details)
    ? value.incomplete_details
    : {};
  const output = Array.isArray(value.output) ? value.output : [];
  const outputTypes = [
    ...new Set(
      output.flatMap((item) =>
        isRecord(item) && typeof item.type === "string" &&
          /^[a-z][a-z0-9_]{0,63}$/.test(item.type)
          ? [item.type]
          : []
      ),
    ),
  ].slice(0, 8);
  return {
    providerResponseShape: "object",
    providerStatus: safeDiagnosticToken(value.status),
    incompleteReason: safeDiagnosticToken(incomplete.reason),
    hasProviderError: Boolean(value.error),
    outputCount: Math.min(output.length, 1_000),
    outputTypes,
    hasUsage: isRecord(value.usage),
    hasCompletedOutputText: hasCompletedOutputText(value),
  };
}

function hasCompletedOutputText(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.output)) return false;
  return value.output.some((item) => {
    if (
      !isRecord(item) || item.type !== "message" ||
      item.status !== "completed" || !Array.isArray(item.content)
    ) return false;
    return item.content.some((content) =>
      isRecord(content) && content.type === "output_text" &&
      typeof content.text === "string" && content.text.trim().length > 0 &&
      encoder.encode(content.text).byteLength <= MAX_RESPONSE_BYTES
    );
  });
}

function safeBridgeFailureCode(error: unknown, aborted: boolean) {
  if (aborted) return "timeout_or_caller_abort";
  if (error instanceof SyntaxError) return "invalid_json";
  const message = error instanceof Error ? error.message : "";
  return [
      "invalid_request",
      "invalid_provider_response",
      "missing_body",
      "body_too_large",
      "aborted",
    ].includes(message)
    ? message
    : "transport_or_internal_failure";
}

function safeDiagnosticToken(value: unknown) {
  return typeof value === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(value)
    ? value
    : null;
}

function logSafeProviderDiagnostic(value: Readonly<Record<string, unknown>>) {
  console.error(JSON.stringify(value));
}

async function readBoundedBody(
  body: ReadableStream<Uint8Array> | null,
  maximum: number,
  signal: AbortSignal,
) {
  if (!body) throw new Error("missing_body");
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      if (signal.aborted) throw new Error("aborted");
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maximum) throw new Error("body_too_large");
      chunks.push(next.value);
    }
  } finally {
    try {
      await reader.cancel();
    } catch { /* already closed */ }
    try {
      reader.releaseLock();
    } catch { /* already released */ }
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function constantTimeMatches(actual: string | null, expected: string) {
  if (actual === null || actual.length > 12_288) return false;
  const [left, right] = await Promise.all(
    [actual, expected].map((item) =>
      crypto.subtle.digest("SHA-256", encoder.encode(item))
    ),
  );
  const leftBytes = new Uint8Array(left);
  const rightBytes = new Uint8Array(right);
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}

function validateSecret(value: string) {
  if (
    typeof value !== "string" || !value.trim() ||
    value.length > 12_288 || /[\r\n]/.test(value)
  ) throw new Error("private_agent_model_configuration_unavailable");
}

function validateWorkerToken(value: string) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9_-]{32,256}$/.test(value)
  ) throw new Error("private_agent_model_configuration_unavailable");
}

function safeRetryAfter(value: string | null) {
  if (!value || !/^(?:0|[1-9][0-9]{0,5})$/.test(value)) return null;
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) && seconds <= 86_400 ? seconds : null;
}

function reject(
  request: Request,
  send: (body: unknown, status: number) => Response,
  status: number,
) {
  try {
    void request.body?.cancel().catch(() => {});
  } catch { /* bounded best effort */ }
  return send({ error: "agent_model_provider_unavailable" }, status);
}

function cancelBody(body: ReadableStream<Uint8Array> | null) {
  try {
    void body?.cancel().catch(() => {});
  } catch { /* bounded best effort */ }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

if (import.meta.main) {
  const required = (name: string) => {
    const value = Deno.env.get(name)?.trim();
    if (!value) {
      throw new Error("private_agent_model_configuration_unavailable");
    }
    return value;
  };
  Deno.serve(createECOSAgentModelBridgeHandler({
    serviceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
    workerToken: required("ECOS_SERVICE_WORKER_TOKEN"),
    provider: "openai",
    providerKey: Deno.env.get("ECOS_OPENAI_API_KEY")?.trim() ||
      required("PIE_OPENAI_API_KEY"),
  }));
}
