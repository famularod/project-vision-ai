import {
  bindECOSAnswerToAuthoritativeProof,
  createECOSDocumentProofReadinessInspector,
  createECOSFinalAnswerProofSession,
  ECOSAnswerProofAuthorityError,
  hasCompleteECOSDocumentProofClaim,
} from "./ecos-answer-proof-authority.ts";

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, received ${
        JSON.stringify(actual)
      }`,
    );
  }
}

const claim = Object.freeze({
  documentId: "web-document-canopy",
  projectId: "9f6f040d-cf99-41ce-86e9-05eed4bdf45b",
  sourceSha256: "a".repeat(64),
  evidenceVersion: "ecos-hosted-evidence/1.3",
  documentName: "Architectural drawings",
  revision: "1",
  pageNumber: 4,
  sheetNumber: "WPA-4",
  regionId: "visual-low-confidence-ocr-2-1",
  label: "Architectural drawings, Sheet WPA-4, Rev 1",
});

Deno.test("final proposed-source proof does not depend on exhausted research hints and binds once", async () => {
  let calls=0;
  const client={rpc:async()=>{calls++;return {data:[authorityRow()],error:null};}};
  const session=createECOSFinalAnswerProofSession(client);
  const sources=answer().supportingEvidence;
  assertEquals(await session.verifySources(sources),sources);
  assertEquals(calls,1);
  const result=await session.bind(answer());
  assertEquals(calls,1);
  assertEquals(result.supportingEvidence[0].documentRegion.x,authorityRow().region_bounds.x);
});

Deno.test("final proof excludes missing current claims but never swallows authorization failures", async () => {
  const source=answer().supportingEvidence[0];
  for(const data of [[],[authorityRow(null)]]) {
    assertEquals(await createECOSFinalAnswerProofSession({rpc:async()=>({data,error:null})}).verifySources([source]),[]);
  }
  for(const result of [{data:null,error:{code:"42501"}},{data:[{...authorityRow(),source_sha256:"b".repeat(64)}],error:null}]) {
    let failed=false;
    try {await createECOSFinalAnswerProofSession({rpc:async()=>result}).verifySources([source]);}catch(error){failed=error instanceof ECOSAnswerProofAuthorityError;}
    assertEquals(failed,true);
  }
});

Deno.test("final proposed proof retains the answer source cap before issuing requests", async () => {
  let calls=0,failed=false;
  const session=createECOSFinalAnswerProofSession({rpc:async()=>{calls++;return {data:[],error:null};}});
  try{await session.verifySources(Array.from({length:37},()=>answer().supportingEvidence[0]));}catch(error){failed=error instanceof ECOSAnswerProofAuthorityError;}
  assertEquals(failed,true);assertEquals(calls,0);
});

Deno.test("research proof readiness is exact, bounded, and rechecked at final binding", async () => {
  let calls = 0;
  let available = true;
  const client = {rpc: async (_name: string, p: Record<string, unknown>) => {
    calls++;
    return {data: [{...authorityRow(available ? {locator:{source_id:p.p_document_id}} : null), document_id:p.p_document_id,page_number:p.p_page_number}],error:null};
  }};
  const inspect = createECOSDocumentProofReadinessInspector(client);
  const signal = new AbortController().signal;
  const source = answer().supportingEvidence[0];
  assertEquals(await inspect(source, signal), "available");
  assertEquals(await inspect({...source, id:"same-claim-other-search"}, signal), "available");
  assertEquals(calls, 1);
  assertEquals(await inspect({...source, documentCitation:{...claim,documentId:"different-document",pageNumber:4}},signal), "available");
  assertEquals(calls, 2);
  for (let pageNumber=5;pageNumber<15;pageNumber++) {
    assertEquals(await inspect({...source, documentCitation:{...claim,pageNumber}},signal), "available");
  }
  assertEquals(await inspect({...source, documentCitation:{...claim,pageNumber:99}},signal), "not_checked");
  assertEquals(calls, 12);
  available = false;
  try {
    await bindECOSAnswerToAuthoritativeProof(client, answer());
    throw new Error("Stale readiness bypassed final proof binding");
  } catch (error) {
    assertEquals((error as ECOSAnswerProofAuthorityError).code, "proof_source_unavailable");
  }
  assertEquals(calls, 13);
});

Deno.test("model thinking time between research calls does not consume proof RPC budget", async () => {
  let calls = 0;
  const inspect = createECOSDocumentProofReadinessInspector({rpc:async (_name, p) => {
    calls++;
    return {data:[{...authorityRow(),document_id:p.p_document_id}],error:null};
  }});
  const source = answer().supportingEvidence[0];
  const signal = new AbortController().signal;
  assertEquals(await inspect(source,signal),"available");
  // A model turn or current-document search can take longer than the entire
  // RPC budget without doing any proof-authority work.
  await new Promise(resolve => setTimeout(resolve,8_050));
  assertEquals(await inspect({...source,documentCitation:{...claim,documentId:"second-document"}},signal),"available");
  assertEquals(calls,2);
});

Deno.test("research distinguishes unavailable proof from permission or identity failures", async () => {
  const signal = new AbortController().signal;
  const source = answer().supportingEvidence[0];
  assertEquals(await createECOSDocumentProofReadinessInspector({rpc:async()=>({data:[authorityRow(null)],error:null})})(source,signal), "unavailable");
  assertEquals(await createECOSDocumentProofReadinessInspector({rpc:async()=>{throw new Error("must not query malformed claim");}})({...source,documentRegion:null},signal),"rejected");
  for (const result of [
    {data:null,error:{code:"42501"}},
    {data:[{...authorityRow(),document_id:"wrong-document"}],error:null},
    {data:null,error:{code:"57014"}},
  ]) {
    let caught: unknown;
    try { await createECOSDocumentProofReadinessInspector({rpc:async()=>result})(source,signal); }
    catch(error) {caught=error;}
    assertEquals(caught instanceof ECOSAnswerProofAuthorityError,true);
    assertEquals((caught as ECOSAnswerProofAuthorityError).code === "proof_source_unavailable",false);
  }
});

Deno.test("overlapping proof checks serialize RPC work and coalesce exact claims", async () => {
  let calls=0, active=0, maximumActive=0;
  const inspect=createECOSDocumentProofReadinessInspector({rpc:async (_name,p)=>{
    calls++; active++; maximumActive=Math.max(maximumActive,active);
    await new Promise(resolve=>setTimeout(resolve,10));
    active--;
    return {data:[{...authorityRow(),document_id:p.p_document_id}],error:null};
  }});
  const source=answer().supportingEvidence[0],signal=new AbortController().signal;
  const other={...source,documentCitation:{...claim,documentId:"second-document"}};
  assertEquals(await Promise.all([inspect(source,signal),inspect(source,signal),inspect(other,signal)]),["available","available","available"]);
  assertEquals(calls,2);
  assertEquals(maximumActive,1);
});

Deno.test("active proof work still stops at the shared eight-second allowance", async () => {
  let calls=0;
  const inspect=createECOSDocumentProofReadinessInspector({rpc:()=>{
    calls++;
    let rejectRequest: (error:unknown)=>void=()=>{};
    const request=new Promise<Readonly<{data:unknown;error:unknown}>>((_resolve,reject)=>{rejectRequest=reject;});
    return Object.assign(request,{abortSignal(signal:AbortSignal){
      signal.addEventListener("abort",()=>rejectRequest(signal.reason),{once:true});
      return request;
    }});
  }});
  const source=answer().supportingEvidence[0],signal=new AbortController().signal;
  assertEquals(await inspect(source,signal),"not_checked");
  assertEquals(await inspect({...source,documentCitation:{...claim,documentId:"second-document"}},signal),"not_checked");
  assertEquals(calls,1);
});

Deno.test("research proof checks forward cancellation to the database request", async () => {
  let forwarded = false;
  const request = Object.assign(Promise.resolve({data:[authorityRow()],error:null}), {
    abortSignal(signal: AbortSignal) {forwarded = signal instanceof AbortSignal; return this;},
  });
  const inspect = createECOSDocumentProofReadinessInspector({rpc:()=>request});
  assertEquals(await inspect(answer().supportingEvidence[0],new AbortController().signal),"available");
  assertEquals(forwarded,true);
  const controller = new AbortController(); controller.abort();
  let aborted=false;
  try {await inspect(answer().supportingEvidence[0],controller.signal);} catch {aborted=true;}
  assertEquals(aborted,true);
});

Deno.test("empty current-proof result rejects one research candidate but final binding stays strict", async () => {
  const client = {rpc:async()=>({data:[],error:null})};
  assertEquals(await createECOSDocumentProofReadinessInspector(client)(answer().supportingEvidence[0],new AbortController().signal),"rejected");
  let caught: unknown;
  try {await bindECOSAnswerToAuthoritativeProof(client,answer());} catch(error) {caught=error;}
  assertEquals((caught as ECOSAnswerProofAuthorityError).code,"proof_authority_identity_mismatch");
  assertEquals((caught as ECOSAnswerProofAuthorityError).reason,"claim_not_current");
});

function answer() {
  return {
    assurance: { status: "verified_with_limits" },
    supportingEvidence: [{
      sourceType: "document",
      recordId: claim.documentId,
      documentCitation: claim,
      documentRegion: {
        id: claim.regionId,
        label: "CANOPY A 19'-10 x 15'-4",
        x: 0.115,
        y: 0.190196,
        width: 0.864697,
        height: 0.607843,
        rawSource: "vision",
      },
    }],
  };
}

function authorityRow(
  sourceView: unknown = { locator: { source_id: claim.documentId } },
) {
  return {
    document_id: claim.documentId,
    project_id: claim.projectId,
    source_sha256: claim.sourceSha256,
    evidence_version: claim.evidenceVersion,
    source_revision: claim.revision,
    page_number: claim.pageNumber,
    sheet_number: claim.sheetNumber,
    region_id: claim.regionId,
    region_bounds: { x: 0.484, y: 0.714, width: 0.011, height: 0.002 },
    source_view_citation: sourceView,
  };
}

Deno.test("verified answers replace search-index geometry with authoritative proof bounds", async () => {
  const calls: unknown[] = [];
  const result = await bindECOSAnswerToAuthoritativeProof({
    rpc: async (name, parameters) => {
      calls.push({ name, parameters });
      return { data: [authorityRow()], error: null };
    },
  }, answer()) as ReturnType<typeof answer>;
  assertEquals(calls.length, 1);
  assertEquals(result.supportingEvidence[0].documentRegion, {
    id: claim.regionId,
    label: "CANOPY A 19'-10 x 15'-4",
    x: 0.484,
    y: 0.714,
    width: 0.011,
    height: 0.002,
    rawSource: "hosted_proof_authority",
  });
});

Deno.test("verified answers fail before completion when the protected page is absent", async () => {
  let error: unknown;
  try {
    await bindECOSAnswerToAuthoritativeProof({
      rpc: async () => ({ data: [authorityRow(null)], error: null }),
    }, answer());
  } catch (caught) {
    error = caught;
  }
  assertEquals(error instanceof ECOSAnswerProofAuthorityError, true);
  assertEquals(
    (error as ECOSAnswerProofAuthorityError).code,
    "proof_source_unavailable",
  );
});

Deno.test("verified answers fail closed on authority identity drift", async () => {
  let error: unknown;
  try {
    await bindECOSAnswerToAuthoritativeProof({
      rpc: async () => ({
        data: [{ ...authorityRow(), region_id: "different-region" }],
        error: null,
      }),
    }, answer());
  } catch (caught) {
    error = caught;
  }
  assertEquals(
    (error as ECOSAnswerProofAuthorityError).code,
    "proof_authority_identity_mismatch",
  );
});

Deno.test("insufficient-evidence responses do not require an openable proof", async () => {
  const value = {
    ...answer(),
    assurance: { status: "insufficient_evidence" },
  };
  let called = false;
  const result = await bindECOSAnswerToAuthoritativeProof({
    rpc: async () => {
      called = true;
      return { data: [], error: null };
    },
  }, value);
  assertEquals(result, value);
  assertEquals(called, false);
});

Deno.test("shape screening is not authority and cited malformed proof still fails", async () => {
  assertEquals(hasCompleteECOSDocumentProofClaim(answer().supportingEvidence[0]), true);
  const invalid = {...answer(), supportingEvidence: [{...answer().supportingEvidence[0], documentRegion: null}]};
  assertEquals(hasCompleteECOSDocumentProofClaim(invalid.supportingEvidence[0]), false);
  let calls = 0;
  try {
    await bindECOSAnswerToAuthoritativeProof({rpc: async () => {calls++; return {data:[authorityRow()],error:null};}}, invalid);
    throw new Error("Malformed direct citation was accepted");
  } catch (error) {
    assertEquals(error instanceof ECOSAnswerProofAuthorityError, true);
    assertEquals((error as ECOSAnswerProofAuthorityError).reason, "region_id_mismatch");
  }
  assertEquals(calls, 0);
});

Deno.test("RPC rejection diagnostics do not retain untrusted RPC messages", async () => {
  try {
    await bindECOSAnswerToAuthoritativeProof({rpc: async () => ({data:null,error:{code:"22023",message:"private source content and token must not be logged"}})}, answer());
    throw new Error("Rejected RPC was accepted");
  } catch (error) {
    assertEquals(error instanceof ECOSAnswerProofAuthorityError, true);
    assertEquals((error as ECOSAnswerProofAuthorityError).reason, "rpc_rejected");
    assertEquals(JSON.stringify(error).includes("private source"), false);
  }
});
