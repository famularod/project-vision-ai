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
