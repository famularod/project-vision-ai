// Local test fixture only. Uses genuine public binders; no private-brand escape.
// Synthetic native text is not PDF extraction or semantic-quality evidence.
import {
  assembleECOSLinkedOwnerProjectDocumentInventory,
  bindECOSLinkedOwnerProjectDocumentInventoryPage,
} from "./ecos-linked-owner-project-document-inventory.ts";
import {
  assembleECOSLinkedOwnerProjectDocumentIndexes,
  bindECOSLinkedOwnerProjectDocumentIndexesPage,
} from "./ecos-linked-owner-project-document-indexes.ts";
import type { ECOSOwnerIndexedPageRPC } from "./ecos-owner-indexed-page-observations-loader.ts";
export const ownerPageTestId = (n: number) =>
  `74000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export async function ownerPageTestHash(text: string) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
  ].map((n) => n.toString(16).padStart(2, "0")).join("");
}
export async function createOwnerIndexedPageFixture(
  options: {
    state?: "released" | "running" | "queued";
    pageCount?: number;
    text?: string;
    nativeExtra?: Record<string, unknown>;
    tablePaddingBytes?: number;
  } = {},
) {
  const id = ownerPageTestId,
    hash = ownerPageTestHash,
    owner = id(1),
    project = id(2),
    source = "original-a",
    sha = "a".repeat(64),
    pageCount = options.pageCount ?? 2;
  const decision = {
    schema_version: "ecos-document-project-binding-decision/2.1",
    publication_mode: "shadow",
    decision_id: id(3),
    organization_id: owner,
    owner_id: owner,
    reviewed_by: owner,
    review_project_id: project,
    review_epoch_sha256: "1".repeat(64),
    document_id: source,
    document_metadata_sha256: "2".repeat(64),
    content_sha256: sha,
    source_revision: null,
    project_ids: [project],
    expected_previous_decision_id: null,
    review_confirmation: "exact_project_ids_confirmed",
    authority_policy: "configured_app_owner_workspace/1.0",
    original_organization_state: "missing",
    source_page_count: pageCount,
    source_locator_sha256: "3".repeat(64),
    source_generation: 0,
  };
  const decision_json = JSON.stringify(decision),
    receipt_json = JSON.stringify({
      schema_version: "ecos-document-project-binding-receipt/2.1",
      publication_mode: "shadow",
      decision_json,
      decision_sha256: await hash(decision_json),
      version: 1,
      previous_decision_id: null,
      binding_context_sha256: "4".repeat(64),
      committed_at: "2026-09-06T04:00:00Z",
      verification: "owner_reviewed_association_only",
      retrieval_authorized: false,
    });
  const receipt_sha256 = await hash(receipt_json);
  const sourceRow = {
    source_id: source,
    registry_row: {
      source_id: source,
      metadata_sha256: "5".repeat(64),
      source_sha256: null,
      source_revision: null,
      source_page_count: null,
      is_current: null,
      category: null,
      disposition: "needs_review",
      limitations: ["organization_scope_missing"],
    },
    association_kind: "exact_primary",
    association_state: "current",
    binding_read: null,
    owner_authority_read: {
      schema_version: "ecos-document-project-binding-read/2.1",
      publication_mode: "shadow",
      organization_id: owner,
      owner_id: owner,
      project_id: project,
      document_id: source,
      state: "current",
      decision_id: id(3),
      receipt_json,
      receipt_sha256,
      retrieval_authorized: false,
    },
    effective_source: {
      source_id: source,
      source_sha256: sha,
      source_revision: null,
      source_page_count: pageCount,
      authority_kind: "owner_workspace_receipt",
      authority_decision_id: id(3),
      authority_receipt_sha256: receipt_sha256,
      source_locator_sha256: "3".repeat(64),
    },
  };
  const inventoryWire = {
    schema_version: "ecos-linked-owner-project-document-inventory/2.1",
    publication_mode: "shadow",
    scope: "owner_workspace_primary_and_reviewed_documents_only",
    organization_id: owner,
    owner_id: owner,
    project_id: project,
    epoch_sha256: "6".repeat(64),
    total_count: 1,
    after_source_id: null,
    rows: [sourceRow],
    next_source_id: null,
    legacy_name_scope: "not_assessed",
    operational_records: "not_assessed",
    indexing_status: "not_assessed",
    retrieval_authorized: false,
  };
  const inventory = assembleECOSLinkedOwnerProjectDocumentInventory([
    await bindECOSLinkedOwnerProjectDocumentInventoryPage(inventoryWire, {
      organizationId: owner,
      ownerId: owner,
      projectId: project,
      epochSha256: null,
      afterSourceId: null,
      pageLimit: 25,
    }),
  ]);
  const execution = {
    execution_id: id(4),
    binding_id: id(5),
    binding_version: 1,
    source_sha256: sha,
    source_revision: null,
    source_page_count: pageCount,
    extraction_version: "ecos-owner-native-preview/2.0",
    authority_decision_id: id(3),
    authority_receipt_sha256: receipt_sha256,
    managed_attempt_id: id(6),
    managed_receipt_sha256: "7".repeat(64),
    state: options.state ?? "released",
  };
  const rawPages = await Promise.all(
    Array.from({ length: pageCount }, async (_, i) => {
      const n = i + 1;
      const text = options.text ??
        "NOT installed.\nRejected inspection; café 😀 remains unresolved.";
      const limitations = [
        "native_text_only",
        "visual_understanding_pending",
        "semantic_fact_extraction_pending",
      ];
      const native = {
        schema_version: "ecos-original-native-observations/2.1",
        extraction_version: "ecos-native-page-excerpts/2.0",
        source_sha256: sha,
        source_page_count: pageCount,
        page_number: n,
        page_width: 600,
        page_height: 800,
        coordinate_system: "pdf_points_top_left",
        state: "partial",
        page_text: text,
        page_text_sha256: await hash(text),
        observed_native_block_count: 1,
        excerpts: [{
          excerpt_id: `page:${n}:block:1`,
          block_ordinal: 1,
          text_start: 0,
          text_end: Array.from(text).length,
          bbox: [10, 10, 100, 30],
        }],
        limitation_codes: limitations,
        retrieval_authorized: false,
        semantic_verified: false,
        source_identity_basis: "caller_supplied_pins_require_measured_bytes",
        ...options.nativeExtra,
      };
      const table = options.tablePaddingBytes
        ? {
          schema_version: "ecos-original-table-observations/2.1",
          extraction_version: "ecos-native-table-sources/2.0",
          source_sha256: sha,
          source_page_count: pageCount,
          page_number: n,
          page_width: 600,
          page_height: 800,
          coordinate_system: "pdf_points_top_left",
          state: "partial",
          tables: [{
            raw_unvalidated_padding: "x".repeat(options.tablePaddingBytes),
          }],
          limitation_codes: ["native_ruled_tables_only"],
          retrieval_authorized: false,
          semantic_verified: false,
          source_identity_basis: "caller_supplied_pins_require_measured_bytes",
        }
        : null;
      const slots = {
        native: {
          state: "partial",
          payload_json: JSON.stringify(native),
          limitation_codes: limitations,
        },
        table: {
          state: table ? "partial" : "failed",
          payload_json: table ? JSON.stringify(table) : null,
          limitation_codes: table
            ? ["native_ruled_tables_only"]
            : ["native_table_parser_failed"],
        },
        visual: {
          state: "not_attempted",
          payload_json: null,
          limitation_codes: ["not_requested"],
        },
      };
      const wrapper = {
        schema_version: "ecos-owner-page-observations/2.1",
        source_sha256: sha,
        source_revision: null,
        source_page_count: pageCount,
        page_number: n,
        extraction_version: execution.extraction_version,
        modalities: slots,
      };
      const page_json = JSON.stringify(wrapper);
      const modalities = Object.fromEntries(
        await Promise.all(
          Object.entries(slots).map(async ([lane, s]) => [lane, {
            state: s.state,
            payload_sha256: s.payload_json === null
              ? null
              : await hash(s.payload_json),
            payload_bytes: s.payload_json === null
              ? 0
              : new TextEncoder().encode(s.payload_json).length,
            limitation_codes: s.limitation_codes,
          }]),
        ),
      );
      return {
        schema_version: "ecos-owner-page-observation-checkpoint/2.1",
        publication_mode: "shadow",
        owner_id: owner,
        organization_id: owner,
        project_id: project,
        execution_id: execution.execution_id,
        binding_id: execution.binding_id,
        source_id: source,
        source_sha256: sha,
        source_revision: null,
        source_page_count: pageCount,
        extraction_version: execution.extraction_version,
        page_number: n,
        requested_attempt_id: id(100 + n),
        state: "current",
        outcome: "read",
        head: {
          attempt_id: id(100 + n),
          page_sha256: await hash(page_json),
          version: 1,
          previous_attempt_id: null,
          recorded_at: "2026-09-06T04:00:00Z",
          modalities,
        },
        page_json,
        validation: "raw_checkpoint_identity_and_byte_bounds_only",
        image_available: false,
        retrieval_authorized: false,
        semantic_verified: false,
      };
    }),
  );
  const flat = [
    {
      kind: "source",
      ordinal: 1,
      source_id: source,
      source_page_count: pageCount,
      resolution_state: execution.state === "released"
        ? "execution_current"
        : "execution_in_progress",
      execution,
    },
    ...rawPages.map((r, i) => ({
      kind: "page",
      ordinal: i + 2,
      source_id: source,
      page_number: i + 1,
      head: execution.state === "queued" ? null : r.head,
    })),
  ];
  function response(
    after = 0,
    limit = 64,
    patch: Record<string, unknown> = {},
  ) {
    const rows = flat.slice(after, after + limit);
    return {
      schema_version: "ecos-linked-owner-project-document-indexes/2.1",
      publication_mode: "shadow",
      organization_id: owner,
      owner_id: owner,
      project_id: project,
      inventory_epoch_sha256: inventory.epoch_sha256,
      index_epoch_sha256: "8".repeat(64),
      total_source_count: 1,
      total_expected_page_count: pageCount,
      total_row_count: flat.length,
      after_ordinal: after,
      next_ordinal: after + rows.length < flat.length
        ? after + rows.length
        : null,
      rows,
      retrieval_authorized: false,
      answer_readiness: "not_assessed",
      semantic_verified: false,
      image_available: false,
      ...patch,
    };
  }
  const indexes = assembleECOSLinkedOwnerProjectDocumentIndexes([
    bindECOSLinkedOwnerProjectDocumentIndexesPage(response(), inventory, {
      afterOrdinal: 0,
      pageLimit: 64,
      indexEpochSha256: null,
    }),
  ], inventory);
  const calls: {
    name: string;
    parameters: Readonly<Record<string, string | number | null>>;
    signal: AbortSignal;
  }[] = [];
  const rpc: ECOSOwnerIndexedPageRPC = (name, parameters, signal) => {
    calls.push({ name, parameters, signal });
    return Promise.resolve(
      name === "ecos_read_owner_page_observations"
        ? rawPages[Number(parameters.p_page_number) - 1]
        : response(
          Number(parameters.p_after_ordinal),
          Number(parameters.p_limit),
        ),
    );
  };
  return {
    inventory,
    indexes,
    rawPages,
    flat,
    response,
    rpc,
    calls,
    source,
    selection: { sourceId: source, pageNumber: 1 },
    inventoryWire,
  };
}
