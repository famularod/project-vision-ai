import {assertEquals, assertRejects} from "jsr:@std/assert@1";
import {createECOSAgentProjectToolRegistry, type ECOSAgentProjectSource} from "./ecos-agent-project-tools.ts";
import type {ECOSDrawingImageReceipt} from "./ecos-protected-drawing-image.ts";
const source: ECOSAgentProjectSource = {
  id:"found-page",sourceType:"document",title:"Drawing",excerpt:"Cabinet notes",updatedAt:null,score:1,
  documentCitation:{projectId:"project-a",documentId:"doc-a",sourceSha256:"a".repeat(64),revision:"1",pageNumber:43,
    evidenceVersion:"ecos-hosted-evidence/1.3",regionId:"region-1"},documentRegion:{id:"region-1"},
};
const receipt: ECOSDrawingImageReceipt = {
  imageHandle:"private-handle",projectId:"project-a",documentId:"doc-a",sourceSha256:"a".repeat(64),
  revision:"1",pageNumber:43,rasterSha256:"b".repeat(64),width:2000,height:1500,
  viewedScope:"one_complete_page_raster",semanticVerified:false,absenceClaimsAllowed:false,answerEvidenceEligible:false,
};
function setup(enabled=true, altered: Partial<ECOSDrawingImageReceipt> = {}, supplied=source,
  options: { candidates?: ECOSAgentProjectSource[]; imageError?: string; readPage?: (source: ECOSAgentProjectSource, page: number, question: string, signal: AbortSignal) => Promise<readonly ECOSAgentProjectSource[]> } = {}) {
  let reads=0;
  const inspected: ECOSAgentProjectSource[]=[];
  const registry=createECOSAgentProjectToolRegistry({
    candidates:options.candidates || [supplied],snapshotCapturedAt:"2026-09-15",
    readCurrentDrawingPage:options.readPage,
    inventory:{sourceCounts:{document:1},unavailableChannels:[],limitations:[],candidateCount:1},
    searchCurrentDocuments:async () => ({sources:[supplied],matchedPageCount:1,semanticAvailable:false}),
    ...(enabled ? {inspectCurrentDrawingImage:async (actual: ECOSAgentProjectSource) => {
      reads++;
      inspected.push(actual);
      if(options.imageError)throw new Error(options.imageError);
      return {mode:"unverified_visual_observations" as const,source:{...receipt,...altered},
        observations:[{kind:"literal_text" as const,text:"Cabinet note",viewIds:["T1"]}],limitations:[],views:[],
        semanticVerified:false as const,answerEvidenceEligible:false as const,
        coverage:"supplied_image_only_not_complete_semantic_coverage" as const};
    }} : {}),
  });
  const call=async (name:string,args:Record<string,unknown>) =>
    await registry.tools.find(t=>t.name===name)!.execute(args,{signal:new AbortController().signal}) as Record<string,unknown>;
  const research=() => call("search_project_evidence",{query:"cabinet",sourceTypes:["document"],limit:8});
  return {registry,call,research,reads:()=>reads,inspected};
}
const args={sourceId:source.id,question:"Read cabinetry notes"};
Deno.test("image tool is opt-in and requires an actually researched source, never a URL", async () => {
  assertEquals(setup(false).registry.tools.some(t=>t.name==="inspect_project_drawing_image"),false);
  const test=setup();
  assertEquals((await test.call("inspect_project_drawing_image",args)).error,"researched_drawing_required");
  await test.research();
  assertEquals((await test.call("inspect_project_drawing_image",{...args,sourceId:"https://file"})).error,"researched_drawing_required");
  assertEquals(test.reads(),0);
});
Deno.test("visual tool output is not qualifying evidence and does not reveal private image handles", async () => {
  const test=setup(); await test.research();
  const result=await test.call("inspect_project_drawing_image",args);
  const tool=test.registry.tools.find(t=>t.name==="inspect_project_drawing_image")!;
  assertEquals(tool.providesEvidence,false);
  assertEquals(tool.qualifiesAsEvidence!(result),false);
  assertEquals(result.answerEvidenceEligible,false);
  assertEquals(JSON.stringify(result).includes("private-handle"),false);
  assertEquals(test.registry.researchSources(),[source]);
});
Deno.test("image tool rejects callback identity drift before exposing observations", async () => {
  for (const altered of [{projectId:"other"},{documentId:"other"},{sourceSha256:"c".repeat(64)},{revision:"2"},{pageNumber:44}]) {
    const test=setup(true,altered); await test.research();
    await assertRejects(() => test.call("inspect_project_drawing_image",args),Error,"drawing_visual_source_identity_invalid");
  }
});
Deno.test("visual inspections share the existing four fresh-document reads", async () => {
  const test=setup(); await test.research();
  for (let i=0;i<3;i++) await test.call("search_current_project_documents",{query:"cabinet notes",limit:8});
  await test.call("inspect_project_drawing_image",args);
  assertEquals((await test.call("inspect_project_drawing_image",args)).error,"document_search_budget_reached");
  assertEquals(test.reads(),1);
});
Deno.test("search-only page references request exact page evidence before spending an image read",async()=>{
  const test=setup(true,{}, {...source,documentCitation:{...source.documentCitation,regionId:null},documentRegion:undefined});
  await test.research();
  for(let i=0;i<5;i++)assertEquals((await test.call("inspect_project_drawing_image",args)).error,"exact_drawing_reference_required");
  assertEquals(test.reads(),0);
});

const incomplete={...source,documentCitation:{...source.documentCitation,regionId:null},documentRegion:undefined};
const reference={...source,id:"actual-region-source",excerpt:"Its own region text"};
Deno.test("image reference recovery uses exact existing source without relabeling search text",async()=>{
  let pageReads=0;
  const test=setup(true,{},incomplete,{candidates:[incomplete,reference],readPage:async()=>{pageReads++;return [];}});
  await test.research();
  const result=await test.call("inspect_project_drawing_image",args);
  assertEquals(result.sourceId,reference.id);
  assertEquals(test.inspected,[reference]);
  assertEquals(pageReads,0);
  assertEquals(test.registry.researchSources().find(s=>s.id===source.id),incomplete);
});
Deno.test("automatic page recovery rejects every identity drift and returns only the inspected id",async()=>{
  let pageReads=0;
  const wrongs=Object.entries({projectId:"other",documentId:"other",sourceSha256:"c".repeat(64),evidenceVersion:"old",revision:"2",pageNumber:44})
    .map(([key,value])=>({...reference,id:`wrong-${key}`,documentCitation:{...reference.documentCitation,[key]:value}}));
  const test=setup(true,{},incomplete,{readPage:async(actual,page,question)=>{
    pageReads++;assertEquals(actual,incomplete);assertEquals(page,43);assertEquals(question,args.question);
    return [...wrongs,reference];
  }});
  await test.research();
  assertEquals((await test.call("inspect_project_drawing_image",args)).sourceId,reference.id);
  assertEquals(test.inspected,[reference]);assertEquals(pageReads,1);
  assertEquals(test.registry.researchSources().some(s=>s.id.startsWith("wrong-")),false);
});
Deno.test("reference recovery reserves remaining read capacity before contacting storage",async()=>{
  let pageReads=0;
  const test=setup(true,{},incomplete,{readPage:async()=>{pageReads++;return [reference];}});
  await test.research();
  for(let i=0;i<3;i++)await test.call("search_current_project_documents",{query:"cabinet notes",limit:8});
  assertEquals((await test.call("inspect_project_drawing_image",args)).error,"document_search_budget_reached");
  assertEquals(pageReads,0);assertEquals(test.reads(),0);
});
Deno.test("failed recovery stays bounded and never fabricates a region",async()=>{
  let pageReads=0;
  const test=setup(true,{},incomplete,{readPage:async()=>{pageReads++;return [incomplete,{...reference,id:incomplete.id}];}});
  await test.research();
  for(let i=0;i<3;i++)assertEquals((await test.call("inspect_project_drawing_image",args)).error,"exact_drawing_reference_required");
  assertEquals((await test.call("inspect_project_drawing_image",args)).error,"document_search_budget_reached");
  assertEquals(pageReads,3);assertEquals(test.reads(),0);
});
Deno.test("recovered references still require successful authenticated image access",async()=>{
  const test=setup(true,{},incomplete,{readPage:async()=>[reference],imageError:"drawing_image_authority_unavailable"});
  await test.research();
  await assertRejects(()=>test.call("inspect_project_drawing_image",args),Error,"drawing_image_authority_unavailable");
  assertEquals(test.registry.researchSources(),[incomplete]);
  assertEquals(test.registry.verifiedProofSourceIds(),[]);
});
Deno.test("cancellation after recovery cannot inspect or retain the recovered source",async()=>{
  const controller=new AbortController();
  const test=setup(true,{},incomplete,{readPage:async()=>{controller.abort();return [reference];}});
  await test.research();
  await assertRejects(async()=>await test.registry.tools.find(t=>t.name==="inspect_project_drawing_image")!
    .execute(args,{signal:controller.signal}),DOMException);
  assertEquals(test.reads(),0);
  assertEquals(test.registry.researchSources(),[incomplete]);
});
Deno.test("opt-in page opening automatically inspects the exact returned page and shares its budget",async()=>{
  const test=setup(true,{},source,{readPage:async()=>[reference]});
  await test.research();
  const result=await test.call("read_project_drawing_page",{...args,pageNumber:43});
  assertEquals(result.mode,"prepared_text_and_visual_research");
  assertEquals((result.visualResearch as Record<string,unknown>).sourceId,reference.id);
  assertEquals(test.inspected,[reference]);
  await test.call("search_current_project_documents",{query:"cabinet notes",limit:8});
  await test.call("search_current_project_documents",{query:"cabinet notes",limit:8});
  assertEquals((await test.call("inspect_project_drawing_image",args)).error,"document_search_budget_reached");
});
Deno.test("page opening never inspects the original old page when the requested page has no exact source",async()=>{
  const test=setup(true,{},source,{readPage:async()=>[reference]});
  await test.research();
  const result=await test.call("read_project_drawing_page",{...args,pageNumber:44});
  assertEquals(result.mode,"prepared_text_only");
  assertEquals(result.sources,[]);
  assertEquals(test.reads(),0);
});
