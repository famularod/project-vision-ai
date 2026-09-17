import { mintECOSCloudRunIdToken } from "../_shared/ecos-google-wif-token.ts";

const MAX_REQUEST_BYTES = 8 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const OWNER_AUTH_TIMEOUT_MS = 10_000;
const AGENT_REQUEST_TIMEOUT_MS = 125_000;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const LEGACY_QUESTION_SCHEMA = "ecos-project-question/1.0";
const CURRENT_QUESTION_SCHEMA = "ecos-project-question/2.0";
const BASE_HEADERS = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "600",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  Vary: "Origin",
};

type GatewayOptions = Readonly<{
  supabaseUrl: string;
  anonKey: string;
  betaOwnerId: string;
  agentRuntimeUrl: string;
  agentRuntimeGatewayToken: string;
  serviceWorkerToken: string;
  expectedPackageSha256: string;
  expectedModel: string;
  allowTerraAvailabilityBackup?: boolean;
  wifProviderResource: string;
  wifServiceAccount: string;
  serverlessAudience: string;
  classicFallbackUrl: string;
  allowedOrigins: readonly string[];
  fetchImpl?: typeof fetch;
  mintIdToken?: typeof mintECOSCloudRunIdToken;
}>;

type CustomerClientSurface = "web" | "iphone" | "ipad" | "android" | "unknown";

type PrivateOwnerAgentRequest = Readonly<{
  body: ArrayBuffer;
  clientRequestId: string;
  clientSurface: CustomerClientSurface;
  schemaVersion:
    | typeof LEGACY_QUESTION_SCHEMA
    | typeof CURRENT_QUESTION_SCHEMA;
  projectId: string;
  projectName: string;
  question: string;
}>;

type PrivateOwnerAgentBodyResult =
  | Readonly<{ request: PrivateOwnerAgentRequest; error: null }>
  | Readonly<{
    request: null;
    error: "protected_field_forbidden" | "client_contract_incompatible";
  }>;

export function createECOSAgentCustomerGatewayHandler(options: GatewayOptions) {
  const configuration = validateOptions(options);
  const fetchImpl = options.fetchImpl || fetch;
  const mintIdToken = options.mintIdToken || mintECOSCloudRunIdToken;

  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get("origin")?.trim() || "";
    const corsHeaders = responseHeaders(origin, configuration.allowedOrigins);
    if (request.method === "OPTIONS") {
      if (origin && !corsHeaders.has("Access-Control-Allow-Origin")) {
        return json({ error: "origin_not_allowed" }, 403, corsHeaders);
      }
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (request.method !== "POST") {
      return reject(request, { error: "method_not_allowed" }, 405, corsHeaders);
    }
    if (origin && !corsHeaders.has("Access-Control-Allow-Origin")) {
      return reject(request, { error: "origin_not_allowed" }, 403, corsHeaders);
    }

    const authorization = request.headers.get("authorization")?.trim() || "";
    const ownerAccessToken = /^Bearer\s+([^\s]+)$/i.exec(authorization)?.[1] ||
      "";
    if (!ownerAccessToken || ownerAccessToken.length > 16_384) {
      return reject(request, { error: "unauthorized" }, 401, corsHeaders);
    }
    const body = await boundedRequestBody(request);
    if (!body) {
      return json({ error: "request_too_large" }, 413, corsHeaders);
    }

    const authController = new AbortController();
    const authTimeout = setTimeout(
      () => authController.abort(),
      OWNER_AUTH_TIMEOUT_MS,
    );
    let authenticatedUserId = "";
    try {
      const authResponse = await fetchImpl(
        `${configuration.supabaseUrl}/auth/v1/user`,
        {
          method: "GET",
          headers: {
            apikey: configuration.anonKey,
            Authorization: authorization,
          },
          redirect: "error",
          signal: authController.signal,
        },
      );
      const authPayload = await boundedResponseJson(authResponse, 64 * 1024);
      authenticatedUserId = typeof authPayload?.id === "string"
        ? authPayload.id.trim().toLowerCase()
        : "";
      if (!authResponse.ok || !UUID.test(authenticatedUserId)) {
        return json({ error: "unauthorized" }, 401, corsHeaders);
      }
    } catch {
      return json({ error: "authentication_unavailable" }, 503, corsHeaders);
    } finally {
      clearTimeout(authTimeout);
    }

    if (authenticatedUserId !== configuration.betaOwnerId) {
      return await proxyClassic({
        request,
        body,
        authorization,
        configuration,
        fetchImpl,
        corsHeaders,
      });
    }

    const agentRequestResult = privateOwnerAgentBody(body, {
      legacyClientSurface: origin ? "web" : "unknown",
    });
    if (!agentRequestResult.request) {
      console.warn(JSON.stringify({
        event: "ecos_agent_customer_request_rejected",
        ...safeOwnerRequestShape(body),
        originClass: origin ? "allowed" : "missing",
        rejectionCode: agentRequestResult.error,
      }));
      return json(
        { error: agentRequestResult.error },
        agentRequestResult.error === "protected_field_forbidden" ? 403 : 400,
        corsHeaders,
      );
    }
    const agentRequest = agentRequestResult.request;

    const agentController = new AbortController();
    const agentTimeout = setTimeout(
      () => agentController.abort(),
      AGENT_REQUEST_TIMEOUT_MS,
    );
    const abortFromCaller = () => agentController.abort();
    if (request.signal.aborted) agentController.abort();
    else {request.signal.addEventListener("abort", abortFromCaller, {
        once: true,
      });}
    try {
      const serverlessToken = await mintIdToken({
        subjectToken: ownerAccessToken,
        providerResource: configuration.wifProviderResource,
        serviceAccountEmail: configuration.wifServiceAccount,
        serviceAudience: configuration.serverlessAudience,
        signal: agentController.signal,
        fetchImpl,
      });
      const agentResponse = await fetchImpl(
        `${configuration.agentRuntimeUrl}/question`,
        {
          method: "POST",
          headers: {
            apikey: configuration.anonKey,
            Authorization: authorization,
            "Content-Type": "application/json",
            "x-ecos-agent-gateway-token":
              configuration.agentRuntimeGatewayToken,
            "x-ecos-worker-token": configuration.serviceWorkerToken,
            "x-ecos-agent-route": "deepseek-owner-beta-v1",
            "x-serverless-authorization": `Bearer ${serverlessToken}`,
          },
          body: agentRequest.body,
          redirect: "error",
          signal: agentController.signal,
        },
      );
      const responseBytes = await boundedResponseBytes(agentResponse);
      const packageSha256 = agentResponse.headers.get(
        "x-ecos-agent-packaged-source-sha256",
      )?.trim().toLowerCase() || "";
      if (packageSha256 !== configuration.expectedPackageSha256) {
        return json(
          { error: "agent_runtime_identity_mismatch" },
          503,
          corsHeaders,
        );
      }
      if (agentResponse.ok) {
        const answer = parseJsonBytes(responseBytes);
        const routingValue = answer?.providerRouting;
        const routing = routingValue && typeof routingValue === "object" && !Array.isArray(routingValue)
          ? routingValue as Record<string, unknown> : null;
        const approvedBackup = configuration.allowTerraAvailabilityBackup === true &&
          answer?.model === "gpt-5.6-terra" && routing?.contract === "ecos-provider-failover/1.0" &&
          routing.primaryModel === configuration.expectedModel &&
          routing.servingModel === answer.model && routing.reason === "provider_unavailable";
        if (answer?.model !== configuration.expectedModel && !approvedBackup) {
          return json(
            { error: "agent_model_identity_mismatch" },
            503,
            corsHeaders,
          );
        }
        if (!customerAnswerIsCompatible(answer, agentRequest)) {
          return json(
            { error: "agent_customer_contract_mismatch" },
            503,
            corsHeaders,
          );
        }
      }
      const customerResponse = downstreamResponse(
        agentResponse,
        responseBytes,
        corsHeaders,
        {
          "x-ecos-agent-route": "deepseek-owner-beta-v1",
          "x-ecos-agent-packaged-source-sha256": packageSha256,
          "x-ecos-agent-client-surface": agentRequest.clientSurface,
        },
      );
      console.log(JSON.stringify({
        event: "ecos_agent_customer_gateway_response",
        clientRequestId: agentRequest.clientRequestId,
        clientSurface: agentRequest.clientSurface,
        downstreamStatus: agentResponse.status,
        packageMatched: true,
      }));
      return customerResponse;
    } catch (error) {
      const code = error instanceof Error && error.name === "AbortError"
        ? "agent_gateway_timed_out"
        : "agent_gateway_unavailable";
      return json(
        { error: code },
        code.endsWith("timed_out") ? 504 : 503,
        corsHeaders,
      );
    } finally {
      clearTimeout(agentTimeout);
      request.signal.removeEventListener("abort", abortFromCaller);
    }
  };
}

function privateOwnerAgentBody(
  body: Uint8Array,
  options: Readonly<{ legacyClientSurface: "web" | "unknown" }>,
): PrivateOwnerAgentBodyResult {
  const parsed = parseJsonBytes(body);
  if (!parsed) {
    return gatewayBodyError("client_contract_incompatible");
  }
  for (
    const reserved of [
      "validationMode",
      "evaluationModel",
      "evaluationAttemptId",
      "evaluationFixtureId",
    ]
  ) {
    if (Object.hasOwn(parsed, reserved)) {
      return gatewayBodyError("protected_field_forbidden");
    }
  }
  const suppliedClientRequestId = typeof parsed.clientRequestId === "string"
    ? parsed.clientRequestId.trim().toLowerCase()
    : "";
  const suppliedClientSurface = parsed.clientSurface === "web" ||
      parsed.clientSurface === "iphone" || parsed.clientSurface === "ipad" ||
      parsed.clientSurface === "android" || parsed.clientSurface === "unknown"
    ? parsed.clientSurface
    : null;
  const legacyRequest = parsed.schemaVersion === LEGACY_QUESTION_SCHEMA &&
    !Object.hasOwn(parsed, "clientRequestId") &&
    !Object.hasOwn(parsed, "clientSurface");
  const clientRequestId = legacyRequest
    ? crypto.randomUUID().toLowerCase()
    : suppliedClientRequestId;
  const clientSurface = legacyRequest
    ? options.legacyClientSurface
    : suppliedClientSurface;
  if (
    parsed.schemaVersion !== CURRENT_QUESTION_SCHEMA && !legacyRequest
  ) {
    return gatewayBodyError("client_contract_incompatible");
  }
  const projectId = requiredText(parsed.projectId);
  const projectName = requiredText(parsed.projectName);
  const question = requiredText(parsed.question);
  if (
    !UUID.test(clientRequestId) || !clientSurface || !projectId ||
    !projectName || !question
  ) {
    return gatewayBodyError("client_contract_incompatible");
  }
  const schemaVersion = legacyRequest
    ? LEGACY_QUESTION_SCHEMA
    : CURRENT_QUESTION_SCHEMA;
  return Object.freeze({
    request: Object.freeze({
      body: new TextEncoder().encode(JSON.stringify({
        ...parsed,
        clientRequestId,
        clientSurface,
        validationMode: "shadow",
      })).buffer,
      clientRequestId,
      clientSurface,
      schemaVersion,
      projectId,
      projectName,
      question,
    }),
    error: null,
  });
}

function gatewayBodyError(
  error: "protected_field_forbidden" | "client_contract_incompatible",
): PrivateOwnerAgentBodyResult {
  return Object.freeze({ request: null, error });
}

function customerAnswerIsCompatible(
  value: Record<string, unknown> | null,
  request: PrivateOwnerAgentRequest,
) {
  if (!value) return false;
  if (
    value.schemaVersion !== request.schemaVersion ||
    requiredText(value.projectId) !== request.projectId ||
    requiredText(value.projectName) !== request.projectName ||
    requiredText(value.question) !== request.question ||
    !requiredText(value.answer) ||
    !requiredText(value.generatedAt) ||
    !requiredText(value.model) ||
    !["high", "medium", "low"].includes(requiredText(value.confidence))
  ) return false;
  const assurance = recordValue(value.assurance);
  if (
    !["verified", "verified_with_limits", "insufficient_evidence"].includes(
      requiredText(assurance.status),
    ) ||
    !isNonnegativeInteger(assurance.checkedSourceCount) ||
    !isNonnegativeInteger(assurance.verifiedFactCount) ||
    !isNonnegativeInteger(assurance.rejectedFactCount) ||
    !requiredText(assurance.message)
  ) return false;
  if (
    !Array.isArray(value.facts) || !Array.isArray(value.limitations) ||
    !Array.isArray(value.conflicts) ||
    !Array.isArray(value.suggestedQuestions) ||
    !Array.isArray(value.supportingEvidence)
  ) return false;
  if (!value.facts.every(customerFactIsCompatible)) return false;
  if (
    !value.supportingEvidence.every((item) =>
      customerEvidenceIsCompatible(item, request.projectId)
    )
  ) return false;
  if (request.schemaVersion === CURRENT_QUESTION_SCHEMA) {
    const diagnostics = recordValue(value.diagnostics);
    if (
      diagnostics.schemaVersion !== "ecos-question-trace/1.0" ||
      !UUID.test(requiredText(diagnostics.traceId).toLowerCase()) ||
      requiredText(diagnostics.clientRequestId).toLowerCase() !==
        request.clientRequestId ||
      requiredText(diagnostics.clientSurface) !== request.clientSurface ||
      typeof diagnostics.replayed !== "boolean" ||
      typeof diagnostics.persisted !== "boolean"
    ) return false;
  }
  return true;
}

function customerFactIsCompatible(value: unknown) {
  const fact = recordValue(value);
  return Boolean(
    requiredText(fact.statement) &&
      ["fact", "inference", "recommendation"].includes(
        requiredText(fact.classification),
      ) &&
      Array.isArray(fact.sourceIds),
  );
}

function customerEvidenceIsCompatible(value: unknown, projectId: string) {
  const evidence = recordValue(value);
  const sourceType = requiredText(evidence.sourceType);
  const recordId = requiredText(evidence.recordId);
  if (
    !["project", "schedule", "update", "memory", "document"].includes(
      sourceType,
    ) || !recordId || !requiredText(evidence.summary)
  ) return false;
  if (sourceType !== "document") return true;
  const citation = recordValue(evidence.documentCitation);
  const documentId = requiredText(citation.documentId);
  const regionId = requiredText(citation.regionId);
  const region = recordValue(evidence.documentRegion);
  const hasRegion = Object.keys(region).length > 0;
  if (
    !documentId || recordId !== documentId ||
    requiredText(citation.projectId) !== projectId ||
    !normalizeSha256(citation.sourceSha256) ||
    !requiredText(citation.evidenceVersion) ||
    !requiredText(citation.documentName) ||
    !requiredText(citation.revision) ||
    !isPositiveInteger(citation.pageNumber) ||
    !requiredText(citation.label) ||
    Boolean(regionId) !== hasRegion
  ) return false;
  if (!regionId) return true;
  return requiredText(region.id) === regionId && normalizedBounds(region);
}

function safeOwnerRequestShape(body: Uint8Array) {
  const parsed = parseJsonBytes(body) || {};
  const surface = requiredText(parsed.clientSurface);
  return Object.freeze({
    schemaVersion: requiredText(parsed.schemaVersion) || "missing",
    clientRequestIdValid: UUID.test(
      requiredText(parsed.clientRequestId).toLowerCase(),
    ),
    clientSurface: ["web", "iphone", "ipad", "android", "unknown"].includes(
        surface,
      )
      ? surface
      : surface
      ? "unrecognized"
      : "missing",
    hasProjectId: Boolean(requiredText(parsed.projectId)),
    hasProjectName: Boolean(requiredText(parsed.projectName)),
    hasQuestion: Boolean(requiredText(parsed.question)),
    reservedFields: [
      "validationMode",
      "evaluationModel",
      "evaluationAttemptId",
      "evaluationFixtureId",
    ].filter((field) => Object.hasOwn(parsed, field)),
  });
}

async function proxyClassic({
  request,
  body,
  authorization,
  configuration,
  fetchImpl,
  corsHeaders,
}: Readonly<{
  request: Request;
  body: Uint8Array;
  authorization: string;
  configuration: ReturnType<typeof validateOptions>;
  fetchImpl: typeof fetch;
  corsHeaders: Headers;
}>) {
  try {
    const response = await fetchImpl(configuration.classicFallbackUrl, {
      method: "POST",
      headers: {
        apikey: configuration.anonKey,
        Authorization: authorization,
        "Content-Type": "application/json",
        ...(request.headers.get("origin")
          ? { Origin: request.headers.get("origin")! }
          : {}),
        ...(request.headers.get("x-client-info")
          ? { "x-client-info": request.headers.get("x-client-info")! }
          : {}),
      },
      body: exactArrayBuffer(body),
      redirect: "error",
      signal: request.signal,
    });
    const responseBytes = await boundedResponseBytes(response);
    return downstreamResponse(response, responseBytes, corsHeaders, {
      "x-ecos-agent-route": "classic-fallback-v1",
    });
  } catch {
    return json({ error: "classic_gateway_unavailable" }, 503, corsHeaders);
  }
}

function validateOptions(options: GatewayOptions) {
  const supabaseUrl = exactHttpsOrigin(options.supabaseUrl, "supabase_url");
  const agentRuntimeUrl = exactHttpsOrigin(
    options.agentRuntimeUrl,
    "agent_runtime_url",
  );
  const classicFallbackUrl = exactHttpsUrl(
    options.classicFallbackUrl,
    "classic_fallback_url",
  );
  const betaOwnerId = options.betaOwnerId.trim().toLowerCase();
  const expectedPackageSha256 = options.expectedPackageSha256.trim()
    .toLowerCase();
  const expectedModel = options.expectedModel.trim();
  if (!UUID.test(betaOwnerId)) throw new Error("beta_owner_id_invalid");
  if (!SHA256.test(expectedPackageSha256)) {
    throw new Error("expected_package_sha256_invalid");
  }
  if (expectedModel !== "deepseek-v4-flash") {
    throw new Error("expected_model_invalid");
  }
  if (!options.anonKey.trim()) throw new Error("anon_key_required");
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(options.agentRuntimeGatewayToken)) {
    throw new Error("agent_runtime_gateway_token_invalid");
  }
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(options.serviceWorkerToken)) {
    throw new Error("service_worker_token_invalid");
  }
  const allowedOrigins = [
    ...new Set(
      options.allowedOrigins.map((value) =>
        exactHttpsOrigin(value, "allowed_origin")
      ),
    ),
  ];
  if (allowedOrigins.length === 0) throw new Error("allowed_origins_required");
  return Object.freeze({
    ...options,
    supabaseUrl,
    agentRuntimeUrl,
    classicFallbackUrl,
    betaOwnerId,
    expectedPackageSha256,
    expectedModel,
    allowedOrigins,
  });
}

async function boundedRequestBody(request: Request) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) return null;
  try {
    const bytes = new Uint8Array(await request.arrayBuffer());
    return bytes.byteLength > 0 && bytes.byteLength <= MAX_REQUEST_BYTES
      ? bytes
      : null;
  } catch {
    return null;
  }
}

async function boundedResponseBytes(response: Response) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw new Error("downstream_response_too_large");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_RESPONSE_BYTES) {
    throw new Error("downstream_response_too_large");
  }
  return bytes;
}

async function boundedResponseJson(response: Response, maximumBytes: number) {
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maximumBytes) throw new Error("response_too_large");
  return parseJsonBytes(bytes);
}

function parseJsonBytes(bytes: Uint8Array): Record<string, unknown> | null {
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function requiredText(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function normalizeSha256(value: unknown) {
  const normalized = requiredText(value).toLowerCase();
  return SHA256.test(normalized) ? normalized : null;
}

function isPositiveInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonnegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function normalizedBounds(value: Record<string, unknown>) {
  const x = Number(value.x);
  const y = Number(value.y);
  const width = Number(value.width);
  const height = Number(value.height);
  return [x, y, width, height].every(Number.isFinite) &&
    x >= 0 && y >= 0 && width > 0 && height > 0 &&
    x + width <= 1 + Number.EPSILON &&
    y + height <= 1 + Number.EPSILON;
}

function downstreamResponse(
  response: Response,
  body: Uint8Array,
  corsHeaders: Headers,
  additions: Readonly<Record<string, string>>,
) {
  const headers = new Headers(corsHeaders);
  headers.set(
    "Content-Type",
    response.headers.get("content-type") || "application/json",
  );
  for (const [name, value] of Object.entries(additions)) {
    headers.set(name, value);
  }
  return new Response(exactArrayBuffer(body), {
    status: response.status,
    headers,
  });
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function responseHeaders(origin: string, allowedOrigins: readonly string[]) {
  const headers = new Headers(BASE_HEADERS);
  if (origin && allowedOrigins.includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return headers;
}

function json(value: unknown, status: number, headers: Headers) {
  const result = new Headers(headers);
  result.set("Content-Type", "application/json");
  return new Response(JSON.stringify(value), { status, headers: result });
}

function reject(
  request: Request,
  value: unknown,
  status: number,
  headers: Headers,
) {
  try {
    void request.body?.cancel().catch(() => {});
  } catch { /* bounded best effort */ }
  return json(value, status, headers);
}

function exactHttpsOrigin(value: string, name: string) {
  const normalized = value.trim().replace(/\/+$/, "");
  const url = new URL(normalized);
  if (url.protocol !== "https:" || url.origin !== normalized) {
    throw new Error(`${name}_invalid`);
  }
  return normalized;
}

function exactHttpsUrl(value: string, name: string) {
  const normalized = value.trim();
  const url = new URL(normalized);
  if (url.protocol !== "https:" || url.search || url.hash) {
    throw new Error(`${name}_invalid`);
  }
  return normalized;
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name)?.trim() || "";
  if (!value) throw new Error(`${name}_required`);
  return value;
}

// Server deployment binding only. It cannot be supplied by a customer request.
// Keeping the URL and package together in the deployed artifact makes rollback
// independent of mutable, project-wide Edge Function secrets.
export function serveECOSAgentCustomerGateway(deployment?: Readonly<{
  agentRuntimeUrl: string;
  expectedPackageSha256: string;
  allowTerraAvailabilityBackup?: boolean;
}>) {
  const handler = createECOSAgentCustomerGatewayHandler({
    supabaseUrl: requiredEnv("SUPABASE_URL"),
    anonKey: requiredEnv("SUPABASE_ANON_KEY"),
    betaOwnerId: requiredEnv("ECOS_AGENT_BETA_OWNER_ID"),
    agentRuntimeUrl: deployment?.agentRuntimeUrl ?? requiredEnv("ECOS_AGENT_RUNTIME_URL"),
    agentRuntimeGatewayToken: requiredEnv(
      "ECOS_AGENT_RUNTIME_GATEWAY_TOKEN",
    ),
    serviceWorkerToken: requiredEnv("ECOS_SERVICE_WORKER_TOKEN"),
    expectedPackageSha256: deployment?.expectedPackageSha256 ?? requiredEnv(
      "ECOS_AGENT_EXPECTED_PACKAGE_SHA256",
    ),
    expectedModel: requiredEnv("ECOS_AGENT_EXPECTED_MODEL"),
    allowTerraAvailabilityBackup: deployment?.allowTerraAvailabilityBackup === true,
    wifProviderResource: requiredEnv("ECOS_AGENT_WIF_PROVIDER_RESOURCE"),
    wifServiceAccount: requiredEnv("ECOS_AGENT_WIF_SERVICE_ACCOUNT"),
    serverlessAudience: requiredEnv("ECOS_AGENT_SERVERLESS_AUDIENCE"),
    classicFallbackUrl: requiredEnv("ECOS_AGENT_CLASSIC_FALLBACK_URL"),
    allowedOrigins: requiredEnv("ECOS_AGENT_ALLOWED_ORIGINS").split(","),
  });
  Deno.serve(handler);
}

if (import.meta.main) serveECOSAgentCustomerGateway();
