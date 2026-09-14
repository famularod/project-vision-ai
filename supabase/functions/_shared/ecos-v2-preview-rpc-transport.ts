import type { ECOSQuestionEvidenceRPC } from "./ecos-question-evidence-coordinator.ts";
import type { ECOSV2OwnerPreviewLedgerRPC } from "./ecos-v2-owner-preview-admission.ts";
import type { ECOSV2PreviewScope } from "./ecos-v2-preview-handler.ts";
import type { ECOSLinkedOwnerProjectDocumentIndexesRPC } from "./ecos-linked-owner-project-document-indexes-loader.ts";
import type { ECOSOwnerPageSearchRPC } from "./ecos-owner-page-search.ts";

export const ECOS_V2_PREVIEW_RPC_PROJECT_URL =
  "https://xdytqlpsqsseoeuxgzre.supabase.co";
export type ECOSV2OwnerInventoryRPC = (
  name: "ecos_list_linked_owner_project_document_inventory",
  parameters: Readonly<Record<string, string | number | null>>,
  signal: AbortSignal,
) => Promise<unknown>;
type ReadName =
  | Parameters<ECOSQuestionEvidenceRPC>[0]
  | Parameters<ECOSV2OwnerInventoryRPC>[0];
type LedgerName = Parameters<ECOSV2OwnerPreviewLedgerRPC>[0];
type RPCName = ReadName | LedgerName;
const READS: readonly string[] = [
  "ecos_list_linked_project_document_inventory",
  "ecos_resolve_linked_project_document_indexes",
  "ecos_list_project_record_inventory",
  "ecos_load_linked_manifest_table_source",
  "ecos_search_linked_native_page_sources",
];
const OWNER_READ = "ecos_list_linked_owner_project_document_inventory";
const LEDGER: readonly string[] = [
  "ecos_admit_owner_preview",
  "ecos_charge_owner_preview_stage",
  "ecos_finish_owner_preview",
];
const EXECUTION = [
  "ecos_bind_owner_source_execution",
  "ecos_claim_owner_source_execution",
  "ecos_register_owner_source_execution",
  "ecos_finish_owner_source_execution",
  "ecos_cancel_owner_source_execution",
  "ecos_read_owner_source_execution",
] as const;
export type ECOSV2OwnerExecutionRPC = (
  name: typeof EXECUTION[number],
  parameters: Readonly<Record<string, unknown>>,
  signal: AbortSignal,
) => Promise<unknown>;
const OWNER_EVIDENCE_READS = [
  "ecos_resolve_linked_owner_project_document_indexes",
  "ecos_read_owner_page_observations",
  "ecos_read_owner_source_execution",
] as const;
export type ECOSV2OwnerEvidenceRPC = (
  name: typeof OWNER_EVIDENCE_READS[number],
  parameters: Readonly<Record<string, string | number | null>>,
  signal: AbortSignal,
) => Promise<unknown>;
export type ECOSV2OwnerRasterReadRPC = (
  name: "ecos_read_owner_page_raster",
  parameters: Readonly<Record<string, string | number | null>>,
  signal: AbortSignal,
) => Promise<unknown>;
export interface ECOSV2ServerRPCTransportOptions {
  serviceRoleKey: string;
  scope: ECOSV2PreviewScope;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}
const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const encoder = new TextEncoder();
const aborted = Object.getOwnPropertyDescriptor(
  AbortSignal.prototype,
  "aborted",
)!.get!;
const addEvent = EventTarget.prototype.addEventListener;
const removeEvent = EventTarget.prototype.removeEventListener;
type Params = Readonly<Record<string, string | number | null>>;
type ErrorCode =
  | "invalid_configuration"
  | "invalid_request"
  | "cancelled"
  | "deadline_exceeded"
  | "unavailable"
  | "response_rejected";

/** Fixed categories only. Cancellation is not proof that a database operation
 * stopped; uncertain ledger writes must be reconciled by the admission adapter. */
export class ECOSV2PreviewRPCError extends Error {
  readonly externalOperationStopped = false;
  constructor(readonly code: ErrorCode) {
    super(`Preview RPC ${code}`);
    this.name = "ECOSV2PreviewRPCError";
    Object.freeze(this);
  }
}
const fail = (code: ErrorCode) => new ECOSV2PreviewRPCError(code);

function object(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
) {
  if (
    !value || typeof value !== "object" ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw fail("invalid_request");
  }
  const keys = Reflect.ownKeys(value),
    entries = Object.getOwnPropertyDescriptors(value);
  if (
    keys.some((key) =>
      typeof key !== "string" || ![...required, ...optional].includes(key)
    ) ||
    required.some((key) => !Object.hasOwn(entries, key)) ||
    Object.values(entries).some((d) =>
      !d.enumerable || !Object.hasOwn(d, "value")
    )
  ) {
    throw fail("invalid_request");
  }
  return Object.fromEntries(
    Object.entries(entries).map(([key, d]) => [key, d.value]),
  ) as Record<string, unknown>;
}
function text(value: unknown, max: number, query = false): value is string {
  if (
    typeof value !== "string" || !value.trim() || value.length > max ||
    encoder.encode(value).length > max
  ) return false;
  if (!query && value !== value.trim()) return false;
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (
      (code <= 31 && !(query && [9, 10, 13].includes(code))) ||
      code >= 127 && code <= 159 || code >= 0xd800 && code <= 0xdfff
    ) return false;
  }
  return true;
}
const uuid = (value: unknown) => typeof value === "string" && UUID.test(value);
const sha = (value: unknown) => typeof value === "string" && SHA.test(value);
const integer = (value: unknown, max: number) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 1 &&
  value <= max;
const optional = (value: unknown, check: (v: unknown) => boolean) =>
  value === null || check(value);
function isAborted(signal: unknown): boolean {
  try {
    return aborted.call(signal);
  } catch {
    throw fail("invalid_request");
  }
}
function scopeCopy(input: unknown): Readonly<ECOSV2PreviewScope> {
  const s = object(input, ["organizationId", "projectId", "ownerId"]);
  if (
    !uuid(s.ownerId) || !uuid(s.projectId) || s.organizationId !== s.ownerId
  ) throw fail("invalid_configuration");
  return Object.freeze(s) as unknown as Readonly<ECOSV2PreviewScope>;
}
function bindParameters(
  name: RPCName,
  raw: unknown,
  scope: Readonly<ECOSV2PreviewScope>,
): Params {
  const ledger = LEDGER.includes(name);
  const common = ledger
    ? ["p_owner_id", "p_project_id", "p_request_id", "p_request_sha256"]
    : ["p_owner_id", "p_project_id", "p_organization_id"];
  let fields: string[];
  if (ledger) {
    fields = name === "ecos_charge_owner_preview_stage"
      ? ["p_stage"]
      : name === "ecos_finish_owner_preview"
      ? ["p_status"]
      : [];
  } else if (name === "ecos_search_linked_native_page_sources") {
    fields = [
      "p_expected_inventory_epoch",
      "p_query",
      "p_expected_search_epoch",
      "p_limit",
    ];
  } else if (name === "ecos_load_linked_manifest_table_source") {
    fields = [
      "p_expected_epoch",
      "p_after_source_id",
      "p_source_id",
      "p_job_id",
      "p_manifest_id",
      "p_manifest_sha256",
      "p_page_number",
      "p_expected_projection_id",
      "p_expected_projection_sha256",
    ];
  } else {fields = [
      "p_expected_epoch",
      name === "ecos_list_project_record_inventory"
        ? "p_after_source_key"
        : "p_after_source_id",
      "p_limit",
    ];}
  const p = object(raw, [...common, ...fields]);
  if (
    p.p_owner_id !== scope.ownerId || p.p_project_id !== scope.projectId ||
    (!ledger && p.p_organization_id !== scope.organizationId)
  ) throw fail("invalid_request");
  if (ledger) {
    if (
      !uuid(p.p_request_id) || !sha(p.p_request_sha256) ||
      (name === "ecos_charge_owner_preview_stage" &&
        !["interpret", "plan", "compose", "verify"].includes(
          p.p_stage as string,
        )) ||
      (name === "ecos_finish_owner_preview" &&
        !["completed", "failed"].includes(p.p_status as string))
    ) throw fail("invalid_request");
  } else if (name === "ecos_search_linked_native_page_sources") {
    if (
      !sha(p.p_expected_inventory_epoch) ||
      !optional(p.p_expected_search_epoch, sha) ||
      !integer(p.p_limit, 8) || !text(p.p_query, 16 * 1024, true) ||
      [...p.p_query].length > 4000
    ) throw fail("invalid_request");
  } else if (name === "ecos_load_linked_manifest_table_source") {
    if (
      !sha(p.p_expected_epoch) || !optional(p.p_after_source_id, (v) =>
        text(v, 300)) ||
      !text(p.p_source_id, 300) ||
      !uuid(p.p_job_id) || !uuid(p.p_manifest_id) ||
      !sha(p.p_manifest_sha256) || !integer(p.p_page_number, 10000) ||
      !uuid(p.p_expected_projection_id) || !sha(p.p_expected_projection_sha256)
    ) throw fail("invalid_request");
  } else {
    const record = name === "ecos_list_project_record_inventory";
    const cursor = record ? p.p_after_source_key : p.p_after_source_id;
    const validCursor = (v: unknown) => {
      if (!record) return text(v, 300);
      if (typeof v !== "string") return false;
      const m = /^(?:schedule_item|field_note):(.*)$/s.exec(v);
      return !!m && text(m[1], 300);
    };
    if (
      !integer(p.p_limit, record ? 16 : 25) || !optional(cursor, validCursor) ||
      (name === "ecos_resolve_linked_project_document_indexes"
        ? !sha(p.p_expected_epoch)
        : !optional(p.p_expected_epoch, sha))
    ) throw fail("invalid_request");
  }
  const result = Object.freeze(p) as Params;
  if (encoder.encode(JSON.stringify(result)).length > 32 * 1024) {
    throw fail("invalid_request");
  }
  return result;
}
function bindExecutionParameters(
  name: string,
  raw: unknown,
  scope: Readonly<ECOSV2PreviewScope>,
): Readonly<Record<string, unknown>> {
  let result: Record<string, unknown>;
  if (name === "ecos_bind_owner_source_execution") {
    const outer = object(raw, ["p_request"]);
    const request = object(outer.p_request, [
      "schema_version",
      "publication_mode",
      "execution_id",
      "request_id",
      "owner_id",
      "project_id",
      "source_id",
      "source_sha256",
      "source_revision",
      "source_page_count",
      "extraction_version",
      "authority_decision_id",
      "authority_receipt_sha256",
      "managed_attempt_id",
      "managed_receipt_sha256",
      "expected_previous_binding_id",
    ]);
    if (
      request.schema_version !== "ecos-owner-source-execution-request/2.0" ||
      request.publication_mode !== "shadow" ||
      request.extraction_version !== "ecos-owner-native-preview/2.0" ||
      request.owner_id !== scope.ownerId ||
      request.project_id !== scope.projectId ||
      ![
        "execution_id",
        "request_id",
        "authority_decision_id",
        "managed_attempt_id",
      ].every((k) => uuid(request[k])) ||
      !["source_sha256", "authority_receipt_sha256", "managed_receipt_sha256"]
        .every((k) => sha(request[k])) ||
      !optional(request.expected_previous_binding_id, uuid) ||
      !text(request.source_id, 300) || !optional(request.source_revision, (v) =>
        text(v, 300)) ||
      !integer(request.source_page_count, 10000) ||
      encoder.encode(JSON.stringify(request)).length > 16384
    ) throw fail("invalid_request");
    result = { p_request: Object.freeze(request) };
  } else {
    const common = ["p_owner_id", "p_project_id", "p_execution_id"];
    const fields = name === "ecos_read_owner_source_execution"
      ? []
      : name === "ecos_cancel_owner_source_execution"
      ? ["p_binding_id"]
      : [
        "p_binding_id",
        "p_claim_id",
        ...(name === "ecos_register_owner_source_execution"
          ? ["p_measurement"]
          : name === "ecos_finish_owner_source_execution"
          ? ["p_status"]
          : []),
      ];
    result = object(raw, [...common, ...fields]);
    if (
      result.p_owner_id !== scope.ownerId ||
      result.p_project_id !== scope.projectId ||
      !uuid(result.p_execution_id) ||
      (fields.includes("p_binding_id") && !uuid(result.p_binding_id)) ||
      (fields.includes("p_claim_id") && !uuid(result.p_claim_id))
    ) {
      throw fail("invalid_request");
    }
    if (
      name === "ecos_finish_owner_source_execution" &&
      !["released", "failed", "cancelled"].includes(result.p_status as string)
    ) {
      throw fail("invalid_request");
    }
    if (name === "ecos_register_owner_source_execution") {
      const measurement = object(result.p_measurement, [
        "source_sha256",
        "source_page_count",
        "byte_length",
      ]);
      if (
        !sha(measurement.source_sha256) ||
        !integer(measurement.source_page_count, 10000) ||
        !integer(measurement.byte_length, 64 * 1024 * 1024) ||
        (measurement.byte_length as number) < 5
      ) {
        throw fail("invalid_request");
      }
      result.p_measurement = Object.freeze(measurement);
    }
  }
  if (encoder.encode(JSON.stringify(result)).length > 32 * 1024) {
    throw fail("invalid_request");
  }
  return Object.freeze(result);
}

function bindOwnerEvidenceParameters(
  name: typeof OWNER_EVIDENCE_READS[number],
  raw: unknown,
  scope: Readonly<ECOSV2PreviewScope>,
): Params {
  if (name === "ecos_read_owner_source_execution") {
    return bindExecutionParameters(name, raw, scope) as Params;
  }
  const index = name === "ecos_resolve_linked_owner_project_document_indexes";
  const p = object(raw, [
    "p_owner_id",
    "p_project_id",
    ...(index
      ? [
        "p_organization_id",
        "p_expected_inventory_epoch",
        "p_expected_index_epoch",
        "p_after_ordinal",
        "p_limit",
      ]
      : [
        "p_execution_id",
        "p_binding_id",
        "p_page_number",
        "p_expected_attempt_id",
      ]),
  ]);
  if (p.p_owner_id !== scope.ownerId || p.p_project_id !== scope.projectId) {
    throw fail("invalid_request");
  }
  if (index) {
    if (
      p.p_organization_id !== scope.organizationId ||
      !sha(p.p_expected_inventory_epoch) ||
      !optional(p.p_expected_index_epoch, sha) || !integer(p.p_limit, 128) ||
      typeof p.p_after_ordinal !== "number" ||
      !Number.isSafeInteger(p.p_after_ordinal) ||
      p.p_after_ordinal < 0 || p.p_after_ordinal > 20600 ||
      (p.p_after_ordinal > 0 && p.p_expected_index_epoch === null)
    ) throw fail("invalid_request");
  } else if (
    !uuid(p.p_execution_id) || !uuid(p.p_binding_id) ||
    !integer(p.p_page_number, 10000) || !uuid(p.p_expected_attempt_id)
  ) {
    // Question retrieval must pin one observed head. The nullable SQL diagnostic
    // read is deliberately not an implicit "give me whatever is latest" here.
    throw fail("invalid_request");
  }
  return Object.freeze(p) as Params;
}

function discard(response: unknown) {
  try {
    if (response instanceof Response) {
      void response.body?.cancel().catch(() => {});
    }
  } catch { /* Do not wait for error cleanup. */ }
}
async function readJSON(
  response: Response,
  cap: number,
  signal: AbortSignal,
  check: () => void,
): Promise<unknown> {
  const length = response.headers.get("content-length");
  // Fetch may expose decoded gzip/br bytes while retaining the encoded wire
  // length. Both header and streamed-byte caps remain enforced, but only an
  // identity representation has a length comparable to the decoded stream.
  const encoding = response.headers.get("content-encoding")?.trim()
    .toLowerCase();
  const identity = encoding === undefined || encoding === "identity";
  if (
    length !== null &&
    (!/^(?:0|[1-9][0-9]*)$/.test(length) || Number(length) > cap)
  ) {
    discard(response);
    throw fail("response_rejected");
  }
  if (!response.body) throw fail("response_rejected");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  const cancel = () => {
    try {
      void reader.cancel().catch(() => {});
    } catch { /* Best effort. */ }
  };
  addEvent.call(signal, "abort", cancel, { once: true });
  let total = 0, ended = false;
  try {
    for (;;) {
      check();
      const next = await reader.read();
      check();
      if (next.done) {
        ended = true;
        break;
      }
      if (
        !(next.value instanceof Uint8Array) ||
        next.value.byteLength > cap - total
      ) throw fail("response_rejected");
      chunks.push(new Uint8Array(next.value));
      total += next.value.byteLength;
    }
    if (!total || identity && length !== null && Number(length) !== total) {
      throw fail("response_rejected");
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    check();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw fail("response_rejected");
    }
    // Deliberately untrusted output. Existing exact wire/hash binders must run
    // next; HTTP/JSON validity never creates a source or admission brand.
    return parsed;
  } finally {
    removeEvent.call(signal, "abort", cancel);
    if (!ended) cancel();
    reader.releaseLock();
  }
}

/** SERVER-ONLY internal adapter. Supply a scope already established by the
 * owner authorizer; this constructor does not authenticate or authorize anyone.
 * Capture one immutable scope per question, never a shared mutable last caller.
 * No runtime environment reads, browser imports, dynamic URLs, worker/control
 * RPCs, source uploads, source enrollment or implicit legacy/owner conversion.
 * Limits are per response, not aggregate process memory or provider admission.
 */
export function createECOSV2PreviewRPCTransport(
  options: ECOSV2ServerRPCTransportOptions,
): Readonly<
  {
    evidenceRPC: ECOSQuestionEvidenceRPC;
    ownerInventoryRPC: ECOSV2OwnerInventoryRPC;
    admissionRPC: ECOSV2OwnerPreviewLedgerRPC;
  }
> {
  const send = createSender(options);
  return Object.freeze({
    evidenceRPC: (name, params, signal) =>
      send(name, params, signal, READS, bindParameters, readCap(name)),
    ownerInventoryRPC: (name, params, signal) =>
      send(name, params, signal, [OWNER_READ], bindParameters, readCap(name)),
    admissionRPC: (name, params, signal) =>
      send(name, params, signal, LEDGER, bindParameters, 4096),
  });
}

/** Explicit internal execution-control transport, never placed on a customer
 * question transport object. Caller must independently authorize the owner and
 * bind current source/execution inputs. Construction/JSON validity proves
 * neither authorization nor measured bytes. No automatic retry or cleanup.
 * Output is untrusted and capped at64KiB; exact result binders remain required.
 */
export function createECOSV2OwnerExecutionRPCTransport(
  options: ECOSV2ServerRPCTransportOptions,
): ECOSV2OwnerExecutionRPC {
  const send = createSender(options);
  const rpc: ECOSV2OwnerExecutionRPC = (name, params, signal) =>
    send(name, params, signal, EXECUTION, bindExecutionParameters, 64 * 1024);
  return Object.freeze(rpc);
}

/** Server-only owner QUESTION read port. It cannot bind, claim, register, finish,
 * cancel, upload or publish. The current complete index and raw-page binders
 * must still authenticate every returned identity/hash; HTTP success is not a
 * verified source, raster, semantic answer or continuing authorization. */
export function createECOSV2OwnerEvidenceRPCTransport(
  options: ECOSV2ServerRPCTransportOptions,
): ECOSV2OwnerEvidenceRPC & ECOSLinkedOwnerProjectDocumentIndexesRPC {
  const send = createSender(options);
  const rpc: ECOSV2OwnerEvidenceRPC = (name, params, signal) =>
    send(
      name,
      params,
      signal,
      OWNER_EVIDENCE_READS,
      bindOwnerEvidenceParameters,
      name === "ecos_read_owner_page_observations"
        ? 25 * 1024 * 1024
        : name === "ecos_read_owner_source_execution"
        ? 64 * 1024
        : 2 * 1024 * 1024,
    );
  return Object.freeze(rpc);
}

/** Read-only private image-locator port, kept separate from raster receipt
 * mutation. A null upload pin is initial discovery only; exact page is always
 * mandatory. Response binding/download/recheck remain caller responsibilities. */
export function createECOSV2OwnerRasterReadRPCTransport(
  options: ECOSV2ServerRPCTransportOptions,
): ECOSV2OwnerRasterReadRPC {
  const send = createSender(options);
  const bind = (
    _name: string,
    raw: unknown,
    scope: Readonly<ECOSV2PreviewScope>,
  ): Params => {
    const p = object(raw, [
      "p_owner_id",
      "p_project_id",
      "p_execution_id",
      "p_binding_id",
      "p_page_number",
      "p_expected_page_attempt_id",
      "p_expected_page_sha256",
      "p_expected_upload_attempt_id",
    ]);
    if (
      scope.organizationId !== scope.ownerId ||
      p.p_owner_id !== scope.ownerId || p.p_project_id !== scope.projectId ||
      !uuid(p.p_execution_id) || !uuid(p.p_binding_id) ||
      !integer(p.p_page_number, 10000) ||
      !uuid(p.p_expected_page_attempt_id) || !sha(p.p_expected_page_sha256) ||
      !optional(
        p.p_expected_upload_attempt_id,
        (value) => uuid(value) && (value as string)[14] === "4",
      )
    ) {
      throw fail("invalid_request");
    }
    return Object.freeze(p) as Params;
  };
  const rpc: ECOSV2OwnerRasterReadRPC = (name, params, signal) =>
    send(name, params, signal, ["ecos_read_owner_page_raster"], bind, 32768);
  return Object.freeze(rpc);
}

function readCap(name: string) {
  return name === "ecos_list_project_record_inventory"
    ? 10 * 1024 * 1024
    : 2 * 1024 * 1024;
}

/** Exact owner corpus SEARCH read only. No source enrollment, checkpoint write,
 * execution control or caller-selected RPC. Query is untrusted literal planning
 * input, not SQL syntax, evidence or a permission grant. */
export function createECOSV2OwnerPageSearchRPCTransport(
  options: ECOSV2ServerRPCTransportOptions,
): ECOSOwnerPageSearchRPC {
  const send = createSender(options);
  const bind = (
    _name: string,
    raw: unknown,
    scope: Readonly<ECOSV2PreviewScope>,
  ): Params => {
    const p = object(raw, [
      "p_owner_id",
      "p_organization_id",
      "p_project_id",
      "p_expected_inventory_epoch",
      "p_expected_index_epoch",
      "p_query",
      "p_expected_search_epoch",
      "p_limit",
    ]);
    if (
      p.p_owner_id !== scope.ownerId ||
      p.p_organization_id !== scope.organizationId ||
      p.p_project_id !== scope.projectId ||
      !sha(p.p_expected_inventory_epoch) || !sha(p.p_expected_index_epoch) ||
      !optional(p.p_expected_search_epoch, sha) || !integer(p.p_limit, 8) ||
      !text(p.p_query, 8192, true) || [...p.p_query as string].length > 2048
    ) throw fail("invalid_request");
    return Object.freeze(p) as Params;
  };
  const rpc: ECOSOwnerPageSearchRPC = (name, params, signal) =>
    send(
      name,
      params,
      signal,
      ["ecos_search_linked_owner_page_observations"],
      bind,
      2 * 1024 * 1024,
    );
  return Object.freeze(rpc);
}

/** Exact owner/project recorded-values read only. It exposes no legacy document
 * job RPC, admission write, control function or caller-selected source list. */
export function createECOSV2OwnerRecordsRPCTransport(
  options: ECOSV2ServerRPCTransportOptions,
): import("./ecos-project-record-inventory-loader.ts").ECOSProjectRecordInventoryRPC {
  const send = createSender(options);
  return Object.freeze((
    name: "ecos_list_project_record_inventory",
    params: Readonly<Record<string, string | number | null>>,
    signal: AbortSignal,
  ) =>
    send(
      name,
      params,
      signal,
      ["ecos_list_project_record_inventory"],
      (name, raw, scope) => {
        if (scope.organizationId !== scope.ownerId) {
          throw fail("invalid_request");
        }
        return bindParameters(name as RPCName, raw, scope);
      },
      10 * 1024 * 1024,
    )
  );
}

function createSender(options: ECOSV2ServerRPCTransportOptions) {
  let v: Record<string, unknown>, scope: Readonly<ECOSV2PreviewScope>;
  try {
    v = object(options, ["serviceRoleKey", "scope"], [
      "fetchImpl",
      "timeoutMs",
    ]);
    scope = scopeCopy(v.scope);
  } catch {
    throw fail("invalid_configuration");
  }
  const key = v.serviceRoleKey,
    fetchImpl = v.fetchImpl ?? fetch,
    timeoutMs = v.timeoutMs ?? 25_000;
  if (
    typeof key !== "string" || !/^[!-~]{1,8192}$/.test(key) ||
    typeof fetchImpl !== "function" || !integer(timeoutMs, 25_000)
  ) throw fail("invalid_configuration");
  return async <Name extends string>(
    name: unknown,
    raw: unknown,
    signal: AbortSignal,
    allowed: readonly string[],
    bind: (
      name: Name,
      raw: unknown,
      scope: Readonly<ECOSV2PreviewScope>,
    ) => Readonly<Record<string, unknown>>,
    cap: number,
  ): Promise<unknown> => {
    if (typeof name !== "string" || !allowed.includes(name)) {
      throw fail("invalid_request");
    }
    const deadline = performance.now() + (timeoutMs as number);
    if (isAborted(signal)) throw fail("cancelled");
    let parameters: Readonly<Record<string, unknown>>;
    try {
      parameters = bind(name as Name, raw, scope);
    } catch {
      // Reflection on a Proxy can throw arbitrary text, even without getters.
      throw fail("invalid_request");
    }
    const body = JSON.stringify(parameters);
    const url = `${ECOS_V2_PREVIEW_RPC_PROJECT_URL}/rest/v1/rpc/${name}`;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      if (isAborted(signal)) throw fail("cancelled");
      if (controller.signal.aborted || performance.now() >= deadline) {
        throw fail("deadline_exceeded");
      }
    };
    let stop = () => {};
    const stopped = new Promise<never>((_, reject) => {
      stop = () => {
        controller.abort();
        reject(fail(isAborted(signal) ? "cancelled" : "deadline_exceeded"));
      };
      addEvent.call(signal, "abort", stop, { once: true });
      timer = setTimeout(stop, Math.max(1, deadline - performance.now()));
    });
    try {
      const result = await Promise.race([
        stopped,
        Promise.resolve().then(async () => {
          check();
          const response = await (fetchImpl as typeof fetch)(url, {
            method: "POST",
            body,
            signal: controller.signal,
            redirect: "error",
            cache: "no-store",
            credentials: "omit",
            headers: {
              apikey: key,
              Authorization: `Bearer ${key}`,
              "content-type": "application/json",
              accept: "application/json",
              "cache-control": "no-store",
            },
          });
          try {
            // Runs even after the race has rejected: discard late response bodies.
            check();
            if (
              !(response instanceof Response) || response.url !== url ||
              response.redirected || response.status !== 200 ||
              response.type === "opaqueredirect" ||
              response.headers.get("content-type")?.split(";")[0].trim()
                  .toLowerCase() !== "application/json"
            ) throw fail("response_rejected");
          } catch (error) {
            discard(response);
            throw error;
          }
          return await readJSON(response, cap, controller.signal, check);
        }),
      ]);
      check();
      return result;
    } catch (error) {
      // Never propagate server bodies, token-bearing fetch errors or forged
      // exception messages. These are fixed categories, not retry permission.
      const known: readonly ErrorCode[] = [
        "cancelled",
        "deadline_exceeded",
        "response_rejected",
      ];
      let code: ErrorCode = "unavailable";
      try {
        const descriptor = error instanceof ECOSV2PreviewRPCError
          ? Object.getOwnPropertyDescriptor(error, "code")
          : undefined;
        if (
          descriptor && Object.hasOwn(descriptor, "value") &&
          known.includes(descriptor.value)
        ) code = descriptor.value;
      } catch { /* Treat hostile error objects as an unclassified failure. */ }
      throw fail(code);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      removeEvent.call(signal, "abort", stop);
      controller.abort();
    }
  };
}
