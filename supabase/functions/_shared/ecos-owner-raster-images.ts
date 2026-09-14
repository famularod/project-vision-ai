import { Buffer } from "node:buffer";
import { inflateSync } from "node:zlib";
import { PNG } from "npm:pngjs@7.0.0";
import type { ECOSLinkedOwnerProjectDocumentInventory } from "./ecos-linked-owner-project-document-inventory.ts";
import type { ECOSLinkedOwnerProjectDocumentIndexes } from "./ecos-linked-owner-project-document-indexes.ts";
import {
  type ECOSLinkedOwnerProjectDocumentIndexesRPC,
  loadECOSLinkedOwnerProjectDocumentIndexes,
} from "./ecos-linked-owner-project-document-indexes-loader.ts";
import {
  assertECOSOwnerIndexedPageObservationsRead,
  type ECOSOwnerIndexedPageObservationsRead,
} from "./ecos-owner-page-observations.ts";
import {
  assertECOSOwnerPageRasterRead,
  bindECOSOwnerPageRasterRead,
  type ECOSOwnerPageRasterRead,
} from "./ecos-owner-page-raster.ts";
import type {
  ECOSV2OwnerRasterReadRPC,
  ECOSV2ServerRPCTransportOptions,
} from "./ecos-v2-preview-rpc-transport.ts";
import type { ECOSV2PNGImage } from "./ecos-v2-json-model.ts";

const ORIGIN = "https://xdytqlpsqsseoeuxgzre.supabase.co";
const MAX_BYTES = 8 * 1024 * 1024;
const fail = (): never => {
  throw new Error(
    "Owner page images unavailable, changed, cancelled or over bounds",
  );
};
const aborted = Object.getOwnPropertyDescriptor(
  AbortSignal.prototype,
  "aborted",
)!.get!;
const typed = Object.getPrototypeOf(Uint8Array.prototype);
const byteLength = Object.getOwnPropertyDescriptor(typed, "byteLength")!.get!;
const byteBuffer = Object.getOwnPropertyDescriptor(typed, "buffer")!.get!;
function copyBytes(value: unknown) {
  if (
    !(value instanceof Uint8Array) ||
    Object.getPrototypeOf(value) !== Uint8Array.prototype ||
    !(byteBuffer.call(value) instanceof ArrayBuffer)
  ) return fail();
  const length = byteLength.call(value);
  if (length < 33 || length > MAX_BYTES) return fail();
  const result = new Uint8Array(length);
  Uint8Array.prototype.set.call(result, value);
  return result;
}
function data(value: unknown, required: string[], optional: string[] = []) {
  if (
    !value || typeof value !== "object" ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) return fail();
  const d = Object.getOwnPropertyDescriptors(value);
  if (
    required.some((k) => !Object.hasOwn(d, k)) ||
    Reflect.ownKeys(value).some((k) =>
      typeof k !== "string" || ![...required, ...optional].includes(k)
    ) ||
    Object.values(d).some((v) => !v.enumerable || !Object.hasOwn(v, "value"))
  ) return fail();
  return Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.value]));
}
function integer(v: unknown, maximum: number) {
  if (
    typeof v !== "number" || !Number.isSafeInteger(v) || v < 1 || v > maximum
  ) return fail();
  return v;
}
async function sha(bytes: Uint8Array) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>),
    ),
  ].map((v) => v.toString(16).padStart(2, "0")).join("");
}

/** Resource-bounded independent decode of the worker's non-interlaced, 8-bit
 * grayscale/RGB/RGBA PNG profile. Unsupported encodings fail, never transcode.
 * All chunk CRCs, complete scanline length, full decode and dimensions checked.
 * Synchronous decode is checked before/after: it is NOT preemptively cancelled.
 * Dimensions cap decoded samples at 96MB; this is not a whole-process RSS cap. */
export async function verifyECOSOwnerRasterPNG(
  bytes: Uint8Array,
  expected: {
    sha256: string;
    byteCount: number;
    width: number;
    height: number;
  },
  signal: AbortSignal,
) {
  try {
    if (aborted.call(signal)) return fail();
    const p = data(expected, ["sha256", "byteCount", "width", "height"]);
    if (typeof p.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(p.sha256)) {
      return fail();
    }
    const width = integer(p.width, 8000),
      height = integer(p.height, 8000),
      count = integer(p.byteCount, MAX_BYTES);
    if (width * height > 24000000) return fail();
    const png = copyBytes(bytes);
    if (
      png.length !== count ||
      ![137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => png[i] === b)
    ) return fail();
    const view = new DataView(png.buffer);
    if (
      view.getUint32(8) !== 13 ||
      String.fromCharCode(...png.subarray(12, 16)) !== "IHDR" ||
      view.getUint32(16) !== width || view.getUint32(20) !== height ||
      png[24] !== 8 || ![0, 2, 4, 6].includes(png[25]) || png[26] !== 0 ||
      png[27] !== 0 || png[28] !== 0
    ) return fail();
    const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      return c >>> 0;
    });
    const idats: Uint8Array[] = [];
    let offset = 8, chunks = 0, ended = false, idatEnded = false;
    while (offset < png.length) {
      if (++chunks > 4096 || offset + 12 > png.length) return fail();
      const size = view.getUint32(offset), end = offset + 12 + size;
      if (end > png.length) return fail();
      const name = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
      if (
        !/^[A-Za-z]{4}$/.test(name) || ["acTL", "fcTL", "fdAT"].includes(name)
      ) return fail();
      let crc = 0xffffffff;
      for (let j = offset + 4; j < end - 4; j++) {
        crc = crcTable[(crc ^ png[j]) & 255] ^ (crc >>> 8);
      }
      if (((crc ^ 0xffffffff) >>> 0) !== view.getUint32(end - 4)) return fail();
      if (name === "IHDR" && offset !== 8) return fail();
      if (name === "IDAT") {
        if (idatEnded) return fail();
        idats.push(png.subarray(offset + 8, end - 4));
      } else if (idats.length) idatEnded = true;
      if (name === "IEND") {
        if (size !== 0 || end !== png.length || !idats.length) return fail();
        ended = true;
      }
      offset = end;
    }
    if (!ended || await sha(png) !== p.sha256 || aborted.call(signal)) {
      return fail();
    }
    // pngjs bounds its non-interlaced inflater by expected image length but can
    // truncate excess output. Independently reject over/under-length streams.
    const channels =
        ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[png[25]],
      expectedRaw = (width * channels + 1) * height;
    const compressed = Buffer.concat(
      idats.map((v) => Buffer.from(v.buffer, v.byteOffset, v.byteLength)),
    );
    // Node's info:true returns {buffer,engine}; this Deno Node typing version
    // still declares Buffer for every option. Validate the actual result below.
    const raw = inflateSync(compressed, {
      info: true,
      maxOutputLength: expectedRaw + 1,
    }) as unknown as { buffer: Uint8Array; engine: { bytesWritten: number } };
    if (
      !Buffer.isBuffer(raw.buffer) || raw.buffer.length !== expectedRaw ||
      raw.engine.bytesWritten !== compressed.length
    ) return fail();
    const decoded = PNG.sync.read(Buffer.from(png.buffer), { checkCRC: true });
    if (
      decoded.width !== width || decoded.height !== height ||
      decoded.depth !== 8 || decoded.data.length !== width * height * 4 ||
      aborted.call(signal)
    ) return fail();
    return Object.freeze({
      width,
      height,
      byteCount: png.length,
      sha256: p.sha256,
      verification:
        "exact_sha256_crc_scanlines_and_independent_png_decode" as const,
      semantic_verified: false as const,
    });
  } catch {
    return fail();
  }
}

export type ECOSOwnerRasterDownload = (
  inventory: ECOSLinkedOwnerProjectDocumentInventory,
  indexes: ECOSLinkedOwnerProjectDocumentIndexes,
  page: ECOSOwnerIndexedPageObservationsRead,
  receipt: ECOSOwnerPageRasterRead,
  signal: AbortSignal,
) => Promise<Uint8Array>;

/** Server-only fixed-host, fixed-private-key GET. No upload/delete, redirect,
 * retry, caller URL, cookies or credentials in returned diagnostics. */
export function createECOSOwnerRasterDownloadTransport(
  input: ECOSV2ServerRPCTransportOptions,
): ECOSOwnerRasterDownload {
  const options = data(input, ["serviceRoleKey", "scope"], [
    "fetchImpl",
    "timeoutMs",
  ]);
  const scope = data(options.scope, ["ownerId", "organizationId", "projectId"]);
  const uuid =
    /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
  if (
    typeof scope.ownerId !== "string" || !uuid.test(scope.ownerId) ||
    scope.organizationId !== scope.ownerId ||
    typeof scope.projectId !== "string" || !uuid.test(scope.projectId) ||
    typeof options.serviceRoleKey !== "string" ||
    !/^[!-~]{1,16384}$/.test(options.serviceRoleKey)
  ) return fail();
  const key = options.serviceRoleKey,
    fetchImpl = options.fetchImpl ?? fetch,
    timeout = integer(options.timeoutMs ?? 25000, 25000);
  if (typeof fetchImpl !== "function") return fail();
  return async (inventory, indexes, page, receipt, signal) => {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined,
      onAbort: (() => void) | undefined;
    try {
      assertECOSOwnerPageRasterRead(receipt, inventory, indexes, page);
      if (
        inventory.owner_id !== scope.ownerId ||
        inventory.project_id !== scope.projectId ||
        receipt.state !== "current" || !receipt.attestation ||
        aborted.call(signal)
      ) return fail();
      const a = receipt.attestation;
      if (a.raster_byte_count > MAX_BYTES) return fail();
      const url = `${ORIGIN}/storage/v1/object/${a.bucket}/${a.object_key}`,
        deadline = performance.now() + timeout;
      const check = () => {
        if (
          aborted.call(signal) || controller.signal.aborted ||
          performance.now() >= deadline
        ) return fail();
      };
      const stopped = new Promise<never>((_, reject) => {
        onAbort = () => {
          controller.abort();
          reject(new Error("Image download cancelled"));
        };
        EventTarget.prototype.addEventListener.call(signal, "abort", onAbort, {
          once: true,
        });
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("Image download deadline"));
        }, timeout);
      });
      const value = await Promise.race([
        Promise.resolve().then(async () => {
          check();
          const response = await fetchImpl(url, {
            method: "GET",
            headers: {
              Authorization: `Bearer ${key}`,
              apikey: key,
              Accept: "image/png",
              "Accept-Encoding": "identity",
            },
            redirect: "error",
            credentials: "omit",
            cache: "no-store",
            referrerPolicy: "no-referrer",
            signal: controller.signal,
          });
          // This finally belongs to the actual fetch continuation, not only
          // the caller's race. A late noncooperative response still gets closed.
          try {
            check();
            if (
              !(response instanceof Response) || response.status !== 200 ||
              response.redirected || response.url !== url ||
              response.headers.get("content-type")?.split(";")[0].trim()
                  .toLowerCase() !== "image/png" ||
              !["identity", ""].includes(
                response.headers.get("content-encoding")?.trim()
                  .toLowerCase() ??
                  "",
              )
            ) return fail();
            const advertised = response.headers.get("content-length");
            if (
              advertised !== null &&
              (!/^[0-9]{1,10}$/.test(advertised) ||
                Number(advertised) !== a.raster_byte_count)
            ) return fail();
            if (!response.body) return fail();
            reader = response.body.getReader();
            const bytes = new Uint8Array(a.raster_byte_count);
            let length = 0;
            while (true) {
              check();
              const part = await reader.read();
              check();
              if (part.done) break;
              if (
                !(part.value instanceof Uint8Array) ||
                length + part.value.byteLength > bytes.length
              ) return fail();
              bytes.set(part.value, length);
              length += part.value.byteLength;
            }
            if (length !== bytes.length) return fail();
            check();
            return bytes;
          } finally {
            if (reader) void reader.cancel().catch(() => {});
            else if (response instanceof Response) {
              void response.body?.cancel().catch(() => {});
            }
          }
        }),
        stopped,
      ]);
      return value;
    } catch {
      return fail();
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (onAbort) {
        EventTarget.prototype.removeEventListener.call(
          signal,
          "abort",
          onAbort,
        );
      }
      controller.abort();
      if (reader) void reader.cancel().catch(() => {});
    }
  };
}

export interface ECOSOwnerRasterImage {
  readonly imageId: string;
  readonly page: ECOSOwnerIndexedPageObservationsRead;
  readonly receipt: ECOSOwnerPageRasterRead;
  readonly byteCount: number;
  readonly width: number;
  readonly height: number;
  readonly coordinateSystem: "rotated_display_cropbox_pixels_top_left";
  readonly verification:
    "exact_sha256_crc_scanlines_and_independent_png_decode";
}
export interface ECOSOwnerRasterImages {
  readonly images: readonly Readonly<ECOSOwnerRasterImage>[];
  readonly gaps: readonly Readonly<
    {
      page: ECOSOwnerIndexedPageObservationsRead;
      reason: "missing" | "old" | "stale" | "image_budget_exceeded";
    }
  >[];
  readonly freshness:
    "raster_heads_and_complete_owner_index_rechecked_after_downloads";
  readonly atomic_project_snapshot: false;
  readonly semantic_verified: false;
  readonly retrieval_authorized: false;
}
const origins = new WeakMap<
  object,
  {
    inventory: ECOSLinkedOwnerProjectDocumentInventory;
    indexes: ECOSLinkedOwnerProjectDocumentIndexes;
    bytes: readonly Uint8Array[];
    reads: readonly ECOSOwnerPageRasterRead[];
  }
>();

/** At most four selected pages / 8MiB original PNG bytes, no resizing or OCR
 * substitution. Gaps remain explicit. Receipt reads surround downloads and a
 * complete index epoch recheck follows; this is sequential, not atomic. */
export async function loadECOSOwnerRasterImages(
  inventory: ECOSLinkedOwnerProjectDocumentInventory,
  indexes: ECOSLinkedOwnerProjectDocumentIndexes,
  supplied: readonly ECOSOwnerIndexedPageObservationsRead[],
  rasterRPC: ECOSV2OwnerRasterReadRPC,
  indexRPC: ECOSLinkedOwnerProjectDocumentIndexesRPC,
  download: ECOSOwnerRasterDownload,
  options: { signal: AbortSignal; budgetMs?: number },
): Promise<Readonly<ECOSOwnerRasterImages>> {
  try {
    const o = data(options, ["signal"], ["budgetMs"]),
      signal = o.signal as AbortSignal,
      budget = integer(o.budgetMs ?? 120000, 120000);
    if (
      aborted.call(signal) || typeof rasterRPC !== "function" ||
      typeof indexRPC !== "function" || typeof download !== "function" ||
      !Array.isArray(supplied) ||
      Object.getPrototypeOf(supplied) !== Array.prototype ||
      supplied.length < 1 || supplied.length > 4 ||
      Reflect.ownKeys(supplied).length !== supplied.length + 1
    ) return fail();
    const seen = new Set<string>();
    const pages = Array.from({ length: supplied.length }, (_, i) => {
      const d = Object.getOwnPropertyDescriptor(supplied, String(i));
      if (!d?.enumerable || !Object.hasOwn(d, "value")) return fail();
      const page = d.value;
      assertECOSOwnerIndexedPageObservationsRead(page, inventory, indexes);
      if (page.state !== "current" || !page.head || !page.modalities) {
        return fail();
      }
      const id = JSON.stringify([page.source_id, page.page_number]);
      if (seen.has(id)) return fail();
      seen.add(id);
      return page as ECOSOwnerIndexedPageObservationsRead;
    }).sort((a, b) =>
      a.source_id < b.source_id
        ? -1
        : a.source_id > b.source_id
        ? 1
        : a.page_number - b.page_number
    );
    const deadline = performance.now() + budget,
      check = () => {
        if (aborted.call(signal) || performance.now() >= deadline) {
          return fail();
        }
      };
    const bounded = async <T>(
      operation: (s: AbortSignal) => Promise<T>,
      maximum = 25000,
    ) => {
      check();
      const controller = new AbortController(),
        end = Math.min(deadline, performance.now() + maximum);
      let timer: ReturnType<typeof setTimeout> | undefined,
        onAbort: (() => void) | undefined;
      const stop = new Promise<never>((_, reject) => {
        onAbort = () => {
          controller.abort();
          reject(new Error("Image operation cancelled"));
        };
        EventTarget.prototype.addEventListener.call(signal, "abort", onAbort, {
          once: true,
        });
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("Image operation deadline"));
        }, Math.max(1, end - performance.now()));
      });
      try {
        const value = await Promise.race([
          Promise.resolve().then(() => {
            check();
            if (controller.signal.aborted) return fail();
            return operation(controller.signal);
          }),
          stop,
        ]);
        check();
        if (controller.signal.aborted || performance.now() >= end) {
          return fail();
        }
        return value;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        if (onAbort) {
          EventTarget.prototype.removeEventListener.call(
            signal,
            "abort",
            onAbort,
          );
        }
        controller.abort();
      }
    };
    const read = async (
      page: ECOSOwnerIndexedPageObservationsRead,
      uploadId: string | null,
    ) => {
      return await bounded(async (s) =>
        bindECOSOwnerPageRasterRead(
          await rasterRPC(
            "ecos_read_owner_page_raster",
            Object.freeze({
              p_owner_id: inventory.owner_id,
              p_project_id: inventory.project_id,
              p_execution_id: page.execution_id,
              p_binding_id: page.binding_id,
              p_page_number: page.page_number,
              p_expected_page_attempt_id: page.head!.attempt_id,
              p_expected_page_sha256: page.head!.page_sha256,
              p_expected_upload_attempt_id: uploadId,
            }),
            s,
          ),
          inventory,
          indexes,
          page,
          uploadId,
        )
      );
    };
    const images: Readonly<ECOSOwnerRasterImage>[] = [],
      gaps: ECOSOwnerRasterImages["gaps"][number][] = [],
      retained: Uint8Array[] = [],
      reads: ECOSOwnerPageRasterRead[] = [];
    let total = 0;
    for (const page of pages) {
      const receipt = await read(page, null);
      check();
      reads.push(receipt);
      if (receipt.state !== "current") {
        gaps.push(Object.freeze({ page, reason: receipt.state }));
        continue;
      }
      const a = receipt.attestation!;
      if (a.raster_byte_count > MAX_BYTES - total) {
        gaps.push(Object.freeze({ page, reason: "image_budget_exceeded" }));
        continue;
      }
      const bytes = copyBytes(
        await bounded((s) => download(inventory, indexes, page, receipt, s)),
      );
      const measurement = await bounded((s) =>
        verifyECOSOwnerRasterPNG(bytes, {
          sha256: a.raster_sha256,
          byteCount: a.raster_byte_count,
          width: a.raster_width,
          height: a.raster_height,
        }, s)
      );
      check();
      total += bytes.length;
      retained.push(bytes);
      images.push(Object.freeze({
        imageId: `I${String(images.length + 1).padStart(2, "0")}`,
        page,
        receipt,
        byteCount: measurement.byteCount,
        width: measurement.width,
        height: measurement.height,
        coordinateSystem: "rotated_display_cropbox_pixels_top_left",
        verification: measurement.verification,
      }));
    }
    for (const before of reads) {
      const after = await read(before.page, before.current_upload_attempt_id);
      if (
        after.state !== before.state ||
        after.current_upload_attempt_id !== before.current_upload_attempt_id ||
        after.receipt_json !== before.receipt_json ||
        after.receipt_sha256 !== before.receipt_sha256
      ) return fail();
    }
    check();
    const remaining = Math.floor(deadline - performance.now());
    if (remaining < 1) return fail();
    const final = await loadECOSLinkedOwnerProjectDocumentIndexes(
      inventory,
      indexRPC,
      {
        signal,
        budgetMs: remaining,
        expectedIndexEpoch: indexes.index_epoch_sha256,
      },
    );
    check();
    if (JSON.stringify(final.resolved) !== JSON.stringify(indexes)) {
      return fail();
    }
    const result = Object.freeze({
      images: Object.freeze(images),
      gaps: Object.freeze(gaps),
      freshness:
        "raster_heads_and_complete_owner_index_rechecked_after_downloads" as const,
      atomic_project_snapshot: false as const,
      semantic_verified: false as const,
      retrieval_authorized: false as const,
    });
    origins.set(result, {
      inventory,
      indexes,
      bytes: retained,
      reads: Object.freeze(reads),
    });
    return result;
  } catch {
    return fail();
  }
}

/** Explicit server-side copy for model composition/review only. The original
 * image packet remains private and cannot be mutated through the returned copy.
 * This verifies origin, not whether a model's answer is supported by pixels. */
export function copyECOSOwnerRasterImagesForModel(
  value: ECOSOwnerRasterImages,
  inventory: ECOSLinkedOwnerProjectDocumentInventory,
  indexes: ECOSLinkedOwnerProjectDocumentIndexes,
): readonly ECOSV2PNGImage[] {
  const origin = origins.get(value);
  if (!origin || origin.inventory !== inventory || origin.indexes !== indexes) {
    return fail();
  }
  return value.images.map((image, i) => {
    const a = image.receipt.attestation!;
    return {
      imageId: image.imageId,
      sourceId: a.source_id,
      sourceSha256: a.source_sha256,
      pageNumber: a.page_number,
      sourcePageCount: a.source_page_count,
      rasterSha256: a.raster_sha256,
      pngBytes: origin.bytes[i].slice(),
    };
  });
}

/** Internal source-view copy, not a model packet or authorization grant. The
 * caller must recheck access before/after resolving and match its citation to
 * this exact page/receipt. Returned bytes are an independent mutable copy. */
export function copyECOSOwnerRasterImageForSourceView(
  value: ECOSOwnerRasterImages,
  inventory: ECOSLinkedOwnerProjectDocumentInventory,
  indexes: ECOSLinkedOwnerProjectDocumentIndexes,
  page: ECOSOwnerIndexedPageObservationsRead,
) {
  const origin = origins.get(value);
  if (!origin || origin.inventory !== inventory || origin.indexes !== indexes) {
    return fail();
  }
  const ordinal = value.images.findIndex((image) => image.page === page);
  if (ordinal < 0) return fail();
  return Object.freeze({
    image: value.images[ordinal],
    pngBytes: origin.bytes[ordinal].slice(),
    purpose: "exact_page_source_view_not_semantic_verification" as const,
  });
}

/** Final read-only guard after composition/review. Rechecks every requested
 * raster head (including missing/over-budget images) and the COMPLETE source
 * index against the privately retained original read. It does not redownload,
 * grant access, verify a model, or certify freshness after this return. The
 * caller must separately recheck caller access before returning an answer.
 * These sequential reads are deliberately not described as an atomic snapshot.
 */
export async function revalidateECOSOwnerRasterImages(
  value: ECOSOwnerRasterImages,
  inventory: ECOSLinkedOwnerProjectDocumentInventory,
  indexes: ECOSLinkedOwnerProjectDocumentIndexes,
  rasterRPC: ECOSV2OwnerRasterReadRPC,
  indexRPC: ECOSLinkedOwnerProjectDocumentIndexesRPC,
  options: { signal: AbortSignal; budgetMs?: number },
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  let signal: AbortSignal | undefined;
  const controller = new AbortController();
  try {
    const origin = origins.get(value);
    if (
      !origin || origin.inventory !== inventory || origin.indexes !== indexes ||
      typeof rasterRPC !== "function" || typeof indexRPC !== "function"
    ) return fail();
    const o = data(options, ["signal"], ["budgetMs"]);
    signal = o.signal as AbortSignal;
    const parentSignal = signal;
    const budget = integer(o.budgetMs ?? 25000, 120000);
    if (aborted.call(parentSignal)) return fail();
    const deadline = performance.now() + budget;
    const check = () => {
      if (
        aborted.call(parentSignal) || controller.signal.aborted ||
        performance.now() >= deadline
      ) return fail();
    };
    const stopped = new Promise<never>((_, reject) => {
      onAbort = () => {
        controller.abort();
        reject(new Error("Raster final read cancelled"));
      };
      EventTarget.prototype.addEventListener.call(
        parentSignal,
        "abort",
        onAbort,
        { once: true },
      );
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("Raster final read deadline"));
      }, budget);
    });
    return await Promise.race([
      Promise.resolve().then(async () => {
        for (const before of origin.reads) {
          check();
          const page = before.page;
          const raw = await rasterRPC(
            "ecos_read_owner_page_raster",
            Object.freeze({
              p_owner_id: inventory.owner_id,
              p_project_id: inventory.project_id,
              p_execution_id: page.execution_id,
              p_binding_id: page.binding_id,
              p_page_number: page.page_number,
              p_expected_page_attempt_id: page.head!.attempt_id,
              p_expected_page_sha256: page.head!.page_sha256,
              p_expected_upload_attempt_id: before.current_upload_attempt_id,
            }),
            controller.signal,
          );
          check();
          const after = await bindECOSOwnerPageRasterRead(
            raw,
            inventory,
            indexes,
            page,
            before.current_upload_attempt_id,
          );
          check();
          if (
            after.state !== before.state ||
            after.current_upload_attempt_id !==
              before.current_upload_attempt_id ||
            after.receipt_json !== before.receipt_json ||
            after.receipt_sha256 !== before.receipt_sha256
          ) return fail();
        }
        check();
        const remaining = Math.floor(deadline - performance.now());
        if (remaining < 1) return fail();
        const final = await loadECOSLinkedOwnerProjectDocumentIndexes(
          inventory,
          indexRPC,
          {
            signal: controller.signal,
            budgetMs: remaining,
            expectedIndexEpoch: indexes.index_epoch_sha256,
          },
        );
        check();
        if (JSON.stringify(final.resolved) !== JSON.stringify(indexes)) {
          return fail();
        }
        return Object.freeze({
          freshness:
            "raster_heads_and_complete_owner_index_rechecked_after_model" as const,
          inventory_epoch_sha256: inventory.epoch_sha256,
          index_epoch_sha256: indexes.index_epoch_sha256,
          raster_heads_checked: origin.reads.length,
          atomic_project_snapshot: false as const,
          semantic_verified: false as const,
          retrieval_authorized: false as const,
        });
      }),
      stopped,
    ]);
  } catch {
    return fail();
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (signal && onAbort) {
      EventTarget.prototype.removeEventListener.call(signal, "abort", onAbort);
    }
    controller.abort();
  }
}
