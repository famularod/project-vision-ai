import { sha256Hex } from "./vendor/ecos-drawing-provider-reservation.ts";

let handle: (r: Request) => Promise<Response>;
const serve = Deno.serve;
// Capture the real request handler without opening a listener.
(Deno as unknown as { serve: unknown }).serve = (h: typeof handle) => { handle = h; };
const { geminiThinkingLevel, privateStructuredFailureCode } = await import("./index.ts");
(Deno as unknown as { serve: unknown }).serve = serve;

Deno.test("private single-label reasoning budget cannot inherit broad drawing settings", () => {
  const old = Deno.env.get("ECOS_GEMINI_DRAWING_THINKING_LEVEL");
  try {
    Deno.env.set("ECOS_GEMINI_DRAWING_THINKING_LEVEL", "HIGH");
    if (geminiThinkingLevel("gemini-3.6-flash", "ecos_drawing_page_analysis") !== "MINIMAL") throw Error("Budget inherited");
    if (geminiThinkingLevel("gemini-3-pro", "ecos_drawing_page_analysis") !== "LOW") throw Error("Invalid pro budget");
  } finally {
    if (old === undefined) Deno.env.delete("ECOS_GEMINI_DRAWING_THINKING_LEVEL");
    else Deno.env.set("ECOS_GEMINI_DRAWING_THINKING_LEVEL", old);
  }
});

Deno.test("private failures distinguish token exhaustion from malformed output without exposing provider text", () => {
  if (privateStructuredFailureCode({ candidates: [{ finishReason: "MAX_TOKENS" }] }) !== "analysis_output_token_limit") throw Error("Token limit lost");
  if (privateStructuredFailureCode({ candidates: [{ finishReason: "STOP" }] }) !== "analysis_invalid_structured_output") throw Error("Invalid output lost");
  if (privateStructuredFailureCode({ candidates: [{ finishReason: "SAFETY" }] }) !== "analysis_output_blocked") throw Error("Safety failure lost");
});

Deno.test("private drawing preview rejects unauthorized, broad and non-shadow requests before paid work", async () => {
  const oldToken = Deno.env.get("ECOS_SERVICE_WORKER_TOKEN");
  const oldUrl = Deno.env.get("SUPABASE_URL");
  const oldKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = ((_input: unknown, _init: unknown) => {
    calls++;
    return Promise.resolve(new Response(JSON.stringify({ mode: "publish" }), {
      headers: { "content-type": "application/json" },
    }));
  }) as typeof fetch;
  const assert = (v: unknown) => { if (!v) throw new Error("private boundary assertion failed"); };
  const token = "unit-test-token-not-a-credential";
  try {
    Deno.env.set("ECOS_SERVICE_WORKER_TOKEN", token);
    Deno.env.set("SUPABASE_URL", "https://unit-test.invalid");
    Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "unit-test-service-key");
    const bounds = { x: .1, y: .2, width: .03, height: .01 };
    const image = "data:image/png;base64,aGVsbG8=";
    const identity = {
      organizationId: "test-org", projectId: "test-project", documentId: "test-document",
      sourceSha256: "a".repeat(64), pageNumber: 1,
      hostedJobId: "11111111-1111-4111-8111-111111111111",
      hostedClaimToken: "22222222-2222-4222-8222-222222222222",
      evidenceVersion: "ecos-hosted-evidence/1.3",
      visualExceptionFingerprint: "b".repeat(64), visualRegionKey: "low-confidence-ocr-test",
    };
    const canonical = { ...identity, schemaVersion: "ecos-visual-provider-operation/1.0" };
    const providerOperationId = await sha256Hex(new TextEncoder().encode(JSON.stringify(
      Object.fromEntries(Object.entries(canonical).sort(([a], [b]) => a.localeCompare(b))),
    )));
    const body = { ...identity, providerOperationId, schemaVersion: "ecos-drawing-page-analysis/2.0",
      documentName: "Unit test", analysisPass: "page_tiles", imageDataUrl: image,
      tileBounds: bounds, tileImages: [{ bounds, imageDataUrl: image }],
      visualException: { regionKey: identity.visualRegionKey, reason: "Unit fixture", bounds,
        diagnosticCandidates: [{ text: "20'-0\"", bounds, confidence: .5,
          source: "fixed_visual_tile_measurement_transcription_correction" }] },
    };
    const send = (value: unknown, authorization?: string) => handle(new Request("https://unit-test.invalid", {
      method: "POST", headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) },
      body: JSON.stringify(value),
    }));
    assert((await send(body)).status === 401);
    assert((await send(body, "Bearer wrong")).status === 403);
    assert((await send({ ...body, comparisonMode: true }, `Bearer ${token}`)).status === 400);
    assert((await send({ ...body, analysisPass: "overview" }, `Bearer ${token}`)).status === 400);
    assert(calls === 0);
    assert((await send(body, `Bearer ${token}`)).status === 403);
    assert(calls === 1); // Only mode lookup; no begin/reservation/model calls.
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, old] of [["ECOS_SERVICE_WORKER_TOKEN",oldToken],["SUPABASE_URL",oldUrl],["SUPABASE_SERVICE_ROLE_KEY",oldKey]]) {
      if (old === undefined) Deno.env.delete(key!); else Deno.env.set(key!,old);
    }
  }
});
