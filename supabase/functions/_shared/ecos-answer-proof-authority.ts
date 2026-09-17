const SHA256 = /^[a-f0-9]{64}$/;

export type ECOSAnswerProofAuthorityErrorCode =
  | "proof_authority_unavailable"
  | "proof_authority_permission_denied"
  | "proof_authority_identity_mismatch"
  | "proof_authority_response_invalid"
  | "proof_source_unavailable";

export class ECOSAnswerProofAuthorityError extends Error {
  constructor(
    public readonly code: ECOSAnswerProofAuthorityErrorCode,
    public readonly reason: "unspecified" | "evidence_array_missing" | "citation_shape_invalid" | "region_id_mismatch" | "authority_bounds_invalid" | "rpc_rejected" | "claim_not_current" = "unspecified",
  ) {
    super(code);
    this.name = "ECOSAnswerProofAuthorityError";
  }
}

/** Shape eligibility only, never authorization. Every retained proof must
 * still pass the authenticated current-source RPC below. */
export function hasCompleteECOSDocumentProofClaim(value: unknown): boolean {
  const evidence = record(value);
  const claim = proofClaim(record(evidence.documentCitation));
  return Boolean(claim && text(record(evidence.documentRegion).id) === claim.regionId);
}

export type RPCClient = Readonly<{
  rpc: (
    name: string,
    parameters: Record<string, unknown>,
  ) => PromiseLike<Readonly<{ data: unknown; error: unknown }>>;
}>;

export type ECOSDocumentProofReadiness = "available" | "unavailable" | "not_checked" | "rejected";

/** Request-local hint for research, never a replacement for final binding.
 * Checks exact claims, not source names or independent document/page arrays.
 * No credentials, source locators or database error text are returned to a model.
 */
export function createECOSDocumentProofReadinessInspector(client: RPCClient) {
  const cache = new Map<string, Promise<ECOSDocumentProofReadiness>>();
  const maxChecks = 12;
  const maxActiveCheckMs = 8_000;
  let activeCheckMs = 0;
  // Serialize distinct checks even if two tool callers overlap. The bounded
  // allowance measures authority RPC work, not model thinking/search time
  // between tools. The caller's overall question deadline still applies.
  let pendingCheck: Promise<void> = Promise.resolve();
  return async (source: unknown, signal: AbortSignal): Promise<ECOSDocumentProofReadiness> => {
    signal.throwIfAborted();
    const evidence = record(source);
    const claim = proofClaim(record(evidence.documentCitation));
    if (!claim || !hasCompleteECOSDocumentProofClaim(source)) return "rejected";
    const key = JSON.stringify(claim);
    const existing = cache.get(key);
    if (existing) return await existing;
    if (cache.size >= maxChecks || activeCheckMs >= maxActiveCheckMs) return "not_checked";
    const checked = pendingCheck.then(async (): Promise<ECOSDocumentProofReadiness> => {
      signal.throwIfAborted();
      const remainingMs = Math.floor(maxActiveCheckMs - activeCheckMs);
      if (remainingMs <= 0) return "not_checked";
      const budgetController = new AbortController();
      const timeout = setTimeout(() => budgetController.abort(new DOMException("Proof check budget exhausted", "TimeoutError")),remainingMs);
      const checkSignal = AbortSignal.any([signal, budgetController.signal]);
      const startedAt = performance.now();
      try {
        await loadAuthoritativeProof(client, claim, checkSignal);
        signal.throwIfAborted();
        checkSignal.throwIfAborted();
        return "available";
      } catch (error) {
        signal.throwIfAborted();
        if (budgetController.signal.aborted && (
          (error instanceof DOMException && ["AbortError", "TimeoutError"].includes(error.name)) ||
          (error instanceof ECOSAnswerProofAuthorityError && error.code === "proof_authority_unavailable")
        )) return "not_checked";
        // An exact empty result rejects this discovery candidate, not the other
        // candidates. Never expose its content as current evidence. Malformed,
        // mismatched, permission and infrastructure responses still throw.
        if (error instanceof ECOSAnswerProofAuthorityError && error.reason === "claim_not_current") return "rejected";
        if (error instanceof ECOSAnswerProofAuthorityError && error.code === "proof_source_unavailable") return "unavailable";
        throw error;
      } finally {
        clearTimeout(timeout);
        activeCheckMs += Math.max(0,performance.now() - startedAt);
      }
    });
    pendingCheck = checked.then(() => undefined,() => undefined);
    cache.set(key, checked);
    return await checked;
  };
}

/**
 * Rebinds every document citation used by a verified answer to the database's
 * current proof authority. Search rows and model output are discovery inputs;
 * neither is allowed to choose the page coordinates returned to a customer.
 *
 * A verified document answer also requires an exact protected-page locator.
 * This keeps the answer and its openable proof as one customer contract rather
 * than allowing a response that can only fail when the user taps the citation.
 */
export async function bindECOSAnswerToAuthoritativeProof<T>(
  client: RPCClient,
  answerValue: T,
): Promise<T> {
  return bindWithProofCache(client,answerValue,new Map());
}

/** One final phase, separate from discovery hints. Only the caller's actually
 * researched, proposed sources enter this session. Check each exact claim
 * once, then reuse its authoritative bounds when binding the completed answer.
 * The existing 36-source answer ceiling and two-request concurrency remain.
 */
export function createECOSFinalAnswerProofSession(client: RPCClient) {
  const cache = new Map<string, Promise<AuthoritativeProof>>();
  return {
    async verifySources<T>(sources: readonly T[]): Promise<readonly T[]> {
      const documents=sources.filter(source=>text(record(source).sourceType)==="document");
      if(documents.length>36) throw new ECOSAnswerProofAuthorityError("proof_authority_response_invalid");
      const checked=await mapBounded(sources,2,async source=>{
        const evidence=record(source);
        if(text(evidence.sourceType)!=="document")return source;
        const claim=proofClaim(record(evidence.documentCitation));
        if(!claim || !hasCompleteECOSDocumentProofClaim(source))return null;
        try {
          await cachedProof(cache,JSON.stringify(claim),()=>loadAuthoritativeProof(client,claim));
          return source;
        } catch(error) {
          if(error instanceof ECOSAnswerProofAuthorityError &&
            (error.reason==="claim_not_current" || error.code==="proof_source_unavailable")) return null;
          throw error;
        }
      });
      return checked.filter((source): source is T=>source!==null);
    },
    bind<T>(answer: T): Promise<T> { return bindWithProofCache(client,answer,cache); },
  };
}

async function bindWithProofCache<T>(client: RPCClient,answerValue: T,proofCache: Map<string,Promise<AuthoritativeProof>>): Promise<T> {
  const answer = record(answerValue);
  const assuranceStatus = text(record(answer.assurance).status);
  if (
    assuranceStatus !== "verified" &&
    assuranceStatus !== "verified_with_limits"
  ) return answerValue;

  if (!Array.isArray(answer.supportingEvidence)) {
    throw new ECOSAnswerProofAuthorityError(
      "proof_authority_response_invalid",
      "evidence_array_missing",
    );
  }

  const supportingEvidence = await mapBounded(
    answer.supportingEvidence,
    2,
    async (rawEvidence) => {
      const evidence = record(rawEvidence);
      if (text(evidence.sourceType) !== "document") return rawEvidence;
      const citation = proofClaim(record(evidence.documentCitation));
      const suppliedRegion = record(evidence.documentRegion);
      if (!citation || text(suppliedRegion.id) !== citation.regionId) {
        throw new ECOSAnswerProofAuthorityError(
          "proof_authority_response_invalid",
          citation ? "region_id_mismatch" : "citation_shape_invalid",
        );
      }
      const key = JSON.stringify(citation);
      const proof = await cachedProof(
        proofCache,
        key,
        () => loadAuthoritativeProof(client, citation),
      );
      return Object.freeze({
        ...evidence,
        documentRegion: Object.freeze({
          ...suppliedRegion,
          id: citation.regionId,
          x: proof.bounds.x,
          y: proof.bounds.y,
          width: proof.bounds.width,
          height: proof.bounds.height,
          rawSource: "hosted_proof_authority",
        }),
      });
    },
  );

  return Object.freeze({
    ...answer,
    supportingEvidence: Object.freeze(supportingEvidence),
  }) as T;
}

type ProofClaim = Readonly<{
  documentId: string;
  projectId: string;
  sourceSha256: string;
  evidenceVersion: string;
  revision: string;
  pageNumber: number;
  sheetNumber: string | null;
  regionId: string;
}>;

type Bounds = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

type AuthoritativeProof = Readonly<{ bounds: Bounds; sourceViewCitation: unknown }>;

/** Server-only image access. Never expose this locator in model tool output.
 * Re-run authority for each read; a readiness hint is not permission to read.
 */
export async function authorizeECOSDrawingImage(
  client: RPCClient,
  source: unknown,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const evidence = record(source);
  const claim = proofClaim(record(evidence.documentCitation));
  if (text(evidence.sourceType) !== "document" || !claim ||
    !hasCompleteECOSDocumentProofClaim(source)) {
    throw new ECOSAnswerProofAuthorityError("proof_authority_response_invalid", "citation_shape_invalid");
  }
  const proof = await loadAuthoritativeProof(client, claim, signal);
  signal.throwIfAborted();
  return Object.freeze({ claim, sourceViewCitation: proof.sourceViewCitation });
}

function proofClaim(value: Record<string, unknown>): ProofClaim | null {
  const documentId = boundedText(value.documentId, 200);
  const projectId = boundedText(value.projectId, 200);
  const sourceSha256 = text(value.sourceSha256).toLowerCase();
  const evidenceVersion = boundedText(value.evidenceVersion, 80);
  const revision = boundedText(value.revision, 200);
  const pageNumber = positiveInteger(value.pageNumber);
  const sheetNumber = boundedText(value.sheetNumber, 64) || null;
  const regionId = boundedText(value.regionId, 512);
  if (
    !documentId || !projectId || !SHA256.test(sourceSha256) ||
    evidenceVersion !== "ecos-hosted-evidence/1.3" || !revision ||
    pageNumber == null || !regionId
  ) return null;
  return Object.freeze({
    documentId,
    projectId,
    sourceSha256,
    evidenceVersion,
    revision,
    pageNumber,
    sheetNumber,
    regionId,
  });
}

async function loadAuthoritativeProof(
  client: RPCClient,
  claim: ProofClaim,
  signal?: AbortSignal,
): Promise<AuthoritativeProof> {
  const query = client.rpc("dave_verify_current_ecos_document_proof", {
    p_project_id: claim.projectId,
    p_document_id: claim.documentId,
    p_source_sha256: claim.sourceSha256,
    p_evidence_version: claim.evidenceVersion,
    p_revision: claim.revision,
    p_page_number: claim.pageNumber,
    p_sheet_number: claim.sheetNumber,
    p_region_id: claim.regionId,
  });
  const abortable = query as typeof query & { abortSignal?: (signal: AbortSignal) => typeof query };
  const result = await (signal && typeof abortable.abortSignal === "function"
    ? abortable.abortSignal(signal) : query);
  if (result.error) throw proofRPCError(result.error);
  if (Array.isArray(result.data) && result.data.length === 0) {
    throw new ECOSAnswerProofAuthorityError("proof_authority_identity_mismatch", "claim_not_current");
  }
  if (!Array.isArray(result.data) || result.data.length !== 1) {
    throw new ECOSAnswerProofAuthorityError(
      "proof_authority_identity_mismatch",
    );
  }
  const row = record(result.data[0]);
  if (
    text(row.document_id) !== claim.documentId ||
    text(row.project_id) !== claim.projectId ||
    text(row.source_sha256).toLowerCase() !== claim.sourceSha256 ||
    text(row.evidence_version) !== claim.evidenceVersion ||
    text(row.source_revision) !== claim.revision ||
    positiveInteger(row.page_number) !== claim.pageNumber ||
    normalizeSheet(row.sheet_number) !== normalizeSheet(claim.sheetNumber) ||
    text(row.region_id) !== claim.regionId
  ) {
    throw new ECOSAnswerProofAuthorityError(
      "proof_authority_identity_mismatch",
    );
  }
  const bounds = normalizedBounds(row.region_bounds);
  if (!bounds) {
    throw new ECOSAnswerProofAuthorityError(
      "proof_authority_response_invalid",
      "authority_bounds_invalid",
    );
  }
  if (Object.keys(record(row.source_view_citation)).length === 0) {
    console.error(JSON.stringify({
      event: "ecos_answer_proof_source_unavailable",
      documentId: claim.documentId,
      projectId: claim.projectId,
      sourceSha256: claim.sourceSha256,
      revision: claim.revision,
      pageNumber: claim.pageNumber,
      sheetNumber: claim.sheetNumber,
      regionId: claim.regionId,
    }));
    throw new ECOSAnswerProofAuthorityError("proof_source_unavailable");
  }
  return Object.freeze({ bounds, sourceViewCitation: row.source_view_citation });
}

function proofRPCError(error: unknown) {
  const value = record(error);
  const code = text(value.code).toUpperCase();
  const message = [value.message, value.details, value.hint]
    .map(text)
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (
    code === "PGRST202" || code === "42883" || code === "57014" ||
    /^PGRST5/.test(code) ||
    /could not find the function|does not exist|schema cache|timeout|timed out|connection/
      .test(message)
  ) {
    return new ECOSAnswerProofAuthorityError("proof_authority_unavailable");
  }
  if (
    code === "42501" ||
    /permission denied|not authorized|requires an authorized owner/.test(
      message,
    )
  ) {
    return new ECOSAnswerProofAuthorityError(
      "proof_authority_permission_denied",
    );
  }
  return new ECOSAnswerProofAuthorityError(
    "proof_authority_response_invalid",
    "rpc_rejected",
  );
}

async function cachedProof(
  cache: Map<string, Promise<AuthoritativeProof>>,
  key: string,
  load: () => Promise<AuthoritativeProof>,
) {
  const existing = cache.get(key);
  if (existing) return await existing;
  const pending = load();
  cache.set(key, pending);
  return await pending;
}

async function mapBounded<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
) {
  const output = new Array<R>(values.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (next < values.length) {
        const index = next++;
        output[index] = await mapper(values[index]);
      }
    },
  );
  await Promise.all(workers);
  return output;
}

function normalizedBounds(value: unknown): Bounds | null {
  const bounds = record(value);
  const x = finite(bounds.x);
  const y = finite(bounds.y);
  const width = finite(bounds.width);
  const height = finite(bounds.height);
  if (
    x == null || y == null || width == null || height == null ||
    x < 0 || y < 0 || width <= 0 || height <= 0 ||
    x > 1 || y > 1 || width > 1 || height > 1 ||
    x + width > 1.000001 || y + height > 1.000001
  ) return null;
  return Object.freeze({ x, y, width, height });
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function boundedText(value: unknown, maximum: number) {
  const normalized = text(value);
  return normalized && normalized.length <= maximum &&
      !/[\u0000-\u001f\u007f]/.test(normalized)
    ? normalized
    : "";
}

function positiveInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function finite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeSheet(value: unknown) {
  return text(value).replace(/\s+/g, "").toUpperCase();
}
