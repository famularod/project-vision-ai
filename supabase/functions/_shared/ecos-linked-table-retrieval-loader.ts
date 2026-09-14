import {
  assertECOSLinkedProjectDocumentInventory,
  type ECOSLinkedProjectDocumentInventory,
} from './ecos-linked-project-document-inventory.ts';
import {
  assertECOSLinkedProjectDocumentIndexes,
  type ECOSLinkedProjectDocumentIndexes,
} from './ecos-linked-project-document-indexes.ts';
import { loadECOSLinkedProjectDocumentIndexes } from './ecos-linked-project-document-indexes-loader.ts';
import { projectECOSManifestTableRecords } from './ecos-table-source-manifest.ts';
import {
  buildECOSTableRetrievalBundle,
  type ECOSTableRetrievalSource,
} from './ecos-table-retrieval-bundle.ts';

export interface ECOSLinkedTableSelection {
  sourceId: string;
  pageNumbers: readonly number[];
}
/** Internal service transport. This protocol accepts no worker credential and
 * cannot freeze a snapshot, create a session, or grant customer authority. */
export type ECOSLinkedTableSourceRPC = (
  name:
    | 'ecos_load_linked_manifest_table_source'
    | 'ecos_resolve_linked_project_document_indexes',
  parameters: Readonly<Record<string, string | number | null>>,
  signal: AbortSignal,
) => Promise<unknown>;

function dataArray(value: unknown, maximum: number): unknown[] {
  if (
    !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > maximum || Reflect.ownKeys(value).length !== value.length + 1
  ) throw new Error('Invalid bounded table selection');
  return Array.from({ length: value.length }, (_, index) => {
    const p = Object.getOwnPropertyDescriptor(value, String(index));
    if (!p?.enumerable || !Object.hasOwn(p, 'value')) {
      throw new Error('Table selections must contain plain data');
    }
    return p.value;
  });
}
function dataSelection(value: unknown) {
  if (
    !value || typeof value !== 'object' || Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) throw new Error('Invalid table selection');
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== 2 ||
    keys.some((k) => k !== 'sourceId' && k !== 'pageNumbers')
  ) throw new Error('Table selection contains unsupported fields');
  const source = Object.getOwnPropertyDescriptor(value, 'sourceId');
  const pages = Object.getOwnPropertyDescriptor(value, 'pageNumbers');
  if (
    !source?.enumerable || !Object.hasOwn(source, 'value') ||
    !pages?.enumerable || !Object.hasOwn(pages, 'value')
  ) throw new Error('Table selections must contain plain data');
  return {
    sourceId: source.value as unknown,
    pageNumbers: pages.value as unknown,
  };
}

/** Read exact selected pages from already resolved current sources after the
 * worker lease ends. Every source in the supplied complete inventory remains
 * represented in `indexes`, including unselected gaps. Selected missing sources
 * reject instead of silently shrinking the requested scope. Pending pages stay
 * in the manifest as explicit gaps, never as invented empty stored payloads.
 *
 * Each page RPC revalidates source membership, job and the full frozen manifest.
 * A final two-pass full index read catches changes to unselected/later sources.
 * This is sequential observation, not an atomic project snapshot, a customer
 * endpoint, automatic page selection, semantic verification or an answer. */
export async function loadECOSLinkedTableRetrievalBundle(
  inventory: Readonly<ECOSLinkedProjectDocumentInventory>,
  indexes: Readonly<ECOSLinkedProjectDocumentIndexes>,
  selections: readonly ECOSLinkedTableSelection[],
  rpc: ECOSLinkedTableSourceRPC,
  options: {
    signal?: AbortSignal;
    budgetMs?: number;
    rpcTimeoutMs?: number;
    pageLimit?: number;
  } = {},
) {
  assertECOSLinkedProjectDocumentInventory(inventory);
  assertECOSLinkedProjectDocumentIndexes(indexes, inventory);
  const budgetMs = options.budgetMs ?? 120_000;
  const rpcTimeoutMs = options.rpcTimeoutMs ?? 25_000;
  const pageLimit = options.pageLimit ?? 25;
  const signal = options.signal;
  if (
    typeof rpc !== 'function' || !Number.isSafeInteger(budgetMs) ||
    budgetMs < 1 ||
    budgetMs > 120_000 || !Number.isSafeInteger(rpcTimeoutMs) ||
    rpcTimeoutMs < 1 || rpcTimeoutMs > 25_000 ||
    !Number.isSafeInteger(pageLimit) || pageLimit < 1 || pageLimit > 25 ||
    (signal !== undefined && !(signal instanceof AbortSignal))
  ) throw new Error('Invalid linked table retrieval bounds');
  const deadline = performance.now() + budgetMs;
  const seen = new Set<string>();
  let selectedPageCount = 0;
  // Snapshot every requested source/page synchronously before any network wait.
  const selected = dataArray(selections, 16).map((value) => {
    const input = dataSelection(value);
    if (typeof input.sourceId !== 'string' || seen.has(input.sourceId)) {
      throw new Error('Duplicate or invalid selected table source');
    }
    seen.add(input.sourceId);
    const index = inventory.rows.findIndex((row) =>
      row.source_id === input.sourceId
    );
    const resolved = indexes.resolutions[index];
    if (
      !resolved || resolved.source_id !== input.sourceId ||
      resolved.state !== 'manifest_current' || !resolved.manifest ||
      !resolved.linked_manifest || !resolved.job
    ) throw new Error('Selected source has no current bound table manifest');
    const manifest = resolved.manifest;
    const pages = dataArray(input.pageNumbers, 32).map((page) => {
      if (
        typeof page !== 'number' || !Number.isSafeInteger(page) || page < 1 ||
        page > manifest.accountability.expectedItemCount
      ) throw new Error('Selected page is outside its exact source inventory');
      return page;
    }).sort((a, b) => a - b);
    selectedPageCount += pages.length;
    if (new Set(pages).size !== pages.length || selectedPageCount > 32) {
      throw new Error(
        'Duplicate selected page or aggregate page budget exceeded',
      );
    }
    return Object.freeze({
      sourceId: input.sourceId,
      afterSourceId: index === 0 ? null : inventory.rows[index - 1].source_id,
      manifest,
      pages: Object.freeze(pages),
    });
  });
  if (selected.length === 0) {
    throw new Error('At least one table source is required');
  }
  const check = () => {
    if (signal?.aborted) throw new Error('Linked table retrieval cancelled');
    if (performance.now() >= deadline) {
      throw new Error('Linked table retrieval deadline exceeded');
    }
  };
  async function pageRead(source: typeof selected[number], number: number) {
    check();
    const pin = source.manifest.items[number - 1];
    if (pin.projectionId === null || pin.projectionSha256 === null) return null;
    const controller = new AbortController();
    const callDeadline = Math.min(deadline, performance.now() + rpcTimeoutMs);
    const checkCall = () => {
      check();
      if (controller.signal.aborted || performance.now() >= callDeadline) {
        throw new Error('Linked table retrieval call deadline exceeded');
      }
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    const stop = new Promise<never>((_resolve, reject) => {
      abort = () => {
        controller.abort();
        reject(new Error('Linked table retrieval cancelled'));
      };
      signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('Linked table retrieval deadline exceeded'));
      }, Math.max(1, callDeadline - performance.now()));
    });
    try {
      const page = await Promise.race([
        Promise.resolve().then(async () => {
          checkCall();
          const raw = await rpc(
            'ecos_load_linked_manifest_table_source',
            Object.freeze({
              p_organization_id: inventory.organization_id,
              p_project_id: inventory.project_id,
              p_owner_id: inventory.owner_id,
              p_expected_epoch: inventory.epoch_sha256,
              p_after_source_id: source.afterSourceId,
              p_source_id: source.sourceId,
              p_job_id: source.manifest.jobId,
              p_manifest_id: source.manifest.manifestId,
              p_manifest_sha256: source.manifest.manifestSha256,
              p_page_number: number,
              p_expected_projection_id: pin.projectionId,
              p_expected_projection_sha256: pin.projectionSha256,
            }),
            controller.signal,
          );
          checkCall();
          const bound = await projectECOSManifestTableRecords(
            raw,
            source.manifest,
            number,
          );
          checkCall();
          return bound;
        }),
        stop,
      ]);
      checkCall();
      return page;
    } catch {
      throw new Error(
        signal?.aborted
          ? 'Linked table retrieval cancelled'
          : 'Linked table retrieval unavailable or changed',
      );
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (abort) signal?.removeEventListener('abort', abort);
      controller.abort();
    }
  }
  const sources: ECOSTableRetrievalSource[] = [];
  const encoder = new TextEncoder();
  let bytes = 4096, records = 0;
  const retain = (value: unknown) => {
    bytes += encoder.encode(JSON.stringify(value)).length + 1;
    if (bytes > 8 * 1024 * 1024) {
      throw new Error(
        'Linked table retrieval exceeds retained evidence budget',
      );
    }
  };
  for (const source of selected) {
    check();
    retain(source.manifest);
    const pages = [];
    for (const number of source.pages) {
      const page = await pageRead(source, number);
      if (!page) continue;
      records += page.projection.records.length;
      if (records > 2000) {
        throw new Error(
          'Linked table retrieval exceeds proposed record budget',
        );
      }
      retain(page);
      pages.push(page);
    }
    sources.push({ manifest: source.manifest, pages });
  }
  check();
  const remaining = Math.floor(deadline - performance.now());
  if (remaining < 1) {
    throw new Error('Linked table retrieval deadline exceeded');
  }
  const fresh = await loadECOSLinkedProjectDocumentIndexes(inventory, rpc, {
    signal,
    budgetMs: remaining,
    rpcTimeoutMs,
    pageLimit,
  });
  check();
  if (JSON.stringify(fresh.resolved) !== JSON.stringify(indexes)) {
    throw new Error(
      'Document extraction changed during final retrieval observation',
    );
  }
  const bundle = buildECOSTableRetrievalBundle({
    organizationId: inventory.organization_id,
    projectId: inventory.project_id,
    sources,
  });
  check();
  return Object.freeze({
    inventory,
    indexes,
    bundle,
    retrieval_authorized: false as const,
    answer_readiness: 'not_assessed' as const,
    freshness:
      'selected_pages_then_all_resolution_pages_rechecked_sequentially' as const,
    atomic_project_snapshot: false as const,
  });
}
