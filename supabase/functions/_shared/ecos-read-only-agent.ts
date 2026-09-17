import { parseECOSStructuredObjectText } from "./ecos-structured-provider-output.ts";

export const ECOS_READ_ONLY_AGENT_CONTRACT = "ecos-read-only-agent/1.0";

export type ECOSAgentProgressStage =
  | "planning"
  | "searching"
  | "reading"
  | "comparing"
  | "composing";

export type ECOSAgentToolContext = Readonly<{
  signal: AbortSignal;
}>;

export type ECOSAgentTool = Readonly<{
  name: string;
  description: string;
  inputSchema: Readonly<Record<string, unknown>>;
  progressStage: ECOSAgentProgressStage;
  providesEvidence: boolean;
  qualifiesAsEvidence?: (value: unknown) => boolean;
  execute: (
    input: Readonly<Record<string, unknown>>,
    context: ECOSAgentToolContext,
  ) => unknown | Promise<unknown>;
}>;

export type ECOSAgentToolCall = Readonly<{
  callId: string;
  name: string;
  argumentsJson: string;
}>;

export type ECOSAgentModelTurn = Readonly<{
  reportedModel?: string;
  outputItems: readonly Readonly<Record<string, unknown>>[];
  toolCalls: readonly ECOSAgentToolCall[];
  outputText: string | null;
  usage: Readonly<Record<string, unknown>> | null;
}>;

export type ECOSAgentModelRequest = Readonly<{
  instructions: string;
  inputItems: readonly unknown[];
  tools: readonly Pick<ECOSAgentTool, "name" | "description" | "inputSchema">[];
  toolChoice: "auto" | "required" | "none";
  outputSchemaName: string;
  outputSchema: Readonly<Record<string, unknown>>;
  maxOutputTokens: number;
  signal: AbortSignal;
}>;

export type ECOSAgentModelGateway = Readonly<{
  complete: (request: ECOSAgentModelRequest) => Promise<ECOSAgentModelTurn>;
}>;

export type ECOSAgentToolTrace = Readonly<{
  callId: string;
  name: string;
  status: "completed" | "rejected" | "failed" | "cached";
  elapsedMs: number;
  outputBytes: number;
  outputSha256: string;
  errorCode?: string;
}>;

export type ECOSAgentUsage = Readonly<{
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
}>;

export type ECOSAgentRunResult = Readonly<{
  contract: typeof ECOS_READ_ONLY_AGENT_CONTRACT;
  status: "completed" | "failed";
  outputText: string | null;
  errorCode: string | null;
  modelTurns: number;
  toolCalls: number;
  successfulResearchCalls: number;
  elapsedMs: number;
  usage: ECOSAgentUsage;
  trace: readonly ECOSAgentToolTrace[];
}>;

export type ECOSAgentRunInput = Readonly<{
  gateway: ECOSAgentModelGateway;
  instructions: string;
  inputItems: readonly unknown[];
  tools: readonly ECOSAgentTool[];
  // Trusted server orchestration only. Executed through the same registry,
  // deadline, output cap, evidence qualification, trace and tool-call budget.
  initialResearchCall?: Readonly<{ name: string; arguments: Readonly<Record<string, unknown>> }>;
  outputSchemaName: string;
  outputSchema: Readonly<Record<string, unknown>>;
  validateOutputText?: (value: string) => boolean;
  limits?: Readonly<{
    maxModelTurns?: number;
    maxToolCalls?: number;
    maxElapsedMs?: number;
    maxToolElapsedMs?: number;
    maxToolOutputBytes?: number;
    maxOutputTokens?: number;
  }>;
  signal?: AbortSignal;
  onProgress?: (
    event: Readonly<{
      stage: ECOSAgentProgressStage;
      modelTurns: number;
      toolCalls: number;
    }>,
  ) => void;
}>;

type NormalizedLimits = Readonly<{
  maxModelTurns: number;
  maxToolCalls: number;
  maxElapsedMs: number;
  maxToolElapsedMs: number;
  maxToolOutputBytes: number;
  maxOutputTokens: number;
}>;

const DEFAULT_LIMITS: NormalizedLimits = Object.freeze({
  maxModelTurns: 5,
  maxToolCalls: 8,
  maxElapsedMs: 75_000,
  maxToolElapsedMs: 15_000,
  maxToolOutputBytes: 48_000,
  maxOutputTokens: 2_400,
});

const TRANSIENT_PROVIDER_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_PROVIDER_ATTEMPTS = 2;
const MAX_PROVIDER_RETRY_DELAY_MS = 1_000;
const MAX_STRUCTURED_OUTPUT_REPAIR_ATTEMPTS = 2;

export async function runECOSReadOnlyAgent(
  input: ECOSAgentRunInput,
): Promise<ECOSAgentRunResult> {
  const startedAt = Date.now();
  const limits = normalizeLimits(input.limits);
  const tools = new Map(input.tools.map((tool) => [tool.name, tool]));
  if (
    tools.size !== input.tools.length ||
    [...tools.keys()].some((name) => !/^[a-z][a-z0-9_]{2,63}$/.test(name))
  ) {
    return failedResult("agent_tool_registry_invalid", startedAt, 0, 0, 0, []);
  }

  const transcript: unknown[] = [...input.inputItems];
  const trace: ECOSAgentToolTrace[] = [];
  const cache = new Map<
    string,
    Readonly<{ output: string; qualifiesAsEvidence: boolean }>
  >();
  let modelTurns = 0;
  let toolCalls = 0;
  let successfulResearchCalls = 0;
  let researchReminderUsed = false;
  let structuredOutputRepairAttempts = 0;
  let usage = emptyUsage();
  let initialResearchPending = Boolean(input.initialResearchCall);
  const structuredOutputRepairReserved = Boolean(input.validateOutputText) &&
    limits.maxModelTurns >= 2;

  while (modelTurns < limits.maxModelTurns) {
    const remainingMs = limits.maxElapsedMs - (Date.now() - startedAt);
    if (remainingMs <= 0 || input.signal?.aborted) {
      return failedResult(
        input.signal?.aborted ? "agent_cancelled" : "agent_deadline_exceeded",
        startedAt,
        modelTurns,
        toolCalls,
        successfulResearchCalls,
        trace,
        usage,
      );
    }

    const initialResearchTurn = initialResearchPending;
    initialResearchPending = false;
    const finalizationTurn = !initialResearchTurn && modelTurns === limits.maxModelTurns - 1 -
        (structuredOutputRepairReserved ? 1 : 0);
    const structuredOutputRepairTurn = structuredOutputRepairAttempts > 0;
    input.onProgress?.({
      stage: finalizationTurn || structuredOutputRepairTurn
        ? "composing"
        : "planning",
      modelTurns,
      toolCalls,
    });
    let turn: ECOSAgentModelTurn;
    try {
      if (initialResearchTurn && input.initialResearchCall) {
        const callId = "server-initial-research";
        const name = input.initialResearchCall.name;
        const argumentsJson = JSON.stringify(input.initialResearchCall.arguments);
        turn = {outputItems:[{type:"function_call",call_id:callId,name,arguments:argumentsJson}],
          toolCalls:[{callId,name,argumentsJson}],outputText:null,usage:null};
      } else turn = await runWithDeadline(
        (signal) =>
          input.gateway.complete({
            instructions: structuredOutputRepairTurn
              ? `${input.instructions} Research is complete. Your previous answer was not valid JSON matching the required output schema. Do not call tools. Return exactly one JSON object matching that schema, using only the evidence already opened.`
              : finalizationTurn
              ? `${input.instructions} Research is now complete. Do not call any more tools. Return the required structured answer using only the evidence already opened, or clearly state that the evidence is insufficient.`
              : researchReminderUsed && successfulResearchCalls === 0
              ? `${input.instructions} Your previous response did not use an authorized project research tool. Do not answer from memory or from the question alone. Call at least one available evidence-providing research tool before composing an answer.`
              : input.instructions,
            inputItems: transcript,
            tools: finalizationTurn || structuredOutputRepairTurn
              ? []
              : input.tools.map(({ name, description, inputSchema }) => ({
                name,
                description,
                inputSchema,
              })),
            toolChoice: finalizationTurn || structuredOutputRepairTurn
              ? "none"
              : successfulResearchCalls === 0
              ? "required"
              : "auto",
            outputSchemaName: input.outputSchemaName,
            outputSchema: input.outputSchema,
            maxOutputTokens: limits.maxOutputTokens,
            signal,
          }),
        Math.min(remainingMs, 50_000),
        input.signal,
      );
    } catch (error) {
      return failedResult(
        deadlineErrorCode(error, "agent_provider_failed"),
        startedAt,
        modelTurns,
        toolCalls,
        successfulResearchCalls,
        trace,
        usage,
      );
    }
    if (!initialResearchTurn) modelTurns += 1;
    usage = mergeUsage(usage, turn.usage);

    if (turn.toolCalls.length === 0) {
      if (!turn.outputText) {
        const repairAvailable = successfulResearchCalls > 0 &&
          structuredOutputRepairAttempts <
            MAX_STRUCTURED_OUTPUT_REPAIR_ATTEMPTS &&
          modelTurns < limits.maxModelTurns &&
          (!finalizationTurn || structuredOutputRepairReserved);
        console.info(JSON.stringify({
          event: "ecos_read_only_agent_output_invalid",
          errorCode: "agent_provider_output_invalid",
          modelTurns,
          repairAvailable,
          repairAttempts: structuredOutputRepairAttempts,
        }));
        if (repairAvailable) {
          transcript.push(...turn.outputItems);
          structuredOutputRepairAttempts += 1;
          continue;
        }
        return failedResult(
          "agent_provider_output_invalid",
          startedAt,
          modelTurns,
          toolCalls,
          successfulResearchCalls,
          trace,
          usage,
        );
      }
      if (successfulResearchCalls === 0) {
        if (!finalizationTurn && !researchReminderUsed) {
          researchReminderUsed = true;
          continue;
        }
        return failedResult(
          trace.some((entry) => entry.status === "failed") ? "agent_research_unavailable" : "agent_research_required",
          startedAt,
          modelTurns,
          toolCalls,
          successfulResearchCalls,
          trace,
          usage,
        );
      }
      const structuredOutput = parseECOSStructuredObjectText(turn.outputText);
      const structuredOutputValid = structuredOutput.failureReason === null &&
        validateStructuredOutput(
          structuredOutput.normalizedText,
          input.validateOutputText,
        );
      if (!structuredOutputValid) {
        const outputErrorCode = structuredOutput.failureReason === null
          ? "agent_output_schema_invalid"
          : "agent_output_json_invalid";
        const repairAvailable = structuredOutputRepairAttempts <
            MAX_STRUCTURED_OUTPUT_REPAIR_ATTEMPTS &&
          modelTurns < limits.maxModelTurns &&
          (!finalizationTurn || structuredOutputRepairReserved);
        console.info(JSON.stringify({
          event: "ecos_read_only_agent_output_invalid",
          errorCode: outputErrorCode,
          modelTurns,
          repairAvailable,
          repairAttempts: structuredOutputRepairAttempts,
        }));
        if (repairAvailable) {
          transcript.push(...turn.outputItems);
          structuredOutputRepairAttempts += 1;
          continue;
        }
        return failedResult(
          outputErrorCode,
          startedAt,
          modelTurns,
          toolCalls,
          successfulResearchCalls,
          trace,
          usage,
        );
      }
      input.onProgress?.({ stage: "composing", modelTurns, toolCalls });
      return Object.freeze({
        contract: ECOS_READ_ONLY_AGENT_CONTRACT,
        status: "completed",
        outputText: structuredOutput.normalizedText,
        errorCode: null,
        modelTurns,
        toolCalls,
        successfulResearchCalls,
        elapsedMs: Math.max(0, Date.now() - startedAt),
        usage,
        trace: Object.freeze([...trace]),
      });
    }

    if (finalizationTurn || structuredOutputRepairTurn) {
      return failedResult(
        "agent_provider_output_invalid",
        startedAt,
        modelTurns,
        toolCalls,
        successfulResearchCalls,
        trace,
        usage,
      );
    }

    transcript.push(...turn.outputItems);
    for (const call of turn.toolCalls) {
      if (toolCalls >= limits.maxToolCalls) {
        return failedResult(
          "agent_tool_call_limit_reached",
          startedAt,
          modelTurns,
          toolCalls,
          successfulResearchCalls,
          trace,
          usage,
        );
      }
      toolCalls += 1;
      const toolStartedAt = Date.now();
      const tool = tools.get(call.name);
      let status: ECOSAgentToolTrace["status"] = "rejected";
      let toolErrorCode: string | undefined;
      let output = JSON.stringify({ ok: false, error: "tool_not_allowed" });
      const parsed = parseToolArguments(call.argumentsJson);

      if (tool && parsed) {
        input.onProgress?.({
          stage: tool.progressStage,
          modelTurns,
          toolCalls,
        });
        const cacheKey = `${tool.name}:${stableStringify(parsed)}`;
        const cached = cache.get(cacheKey);
        if (cached) {
          output = cached.output;
          status = "cached";
          if (cached.qualifiesAsEvidence) successfulResearchCalls += 1;
        } else {
          try {
            const toolRemainingMs = limits.maxElapsedMs -
              (Date.now() - startedAt);
            if (toolRemainingMs <= 0) throw new DeadlineError();
            const value = await runWithDeadline(
              (signal) => Promise.resolve(tool.execute(parsed, { signal })),
              Math.min(limits.maxToolElapsedMs, toolRemainingMs),
              input.signal,
            );
            const bounded = boundedToolOutput(
              value,
              limits.maxToolOutputBytes,
            );
            output = bounded.output;
            if (bounded.accepted) {
              const qualifiesAsEvidence = tool.providesEvidence &&
                (tool.qualifiesAsEvidence?.(value) ?? true);
              cache.set(cacheKey, { output, qualifiesAsEvidence });
              status = "completed";
              if (qualifiesAsEvidence) successfulResearchCalls += 1;
            } else {
              status = "failed";
            }
          } catch (error) {
            status = "failed";
            toolErrorCode = researchToolErrorCode(error);
            output = JSON.stringify({
              ok: false,
              error: toolErrorCode,
            });
          }
        }
      }

      const outputBytes = new TextEncoder().encode(output).byteLength;
      const outputSha256 = await sha256Text(output);
      trace.push(Object.freeze({
        callId: cleanIdentifier(call.callId, 120),
        name: cleanIdentifier(call.name, 64),
        status,
        elapsedMs: Math.max(0, Date.now() - toolStartedAt),
        outputBytes,
        outputSha256,
        ...(toolErrorCode ? {errorCode: toolErrorCode} : {}),
      }));
      transcript.push({
        type: "function_call_output",
        call_id: call.callId,
        output,
      });
    }
  }

  return failedResult(
    "agent_model_turn_limit_reached",
    startedAt,
    modelTurns,
    toolCalls,
    successfulResearchCalls,
    trace,
    usage,
  );
}

export function createOpenAIResponsesAgentGateway(
  input: Readonly<{
    apiKey: string;
    model: string;
    reasoningEffort?: "none" | "low" | "medium" | "high" | "max";
    endpoint?: string;
    fetchImpl?: typeof fetch;
    maxAttempts?: 1 | 2;
    requireReportedModel?: boolean;
    requireFailureClassification?: boolean;
  }>,
): ECOSAgentModelGateway {
  const apiKey = input.apiKey.trim();
  const model = input.model.trim();
  if (!apiKey || !model) {
    throw new Error("agent_provider_configuration_invalid");
  }
  const fetchImpl = input.fetchImpl || fetch;
  const endpoint = input.endpoint || "https://api.openai.com/v1/responses";

  return Object.freeze({
    complete: async (request: ECOSAgentModelRequest) => {
      const requestInit: RequestInit = {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          store: false,
          reasoning: { effort: input.reasoningEffort || "medium" },
          max_output_tokens: request.maxOutputTokens,
          parallel_tool_calls: false,
          tool_choice: request.toolChoice,
          instructions: request.instructions,
          input: request.inputItems,
          tools: request.tools.map((tool) => ({
            type: "function",
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
            strict: true,
          })),
          text: {
            format: {
              type: "json_schema",
              name: request.outputSchemaName,
              strict: true,
              schema: request.outputSchema,
            },
          },
        }),
        signal: request.signal,
      };
      let response: Response | null = null;
      const maxAttempts = input.maxAttempts ?? MAX_PROVIDER_ATTEMPTS;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        response = await fetchImpl(endpoint, requestInit);
        if (response.ok) break;
        // Only the authenticated bridge can classify a provider outage. Its
        // generic 502 can also mean invalid output, configuration or auth.
        const failureClass = response.headers.get("x-ecos-provider-failure");
        if ((input.requireFailureClassification || failureClass) && failureClass !== "availability") {
          await response.body?.cancel().catch(() => undefined);
          throw new Error("agent_provider_output_or_configuration_invalid");
        }
        if (
          attempt >= maxAttempts ||
          !TRANSIENT_PROVIDER_STATUSES.has(response.status)
        ) {
          await response.body?.cancel().catch(() => undefined);
          throw new Error(`agent_provider_http_${response.status}`);
        }
        await response.body?.cancel().catch(() => undefined);
        await waitForProviderRetry(response.headers, request.signal);
      }
      if (!response?.ok) throw new Error("agent_provider_failed");
      const body: unknown = await response.json();
      if (!isRecord(body) || !Array.isArray(body.output)) {
        throw new Error("agent_provider_output_invalid");
      }
      if (input.requireReportedModel && body.model !== model &&
        !(model === "deepseek-v4-flash" &&
          ["deepseek-flash", "deepseek-v4.1-flash"].includes(String(body.model)))) {
        throw new Error("agent_provider_model_identity_invalid");
      }
      const outputItems = body.output.filter(isRecord);
      const toolCalls = outputItems.flatMap((item) => {
        if (
          item.type !== "function_call" || typeof item.call_id !== "string" ||
          typeof item.name !== "string"
        ) return [];
        const argumentsJson = typeof item.arguments === "string"
          ? item.arguments
          : JSON.stringify(item.arguments || {});
        return [{
          callId: item.call_id,
          name: item.name,
          argumentsJson,
        }];
      });
      return Object.freeze({
        reportedModel: typeof body.model === "string" ? body.model : undefined,
        outputItems: Object.freeze(outputItems),
        toolCalls: Object.freeze(toolCalls),
        outputText: extractOutputText(outputItems) || null,
        usage: isRecord(body.usage) ? body.usage : null,
      });
    },
  });
}

async function waitForProviderRetry(
  headers: Headers,
  signal: AbortSignal,
) {
  const retryAfter = headers.get("retry-after");
  const seconds = retryAfter == null ? Number.NaN : Number(retryAfter);
  const delayMs = Number.isFinite(seconds) && seconds >= 0
    ? Math.min(MAX_PROVIDER_RETRY_DELAY_MS, Math.ceil(seconds * 1_000))
    : 0;
  if (delayMs <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(finish, delayMs);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(new DOMException("Aborted", "AbortError"));
    };
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

function extractOutputText(
  output: readonly Readonly<Record<string, unknown>>[],
) {
  for (const item of output) {
    if (!Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (
        isRecord(content) && content.type === "output_text" &&
        typeof content.text === "string" && content.text.trim()
      ) return content.text.trim();
    }
  }
  return "";
}

function parseToolArguments(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function validateStructuredOutput(
  value: string,
  validate: ECOSAgentRunInput["validateOutputText"],
) {
  if (!validate) return true;
  try {
    return validate(value) === true;
  } catch {
    return false;
  }
}

function boundedToolOutput(value: unknown, maximumBytes: number) {
  const output = JSON.stringify({ ok: true, result: value ?? null });
  if (new TextEncoder().encode(output).byteLength <= maximumBytes) {
    return Object.freeze({ output, accepted: true });
  }
  return Object.freeze({
    output: JSON.stringify({ ok: false, error: "tool_result_too_large" }),
    accepted: false,
  });
}

function normalizeLimits(
  value: ECOSAgentRunInput["limits"],
): NormalizedLimits {
  return Object.freeze({
    maxModelTurns: boundedInteger(
      value?.maxModelTurns,
      1,
      8,
      DEFAULT_LIMITS.maxModelTurns,
    ),
    maxToolCalls: boundedInteger(
      value?.maxToolCalls,
      1,
      16,
      DEFAULT_LIMITS.maxToolCalls,
    ),
    maxElapsedMs: boundedInteger(
      value?.maxElapsedMs,
      1_000,
      120_000,
      DEFAULT_LIMITS.maxElapsedMs,
    ),
    maxToolElapsedMs: boundedInteger(
      value?.maxToolElapsedMs,
      250,
      30_000,
      DEFAULT_LIMITS.maxToolElapsedMs,
    ),
    maxToolOutputBytes: boundedInteger(
      value?.maxToolOutputBytes,
      512,
      96_000,
      DEFAULT_LIMITS.maxToolOutputBytes,
    ),
    maxOutputTokens: boundedInteger(
      value?.maxOutputTokens,
      256,
      8_000,
      DEFAULT_LIMITS.maxOutputTokens,
    ),
  });
}

function boundedInteger(
  value: number | undefined,
  minimum: number,
  maximum: number,
  fallback: number,
) {
  return Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, Math.floor(value as number)))
    : fallback;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isRecord(value)) {
    return `{${
      Object.keys(value).sort().map((key) =>
        `${JSON.stringify(key)}:${stableStringify(value[key])}`
      ).join(",")
    }}`;
  }
  return JSON.stringify(value);
}

function cleanIdentifier(value: string, maximum: number) {
  return value.replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, maximum);
}

function emptyUsage(): ECOSAgentUsage {
  return Object.freeze({
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
  });
}

function mergeUsage(
  current: ECOSAgentUsage,
  providerUsage: Readonly<Record<string, unknown>> | null,
): ECOSAgentUsage {
  const inputDetails = isRecord(providerUsage?.input_tokens_details)
    ? providerUsage.input_tokens_details
    : {};
  const outputDetails = isRecord(providerUsage?.output_tokens_details)
    ? providerUsage.output_tokens_details
    : {};
  const inputTokens = nonNegativeInteger(providerUsage?.input_tokens);
  const outputTokens = nonNegativeInteger(providerUsage?.output_tokens);
  return Object.freeze({
    inputTokens: current.inputTokens + inputTokens,
    cachedInputTokens: current.cachedInputTokens +
      nonNegativeInteger(inputDetails.cached_tokens),
    outputTokens: current.outputTokens + outputTokens,
    reasoningTokens: current.reasoningTokens +
      nonNegativeInteger(outputDetails.reasoning_tokens),
    totalTokens: current.totalTokens +
      (nonNegativeInteger(providerUsage?.total_tokens) ||
        inputTokens + outputTokens),
  });
}

function nonNegativeInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

async function sha256Text(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

class DeadlineError extends Error {
  constructor() {
    super("deadline_exceeded");
    this.name = "DeadlineError";
  }
}

async function runWithDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  parentSignal?: AbortSignal,
) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (parentSignal?.aborted) controller.abort();
  else parentSignal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await operation(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) throw new DeadlineError();
    throw error;
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", abort);
  }
}

function researchToolErrorCode(error: unknown): string {
  // Fixed classifications only: never record exception bodies or credentials.
  const code = error instanceof Error && "code" in error ? error.code : null;
  if (typeof code === "string" && ["proof_authority_unavailable", "proof_authority_permission_denied", "proof_authority_identity_mismatch", "proof_authority_response_invalid", "proof_source_unavailable"].includes(code)) return code;
  return deadlineErrorCode(error, "tool_unavailable");
}

function deadlineErrorCode(error: unknown, fallback: string) {
  if (error instanceof DeadlineError) return "agent_deadline_exceeded";
  if (error instanceof DOMException && error.name === "AbortError") {
    return "agent_deadline_exceeded";
  }
  // Preserve only fixed provider status codes for private diagnostics. Never
  // copy provider bodies, arbitrary exception text, or tool errors outward.
  if (fallback === "agent_provider_failed" && error instanceof Error &&
    /^(?:agent_provider_http_(?:400|401|402|403|404|408|409|422|429|500|502|503|504)|agent_provider_(?:call_limit|spend_limit|unavailable_for_fallback))$/.test(error.message)) {
    return error.message;
  }
  return fallback;
}

/** A provider outage is not missing project evidence or a user sign-in error. */
export function ecosAgentFailureResponse(errorCode: string) {
  if (errorCode === "agent_research_unavailable") return {status:503,error:"answer_research_unavailable"} as const;
  if (errorCode === "agent_deadline_exceeded" || errorCode === "agent_cancelled") {
    return { status: 503, error: "answer_timed_out" } as const;
  }
  if (errorCode === "agent_provider_failed" ||
    ["agent_provider_call_limit", "agent_provider_spend_limit", "agent_provider_unavailable_for_fallback"].includes(errorCode) ||
    /^agent_provider_http_(400|401|402|403|404|408|409|422|429|500|502|503|504)$/.test(errorCode)) {
    return { status: 503, error: "answer_provider_unavailable" } as const;
  }
  return { status: 502, error: "answer_invalid" } as const;
}

function failedResult(
  errorCode: string,
  startedAt: number,
  modelTurns: number,
  toolCalls: number,
  successfulResearchCalls: number,
  trace: readonly ECOSAgentToolTrace[],
  usage: ECOSAgentUsage = emptyUsage(),
): ECOSAgentRunResult {
  return Object.freeze({
    contract: ECOS_READ_ONLY_AGENT_CONTRACT,
    status: "failed",
    outputText: null,
    errorCode,
    modelTurns,
    toolCalls,
    successfulResearchCalls,
    elapsedMs: Math.max(0, Date.now() - startedAt),
    usage,
    trace: Object.freeze([...trace]),
  });
}
