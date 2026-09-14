// Synthetic JSON RPC/Storage fixtures with genuine production binders and PNG decode.
// No live SQL, customer originals, model, hosted source or authorization proof.
// deno-lint-ignore-file no-explicit-any require-await
import { PNG } from "npm:pngjs@7.0.0";
import {
  createOwnerIndexedPageFixture,
  ownerPageTestHash as hash,
  ownerPageTestId as id,
} from "./ecos-owner-indexed-page-observations-fixture.ts";
import { buildECOSOwnerObservationBundle } from "./ecos-owner-observation-bundle.ts";
import { loadECOSOwnerIndexedPageObservations } from "./ecos-owner-indexed-page-observations-loader.ts";
import {
  assembleECOSLinkedOwnerProjectDocumentIndexes,
  bindECOSLinkedOwnerProjectDocumentIndexesPage,
} from "./ecos-linked-owner-project-document-indexes.ts";
function assert(v: unknown, message = "Assertion failed"): asserts v {
  if (!v) throw Error(message);
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const text =
  "NORTH panel 175 mm. NOT approved for installation.\nSOUTH panel 225 mm; do NOT substitute.";
async function byteHash(bytes: Uint8Array) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>),
    ),
  ]
    .map((v) => v.toString(16).padStart(2, "0")).join("");
}
export async function createOwnerDocumentSourceViewFixture(
  options: Readonly<{ independentImage?: boolean }> = {},
) {
  const f = await createOwnerIndexedPageFixture({ pageCount: 2, text });
  const png = new PNG({ width: 8, height: 6 });
  png.data.fill(255);
  const bytes = new Uint8Array(
    PNG.sync.write(png, { colorType: 6, bitDepth: 8 }),
  );
  const rasterSHA = await byteHash(bytes),
    raw = f.rawPages[0],
    body = JSON.parse(raw.page_json);
  const visual = {
    schema_version: "ecos-page-visual-observations/2.1",
    source: {
      source_sha256: raw.source_sha256,
      source_page_count: 2,
      page_number: 1,
      rotation_degrees: 90,
      display_width_points: 800,
      display_height_points: 600,
      cropbox: [0, 0, 600, 800],
      mediabox: [0, 0, 600, 800],
    },
    raster: {
      sha256: rasterSHA,
      byte_count: bytes.length,
      width: 8,
      height: 6,
      coordinate_system: "rotated_display_cropbox_pixels_top_left",
      hash_scope: "exact_png_bytes",
      decode_verified_by_parser: false,
    },
    engine: {
      name: "tesseract",
      version: "synthetic",
      language: "eng",
      oem: 1,
      psm: 11,
      invoked_executable_sha256: "b".repeat(64),
    },
    raw_tsv_sha256: "c".repeat(64),
    raw_tsv_bytes: 100,
    observed_row_count: 1,
    observed_word_count: 0,
    low_engine_confidence_word_count: 0,
    geometry_conflicts: [],
    state: "unreadable",
    lines: [],
    limitation_codes: [
      "pixel_ocr_not_native_text",
      "ocr_transcription_not_visually_verified",
      "layout_grouping_is_engine_observation_not_semantic_association",
      "reading_order_not_verified",
      "unrecognized_visual_content_not_accounted",
      "no_project_or_execution_authority",
      "ocr_no_text_detected_not_verified_empty",
    ],
    retrieval_authorized: false,
    semantic_verified: false,
  };
  const table = {
    schema_version: "ecos-original-table-observations/2.1",
    extraction_version: "ecos-native-table-sources/2.0",
    source_sha256: raw.source_sha256,
    source_page_count: 2,
    page_number: 1,
    page_width: 600,
    page_height: 800,
    coordinate_system: "pdf_points_top_left",
    state: "partial",
    limitation_codes: [
      "native_ruled_tables_only",
      "visual_understanding_pending",
      "authority_resolution_pending",
    ],
    retrieval_authorized: false,
    semantic_verified: false,
    source_identity_basis: "caller_supplied_pins_require_measured_bytes",
    tables: [{
      table_id: "page:1:table:1",
      bbox: [10, 10, 210, 50],
      rows: [
        {
          row_number: 1,
          cells: [
            { column_number: 1, text: "Panel", bbox: [10, 10, 110, 30] },
            {
              column_number: 2,
              text: "Qualification",
              bbox: [110, 10, 210, 30],
            },
          ],
        },
        {
          row_number: 2,
          cells: [{
            column_number: 1,
            text: "NORTH 175 mm",
            bbox: [10, 30, 110, 50],
          }, {
            column_number: 2,
            text: "NOT inspected",
            bbox: [110, 30, 210, 50],
          }],
        },
      ],
    }],
  };
  for (const [lane, value] of [["table", table], ["visual", visual]] as const) {
    if (lane === "visual" && options.independentImage) continue;
    const payload_json = JSON.stringify(value);
    body.modalities[lane] = {
      state: value.state,
      payload_json,
      limitation_codes: value.limitation_codes,
    };
    (raw.head.modalities as any)[lane] = {
      state: value.state,
      payload_sha256: await hash(payload_json),
      payload_bytes: new TextEncoder().encode(payload_json).length,
      limitation_codes: value.limitation_codes,
    };
  }
  if (options.independentImage) {
    body.modalities.visual = {
      state: "failed",
      payload_json: null,
      limitation_codes: ["visual_engine_failed"],
    };
    raw.head.modalities.visual = {
      state: "failed",
      payload_sha256: null,
      payload_bytes: 0,
      limitation_codes: ["visual_engine_failed"],
    };
  }
  raw.page_json = JSON.stringify(body);
  raw.head.page_sha256 = await hash(raw.page_json);
  const indexes = assembleECOSLinkedOwnerProjectDocumentIndexes([
    bindECOSLinkedOwnerProjectDocumentIndexesPage(f.response(), f.inventory, {
      afterOrdinal: 0,
      pageLimit: 64,
      indexEpochSha256: null,
    }),
  ], f.inventory);
  const selected = await loadECOSOwnerIndexedPageObservations(
    f.inventory,
    indexes,
    [f.selection],
    f.rpc,
  );
  const bundle = await buildECOSOwnerObservationBundle(
    f.inventory,
    indexes,
    selected,
  );
  const page = bundle.pages[0], e = indexes.sources[0].resolution.execution!;
  const common = {
    organization_id: f.inventory.organization_id,
    project_id: f.inventory.project_id,
    owner_id: f.inventory.owner_id,
    source_id: page.source_id,
    source_sha256: page.source_sha256,
    source_revision: page.source_revision,
    source_page_count: 2,
    page_number: 1,
    execution_id: e.execution_id,
    binding_id: e.binding_id,
    extraction_version: e.extraction_version,
    authority_decision_id: e.authority_decision_id,
    authority_receipt_sha256: e.authority_receipt_sha256,
    managed_attempt_id: e.managed_attempt_id,
    managed_receipt_sha256: e.managed_receipt_sha256,
    page_attempt_id: page.head.attempt_id,
    page_sha256: page.head.page_sha256,
  };
  const imagePayloadJSON = options.independentImage
    ? JSON.stringify({
      schema_version: "ecos-original-page-image/2.2",
      source_sha256: common.source_sha256,
      source_page_count: common.source_page_count,
      page_number: common.page_number,
      state: "rendered",
      raster_sha256: rasterSHA,
      raster_byte_count: bytes.length,
      raster_width: 8,
      raster_height: 6,
      coordinate_system: "rotated_display_cropbox_pixels_top_left",
      renderer_sha256: "d".repeat(64),
      renderer_version: "synthetic-independent-renderer",
      requested_dpi: 200,
      ocr_attempted: false,
      semantic_verified: false,
      retrieval_authorized: false,
    })
    : null;
  const attestation = {
    schema_version: options.independentImage
      ? "ecos-owner-page-raster-attestation/2.2"
      : "ecos-owner-page-raster-attestation/2.1",
    publication_mode: "shadow",
    ...common,
    visual_payload_sha256: page.modalities.visual.payload_sha256,
    ...(imagePayloadJSON === null ? {} : {
      image_payload_json: imagePayloadJSON,
      image_payload_sha256: await hash(imagePayloadJSON),
    }),
    raster_sha256: rasterSHA,
    raster_byte_count: bytes.length,
    raster_width: 8,
    raster_height: 6,
    raster_coordinate_system: "rotated_display_cropbox_pixels_top_left",
    upload_attempt_id: id(700),
    expected_previous_upload_attempt_id: null,
    // Restore the public deployment identifier removed from the review export.
    // All owner/source/page/PNG data in this fixture remains synthetic.
    storage_project_ref: "xdytqlpsqsseoeuxgzre",
    bucket: "project-documents",
    object_key:
      `v2-rasters/${common.owner_id}/${e.execution_id}/${e.binding_id}/${page.head.attempt_id}/${
        id(700)
      }.png`,
    verification: "exact_png_sha256_and_independent_decode",
    retrieval_authorized: false,
    semantic_verified: false,
  };
  delete (attestation as any).authority_decision_id;
  delete (attestation as any).authority_receipt_sha256;
  delete (attestation as any).managed_attempt_id;
  delete (attestation as any).managed_receipt_sha256;
  const receipt = {
    schema_version: "ecos-owner-page-raster-receipt/2.1",
    publication_mode: "shadow",
    attestation_json: JSON.stringify(attestation),
    attestation_sha256: await hash(JSON.stringify(attestation)),
    version: 1,
    previous_upload_attempt_id: null,
    committed_at: "2026-09-06T06:00:00.000000Z",
    verification: "trusted_service_attested_png_readback",
    retrieval_authorized: false,
    semantic_verified: false,
  };
  const rasterWire: any = {
    schema_version: "ecos-owner-page-raster-read/2.1",
    publication_mode: "shadow",
    owner_id: common.owner_id,
    organization_id: common.organization_id,
    project_id: common.project_id,
    execution_id: e.execution_id,
    binding_id: e.binding_id,
    page_number: 1,
    expected_page_attempt_id: common.page_attempt_id,
    expected_page_sha256: common.page_sha256,
    expected_upload_attempt_id: null,
    state: "current",
    current_upload_attempt_id: id(700),
    receipt_json: JSON.stringify(receipt),
    receipt_sha256: await hash(JSON.stringify(receipt)),
    availability: "private_locator_requires_verified_download",
    retrieval_authorized: false,
    semantic_verified: false,
  };
  const n = page.modalities.native.observations!, excerpt = n.excerpts[0];
  const prefix = {
    evidence_id: "e1",
    context_id: "s1",
    selected: true,
    source_id: page.source_id,
    source_sha256: page.source_sha256,
  };
  const native = {
    ...prefix,
    kind: "native_excerpt",
    quote: excerpt.text,
    locator: {
      ...common,
      payload_sha256: page.modalities.native.payload_sha256,
      modality: "native",
      excerpt_id: excerpt.id,
      block_ordinal: excerpt.blockOrdinal,
      text_start: excerpt.textStart,
      text_end: excerpt.textEnd,
      page_text_sha256: n.pageTextSha256,
      bbox: excerpt.bbox,
      coordinate_system: n.pageGeometry.coordinateSystem,
      coordinate_space: n.pageGeometry.coordinateSpace,
    },
  };
  const tab = page.modalities.table.observations!,
    cell = tab.tables[0].rows[1].cells[1];
  const tableCitation = {
    ...prefix,
    kind: "table_cell",
    quote: cell.text,
    locator: {
      ...common,
      payload_sha256: page.modalities.table.payload_sha256,
      modality: "table",
      table_id: tab.tables[0].tableId,
      row_number: 2,
      column_number: 2,
      bbox: cell.bbox,
      coordinate_system: tab.pageGeometry.coordinateSystem,
      coordinate_space: tab.pageGeometry.coordinateSpace,
    },
  };
  // I03 belongs to the old answer. Fresh one-image retrieval will call it I01;
  // this transient model mapping must never replace durable raster identity.
  const visualCitation = {
    ...prefix,
    kind: "visual_page",
    image_id: "I03",
    locator: {
      ...common,
      image_id: "I03",
      ...(imagePayloadJSON === null ? {} : {
        locator_schema_version: "ecos-owner-raster-source-locator/2.2",
        image_payload_sha256: await hash(imagePayloadJSON),
      }),
      visual_payload_sha256: page.modalities.visual.payload_sha256,
      raster_sha256: rasterSHA,
      raster_byte_count: bytes.length,
      raster_width: 8,
      raster_height: 6,
      upload_attempt_id: id(700),
      raster_receipt_sha256: rasterWire.receipt_sha256,
      pixel_box: [0, 0, 8, 6],
      coordinate_system: "rotated_display_cropbox_pixels_top_left",
      anchor_kind: "whole_verified_page_image_not_text_quote",
    },
  };
  const calls: any[] = [];
  let hook: ((name: string, params: any, raw: any) => any) | null = null;
  let downloaded = bytes;
  const rpc = async (name: string, params: any, signal: AbortSignal) => {
    assert(!signal.aborted);
    calls.push({ name, params });
    const wire = name === "ecos_list_linked_owner_project_document_inventory"
      ? f.inventoryWire
      : name === "ecos_resolve_linked_owner_project_document_indexes"
      ? f.response(Number(params.p_after_ordinal), Number(params.p_limit))
      : name === "ecos_read_owner_page_observations"
      ? f.rawPages[Number(params.p_page_number) - 1]
      : {
        ...rasterWire,
        expected_upload_attempt_id: params.p_expected_upload_attempt_id,
      };
    return hook ? await hook(name, params, clone(wire)) : clone(wire);
  };
  const ports = {
    inventoryRPC: rpc,
    indexRPC: rpc,
    pageRPC: rpc,
    rasterRPC: rpc,
    download: async () => {
      calls.push({ name: "download" });
      return downloaded.slice();
    },
  };
  const input = (
    citation: any = native,
    answerSchemaVersion: any = "ecos-owner-source-answer/2.2",
  ) => ({
    answerSchemaVersion,
    scope: {
      organizationId: common.owner_id,
      ownerId: common.owner_id,
      projectId: common.project_id,
    },
    citation,
  });
  calls.length = 0;
  return {
    f,
    indexes,
    selected,
    bytes,
    rasterWire,
    native,
    tableCitation,
    visualCitation,
    input,
    ports,
    calls,
    setHook: (h: typeof hook) => hook = h,
    setDownload: (b: Uint8Array) => downloaded = b,
  };
}
