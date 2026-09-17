import { assert, assertEquals, assertThrows, assertRejects } from "jsr:@std/assert@1";
import { measureECOSDrawingMedia } from "./ecos-drawing-media-budget.ts";
import { createECOSProviderFailover } from "./ecos-provider-failover.ts";
import type { ECOSAgentModelRequest } from "./ecos-read-only-agent.ts";
import { imagePart } from "./ecos-drawing-media.fixture.ts";
const inputs = (part: unknown = imagePart()) => [{role: "user", content: [{type: "input_text", text: "Q"}, part]}];
const request = (inputItems = inputs()): ECOSAgentModelRequest => ({
  instructions: "Observe.", inputItems, tools: [], toolChoice: "none",
  outputSchemaName: "observations", outputSchema: {type: "object"}, maxOutputTokens: 4000,
  signal: new AbortController().signal,
});
const turn = {outputItems: [], toolCalls: [], outputText: "{}", usage: null};
Deno.test("media accounting separates readable image tokens from base64 size", () => {
  const media = measureECOSDrawingMedia(inputs(imagePart(900_000)));
  assertEquals(media.imageBytes, 900_000);
  assertEquals(media.imageTokenCeiling, 1024);
  assert(JSON.stringify(media.textInput).length < 300);
});
Deno.test("media enforces nine-image and aggregate-byte ceilings", () => {
  assertEquals(measureECOSDrawingMedia([{role:"user", content: Array.from({length:9}, () => imagePart())}]).images, 9);
  assertThrows(() => measureECOSDrawingMedia([{role:"user", content: Array.from({length:10}, () => imagePart())}]));
  assertThrows(() => measureECOSDrawingMedia(inputs(imagePart(3 * 1024 * 1024 + 1))));
});
Deno.test("media rejects external URLs, stored files, wrong roles and alternate formats", () => {
  for (const part of [
    {...imagePart(), image_url:"https://example.com/image.png"},
    {...imagePart(), file_id:"file-api-secret"},
    {...imagePart(), detail:"low"},
    {...imagePart(), image_url:"data:image/jpeg;base64,AAAA"},
    {type:"input_file", file_id:"file-api-secret"},
    {type:"image_url", image_url:{url:"https://example.com"}},
  ]) assertThrows(() => measureECOSDrawingMedia(inputs(part)));
  for (const role of ["assistant","system","developer"]) {
    assertThrows(() => measureECOSDrawingMedia([{role,content:[imagePart()]}]));
  }
  assertThrows(() => measureECOSDrawingMedia([{type:"function_call_output",output:[imagePart()]}]));
});
Deno.test("media rejects invalid PNGs and encoded padding variants", () => {
  assertThrows(() => measureECOSDrawingMedia(inputs({...imagePart(),image_url:"data:image/png;base64,"+btoa("not a PNG")})));
  assertThrows(() => measureECOSDrawingMedia(inputs({...imagePart(),image_url:imagePart().image_url+"="})));
});
Deno.test("image budget requires opt-in and reserves under the same provider-call allowance", async () => {
  let calls = 0;
  const primary = {complete: async () => { calls++; return turn; }};
  const base = {primary, backup:primary, maxProviderCalls:1, maxCostUsd:0.25};
  const disabled = createECOSProviderFailover(base);
  await assertRejects(() => disabled.gateway.complete(request()));
  assertEquals(calls, 0);
  const enabled = createECOSProviderFailover({...base, allowDrawingImages:true});
  await enabled.gateway.complete(request(inputs(imagePart(900_000))));
  assertEquals(calls, 1);
  assert(enabled.snapshot().reservedCostUsd > 0 && enabled.snapshot().reservedCostUsd < 0.02);
  await assertRejects(() => enabled.gateway.complete(request()), Error, "agent_provider_call_limit");
  assertEquals(calls, 1);
});
Deno.test("image outage retains its possible charge without unmeasured backup or retry", async () => {
  let backups = 0;
  const meter = createECOSProviderFailover({
    primary:{complete:async () => {throw new Error("agent_provider_http_503");}},
    backup:{complete:async () => {backups++; return turn;}},
    maxProviderCalls:2, maxCostUsd:0.25, allowDrawingImages:true,
  });
  await assertRejects(() => meter.gateway.complete(request()), Error, "agent_provider_image_fallback_unavailable");
  assertEquals(backups, 0);
  assertEquals(meter.snapshot().providerCalls, 1);
  assert(meter.snapshot().reservedCostUsd > 0);
});
Deno.test("insufficient image spend allowance rejects before sending pixels", async () => {
  let calls = 0;
  const provider = {complete:async () => {calls++; return turn;}};
  const meter = createECOSProviderFailover({primary:provider,backup:provider,maxProviderCalls:2,maxCostUsd:0.00001,allowDrawingImages:true});
  await assertRejects(() => meter.gateway.complete(request()), Error, "agent_provider_spend_limit");
  assertEquals(calls, 0);
});
