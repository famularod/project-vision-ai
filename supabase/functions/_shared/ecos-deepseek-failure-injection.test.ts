import {
  createOpenAIResponsesAgentGateway,
  type ECOSAgentModelGateway,
  type ECOSAgentModelTurn,
  type ECOSAgentTool,
  runECOSReadOnlyAgent,
} from "./ecos-read-only-agent.ts";
import { createECOSAgentDeepSeekModelBridgeHandler } from "../ecos-agent-deepseek-model-bridge/index.ts";

const SERVICE_ROLE_KEY = "service-role-test-secret";
const WORKER_TOKEN = "worker_token_abcdefghijklmnopqrstuvwxyz012345";
const PROVIDER_KEY = "deepseek-test-secret";
const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["shortAnswer"],
  properties: { shortAnswer: { type: "string" } },
};

const EVIDENCE_TOOL: ECOSAgentTool = Object.freeze({
  name: "search_project_evidence",
  description: "Search authorized project evidence.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["query"],
    properties: { query: { type: "string" } },
  },
  progressStage: "searching",
  providesEvidence: true,
  execute: () => ({ matches: [{ id: "document:1", text: "verified" }] }),
});

Deno.test("DeepSeek 429 failures are sanitized and preserve only a bounded retry delay", async () => {
  const handler = createECOSAgentDeepSeekModelBridgeHandler({
    serviceRoleKey: SERVICE_ROLE_KEY,
    workerToken: WORKER_TOKEN,
    deepSeekKey: PROVIDER_KEY,
    fetchImplementation: async () =>
      new Response(JSON.stringify({ error: { message: "provider-secret" } }), {
        status: 429,
        headers: { "Retry-After": "999999" },
      }),
  });
  const response = await handler(bridgeRequest());
  const body = await response.text();
  assertEquals(response.status, 429);
  assertEquals(response.headers.get("retry-after"), null);
  assert(!body.includes("provider-secret"));
  assert(body.includes("agent_model_provider_unavailable"));
});

Deno.test("DeepSeek malformed provider output fails closed without leaking content", async () => {
  const originalError = console.error;
  const logs: string[] = [];
  console.error = (...values: unknown[]) =>
    logs.push(values.map(String).join(" "));
  try {
    const handler = createECOSAgentDeepSeekModelBridgeHandler({
      serviceRoleKey: SERVICE_ROLE_KEY,
      workerToken: WORKER_TOKEN,
      deepSeekKey: PROVIDER_KEY,
      fetchImplementation: async () =>
        new Response("not-json provider-secret", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    });
    const response = await handler(bridgeRequest());
    const body = await response.text();
    assertEquals(response.status, 502);
    assert(!body.includes("provider-secret"));
    assert(!logs.join("\n").includes("provider-secret"));
  } finally {
    console.error = originalError;
  }
});

Deno.test("DeepSeek caller cancellation stops before provider work and returns a safe timeout", async () => {
  const controller = new AbortController();
  let providerCalls = 0;
  const handler = createECOSAgentDeepSeekModelBridgeHandler({
    serviceRoleKey: SERVICE_ROLE_KEY,
    workerToken: WORKER_TOKEN,
    deepSeekKey: PROVIDER_KEY,
    fetchImplementation: (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        providerCalls += 1;
        const signal = init?.signal;
        const abort = () => {
          reject(new DOMException("Aborted", "AbortError"));
        };
        if (signal?.aborted) abort();
        else signal?.addEventListener("abort", abort, { once: true });
      }),
  });
  controller.abort();
  const response = await handler(bridgeRequest(controller.signal));
  assertEquals(response.status, 504);
  assertEquals(providerCalls, 0);
  assertEquals(
    await response.json(),
    { error: "agent_model_provider_unavailable" },
  );
});

Deno.test("DeepSeek transient provider responses receive only one bounded retry", async () => {
  let calls = 0;
  const gateway = createOpenAIResponsesAgentGateway({
    apiKey: "private-bridge-credential",
    model: "deepseek-v4-flash",
    reasoningEffort: "none",
    endpoint: "https://private-deepseek-bridge.test",
    fetchImpl: async () => {
      calls += 1;
      return calls === 1
        ? new Response("temporary", {
          status: 429,
          headers: { "Retry-After": "0" },
        })
        : new Response(JSON.stringify({ status: "completed", output: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
    },
  });
  await gateway.complete(modelRequest());
  assertEquals(calls, 2);
});

Deno.test("oversized DeepSeek tool evidence cannot authorize a factual answer", async () => {
  const oversizedTool: ECOSAgentTool = Object.freeze({
    ...EVIDENCE_TOOL,
    execute: () => ({ text: "x".repeat(2_000) }),
  });
  const result = await runECOSReadOnlyAgent({
    gateway: queuedGateway([
      turn({
        toolCalls: [{
          callId: "call-oversized",
          name: oversizedTool.name,
          argumentsJson: '{"query":"north lot"}',
        }],
      }),
      turn({ outputText: '{"shortAnswer":"Unsupported answer"}' }),
      turn({ outputText: '{"shortAnswer":"Still unsupported"}' }),
    ]),
    instructions: "Research before answering.",
    inputItems: [{ role: "user", content: "Question" }],
    tools: [oversizedTool],
    outputSchemaName: "answer",
    outputSchema: OUTPUT_SCHEMA,
    limits: { maxModelTurns: 3, maxToolOutputBytes: 512 },
  });
  assertEquals(result.status, "failed");
  assertEquals(result.errorCode, "agent_research_unavailable");
  assertEquals(result.successfulResearchCalls, 0);
  assertEquals(result.trace[0]?.status, "failed");
});

Deno.test("failed and unauthorized DeepSeek tool calls cannot become evidence", async () => {
  const failingTool: ECOSAgentTool = Object.freeze({
    ...EVIDENCE_TOOL,
    execute: () => {
      throw new Error("customer-content-must-not-leak");
    },
  });
  const result = await runECOSReadOnlyAgent({
    gateway: queuedGateway([
      turn({
        toolCalls: [
          {
            callId: "call-failed",
            name: failingTool.name,
            argumentsJson: '{"query":"north lot"}',
          },
          {
            callId: "call-unknown",
            name: "write_project_record",
            argumentsJson: "{}",
          },
          {
            callId: "call-malformed",
            name: EVIDENCE_TOOL.name,
            argumentsJson: "not-json",
          },
        ],
      }),
      turn({ outputText: '{"shortAnswer":"Unsupported answer"}' }),
      turn({ outputText: '{"shortAnswer":"Still unsupported"}' }),
    ]),
    instructions: "Research before answering.",
    inputItems: [{ role: "user", content: "Question" }],
    tools: [failingTool],
    outputSchemaName: "answer",
    outputSchema: OUTPUT_SCHEMA,
    limits: { maxModelTurns: 3 },
  });
  assertEquals(result.status, "failed");
  assertEquals(result.errorCode, "agent_research_unavailable");
  assertEquals(result.successfulResearchCalls, 0);
  assertEquals(result.trace.map((item) => item.status), [
    "failed",
    "rejected",
    "rejected",
  ]);
  assert(
    !JSON.stringify(result.trace).includes("customer-content-must-not-leak"),
  );
});

Deno.test("cancelling a DeepSeek agent run stops before a model request", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const result = await runECOSReadOnlyAgent({
    gateway: {
      complete: () => {
        calls += 1;
        return Promise.resolve(turn({}));
      },
    },
    instructions: "Research before answering.",
    inputItems: [{ role: "user", content: "Question" }],
    tools: [EVIDENCE_TOOL],
    outputSchemaName: "answer",
    outputSchema: OUTPUT_SCHEMA,
    signal: controller.signal,
  });
  assertEquals(result.status, "failed");
  assertEquals(result.errorCode, "agent_cancelled");
  assertEquals(calls, 0);
});

function bridgeRequest(signal?: AbortSignal) {
  return new Request("https://private-bridge.test", {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "x-ecos-worker-token": WORKER_TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "deepseek-v4-flash",
      store: false,
      reasoning: { effort: "none" },
      max_output_tokens: 400,
      parallel_tool_calls: false,
      tool_choice: "required",
      instructions: "Research before answering.",
      input: [{ role: "user", content: [{ type: "input_text", text: "Q" }] }],
      tools: [{
        type: "function",
        name: EVIDENCE_TOOL.name,
        description: EVIDENCE_TOOL.description,
        parameters: EVIDENCE_TOOL.inputSchema,
        strict: true,
      }],
      text: {
        format: {
          type: "json_schema",
          name: "answer",
          strict: true,
          schema: OUTPUT_SCHEMA,
        },
      },
    }),
  });
}

function modelRequest() {
  return {
    instructions: "Research before answering.",
    inputItems: [{ role: "user", content: "Question" }],
    tools: [EVIDENCE_TOOL],
    toolChoice: "required" as const,
    outputSchemaName: "answer",
    outputSchema: OUTPUT_SCHEMA,
    maxOutputTokens: 400,
    signal: new AbortController().signal,
  };
}

function queuedGateway(turns: ECOSAgentModelTurn[]): ECOSAgentModelGateway {
  let index = 0;
  return {
    complete: () => {
      const value = turns[index++];
      if (!value) throw new Error("unexpected_model_turn");
      return Promise.resolve(value);
    },
  };
}

function turn(value: Partial<ECOSAgentModelTurn>): ECOSAgentModelTurn {
  return {
    outputItems: value.outputItems || [],
    toolCalls: value.toolCalls || [],
    outputText: value.outputText || null,
    usage: value.usage || null,
  };
}

function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}
