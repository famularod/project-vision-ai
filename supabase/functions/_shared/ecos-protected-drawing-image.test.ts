import { assert, assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import { buildProtectedSourceCitation } from "./ecos-protected-drawing-image.fixture.ts";
import { createECOSDrawingImageSession } from "./ecos-protected-drawing-image.ts";
import { ECOS_PROTECTED_SOURCE_ENDPOINT, parseStrictJSON, readBoundedText } from "./ecos-protected-drawing-image-protocol.ts";

const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const claim = {
  projectId: "72e941d8-8114-4082-a976-ae5b2b5daba9", documentId: "drawing-1",
  sourceSha256: "a".repeat(64), evidenceVersion: "ecos-hosted-evidence/1.3",
  revision: "1", pageNumber: 6, sheetNumber: "A-2.6", regionId: "region-1",
};
const source = { sourceType: "document", documentCitation: claim, documentRegion: {id: claim.regionId} };
const signal = () => new AbortController().signal;
function pngBytes() {
  // Authority/transport fixture only, not a decoded/visually inspected PNG.
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  new DataView(bytes.buffer).setUint32(8, 13);
  bytes.set([73, 72, 68, 82], 12);
  new DataView(bytes.buffer).setUint32(16, 2);
  new DataView(bytes.buffer).setUint32(20, 3);
  return bytes;
}
async function setup() {
  const bytes = pngBytes();
  const sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map(n => n.toString(16).padStart(2, "0")).join("");
  const citation = buildProtectedSourceCitation({
    ownerId, projectId: claim.projectId, documentId: claim.documentId,
    sourceSha256: claim.sourceSha256, rasterSha256: sha,
    rasterByteCount: bytes.length, rasterWidth: 2, rasterHeight: 3,
  });
  const row = {
    document_id: claim.documentId, project_id: claim.projectId,
    source_sha256: claim.sourceSha256, evidence_version: claim.evidenceVersion,
    source_revision: claim.revision, page_number: claim.pageNumber,
    sheet_number: claim.sheetNumber, region_id: claim.regionId,
    region_bounds: {x: 0, y: 0, width: 1, height: 1}, source_view_citation: citation,
  };
  let rpcCalls = 0, fetchCalls = 0, currentTime = 1_000;
  let mutateRow = (_row: typeof row, _call: number) => {};
  let mutateBody = (_body: ReturnType<typeof body>) => {};
  let transformResponse = (response: Response) => response;
  let onFetch = () => {};
  const client = { rpc: async (name: string, args: Record<string, unknown>) => {
    rpcCalls++;
    assertEquals(name, "dave_verify_current_ecos_document_proof");
    assertEquals(args.p_project_id, claim.projectId);
    assertEquals(args.p_document_id, claim.documentId);
    assertEquals(args.p_page_number, claim.pageNumber);
    const value = structuredClone(row);
    mutateRow(value, rpcCalls);
    return { data: [value], error: null };
  }};
  function body(requestId: string) {
    const locator = citation.locator;
    const pageKeys = [
      "organization_id", "project_id", "owner_id", "source_id", "source_sha256",
      "source_revision", "source_page_count", "page_number", "execution_id",
      "binding_id", "extraction_version", "authority_decision_id", "authority_receipt_sha256",
      "managed_attempt_id", "managed_receipt_sha256", "page_attempt_id", "page_sha256",
    ] as const;
    const rasterKeys = [
      "locator_schema_version", "image_payload_sha256", "visual_payload_sha256",
      "raster_sha256", "raster_byte_count", "raster_width", "raster_height",
      "upload_attempt_id", "raster_receipt_sha256", "pixel_box", "coordinate_system", "anchor_kind",
    ] as const;
    return {
      schemaVersion: "ecos-owner-source-view/2.2", projectId: claim.projectId, requestId,
      preview: true, read_only: true, server_checks: "owner_before_and_after_source_read_only",
      source: { kind: "document_page", result: {
        schema_version: "ecos-owner-document-source-view/2.1", state: "current_exact_page_image",
        citation, page: Object.fromEntries(pageKeys.map(k => [k, locator[k]])),
        raster: Object.fromEntries(rasterKeys.map(k => [k, locator[k]])),
        image_relation: "exact_cited_visual_receipt", authorization: "caller_required_before_and_after",
        highlight: null, coordinate_relationship: "native_pdf_points_and_rotated_raster_pixels_not_converted",
        freshness: "fresh_sequential_source_page_and_raster_readbacks_only",
        inventory_epoch_sha256: "a".repeat(64), index_epoch_sha256: "b".repeat(64),
        semantic_verified: false, whole_answer_verified: false,
        atomic_project_snapshot: false, retrieval_authorized: false,
      }, png: {media_type: "image/png", encoding: "base64", data: btoa(String.fromCharCode(...bytes))} },
    };
  }
  const session = createECOSDrawingImageSession({
    client, caller: {ownerId, authorization: "Bearer owner-test-token"}, now: () => currentTime,
    fetchImpl: (async (url, init) => {
      fetchCalls++;
      assertEquals(url, ECOS_PROTECTED_SOURCE_ENDPOINT);
      assertEquals(new Headers(init?.headers).get("Authorization"), "Bearer owner-test-token");
      assertEquals(init?.redirect, "error");
      const request = JSON.parse(String(init?.body));
      assertEquals(request.citation, citation);
      onFetch();
      const result = body(request.requestId);
      mutateBody(result);
      return transformResponse(Response.json(result));
    }) as typeof fetch,
  });
  return {
    session, counts: () => ({rpcCalls, fetchCalls}),
    setTime: (value: number) => { currentTime = value; },
    row: (fn: typeof mutateRow) => { mutateRow = fn; },
    body: (fn: typeof mutateBody) => { mutateBody = fn; },
    response: (fn: typeof transformResponse) => { transformResponse = fn; },
    onFetch: (fn: typeof onFetch) => { onFetch = fn; },
  };
}

Deno.test("protected image session pins exact authority and hides pixels and locators from receipt JSON", async () => {
  const test = await setup();
  try {
    const receipt = await test.session.open(source, signal());
    assertEquals(test.counts(), {rpcCalls: 2, fetchCalls: 1});
    assertEquals(receipt.pageNumber, 6);
    assertEquals(receipt.semanticVerified, false);
    assertEquals(receipt.absenceClaimsAllowed, false);
    assertEquals(receipt.answerEvidenceEligible, false);
    assertEquals(receipt.viewedScope, "one_complete_page_raster");
    for (const secret of ["data:", "owner-test-token", "locator", "https:", "page_attempt_id"]) {
      assert(!JSON.stringify(receipt).includes(secret));
    }
    const size = await test.session.consume(receipt.imageHandle, signal(), async (page) => {
      assert(page.dataUrl.startsWith("data:image/png;base64,"));
      return [page.width, page.height];
    });
    assertEquals(size, [2, 3]);
    assertEquals(test.counts().rpcCalls, 3);
  } finally { test.session.close(); }
});

Deno.test("protected consumer preserves safe failure codes but strips arbitrary upstream details", async () => {
  const test = await setup();
  try {
    const receipt = await test.session.open(source, signal());
    for (const code of ["agent_provider_spend_limit", "agent_provider_image_fallback_unavailable",
      "drawing_crop_busy", "drawing_visual_output_invalid", "drawing_claim_review_invalid"]) {
      const error = await assertRejects(() => test.session.consume(receipt.imageHandle, signal(), async () => {
        throw new Error(code, {cause: "Bearer secret"});
      }));
      assertEquals((error as Error).message, code);
      assertEquals((error as Error).cause, undefined);
    }
    for (const message of ["Bearer secret", "agent_provider_spend_limit: Bearer secret"]) {
      const error = await assertRejects(() => test.session.consume(receipt.imageHandle, signal(), async () => {
        throw new Error(message);
      }));
      assert(!(error as Error).message.includes("secret"));
    }
  } finally { test.session.close(); }
});

Deno.test("protected image rejects cross-project/file/revision/page/hash/region authority before fetch", async () => {
  for (const [key, value] of Object.entries({
    project_id: "other", document_id: "other", source_sha256: "b".repeat(64),
    source_revision: "2", page_number: 7, region_id: "other", evidence_version: "old",
  })) {
    const test = await setup();
    test.row(row => { (row as Record<string, unknown>)[key] = value; });
    try {
      await assertRejects(() => test.session.open(source, signal()));
      assertEquals(test.counts().fetchCalls, 0, key);
    } finally { test.session.close(); }
  }
});

Deno.test("protected image rejects wrong owner and extra locator URL before fetch", async () => {
  for (const mutate of [
    (row: Record<string, any>) => { row.source_view_citation.locator.owner_id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"; },
    (row: Record<string, any>) => { row.source_view_citation.locator.url = "https://attacker.invalid/file"; },
  ]) {
    const test = await setup(); test.row(mutate);
    try {
      await assertRejects(() => test.session.open(source, signal()));
      assertEquals(test.counts().fetchCalls, 0);
    } finally { test.session.close(); }
  }
});

Deno.test("protected image rejects tampered bytes, MIME, dimensions and response identity", async () => {
  const mutations = [
    (b: Record<string, any>) => { b.source.png.data = btoa(String.fromCharCode(...new Uint8Array(33))); },
    (b: Record<string, any>) => { b.source.png.media_type = "image/jpeg"; },
    (b: Record<string, any>) => { b.source.result.raster.raster_width = 4; },
    (b: Record<string, any>) => { b.requestId = crypto.randomUUID(); },
    (b: Record<string, any>) => { b.source.result.page.page_number = 7; },
    (b: Record<string, any>) => { b.source.result.semantic_verified = true; },
  ];
  for (const mutate of mutations) {
    const test = await setup(); test.body(mutate);
    try { await assertRejects(() => test.session.open(source, signal())); }
    finally { test.session.close(); }
  }
});

Deno.test("protected image rejects supersession during read and again before consuming", async () => {
  for (const changedAt of [2, 3]) {
    const test = await setup();
    test.row((row, count) => { if (count >= changedAt) row.source_revision = "2"; });
    let consumed = false;
    try {
      if (changedAt === 2) await assertRejects(() => test.session.open(source, signal()));
      else {
        const receipt = await test.session.open(source, signal());
        await assertRejects(() => test.session.consume(receipt.imageHandle, signal(), async () => { consumed = true; }));
      }
      assertEquals(consumed, false);
    } finally { test.session.close(); }
  }
});

Deno.test("protected image rejects expired, invented and cross-session handles", async () => {
  const test = await setup(), other = await setup();
  try {
    const receipt = await test.session.open(source, signal());
    for (const [session, handle] of [[other.session, receipt.imageHandle], [test.session, "https://file"]] as const) {
      await assertRejects(() => session.consume(handle, signal(), async () => true));
    }
    test.setTime(61_000);
    await assertRejects(() => test.session.consume(receipt.imageHandle, signal(), async () => true));
  } finally { test.session.close(); other.session.close(); }
});

Deno.test("protected image cancellation and session close prevent usable handles", async () => {
  const test = await setup();
  const controller = new AbortController(); controller.abort();
  try {
    await assertRejects(() => test.session.open(source, controller.signal));
    assertEquals(test.counts(), {rpcCalls: 0, fetchCalls: 0});
    test.onFetch(() => test.session.close());
    await assertRejects(() => test.session.open(source, signal()));
    await assertRejects(() => test.session.open(source, signal()));
  } finally { test.session.close(); }
});

Deno.test("protected image read attempts stay bounded after failures", async () => {
  const test = await setup();
  test.body(body => { body.source.png.media_type = "image/jpeg"; });
  try {
    for (let i = 0; i < 5; i++) await assertRejects(() => test.session.open(source, signal()));
    assertEquals(test.counts().fetchCalls, 4);
  } finally { test.session.close(); }
});

Deno.test("protected image rejects redirects, HTTP failures, oversized and non-JSON headers", async () => {
  for (const transform of [
    (_r: Response) => new Response("no", {status: 403}),
    (r: Response) => { r.headers.set("content-length", String(13 * 1024 * 1024)); return r; },
    (r: Response) => { r.headers.set("content-type", "text/html"); return r; },
    (r: Response) => { Object.defineProperty(r, "redirected", {value: true}); return r; },
    (r: Response) => { Object.defineProperty(r, "url", {value: "https://attacker.invalid"}); return r; },
  ]) {
    const test = await setup(); test.response(transform);
    try { await assertRejects(() => test.session.open(source, signal())); }
    finally { test.session.close(); }
  }
});

Deno.test("protected protocol rejects duplicate JSON keys and prototype keys", () => {
  for (const text of ['{"a":1,"a":2}', '{"__proto__":{}}', '{"x":{"constructor":1}}']) {
    assertThrows(() => parseStrictJSON(text));
  }
});

Deno.test("protected image consumes no pixels after revocation while waiting for authority", async () => {
  const test = await setup();
  try {
    const receipt = await test.session.open(source, signal());
    test.row(row => { row.source_view_citation = {
      ...row.source_view_citation,
      locator: {...row.source_view_citation.locator, raster_receipt_sha256: "f".repeat(64)},
    }; });
    let consumed = false;
    await assertRejects(() => test.session.consume(receipt.imageHandle, signal(), async () => { consumed = true; }));
    assertEquals(consumed, false);
  } finally { test.session.close(); }
});

Deno.test("protected image consumer cancellation remains bounded even if adapter ignores its signal", async () => {
  const test = await setup();
  const controller = new AbortController();
  try {
    const receipt = await test.session.open(source, signal());
    await assertRejects(() => test.session.consume(receipt.imageHandle, controller.signal, async () => {
      queueMicrotask(() => controller.abort());
      return await new Promise<never>(() => {});
    }));
  } finally { test.session.close(); }
});

Deno.test("protected image prevents using a handle that expires during the access recheck", async () => {
  const test = await setup();
  try {
    const receipt = await test.session.open(source, signal());
    test.row(() => test.setTime(61_000));
    await assertRejects(() => test.session.consume(receipt.imageHandle, signal(), async () => true));
  } finally { test.session.close(); }
});

Deno.test("protected stream enforces actual byte limit without Content-Length", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(20)); },
    cancel() { cancelled = true; },
  });
  await assertRejects(() => readBoundedText(new Response(stream), 10, signal()));
  assertEquals(cancelled, true);
});

Deno.test("protected stream cancels a stalled body on caller abort", async () => {
  let cancelled = false;
  const controller = new AbortController();
  const response = new Response(new ReadableStream<Uint8Array>({
    cancel() { cancelled = true; },
  }));
  const pending = readBoundedText(response, 100, controller.signal);
  controller.abort();
  await assertRejects(() => pending);
  assertEquals(cancelled, true);
});
