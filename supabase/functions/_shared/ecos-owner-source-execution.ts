import {
  assertECOSOwnerSourceAuthorityRead,
  type ECOSOwnerSourceAuthorityRead,
} from './ecos-owner-source-authority.ts';
import {
  assertECOSManagedOriginalRead,
  type ECOSManagedOriginalRead,
} from './ecos-v2-managed-original-registry.ts';
import {
  assertECOSV2ManagedOriginalVerification,
  type ECOSV2ManagedOriginalVerification,
} from './ecos-v2-managed-original.ts';

/** Service-only control client. Inject the separate fixed-host execution RPC
 * transport in production; no credentials, environment reads or network default
 * exist here. No legacy jobs, checkpoints, original locators or answer path are
 * modified. A release is NOT extraction completion. Register records supplied
 * genuine byte verification, not proof a worker independently downloaded it. */
export interface ECOSOwnerExecutionRequest {
  schema_version: 'ecos-owner-source-execution-request/2.0';
  publication_mode: 'shadow';
  execution_id: string;
  request_id: string;
  owner_id: string;
  project_id: string;
  source_id: string;
  source_sha256: string;
  source_revision: string | null;
  source_page_count: number;
  extraction_version: 'ecos-owner-native-preview/2.0';
  authority_decision_id: string;
  authority_receipt_sha256: string;
  managed_attempt_id: string;
  managed_receipt_sha256: string;
  expected_previous_binding_id: string | null;
}
export type ECOSOwnerExecutionRPCName =
  | 'ecos_bind_owner_source_execution'
  | 'ecos_read_owner_source_execution'
  | 'ecos_claim_owner_source_execution'
  | 'ecos_register_owner_source_execution'
  | 'ecos_finish_owner_source_execution'
  | 'ecos_cancel_owner_source_execution';
export type ECOSOwnerExecutionRPC = (
  name: ECOSOwnerExecutionRPCName,
  parameters: Readonly<Record<string, unknown>>,
  signal: AbortSignal,
) => Promise<unknown>;
type Action = 'bind' | 'read' | 'claim' | 'register' | 'finish' | 'cancel';
export type ECOSOwnerExecutionState =
  | 'missing'
  | 'stale'
  | 'queued'
  | 'running'
  | 'released'
  | 'failed'
  | 'cancelled'
  | 'expired'
  | 'currentness_not_asserted';
export interface ECOSOwnerExecutionClaim {
  claim_id: string;
  claimed_at: string;
  expires_at: string;
  status: 'active' | 'released' | 'failed' | 'cancelled' | 'expired';
  binding_id: string;
  measurement_json: string | null;
  measurement_sha256: string | null;
  registered_at: string | null;
}
export interface ECOSOwnerExecutionSource {
  source_sha256: string;
  source_revision: string | null;
  source_page_count: number;
  byte_length: number;
  bucket: string;
  object_key: string;
  managed_attempt_id: string;
  managed_receipt_sha256: string;
  verification:
    'trusted_service_attested_storage_readback_not_current_download_proof';
}
export interface ECOSOwnerExecutionResult {
  schema_version: 'ecos-owner-source-execution-control/2.0';
  publication_mode: 'shadow';
  execution_kind: 'owner_preview';
  execution_id: string;
  owner_id: string;
  organization_id: string;
  project_id: string;
  source_id: string | null;
  source_sha256: string | null;
  source_revision: string | null;
  source_page_count: number | null;
  extraction_version: string | null;
  binding_id: string | null;
  binding_version: number | null;
  affected_binding_id: string | null;
  outcome: string;
  state: ECOSOwnerExecutionState;
  claim: Readonly<ECOSOwnerExecutionClaim> | null;
  source: Readonly<ECOSOwnerExecutionSource> | null;
  native_readiness: 'not_assessed';
  retrieval_authorized: false;
  binding_matches_request: boolean;
  verification: 'execution_control_only_not_native_completion';
}
const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const encoder = new TextEncoder();
const resultKeys = [
  'schema_version',
  'publication_mode',
  'execution_kind',
  'execution_id',
  'owner_id',
  'organization_id',
  'project_id',
  'source_id',
  'source_sha256',
  'source_revision',
  'source_page_count',
  'extraction_version',
  'binding_id',
  'binding_version',
  'affected_binding_id',
  'outcome',
  'state',
  'claim',
  'source',
  'native_readiness',
  'retrieval_authorized',
];
const claimKeys = [
  'claim_id',
  'claimed_at',
  'expires_at',
  'status',
  'binding_id',
  'measurement_json',
  'measurement_sha256',
  'registered_at',
];
const sourceKeys = [
  'source_sha256',
  'source_revision',
  'source_page_count',
  'byte_length',
  'bucket',
  'object_key',
  'managed_attempt_id',
  'managed_receipt_sha256',
  'verification',
];
const names: Record<Action, ECOSOwnerExecutionRPCName> = {
  bind: 'ecos_bind_owner_source_execution',
  read: 'ecos_read_owner_source_execution',
  claim: 'ecos_claim_owner_source_execution',
  register: 'ecos_register_owner_source_execution',
  finish: 'ecos_finish_owner_source_execution',
  cancel: 'ecos_cancel_owner_source_execution',
};
const requests = new WeakMap<
  object,
  {
    authority: Readonly<ECOSOwnerSourceAuthorityRead>;
    managed: Readonly<ECOSManagedOriginalRead>;
  }
>();
const results = new WeakMap<
  object,
  {
    request: Readonly<ECOSOwnerExecutionRequest>;
    action: Action;
    claimId: string | null;
    expires: number | null;
  }
>();
const fail = () => {
  throw new Error('Owner execution control rejected');
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
function id(value: unknown) {
  if (typeof value !== 'string' || !UUID.test(value)) return fail();
  return value;
}
function integer(value: unknown, min: number, max: number) {
  if (
    typeof value !== 'number' || !Number.isSafeInteger(value) || value < min ||
    value > max
  ) return fail();
  return value;
}
function rawText(value: unknown, max: number) {
  if (
    typeof value !== 'string' || value.length > max ||
    encoder.encode(value).length > max
  ) return fail();
  return value;
}
function timestamp(value: unknown) {
  const raw = rawText(value, 32);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(
      raw,
    )
  ) return fail();
  const n = Date.parse(raw);
  if (
    !Number.isFinite(n) ||
    new Date(n).toISOString().slice(0, 19) !== raw.slice(0, 19)
  ) return fail();
  return n;
}
async function digest(value: string) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest('SHA-256', encoder.encode(value)),
    ),
  ].map((v) => v.toString(16).padStart(2, '0')).join('');
}
export function prepareECOSOwnerExecutionRequest(
  authority: Readonly<ECOSOwnerSourceAuthorityRead>,
  managed: Readonly<ECOSManagedOriginalRead>,
  options: {
    executionId: string;
    requestId: string;
    expectedPreviousBindingId: string | null;
  },
): Readonly<ECOSOwnerExecutionRequest> {
  assertECOSOwnerSourceAuthorityRead(authority);
  assertECOSManagedOriginalRead(managed, authority);
  if (
    authority.state !== 'current' || managed.state !== 'current' ||
    !managed.receipt || !managed.receipt_sha256 || !managed.attempt_id
  ) return fail();
  const o = object(options, [
    'executionId',
    'requestId',
    'expectedPreviousBindingId',
  ]);
  id(o.executionId);
  id(o.requestId);
  if (o.expectedPreviousBindingId !== null) id(o.expectedPreviousBindingId);
  if (o.requestId === o.expectedPreviousBindingId) return fail();
  const a = managed.receipt.attestation;
  const request = Object.freeze({
    schema_version: 'ecos-owner-source-execution-request/2.0',
    publication_mode: 'shadow',
    execution_id: o.executionId,
    request_id: o.requestId,
    owner_id: authority.owner_id,
    project_id: authority.project_id,
    source_id: authority.document_id,
    source_sha256: a.content_sha256,
    source_revision: a.source_revision,
    source_page_count: a.measured_page_count,
    extraction_version: 'ecos-owner-native-preview/2.0',
    authority_decision_id: a.authority_decision_id,
    authority_receipt_sha256: a.authority_receipt_sha256,
    managed_attempt_id: managed.attempt_id,
    managed_receipt_sha256: managed.receipt_sha256,
    expected_previous_binding_id: o.expectedPreviousBindingId,
  }) as Readonly<ECOSOwnerExecutionRequest>;
  requests.set(request, { authority, managed });
  return request;
}
export function assertECOSOwnerExecutionRequest(
  value: unknown,
): asserts value is Readonly<ECOSOwnerExecutionRequest> {
  if (!value || typeof value !== 'object' || !requests.has(value)) fail();
}
export function assertECOSOwnerExecutionResult(
  value: unknown,
  request: Readonly<ECOSOwnerExecutionRequest>,
): asserts value is Readonly<ECOSOwnerExecutionResult> {
  assertECOSOwnerExecutionRequest(request);
  if (
    !value || typeof value !== 'object' ||
    results.get(value)?.request !== request
  ) fail();
}
async function bindResult(
  raw: unknown,
  request: Readonly<ECOSOwnerExecutionRequest>,
  action: Action,
  claimId: string | null,
) {
  const v = object(raw, resultKeys),
    claim = v.claim === null ? null : object(v.claim, claimKeys),
    source = v.source === null ? null : object(v.source, sourceKeys);
  if (
    v.schema_version !== 'ecos-owner-source-execution-control/2.0' ||
    v.publication_mode !== 'shadow' || v.execution_kind !== 'owner_preview' ||
    v.native_readiness !== 'not_assessed' || v.retrieval_authorized !== false ||
    v.execution_id !== request.execution_id ||
    v.owner_id !== request.owner_id || v.organization_id !== request.owner_id ||
    v.project_id !== request.project_id ||
    v.affected_binding_id !== (action === 'read' ? null : request.request_id)
  ) return fail();
  const allowed: Record<Action, readonly string[]> = {
    bind: ['bound', 'already_bound', 'cancelled'],
    read: ['read'],
    claim: ['claimed', 'already_claimed', 'cancelled'],
    register: ['registered', 'already_registered', 'cancelled'],
    finish: ['finished', 'finished_before_claim', 'already_finished'],
    cancel: ['cancelled', 'already_cancelled'],
  };
  if (
    typeof v.outcome !== 'string' || !allowed[action].includes(v.outcome) ||
    ![
      'missing',
      'stale',
      'queued',
      'running',
      'released',
      'failed',
      'cancelled',
      'expired',
      'currentness_not_asserted',
    ].includes(v.state as string)
  ) return fail();
  const absent = v.source_id === null;
  if (absent) {
    if (
      !((action === 'read' && v.state === 'missing') ||
        (['bind', 'cancel'].includes(action) && v.state === 'cancelled')) ||
      [
        'source_sha256',
        'source_revision',
        'source_page_count',
        'extraction_version',
        'binding_id',
        'binding_version',
      ].some((k) => v[k] !== null) || claim || source
    ) return fail();
  } else {
    if (
      v.source_id !== request.source_id ||
      v.source_sha256 !== request.source_sha256 ||
      v.source_revision !== request.source_revision ||
      v.source_page_count !== request.source_page_count ||
      v.extraction_version !== request.extraction_version
    ) return fail();
    id(v.binding_id);
    integer(v.binding_version, 1, 100);
  }
  const matches = v.binding_id === request.request_id;
  if (
    (action === 'bind' && v.outcome === 'bound') ||
    ['claim', 'register', 'read'].includes(action)
  ) {
    if (!absent && !matches) return fail();
  }
  if (action === 'bind') {
    if (
      v.outcome === 'bound' && (v.state !== 'queued' || !source || claim ||
        (v.binding_version === 1) !==
          (request.expected_previous_binding_id === null))
    ) {
      return fail();
    }
    if (
      v.outcome === 'already_bound' &&
      (!['currentness_not_asserted', 'cancelled'].includes(v.state as string) ||
        source || claim)
    ) return fail();
    if (
      v.outcome === 'cancelled' &&
      (!['cancelled', 'currentness_not_asserted'].includes(v.state as string) ||
        source || claim)
    ) return fail();
  }
  if (
    action === 'finish' &&
    (v.state !== 'currentness_not_asserted' || claim || source)
  ) return fail();
  if (
    action === 'cancel' &&
    (!['currentness_not_asserted', 'cancelled'].includes(v.state as string) ||
      claim || source)
  ) return fail();
  if (action === 'read') {
    if (
      claim || v.state === 'currentness_not_asserted' ||
      (['missing', 'stale'].includes(v.state as string) && source) ||
      (['queued', 'running', 'expired', 'released', 'failed'].includes(
        v.state as string,
      ) && !source)
    ) return fail();
  }
  if (['claim', 'register'].includes(action)) {
    if (v.outcome === 'cancelled') {
      if (v.state !== 'cancelled' || source || claim) {
        return fail();
      }
    } else if (
      !claim ||
      (['registered', 'already_registered'].includes(v.outcome as string) &&
        v.state !== 'running')
    ) return fail();
  } else if (claim) return fail();
  const managed = requests.get(request)!.managed.receipt!.attestation;
  if (source) {
    if (
      source.source_sha256 !== request.source_sha256 ||
      source.source_revision !== request.source_revision ||
      source.source_page_count !== request.source_page_count ||
      source.byte_length !== managed.byte_length ||
      source.bucket !== managed.bucket ||
      source.object_key !== managed.object_key ||
      source.managed_attempt_id !== request.managed_attempt_id ||
      source.managed_receipt_sha256 !== request.managed_receipt_sha256 ||
      source.verification !==
        'trusted_service_attested_storage_readback_not_current_download_proof'
    ) return fail();
  }
  let expires: number | null = null;
  if (claim) {
    if (
      claim.claim_id !== claimId || claim.binding_id !== request.request_id ||
      !['active', 'released', 'failed', 'cancelled', 'expired'].includes(
        claim.status as string,
      )
    ) return fail();
    const started = timestamp(claim.claimed_at),
      ended = timestamp(claim.expires_at);
    if (ended - started !== 120000) return fail();
    if (claim.status === 'active') {
      if (v.state !== 'running' || !source || ended <= Date.now()) {
        return fail();
      }
      expires = performance.now() + Math.min(120000, ended - Date.now());
    } else if (v.state !== claim.status || source) return fail();
    if (claim.measurement_json === null) {
      if (
        claim.measurement_sha256 !== null || claim.registered_at !== null ||
        action === 'register'
      ) return fail();
    } else {
      const text = rawText(claim.measurement_json, 1024);
      if (
        typeof claim.measurement_sha256 !== 'string' ||
        !SHA.test(claim.measurement_sha256) || claim.registered_at === null
      ) return fail();
      const registered = timestamp(claim.registered_at);
      if (registered < started || registered >= ended) return fail();
      const m = object(JSON.parse(text), [
        'source_sha256',
        'source_page_count',
        'byte_length',
      ]);
      // Reject decimal/exponent/duplicate numeric tokens before their JS values
      // can round into the expected measurement. Wire is a flat SQL JSON object.
      const tokens = text.match(/"(?:[^"\\]|\\.)*"|[^\s{},:]+/g);
      if (
        !tokens || tokens.length !== 6 || tokens.some((token, i) =>
          i % 2 === 1 && token[0] !== '"' && !/^[1-9][0-9]*$/.test(token)
        ) ||
        new Set(
            tokens.filter((_, i) =>
              i % 2 === 0
            ).map((t) => JSON.parse(t)),
          )
            .size !== 3 ||
        m.source_sha256 !== request.source_sha256 ||
        m.source_page_count !== request.source_page_count ||
        m.byte_length !== managed.byte_length ||
        await digest(text) !== claim.measurement_sha256
      ) return fail();
    }
  }
  const result = Object.freeze({
    ...v,
    claim: claim && Object.freeze(claim),
    source: source && Object.freeze(source),
    binding_matches_request: matches,
    verification: 'execution_control_only_not_native_completion',
  }) as unknown as Readonly<ECOSOwnerExecutionResult>;
  results.set(result, { request, action, claimId, expires });
  return result;
}
const faults = new WeakSet<object>();
export class ECOSOwnerExecutionError extends Error {
  readonly code:
    | 'invalid_request'
    | 'cancelled'
    | 'deadline_exceeded'
    | 'operation_failed';
  readonly mayHaveCommitted = true;
  readonly externalOperationStopped = false;
  readonly recovery = 'read_or_retry_the_same_execution_binding_and_claim_ids';
  constructor(
    code:
      | 'invalid_request'
      | 'cancelled'
      | 'deadline_exceeded'
      | 'operation_failed',
  ) {
    super('Owner execution operation not confirmed');
    this.name = 'ECOSOwnerExecutionError';
    this.code =
      ['invalid_request', 'cancelled', 'deadline_exceeded', 'operation_failed']
          .includes(code)
        ? code
        : 'operation_failed';
    faults.add(this);
    Object.freeze(this);
  }
}
const aborted = Object.getOwnPropertyDescriptor(
  AbortSignal.prototype,
  'aborted',
)!.get!;
export function createECOSOwnerExecutionClient(
  options: { rpc: ECOSOwnerExecutionRPC; timeoutMs?: number },
) {
  const o = object(options, ['rpc'], ['timeoutMs']);
  if (typeof o.rpc !== 'function') return fail();
  const rpc = o.rpc as ECOSOwnerExecutionRPC,
    timeout = integer(o.timeoutMs ?? 10000, 1, 25000);
  const send = async (
    request: Readonly<ECOSOwnerExecutionRequest>,
    action: Action,
    claimId: string | null,
    extra: Readonly<Record<string, unknown>>,
    run: { signal?: AbortSignal } = {},
  ) => {
    let signal: AbortSignal;
    try {
      assertECOSOwnerExecutionRequest(request);
      const v = object(run, [], ['signal']);
      signal = (v.signal ?? new AbortController().signal) as AbortSignal;
      if (v.signal === null) return fail();
      aborted.call(signal);
      if (claimId !== null) id(claimId);
    } catch {
      throw new ECOSOwnerExecutionError('invalid_request');
    }
    const due = performance.now() + timeout, child = new AbortController();
    const check = () => {
      if (aborted.call(signal)) throw new ECOSOwnerExecutionError('cancelled');
      if (performance.now() >= due || child.signal.aborted) {
        throw new ECOSOwnerExecutionError('deadline_exceeded');
      }
    };
    let timer: ReturnType<typeof setTimeout> | undefined,
      stop: () => void = () => {};
    const parameters = Object.freeze(
      action === 'bind' ? { p_request: request } : {
        p_owner_id: request.owner_id,
        p_project_id: request.project_id,
        p_execution_id: request.execution_id,
        ...(action === 'read' ? {} : { p_binding_id: request.request_id }),
        ...(claimId === null ? {} : { p_claim_id: claimId }),
        ...extra,
      },
    );
    try {
      check();
      const abortedPromise = new Promise<never>((_, reject) => {
        stop = () => {
          child.abort();
          reject(
            new ECOSOwnerExecutionError(
              aborted.call(signal) ? 'cancelled' : 'deadline_exceeded',
            ),
          );
        };
        EventTarget.prototype.addEventListener.call(signal, 'abort', stop, {
          once: true,
        });
        timer = setTimeout(stop, Math.max(1, due - performance.now()));
      });
      return await Promise.race([
        abortedPromise,
        Promise.resolve().then(async () => {
          check();
          const raw = await rpc(names[action], parameters, child.signal);
          check();
          const result = await bindResult(raw, request, action, claimId);
          check();
          return result;
        }),
      ]);
    } catch (error) {
      if (error !== null && typeof error === 'object' && faults.has(error)) {
        throw new ECOSOwnerExecutionError(
          (error as ECOSOwnerExecutionError).code,
        );
      }
      throw new ECOSOwnerExecutionError('operation_failed');
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      EventTarget.prototype.removeEventListener.call(signal, 'abort', stop);
      child.abort();
    }
  };
  return Object.freeze({
    bind: (
      request: Readonly<ECOSOwnerExecutionRequest>,
      run?: { signal?: AbortSignal },
    ) => send(request, 'bind', null, {}, run),
    read: (
      request: Readonly<ECOSOwnerExecutionRequest>,
      run?: { signal?: AbortSignal },
    ) => send(request, 'read', null, {}, run),
    claim: (
      request: Readonly<ECOSOwnerExecutionRequest>,
      claimId: string,
      run?: { signal?: AbortSignal },
    ) => send(request, 'claim', claimId, {}, run),
    register: (
      claim: Readonly<ECOSOwnerExecutionResult>,
      verification: Readonly<ECOSV2ManagedOriginalVerification>,
      run?: { signal?: AbortSignal },
    ) => {
      const c = results.get(claim);
      if (
        !c || !['claim', 'register'].includes(c.action) || !c.claimId ||
        c.expires === null || performance.now() >= c.expires ||
        claim.state !== 'running'
      ) return fail();
      assertECOSV2ManagedOriginalVerification(verification);
      const r = c.request,
        a = verification.authority,
        managed = requests.get(r)!.managed.receipt!.attestation;
      if (
        a.ownerId !== r.owner_id || a.organizationId !== r.owner_id ||
        a.projectId !== r.project_id || a.sourceId !== r.source_id ||
        a.decisionId !== r.authority_decision_id ||
        a.receiptSha256 !== r.authority_receipt_sha256 ||
        verification.attemptId !== r.managed_attempt_id ||
        verification.contentSha256 !== r.source_sha256 ||
        verification.measuredPageCount !== r.source_page_count ||
        verification.byteLength !== managed.byte_length ||
        verification.objectKey !== managed.object_key
      ) return fail();
      return send(r, 'register', c.claimId, {
        p_measurement: Object.freeze({
          source_sha256: verification.contentSha256,
          source_page_count: verification.measuredPageCount,
          byte_length: verification.byteLength,
        }),
      }, run);
    },
    finish: (
      request: Readonly<ECOSOwnerExecutionRequest>,
      claimId: string,
      status: 'released' | 'failed' | 'cancelled',
      run?: { signal?: AbortSignal },
    ) => {
      if (!['released', 'failed', 'cancelled'].includes(status)) return fail();
      return send(request, 'finish', claimId, { p_status: status }, run);
    },
    cancel: (
      request: Readonly<ECOSOwnerExecutionRequest>,
      run?: { signal?: AbortSignal },
    ) => send(request, 'cancel', null, {}, run),
  });
}
