import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildECOSAgentTelemetry,
  DEFAULT_ECOS_AGENT_EXECUTION_LIMITS,
  ECOS_AGENT_LIMITS_CONTRACT,
  parseECOSAgentExecutionLimits,
} from "./ecos-agent-telemetry.ts";
import { createECOSProviderFailover } from "./ecos-provider-failover.ts";

Deno.test("advanced owner profile preserves agreed budgets and rejects runner-unreachable settings", async () => {
  const profile = { schemaVersion: ECOS_AGENT_LIMITS_CONTRACT, maxModelTurns: 8, maxToolCalls: 16, maxElapsedMs: 75_000, maxToolElapsedMs: 15_000, maxToolOutputBytes: 48_000, maxOutputTokens: 4_000 };
  assertEquals(parseECOSAgentExecutionLimits(profile).maxOutputTokens, 4_000);
  for (const [key, value] of Object.entries({ maxModelTurns: 9, maxToolCalls: 17, maxElapsedMs: 120_001, maxToolElapsedMs: 30_001, maxToolOutputBytes: 96_001, maxOutputTokens: 8_001 })) {
    await assertRejects(async () => parseECOSAgentExecutionLimits({ ...profile, [key]: value }), Error, "agent_execution_limits_invalid");
  }
});

Deno.test("failed provider attempt reservation is retained in spend accounting", async () => {
  const failover = createECOSProviderFailover({ maxCostUsd: 0.25, maxProviderCalls: 2,
    primary: { complete: async () => { throw new Error("agent_provider_http_503"); } },
    backup: { complete: async () => ({ outputItems: [], toolCalls: [], outputText: "{}", usage: null }) } });
  await failover.gateway.complete({ instructions: "Evidence only", inputItems: [{ role: "user", content: "Q" }],
    tools: [], toolChoice: "none", outputSchemaName: "test", outputSchema: {}, maxOutputTokens: 128,
    signal: new AbortController().signal });
  const providerFailover = failover.snapshot();
  const telemetry = buildECOSAgentTelemetry({ model: providerFailover.model, route: "private", originatingClientSurface: "ipad",
    modelTurns: 1, toolCalls: 0, successfulResearchCalls: 0, elapsedMs: 10,
    usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0 },
    toolTrace: [], limits: DEFAULT_ECOS_AGENT_EXECUTION_LIMITS, providerFailover });
  assertEquals(telemetry.model, "gpt-5.6-terra");
  assertEquals(telemetry.estimatedCostUsd, providerFailover.reservedCostUsd);
  assert(telemetry.estimatedCostUsd! > 0);
  assertEquals(telemetry.providerFailover?.attempts.length, 2);
});

Deno.test("agent telemetry records bounded usage, tools, route, surface, and cost", () => {
  const telemetry = buildECOSAgentTelemetry({
    model: "deepseek-v4-flash",
    route: "deepseek-owner-beta-v1",
    originatingClientSurface: "iphone",
    modelTurns: 2,
    toolCalls: 3,
    successfulResearchCalls: 2,
    elapsedMs: 4_200,
    usage: {
      inputTokens: 10_000,
      cachedInputTokens: 1_000,
      outputTokens: 500,
      reasoningTokens: 0,
      totalTokens: 10_500,
    },
    toolTrace: [{
      callId: "call-1",
      name: "search_project_documents",
      status: "completed",
      elapsedMs: 50,
      outputBytes: 120,
      outputSha256: "a".repeat(64),
    }],
    limits: DEFAULT_ECOS_AGENT_EXECUTION_LIMITS,
  });
  assertEquals(telemetry.originatingClientSurface, "iphone");
  assertEquals(telemetry.route, "deepseek-owner-beta-v1");
  assertEquals(telemetry.toolCalls, 3);
  assertEquals(telemetry.toolTrace[0]?.outputSha256, "a".repeat(64));
  assert(telemetry.estimatedCostUsd !== null);
  assert(telemetry.estimatedCostUsd! > 0);
});

Deno.test("execution limits accept exact bounded server policy", () => {
  assertEquals(
    parseECOSAgentExecutionLimits({
      schemaVersion: ECOS_AGENT_LIMITS_CONTRACT,
      maxModelTurns: 4,
      maxToolCalls: 6,
      maxElapsedMs: 60_000,
      maxToolElapsedMs: 12_000,
      maxToolOutputBytes: 32_000,
      maxOutputTokens: 1_600,
    }),
    {
      maxModelTurns: 4,
      maxToolCalls: 6,
      maxElapsedMs: 60_000,
      maxToolElapsedMs: 12_000,
      maxToolOutputBytes: 32_000,
      maxOutputTokens: 1_600,
    },
  );
});

Deno.test("execution limits reject malformed or excessive policy", async () => {
  await assertRejects(
    async () => parseECOSAgentExecutionLimits({ maxToolCalls: 999 }),
    Error,
    "agent_execution_limits_invalid",
  );
  await assertRejects(
    async () =>
      parseECOSAgentExecutionLimits({
        schemaVersion: ECOS_AGENT_LIMITS_CONTRACT,
        maxModelTurns: 6,
        maxToolCalls: 33,
        maxElapsedMs: 75_000,
        maxToolElapsedMs: 15_000,
        maxToolOutputBytes: 48_000,
        maxOutputTokens: 2_400,
      }),
    Error,
    "agent_execution_limits_invalid",
  );
});
