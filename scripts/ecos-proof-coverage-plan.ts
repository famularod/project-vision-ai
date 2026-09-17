/** Pure, non-executable missing-page plan. No database/network/write capability.
 * Input must come from the current-reference-authority inventory, not filenames.
 * Every proposed write requires fresh authority/original/claim/predecessor reads.
 */
type Head = {
  page_number: number;
  attempt_id: string;
  version: number;
  upload_attempt_id: string | null;
  raster_version: number | null;
};
type Execution = {
  execution_id: string;
  binding_id: string;
  binding_version: number;
  extraction_version: string;
  source_page_count: number;
  pages: Head[];
};
export type CoverageSource = {
  document_id: string;
  project_id: string;
  owner_id: string;
  source_sha256: string;
  source_revision: string;
  source_page_count: number;
  source_byte_count: number;
  index_job_id: string;
  indexed_pages: number[];
  executions: Execution[];
};
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function requireValue(ok: unknown, reason: string): asserts ok {
  if (!ok) throw new Error(reason);
}
function integer(value: unknown, max: number) {
  return Number.isSafeInteger(value) && Number(value) > 0 &&
    Number(value) <= max;
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function planECOSProofCoverage(
  input: unknown,
  scope: { ownerId: string; projectId: string },
) {
  requireValue(
    UUID.test(scope.ownerId) && UUID.test(scope.projectId),
    "invalid_scope",
  );
  requireValue(
    Array.isArray(input) && input.length > 0 && input.length <= 1000,
    "invalid_inventory",
  );
  const seen = new Set<string>();
  const sources = input.map((raw) => {
    requireValue(object(raw), "invalid_source");
    requireValue(
      raw.owner_id === scope.ownerId && raw.project_id === scope.projectId,
      "scope_mismatch",
    );
    requireValue(
      typeof raw.document_id === "string" && raw.document_id.length > 0 &&
        raw.document_id.length <= 200,
      "invalid_document_id",
    );
    requireValue(!seen.has(raw.document_id), "ambiguous_current_document");
    seen.add(raw.document_id);
    requireValue(
      typeof raw.source_sha256 === "string" &&
        /^[0-9a-f]{64}$/.test(raw.source_sha256),
      "invalid_source_hash",
    );
    requireValue(
      typeof raw.source_revision === "string" &&
        raw.source_revision.length > 0 && raw.source_revision.length <= 200,
      "invalid_revision",
    );
    requireValue(
      typeof raw.index_job_id === "string" && UUID.test(raw.index_job_id),
      "invalid_job",
    );
    requireValue(
      integer(raw.source_page_count, 10000) &&
        integer(raw.source_byte_count, 1024 ** 3) &&
        Number(raw.source_byte_count) >= 5,
      "invalid_source_size",
    );
    const pageCount = Number(raw.source_page_count);
    requireValue(
      Array.isArray(raw.indexed_pages) && raw.indexed_pages.every((p) =>
        integer(p, pageCount)
      ) && new Set(raw.indexed_pages).size === raw.indexed_pages.length,
      "invalid_index_pages",
    );
    requireValue(
      Array.isArray(raw.executions) && raw.executions.length <= 1,
      "ambiguous_execution",
    );
    for (const e of raw.executions) {
      requireValue(
        object(e) && UUID.test(String(e.execution_id)) &&
          UUID.test(String(e.binding_id)) &&
          integer(e.binding_version, 1000000),
        "invalid_binding",
      );
      requireValue(
        e.source_page_count === pageCount &&
          e.extraction_version === "ecos-owner-native-preview/2.0",
        "execution_identity_mismatch",
      );
      requireValue(
        Array.isArray(e.pages) && e.pages.length <= pageCount,
        "invalid_heads",
      );
      const pages = new Set<number>();
      for (const h of e.pages) {
        requireValue(
          object(h) && integer(h.page_number, pageCount) &&
            UUID.test(String(h.attempt_id)) && integer(h.version, 1000000),
          "invalid_head",
        );
        requireValue(!pages.has(Number(h.page_number)), "duplicate_page_head");
        pages.add(Number(h.page_number));
        requireValue(
          h.upload_attempt_id === null
            ? h.raster_version === null
            : UUID.test(String(h.upload_attempt_id)) &&
              integer(h.raster_version, 1000000),
          "invalid_raster_head",
        );
      }
    }
    return raw as unknown as CoverageSource;
  }).sort((a, b) => a.document_id.localeCompare(b.document_id));
  requireValue(
    sources.reduce((n, s) => n + s.source_page_count, 0) <= 10000,
    "inventory_page_budget_exceeded",
  );

  const documents = sources.map((source) => {
    const e = source.executions[0];
    const heads = new Map((e?.pages || []).map((h) => [h.page_number, h]));
    const allPages = Array.from(
      { length: source.source_page_count },
      (_, i) => i + 1,
    );
    const retained = allPages.filter((p) => heads.get(p)?.upload_attempt_id);
    const missing = allPages.filter((p) => !heads.get(p)?.upload_attempt_id);
    const indexMissing = allPages.filter((p) =>
      !source.indexed_pages.includes(p)
    );
    const blockers = [
      ...(source.source_byte_count > 64 * 1024 * 1024
        ? ["original_exceeds_verified_worker_64_mib_limit"]
        : []),
      ...(indexMissing.length ? ["indexed_page_coverage_incomplete"] : []),
    ];
    const stage = blockers.length
      ? "blocked"
      : !e
      ? "requires_source_enrollment"
      : missing.length
      ? "requires_current_binding_revalidation"
      : "requires_proof_opening_verification";
    const batches = [];
    // Four pages is deliberately below the worker's eight-page hard cap.
    if (!blockers.length) {
      for (let offset = 0; offset < missing.length; offset += 4) {
        batches.push({
          pages: missing.slice(offset, offset + 4).map((page) => ({
            page_number: page,
            expected_previous_observation_attempt_id:
              heads.get(page)?.attempt_id || null,
            expected_previous_observation_version: heads.get(page)?.version ||
              null,
            action: heads.has(page)
              ? "replace_observation_for_missing_raster"
              : "create_observation_and_raster",
          })),
        });
      }
    }
    return {
      documentId: source.document_id,
      sourceSha256: source.source_sha256,
      sourceRevision: source.source_revision,
      sourcePageCount: source.source_page_count,
      sourceByteCount: source.source_byte_count,
      indexJobId: source.index_job_id,
      stage,
      blockers,
      missingIndexPages: indexMissing,
      retainedHeads: (e?.pages || []).filter((h) => h.upload_attempt_id).map(
        (h) => ({ ...h }),
      ),
      missingProofPages: missing,
      expectedExecution: e
        ? {
          executionId: e.execution_id,
          bindingId: e.binding_id,
          bindingVersion: e.binding_version,
        }
        : null,
      batches,
    };
  });
  return {
    schemaVersion: "ecos-proof-coverage-plan/1.0",
    executable: false,
    publicationMode: "shadow",
    scope: { ...scope },
    limitations: [
      "Head presence is not attestation, current authorization, or successful device opening.",
      "Revalidate source identity, authority, original, execution, claims and predecessors before every batch.",
      "Never renew an existing binding merely to add missing pages; preserve current heads.",
      "This plan covers only the supplied current indexed corpus, not every uploaded project input.",
    ],
    summary: {
      documents: documents.length,
      pages: documents.reduce((n, d) => n + d.sourcePageCount, 0),
      retainedHeadPages: documents.reduce(
        (n, d) => n + d.retainedHeads.length,
        0,
      ),
      missingProofPages: documents.reduce(
        (n, d) => n + d.missingProofPages.length,
        0,
      ),
      blockedPages: documents.filter((d) => d.blockers.length).reduce(
        (n, d) => n + d.missingProofPages.length,
        0,
      ),
      plannedBatches: documents.reduce((n, d) => n + d.batches.length, 0),
    },
    documents,
  };
}

if (import.meta.main) {
  const [inventoryPath, ownerId, projectId] = Deno.args;
  requireValue(
    inventoryPath && ownerId && projectId && Deno.args.length === 3,
    "usage_inventory_owner_project",
  );
  const stat = await Deno.stat(inventoryPath);
  requireValue(
    stat.isFile && stat.size <= 4 * 1024 * 1024,
    "inventory_too_large",
  );
  console.log(
    JSON.stringify(
      planECOSProofCoverage(
        JSON.parse(await Deno.readTextFile(inventoryPath)),
        { ownerId, projectId },
      ),
      null,
      2,
    ),
  );
}
