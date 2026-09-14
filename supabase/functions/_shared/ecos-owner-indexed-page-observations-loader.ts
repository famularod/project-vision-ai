import type { ECOSLinkedOwnerProjectDocumentInventory } from './ecos-linked-owner-project-document-inventory.ts';
import {
  assertECOSLinkedOwnerProjectDocumentIndexes,
  type ECOSLinkedOwnerProjectDocumentIndexes,
} from './ecos-linked-owner-project-document-indexes.ts';
import { loadECOSLinkedOwnerProjectDocumentIndexes } from './ecos-linked-owner-project-document-indexes-loader.ts';
import {
  assertECOSOwnerIndexedPageObservationsRead,
  bindECOSOwnerIndexedPageObservationsRead,
  type ECOSOwnerIndexedPageObservationsRead,
  type ECOSOwnerIndexedPageSelection,
} from './ecos-owner-page-observations.ts';
import { compareSourceIds } from './ecos-project-document-inventory.ts';

export type ECOSOwnerIndexedPageRPC = (
  name:
    | 'ecos_read_owner_page_observations'
    | 'ecos_resolve_linked_owner_project_document_indexes',
  parameters: Readonly<Record<string, string | number | null>>,
  signal: AbortSignal,
) => Promise<unknown>;
export interface ECOSOwnerIndexedPageLoaderOptions {
  signal?: AbortSignal;
  budgetMs?: number;
  rpcTimeoutMs?: number;
}
export interface ECOSOwnerIndexedPageObservations {
  readonly inventory: ECOSLinkedOwnerProjectDocumentInventory;
  readonly indexes: ECOSLinkedOwnerProjectDocumentIndexes;
  readonly selections: readonly Readonly<ECOSOwnerIndexedPageSelection>[];
  readonly pages: readonly Readonly<ECOSOwnerIndexedPageObservationsRead>[];
  readonly freshness: 'complete_owner_index_rechecked_after_selected_raw_reads';
  readonly atomic_project_snapshot: false;
  readonly geometry_validation: 'not_performed';
  readonly semantic_verified: false;
  readonly image_available: false;
  readonly retrieval_authorized: false;
}
const brands = new WeakMap<
  object,
  {
    inventory: ECOSLinkedOwnerProjectDocumentInventory;
    indexes: ECOSLinkedOwnerProjectDocumentIndexes;
  }
>();
const fail = (): never => {
  throw new Error(
    'Selected owner page observations unavailable, changed, cancelled or over bounds',
  );
};
function object(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
) {
  if (
    !value || typeof value !== 'object' ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) return fail();
  const d = Object.getOwnPropertyDescriptors(value),
    keys = Reflect.ownKeys(value);
  if (
    required.some((k) => !Object.hasOwn(d, k)) ||
    keys.some((k) =>
      typeof k !== 'string' || ![...required, ...optional].includes(k)
    ) ||
    Object.values(d).some((v) => !v.enumerable || !Object.hasOwn(v, 'value'))
  ) return fail();
  return Object.fromEntries(
    Object.entries(d).map(([k, v]) => [k, v.value]),
  ) as Record<string, unknown>;
}
function integer(value: unknown, min: number, max: number): number {
  if (
    typeof value !== 'number' || !Number.isSafeInteger(value) || value < min ||
    value > max
  ) return fail();
  return value;
}
/** Exact selected raw reads, then COMPLETE index freshness; no new execution
 * mutation request, claim, control RPC, fallback or semantic projection. The
 * 64MiB retained bound covers selected raw results, not total process RSS. */
export async function loadECOSOwnerIndexedPageObservations(
  inventory: ECOSLinkedOwnerProjectDocumentInventory,
  indexes: ECOSLinkedOwnerProjectDocumentIndexes,
  supplied: readonly ECOSOwnerIndexedPageSelection[],
  rpc: ECOSOwnerIndexedPageRPC,
  options: ECOSOwnerIndexedPageLoaderOptions = {},
): Promise<Readonly<ECOSOwnerIndexedPageObservations>> {
  try {
    assertECOSLinkedOwnerProjectDocumentIndexes(indexes, inventory);
    if (
      typeof rpc !== 'function' || !Array.isArray(supplied) ||
      Object.getPrototypeOf(supplied) !== Array.prototype ||
      supplied.length < 1 || supplied.length > 8 ||
      Reflect.ownKeys(supplied).length !== supplied.length + 1
    ) return fail();
    const d = Object.getOwnPropertyDescriptors(supplied),
      seen = new Set<string>();
    const selections = Object.freeze(
      Array.from({ length: supplied.length }, (_, i) => {
        const prop = d[String(i)];
        if (!prop?.enumerable || !Object.hasOwn(prop, 'value')) return fail();
        const s = object(prop.value, ['sourceId', 'pageNumber']);
        if (typeof s.sourceId !== 'string') return fail();
        const source = indexes.sources.find((v) =>
            v.source.source_id === s.sourceId
          ),
          execution = source?.resolution.execution;
        if (
          !source || !execution ||
          !['execution_current', 'execution_in_progress'].includes(
            source.resolution.resolution_state,
          )
        ) return fail();
        const pageNumber = integer(
          s.pageNumber,
          1,
          execution.source_page_count,
        );
        if (
          !source.pages.find((p) => p.page_number === pageNumber)?.head
        ) return fail();
        const key = JSON.stringify([s.sourceId, pageNumber]);
        if (seen.has(key)) return fail();
        seen.add(key);
        return Object.freeze({ sourceId: s.sourceId, pageNumber });
      }).sort((a, b) =>
        compareSourceIds(a.sourceId, b.sourceId) || a.pageNumber - b.pageNumber
      ),
    );
    const o = object(options, [], ['signal', 'budgetMs', 'rpcTimeoutMs']);
    const signal = o.signal as AbortSignal | undefined,
      budget = integer(o.budgetMs ?? 120000, 1, 120000),
      callBudget = integer(o.rpcTimeoutMs ?? 25000, 1, 25000);
    if (signal !== undefined && !(signal instanceof AbortSignal)) return fail();
    const deadline = performance.now() + budget;
    const check = () => {
      if (signal?.aborted || performance.now() >= deadline) return fail();
    };
    const read = async (selection: Readonly<ECOSOwnerIndexedPageSelection>) => {
      check();
      const source = indexes.sources.find((v) =>
          v.source.source_id === selection.sourceId
        )!,
        execution = source.resolution.execution!;
      const head = source.pages.find((p) =>
        p.page_number === selection.pageNumber
      )!.head!;
      const controller = new AbortController(),
        end = Math.min(deadline, performance.now() + callBudget);
      const checkCall = () => {
        check();
        if (controller.signal.aborted || performance.now() >= end) {
          return fail();
        }
      };
      let timer: ReturnType<typeof setTimeout> | undefined,
        abort: (() => void) | undefined;
      const stop = new Promise<never>((_resolve, reject) => {
        abort = () => {
          controller.abort();
          reject(new Error('Selected owner page read cancelled'));
        };
        signal?.addEventListener('abort', abort, { once: true });
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('Selected owner page deadline'));
        }, Math.max(1, end - performance.now()));
      });
      try {
        const result = await Promise.race([
          Promise.resolve().then(async () => {
            checkCall();
            const raw = await rpc(
              'ecos_read_owner_page_observations',
              Object.freeze({
                p_owner_id: inventory.owner_id,
                p_project_id: inventory.project_id,
                p_execution_id: execution.execution_id,
                p_binding_id: execution.binding_id,
                p_page_number: selection.pageNumber,
                p_expected_attempt_id: head.attempt_id,
              }),
              controller.signal,
            );
            checkCall();
            const result = await bindECOSOwnerIndexedPageObservationsRead(
              raw,
              inventory,
              indexes,
              selection,
            );
            checkCall();
            return result;
          }),
          stop,
        ]);
        checkCall();
        return result;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        if (abort) signal?.removeEventListener('abort', abort);
        controller.abort();
      }
    };
    const pages: Readonly<ECOSOwnerIndexedPageObservationsRead>[] = [];
    let bytes = 0;
    for (const selection of selections) {
      const page = await read(selection);
      check();
      bytes += new TextEncoder().encode(JSON.stringify(page)).length;
      if (bytes > 64 * 1024 * 1024) return fail();
      pages.push(page);
    }
    check();
    const remaining = Math.floor(deadline - performance.now());
    if (remaining < 1) return fail();
    const final = await loadECOSLinkedOwnerProjectDocumentIndexes(
      inventory,
      rpc,
      {
        signal,
        budgetMs: Math.min(remaining, 120000),
        rpcTimeoutMs: callBudget,
        expectedIndexEpoch: indexes.index_epoch_sha256,
      },
    );
    check();
    if (JSON.stringify(final.resolved) !== JSON.stringify(indexes)) {
      return fail();
    }
    const result: ECOSOwnerIndexedPageObservations = Object.freeze({
      inventory,
      indexes,
      selections,
      pages: Object.freeze(pages),
      freshness: 'complete_owner_index_rechecked_after_selected_raw_reads',
      atomic_project_snapshot: false,
      geometry_validation: 'not_performed',
      semantic_verified: false,
      image_available: false,
      retrieval_authorized: false,
    });
    brands.set(result, { inventory, indexes });
    return result;
  } catch {
    return fail();
  }
}
export function assertECOSOwnerIndexedPageObservations(
  value: unknown,
  inventory: ECOSLinkedOwnerProjectDocumentInventory,
  indexes: ECOSLinkedOwnerProjectDocumentIndexes,
): asserts value is Readonly<ECOSOwnerIndexedPageObservations> {
  assertECOSLinkedOwnerProjectDocumentIndexes(indexes, inventory);
  const origin = value && typeof value === 'object' ? brands.get(value) : null;
  if (!origin || origin.inventory !== inventory || origin.indexes !== indexes) {
    return fail();
  }
  for (const page of (value as ECOSOwnerIndexedPageObservations).pages) {
    assertECOSOwnerIndexedPageObservationsRead(page, inventory, indexes);
  }
}
