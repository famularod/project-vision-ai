import {
  assertECOSLinkedOwnerProjectDocumentInventory,
  type ECOSLinkedOwnerProjectDocumentInventory,
} from './ecos-linked-owner-project-document-inventory.ts';
import {
  assembleECOSLinkedOwnerProjectDocumentIndexes,
  bindECOSLinkedOwnerProjectDocumentIndexesPage,
  type ECOSBoundLinkedOwnerProjectDocumentIndexesPage,
} from './ecos-linked-owner-project-document-indexes.ts';

export type ECOSLinkedOwnerProjectDocumentIndexesRPC = (
  name: 'ecos_resolve_linked_owner_project_document_indexes',
  parameters: Readonly<Record<string, string | number | null>>,
  signal: AbortSignal,
) => Promise<unknown>;
export interface ECOSOwnerIndexesLoaderOptions {
  signal?: AbortSignal;
  pageLimit?: number;
  budgetMs?: number;
  rpcTimeoutMs?: number;
  expectedIndexEpoch?: string;
}
/** No transport default and no execution controls. The SQL index epoch covers
 * the COMPLETE linked inventory and every expected head/absence, including
 * sources outside this page. A pinned final first-page read rechecks that epoch;
 * it is not an atomic global snapshot or evidence freshness after this return. */
export async function loadECOSLinkedOwnerProjectDocumentIndexes(
  inventory: ECOSLinkedOwnerProjectDocumentInventory,
  rpc: ECOSLinkedOwnerProjectDocumentIndexesRPC,
  options: ECOSOwnerIndexesLoaderOptions = {},
) {
  assertECOSLinkedOwnerProjectDocumentInventory(inventory);
  if (
    !options || typeof options !== 'object' ||
    Object.getPrototypeOf(options) !== Object.prototype
  ) throw new Error('Invalid owner index options');
  const descriptors = Object.getOwnPropertyDescriptors(options);
  if (
    Reflect.ownKeys(options).some((k) =>
      typeof k !== 'string' ||
      !['signal', 'pageLimit', 'budgetMs', 'rpcTimeoutMs', 'expectedIndexEpoch']
        .includes(k)
    ) ||
    Object.values(descriptors).some((d) =>
      !d.enumerable || !Object.hasOwn(d, 'value')
    )
  ) throw new Error('Invalid owner index options');
  const safe = Object.fromEntries(
    Object.entries(descriptors).map(([k, d]) => [k, d.value]),
  ) as ECOSOwnerIndexesLoaderOptions;
  const signal = safe.signal,
    limit = safe.pageLimit ?? 64,
    budget = safe.budgetMs ?? 120000,
    rpcBudget = safe.rpcTimeoutMs ?? 25000;
  if (
    typeof rpc !== 'function' || !Number.isSafeInteger(limit) || limit < 1 ||
    limit > 128 ||
    !Number.isSafeInteger(budget) || budget < 1 || budget > 120000 ||
    !Number.isSafeInteger(rpcBudget) || rpcBudget < 1 || rpcBudget > 25000 ||
    signal !== undefined && !(signal instanceof AbortSignal) ||
    safe.expectedIndexEpoch !== undefined &&
      (typeof safe.expectedIndexEpoch !== 'string' ||
        !/^[a-f0-9]{64}$/.test(safe.expectedIndexEpoch))
  ) throw new Error('Invalid owner index bounds');
  // Enforce the independently known whole-inventory bound before any RPC.
  const count = inventory.rows.reduce(
    (sum, source) =>
      sum +
      (source.effective_source?.source_page_count ??
        source.registry_row?.source_page_count ?? 0),
    0,
  );
  if (count > 20000 || inventory.rows.length > 600) {
    throw new Error('Owner index whole-inventory bound exceeded');
  }
  const deadline = performance.now() + budget;
  const check = () => {
    if (signal?.aborted || performance.now() >= deadline) {
      throw new Error('Owner index read cancelled or deadline exceeded');
    }
  };
  async function call(after: number, epoch: string | null) {
    check();
    const controller = new AbortController(),
      callDeadline = Math.min(deadline, performance.now() + rpcBudget);
    const checkCall = () => {
      check();
      if (controller.signal.aborted || performance.now() >= callDeadline) {
        throw new Error('Owner index call deadline exceeded');
      }
    };
    let timer: ReturnType<typeof setTimeout> | undefined,
      abort: (() => void) | undefined;
    const stopped = new Promise<never>((_resolve, reject) => {
      abort = () => {
        controller.abort();
        reject(new Error('Owner index read cancelled'));
      };
      signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('Owner index deadline exceeded'));
      }, Math.max(1, callDeadline - performance.now()));
    });
    try {
      return await Promise.race([
        Promise.resolve().then(async () => {
          checkCall();
          const raw = await rpc(
            'ecos_resolve_linked_owner_project_document_indexes',
            Object.freeze({
              p_organization_id: inventory.organization_id,
              p_project_id: inventory.project_id,
              p_owner_id: inventory.owner_id,
              p_expected_inventory_epoch: inventory.epoch_sha256,
              p_expected_index_epoch: epoch,
              p_after_ordinal: after,
              p_limit: limit,
            }),
            controller.signal,
          );
          checkCall();
          const page = bindECOSLinkedOwnerProjectDocumentIndexesPage(
            raw,
            inventory,
            { afterOrdinal: after, pageLimit: limit, indexEpochSha256: epoch },
          );
          checkCall();
          return page;
        }),
        stopped,
      ]);
    } catch {
      throw new Error(
        signal?.aborted
          ? 'Owner index read cancelled'
          : 'Owner index unavailable, changed or deadline exceeded',
      );
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (abort) signal?.removeEventListener('abort', abort);
      controller.abort();
    }
  }
  const pages: ECOSBoundLinkedOwnerProjectDocumentIndexesPage[] = [];
  let after = 0, epoch = safe.expectedIndexEpoch ?? null, bytes = 0;
  do {
    const page = await call(after, epoch);
    check();
    bytes += new TextEncoder().encode(JSON.stringify(page)).length;
    if (bytes > 16 * 1024 * 1024 || pages.length >= 20600) {
      throw new Error('Owner index whole-inventory retained bound exceeded');
    }
    pages.push(page);
    epoch = page.index_epoch_sha256;
    if (page.next_ordinal === null) break;
    after = page.next_ordinal;
  } while (true);
  const resolved = assembleECOSLinkedOwnerProjectDocumentIndexes(
    pages,
    inventory,
  );
  check();
  const final = await call(0, epoch);
  if (JSON.stringify(final) !== JSON.stringify(pages[0])) {
    throw new Error('Owner index changed during final read');
  }
  check();
  return Object.freeze({
    inventory,
    resolved,
    freshness: 'complete_index_epoch_rechecked_at_final_read' as const,
    atomic_project_snapshot: false as const,
    retrieval_authorized: false as const,
  });
}
