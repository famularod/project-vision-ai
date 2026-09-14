import {
  assembleECOSDocumentAssociationReviewInventory,
  bindECOSDocumentAssociationReviewPage,
  buildECOSDocumentAssociationReviewPlan,
} from './ecos-document-association-review.ts';

export interface ECOSDocumentAssociationReviewRequest {
  organizationId: string;
  projectId: string;
  ownerId: string;
}

/** Internal, already-authorized service transport. No customer credentials or
 * source lists are accepted here. Implementations must propagate the signal. */
export type ECOSDocumentAssociationReviewRPC = (
  name: 'ecos_list_document_association_review_inventory',
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
  ) throw new Error('Invalid association review scope');
  return value;
}

/** Load every bounded owner document, project and deletion-marker association.
 * The target project scopes this internal review; names and restored ID hints
 * never grant retrieval access. No selected source list or usable partial prefix
 * is accepted. A final same-epoch read includes all roster and source changes.
 *
 * Private service transport only, not a customer endpoint. This inventory does
 * not establish project-library completeness or change any source bindings.
 * Cancellation bounds this coordinator; hosted SQL cancellation still requires
 * an independently verified caller transaction deadline.
 */
export async function loadECOSDocumentAssociationReview(
  input: ECOSDocumentAssociationReviewRequest,
  rpc: ECOSDocumentAssociationReviewRPC,
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
  ) throw new Error('Invalid association review scope');
  // Snapshot all scope before the first wait; caller edits cannot retarget RPCs.
  const scope = Object.freeze({
    organizationId: identity(descriptors.organizationId.value),
    projectId: identity(descriptors.projectId.value, true),
    ownerId: identity(descriptors.ownerId.value, true),
  });
  const pageLimit = options.pageLimit ?? 25;
  const budgetMs = options.budgetMs ?? 120_000;
  const rpcTimeoutMs = options.rpcTimeoutMs ?? 25_000;
  if (
    typeof rpc !== 'function' || !Number.isSafeInteger(pageLimit) ||
    pageLimit < 1 || pageLimit > 50 || !Number.isSafeInteger(budgetMs) ||
    budgetMs < 1 || budgetMs > 120_000 ||
    !Number.isSafeInteger(rpcTimeoutMs) || rpcTimeoutMs < 1 ||
    rpcTimeoutMs > 25_000
  ) throw new Error('Invalid association review transport bounds');
  const signal = options.signal;
  const deadline = performance.now() + budgetMs;
  const check = () => {
    if (signal?.aborted) throw new Error('Association review cancelled');
    if (performance.now() >= deadline) {
      throw new Error('Association review deadline exceeded');
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
        reject(new Error('Association review cancelled'));
      };
      signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('Association review deadline exceeded'));
      }, Math.max(1, Math.min(rpcTimeoutMs, deadline - performance.now())));
    });
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => {
          check();
          if (controller.signal.aborted) {
            throw new Error('Association review cancelled');
          }
          return rpc(
            'ecos_list_document_association_review_inventory',
            Object.freeze({
              p_organization_id: scope.organizationId,
              p_project_id: scope.projectId,
              p_owner_id: scope.ownerId,
              p_expected_epoch: epoch,
              p_after_entity_key: after,
              p_limit: pageLimit,
            }),
            controller.signal,
          );
        }),
        stop,
      ]);
      check();
      const bound = await bindECOSDocumentAssociationReviewPage(result, {
        ...scope,
        epochSha256: epoch,
        afterEntityKey: after,
        pageLimit,
      });
      check();
      if (controller.signal.aborted) {
        throw new Error('Association review deadline exceeded');
      }
      return bound;
    } catch {
      // Provider error text can contain data or secrets. No such text reaches
      // this coordinator's caller, and no subsequent page is dispatched.
      throw new Error(
        signal?.aborted
          ? 'Association review cancelled'
          : 'Association review unavailable or changed',
      );
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (abort) signal?.removeEventListener('abort', abort);
      controller.abort();
    }
  }
  const pages: Awaited<
    ReturnType<typeof bindECOSDocumentAssociationReviewPage>
  >[] = [];
  let epoch: string | null = null;
  let after: string | null = null;
  let bytes = 0;
  do {
    const page = await call(epoch, after);
    bytes += page.rows.reduce(
      (sum, row) =>
        sum + new TextEncoder().encode(row.metadata_json ?? '').length,
      0,
    );
    if (bytes > 16 * 1024 * 1024 || pages.length >= 1200) {
      throw new Error('Association review exceeds retained sweep bounds');
    }
    pages.push(page);
    epoch = page.epoch_sha256;
    after = page.next_entity_key;
  } while (after !== null);
  const inventory = assembleECOSDocumentAssociationReviewInventory(pages);
  const finalPage = await call(epoch, null);
  if (JSON.stringify(finalPage) !== JSON.stringify(pages[0])) {
    throw new Error('Association review changed during final observation');
  }
  check();
  const plan = buildECOSDocumentAssociationReviewPlan(inventory);
  check();
  return Object.freeze({
    inventory,
    plan,
    freshness: 'same_association_epoch_at_final_read' as const,
  });
}
