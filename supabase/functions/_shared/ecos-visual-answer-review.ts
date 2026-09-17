import type {
  createECOSDrawingImageSession,
  ECOSDrawingImageReceipt,
} from "./ecos-protected-drawing-image.ts";
import type { createECOSVisualClaimReviewer } from "./ecos-visual-claim-review.ts";

export type ECOSVisualSourceBinding = Readonly<{
  sourceId: string;
  receipt: ECOSDrawingImageReceipt;
}>;
type Fact = Readonly<{ statement: string; sourceIds: readonly string[] }>;
type Reviewer = ReturnType<typeof createECOSVisualClaimReviewer>;
type Review = Awaited<ReturnType<Reviewer>>;
type StagedDraft = Readonly<{
  shortAnswer: string;
  facts: readonly Fact[];
  limitations: readonly string[];
  conflicts: readonly string[];
  answerEvidenceEligible: false;
  requiresFinalAuthorityBinding: true;
}>;
// Keep private draft text out of JSON/logged review summaries. Only the actual
// successful result object grants access; a copied or fabricated summary does not.
const stagedDrafts = new WeakMap<object, StagedDraft>();
export function getECOSReviewedVisualDraft(reviewResult: object): StagedDraft | null {
  return stagedDrafts.get(reviewResult) ?? null;
}

/** Private diagnostic integration, never final answer authority. Every cited
 * source must have actually been inspected; no source-ID/page cross-products.
 * Review the exact submitted statements, not a newly generated summary. Mixed
 * text/image and multi-page compound support remain conservatively blocked.
 */
export async function reviewECOSVisualAnswer(
  input: Readonly<{
    facts: readonly Fact[];
    bindings: readonly ECOSVisualSourceBinding[];
    review: Reviewer;
    images: ReturnType<typeof createECOSDrawingImageSession>;
    signal: AbortSignal;
  }>,
) {
  const claims = input.facts.map((fact, index) => ({
    id: `fact-${index + 1}`,
    statement: fact.statement,
    sourceIds: [...fact.sourceIds],
  }));
  const reviews: Review[] = [];
  const summary = (
    status:
      | "scope_incomplete"
      | "claims_not_supported"
      | "review_failed"
      | "reviewed_pending_acceptance",
    errorCode: string | null = null,
  ) =>
    Object.freeze({
      status,
      errorCode,
      claimCount: claims.length,
      reviewedPageCount: reviews.length,
      supportedAssessments: reviews.reduce((n, r) =>
        n + r.assessments.filter((a) => a.verdict === "supported").length, 0),
      rejectedAssessments: reviews.reduce((n, r) =>
        n + r.assessments.filter((a) =>
          a.verdict !== "supported"
        ).length, 0),
      reviewInputHashes: Object.freeze(reviews.map((r) =>
        r.reviewInputSha256
      )),
      answerEvidenceEligible: false as const,
      // shortAnswer, limitations and conflicts are not assessed here. No later
      // caller may infer that passing the facts certifies those prose fields.
      wholeAnswerVerified: false as const,
    });
  if (
    !claims.length || claims.length > 12 ||
    claims.some((c) =>
      !c.statement.trim() || c.statement.length > 2000 || !c.sourceIds.length ||
      c.sourceIds.length > 4 ||
      new Set(c.sourceIds).size !== c.sourceIds.length
    )
  ) return summary("scope_incomplete");
  const sources = new Map<string, ECOSDrawingImageReceipt>();
  for (const binding of input.bindings) {
    if (sources.has(binding.sourceId)) return summary("scope_incomplete");
    sources.set(binding.sourceId, Object.freeze({ ...binding.receipt }));
  }
  const groups = new Map<
    string,
    {
      receipt: ECOSDrawingImageReceipt;
      claims: { id: string; statement: string }[];
    }
  >();
  for (const claim of claims) {
    for (const id of claim.sourceIds) {
      const receipt = sources.get(id);
      if (!receipt) return summary("scope_incomplete");
      let group = groups.get(receipt.imageHandle);
      if (!group) {
        group = { receipt, claims: [] };
        groups.set(receipt.imageHandle, group);
      }
      if (JSON.stringify(group.receipt) !== JSON.stringify(receipt)) {
        return summary("scope_incomplete");
      }
      if (!group.claims.some((c) => c.id === claim.id)) {
        group.claims.push({ id: claim.id, statement: claim.statement });
      }
    }
  }
  if (groups.size > 4) return summary("scope_incomplete");
  try {
    input.signal.throwIfAborted();
    for (const { receipt, claims } of groups.values()) {
      const review = await input.review(
        receipt.imageHandle,
        claims,
        input.signal,
      );
      input.signal.throwIfAborted();
      if (
        JSON.stringify(review.source) !== JSON.stringify(receipt) ||
        JSON.stringify(review.claims) !== JSON.stringify(claims) ||
        review.answerEvidenceEligible !== false ||
        review.requiresFinalAuthorityBinding !== true ||
        !/^[a-f0-9]{64}$/.test(review.reviewInputSha256)
      ) throw new Error("drawing_claim_review_invalid");
      reviews.push(review);
    }
    // Reauthorize all reviewed handles AFTER the model calls, including earlier
    // pages in a multi-page review. No fresh open or silently renewed lifetime.
    for (const { receipt } of groups.values()) {
      await input.images.consume(
        receipt.imageHandle,
        input.signal,
        async (_page, current) => {
          if (
            JSON.stringify(current) !== JSON.stringify(receipt)
          ) throw new Error("drawing_claim_review_invalid");
        },
      );
      input.signal.throwIfAborted();
    }
    if (reviews.some((r) => r.assessments.some((a) => a.verdict !== "supported"))) {
      return summary("claims_not_supported");
    }
    const result = summary("reviewed_pending_acceptance");
    const reviewedFacts = Object.freeze(claims.map((claim) => Object.freeze({
      statement: claim.statement,
      sourceIds: Object.freeze([...claim.sourceIds]),
    })));
    // No additional model prose or model-authored limitations can reintroduce
    // unchecked facts. This is a private acceptance draft, not a verified answer.
    stagedDrafts.set(result, Object.freeze({
      shortAnswer: reviewedFacts.map((fact) => fact.statement).join("\n\n"),
      facts: reviewedFacts,
      limitations: Object.freeze([
        "Private reviewed draft; final source binding and end-to-end acceptance are still required.",
        "Reviewed statements do not establish complete drawing coverage or the absence of other details.",
      ]),
      conflicts: Object.freeze([]),
      answerEvidenceEligible: false,
      requiresFinalAuthorityBinding: true,
    }));
    return result;
  } catch (error) {
    const code = input.signal.aborted
      ? (input.signal.reason instanceof DOMException &&
          input.signal.reason.name === "TimeoutError"
        ? "agent_deadline_exceeded"
        : "agent_cancelled")
      : error instanceof Error &&
          [
            "agent_provider_call_limit",
            "agent_provider_spend_limit",
            "agent_provider_image_fallback_unavailable",
            "drawing_crop_busy",
            "drawing_crop_byte_budget_exceeded",
            "drawing_claim_review_invalid",
          ].includes(error.message)
      ? error.message
      : "visual_review_unavailable";
    return summary("review_failed", code);
  }
}
