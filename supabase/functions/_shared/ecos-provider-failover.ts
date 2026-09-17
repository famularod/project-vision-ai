import type {
  ECOSAgentModelGateway,
  ECOSAgentModelRequest,
  ECOSAgentModelTurn,
} from "./ecos-read-only-agent.ts";
import { measureECOSDrawingMedia } from "./ecos-drawing-media-budget.ts";

export const ECOS_PROVIDER_FAILOVER_CONTRACT = "ecos-provider-failover/1.0";
export const ECOS_BACKUP_MODEL = "gpt-5.6-terra";
export type ECOSProviderAttempt = Readonly<{
  model: string;
  reportedModel: string | null;
  outcome: "completed" | "availability" | "rejected";
  elapsedMs: number;
  reservedCostUsd: number;
  accountedCostUsd: number;
  usage: Readonly<Record<string, unknown>> | null;
}>;

/** One instance per authorized question; never share its state across users. */
export function createECOSProviderFailover(input: Readonly<{
  primary: ECOSAgentModelGateway;
  backup: ECOSAgentModelGateway;
  maxProviderCalls: number;
  maxCostUsd: number;
  primaryTimeoutMs?: number;
  /** Private candidate only. Image fallback remains disabled until separately
   * measured for the backup provider; text fallback behavior is unchanged. */
  allowDrawingImages?: boolean;
}>) {
  if (!Number.isInteger(input.maxProviderCalls) || input.maxProviderCalls < 1 ||
    input.maxProviderCalls > 12 || !Number.isFinite(input.maxCostUsd) ||
    input.maxCostUsd <= 0 || input.maxCostUsd > 0.25) {
    throw new Error("agent_failover_budget_invalid");
  }
  const timeoutMs = input.primaryTimeoutMs ?? 12_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 12_000) {
    throw new Error("agent_failover_budget_invalid");
  }
  let switched = false;
  let primaryPrefixLength = 0;
  let calls = 0;
  let reservedCostUsd = 0;
  const attempts: ECOSProviderAttempt[] = [];
  let inFlight = false;

  const attempt = async (request: ECOSAgentModelRequest, backup: boolean) => {
    if (request.signal.aborted) throw new DOMException("Aborted", "AbortError");
    if (calls >= input.maxProviderCalls) throw new Error("agent_provider_call_limit");
    // Retain the full reservation even on timeout: cancellation is not proof
    // the provider did not bill. No optimistic cache discounts or zero-cost errors.
    const cost = reserveCost(request, backup, input.allowDrawingImages === true);
    if (reservedCostUsd + cost > input.maxCostUsd) {
      throw new Error("agent_provider_spend_limit");
    }
    reservedCostUsd += cost;
    calls += 1;
    const started = Date.now();
    const controller = new AbortController();
    const stop = () => controller.abort();
    request.signal.addEventListener("abort", stop, { once: true });
    let timedOut = false;
    const timer = backup ? undefined : setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    let abortListener: (() => void) | undefined;
    try {
      const cancellation = new Promise<never>((_, reject) => {
        abortListener = () => reject(new DOMException("Aborted", "AbortError"));
        controller.signal.addEventListener("abort", abortListener, { once: true });
        if (request.signal.aborted) stop();
      });
      const result = await Promise.race([
        (backup ? input.backup : input.primary).complete({ ...request, signal: controller.signal }),
        cancellation,
      ]);
      const accounted = accountedCost(result, backup, cost, request.maxOutputTokens);
      reservedCostUsd -= cost - accounted;
      attempts.push(Object.freeze({ model: backup ? ECOS_BACKUP_MODEL : "deepseek-v4-flash",
        reportedModel: result.reportedModel || null, outcome: "completed",
        elapsedMs: Date.now() - started, reservedCostUsd: cost, accountedCostUsd: accounted, usage: result.usage }));
      return result;
    } catch (error) {
      const unavailable = !request.signal.aborted &&
        (timedOut || isAvailabilityError(error));
      attempts.push(Object.freeze({ model: backup ? ECOS_BACKUP_MODEL : "deepseek-v4-flash",
        reportedModel: null, outcome: unavailable ? "availability" : "rejected",
        elapsedMs: Date.now() - started, reservedCostUsd: cost, accountedCostUsd: cost, usage: null }));
      if (unavailable) throw new Error("agent_provider_unavailable_for_fallback");
      throw error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      request.signal.removeEventListener("abort", stop);
      if (abortListener) controller.signal.removeEventListener("abort", abortListener);
      controller.abort();
    }
  };
  const gateway: ECOSAgentModelGateway = Object.freeze({
    complete: async (request): Promise<ECOSAgentModelTurn> => {
      if (inFlight) throw new Error("agent_failover_concurrent_call_forbidden");
      inFlight = true;
      try {
        // A previous TEXT outage may already have switched this shared
        // question gateway. That must not enable an unvalidated image backup.
        if (switched && measureECOSDrawingMedia(request.inputItems).images > 0) {
          throw new Error("agent_provider_image_fallback_unavailable");
        }
        if (!switched) {
          try { return await attempt(request, false); } catch (error) {
            if (!(error instanceof Error) ||
              error.message !== "agent_provider_unavailable_for_fallback" || request.signal.aborted) throw error;
            if (measureECOSDrawingMedia(request.inputItems).images > 0) {
              throw new Error("agent_provider_image_fallback_unavailable");
            }
            switched = true;
            primaryPrefixLength = request.inputItems.length;
          }
        }
        // Keep the same question, tool results and evidence. Provider-specific
        // reasoning IDs are not portable; preserve subsequent OpenAI reasoning.
        const prefix = portableTranscript(request.inputItems.slice(0, primaryPrefixLength));
        return await attempt({ ...request,
          inputItems: [...prefix, ...request.inputItems.slice(primaryPrefixLength)] }, true);
      } finally { inFlight = false; }
    },
  });
  return Object.freeze({ gateway, snapshot: () => Object.freeze({
    contract: ECOS_PROVIDER_FAILOVER_CONTRACT,
    model: attempts.some(a => a.model === ECOS_BACKUP_MODEL) ? ECOS_BACKUP_MODEL : "deepseek-v4-flash",
    fallbackUsed: attempts.some(a => a.model === ECOS_BACKUP_MODEL),
    providerCalls: calls,
    reservedCostUsd: Number(reservedCostUsd.toFixed(9)),
    costAccounting: "reported_usage_plus_unknown_attempt_reservations" as const,
    attempts: Object.freeze([...attempts]),
  }) });
}

function accountedCost(turn: ECOSAgentModelTurn, backup: boolean, reservation: number, maxOutput: number) {
  const input = turn.usage?.input_tokens, output = turn.usage?.output_tokens;
  if (typeof input !== "number" || typeof output !== "number" ||
    !Number.isSafeInteger(input) || !Number.isSafeInteger(output) || input < 0 ||
    output < 0 || output > maxOutput) return reservation;
  const cost = (input * (backup ? 2.5 : 0.3) + output * (backup ? 12 : 1.2)) / 1_000_000;
  // Never replace an unknown/implausible charge with a discounted estimate.
  return cost <= reservation ? cost : reservation;
}

function isAvailabilityError(error: unknown) {
  return error instanceof Error && /^agent_provider_http_(408|429|500|502|503|504)$/.test(error.message);
}

function portableTranscript(items: readonly unknown[]): unknown[] {
  return items.flatMap((value): unknown[] => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("agent_provider_transcript_invalid");
    }
    const item = value as Record<string, unknown>;
    if (item.type === "reasoning") return [];
    if (item.type === "function_call") return [{ type: item.type,
      call_id: item.call_id, name: item.name, arguments: item.arguments }];
    if (item.type === "function_call_output") return [{ type: item.type,
      call_id: item.call_id, output: item.output }];
    if (["user", "assistant", "system", "developer"].includes(String(item.role))) {
      return [{ role: item.role, content: item.content }];
    }
    throw new Error("agent_provider_transcript_invalid");
  });
}

function reserveCost(request: ECOSAgentModelRequest, backup: boolean, allowDrawingImages: boolean) {
  const media = measureECOSDrawingMedia(request.inputItems);
  const bytes = new TextEncoder().encode(JSON.stringify({ instructions: request.instructions,
    input: media.textInput, tools: request.tools, schema: request.outputSchema })).length;
  if ((media.images > 0 && (!allowDrawingImages || backup)) ||
    bytes > 250_000 || !Number.isSafeInteger(request.maxOutputTokens) ||
    request.maxOutputTokens < 1 || request.maxOutputTokens > 6_000) {
    throw new Error("agent_provider_budget_input_invalid");
  }
  // One token per UTF-8 byte plus generous protocol overhead; cap below the
  // 272K long-context boundary. Terra uses cache-write rate as the input ceiling.
  // Verified 2026-09-14: OpenAI /api/docs/pricing; DeepSeek /quick_start/pricing.
  const inputRate = backup ? 2.5 : 0.3;
  const outputRate = backup ? 12 : 1.2;
  return ((bytes + 16_384 + media.imageTokenCeiling) * inputRate + request.maxOutputTokens * outputRate) / 1_000_000;
}
