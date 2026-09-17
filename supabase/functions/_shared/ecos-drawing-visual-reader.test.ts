import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { createECOSDrawingVisualReader } from "./ecos-drawing-visual-reader.ts";
import { createECOSProviderFailover } from "./ecos-provider-failover.ts";
import { createOpenAIResponsesAgentGateway } from "./ecos-read-only-agent.ts";
import { createECOSAgentModelBridgeHandler } from "../ecos-agent-model-bridge/index.ts";
import { imagePart } from "./ecos-drawing-media.fixture.ts";
import type { createECOSDrawingImageSession, ECOSDrawingImageReceipt } from "./ecos-protected-drawing-image.ts";

const receipt: ECOSDrawingImageReceipt = {
  imageHandle:"handle-1", projectId:"project-a", documentId:"doc-a", revision:"1",
  pageNumber:43, sourceSha256:"a".repeat(64), rasterSha256:"b".repeat(64),
  width:2000,height:1500,viewedScope:"one_complete_page_raster",
  semanticVerified:false,absenceClaimsAllowed:false,answerEvidenceEligible:false,
};
const observation = {observations:[{kind:"literal_text" as const,text:"MICROWAVE BY OTHERS",viewIds:["T1"]}],limitations:["Small text is unreadable in this view."]};
function setup({enable = true, size = 33, output = JSON.stringify(observation), toolCall = false} = {}) {
  let calls = 0, access = true;
  const part = imagePart(size);
  const images: ReturnType<typeof createECOSDrawingImageSession> = {
    open:async () => receipt, close:() => {access = false;},
    consume:async (handle, signal, consumer) => {
      if (!access || handle !== receipt.imageHandle) throw new Error("current image required");
      return await consumer({dataUrl:part.image_url,width:receipt.width,height:receipt.height,sha256:receipt.rasterSha256},receipt,signal);
    },
  };
  const bridge = createECOSAgentModelBridgeHandler({
    serviceRoleKey:"service-role-test-secret", workerToken:"worker_token_abcdefghijklmnopqrstuvwxyz012345",
    provider:"deepseek",providerKey:"provider-test-secret",allowDrawingImages:enable,
    fetchImplementation:async (url, init) => {
      calls++;
      assertEquals(url, "https://api.deepseek.com/responses");
      const body = JSON.parse(String(init?.body));
      assertEquals(body.store,false);
      assertEquals(body.tool_choice,"none");
      assertEquals(body.tools,[]);
      assert(body.input[0].content[0].text.includes('"pageNumber":43'));
      assertEquals(body.input[0].content.find((value: {type:string})=>value.type==="input_image"),part);
      return Response.json({
        model:"deepseek-v4-flash",status:"completed",
        output:toolCall ? [{type:"function_call",call_id:"c1",name:"read_file",arguments:"{}"}] :
          [{type:"message",role:"assistant",content:[{type:"output_text",text:output}]}],
        usage:{input_tokens:1400,output_tokens:250},
      });
    },
  });
  const primary = createOpenAIResponsesAgentGateway({
    apiKey:"service-role-test-secret",model:"deepseek-v4-flash",reasoningEffort:"none",maxAttempts:1,
    endpoint:"https://private-bridge.test",requireFailureClassification:true,
    fetchImpl:async (url, init) => {
      const headers = new Headers(init?.headers);
      headers.set("x-ecos-worker-token","worker_token_abcdefghijklmnopqrstuvwxyz012345");
      return await bridge(new Request(url,{...init,headers}));
    },
  });
  const meter = createECOSProviderFailover({
    primary,backup:{complete:async () => {throw new Error("Unexpected backup");}},
    maxProviderCalls:3,maxCostUsd:0.25,allowDrawingImages:true,
  });
  return {read:createECOSDrawingVisualReader({images,provider:meter,
    prepareViews:async page=>[{image:page,view:{viewId:"T1",parentRasterSha256:page.sha256,cropSha256:page.sha256,
      parentWidth:page.width,parentHeight:page.height,pixelBox:[0,0,page.width,page.height],width:page.width,height:page.height}}],
  }),meter,calls:() => calls,close:images.close};
}
Deno.test("protected visual adapter traverses metering and bridge with one bounded image request", async () => {
  const test = setup({size:900_000});
  const result = await test.read("handle-1","What cabinetry is shown?",new AbortController().signal);
  assertEquals(test.calls(),1);
  assertEquals(test.meter.snapshot().providerCalls,1);
  assertEquals(result.observations,observation.observations);
  assertEquals(result.source.documentId,"doc-a");
  assertEquals(result.answerEvidenceEligible,false);
  assertEquals(result.semanticVerified,false);
  assert(!JSON.stringify(result).includes("data:image"));
});
Deno.test("large images remain disabled at the bridge unless explicitly enabled", async () => {
  const test = setup({enable:false,size:900_000});
  await assertRejects(() => test.read("handle-1","Read the notes",new AbortController().signal));
  assertEquals(test.calls(),0);
});
Deno.test("image read cannot accept model-authored authority or final answer fields", async () => {
  for (const output of [
    {...observation,answer:"The drawing has no occupant load"},
    {...observation,semanticVerified:true},
    {observations:[{kind:"verified_fact",text:"No occupant load"}],limitations:[]},
    {...observation,observations:Array.from({length:25},() => observation.observations[0])},
    {observations:[],limitations:[""]},
  ]) {
    const test = setup({output:JSON.stringify(output)});
    await assertRejects(() => test.read("handle-1","Read the notes",new AbortController().signal),Error,"drawing_visual_output_invalid");
  }
});
Deno.test("visual prose, even when structured, remains unverified and scoped to the supplied image", async () => {
  const test = setup({output:JSON.stringify({
    observations:[{kind:"visual_interpretation",text:"No occupant load exists anywhere in the drawing.",viewIds:["T1"]}],limitations:[],
  })});
  const result = await test.read("handle-1","What is the occupant load?",new AbortController().signal);
  // Transport is not semantic entailment. This must never become supporting
  // evidence without the separate claim reviewer, even if the model misbehaves.
  assertEquals(result.answerEvidenceEligible,false);
  assertEquals(result.coverage,"supplied_image_only_not_complete_semantic_coverage");
  assertEquals(result.source.absenceClaimsAllowed,false);
});
Deno.test("visual output rejects tool calls and duplicate JSON keys", async () => {
  for (const options of [{toolCall:true},{output:'{"observations":[],"observations":[],"limitations":[]}'}]) {
    const test = setup(options);
    await assertRejects(() => test.read("handle-1","Read notes",new AbortController().signal));
  }
});
Deno.test("revoked handles, cancellation and bad questions cause no provider call", async () => {
  const test = setup();
  const aborted = new AbortController(); aborted.abort();
  await assertRejects(() => test.read("handle-1","Read notes",aborted.signal));
  await assertRejects(() => test.read("handle-1","",new AbortController().signal));
  await assertRejects(() => test.read("unknown","Read notes",new AbortController().signal));
  test.close();
  await assertRejects(() => test.read("handle-1","Read notes",new AbortController().signal));
  assertEquals(test.calls(),0);
});
