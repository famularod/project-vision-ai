import { authorizeECOSDrawingImage, type RPCClient } from "./ecos-answer-proof-authority.ts";
import {
  ECOS_PROTECTED_SOURCE_ENDPOINT, ECOSProtectedDocumentPageError,
  normalizeECOSProtectedSourceCitation, parseStrictJSON, readBoundedText,
  validateSourceResponse, type ECOSProtectedDocumentPage,
} from "./ecos-protected-drawing-image-protocol.ts";

const MAX_RESPONSE_BYTES = 12 * 1024 * 1024;
const MAX_SESSION_BYTES = 20 * 1024 * 1024;
const MAX_ATTEMPTS = 4;
const IMAGE_LIFETIME_MS = 60_000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SAFE_CONSUMER_ERRORS = new Set([
  "agent_provider_call_limit", "agent_provider_spend_limit",
  "agent_provider_image_fallback_unavailable", "agent_provider_unavailable_for_fallback",
  "drawing_crop_busy", "drawing_crop_byte_budget_exceeded", "drawing_crop_source_invalid",
  "drawing_visual_question_invalid", "drawing_visual_view_invalid",
  "drawing_visual_output_invalid", "drawing_claim_review_invalid",
]);

async function bounded<T>(signal: AbortSignal, operation: PromiseLike<T>): Promise<T> {
  const pending = Promise.resolve(operation);
  // The operation can synchronously trigger cancellation while it is being
  // created. Observe its eventual rejection even in that pre-race case.
  if (signal.aborted) {
    void pending.catch(() => {});
    signal.throwIfAborted();
  }
  let stop: (() => void) | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        stop = () => reject(new DOMException("Drawing read cancelled", "AbortError"));
        signal.addEventListener("abort", stop, {once: true});
        if (signal.aborted) stop();
      }),
    ]);
  } finally {
    if (stop) signal.removeEventListener("abort", stop);
  }
}

export type ECOSDrawingImageReceipt = Readonly<{
  imageHandle: string;
  projectId: string;
  documentId: string;
  sourceSha256: string;
  revision: string;
  pageNumber: number;
  rasterSha256: string;
  width: number;
  height: number;
  viewedScope: "one_complete_page_raster";
  // A complete raster is not a complete semantic read, nor an entire document.
  semanticVerified: false;
  absenceClaimsAllowed: false;
  answerEvidenceEligible: false;
}>;

/**
 * Request-local transport for opt-in private image research. Customer answer
 * promotion remains quarantined pending semantic review and acceptance. This
 * transport creates no public URL, durable file, or image in tool JSON.
 * client and caller must come from the same already-authenticated request.
 */
export function createECOSDrawingImageSession({
  client, caller, fetchImpl = fetch, now = () => performance.now(),
}: {
  client: RPCClient;
  caller: Readonly<{ ownerId: string; authorization: string }>;
  fetchImpl?: typeof fetch;
  now?: () => number;
}) {
  // Snapshot the trusted caller; do not retain a mutable request-context object.
  const ownerId = caller.ownerId;
  const authorization = caller.authorization;
  if (!/^[a-f0-9-]{36}$/.test(ownerId) || !/^Bearer [\x21-\x7e]{1,8192}$/.test(authorization)) {
    throw new ECOSProtectedDocumentPageError();
  }
  const images = new Map<string, {
    source: unknown; citation: string; page: ECOSProtectedDocumentPage;
    receipt: ECOSDrawingImageReceipt; loadedAt: number; bytes: number;
  }>();
  let attempts = 0;
  let totalBytes = 0;
  let closed = false;
  const lifetime = new AbortController();
  const active = (signal: AbortSignal) => {
    signal.throwIfAborted();
    if (closed) throw new ECOSProtectedDocumentPageError();
  };
  function expire() {
    for (const [handle, image] of images) {
      const age = now() - image.loadedAt;
      if (!Number.isFinite(age) || age < 0 || age >= IMAGE_LIFETIME_MS) {
        totalBytes -= image.bytes;
        images.delete(handle);
      }
    }
  }
  return Object.freeze({
    async open(source: unknown, signal: AbortSignal): Promise<ECOSDrawingImageReceipt> {
      active(signal);
      if (attempts >= MAX_ATTEMPTS) throw new ECOSProtectedDocumentPageError("Drawing image read budget reached.");
      attempts++;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);
      const readSignal = AbortSignal.any([signal, lifetime.signal, controller.signal]);
      try {
        const snapshot = structuredClone(source);
        const authority = await bounded(readSignal, authorizeECOSDrawingImage(client, snapshot, readSignal));
        const citation = normalizeECOSProtectedSourceCitation(authority.sourceViewCitation, authority.claim);
        if (!citation || citation.locator.owner_id !== ownerId) throw new ECOSProtectedDocumentPageError();
        const requestId = crypto.randomUUID();
        if (!UUID.test(requestId)) throw new ECOSProtectedDocumentPageError();
        const response = await bounded(readSignal, fetchImpl(ECOS_PROTECTED_SOURCE_ENDPOINT, {
          method: "POST",
          headers: { Authorization: authorization, "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            schemaVersion: "ecos-owner-source-view/2.2",
            projectId: authority.claim.projectId, requestId,
            answerSchemaVersion: "ecos-owner-source-answer/2.1", citation,
          }),
          signal: readSignal, redirect: "error", credentials: "omit", cache: "no-store",
        }).then(response => {
          if (readSignal.aborted) {
            void response.body?.cancel().catch(() => {});
            readSignal.throwIfAborted();
          }
          return response;
        }));
        const length = response.headers.get("content-length");
        if (!response.ok || response.redirected ||
          (response.url && response.url !== ECOS_PROTECTED_SOURCE_ENDPOINT) ||
          !/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") || "") ||
          (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_RESPONSE_BYTES))) {
          void response.body?.cancel().catch(() => {});
          throw new ECOSProtectedDocumentPageError();
        }
        const page = await validateSourceResponse(parseStrictJSON(await bounded(readSignal, readBoundedText(response, MAX_RESPONSE_BYTES, readSignal))), {
          requestId, projectId: authority.claim.projectId, citation,
        });
        readSignal.throwIfAborted();
        // A source can be superseded while the image service is reading it.
        const after = await bounded(readSignal, authorizeECOSDrawingImage(client, snapshot, readSignal));
        const afterCitation = normalizeECOSProtectedSourceCitation(after.sourceViewCitation, after.claim);
        if (JSON.stringify(afterCitation) !== JSON.stringify(citation)) throw new ECOSProtectedDocumentPageError();
        active(readSignal);
        expire();
        const bytes = citation.locator.raster_byte_count;
        if (totalBytes + bytes > MAX_SESSION_BYTES) throw new ECOSProtectedDocumentPageError();
        const imageHandle = crypto.randomUUID();
        const receipt: ECOSDrawingImageReceipt = Object.freeze({
          imageHandle, projectId: authority.claim.projectId, documentId: authority.claim.documentId,
          sourceSha256: authority.claim.sourceSha256, revision: authority.claim.revision,
          pageNumber: authority.claim.pageNumber, rasterSha256: page.sha256,
          width: page.width, height: page.height, viewedScope: "one_complete_page_raster",
          semanticVerified: false, absenceClaimsAllowed: false, answerEvidenceEligible: false,
        });
        images.set(imageHandle, { source: snapshot, citation: JSON.stringify(citation), page, receipt, loadedAt: now(), bytes });
        totalBytes += bytes;
        return receipt;
      } catch {
        // Never leak upstream error bodies, credentials, or source locators.
        throw new ECOSProtectedDocumentPageError();
      } finally {
        clearTimeout(timer);
        controller.abort();
      }
    },
    /** Server-only consumer: a model may name a handle but cannot submit pixels.
     * Recheck current access immediately before handing pixels to a budgeted
     * provider adapter. The adapter must honor the supplied cancellation signal.
     */
    async consume<T>(
      imageHandle: string,
      signal: AbortSignal,
      consumer: (page: ECOSProtectedDocumentPage, receipt: ECOSDrawingImageReceipt, signal: AbortSignal) => Promise<T>,
    ): Promise<T> {
      active(signal);
      expire();
      const image = images.get(imageHandle);
      if (!image) throw new ECOSProtectedDocumentPageError();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);
      const readSignal = AbortSignal.any([signal, lifetime.signal, controller.signal]);
      let consumerStarted = false;
      try {
        const authority = await bounded(readSignal, authorizeECOSDrawingImage(client, image.source, readSignal));
        const citation = normalizeECOSProtectedSourceCitation(authority.sourceViewCitation, authority.claim);
        if (!citation || citation.locator.owner_id !== ownerId || JSON.stringify(citation) !== image.citation) {
          throw new ECOSProtectedDocumentPageError();
        }
        active(readSignal);
        expire();
        if (images.get(imageHandle) !== image) throw new ECOSProtectedDocumentPageError();
        consumerStarted = true;
        const result = await bounded(readSignal, consumer(image.page, image.receipt, readSignal));
        active(readSignal);
        return result;
      } catch (error) {
        // Preserve only explicit internal failure codes after source authority
        // succeeded. Never forward arbitrary provider bodies, stacks or causes.
        if (consumerStarted && !readSignal.aborted && error instanceof Error &&
          SAFE_CONSUMER_ERRORS.has(error.message)) throw new Error(error.message);
        throw new ECOSProtectedDocumentPageError();
      } finally {
        clearTimeout(timer);
        controller.abort();
      }
    },
    close() {
      closed = true;
      lifetime.abort();
      images.clear();
      totalBytes = 0;
    },
  });
}
