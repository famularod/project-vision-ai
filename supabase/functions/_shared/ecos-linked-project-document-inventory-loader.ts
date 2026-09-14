import {
  assembleECOSLinkedProjectDocumentInventory,
  bindECOSLinkedProjectDocumentInventoryPage,
  buildECOSLinkedProjectDocumentPlan,
} from './ecos-linked-project-document-inventory.ts';
import {
  assembleECOSLinkedOwnerProjectDocumentInventory,
  bindECOSLinkedOwnerProjectDocumentInventoryPage,
  buildECOSLinkedOwnerProjectDocumentPlan,
} from './ecos-linked-owner-project-document-inventory.ts';

export interface ECOSLinkedProjectDocumentInventoryRequest {
  organizationId: string;
  projectId: string;
  ownerId: string;
}

/** Internal, already-authorized read-only service transport. It must forward
 * cancellation and enforce server transaction deadlines independently. */
export type ECOSLinkedProjectDocumentInventoryRPC = (
  name: 'ecos_list_linked_project_document_inventory',
  parameters: Readonly<Record<string, string | number | null>>,
  signal: AbortSignal,
) => Promise<unknown>;

export type ECOSLinkedOwnerProjectDocumentInventoryRPC = (
  name: 'ecos_list_linked_owner_project_document_inventory',
  parameters: Readonly<Record<string, string | number | null>>,
  signal: AbortSignal,
) => Promise<unknown>;

export interface ECOSLinkedDocumentInventoryLoaderOptions {
  signal?: AbortSignal;
  pageLimit?: number;
  budgetMs?: number;
  rpcTimeoutMs?: number;
}

function identity(value: unknown, uuid = false): string {
  if (
    typeof value !== 'string' || !value || value !== value.trim() ||
    new TextEncoder().encode(value).length > 500 ||
    [...value].some((character) => {
      const point = character.codePointAt(0)!;
      return point < 32 || (point >= 127 && point <= 159) ||
        (point >= 0xd800 && point <= 0xdfff);
    }) ||
    (uuid &&
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
        .test(value))
  ) throw new Error('Invalid linked document inventory scope');
  return value;
}

/** Enumerate all exact-primary and reviewed-link candidates in one bounded
 * combined epoch. Never accept a customer-supplied source subset, a partial
 * prefix, or a silent restart on drift. Stale links remain explicit gaps.
 *
 * This is an internal preprocessing plan, not customer authorization, proof of
 * source bytes, or an assertion that the whole project library is understood.
 */
export async function loadECOSLinkedProjectDocumentInventory(
  input: ECOSLinkedProjectDocumentInventoryRequest,
  rpc: ECOSLinkedProjectDocumentInventoryRPC,
  options: ECOSLinkedDocumentInventoryLoaderOptions = {},
) {
  return await sweepLinkedInventory(input, rpc, options, {
    rpcName: 'ecos_list_linked_project_document_inventory',
    ownerWorkspace: false,
    bind: bindECOSLinkedProjectDocumentInventoryPage,
    assemble: assembleECOSLinkedProjectDocumentInventory,
    plan: buildECOSLinkedProjectDocumentPlan,
    freshness: 'same_linked_inventory_epoch_at_final_read',
  });
}

/** Owner-workspace /2.1 path. Original missing-organization metadata remains
 * visible as a gap; only its own validated owner receipt supplies effective
 * source pins. This does not create a /2.0 brand or authorize retrieval. */
export async function loadECOSLinkedOwnerProjectDocumentInventory(
  input: ECOSLinkedProjectDocumentInventoryRequest,
  rpc: ECOSLinkedOwnerProjectDocumentInventoryRPC,
  options: ECOSLinkedDocumentInventoryLoaderOptions = {},
) {
  return await sweepLinkedInventory(input, rpc, options, {
    rpcName: 'ecos_list_linked_owner_project_document_inventory',
    ownerWorkspace: true,
    bind: bindECOSLinkedOwnerProjectDocumentInventoryPage,
    assemble: assembleECOSLinkedOwnerProjectDocumentInventory,
    plan: buildECOSLinkedOwnerProjectDocumentPlan,
    freshness: 'same_linked_owner_inventory_epoch_at_final_read',
  });
}

// Private mechanism only: callers cannot inject an alternative binder, RPC
// name or assembler. Each wrapper retains its concrete page/inventory brands.
async function sweepLinkedInventory<
  Name extends string,
  Page extends { epoch_sha256: string; next_source_id: string | null },
  Inventory,
  Plan,
  Freshness extends string,
>(
  input: ECOSLinkedProjectDocumentInventoryRequest,
  rpc: (
    name: Name,
    parameters: Readonly<Record<string, string | number | null>>,
    signal: AbortSignal,
  ) => Promise<unknown>,
  options: ECOSLinkedDocumentInventoryLoaderOptions,
  protocol: {
    rpcName: Name;
    ownerWorkspace: boolean;
    bind: (
      raw: unknown,
      expected: ECOSLinkedProjectDocumentInventoryRequest & {
        epochSha256: string | null;
        afterSourceId: string | null;
        pageLimit: number;
      },
    ) => Promise<Page>;
    assemble: (pages: readonly Page[]) => Inventory;
    plan: (inventory: Inventory) => Plan;
    freshness: Freshness;
  },
) {
  const descriptors: Record<string, PropertyDescriptor> =
    input && typeof input === 'object'
      ? Object.getOwnPropertyDescriptors(input)
      : {};
  if (
    !input || typeof input !== 'object' || Array.isArray(input) ||
    (Object.getPrototypeOf(input) !== Object.prototype &&
      Object.getPrototypeOf(input) !== null) ||
    Reflect.ownKeys(input).length !== 3 ||
    Object.keys(descriptors).sort().join(',') !==
      'organizationId,ownerId,projectId' ||
    Object.values(descriptors).some((d) =>
      !d.enumerable || !Object.hasOwn(d, 'value')
    )
  ) throw new Error('Invalid linked document inventory scope');
  const scope = Object.freeze({
    organizationId: identity(descriptors.organizationId.value),
    projectId: identity(descriptors.projectId.value, true),
    ownerId: identity(descriptors.ownerId.value, true),
  });
  if (protocol.ownerWorkspace && scope.organizationId !== scope.ownerId) {
    throw new Error('Invalid owner linked document inventory scope');
  }
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
  ) throw new Error('Invalid linked document inventory transport bounds');
  const deadline = performance.now() + budgetMs;
  const check = () => {
    if (signal?.aborted) throw new Error('Linked document inventory cancelled');
    if (performance.now() >= deadline) {
      throw new Error('Linked document inventory deadline exceeded');
    }
  };
  async function call(epoch: string | null, after: string | null) {
    check();
    const controller = new AbortController();
    const callDeadline = Math.min(deadline, performance.now() + rpcTimeoutMs);
    const checkCall = () => {
      check();
      if (controller.signal.aborted || performance.now() >= callDeadline) {
        throw new Error('Linked document inventory call deadline exceeded');
      }
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    const stop = new Promise<never>((_resolve, reject) => {
      abort = () => {
        controller.abort();
        reject(new Error('Linked document inventory cancelled'));
      };
      signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('Linked document inventory deadline exceeded'));
      }, Math.max(1, callDeadline - performance.now()));
    });
    try {
      const page = await Promise.race([
        Promise.resolve().then(async () => {
          checkCall();
          const raw = await rpc(
            protocol.rpcName,
            Object.freeze({
              p_organization_id: scope.organizationId,
              p_project_id: scope.projectId,
              p_owner_id: scope.ownerId,
              p_expected_epoch: epoch,
              p_after_source_id: after,
              p_limit: pageLimit,
            }),
            controller.signal,
          );
          checkCall();
          const bound = await protocol.bind(raw, {
            ...scope,
            epochSha256: epoch,
            afterSourceId: after,
            pageLimit,
          });
          checkCall();
          return bound;
        }),
        stop,
      ]);
      checkCall();
      return page;
    } catch {
      // No provider messages, fallback source list, or usable prefix escapes.
      throw new Error(
        signal?.aborted
          ? 'Linked document inventory cancelled'
          : 'Linked document inventory unavailable or changed',
      );
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (abort) signal?.removeEventListener('abort', abort);
      controller.abort();
    }
  }
  const pages: Page[] = [];
  let epoch: string | null = null;
  let after: string | null = null;
  let bytes = 0;
  do {
    const page = await call(epoch, after);
    bytes += new TextEncoder().encode(JSON.stringify(page)).length;
    if (bytes > 16 * 1024 * 1024 || pages.length >= 600) {
      throw new Error(
        'Linked document inventory exceeds retained sweep bounds',
      );
    }
    pages.push(page);
    epoch = page.epoch_sha256;
    after = page.next_source_id;
  } while (after !== null);
  const inventory = protocol.assemble(pages);
  const finalPage = await call(epoch, null);
  if (JSON.stringify(finalPage) !== JSON.stringify(pages[0])) {
    throw new Error(
      'Linked document inventory changed during final observation',
    );
  }
  check();
  const plan = protocol.plan(inventory);
  check();
  return Object.freeze({
    inventory,
    plan,
    freshness: protocol.freshness,
  });
}
