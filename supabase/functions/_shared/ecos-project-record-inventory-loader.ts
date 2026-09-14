import {
  assembleECOSProjectRecordInventory,
  bindECOSProjectRecordInventoryPage,
  buildECOSProjectRecordObservations,
} from './ecos-project-record-inventory.ts';

export interface ECOSProjectRecordInventoryRequest {
  organizationId: string;
  projectId: string;
  ownerId: string;
}

/** Internal, already-authorized service transport. No customer credentials or
 * source lists are accepted here. Implementations must propagate the signal. */
export type ECOSProjectRecordInventoryRPC = (
  name: 'ecos_list_project_record_inventory',
  parameters: Readonly<Record<string, string | number | null>>,
  signal: AbortSignal,
) => Promise<unknown>;

function identity(value: unknown, uuid = false): string {
  if (
    typeof value !== 'string' || !value || value !== value.trim() ||
    new TextEncoder().encode(value).length > 500 ||
    [...value].some((character) => {
      const code = character.codePointAt(0)!;
      return code < 32 || (code >= 127 && code <= 159) ||
        (code >= 0xd800 && code <= 0xdfff);
    }) ||
    (uuid &&
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
        .test(value))
  ) throw new Error('Invalid project inventory scope');
  return value;
}

/** Load every exact-project cloud operational record, including completed,
 * resolved and archived rows. No caller-selected record list can establish
 * completeness. The final same-epoch read rejects additions, deletions, edits,
 * authorization changes, and lifecycle drift during the sweep.
 *
 * This is a private transport contract, not end-user authorization or a deployed
 * endpoint. Raw records and reported values are not verified physical facts.
 * Documents, photos, field updates, local drafts, and legacy name links remain
 * outside this inventory. A failed sweep returns no usable prefix or retry.
 */
export async function loadECOSProjectRecordInventory(
  input: ECOSProjectRecordInventoryRequest,
  rpc: ECOSProjectRecordInventoryRPC,
  options: {
    signal?: AbortSignal;
    pageLimit?: number;
    budgetMs?: number;
    rpcTimeoutMs?: number;
  } = {},
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
  ) throw new Error('Invalid project inventory scope');
  // Snapshot all scope before the first wait; caller edits cannot retarget RPCs.
  const scope = Object.freeze({
    organizationId: identity(descriptors.organizationId.value),
    projectId: identity(descriptors.projectId.value, true),
    ownerId: identity(descriptors.ownerId.value, true),
  });
  const pageLimit = options.pageLimit ?? 16;
  const budgetMs = options.budgetMs ?? 120_000;
  const rpcTimeoutMs = options.rpcTimeoutMs ?? 25_000;
  if (
    typeof rpc !== 'function' || !Number.isSafeInteger(pageLimit) ||
    pageLimit < 1 || pageLimit > 16 || !Number.isSafeInteger(budgetMs) ||
    budgetMs < 1 || budgetMs > 120_000 ||
    !Number.isSafeInteger(rpcTimeoutMs) || rpcTimeoutMs < 1 ||
    rpcTimeoutMs > 25_000
  ) throw new Error('Invalid project inventory transport bounds');
  const signal = options.signal;
  const deadline = performance.now() + budgetMs;
  const check = () => {
    if (signal?.aborted) throw new Error('Project inventory cancelled');
    if (performance.now() >= deadline) {
      throw new Error('Project inventory deadline exceeded');
    }
  };
  async function call(epoch: string | null, after: string | null) {
    check();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    const stop = new Promise<never>((_resolve, reject) => {
      abort = () => {
        controller.abort();
        reject(new Error('Project inventory cancelled'));
      };
      signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('Project inventory deadline exceeded'));
      }, Math.max(1, Math.min(rpcTimeoutMs, deadline - performance.now())));
    });
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => {
          check();
          if (controller.signal.aborted) {
            throw new Error('Project inventory cancelled');
          }
          return rpc(
            'ecos_list_project_record_inventory',
            Object.freeze({
              p_organization_id: scope.organizationId,
              p_project_id: scope.projectId,
              p_owner_id: scope.ownerId,
              p_expected_epoch: epoch,
              p_after_source_key: after,
              p_limit: pageLimit,
            }),
            controller.signal,
          );
        }),
        stop,
      ]);
      check();
      const bound = await bindECOSProjectRecordInventoryPage(result, {
        ...scope,
        epochSha256: epoch,
        afterSourceKey: after,
        pageLimit,
      });
      check();
      if (controller.signal.aborted) {
        throw new Error('Project inventory deadline exceeded');
      }
      return bound;
    } catch {
      // Provider error text can contain data or secrets. No such text reaches
      // this coordinator's caller, and no subsequent page is dispatched.
      throw new Error(
        signal?.aborted
          ? 'Project inventory cancelled'
          : 'Project inventory unavailable or changed',
      );
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (abort) signal?.removeEventListener('abort', abort);
      controller.abort();
    }
  }
  const pages: Awaited<
    ReturnType<typeof bindECOSProjectRecordInventoryPage>
  >[] = [];
  let epoch: string | null = null;
  let after: string | null = null;
  let bytes = 0;
  do {
    const page = await call(epoch, after);
    bytes += page.rows.reduce(
      (sum, row) => sum + new TextEncoder().encode(row.record_json).length,
      0,
    );
    if (bytes > 32 * 1024 * 1024 || pages.length >= 1000) {
      throw new Error('Project inventory exceeds retained sweep bounds');
    }
    pages.push(page);
    epoch = page.epoch_sha256;
    after = page.next_source_key;
  } while (after !== null);
  const inventory = assembleECOSProjectRecordInventory(pages);
  const finalPage = await call(epoch, null);
  if (JSON.stringify(finalPage) !== JSON.stringify(pages[0])) {
    throw new Error('Project inventory changed during final observation');
  }
  check();
  const observations = buildECOSProjectRecordObservations(inventory);
  check();
  return Object.freeze({
    inventory,
    observations,
    freshness: 'same_operational_epoch_at_final_read' as const,
  });
}
