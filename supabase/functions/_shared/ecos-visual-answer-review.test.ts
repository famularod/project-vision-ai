import { assert, assertEquals } from "jsr:@std/assert@1";
import { getECOSReviewedVisualDraft, reviewECOSVisualAnswer } from "./ecos-visual-answer-review.ts";
import { createECOSVisualClaimReviewer } from "./ecos-visual-claim-review.ts";
import { createECOSProviderFailover } from "./ecos-provider-failover.ts";
import type {
  createECOSDrawingImageSession,
  ECOSDrawingImageReceipt,
} from "./ecos-protected-drawing-image.ts";
import { imagePart } from "./ecos-drawing-media.fixture.ts";

function setup(
  options: { maxCalls?: number; verdict?: string; providerError?: string } = {},
) {
  const receipts: ECOSDrawingImageReceipt[] = [1, 2].map((n) => ({
    imageHandle: `h${n}`,
    projectId: "p1",
    documentId: `d${n}`,
    sourceSha256: String(n).repeat(64),
    revision: "1",
    pageNumber: 40 + n,
    rasterSha256: "a".repeat(64),
    width: 1200,
    height: 1000,
    viewedScope: "one_complete_page_raster",
    semanticVerified: false,
    absenceClaimsAllowed: false,
    answerEvidenceEligible: false,
  }));
  const events: string[] = [];
  let revoked = false, afterProvider = () => {};
  const images: ReturnType<typeof createECOSDrawingImageSession> = {
    open: async () => {
      throw new Error("Review must not reopen sources");
    },
    close: () => {
      revoked = true;
    },
    consume: async (handle, signal, consumer) => {
      signal.throwIfAborted();
      events.push(`access:${handle}`);
      if (revoked) throw new Error("Bearer secret");
      const receipt = receipts.find((r) => r.imageHandle === handle)!;
      return await consumer(
        {
          dataUrl: imagePart().image_url,
          sha256: receipt.rasterSha256,
          width: 1200,
          height: 1000,
        },
        receipt,
        signal,
      );
    },
  };
  const provider = createECOSProviderFailover({
    maxProviderCalls: options.maxCalls ?? 6,
    maxCostUsd: 0.25,
    allowDrawingImages: true,
    primary: {
      complete: async (request) => {
        const content =
          (request.inputItems[0] as { content: { text: string }[] }).content;
        const binding = JSON.parse(content[0].text);
        events.push(`provider:${binding.source.imageHandle}`);
        afterProvider();
        if (options.providerError) throw new Error(options.providerError);
        return {
          outputItems: [],
          toolCalls: [],
          usage: null,
          outputText: JSON.stringify({
            assessments: binding.claims.map((c: { id: string }) => ({
              claimId: c.id,
              verdict: options.verdict ?? "supported",
              basis: "printed_text",
              viewIds: ["T1"],
              printedSupport: "Example printed label",
              reason: "Visible label.",
            })),
          }),
        };
      },
    },
    backup: {
      complete: async () => {
        throw new Error("No image fallback allowed");
      },
    },
  });
  const review = createECOSVisualClaimReviewer({
    images,
    provider,
    prepareViews: async (page) => [{
      image: page,
      view: {
        viewId: "T1",
        parentRasterSha256: page.sha256,
        cropSha256: page.sha256,
        parentWidth: 1200,
        parentHeight: 1000,
        width: 1200,
        height: 1000,
        pixelBox: [0, 0, 1200, 1000],
      },
    }],
  });
  return {
    images,
    review,
    provider,
    events,
    receipts,
    bindings: receipts.map((receipt, i) => ({
      sourceId: `s${i + 1}`,
      receipt,
    })),
    afterProvider: (callback: () => void) => {
      afterProvider = callback;
    },
    revoke: () => {
      revoked = true;
    },
  };
}
const facts = [{ statement: "First exact claim.", sourceIds: ["s1"] }, {
  statement: "Second exact claim.",
  sourceIds: ["s2"],
}];
const signal = () => new AbortController().signal;

Deno.test("private draft contains only reviewed snapshots, never unchecked answer prose", async () => {
  const test=setup();
  const mutableFacts=[{statement:"Original reviewed statement.",sourceIds:["s1"]}];
  test.afterProvider(()=>{
    mutableFacts[0].statement="Unchecked replacement";
    mutableFacts[0].sourceIds.push("wrong-source");
  });
  const supplied={...test,facts:mutableFacts,signal:signal(),
    shortAnswer:"Unchecked summary",limitations:["Unchecked absence"],conflicts:["Unchecked conflict"]};
  const result=await reviewECOSVisualAnswer(supplied);
  const draft=getECOSReviewedVisualDraft(result);
  assert(draft);
  assertEquals(draft.shortAnswer,"Original reviewed statement.");
  assertEquals(draft.facts,[{statement:"Original reviewed statement.",sourceIds:["s1"]}]);
  assertEquals(draft.conflicts,[]);
  assertEquals(draft.answerEvidenceEligible,false);
  assertEquals(draft.requiresFinalAuthorityBinding,true);
  assert(!JSON.stringify(draft).includes("Unchecked"));
  assert(!JSON.stringify(result).includes("Original reviewed statement"));
  assert(Object.isFrozen(draft) && Object.isFrozen(draft.facts) &&
    Object.isFrozen(draft.facts[0]) && Object.isFrozen(draft.facts[0].sourceIds));
  assertEquals(getECOSReviewedVisualDraft({...result}),null);
  assertEquals(getECOSReviewedVisualDraft(JSON.parse(JSON.stringify(result))),null);
});

Deno.test("visual answer reviews exact source pairs and rechecks every page after all model calls", async () => {
  const test = setup();
  const result = await reviewECOSVisualAnswer({
    ...test,
    facts,
    signal: signal(),
  });
  assertEquals(result.status, "reviewed_pending_acceptance");
  assertEquals(result.answerEvidenceEligible, false);
  assertEquals(result.wholeAnswerVerified, false);
  assertEquals(result.supportedAssessments, 2);
  assertEquals(result.reviewedPageCount, 2);
  assertEquals(test.events, [
    "access:h1",
    "provider:h1",
    "access:h2",
    "provider:h2",
    "access:h1",
    "access:h2",
  ]);
  assertEquals(test.provider.snapshot().providerCalls, 2);
  const serialized = JSON.stringify(result);
  for (
    const hidden of [
      "data:image",
      "imageHandle",
      "First exact claim",
      "Example printed label",
      "Bearer",
    ]
  ) {
    assert(!serialized.includes(hidden));
  }
});
Deno.test("visual review does not invent source/page pairings or review uninspected sources", async () => {
  for (
    const invalid of [
      [],
      [{ statement: "Wrong source", sourceIds: ["not-inspected"] }],
      [{ statement: "Empty citations", sourceIds: [] }],
      [{ statement: "Duplicate citation", sourceIds: ["s1", "s1"] }],
    ]
  ) {
    const test = setup();
    const result = await reviewECOSVisualAnswer({
      ...test,
      facts: invalid,
      signal: signal(),
    });
    assertEquals(result.status, "scope_incomplete");
    assertEquals(test.events, []);
  }
});
Deno.test("same-page facts share one review but every claim is assessed", async () => {
  const test = setup();
  const result = await reviewECOSVisualAnswer({
    ...test,
    facts: facts.map((f) => ({ ...f, sourceIds: ["s1"] })),
    signal: signal(),
  });
  assertEquals(result.reviewedPageCount, 1);
  assertEquals(result.supportedAssessments, 2);
  assertEquals(test.provider.snapshot().providerCalls, 1);
});
Deno.test("contradicted claims cannot pass the staged answer review", async () => {
  const test = setup({ verdict: "contradicted" });
  const result = await reviewECOSVisualAnswer({
    ...test,
    facts,
    signal: signal(),
  });
  assertEquals(result.status, "claims_not_supported");
  assertEquals(result.rejectedAssessments, 2);
  assertEquals(getECOSReviewedVisualDraft(result), null);
});
Deno.test("revocation during model review prevents a successful final source binding", async () => {
  const test = setup();
  test.afterProvider(test.revoke);
  const result = await reviewECOSVisualAnswer({
    ...test,
    facts: facts.slice(0, 1),
    signal: signal(),
  });
  assertEquals(result.status, "review_failed");
  assertEquals(result.errorCode, "visual_review_unavailable");
  assertEquals(getECOSReviewedVisualDraft(result), null);
  assert(!JSON.stringify(result).includes("secret"));
});
Deno.test("review shares the existing provider-call allowance and never raises it", async () => {
  const test = setup({ maxCalls: 1 });
  const result = await reviewECOSVisualAnswer({
    ...test,
    facts,
    signal: signal(),
  });
  assertEquals(result.status, "review_failed");
  assertEquals(result.errorCode, "agent_provider_call_limit");
  assertEquals(test.provider.snapshot().providerCalls, 1);
});
Deno.test("review preserves cancellation and sanitizes unexpected upstream failures", async () => {
  const test = setup();
  const controller = new AbortController();
  controller.abort();
  const result = await reviewECOSVisualAnswer({
    ...test,
    facts,
    signal: controller.signal,
  });
  assertEquals(result.errorCode, "agent_cancelled");
  assertEquals(test.events, []);
  const broken = setup({ providerError: "Bearer secret" });
  const failure = await reviewECOSVisualAnswer({
    ...broken,
    facts,
    signal: signal(),
  });
  assertEquals(failure.errorCode, "visual_review_unavailable");
  assert(!JSON.stringify(failure).includes("secret"));
});
Deno.test("deadline expiry during a model review cannot become a completed review", async () => {
  const test = setup();
  const controller = new AbortController();
  test.afterProvider(() =>
    controller.abort(new DOMException("deadline", "TimeoutError"))
  );
  const result = await reviewECOSVisualAnswer({
    ...test,
    facts,
    signal: controller.signal,
  });
  assertEquals(result.status, "review_failed");
  assertEquals(result.errorCode, "agent_deadline_exceeded");
  assertEquals(test.provider.snapshot().providerCalls, 1);
});
Deno.test("review rejects changed source receipt or changed reviewed statement", async () => {
  for (const kind of ["source", "claim"]) {
    const test = setup();
    const review: typeof test.review = async (...args) => {
      const result = await test.review(...args);
      return kind === "source"
        ? { ...result, source: { ...result.source, pageNumber: 99 } }
        : {
          ...result,
          claims: [{ id: "fact-1", statement: "Substituted statement" }],
        };
    };
    const result = await reviewECOSVisualAnswer({
      ...test,
      review,
      facts: facts.slice(0, 1),
      signal: signal(),
    });
    assertEquals(result.errorCode, "drawing_claim_review_invalid");
  }
});
