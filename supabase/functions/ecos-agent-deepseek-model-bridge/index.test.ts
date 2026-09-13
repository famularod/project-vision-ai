import { createECOSAgentDeepSeekModelBridgeHandler } from "./index.ts";

const serviceRoleKey = "service-role-test-secret";
const workerToken = "worker_token_abcdefghijklmnopqrstuvwxyz012345";
const deepSeekKey = "deepseek-test-secret";

function body(model = "deepseek-v4-flash", effort = "none") {
  return {
    model,
    store: false,
    reasoning: { effort },
    max_output_tokens: 400,
    parallel_tool_calls: false,
    tool_choice: "required",
    instructions: "Research before answering.",
    input: [{ role: "user", content: [{ type: "input_text", text: "Q" }] }],
    tools: [{
      type: "function",
      name: "search_project",
      description: "Search current project evidence.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      strict: true,
    }],
    text: {
      format: {
        type: "json_schema",
        name: "answer",
        strict: true,
        schema: { type: "object", properties: {}, additionalProperties: false },
      },
    },
  };
}

function request(payload: unknown) {
  return new Request("https://example.test", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      "x-ecos-worker-token": workerToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

Deno.test("DeepSeek bridge forwards only V4 Flash to the official Responses endpoint", async () => {
  let calls = 0;
  const handler = createECOSAgentDeepSeekModelBridgeHandler({
    serviceRoleKey,
    workerToken,
    deepSeekKey,
    fetchImplementation: async (input, init) => {
      calls += 1;
      if (String(input) !== "https://api.deepseek.com/responses") {
        throw new Error("unexpected endpoint");
      }
      const forwarded = JSON.parse(String(init?.body));
      if (
        forwarded.model !== "deepseek-v4-flash" ||
        forwarded.reasoning?.effort !== "none" ||
        forwarded.temperature !== 0 ||
        new Headers(init?.headers).get("authorization") !==
          `Bearer ${deepSeekKey}`
      ) throw new Error("unexpected DeepSeek request");
      return new Response(
        JSON.stringify({
          status: "completed",
          output: [{
            type: "function_call",
            call_id: "call-1",
            name: "search_project",
            arguments: "{}",
          }],
          usage: { input_tokens: 10, output_tokens: 2 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
  });
  const response = await handler(request(body()));
  if (response.status !== 200 || calls !== 1) {
    throw new Error("DeepSeek request was not forwarded");
  }
});

Deno.test("DeepSeek bridge rejects legacy names, OpenAI models, and unsupported effort", async () => {
  let calls = 0;
  const handler = createECOSAgentDeepSeekModelBridgeHandler({
    serviceRoleKey,
    workerToken,
    deepSeekKey,
    fetchImplementation: async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    },
  });
  for (
    const payload of [
      body("gpt-5.6-luna"),
      body("deepseek-flash"),
      body("deepseek-v4-pro"),
      body("deepseek-v4-flash-vision-exp"),
      body("deepseek-v4-flash", "medium"),
      body("deepseek-v4-flash", "high"),
      body("deepseek-v4-flash", "max"),
    ]
  ) {
    const response = await handler(request(payload));
    if (response.status !== 502) throw new Error("unsafe request was accepted");
  }
  if (calls !== 0) throw new Error("rejected request reached DeepSeek");
});

Deno.test("DeepSeek bridge rejects incomplete output", async () => {
  const handler = createECOSAgentDeepSeekModelBridgeHandler({
    serviceRoleKey,
    workerToken,
    deepSeekKey,
    fetchImplementation: async () =>
      new Response(
        JSON.stringify({
          status: "incomplete",
          incomplete_details: { reason: "max_output_tokens" },
          output: [{
            type: "message",
            status: "completed",
            content: [{ type: "output_text", text: "{}" }],
          }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
  });
  const response = await handler(request(body()));
  if (response.status !== 502) {
    throw new Error("incomplete DeepSeek output did not fail closed");
  }
});
