import type { ECOSLinkedOwnerProjectDocumentInventory } from './ecos-linked-owner-project-document-inventory.ts';
import {
  assertECOSLinkedOwnerProjectDocumentIndexes,
  type ECOSLinkedOwnerProjectDocumentIndexes,
} from './ecos-linked-owner-project-document-indexes.ts';
import {
  assertECOSOwnerIndexedPageObservations,
  type ECOSOwnerIndexedPageObservations,
} from './ecos-owner-indexed-page-observations-loader.ts';
import {
  assertECOSOwnerIndexedPageObservationsRead,
  type ECOSOwnerIndexedPageSelection,
  type ECOSOwnerPageHead,
} from './ecos-owner-page-observations.ts';
import {
  type ECOSOriginalNativeObservations,
  type ECOSOriginalTableObservations,
  parseECOSOriginalNativeObservations,
  parseECOSOriginalTableObservations,
} from './ecos-original-page-observations.ts';
import {
  type ECOSVisualPage,
  parseECOSPageVisualObservations,
} from './ecos-page-visual-observations.ts';

type LaneState = 'partial' | 'unreadable' | 'failed' | 'not_attempted';
export interface ECOSOwnerObservationLane<T> {
  readonly state: LaneState;
  readonly payload_sha256: string | null;
  readonly payload_bytes: number;
  readonly limitation_codes: readonly string[];
  readonly observations: Readonly<T> | null;
}
export interface ECOSOwnerObservationPage {
  readonly source_id: string;
  readonly source_sha256: string;
  readonly source_revision: string | null;
  readonly source_page_count: number;
  readonly page_number: number;
  readonly execution_id: string;
  readonly binding_id: string;
  readonly extraction_version: 'ecos-owner-native-preview/2.0';
  readonly head: ECOSOwnerPageHead;
  readonly modalities: Readonly<{
    native: ECOSOwnerObservationLane<ECOSOriginalNativeObservations>;
    table: ECOSOwnerObservationLane<ECOSOriginalTableObservations>;
    visual: ECOSOwnerObservationLane<ECOSVisualPage>;
  }>;
  readonly image_available: false;
  readonly semantic_verified: false;
}
export interface ECOSOwnerObservationBundle {
  readonly schema_version: 'ecos-owner-observation-bundle/2.1';
  readonly publication_mode: 'shadow';
  readonly inventory: ECOSLinkedOwnerProjectDocumentInventory;
  readonly indexes: ECOSLinkedOwnerProjectDocumentIndexes;
  readonly selections: readonly Readonly<ECOSOwnerIndexedPageSelection>[];
  readonly pages: readonly Readonly<ECOSOwnerObservationPage>[];
  readonly coverage: Readonly<{
    scope: 'complete_supplied_owner_index_not_whole_project_library';
    selected_page_count: number;
    sources: readonly Readonly<{
      source_id: string;
      resolution_state: string;
      expected_page_count: number | null;
      selected_page_numbers: readonly number[];
      unloaded_checkpoint_page_numbers: readonly number[];
      missing_checkpoint_page_numbers: readonly number[];
    }>[];
  }>;
  readonly freshness:
    'selected_loader_index_recheck_then_local_projection_only';
  readonly atomic_project_snapshot: false;
  readonly coordinate_relationship:
    'native_table_unrotated_pdf_points_visual_rotated_pixels_not_associated';
  readonly geometry_validation:
    'projected_content_and_geometry_consistency_only';
  readonly question_relevance: 'not_assessed';
  readonly answer_readiness: 'not_assessed';
  readonly whole_project_completeness: 'not_assessed';
  readonly raster_bytes_verified: false;
  readonly image_available: false;
  readonly retrieval_authorized: false;
  readonly semantic_verified: false;
}
export interface ECOSOwnerObservationBundleOptions {
  signal?: AbortSignal;
  budgetMs?: number;
  /** May only LOWER the hard 64MiB serialized retained-output ceiling. */
  maxRetainedBytes?: number;
}
const MAX_BYTES = 64 * 1024 * 1024;
const encoder = new TextEncoder();
const origins = new WeakMap<
  object,
  {
    inventory: ECOSLinkedOwnerProjectDocumentInventory;
    indexes: ECOSLinkedOwnerProjectDocumentIndexes;
    // Identity binding must not secretly retain a second raw JSON aggregate.
    selected: WeakRef<ECOSOwnerIndexedPageObservations>;
  }
>();
const invalid = () =>
  new Error(
    'Owner observation bundle unavailable, invalid, cancelled or over bounds',
  );
const abortedGetter = Object.getOwnPropertyDescriptor(
  AbortSignal.prototype,
  'aborted',
)!.get!;
function options(raw: ECOSOwnerObservationBundleOptions) {
  if (
    !raw || typeof raw !== 'object' ||
    Object.getPrototypeOf(raw) !== Object.prototype
  ) throw invalid();
  const keys = Reflect.ownKeys(raw), d = Object.getOwnPropertyDescriptors(raw);
  if (
    keys.some((k) =>
      typeof k !== 'string' ||
      !['signal', 'budgetMs', 'maxRetainedBytes'].includes(k)
    ) ||
    Object.values(d).some((v) => !v.enumerable || !Object.hasOwn(v, 'value'))
  ) throw invalid();
  const signal = d.signal?.value as AbortSignal | undefined,
    budgetMs = d.budgetMs?.value ?? 30000,
    maxRetainedBytes = d.maxRetainedBytes?.value ?? MAX_BYTES;
  if (!Number.isSafeInteger(budgetMs) || budgetMs < 1 || budgetMs > 30000) {
    throw invalid();
  }
  if (signal !== undefined) abortedGetter.call(signal);
  if (
    !Number.isSafeInteger(maxRetainedBytes) || maxRetainedBytes < 1 ||
    maxRetainedBytes > MAX_BYTES
  ) throw invalid();
  return { signal, budgetMs, maxRetainedBytes };
}
function size(value: unknown) {
  return encoder.encode(JSON.stringify(value)).length;
}

/** Local projection of genuinely bound selected readbacks. No network calls,
 * currentness refresh, image download, inferred layout semantics or answer claim.
 * Missing/unloaded pages remain visible in the complete supplied index. A bad
 * nonnull lane rejects the WHOLE bundle; no malformed lane is silently omitted.
 * The 64MiB bound covers serialized retained output, not temporary memory/RSS.
 * Synchronous parsers are checked after return; cancellation cannot preempt JS.
 */
export async function buildECOSOwnerObservationBundle(
  inventory: ECOSLinkedOwnerProjectDocumentInventory,
  indexes: ECOSLinkedOwnerProjectDocumentIndexes,
  selected: ECOSOwnerIndexedPageObservations,
  suppliedOptions: ECOSOwnerObservationBundleOptions = {},
): Promise<Readonly<ECOSOwnerObservationBundle>> {
  let timer: ReturnType<typeof setTimeout> | undefined,
    onAbort: (() => void) | undefined;
  let signal: AbortSignal | undefined;
  try {
    const o = options(suppliedOptions);
    signal = o.signal;
    const deadline = performance.now() + o.budgetMs;
    const check = () => {
      if (
        signal && abortedGetter.call(signal) || performance.now() >= deadline
      ) throw invalid();
    };
    check();
    assertECOSLinkedOwnerProjectDocumentIndexes(indexes, inventory);
    assertECOSOwnerIndexedPageObservations(selected, inventory, indexes);
    if (
      selected.pages.length < 1 || selected.pages.length > 8 ||
      selected.pages.length !== selected.selections.length
    ) throw invalid();
    const selectionKeys = new Set(
      selected.selections.map((s) =>
        JSON.stringify([s.sourceId, s.pageNumber])
      ),
    );
    if (selectionKeys.size !== selected.selections.length) throw invalid();
    const seen = new Set<string>();
    for (const read of selected.pages) {
      assertECOSOwnerIndexedPageObservationsRead(read, inventory, indexes);
      const key = JSON.stringify([read.source_id, read.page_number]);
      if (
        seen.has(key) || !selectionKeys.has(key) || read.state !== 'current' ||
        !read.head || !read.modalities
      ) throw invalid();
      seen.add(key);
    }
    const coverage = Object.freeze({
      scope: 'complete_supplied_owner_index_not_whole_project_library' as const,
      selected_page_count: selected.pages.length,
      sources: Object.freeze(indexes.sources.map((s) =>
        Object.freeze({
          source_id: s.source.source_id,
          resolution_state: s.resolution.resolution_state,
          expected_page_count: s.coverage.expected_page_count,
          selected_page_numbers: Object.freeze(
            s.pages.filter((p) =>
              selectionKeys.has(
                JSON.stringify([s.source.source_id, p.page_number]),
              )
            ).map((p) => p.page_number),
          ),
          unloaded_checkpoint_page_numbers: Object.freeze(
            s.pages.filter((p) =>
              p.head &&
              !selectionKeys.has(
                JSON.stringify([s.source.source_id, p.page_number]),
              )
            ).map((p) => p.page_number),
          ),
          missing_checkpoint_page_numbers: Object.freeze(
            s.pages.filter((p) => !p.head).map((p) => p.page_number),
          ),
        })
      )),
    });
    const base = {
      schema_version: 'ecos-owner-observation-bundle/2.1' as const,
      publication_mode: 'shadow' as const,
      inventory,
      indexes,
      selections: selected.selections,
      coverage,
      freshness:
        'selected_loader_index_recheck_then_local_projection_only' as const,
      atomic_project_snapshot: false as const,
      coordinate_relationship:
        'native_table_unrotated_pdf_points_visual_rotated_pixels_not_associated' as const,
      geometry_validation:
        'projected_content_and_geometry_consistency_only' as const,
      question_relevance: 'not_assessed' as const,
      answer_readiness: 'not_assessed' as const,
      whole_project_completeness: 'not_assessed' as const,
      raster_bytes_verified: false as const,
      image_available: false as const,
      retrieval_authorized: false as const,
      semantic_verified: false as const,
    };
    let retained = size({ ...base, pages: [] });
    if (retained > o.maxRetainedBytes) throw invalid();
    check();
    const stop = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(invalid());
      if (signal) {
        EventTarget.prototype.addEventListener.call(signal, 'abort', onAbort, {
          once: true,
        });
      }
      timer = setTimeout(onAbort, Math.max(1, deadline - performance.now()));
    });
    const bounded = async <T>(run: () => T | Promise<T>): Promise<T> => {
      check();
      const value = await Promise.race([
        Promise.resolve().then(() => {
          check();
          return run();
        }),
        stop,
      ]);
      check();
      return value;
    };
    const pages: Readonly<ECOSOwnerObservationPage>[] = [];
    for (const read of selected.pages) {
      check();
      const e = {
        sourceSha256: read.source_sha256,
        sourcePageCount: read.source_page_count,
        pageNumber: read.page_number,
      };
      const head = read.head!, raw = read.modalities!;
      const lane = async <T>(
        name: 'native' | 'table' | 'visual',
        parse: () => T | Promise<T>,
      ): Promise<Readonly<ECOSOwnerObservationLane<T>>> => {
        const m = raw[name], summary = head.modalities[name];
        let observations: T | null = null;
        if (m.observations !== null) observations = await bounded(parse);
        else if (
          !['failed', 'not_attempted'].includes(m.state) ||
          m.payload_json !== null || summary.payload_sha256 !== null
        ) throw invalid();
        return Object.freeze({
          state: m.state,
          payload_sha256: summary.payload_sha256,
          payload_bytes: summary.payload_bytes,
          limitation_codes: m.limitation_codes,
          observations,
        });
      };
      const native = await lane(
        'native',
        () => parseECOSOriginalNativeObservations(raw.native.observations, e),
      );
      const table = await lane(
        'table',
        () => parseECOSOriginalTableObservations(raw.table.observations, e),
      );
      const visual = await lane('visual', () => {
        // This hash was bound to exact checkpoint payload bytes, NOT independently
        // fetched raster bytes. The visual parser and bundle keep that false flag.
        const observation = raw.visual.observations as {
          raster: { sha256: string };
        };
        return parseECOSPageVisualObservations(observation, {
          ...e,
          rasterSha256: observation.raster.sha256,
        });
      });
      const page: Readonly<ECOSOwnerObservationPage> = Object.freeze({
        source_id: read.source_id,
        source_sha256: read.source_sha256,
        source_revision: read.source_revision,
        source_page_count: read.source_page_count,
        page_number: read.page_number,
        execution_id: read.execution_id,
        binding_id: read.binding_id,
        extraction_version: read.extraction_version,
        head,
        modalities: Object.freeze({ native, table, visual }),
        image_available: false,
        semantic_verified: false,
      });
      retained += size(page) + (pages.length ? 1 : 0);
      if (retained > o.maxRetainedBytes) throw invalid();
      pages.push(page);
      check();
    }
    const result: Readonly<ECOSOwnerObservationBundle> = Object.freeze({
      ...base,
      pages: Object.freeze(pages),
    });
    check();
    origins.set(result, {
      inventory,
      indexes,
      selected: new WeakRef(selected),
    });
    return result;
  } catch {
    throw invalid();
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (signal && onAbort) {
      EventTarget.prototype.removeEventListener.call(signal, 'abort', onAbort);
    }
  }
}

export function assertECOSOwnerObservationBundle(
  value: unknown,
  inventory: ECOSLinkedOwnerProjectDocumentInventory,
  indexes: ECOSLinkedOwnerProjectDocumentIndexes,
  selected: ECOSOwnerIndexedPageObservations,
): asserts value is Readonly<ECOSOwnerObservationBundle> {
  assertECOSOwnerIndexedPageObservations(selected, inventory, indexes);
  const origin = value && typeof value === 'object' ? origins.get(value) : null;
  if (
    !origin || origin.inventory !== inventory || origin.indexes !== indexes ||
    origin.selected.deref() !== selected
  ) throw invalid();
}
