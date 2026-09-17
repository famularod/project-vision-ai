import { createECOSProviderFailover, ECOS_BACKUP_MODEL } from "./ecos-provider-failover.ts";
import { imagePart } from "./ecos-drawing-media.fixture.ts";
import { createOpenAIResponsesAgentGateway, runECOSReadOnlyAgent, type ECOSAgentModelRequest, type ECOSAgentModelTurn } from "./ecos-read-only-agent.ts";

const turn: ECOSAgentModelTurn = { outputItems: [], toolCalls: [], outputText: '{"answer":"insufficient evidence"}', usage: null };
const request = (): ECOSAgentModelRequest => ({ instructions: "Use authorized evidence only", inputItems: [{ role: "user", content: "Project A question" }],
  tools: [], toolChoice: "required", outputSchemaName: "answer", outputSchema: { type: "object" },
  maxOutputTokens: 256, signal: new AbortController().signal });
const fail = (message: string) => ({ complete: () => Promise.reject(new Error(message)) });
const ok = { complete: async () => turn };
function assert(value: unknown, message = "assertion failed"): asserts value { if (!value) throw new Error(message); }
async function rejects(operation: () => Promise<unknown>, code: string) {
  try { await operation(); } catch (error) { assert(error instanceof Error && (error.message === code || error.name === code), String(error)); return; }
  throw new Error("expected rejection: " + code);
}
function options() { return { primary: ok, backup: ok, maxProviderCalls: 6, maxCostUsd: 0.25 }; }

Deno.test("failover never calls backup on a successful primary or insufficient evidence", async () => {
  let backup = 0;
  const f = createECOSProviderFailover({ ...options(), backup: { complete: async () => { backup++; return turn; } } });
  assert(await f.gateway.complete(request()) === turn);
  assert(backup === 0 && !f.snapshot().fallbackUsed && f.snapshot().providerCalls === 1);
});

Deno.test("a prior text fallback cannot silently send later drawing reviews to the backup", async () => {
  let backupCalls=0;
  const provider=createECOSProviderFailover({...options(),allowDrawingImages:true,
    primary:fail("agent_provider_http_503"),backup:{complete:async()=>{backupCalls++;return turn;}}});
  await provider.gateway.complete(request());
  const before=provider.snapshot();
  await rejects(()=>provider.gateway.complete({...request(),inputItems:[{role:"user",content:[imagePart()]}]}),
    "agent_provider_image_fallback_unavailable");
  assert(backupCalls===1);
  assert(provider.snapshot().providerCalls===before.providerCalls);
  assert(provider.snapshot().reservedCostUsd===before.reservedCostUsd);
});

Deno.test("one outage switch retains tools, question and the same provider-call budget", async () => {
  let primary = 0, backup = 0;
  const f = createECOSProviderFailover({ ...options(), maxProviderCalls: 3,
    primary: { complete: async () => { primary++; throw new Error("agent_provider_http_503"); } },
    backup: { complete: async r => { backup++; assert(r.instructions === request().instructions);
      assert(JSON.stringify(r.inputItems) === JSON.stringify(request().inputItems)); return turn; } } });
  await f.gateway.complete(request()); await f.gateway.complete(request());
  await rejects(() => f.gateway.complete(request()), "agent_provider_call_limit");
  assert(primary === 1 && backup === 2 && f.snapshot().model === ECOS_BACKUP_MODEL);
  assert(f.snapshot().attempts[0].reservedCostUsd > 0 && f.snapshot().attempts[0].usage === null);
});

Deno.test("auth, quota, schema, identity and evidence failures do not trigger backup", async () => {
  for (const code of ["agent_provider_http_400", "agent_provider_http_401", "agent_provider_http_402", "agent_provider_http_403", "agent_provider_output_invalid", "agent_provider_model_identity_invalid", "agent_research_required"]) {
    let backup = 0;
    const f = createECOSProviderFailover({ ...options(), primary: fail(code), backup: { complete: async () => { backup++; return turn; } } });
    await rejects(() => f.gateway.complete(request()), code); assert(backup === 0);
  }
});

Deno.test("primary local timeout switches but caller cancellation never does", async () => {
  let primarySignal: AbortSignal | null = null;
  const f = createECOSProviderFailover({ ...options(), primaryTimeoutMs: 2,
    primary: { complete: r => { primarySignal = r.signal; return new Promise(() => {}); } } });
  await f.gateway.complete(request()); assert(f.snapshot().fallbackUsed);
  assert((primarySignal as AbortSignal | null)?.aborted);
  const c = new AbortController(); c.abort();
  const cancelled = createECOSProviderFailover(options());
  await rejects(() => cancelled.gateway.complete({ ...request(), signal: c.signal }), "AbortError");
  assert(cancelled.snapshot().providerCalls === 0);
});

Deno.test("shared spend reservation refuses backup without another allowance", async () => {
  let backup = 0;
  const f = createECOSProviderFailover({ ...options(), maxCostUsd: 0.01, primary: fail("agent_provider_http_504"),
    backup: { complete: async () => { backup++; return turn; } } });
  await rejects(() => f.gateway.complete(request()), "agent_provider_spend_limit");
  assert(backup === 0 && f.snapshot().providerCalls === 1 && f.snapshot().reservedCostUsd <= 0.01);
});

Deno.test("mid-research switch preserves source identity and results without provider reasoning IDs", async () => {
  let count = 0;
  const base = request();
  const deepOutput = [{ type: "reasoning", id: "private-deepseek-reasoning" },
    { type: "function_call", id: "provider-id", call_id: "call1", name: "search_project", arguments: '{"entity":"B"}' },
    { type: "function_call_output", call_id: "call1", output: '{"documentId":"B-only","page":4,"area":1220}' }];
  const f = createECOSProviderFailover({ ...options(), primary: { complete: async () => {
    if (++count === 1) return turn; throw new Error("agent_provider_http_503"); } },
    backup: { complete: async r => { const s = JSON.stringify(r.inputItems);
      assert(s.includes("B-only") && s.includes("call1") && !s.includes("private-deepseek-reasoning") && !s.includes("provider-id")); return turn; } } });
  await f.gateway.complete(base);
  await f.gateway.complete({ ...base, inputItems: [...base.inputItems, ...deepOutput] });
});

Deno.test("gateway blocks unclassified bridge 502 and mismatched model identities", async () => {
  const gateway = createOpenAIResponsesAgentGateway({ apiKey: "test", model: ECOS_BACKUP_MODEL, maxAttempts: 1,
    requireFailureClassification: true, requireReportedModel: true,
    fetchImpl: async () => new Response("{}", { status: 502 }) });
  await rejects(() => gateway.complete(request()), "agent_provider_output_or_configuration_invalid");
  const mismatch = createOpenAIResponsesAgentGateway({ apiKey: "test", model: ECOS_BACKUP_MODEL, requireReportedModel: true,
    fetchImpl: async () => Response.json({ model: "wrong", output: [] }) });
  await rejects(() => mismatch.complete(request()), "agent_provider_model_identity_invalid");
});

Deno.test("fallback cannot bypass required research or final output validation", async () => {
  const f = createECOSProviderFailover({ ...options(), primary: fail("agent_provider_http_503") });
  const result = await runECOSReadOnlyAgent({ gateway: f.gateway, instructions: request().instructions,
    inputItems: request().inputItems, tools: [], outputSchemaName: "answer", outputSchema: {},
    validateOutputText: () => false });
  assert(result.status === "failed" && result.successfulResearchCalls === 0);
});

Deno.test("fallback instances never share project state or remaining budget", async () => {
  const first = createECOSProviderFailover({ ...options(), primary: fail("agent_provider_http_503") });
  const second = createECOSProviderFailover(options());
  await first.gateway.complete(request()); await second.gateway.complete(request());
  assert(first.snapshot().fallbackUsed && !second.snapshot().fallbackUsed);
  assert(second.snapshot().providerCalls === 1);
});

Deno.test("backup failure is terminal and is not retried or switched back", async () => {
  const f = createECOSProviderFailover({ ...options(), primary: fail("agent_provider_http_503"), backup: fail("agent_provider_http_503") });
  await rejects(() => f.gateway.complete(request()), "agent_provider_unavailable_for_fallback");
  assert(f.snapshot().providerCalls === 2 && f.snapshot().attempts.every(a => a.usage === null));
});

Deno.test("caller cancellation interrupts a hanging backup within the same deadline", async () => {
  const c = new AbortController();
  const f = createECOSProviderFailover({ ...options(), primary: fail("agent_provider_http_503"),
    backup: { complete: () => { c.abort(); return new Promise(() => {}); } } });
  await rejects(() => f.gateway.complete({ ...request(), signal: c.signal }), "AbortError");
  assert(f.snapshot().providerCalls === 2 && f.snapshot().attempts[1].outcome === "rejected");
});

Deno.test("reported usage settles successful reservations but never failed unknown usage", async () => {
  const f = createECOSProviderFailover({ ...options(), primary: fail("agent_provider_http_503"),
    backup: { complete: async () => ({ ...turn, usage: { input_tokens: 100, output_tokens: 10 } }) } });
  await f.gateway.complete(request());
  const [failed, succeeded] = f.snapshot().attempts;
  assert(failed.accountedCostUsd === failed.reservedCostUsd);
  assert(succeeded.accountedCostUsd < succeeded.reservedCostUsd);
  assert(Math.abs(f.snapshot().reservedCostUsd - failed.accountedCostUsd - succeeded.accountedCostUsd) < 1e-8);
});

Deno.test("media and oversized prompts fail before either provider is charged", async () => {
  for (const inputItems of [[{ role: "user", content: [{ type: "input_image", image_url: "https://example.test/a.png" }] }],
    [{ role: "user", content: "x".repeat(250_001) }]]) {
    const f = createECOSProviderFailover(options());
    await rejects(() => f.gateway.complete({ ...request(), inputItems }), "agent_provider_budget_input_invalid");
    assert(f.snapshot().providerCalls === 0);
  }
});
