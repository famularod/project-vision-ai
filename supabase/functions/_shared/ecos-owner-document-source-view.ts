/** Internal read-only citation resolution, NOT a bearer-authorized endpoint.
 * Caller authorization is required before AND after use. Citations are
 * untrusted lookup data, not access grants or proof an answer was correct.
 * /2.0 job locators and model image URLs are deliberately unsupported. */
import { copyECOSV2JSON } from "./ecos-v2-json-model.ts";
import { sourcePhaseTimer } from "./ecos-source-diagnostics.ts";
import {
  type ECOSLinkedOwnerProjectDocumentInventoryRPC,
  loadECOSLinkedOwnerProjectDocumentInventory,
} from "./ecos-linked-owner-project-document-inventory-loader.ts";
import {
  type ECOSLinkedOwnerProjectDocumentIndexesRPC,
  loadECOSLinkedOwnerProjectDocumentIndexes,
} from "./ecos-linked-owner-project-document-indexes-loader.ts";
import {
  type ECOSOwnerIndexedPageRPC,
  loadECOSOwnerIndexedPageObservations,
} from "./ecos-owner-indexed-page-observations-loader.ts";
import { buildECOSOwnerObservationBundle } from "./ecos-owner-observation-bundle.ts";
import {
  copyECOSOwnerRasterImageForSourceView,
  type ECOSOwnerRasterDownload,
  loadECOSOwnerRasterImages,
  revalidateECOSOwnerRasterImages,
} from "./ecos-owner-raster-images.ts";
import type { ECOSV2OwnerRasterReadRPC } from "./ecos-v2-preview-rpc-transport.ts";

type Data = Record<string, unknown>;
type Version = "ecos-owner-source-answer/2.1" | "ecos-owner-source-answer/2.2";
export interface ECOSOwnerDocumentSourceViewInput {
  answerSchemaVersion: Version;
  scope: { organizationId: string; projectId: string; ownerId: string };
  citation: unknown;
}
export interface ECOSOwnerDocumentSourceViewPorts {
  inventoryRPC: ECOSLinkedOwnerProjectDocumentInventoryRPC;
  indexRPC: ECOSLinkedOwnerProjectDocumentIndexesRPC;
  pageRPC: ECOSOwnerIndexedPageRPC;
  rasterRPC: ECOSV2OwnerRasterReadRPC;
  download: ECOSOwnerRasterDownload;
}
export interface ECOSOwnerDocumentSourceView {
  readonly schema_version: "ecos-owner-document-source-view/2.1";
  readonly state: "current_exact_page_image" | "changed" | "unavailable";
  readonly citation: Readonly<Data> | null;
  readonly page: Readonly<Data> | null;
  readonly raster: Readonly<Data> | null;
  readonly image_relation:
    | "exact_cited_visual_receipt"
    | "current_image_of_exact_cited_checkpoint_not_old_answer_image_proof"
    | null;
  readonly authorization: "caller_required_before_and_after";
  readonly highlight: null;
  readonly coordinate_relationship:
    "native_pdf_points_and_rotated_raster_pixels_not_converted";
  readonly freshness:
    | "fresh_sequential_source_page_and_raster_readbacks_only"
    | "not_asserted_no_image_returned";
  readonly inventory_epoch_sha256: string | null;
  readonly index_epoch_sha256: string | null;
  readonly semantic_verified: false;
  readonly whole_answer_verified: false;
  readonly atomic_project_snapshot: false;
  readonly retrieval_authorized: false;
}
const origins = new WeakMap<object, Uint8Array | null>();
const SHA = /^[a-f0-9]{64}$/;
const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const baseKeys = [
  "organization_id",
  "project_id",
  "owner_id",
  "source_id",
  "source_sha256",
  "source_revision",
  "source_page_count",
  "page_number",
  "execution_id",
  "binding_id",
  "extraction_version",
  "authority_decision_id",
  "authority_receipt_sha256",
  "managed_attempt_id",
  "managed_receipt_sha256",
  "page_attempt_id",
  "page_sha256",
] as const;
const textKeys = [
  "payload_sha256",
  "modality",
  "bbox",
  "coordinate_system",
  "coordinate_space",
];
const nativeKeys = [
  "excerpt_id",
  "block_ordinal",
  "text_start",
  "text_end",
  "page_text_sha256",
];
const tableKeys = ["table_id", "row_number", "column_number"];
const rasterKeys = [
  "visual_payload_sha256",
  "raster_sha256",
  "raster_byte_count",
  "raster_width",
  "raster_height",
  "upload_attempt_id",
  "raster_receipt_sha256",
  "pixel_box",
  "coordinate_system",
  "anchor_kind",
];
const independentRasterKeys = [
  "locator_schema_version",
  "image_payload_sha256",
  ...rasterKeys,
];
const aborted = Object.getOwnPropertyDescriptor(
  AbortSignal.prototype,
  "aborted",
)!.get!;
const fail = (): never => {
  throw new Error(
    "Owner document source unavailable, invalid, changed, cancelled or over bounds",
  );
};
function exact(value: unknown, keys: readonly string[]): Data {
  if (
    !value || typeof value !== "object" || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) return fail();
  const d = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(d, key)) ||
    Object.values(d).some((v) => !v.enumerable || !Object.hasOwn(v, "value"))
  ) return fail();
  return Object.fromEntries(
    Object.entries(d).map(([key, v]) => [key, v.value]),
  );
}
function int(value: unknown, min: number, max: number): number {
  if (
    typeof value !== "number" || !Number.isSafeInteger(value) || value < min ||
    value > max
  ) return fail();
  return value;
}
function token(value: unknown, pattern: RegExp) {
  if (typeof value !== "string" || !pattern.test(value)) return fail();
}
function sourceText(value: unknown) {
  if (
    typeof value !== "string" || !value || value.trim() !== value ||
    new TextEncoder().encode(value).length > 300
  ) return fail();
  for (const character of value) {
    const cp = character.codePointAt(0)!;
    if (cp < 32 || cp >= 127 && cp <= 159 || cp >= 0xd800 && cp <= 0xdfff) {
      return fail();
    }
  }
}
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (
    !a || !b || typeof a !== "object" || typeof b !== "object" ||
    Array.isArray(a) !== Array.isArray(b)
  ) return false;
  const x = Object.keys(a), y = Object.keys(b);
  return x.length === y.length &&
    x.every((key) =>
      Object.hasOwn(b, key) && same((a as Data)[key], (b as Data)[key])
    );
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function snapshot(input: unknown) {
  const p = exact(copyECOSV2JSON(input, 65536), [
    "answerSchemaVersion",
    "scope",
    "citation",
  ]);
  if (
    typeof p.answerSchemaVersion !== "string" ||
    !["ecos-owner-source-answer/2.1", "ecos-owner-source-answer/2.2"].includes(
      p.answerSchemaVersion,
    )
  ) return fail();
  const scope = exact(p.scope, ["organizationId", "projectId", "ownerId"]);
  for (const key of Object.keys(scope)) token(scope[key], UUID);
  if (scope.organizationId !== scope.ownerId) return fail();
  const c = p.citation as Data;
  const visual = c?.kind === "visual_page",
    native = c?.kind === "native_excerpt";
  if (!visual && !native && c?.kind !== "table_cell") return fail();
  exact(c, [
    "evidence_id",
    "context_id",
    "kind",
    "selected",
    "source_id",
    "source_sha256",
    "locator",
    visual ? "image_id" : "quote",
  ]);
  token(c.evidence_id, /^e[1-9][0-9]{0,2}$/);
  token(c.context_id, /^s[1-9][0-9]{0,2}$/);
  if (
    Number(String(c.evidence_id).slice(1)) > 512 ||
    Number(String(c.context_id).slice(1)) > 128 || c.selected !== true
  ) return fail();
  if (!visual && (typeof c.quote !== "string" || !c.quote.trim())) {
    return fail();
  }
  const independentRaster = visual &&
    (c.locator as Data)?.locator_schema_version !== undefined;
  const l = exact(c.locator, [
    ...baseKeys,
    ...(visual
      ? [
        "image_id",
        ...(independentRaster ? independentRasterKeys : rasterKeys),
      ]
      : [...textKeys, ...(native ? nativeKeys : tableKeys)]),
  ]);
  for (const key of baseKeys.filter((key) => key.endsWith("sha256"))) {
    token(l[key], SHA);
  }
  for (
    const key of [
      "organization_id",
      "project_id",
      "owner_id",
      "execution_id",
      "binding_id",
      "authority_decision_id",
      "managed_attempt_id",
      "page_attempt_id",
    ]
  ) token(l[key], UUID);
  if (
    l.organization_id !== scope.organizationId ||
    l.project_id !== scope.projectId || l.owner_id !== scope.ownerId ||
    l.source_id !== c.source_id || l.source_sha256 !== c.source_sha256 ||
    l.extraction_version !== "ecos-owner-native-preview/2.0"
  ) return fail();
  sourceText(l.source_id);
  if (l.source_revision !== null) sourceText(l.source_revision);
  int(l.source_page_count, 1, 10000);
  int(l.page_number, 1, l.source_page_count as number);
  const box = visual ? l.pixel_box : l.bbox;
  if (
    box !== null &&
    (!Array.isArray(box) || box.length !== 4 ||
      box.some((v) => typeof v !== "number" || !Number.isFinite(v)))
  ) return fail();
  if (visual) {
    token(c.image_id, /^I0[1-4]$/);
    if (
      l.image_id !== c.image_id ||
      l.coordinate_system !== "rotated_display_cropbox_pixels_top_left" ||
      l.anchor_kind !== "whole_verified_page_image_not_text_quote"
    ) return fail();
    if (independentRaster) {
      if (
        l.locator_schema_version !==
          "ecos-owner-raster-source-locator/2.2"
      ) return fail();
      token(l.image_payload_sha256, SHA);
      if (l.visual_payload_sha256 !== null) {
        token(l.visual_payload_sha256, SHA);
      }
    } else {
      token(l.visual_payload_sha256, SHA);
    }
    for (const key of ["raster_sha256", "raster_receipt_sha256"]) {
      token(l[key], SHA);
    }
    token(l.upload_attempt_id, UUID);
    int(l.raster_byte_count, 33, 33554432);
    int(l.raster_width, 1, 8000);
    int(l.raster_height, 1, 8000);
    if (
      (l.raster_width as number) * (l.raster_height as number) > 24000000 ||
      !same(l.pixel_box, [0, 0, l.raster_width, l.raster_height])
    ) return fail();
  } else {
    token(l.payload_sha256, SHA);
    if (
      l.modality !== (native ? "native" : "table") ||
      l.coordinate_system !== "pdf_points_top_left" ||
      l.coordinate_space !== "unrotated_crop_page"
    ) return fail();
    if (native) {
      token(l.page_text_sha256, SHA);
      if (
        typeof l.excerpt_id !== "string" || !l.excerpt_id ||
        l.excerpt_id.length > 300
      ) return fail();
      int(l.block_ordinal, 0, 10000);
      int(l.text_start, 0, 1048576);
      int(l.text_end, (l.text_start as number) + 1, 1048576);
    } else {
      if (
        typeof l.table_id !== "string" || !l.table_id || l.table_id.length > 300
      ) return fail();
      int(l.row_number, 1, 10000);
      int(l.column_number, 1, 10000);
    }
  }
  return freeze({
    scope: scope as unknown as ECOSOwnerDocumentSourceViewInput["scope"],
    citation: c,
    locator: l,
    visual,
    native,
  });
}
function result(
  state: ECOSOwnerDocumentSourceView["state"],
  fields: Partial<ECOSOwnerDocumentSourceView> = {},
  png: Uint8Array | null = null,
) {
  const value: ECOSOwnerDocumentSourceView = freeze({
    schema_version: "ecos-owner-document-source-view/2.1",
    state,
    citation: null,
    page: null,
    raster: null,
    image_relation: null,
    authorization: "caller_required_before_and_after",
    highlight: null,
    coordinate_relationship:
      "native_pdf_points_and_rotated_raster_pixels_not_converted",
    freshness: state === "current_exact_page_image"
      ? "fresh_sequential_source_page_and_raster_readbacks_only"
      : "not_asserted_no_image_returned",
    inventory_epoch_sha256: null,
    index_epoch_sha256: null,
    semantic_verified: false,
    whole_answer_verified: false,
    atomic_project_snapshot: false,
    retrieval_authorized: false,
    ...fields,
  });
  origins.set(value, png);
  return value;
}

/** Complete current inventories, one exact raw checkpoint, original verified
 * PNG and final raster/index checks. Unrelated changes since the old answer do
 * not invalidate matching cited bytes; changes during this read fail closed.
 * No source subset, fallback page, coordinate conversion or Storage mutation. */
export async function resolveECOSOwnerDocumentSourceView(
  input: ECOSOwnerDocumentSourceViewInput,
  ports: ECOSOwnerDocumentSourceViewPorts,
  options: { signal?: AbortSignal; budgetMs?: number } = {},
): Promise<Readonly<ECOSOwnerDocumentSourceView>> {
  const started = performance.now();
  // Diagnostics identify only our fixed operation, never input/source content.
  let phase = "input";
  const phaseTimer = sourcePhaseTimer();
  let timer: ReturnType<typeof setTimeout> | undefined,
    onAbort: (() => void) | undefined,
    signal: AbortSignal | undefined;
  const controller = new AbortController();
  try {
    const i = snapshot(input),
      p = exact(ports, [
        "inventoryRPC",
        "indexRPC",
        "pageRPC",
        "rasterRPC",
        "download",
      ]) as unknown as ECOSOwnerDocumentSourceViewPorts;
    if (Object.values(p).some((v) => typeof v !== "function")) return fail();
    const keys = Reflect.ownKeys(options);
    if (keys.some((k) => k !== "signal" && k !== "budgetMs")) return fail();
    const o = exact(options, keys as string[]);
    const budget = int(
        o.budgetMs === undefined ? 120000 : o.budgetMs,
        1,
        120000,
      ),
      deadline = started + budget;
    signal = o.signal as AbortSignal | undefined;
    if (signal !== undefined) aborted.call(signal);
    const check = () => {
      if (
        controller.signal.aborted || signal && aborted.call(signal) ||
        performance.now() >= deadline
      ) return fail();
    };
    const remaining = () => {
      check();
      return int(Math.floor(deadline - performance.now()), 1, 120000);
    };
    check();
    const stopped = new Promise<never>((_, reject) => {
      onAbort = () => {
        controller.abort();
        reject(new Error("Source view stopped"));
      };
      if (signal) {
        EventTarget.prototype.addEventListener.call(signal, "abort", onAbort, {
          once: true,
        });
      }
      timer = setTimeout(onAbort, Math.max(1, deadline - performance.now()));
    });
    const run = async () => {
      check();
      phase = "inventory";
      phaseTimer.next("inventory");
      const { inventory } = await loadECOSLinkedOwnerProjectDocumentInventory(
        i.scope,
        p.inventoryRPC,
        { signal: controller.signal, budgetMs: remaining() },
      );
      check();
      phase = "indexes";
      phaseTimer.next("indexes");
      const { resolved: indexes } =
        await loadECOSLinkedOwnerProjectDocumentIndexes(inventory, p.indexRPC, {
          signal: controller.signal,
          budgetMs: remaining(),
        });
      check();
      const source = indexes.sources.find((s) =>
        s.source.source_id === i.locator.source_id
      );
      const execution = source?.resolution.execution;
      if (!execution) return result("unavailable");
      const common = {
        organization_id: inventory.organization_id,
        project_id: inventory.project_id,
        owner_id: inventory.owner_id,
        source_id: source!.source.source_id,
        ...Object.fromEntries(
          baseKeys.filter((key) => key in execution).map((
            key,
          ) => [key, execution[key as keyof typeof execution]]),
        ),
      };
      if (
        Object.keys(common).some((key) =>
          !same(common[key as keyof typeof common], i.locator[key])
        )
      ) return result("changed");
      const selection = [{
        sourceId: i.locator.source_id as string,
        pageNumber: i.locator.page_number as number,
      }];
      // The complete index must already name the cited exact page head. Do not
      // fetch a replacement page merely to discover that its head changed.
      const indexedPage = source!.pages.find((page) =>
        page.page_number === i.locator.page_number
      );
      if (!indexedPage?.head) return result("unavailable");
      if (
        indexedPage.head.attempt_id !== i.locator.page_attempt_id ||
        indexedPage.head.page_sha256 !== i.locator.page_sha256
      ) return result("changed");
      phase = "page_observations";
      phaseTimer.next("page_observations");
      const selected = await loadECOSOwnerIndexedPageObservations(
        inventory,
        indexes,
        selection,
        p.pageRPC,
        { signal: controller.signal, budgetMs: remaining() },
      );
      check();
      phase = "observation_bundle";
      phaseTimer.next("observation_bundle");
      const bundle = await buildECOSOwnerObservationBundle(
        inventory,
        indexes,
        selected,
        { signal: controller.signal, budgetMs: Math.min(30000, remaining()) },
      );
      check();
      const page = bundle.pages[0], raw = selected.pages[0];
      const pageLocator = {
        ...common,
        page_number: page.page_number,
        page_attempt_id: page.head.attempt_id,
        page_sha256: page.head.page_sha256,
      };
      if (
        !same(
          Object.fromEntries(baseKeys.map((key) => [key, i.locator[key]])),
          pageLocator,
        )
      ) return result("changed");
      if (!i.visual) {
        const lane = i.native ? page.modalities.native : page.modalities.table;
        if (lane.payload_sha256 !== i.locator.payload_sha256) {
          return result("changed");
        }
        let matched = false;
        if (i.native) {
          const n = page.modalities.native.observations;
          matched = !!n &&
            n.excerpts.some((e) =>
              e.text === i.citation.quote &&
              same(i.locator, {
                ...pageLocator,
                payload_sha256: lane.payload_sha256,
                modality: "native",
                excerpt_id: e.id,
                block_ordinal: e.blockOrdinal,
                text_start: e.textStart,
                text_end: e.textEnd,
                page_text_sha256: n.pageTextSha256,
                bbox: e.bbox,
                coordinate_system: n.pageGeometry.coordinateSystem,
                coordinate_space: n.pageGeometry.coordinateSpace,
              })
            );
        } else {
          const t = page.modalities.table.observations;
          matched = !!t &&
            t.tables.some((table) =>
              table.rows.some((row) =>
                row.cells.some((cell) =>
                  cell.text === i.citation.quote &&
                  same(i.locator, {
                    ...pageLocator,
                    payload_sha256: lane.payload_sha256,
                    modality: "table",
                    table_id: table.tableId,
                    row_number: row.rowNumber,
                    column_number: cell.columnNumber,
                    bbox: cell.bbox,
                    coordinate_system: t.pageGeometry.coordinateSystem,
                    coordinate_space: t.pageGeometry.coordinateSpace,
                  })
                )
              )
            );
        }
        if (!matched) return result("changed");
      }
      phase = "raster_load";
      phaseTimer.next("raster_load");
      const images = await loadECOSOwnerRasterImages(
        inventory,
        indexes,
        [raw],
        p.rasterRPC,
        p.indexRPC,
        p.download,
        { signal: controller.signal, budgetMs: remaining() },
      );
      check();
      if (images.images.length !== 1) return result("unavailable");
      const image = images.images[0], a = image.receipt.attestation!;
      const raster = {
        ...(a.schema_version === "ecos-owner-page-raster-attestation/2.2"
          ? {
            locator_schema_version: "ecos-owner-raster-source-locator/2.2",
            image_payload_sha256: a.image_payload_sha256,
          }
          : {}),
        visual_payload_sha256: a.visual_payload_sha256,
        raster_sha256: a.raster_sha256,
        raster_byte_count: image.byteCount,
        raster_width: image.width,
        raster_height: image.height,
        upload_attempt_id: a.upload_attempt_id,
        raster_receipt_sha256: image.receipt.receipt_sha256,
        pixel_box: [0, 0, image.width, image.height],
        coordinate_system: image.coordinateSystem,
        anchor_kind: "whole_verified_page_image_not_text_quote",
      };
      if (
        i.visual &&
        !same(i.locator, {
          ...pageLocator,
          image_id: i.citation.image_id,
          ...raster,
        })
      ) return result("changed");
      phase = "raster_revalidate";
      phaseTimer.next("raster_revalidate");
      await revalidateECOSOwnerRasterImages(
        images,
        inventory,
        indexes,
        p.rasterRPC,
        p.indexRPC,
        { signal: controller.signal, budgetMs: remaining() },
      );
      check();
      phase = "result";
      phaseTimer.next("result");
      const copy = copyECOSOwnerRasterImageForSourceView(
        images,
        inventory,
        indexes,
        raw,
      );
      if (copy.pngBytes.length > 8 * 1024 * 1024) return fail();
      check();
      return result("current_exact_page_image", {
        citation: i.citation,
        page: pageLocator,
        raster,
        image_relation: i.visual
          ? "exact_cited_visual_receipt"
          : "current_image_of_exact_cited_checkpoint_not_old_answer_image_proof",
        inventory_epoch_sha256: inventory.epoch_sha256,
        index_epoch_sha256: indexes.index_epoch_sha256,
      }, copy.pngBytes);
    };
    const resolved = await Promise.race([Promise.resolve().then(run), stopped]);
    check();
    return resolved;
  } catch {
    try {
      console.warn(JSON.stringify({
        event: "ecos_owner_document_source_view_failed",
        phase,
        elapsedMs: Math.round(performance.now() - started),
      }));
    } catch { /* Diagnostics never change source acceptance or rejection. */ }
    return fail();
  } finally {
    phaseTimer.finish();
    if (timer !== undefined) clearTimeout(timer);
    if (signal && onAbort) {
      EventTarget.prototype.removeEventListener.call(signal, "abort", onAbort);
    }
    controller.abort();
  }
}

/** Copy only genuine retained source-view bytes. This is not a bearer check;
 * authorization and freshness do not persist for the lifetime of this object. */
export function copyECOSOwnerDocumentSourceViewPNG(
  value: ECOSOwnerDocumentSourceView,
): Uint8Array {
  const bytes = origins.get(value);
  if (!bytes || value.state !== "current_exact_page_image") return fail();
  return bytes.slice();
}
