import {
  assertECOSLinkedProjectDocumentInventory,
  type ECOSLinkedProjectDocumentInventory,
} from './ecos-linked-project-document-inventory.ts';
import {
  assertECOSLinkedProjectDocumentIndexes,
  type ECOSLinkedProjectDocumentIndexes,
} from './ecos-linked-project-document-indexes.ts';
import {
  bindECOSLinkedNativePageSearch,
  ECOS_LINKED_NATIVE_SEARCH_RPC,
  type ECOSLinkedNativePageSearch,
  validateECOSNativePageSearchQuery,
} from './ecos-linked-native-page-search.ts';

export type ECOSLinkedNativePageSearchRPC = (
  name: typeof ECOS_LINKED_NATIVE_SEARCH_RPC,
  parameters: Readonly<Record<string, string | number | null>>,
  signal: AbortSignal,
) => Promise<unknown>;

/** Internal read-only lexical discovery. Both full search-head observations
 * use the same exact inventory and query; the second pins the first search
 * epoch. No worker credentials, writes, source substitutions or answers.
 * Matching sequential readbacks are not an atomic project-wide snapshot. */
export async function loadECOSLinkedNativePageSearch(
  inventory: Readonly<ECOSLinkedProjectDocumentInventory>,
  indexes: Readonly<ECOSLinkedProjectDocumentIndexes>,
  queryInput: string,
  rpc: ECOSLinkedNativePageSearchRPC,
  options: {
    signal?: AbortSignal;
    limit?: number;
    budgetMs?: number;
    rpcTimeoutMs?: number;
    expectedSearchEpoch?: string;
  } = {},
): Promise<Readonly<ECOSLinkedNativePageSearch>> {
  assertECOSLinkedProjectDocumentInventory(inventory);
  assertECOSLinkedProjectDocumentIndexes(indexes, inventory);
  const query = validateECOSNativePageSearchQuery(queryInput);
  const limit = options.limit ?? 8;
  const budgetMs = options.budgetMs ?? 120_000;
  const rpcTimeoutMs = options.rpcTimeoutMs ?? 25_000;
  const expectedEpoch = options.expectedSearchEpoch ?? null;
  const signal = options.signal;
  if (
    typeof rpc !== 'function' || !Number.isSafeInteger(limit) || limit < 1 ||
    limit > 8 ||
    !Number.isSafeInteger(budgetMs) || budgetMs < 1 || budgetMs > 120_000 ||
    !Number.isSafeInteger(rpcTimeoutMs) || rpcTimeoutMs < 1 ||
    rpcTimeoutMs > 25_000 ||
    (expectedEpoch !== null &&
      (typeof expectedEpoch !== 'string' ||
        !/^[a-f0-9]{64}$/.test(expectedEpoch))) ||
    (signal !== undefined && !(signal instanceof AbortSignal))
  ) throw new Error('Invalid native search request bounds');
  const deadline = performance.now() + budgetMs;
  const check = () => {
    if (signal?.aborted) throw new Error('Native page search cancelled');
    if (performance.now() >= deadline) {
      throw new Error('Native page search deadline exceeded');
    }
  };
  async function call(epoch: string | null) {
    check();
    const controller = new AbortController();
    const callDeadline = Math.min(deadline, performance.now() + rpcTimeoutMs);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    const checkCall = () => {
      check();
      if (controller.signal.aborted || performance.now() >= callDeadline) {
        throw new Error('Native page search request stopped');
      }
    };
    const stop = new Promise<never>((_resolve, reject) => {
      abort = () => {
        controller.abort();
        reject(new Error('Native page search request stopped'));
      };
      signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(abort, Math.max(1, callDeadline - performance.now()));
    });
    try {
      const result = await Promise.race([
        Promise.resolve().then(async () => {
          checkCall();
          const raw = await rpc(
            ECOS_LINKED_NATIVE_SEARCH_RPC,
            Object.freeze({
              p_organization_id: inventory.organization_id,
              p_project_id: inventory.project_id,
              p_owner_id: inventory.owner_id,
              p_expected_inventory_epoch: inventory.epoch_sha256,
              p_query: query,
              p_expected_search_epoch: epoch,
              p_limit: limit,
            }),
            controller.signal,
          );
          checkCall();
          const bound = await bindECOSLinkedNativePageSearch(
            raw,
            inventory,
            indexes,
            {
              query,
              expectedSearchEpoch: epoch,
              limit,
            },
          );
          checkCall();
          return bound;
        }),
        stop,
      ]);
      checkCall();
      return result;
    } catch {
      throw new Error(
        signal?.aborted
          ? 'Native page search cancelled'
          : 'Native page search unavailable or changed',
      );
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (abort) signal?.removeEventListener('abort', abort);
      controller.abort();
    }
  }
  const first = await call(expectedEpoch);
  const final = await call(first.search_epoch_sha256);
  check();
  if (JSON.stringify(first) !== JSON.stringify(final)) {
    throw new Error('Native page search changed during final observation');
  }
  check();
  return final;
}
