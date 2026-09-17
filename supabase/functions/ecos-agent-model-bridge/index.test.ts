import { createECOSAgentModelBridgeHandler } from "./index.ts";
import { imagePart } from "../_shared/ecos-drawing-media.fixture.ts";

const serviceRoleKey = "service-role-test-secret";
const workerToken = "worker_token_abcdefghijklmnopqrstuvwxyz012345";
const openAIKey = "openai-test-secret";

Deno.test("image opt-in never raises the text ceiling or permits external image URLs", async () => {
  let calls = 0;
  const handler = createECOSAgentModelBridgeHandler({
    serviceRoleKey,workerToken,provider:"deepseek",providerKey:"deepseek-test-secret",allowDrawingImages:true,
    fetchImplementation:async () => {calls++; return Response.json({});},
  });
  const plain = {...body("deepseek-v4-flash"),reasoning:{effort:"none"},
    input:[{role:"user",content:[{type:"input_text",text:"x".repeat(800 * 1024)}]}]};
  const external = {...body("deepseek-v4-flash"),reasoning:{effort:"none"},
    input:[{role:"user",content:[{...imagePart(),image_url:"https://example.test/drawing.png"}]}]};
  for (const payload of [plain,external]) {
    const response = await handler(request(payload));
    if (response.status === 200) throw new Error("invalid media request admitted");
    await response.body?.cancel();
  }
  if (calls !== 0) throw new Error("provider called for invalid media request");
});

function body(model = "gpt-5.6-luna") {
  return {
    model,
    store: false,
    reasoning: { effort: "medium" },
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

function request(payload: unknown, headers: HeadersInit = {}) {
  return new Request("https://example.test", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      "x-ecos-worker-token": workerToken,
      "Content-Type": "application/json",
      ...Object.fromEntries(new Headers(headers)),
    },
    body: JSON.stringify(payload),
  });
}

Deno.test("bridge distinguishes provider outage from auth, quota and invalid output for fallback", async () => {
  for (const status of [400, 401, 402, 403, 429, 500, 502, 503, 504]) {
    const handler = createECOSAgentModelBridgeHandler({ serviceRoleKey, workerToken,
      provider: "openai", providerKey: openAIKey,
      fetchImplementation: async (_input, init) => {
        if (JSON.parse(String(init?.body)).service_tier !== "default") throw new Error("unbounded pricing tier");
        return new Response("private provider detail", { status });
      } });
    const response = await handler(request(body()));
    const expected = [429, 500, 502, 503, 504].includes(status) ? "availability" : "rejected";
    if (response.headers.get("x-ecos-provider-failure") !== expected) throw new Error("wrong failure class");
    if ((await response.text()).includes("private provider detail")) throw new Error("provider body exposed");
  }
  const invalid = createECOSAgentModelBridgeHandler({ serviceRoleKey, workerToken,
    provider: "openai", providerKey: openAIKey, fetchImplementation: async () => Response.json({ invalid: true }) });
  const response = await invalid(request(body()));
  if (response.headers.get("x-ecos-provider-failure") !== "rejected") throw new Error("invalid output treated as outage");
  await response.body?.cancel();
});

Deno.test("agent bridge forwards one bounded allowed model request", async () => {
  let calls = 0;
  let forwardedToolChoice: unknown = null;
  const handler = createECOSAgentModelBridgeHandler({
    serviceRoleKey,
    workerToken,
    provider: "openai",
    providerKey: openAIKey,
    fetchImplementation: async (input, init) => {
      calls += 1;
      forwardedToolChoice = JSON.parse(String(init?.body)).tool_choice;
      if (String(input) !== "https://api.openai.com/v1/responses") {
        throw new Error("unexpected endpoint");
      }
      if (
        new Headers(init?.headers).get("authorization") !==
          `Bearer ${openAIKey}`
      ) {
        throw new Error("missing provider credential");
      }
      return new Response(
        JSON.stringify({
          status: "completed",
          output: [{ type: "reasoning" }, {
            type: "message",
            status: "completed",
            role: "assistant",
            content: [{ type: "output_text", text: "{}" }],
          }],
          usage: { input_tokens: 10, output_tokens: 2 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
  });
  const response = await handler(request(body()));
  if (response.status !== 200 || calls !== 1) throw new Error("bridge failed");
  if (forwardedToolChoice !== "required") {
    throw new Error("tool choice was not forwarded to the provider");
  }
  const result = await response.json();
  if (result.status !== "completed" || !Array.isArray(result.output)) {
    throw new Error("provider result not preserved");
  }
});

Deno.test("agent bridge bounds provider tool choice", async () => {
  let calls = 0;
  const handler = createECOSAgentModelBridgeHandler({
    serviceRoleKey,
    workerToken,
    provider: "openai",
    providerKey: openAIKey,
    fetchImplementation: async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          status: "completed",
          output: [],
          usage: { input_tokens: 1, output_tokens: 0 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
  });
  for (const toolChoice of ["auto", "required", "none"] as const) {
    const allowed = body();
    allowed.tool_choice = toolChoice;
    const response = await handler(request(allowed));
    if (response.status !== 200) {
      throw new Error(`allowed tool choice ${toolChoice} was rejected early`);
    }
  }
  const rejected = body();
  rejected.tool_choice = "search_project";
  const response = await handler(request(rejected));
  if (response.status !== 502 || calls !== 3) {
    throw new Error("unbounded tool choice reached provider");
  }
});

Deno.test("agent bridge denies callers, origins and unapproved models", async () => {
  let calls = 0;
  const handler = createECOSAgentModelBridgeHandler({
    serviceRoleKey,
    workerToken,
    provider: "openai",
    providerKey: openAIKey,
    fetchImplementation: async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    },
  });
  const denied = await handler(
    request(body(), { Authorization: "Bearer wrong" }),
  );
  const browser = await handler(
    request(body(), { Origin: "https://example.test" }),
  );
  const model = await handler(request(body("gpt-unknown")));
  if (denied.status !== 403 || browser.status !== 403 || model.status !== 502) {
    throw new Error("bridge boundary failed closed");
  }
  if (calls !== 0) throw new Error("rejected request reached provider");
});

Deno.test("agent bridge sanitizes provider failures", async () => {
  const handler = createECOSAgentModelBridgeHandler({
    serviceRoleKey,
    workerToken,
    provider: "openai",
    providerKey: openAIKey,
    fetchImplementation: async () =>
      new Response(JSON.stringify({ error: { message: "secret detail" } }), {
        status: 429,
        headers: { "Retry-After": "17" },
      }),
  });
  const response = await handler(request(body()));
  const result = await response.json();
  if (
    response.status !== 429 || response.headers.get("retry-after") !== "17" ||
    JSON.stringify(result).includes("secret detail")
  ) throw new Error("provider failure was not sanitized");
});

Deno.test("agent bridge logs only bounded metadata for incomplete provider responses", async () => {
  const originalError = console.error;
  const logs: string[] = [];
  console.error = (...values: unknown[]) =>
    logs.push(values.map(String).join(" "));
  try {
    const handler = createECOSAgentModelBridgeHandler({
      serviceRoleKey,
      workerToken,
      provider: "openai",
      providerKey: openAIKey,
      fetchImplementation: async () =>
        new Response(
          JSON.stringify({
            status: "incomplete",
            incomplete_details: { reason: "max_output_tokens" },
            output: [{
              type: "reasoning",
              secret_untrusted_text: "must-not-appear-in-diagnostics",
            }],
            usage: { input_tokens: 10, output_tokens: 400 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    });
    const response = await handler(request(body()));
    const result = await response.json();
    if (
      response.status !== 502 ||
      result.error !== "agent_model_provider_unavailable"
    ) {
      throw new Error("incomplete provider response did not fail closed");
    }
    const diagnostic = logs.join("\n");
    if (
      !diagnostic.includes("max_output_tokens") ||
      !diagnostic.includes("reasoning") ||
      diagnostic.includes("must-not-appear-in-diagnostics")
    ) {
      throw new Error(
        `provider diagnostic was unsafe or incomplete: ${diagnostic}`,
      );
    }
  } finally {
    console.error = originalError;
  }
});

Deno.test("agent bridge accepts only a completed structured answer at max_messages", async () => {
  const handler = createECOSAgentModelBridgeHandler({
    serviceRoleKey,
    workerToken,
    provider: "openai",
    providerKey: openAIKey,
    fetchImplementation: async () =>
      new Response(
        JSON.stringify({
          status: "incomplete",
          incomplete_details: { reason: "max_messages" },
          output: [
            { type: "reasoning" },
            {
              type: "message",
              status: "completed",
              role: "assistant",
              content: [{ type: "output_text", text: "{}" }],
            },
          ],
          usage: { input_tokens: 10, output_tokens: 400 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
  });
  const payload: Record<string, unknown> = body();
  payload.tool_choice = "auto";
  (payload.input as unknown[]).push({
    type: "function_call_output",
    call_id: "call-7",
    output: '{"ok":true,"result":{}}',
  });
  const response = await handler(request(payload));
  const result = await response.json();
  if (
    response.status !== 200 || result.status !== "incomplete" ||
    result.incomplete_details?.reason !== "max_messages"
  ) throw new Error("completed max_messages answer was not preserved");
});

Deno.test("agent bridge rejects max_messages answers before project research", async () => {
  const handler = createECOSAgentModelBridgeHandler({
    serviceRoleKey,
    workerToken,
    provider: "openai",
    providerKey: openAIKey,
    fetchImplementation: async () =>
      new Response(
        JSON.stringify({
          status: "incomplete",
          incomplete_details: { reason: "max_messages" },
          output: [{
            type: "message",
            status: "completed",
            role: "assistant",
            content: [{ type: "output_text", text: "{}" }],
          }],
          usage: { input_tokens: 10, output_tokens: 400 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
  });
  const response = await handler(request(body()));
  const result = await response.json();
  if (
    response.status !== 502 ||
    result.error !== "agent_model_provider_unavailable"
  ) throw new Error("unresearched max_messages answer did not fail closed");
});

Deno.test("agent bridge rejects unfinished max_messages output", async () => {
  const handler = createECOSAgentModelBridgeHandler({
    serviceRoleKey,
    workerToken,
    provider: "openai",
    providerKey: openAIKey,
    fetchImplementation: async () =>
      new Response(
        JSON.stringify({
          status: "incomplete",
          incomplete_details: { reason: "max_messages" },
          output: [{
            type: "message",
            status: "incomplete",
            role: "assistant",
            content: [{ type: "output_text", text: "{}" }],
          }],
          usage: { input_tokens: 10, output_tokens: 400 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
  });
  const response = await handler(request(body()));
  const result = await response.json();
  if (
    response.status !== 502 ||
    result.error !== "agent_model_provider_unavailable"
  ) throw new Error("unfinished max_messages output did not fail closed");
});
