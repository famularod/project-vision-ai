import {
  assertECOSOwnerSourceAuthorityRead,
  type ECOSOwnerSourceAuthorityRead,
} from './ecos-owner-source-authority.ts';

export const ECOS_V2_MANAGED_ORIGINAL_PROJECT_URL =
  'https://xdytqlpsqsseoeuxgzre.supabase.co';
export const ECOS_V2_MANAGED_ORIGINAL_BUCKET = 'project-documents';
export const ECOS_V2_MANAGED_ORIGINAL_MAX_BYTES = 64 * 1024 * 1024;
const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const ATTEMPT =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const encoder = new TextEncoder();
const aborted = Object.getOwnPropertyDescriptor(
  AbortSignal.prototype,
  'aborted',
)!.get!;

export type ECOSV2ManagedOriginalErrorCode =
  | 'invalid_input'
  | 'authority_changed'
  | 'byte_mismatch'
  | 'pdf_rejected'
  | 'cancelled'
  | 'deadline_exceeded'
  | 'operation_timeout'
  | 'storage_unavailable'
  | 'storage_rejected'
  | 'storage_protocol_mismatch';
const ERROR_CODES = new Set<unknown>([
  'invalid_input',
  'authority_changed',
  'byte_mismatch',
  'pdf_rejected',
  'cancelled',
  'deadline_exceeded',
  'operation_timeout',
  'storage_unavailable',
  'storage_rejected',
  'storage_protocol_mismatch',
]);
export class ECOSV2ManagedOriginalError extends Error {
  readonly code: ECOSV2ManagedOriginalErrorCode;
  readonly objectMayExist = true;
  readonly externalOperationStopped = false;
  constructor(code: ECOSV2ManagedOriginalErrorCode) {
    const safeCode = ERROR_CODES.has(code) ? code : 'invalid_input';
    super(`Managed original not verified: ${safeCode}`);
    this.code = safeCode;
    this.name = 'ECOSV2ManagedOriginalError';
    Object.freeze(this);
  }
}
const failure = (code: ECOSV2ManagedOriginalErrorCode) =>
  new ECOSV2ManagedOriginalError(code);

export interface ECOSV2ManagedOriginalAuthorityPins {
  ownerId: string;
  organizationId: string;
  projectId: string;
  sourceId: string;
  decisionId: string;
  receiptSha256: string;
  contentSha256: string;
  sourceRevision: string | null;
  expectedPageCount: number;
  sourceGeneration: number;
  sourceMetadataSha256: string;
  originalLocatorSha256: string;
}
export interface ECOSV2ManagedOriginalStorageRequest {
  method: 'POST' | 'GET';
  projectUrl: typeof ECOS_V2_MANAGED_ORIGINAL_PROJECT_URL;
  bucket: typeof ECOS_V2_MANAGED_ORIGINAL_BUCKET;
  ownerId: string;
  sourceIdSha256: string;
  contentSha256: string;
  attemptId: string;
  objectKey: string;
  url: string;
  upsert: false;
  body: Blob | null;
}
export type ECOSV2ManagedOriginalStorage = (
  request: Readonly<ECOSV2ManagedOriginalStorageRequest>,
  signal: AbortSignal,
) => Promise<Response>;
export interface ECOSV2ManagedOriginalPorts {
  /** Trusted server adapter: authenticate the current actor, then use the exact
   * service-only owner authority reader. Do not decode user metadata or reuse a
   * cached current flag. This library does not invent an authenticated session. */
  recheckAuthority: (
    pins: Readonly<ECOSV2ManagedOriginalAuthorityPins>,
    signal: AbortSignal,
  ) => Promise<Readonly<ECOSOwnerSourceAuthorityRead>>;
  /** Trusted independent full PDF parser, not regex counting or a caller claim.
   * Reject inaccessible/encrypted/malformed PDFs. The provided bytes are a copy. */
  inspectPdf: (bytes: Uint8Array, signal: AbortSignal) => Promise<unknown>;
  storage: ECOSV2ManagedOriginalStorage;
  maxBytes?: number;
  budgetMs?: number;
  operationTimeoutMs?: number;
}
export interface ECOSV2ManagedOriginalVerification {
  schemaVersion: 'ecos-managed-original-verification/2.0';
  publicationMode: 'shadow';
  authority: Readonly<ECOSV2ManagedOriginalAuthorityPins>;
  projectUrl: typeof ECOS_V2_MANAGED_ORIGINAL_PROJECT_URL;
  bucket: typeof ECOS_V2_MANAGED_ORIGINAL_BUCKET;
  objectKey: string;
  attemptId: string;
  sourceIdSha256: string;
  contentSha256: string;
  byteLength: number;
  measuredPageCount: number;
  uploadOutcome:
    | 'created'
    | 'reconciled_existing'
    | 'reconciled_uncertain'
    | 'reconciled_read_only';
  verification: 'exact_bytes_sha256_and_independent_pdf_page_count';
  authorityCurrentness: 'same_receipt_rechecked_before_and_after_storage';
  storagePolicy: 'hosted_immutability_and_private_bucket_policy_not_verified';
  atomicSnapshot: false;
  persistentCas: 'not_performed';
  enrollment: 'not_performed';
  semanticEvidence: 'not_assessed';
  retrievalAuthorized: false;
}
const requests = new WeakSet<object>(), consumed = new WeakSet<object>();
const verified = new WeakSet<object>();

function dataObject(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
) {
  if (
    !value || typeof value !== 'object' ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) throw failure('invalid_input');
  const entries = Object.getOwnPropertyDescriptors(value),
    keys = Reflect.ownKeys(value);
  if (
    keys.some((key) =>
      typeof key !== 'string' || ![...required, ...optional].includes(key)
    ) ||
    required.some((key) => !Object.hasOwn(entries, key)) ||
    Object.values(entries).some((d) =>
      !d.enumerable || !Object.hasOwn(d, 'value')
    )
  ) throw failure('invalid_input');
  return Object.fromEntries(
    Object.entries(entries).map(([key, d]) => [key, d.value]),
  ) as Record<string, unknown>;
}
function bounded(value: unknown, fallback: number, max: number) {
  const n = value === undefined ? fallback : value;
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 1 || n > max) {
    throw failure('invalid_input');
  }
  return n;
}
function signalIsAborted(signal: AbortSignal) {
  try {
    return aborted.call(signal) as boolean;
  } catch {
    throw failure('invalid_input');
  }
}
function authorityPins(
  value: unknown,
): Readonly<ECOSV2ManagedOriginalAuthorityPins> {
  try {
    assertECOSOwnerSourceAuthorityRead(value);
  } catch {
    throw failure('invalid_input');
  }
  if (
    value.state !== 'current' || !value.receipt || !value.receipt_sha256 ||
    !value.decision_id
  ) throw failure('authority_changed');
  const d = value.receipt.decision;
  return Object.freeze({
    ownerId: value.owner_id,
    organizationId: value.organization_id,
    projectId: value.project_id,
    sourceId: value.document_id,
    decisionId: value.decision_id,
    receiptSha256: value.receipt_sha256,
    contentSha256: d.content_sha256,
    sourceRevision: d.source_revision,
    expectedPageCount: d.source_page_count,
    sourceGeneration: d.source_generation,
    sourceMetadataSha256: d.document_metadata_sha256,
    originalLocatorSha256: d.source_locator_sha256,
  });
}
async function hash(bytes: Uint8Array) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, '0')).join('');
}
function objectKey(
  owner: string,
  source: string,
  content: string,
  attempt: string,
) {
  if (
    !UUID.test(owner) || !SHA.test(source) || !SHA.test(content) ||
    !ATTEMPT.test(attempt)
  ) throw failure('invalid_input');
  return `v2-originals/${owner}/${source}/${content}/${attempt}.pdf`;
}
function target(
  method: 'POST' | 'GET',
  pins: Readonly<ECOSV2ManagedOriginalAuthorityPins>,
  sourceIdSha256: string,
  attemptId: string,
  body: Blob | null,
) {
  const key = objectKey(
    pins.ownerId,
    sourceIdSha256,
    pins.contentSha256,
    attemptId,
  );
  const request = Object.freeze({
    method,
    projectUrl: ECOS_V2_MANAGED_ORIGINAL_PROJECT_URL,
    bucket: ECOS_V2_MANAGED_ORIGINAL_BUCKET,
    ownerId: pins.ownerId,
    sourceIdSha256,
    contentSha256: pins.contentSha256,
    attemptId,
    objectKey: key,
    url:
      `${ECOS_V2_MANAGED_ORIGINAL_PROJECT_URL}/storage/v1/object/${ECOS_V2_MANAGED_ORIGINAL_BUCKET}/${key}`,
    upsert: false as const,
    body,
  });
  requests.add(request);
  return request;
}
function validateRequest(
  request: Readonly<ECOSV2ManagedOriginalStorageRequest>,
) {
  if (
    !request || !requests.has(request) || consumed.has(request) ||
    request.projectUrl !== ECOS_V2_MANAGED_ORIGINAL_PROJECT_URL ||
    request.bucket !== ECOS_V2_MANAGED_ORIGINAL_BUCKET ||
    request.objectKey !==
      objectKey(
        request.ownerId,
        request.sourceIdSha256,
        request.contentSha256,
        request.attemptId,
      ) ||
    request.url !==
      `${ECOS_V2_MANAGED_ORIGINAL_PROJECT_URL}/storage/v1/object/${ECOS_V2_MANAGED_ORIGINAL_BUCKET}/${request.objectKey}` ||
    request.upsert !== false ||
    (request.method === 'POST'
      ? !(request.body instanceof Blob) ||
        request.body.type !== 'application/pdf' || request.body.size < 1 ||
        request.body.size > ECOS_V2_MANAGED_ORIGINAL_MAX_BYTES
      : request.method !== 'GET' || request.body !== null)
  ) throw failure('invalid_input');
}

/** Optional real transport; constructing it makes no request. It never accepts
 * caller URLs/keys, follows redirects, reads credentials from the environment,
 * uses upsert, or exposes list/update/remove operations. The production bucket
 * ACL and immutable-object policy still require separate hosted verification. */
export function createECOSV2ManagedOriginalStorage(options: {
  apiKey: string;
  bearerToken: string;
  fetchImpl?: typeof fetch;
}): ECOSV2ManagedOriginalStorage {
  const v = dataObject(options, ['apiKey', 'bearerToken'], ['fetchImpl']);
  const apiKey = v.apiKey,
    bearerToken = v.bearerToken,
    fetchImpl = v.fetchImpl ?? fetch;
  if (
    typeof apiKey !== 'string' || !/^[!-~]{1,8192}$/.test(apiKey) ||
    typeof bearerToken !== 'string' || !/^[!-~]{1,8192}$/.test(bearerToken) ||
    typeof fetchImpl !== 'function'
  ) throw failure('invalid_input');
  return async (request, signal) => {
    validateRequest(request);
    if (signalIsAborted(signal)) throw failure('cancelled');
    consumed.add(request);
    const headers = new Headers({
      apikey: apiKey,
      Authorization: `Bearer ${bearerToken}`,
      'cache-control': 'no-store',
    });
    if (request.method === 'POST') {
      headers.set('content-type', 'application/pdf');
      headers.set('x-upsert', 'false');
    }
    return await fetchImpl(request.url, {
      method: request.method,
      headers,
      body: request.body,
      signal,
      redirect: 'error',
      cache: 'no-store',
      credentials: 'omit',
    });
  };
}

function discardResponse(response: unknown) {
  // Best effort only: cancellation itself may be noncooperative. Never read or
  // retain a discarded error body, and never delay completion for its cleanup.
  try {
    if (response instanceof Response) {
      void response.body?.cancel().catch(() => {});
    }
  } catch { /* Discard-only cleanup must not replace the original failure. */ }
}
function responseTarget(
  response: Response,
  request: Readonly<ECOSV2ManagedOriginalStorageRequest>,
) {
  if (
    !(response instanceof Response) || response.url !== request.url ||
    response.redirected ||
    response.type === 'opaqueredirect' ||
    response.status >= 300 && response.status < 400
  ) {
    throw failure('storage_protocol_mismatch');
  }
}
async function receiveResponse(
  storage: ECOSV2ManagedOriginalStorage,
  request: Readonly<ECOSV2ManagedOriginalStorageRequest>,
  signal: AbortSignal,
  check: () => void,
) {
  const response = await storage(request, signal);
  try {
    // This continuation still runs if the outer bounded operation has already
    // rejected. Cancel late POST and GET streams instead of abandoning them.
    check();
    responseTarget(response, request);
    return response;
  } catch (error) {
    discardResponse(response);
    throw error;
  }
}
async function readBytes(
  response: Response,
  max: number,
  check: () => void,
  signal: AbortSignal,
) {
  const length = response.headers.get('content-length');
  if (
    length !== null &&
    (!/^(0|[1-9][0-9]*)$/.test(length) || Number(length) > max)
  ) {
    discardResponse(response);
    throw failure('storage_protocol_mismatch');
  }
  if (!response.body) throw failure('storage_protocol_mismatch');
  const reader = response.body.getReader(), output = new Uint8Array(max);
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', cancel, { once: true });
  let offset = 0, ended = false;
  try {
    for (;;) {
      check();
      const part = await reader.read();
      check();
      if (part.done) {
        ended = true;
        break;
      }
      if (
        !(part.value instanceof Uint8Array) ||
        part.value.byteLength > max - offset
      ) throw failure('byte_mismatch');
      output.set(part.value, offset);
      offset += part.value.byteLength;
    }
    if (length !== null && Number(length) !== offset) {
      throw failure('storage_protocol_mismatch');
    }
    return output.subarray(0, offset);
  } finally {
    signal.removeEventListener('abort', cancel);
    if (!ended) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** In-memory verification library ONLY. Limit is per PDF, not total process
 * memory; copies may coexist. The 140 MiB architectural original is unsupported
 * and needs a separately implemented streaming/resumable path. Trusted parser
 * and authenticated recheck ports are mandatory; neither is simulated here.
 *
 * A failed/aborted operation may leave this exact object. No automatic new key,
 * delete, metadata mutation, persisted CAS, outbox, or enrollment is performed.
 * Reconcile an uncertain attempt explicitly with its SAME UUID and bytes.
 * Callback cancellation is requested, not proof that external work stopped. */
export function createECOSV2ManagedOriginalClient(
  options: ECOSV2ManagedOriginalPorts,
) {
  const v = dataObject(options, ['recheckAuthority', 'inspectPdf', 'storage'], [
    'maxBytes',
    'budgetMs',
    'operationTimeoutMs',
  ]);
  const recheck = v
    .recheckAuthority as ECOSV2ManagedOriginalPorts['recheckAuthority'];
  const inspect = v.inspectPdf as ECOSV2ManagedOriginalPorts['inspectPdf'];
  const storage = v.storage as ECOSV2ManagedOriginalStorage;
  if (
    typeof recheck !== 'function' || typeof inspect !== 'function' ||
    typeof storage !== 'function'
  ) throw failure('invalid_input');
  const maxBytes = bounded(
    v.maxBytes,
    ECOS_V2_MANAGED_ORIGINAL_MAX_BYTES,
    ECOS_V2_MANAGED_ORIGINAL_MAX_BYTES,
  );
  const budgetMs = bounded(v.budgetMs, 120_000, 120_000),
    operationMs = bounded(v.operationTimeoutMs, 30_000, 60_000);
  return async (
    input: {
      authority: Readonly<ECOSOwnerSourceAuthorityRead>;
      bytes: Uint8Array;
      attemptId: string;
      mode: 'upload' | 'reconcile_only';
    },
    runOptions: { signal?: AbortSignal } = {},
  ): Promise<Readonly<ECOSV2ManagedOriginalVerification>> => {
    const deadline = performance.now() + budgetMs;
    const p = dataObject(input, ['authority', 'bytes', 'attemptId', 'mode']),
      run = dataObject(runOptions, [], ['signal']);
    const signal =
      (run.signal === undefined
        ? new AbortController().signal
        : run.signal) as AbortSignal;
    if (signalIsAborted(signal)) throw failure('cancelled');
    const authority = p.authority as Readonly<ECOSOwnerSourceAuthorityRead>,
      pins = authorityPins(authority);
    if (
      !(p.bytes instanceof Uint8Array) ||
      Object.getPrototypeOf(p.bytes) !== Uint8Array.prototype ||
      !(p.bytes.buffer instanceof ArrayBuffer) || p.bytes.byteLength < 5 ||
      p.bytes.byteLength > maxBytes ||
      typeof p.attemptId !== 'string' || !ATTEMPT.test(p.attemptId) ||
      !['upload', 'reconcile_only'].includes(p.mode as string)
    ) throw failure('invalid_input');
    // Copy before first await; parser and transport cannot mutate this snapshot.
    const bytes = new Uint8Array(p.bytes), attemptId = p.attemptId;
    if (new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') {
      throw failure('pdf_rejected');
    }
    const check = () => {
      if (signalIsAborted(signal)) throw failure('cancelled');
      if (performance.now() >= deadline) throw failure('deadline_exceeded');
    };
    const call = async <T>(
      operation: (child: AbortSignal, check: () => void) => Promise<T>,
    ): Promise<T> => {
      check();
      const child = new AbortController(),
        due = Math.min(deadline, performance.now() + operationMs);
      let timer: ReturnType<typeof setTimeout>, stop: () => void = () => {};
      const checkChild = () => {
        check();
        if (child.signal.aborted || performance.now() >= due) {
          throw failure('operation_timeout');
        }
      };
      const stopped = new Promise<never>((_, reject) => {
        stop = () => {
          child.abort();
          reject(
            failure(
              signalIsAborted(signal)
                ? 'cancelled'
                : performance.now() >= deadline
                ? 'deadline_exceeded'
                : 'operation_timeout',
            ),
          );
        };
        EventTarget.prototype.addEventListener.call(signal, 'abort', stop, {
          once: true,
        });
        timer = setTimeout(stop, Math.max(1, due - performance.now()));
      });
      try {
        return await Promise.race([
          stopped,
          Promise.resolve().then(async () => {
            checkChild();
            const value = await operation(child.signal, checkChild);
            checkChild();
            return value;
          }),
        ]);
      } finally {
        clearTimeout(timer!);
        EventTarget.prototype.removeEventListener.call(signal, 'abort', stop);
        child.abort();
      }
    };
    const current = async () => {
      const value = await call((child) => recheck(pins, child));
      try {
        assertECOSOwnerSourceAuthorityRead(value);
      } catch {
        throw failure('authority_changed');
      }
      if (
        value.state !== 'current' || value.owner_id !== pins.ownerId ||
        value.organization_id !== pins.organizationId ||
        value.project_id !== pins.projectId ||
        value.document_id !== pins.sourceId ||
        value.decision_id !== pins.decisionId ||
        value.receipt_sha256 !== pins.receiptSha256 ||
        value.receipt_json !== authority.receipt_json
      ) throw failure('authority_changed');
    };
    try {
      await current();
      if (await call(() => hash(bytes)) !== pins.contentSha256) {
        throw failure('byte_mismatch');
      }
      const parsed = dataObject(
        await call((child) => inspect(new Uint8Array(bytes), child)),
        ['pageCount'],
      );
      const pageCount = bounded(parsed.pageCount, 0, 10000);
      if (pageCount !== pins.expectedPageCount) throw failure('pdf_rejected');
      const sourceIdSha256 = await call(() =>
        hash(encoder.encode(pins.sourceId))
      );
      const key = objectKey(
        pins.ownerId,
        sourceIdSha256,
        pins.contentSha256,
        attemptId,
      );
      let uploadOutcome: ECOSV2ManagedOriginalVerification['uploadOutcome'] =
        'reconciled_read_only';
      if (p.mode === 'upload') {
        await current();
        const request = target(
          'POST',
          pins,
          sourceIdSha256,
          attemptId,
          new Blob([bytes], { type: 'application/pdf' }),
        );
        try {
          uploadOutcome = await call(async (child, checkChild) => {
            const response = await receiveResponse(
              storage,
              request,
              child,
              checkChild,
            );
            if (
              response.status === 401 || response.status === 403 ||
              response.status === 413 || response.status === 429
            ) {
              discardResponse(response);
              throw failure('storage_rejected');
            }
            if ([400, 409].includes(response.status)) {
              discardResponse(response);
              return 'reconciled_existing' as const;
            }
            if (response.status === 408 || response.status >= 500) {
              discardResponse(response);
              return 'reconciled_uncertain' as const;
            }
            if (![200, 201].includes(response.status)) {
              discardResponse(response);
              throw failure('storage_rejected');
            }
            const raw = await readBytes(response, 8192, checkChild, child);
            let body: unknown;
            try {
              body = JSON.parse(
                new TextDecoder('utf-8', { fatal: true }).decode(raw),
              );
            } catch {
              throw failure('storage_unavailable');
            }
            const result = dataObject(body, ['Key'], ['Id']);
            if (
              result.Key !== `${ECOS_V2_MANAGED_ORIGINAL_BUCKET}/${key}` ||
              (result.Id !== undefined &&
                (typeof result.Id !== 'string' || !UUID.test(result.Id)))
            ) throw failure('storage_protocol_mismatch');
            return 'created' as const;
          });
        } catch (error) {
          check();
          if (
            error instanceof ECOSV2ManagedOriginalError &&
            !['storage_unavailable', 'operation_timeout'].includes(error.code)
          ) throw error;
          uploadOutcome = 'reconciled_uncertain';
        }
      }
      await current();
      const request = target('GET', pins, sourceIdSha256, attemptId, null);
      const downloaded = await call(async (child, checkChild) => {
        const response = await receiveResponse(
          storage,
          request,
          child,
          checkChild,
        );
        if (
          response.status !== 200 ||
          response.headers.get('content-type')?.split(';')[0].trim()
              .toLowerCase() !== 'application/pdf'
        ) {
          discardResponse(response);
          throw failure('storage_rejected');
        }
        return await readBytes(response, bytes.byteLength, checkChild, child);
      });
      if (
        downloaded.byteLength !== bytes.byteLength ||
        await call(() => hash(downloaded)) !== pins.contentSha256
      ) throw failure('byte_mismatch');
      // Same SHA binds the independent parser's page count to these GET bytes.
      await current();
      check();
      const result = Object.freeze({
        schemaVersion: 'ecos-managed-original-verification/2.0' as const,
        publicationMode: 'shadow' as const,
        authority: pins,
        projectUrl: ECOS_V2_MANAGED_ORIGINAL_PROJECT_URL,
        bucket: ECOS_V2_MANAGED_ORIGINAL_BUCKET,
        objectKey: key,
        attemptId,
        sourceIdSha256,
        contentSha256: pins.contentSha256,
        byteLength: bytes.byteLength,
        measuredPageCount: pageCount,
        uploadOutcome,
        verification:
          'exact_bytes_sha256_and_independent_pdf_page_count' as const,
        authorityCurrentness:
          'same_receipt_rechecked_before_and_after_storage' as const,
        storagePolicy:
          'hosted_immutability_and_private_bucket_policy_not_verified' as const,
        atomicSnapshot: false as const,
        persistentCas: 'not_performed' as const,
        enrollment: 'not_performed' as const,
        semanticEvidence: 'not_assessed' as const,
        retrievalAuthorized: false as const,
      });
      verified.add(result);
      return result;
    } catch (error) {
      if (error instanceof ECOSV2ManagedOriginalError) {
        throw failure(error.code);
      }
      throw failure('storage_unavailable');
    }
  };
}
export function assertECOSV2ManagedOriginalVerification(
  value: unknown,
): asserts value is ECOSV2ManagedOriginalVerification {
  if (!value || typeof value !== 'object' || !verified.has(value)) {
    throw failure('invalid_input');
  }
}
