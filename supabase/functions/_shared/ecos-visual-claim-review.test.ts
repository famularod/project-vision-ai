import {assert,assertEquals,assertRejects} from "jsr:@std/assert@1";
import {createECOSVisualClaimReviewer} from "./ecos-visual-claim-review.ts";
import {createECOSProviderFailover} from "./ecos-provider-failover.ts";
import type {createECOSDrawingImageSession,ECOSDrawingImageReceipt} from "./ecos-protected-drawing-image.ts";
import {imagePart} from "./ecos-drawing-media.fixture.ts";
const receipt:ECOSDrawingImageReceipt={
  imageHandle:"h1",projectId:"p1",documentId:"d1",sourceSha256:"a".repeat(64),revision:"1",pageNumber:43,
  rasterSha256:"b".repeat(64),width:2000,height:1500,viewedScope:"one_complete_page_raster",
  semanticVerified:false,absenceClaimsAllowed:false,answerEvidenceEligible:false,
};
const claims=[{id:"c1",statement:"The drawing explicitly labels an occupant load of 200."}];
const assessment={claimId:"c1",verdict:"supported",basis:"printed_text",viewIds:["T1"],printedSupport:"OCC. LOAD: 200",reason:"The label is visible."};
const signal=()=>new AbortController().signal;
function setup(rows:unknown[]=[assessment]){
  let calls=0,access=true,lastInput="";
  const images:ReturnType<typeof createECOSDrawingImageSession>={
    open:async()=>receipt,close:()=>{access=false;},
    consume:async(handle,signal,consumer)=>{
      if(!access||handle!=="h1")throw new Error("access denied");
      return await consumer({dataUrl:imagePart().image_url,width:2000,height:1500,sha256:receipt.rasterSha256},receipt,signal);
    },
  };
  const gateway={complete:async(request:{inputItems:readonly unknown[]})=>{
    calls++;lastInput=JSON.stringify(request.inputItems);
    return {outputItems:[],toolCalls:[],outputText:JSON.stringify({assessments:rows}),usage:null};
  }};
  const provider=createECOSProviderFailover({primary:gateway,backup:gateway,maxProviderCalls:3,maxCostUsd:0.25,allowDrawingImages:true});
  const review=createECOSVisualClaimReviewer({images,provider,prepareViews:async page=>[
    {image:page,view:{viewId:"T1",parentRasterSha256:page.sha256,cropSha256:page.sha256,
      parentWidth:2000,parentHeight:1500,width:2000,height:1500,pixelBox:[0,0,2000,1500]}},
  ]});
  return {review,provider,calls:()=>calls,input:()=>lastInput,close:images.close};
}
Deno.test("visual review binds exact claims, source revision, pixels and views without promotion",async()=>{
  const test=setup();
  const result=await test.review("h1",claims,signal());
  assertEquals(result.assessments[0].verdict,"supported");
  assertEquals(result.answerEvidenceEligible,false);
  assertEquals(result.requiresFinalAuthorityBinding,true);
  assert(test.input().includes("data:image/png;base64,"));
  assertEquals(JSON.parse(JSON.parse(test.input())[0].content[0].text).source.pageNumber,43);
  assertEquals(result.claims,claims);
  assertEquals(test.provider.snapshot().providerCalls,1);
  const changed=await test.review("h1",[{id:"c1",statement:"The load is 80."}],signal());
  assert(result.reviewInputSha256!==changed.reviewInputSha256);
});
Deno.test("reviewer cannot approve absence inference or unreadable/uncited support",async()=>{
  for(const patch of [{basis:"absence_inference"},{basis:"unreadable"},{viewIds:[]},{printedSupport:""}]){
    const test=setup([{...assessment,...patch}]);
    const result=await test.review("h1",claims,signal());
    assertEquals(result.assessments[0].verdict,"insufficient");
  }
});
Deno.test("review must cover each exact claim once and cannot invent view IDs",async()=>{
  for(const rows of [[],[assessment,assessment],[{...assessment,claimId:"other"}],[{...assessment,viewIds:["T99"]}],[{...assessment,viewIds:["T1","T1"]}]]){
    await assertRejects(()=>setup(rows).review("h1",claims,signal()));
  }
});
Deno.test("contradictions and insufficient evidence remain negative assessments",async()=>{
  for(const verdict of ["contradicted","insufficient"]){
    const result=await setup([{...assessment,verdict}]).review("h1",claims,signal());
    assertEquals(result.assessments[0].verdict,verdict);
  }
});
Deno.test("review rejects invalid input or lost access before incurring a provider call",async()=>{
  const test=setup();const aborted=new AbortController();aborted.abort();
  await assertRejects(()=>test.review("h1",claims,aborted.signal));
  await assertRejects(()=>test.review("h1",[],signal()));
  await assertRejects(()=>test.review("h1",[claims[0],claims[0]],signal()));
  test.close();await assertRejects(()=>test.review("h1",claims,signal()));
  assertEquals(test.calls(),0);
});
