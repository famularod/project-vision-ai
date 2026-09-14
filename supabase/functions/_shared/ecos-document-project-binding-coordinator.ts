import {
  assertECOSDocumentProjectBindingDecision,
  bindECOSDocumentProjectBindingRead,
  bindECOSDocumentProjectBindingResult,
  prepareECOSDocumentProjectBindingDecision,
} from './ecos-document-project-binding.ts';

type Decision = ReturnType<typeof prepareECOSDocumentProjectBindingDecision>;
type ReadScope = Parameters<typeof bindECOSDocumentProjectBindingRead>[1];

/** Trusted internal service transport, not a customer endpoint. It must forward
 * cancellation and enforce a database transaction deadline independently. */
export type ECOSDocumentProjectBindingRPC = (
  name:
    | 'ecos_commit_document_project_binding'
    | 'ecos_read_document_project_binding',
  parameters: Readonly<Record<string, unknown>>,
  signal: AbortSignal,
) => Promise<unknown>;

interface Options {
  signal?: AbortSignal;
  timeoutMs?: number;
}

function dataRecord(value: unknown): Record<string, unknown> {
  if (
    !value || typeof value !== 'object' || Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) throw new Error('Invalid document binding input');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(value).length !== Object.keys(descriptors).length ||
    Object.values(descriptors).some((d) =>
      !d.enumerable || !Object.hasOwn(d, 'value')
    )
  ) throw new Error('Invalid document binding input');
  return Object.fromEntries(
    Object.entries(descriptors).map((
      [key, descriptor],
    ) => [key, descriptor.value]),
  );
}

function bounds(options: Options, rpc: ECOSDocumentProjectBindingRPC) {
  const record = dataRecord(options);
  const timeoutMs = record.timeoutMs ?? 25_000;
  if (
    Object.keys(record).some((key) =>
      key !== 'signal' && key !== 'timeoutMs'
    ) ||
    typeof rpc !== 'function' || !Number.isSafeInteger(timeoutMs) ||
    (timeoutMs as number) < 1 || (timeoutMs as number) > 25_000 ||
    (record.signal !== undefined && !(record.signal instanceof AbortSignal))
  ) throw new Error('Invalid document binding transport bounds');
  const signal = record.signal as AbortSignal | undefined;
  if (signal?.aborted) {
    throw new Error('Document binding cancelled before dispatch');
  }
  return { timeoutMs: timeoutMs as number, signal };
}

function textIdentity(value: unknown, maxBytes: number, uuid = false): string {
  if (
    typeof value !== 'string' || value.length === 0 || value !== value.trim() ||
    new TextEncoder().encode(value).length > maxBytes ||
    [...value].some((character) => {
      const point = character.codePointAt(0)!;
      return point < 32 || (point >= 127 && point <= 159) ||
        (point >= 0xd800 && point <= 0xdfff);
    }) ||
    (uuid &&
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
        .test(value))
  ) throw new Error('Invalid document binding scope');
  return value;
}

function readScope(input: ReadScope): ReadScope {
  const record = dataRecord(input);
  if (
    Object.keys(record).sort().join(',') !==
      'decisionId,documentId,organizationId,ownerId,projectId'
  ) throw new Error('Invalid document binding scope');
  return Object.freeze({
    organizationId: textIdentity(record.organizationId, 500),
    ownerId: textIdentity(record.ownerId, 36, true),
    projectId: textIdentity(record.projectId, 36, true),
    documentId: textIdentity(record.documentId, 300),
    decisionId: record.decisionId === null
      ? null
      : textIdentity(record.decisionId, 36, true),
  });
}

async function boundedCall<T>(
  settings: ReturnType<typeof bounds>,
  operation: (signal: AbortSignal) => Promise<T>,
) {
  const controller = new AbortController();
  const deadline = performance.now() + settings.timeoutMs;
  const checkDeadline = () => {
    if (controller.signal.aborted || settings.signal?.aborted) {
      throw new Error('Document binding cancelled');
    }
    if (performance.now() >= deadline) {
      controller.abort();
      throw new Error('Document binding deadline exceeded');
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  const stop = new Promise<never>((_resolve, reject) => {
    abort = () => {
      controller.abort();
      reject(new Error('Document binding cancelled'));
    };
    settings.signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('Document binding deadline exceeded'));
    }, settings.timeoutMs);
  });
  try {
    if (settings.signal?.aborted) abort!();
    const result = await Promise.race([
      Promise.resolve().then(() => {
        checkDeadline();
        return operation(controller.signal);
      }),
      stop,
    ]);
    // A synchronously blocking transport can starve the timer callback while
    // promise microtasks complete. Never accept that late result as on time.
    checkDeadline();
    return result;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (abort) settings.signal?.removeEventListener('abort', abort);
    controller.abort();
  }
}

/** Exactly one save attempt. A timeout, cancellation or malformed receipt AFTER
 * dispatch cannot establish whether the transaction committed. Keep this exact
 * branded decision for an explicit same-ID retry; do not generate a new ID.
 * Even a verified historical receipt requires a separate current-binding read.
 */
export async function commitECOSDocumentProjectBinding(
  decision: Decision,
  rpc: ECOSDocumentProjectBindingRPC,
  options: Options = {},
) {
  assertECOSDocumentProjectBindingDecision(decision);
  const settings = bounds(options, rpc);
  let dispatched = false;
  try {
    const result = await boundedCall(settings, async (signal) => {
      dispatched = true;
      const raw = await rpc(
        'ecos_commit_document_project_binding',
        Object.freeze({ p_decision: decision }),
        signal,
      );
      if (signal.aborted) throw new Error('Document binding cancelled');
      const bound = await bindECOSDocumentProjectBindingResult(raw, decision);
      if (signal.aborted) throw new Error('Document binding cancelled');
      return bound;
    });
    return Object.freeze({
      state: 'receipt_verified' as const,
      decision,
      result,
      currentness: 'not_checked' as const,
      retrieval_authorized: false as const,
    });
  } catch {
    if (!dispatched) throw new Error('Document binding not dispatched');
    return Object.freeze({
      state: 'outcome_unknown' as const,
      decision,
      requires_same_decision_retry: true as const,
      retrieval_authorized: false as const,
    });
  }
}

/** A current read verifies only the saved association's current context. It is
 * not document-byte verification, customer authorization, or answer evidence. */
export async function readECOSDocumentProjectBinding(
  input: ReadScope,
  rpc: ECOSDocumentProjectBindingRPC,
  options: Options = {},
) {
  const scope = readScope(input);
  const settings = bounds(options, rpc);
  try {
    return await boundedCall(settings, async (signal) => {
      const raw = await rpc(
        'ecos_read_document_project_binding',
        Object.freeze({
          p_organization_id: scope.organizationId,
          p_owner_id: scope.ownerId,
          p_project_id: scope.projectId,
          p_document_id: scope.documentId,
        }),
        signal,
      );
      if (signal.aborted) throw new Error('Document binding cancelled');
      const result = await bindECOSDocumentProjectBindingRead(raw, scope);
      if (signal.aborted) throw new Error('Document binding cancelled');
      return result;
    });
  } catch {
    throw new Error('Document binding read unavailable or changed');
  }
}
