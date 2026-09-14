import {
  assertECOSLinkedProjectDocumentInventory,
  type ECOSLinkedProjectDocumentInventory,
} from './ecos-linked-project-document-inventory.ts';
import {
  assembleECOSLinkedProjectDocumentIndexes,
  bindECOSLinkedProjectDocumentIndexesPage,
} from './ecos-linked-project-document-indexes.ts';

/** Internal service transport, not a customer endpoint. No worker claim or
 * lease is requested, supplied or returned by this read-only resolver. */
export type ECOSLinkedProjectDocumentIndexesRPC = (
  name: 'ecos_resolve_linked_project_document_indexes',
  parameters: Readonly<Record<string, string | number | null>>,
  signal: AbortSignal,
) => Promise<unknown>;

/** Resolve every inventoried document, including explicit gaps. Recheck every
 * resolution page before returning; rereading only the first inventory page
 * would miss changes to another document's job or extraction heads.
 *
 * These are sequential observations under one source-inventory epoch, not an
 * atomic project-wide job snapshot. Subsequent page retrieval still needs exact
 * current job, manifest and source checks. This grants no answer authority. */
export async function loadECOSLinkedProjectDocumentIndexes(
  inventory: Readonly<ECOSLinkedProjectDocumentInventory>,
  rpc: ECOSLinkedProjectDocumentIndexesRPC,
  options: {
    signal?: AbortSignal;
    pageLimit?: number;
    budgetMs?: number;
    rpcTimeoutMs?: number;
  } = {},
) {
  assertECOSLinkedProjectDocumentInventory(inventory);
  const pageLimit = options.pageLimit ?? 25;
  const budgetMs = options.budgetMs ?? 120_000;
  const rpcTimeoutMs = options.rpcTimeoutMs ?? 25_000;
  const signal = options.signal;
  if (
    typeof rpc !== 'function' || !Number.isSafeInteger(pageLimit) ||
    pageLimit < 1 || pageLimit > 25 || !Number.isSafeInteger(budgetMs) ||
    budgetMs < 1 || budgetMs > 120_000 || !Number.isSafeInteger(rpcTimeoutMs) ||
    rpcTimeoutMs < 1 || rpcTimeoutMs > 25_000 ||
    (signal !== undefined && !(signal instanceof AbortSignal))
  ) throw new Error('Invalid document index resolution transport bounds');
  const deadline = performance.now() + budgetMs;
  const check = () => {
    if (signal?.aborted) throw new Error('Document index resolution cancelled');
    if (performance.now() >= deadline) {
      throw new Error('Document index resolution deadline exceeded');
    }
  };
  async function call(after: string | null) {
    check();
    const controller = new AbortController();
    const callDeadline = Math.min(deadline, performance.now() + rpcTimeoutMs);
    const checkCall = () => {
      check();
      if (controller.signal.aborted || performance.now() >= callDeadline) {
        throw new Error('Document index resolution call deadline exceeded');
      }
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    const stop = new Promise<never>((_resolve, reject) => {
      abort = () => {
        controller.abort();
        reject(new Error('Document index resolution cancelled'));
      };
      signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('Document index resolution deadline exceeded'));
      }, Math.max(1, callDeadline - performance.now()));
    });
    try {
      const page = await Promise.race([
        Promise.resolve().then(async () => {
          checkCall();
          const raw = await rpc(
            'ecos_resolve_linked_project_document_indexes',
            Object.freeze({
              p_organization_id: inventory.organization_id,
              p_project_id: inventory.project_id,
              p_owner_id: inventory.owner_id,
              p_expected_epoch: inventory.epoch_sha256,
              p_after_source_id: after,
              p_limit: pageLimit,
            }),
            controller.signal,
          );
          checkCall();
          const bound = await bindECOSLinkedProjectDocumentIndexesPage(
            raw,
            inventory,
            { afterSourceId: after, pageLimit },
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
          ? 'Document index resolution cancelled'
          : 'Document index resolution unavailable or changed',
      );
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (abort) signal?.removeEventListener('abort', abort);
      controller.abort();
    }
  }
  const pages: Awaited<
    ReturnType<typeof bindECOSLinkedProjectDocumentIndexesPage>
  >[] = [];
  const cursors: (string | null)[] = [];
  const encoder = new TextEncoder();
  let after: string | null = null;
  let bytes = 0;
  do {
    const page = await call(after);
    bytes += encoder.encode(JSON.stringify(page)).length;
    if (bytes > 16 * 1024 * 1024 || pages.length >= 600) {
      throw new Error(
        'Document index resolution exceeds retained sweep bounds',
      );
    }
    cursors.push(after);
    pages.push(page);
    after = page.inventory_page.next_source_id;
  } while (after !== null);
  const resolved = assembleECOSLinkedProjectDocumentIndexes(pages, inventory);
  for (let index = 0; index < pages.length; index++) {
    const observed = await call(cursors[index]);
    if (JSON.stringify(observed) !== JSON.stringify(pages[index])) {
      throw new Error(
        'Document index resolution changed during final observation',
      );
    }
  }
  check();
  return Object.freeze({
    inventory,
    resolved,
    freshness: 'all_resolution_pages_rechecked_sequentially' as const,
    atomic_project_snapshot: false as const,
    retrieval_authorized: false as const,
  });
}
