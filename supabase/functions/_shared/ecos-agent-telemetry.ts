import {
  ecosAgentModelProfile,
  estimateECOSAgentUsageCostUsd,
} from "./ecos-agent-model-evaluation.ts";
import {
  type ECOSAgentToolTrace,
  type ECOSAgentUsage,
} from "./ecos-read-only-agent.ts";
import type { createECOSProviderFailover } from "./ecos-provider-failover.ts";
export type ECOSProviderFailoverTelemetry = ReturnType<ReturnType<typeof createECOSProviderFailover>["snapshot"]>;

export const ECOS_AGENT_TELEMETRY_CONTRACT = "ecos-agent-telemetry/1.0";
export const ECOS_AGENT_LIMITS_CONTRACT = "ecos-agent-limits/1.0";

export type ECOSAgentExecutionLimits = Readonly<{
  maxModelTurns: number;
  maxToolCalls: number;
  maxElapsedMs: number;
  maxToolElapsedMs: number;
  maxToolOutputBytes: number;
  maxOutputTokens: number;
}>;

export type ECOSAgentTelemetry = Readonly<{
  schemaVersion: typeof ECOS_AGENT_TELEMETRY_CONTRACT;
  model: string;
  pricingVerifiedOn: string | null;
  route: string;
  originatingClientSurface: "web" | "iphone" | "ipad" | "android" | "unknown";
  modelTurns: number;
  toolCalls: number;
  successfulResearchCalls: number;
  elapsedMs: number;
  usage: ECOSAgentUsage;
  toolTrace: readonly ECOSAgentToolTrace[];
  estimatedCostUsd: number | null;
  limits: ECOSAgentExecutionLimits;
  providerFailover?: ECOSProviderFailoverTelemetry;
}>;

export const DEFAULT_ECOS_AGENT_EXECUTION_LIMITS: ECOSAgentExecutionLimits =
  Object.freeze({
    maxModelTurns: 6,
    maxToolCalls: 8,
    maxElapsedMs: 75_000,
    maxToolElapsedMs: 15_000,
    maxToolOutputBytes: 48_000,
    maxOutputTokens: 2_400,
  });

const LIMIT_BOUNDS = Object.freeze(
  {
    // Reject policies the runner cannot honor, instead of reporting a larger
    // configured budget while silently executing a smaller one.
    maxModelTurns: [1, 8],
    maxToolCalls: [1, 16],
    maxElapsedMs: [5_000, 120_000],
    maxToolElapsedMs: [1_000, 30_000],
    maxToolOutputBytes: [1_024, 96_000],
    maxOutputTokens: [256, 8_000],
  } as const,
);

export function parseECOSAgentExecutionLimits(
  value: unknown,
): ECOSAgentExecutionLimits {
  if (value === undefined || value === null) {
    return DEFAULT_ECOS_AGENT_EXECUTION_LIMITS;
  }
  if (!isRecord(value) || value.schemaVersion !== ECOS_AGENT_LIMITS_CONTRACT) {
    throw new Error("agent_execution_limits_invalid");
  }
  const parsed = Object.fromEntries(
    Object.entries(LIMIT_BOUNDS).map(([key, bounds]) => {
      const candidate = Number(value[key]);
      if (
        !Number.isInteger(candidate) || candidate < bounds[0] ||
        candidate > bounds[1]
      ) {
        throw new Error("agent_execution_limits_invalid");
      }
      return [key, candidate];
    }),
  ) as ECOSAgentExecutionLimits;
  return Object.freeze(parsed);
}

export function buildECOSAgentTelemetry(
  input: Readonly<{
    model: string;
    route: string;
    originatingClientSurface: unknown;
    modelTurns: number;
    toolCalls: number;
    successfulResearchCalls: number;
    elapsedMs: number;
    usage: ECOSAgentUsage;
    toolTrace: readonly ECOSAgentToolTrace[];
    limits: ECOSAgentExecutionLimits;
    providerFailover?: ECOSProviderFailoverTelemetry;
  }>,
): ECOSAgentTelemetry {
  const model = cleanCode(input.model, 120);
  const profile = ecosAgentModelProfile(model);
  const estimatedCostUsd = input.providerFailover?.reservedCostUsd ?? estimateECOSAgentUsageCostUsd(model, input.usage);
  return Object.freeze({
    schemaVersion: ECOS_AGENT_TELEMETRY_CONTRACT,
    model,
    pricingVerifiedOn: input.providerFailover ? "2026-09-14" : profile?.pricingVerifiedOn || null,
    route: cleanCode(input.route, 120) || "private_read_only_v1",
    originatingClientSurface: normalizedSurface(input.originatingClientSurface),
    modelTurns: boundedCount(input.modelTurns, 12),
    toolCalls: boundedCount(input.toolCalls, 32),
    successfulResearchCalls: boundedCount(input.successfulResearchCalls, 32),
    elapsedMs: boundedCount(input.elapsedMs, 300_000),
    usage: Object.freeze({ ...input.usage }),
    toolTrace: Object.freeze(
      input.toolTrace.map((entry) => Object.freeze({ ...entry })),
    ),
    estimatedCostUsd: estimatedCostUsd === null
      ? null
      : Number(estimatedCostUsd.toFixed(9)),
    limits: Object.freeze({ ...input.limits }),
    ...(input.providerFailover ? { providerFailover: input.providerFailover } : {}),
  });
}

function normalizedSurface(
  value: unknown,
): ECOSAgentTelemetry["originatingClientSurface"] {
  return value === "web" || value === "iphone" || value === "ipad" ||
      value === "android"
    ? value
    : "unknown";
}

function boundedCount(value: unknown, maximum: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.min(maximum, Math.max(0, Math.floor(parsed)))
    : 0;
}

function cleanCode(value: unknown, maximum: number) {
  return typeof value === "string"
    ? value.trim().replace(/[^a-zA-Z0-9_.:-]+/g, "_").slice(0, maximum)
    : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
