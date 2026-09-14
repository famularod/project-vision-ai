import {
  type ECOSProjectRecordInventoryRequest,
  type ECOSProjectRecordInventoryRPC,
  loadECOSProjectRecordInventory,
} from "./ecos-project-record-inventory-loader.ts";
import {
  assertECOSProjectRecordInventory,
  type ECOSProjectRecordInventoryRow,
  type ECOSProjectRecordObservation,
} from "./ecos-project-record-inventory.ts";

const encoder = new TextEncoder();
const SHA = /^[a-f0-9]{64}$/;
const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const MAX_RESULT_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_BYTES = 256 * 1024;
const origins = new WeakSet<object>();
const aborted = Object.getOwnPropertyDescriptor(
  AbortSignal.prototype,
  "aborted",
)!
  .get!;
const addListener = EventTarget.prototype.addEventListener;
const removeListener = EventTarget.prototype.removeEventListener;

export interface ECOSOperationalSourceCitation {
  evidence_id: string;
  context_id: string;
  kind: "operational_observation";
  selected: true;
  source_id: string;
  source_sha256: string;
  quote: string;
  locator: Readonly<
    ECOSProjectRecordObservation & {
      owner_id: string;
      organization_id: string;
      project_id: string;
      record_epoch_sha256: string;
    }
  >;
}

type Reason =
  | "source_changed"
  | "source_deleted"
  | "source_needs_review"
  | "source_missing"
  | "cited_value_mismatch"
  | "inventory_unavailable";
interface Base {
  schema_version: "ecos-operational-citation-source/2.2";
  publication_mode: "shadow";
  organization_id: string;
  owner_id: string;
  project_id: string;
  citation: Readonly<ECOSOperationalSourceCitation>;
  observed_record_epoch_sha256: string | null;
  record_epoch_relation:
    | "same_as_citation"
    | "changed_since_citation"
    | "not_observed";
  read_only: true;
  retrieval_authorized: false;
  semantic_verified: false;
  answer_currentness: "not_revalidated";
  aggregate_currentness: "not_revalidated";
  authorization: "caller_required_before_and_after";
  freshness:
    | "complete_inventory_rechecked_for_this_source_read"
    | "not_established";
}
export type ECOSOperationalCitationSource = Readonly<
  & Base
  & (
    | {
      state: "current_exact_record";
      reason: null;
      row: Readonly<ECOSProjectRecordInventoryRow>;
      observation: Readonly<ECOSProjectRecordObservation>;
    }
    | {
      state: "changed" | "unavailable";
      reason: Reason;
      row: null;
      observation: null;
    }
  )
>;

function invalid(): never {
  throw new Error("Invalid operational citation source request");
}
function object(value: unknown, keys: readonly string[]) {
  if (
    !value || typeof value !== "object" || Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null) ||
    Reflect.ownKeys(value).length !== keys.length
  ) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const copy: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const d = descriptors[key];
    if (!d || !d.enumerable || !Object.hasOwn(d, "value")) invalid();
    copy[key] = d.value;
  }
  return copy;
}
function text(value: unknown, maximum: number, identifier = false): string {
  if (
    typeof value !== "string" || !value.trim() || value.includes("\0") ||
    value.length > maximum || encoder.encode(value).length > maximum ||
    [...value].some((c) => {
      const n = c.codePointAt(0)!;
      return (n >= 0xd800 && n <= 0xdfff) ||
        (identifier && (n < 32 || (n >= 127 && n <= 159)));
    }) || (identifier && value !== value.trim())
  ) invalid();
  return value;
}
function pin(value: unknown, expression: RegExp): string {
  if (typeof value !== "string" || !expression.test(value)) invalid();
  return value;
}
function scopeSnapshot(input: ECOSProjectRecordInventoryRequest) {
  const s = object(input, ["organizationId", "ownerId", "projectId"]);
  const ownerId = pin(s.ownerId, UUID);
  if (s.organizationId !== ownerId) invalid();
  return Object.freeze({
    organizationId: ownerId,
    ownerId,
    projectId: pin(s.projectId, UUID),
  });
}
function citationSnapshot(
  value: unknown,
  scope: Readonly<ECOSProjectRecordInventoryRequest>,
): Readonly<ECOSOperationalSourceCitation> {
  const c = object(value, [
    "evidence_id",
    "context_id",
    "kind",
    "selected",
    "source_id",
    "source_sha256",
    "quote",
    "locator",
  ]);
  const l = object(c.locator, [
    "owner_id",
    "organization_id",
    "project_id",
    "source_key",
    "source_kind",
    "source_id",
    "source_sha256",
    "record_epoch_sha256",
    "pointer",
    "value",
    "meaning",
  ]);
  if (
    c.kind !== "operational_observation" || c.selected !== true ||
    l.owner_id !== scope.ownerId ||
    l.organization_id !== scope.organizationId ||
    l.project_id !== scope.projectId ||
    (l.source_kind !== "schedule_item" && l.source_kind !== "field_note") ||
    l.meaning !== "recorded_value_not_site_verification"
  ) invalid();
  const source_id = text(c.source_id, 300, true);
  const source_sha256 = pin(c.source_sha256, SHA);
  if (
    l.source_id !== source_id || l.source_sha256 !== source_sha256 ||
    l.source_key !== `${l.source_kind}:${source_id}`
  ) invalid();
  const pointer = text(l.pointer, 128, true);
  // Structural allowlist only. The existing genuine inventory projector below
  // is the authority for whether this exact raw value is a supported observation.
  const supported = l.source_kind === "schedule_item"
    ? /^\/(?:task_name|item_data\/(?:status|percentComplete|locationName|startDate|finishDate|notes|itemType|completionVerification(?:\/status)?))$/
    : /^\/(?:original_text|status|action_kind|action_text|location_name)$/;
  if (!supported.test(pointer)) invalid();
  let scalar: string | number | boolean;
  if (typeof l.value === "string") scalar = text(l.value, MAX_TEXT_BYTES);
  else if (typeof l.value === "boolean") scalar = l.value;
  else if (typeof l.value === "number" && Number.isSafeInteger(l.value)) {
    scalar = l.value;
  } else invalid();
  if (
    pointer === "/item_data/percentComplete" &&
    (typeof scalar !== "number" || scalar < 0 || scalar > 100)
  ) invalid();
  const quote = text(c.quote, MAX_TEXT_BYTES);
  if (
    quote !== (typeof scalar === "string" ? scalar : JSON.stringify(scalar))
  ) {
    invalid();
  }
  return Object.freeze({
    evidence_id: pin(c.evidence_id, /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/),
    context_id: pin(c.context_id, /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/),
    kind: "operational_observation",
    selected: true,
    source_id,
    source_sha256,
    quote,
    locator: Object.freeze({
      owner_id: scope.ownerId,
      organization_id: scope.organizationId,
      project_id: scope.projectId,
      source_key: l.source_key as string,
      source_kind: l.source_kind,
      source_id,
      source_sha256,
      record_epoch_sha256: pin(l.record_epoch_sha256, SHA),
      pointer,
      value: scalar,
      meaning: "recorded_value_not_site_verification",
    }),
  });
}

export function assertECOSOperationalCitationSource(
  value: unknown,
): asserts value is ECOSOperationalCitationSource {
  if (!value || typeof value !== "object" || !origins.has(value)) {
    throw new Error(
      "Operational source must originate from its exact resolver",
    );
  }
}

/** Internal source detail only: the caller MUST authenticate and authorize the
 * exact account/project both before calling and after this resolves, before
 * releasing data. Neither construction, citation JSON nor this private brand
 * establishes account authority or revalidates the answer/aggregate.
 *
 * Accept only a citation already validated in an owner /2.2 answer. This boundary
 * additionally snapshots its strict shape and rechecks it against a newly loaded
 * complete raw cloud inventory; no local store, field-note sync, writes, model,
 * URL or normalized-record fallback exists here. Unrelated epoch changes are
 * reported but do not hide a byte-identical eligible cited record.
 *
 * The 2MiB cap is serialized result size, not process RSS. The inherited loader
 * separately bounds the complete32MiB raw inventory and120s/25s waits. Abort
 * does not prove transport preemption. Failed/cancelled sweeps return no prefix.
 */
export async function resolveECOSOperationalCitationSource(
  input: ECOSProjectRecordInventoryRequest,
  suppliedCitation: unknown,
  rpc: ECOSProjectRecordInventoryRPC,
  options: {
    signal?: AbortSignal;
    pageLimit?: number;
    budgetMs?: number;
    rpcTimeoutMs?: number;
    maxResultBytes?: number;
  } = {},
): Promise<ECOSOperationalCitationSource> {
  // Include descriptor/proxy work and input copies in the same overall budget.
  const started = performance.now();
  const scope = scopeSnapshot(input);
  const citation = citationSnapshot(suppliedCitation, scope);
  if (!options || typeof options !== "object") invalid();
  const optionKeys = Reflect.ownKeys(options);
  const allowed = [
    "signal",
    "pageLimit",
    "budgetMs",
    "rpcTimeoutMs",
    "maxResultBytes",
  ];
  if (optionKeys.some((k) => typeof k !== "string" || !allowed.includes(k))) {
    invalid();
  }
  const o = object(options, optionKeys as string[]);
  const bounded = (v: unknown, fallback: number, max: number) => {
    const n = v === undefined ? fallback : v;
    if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 1 || n > max) {
      invalid();
    }
    return n;
  };
  const pageLimit = bounded(o.pageLimit, 16, 16);
  const budgetMs = bounded(o.budgetMs, 120_000, 120_000);
  const rpcTimeoutMs = bounded(o.rpcTimeoutMs, 25_000, 25_000);
  const maxResultBytes = bounded(
    o.maxResultBytes,
    MAX_RESULT_BYTES,
    MAX_RESULT_BYTES,
  );
  const signal = o.signal as AbortSignal | undefined;
  if (typeof rpc !== "function") invalid();
  if (signal !== undefined) {
    try {
      aborted.call(signal); // Native brand check; never a shadowable property.
    } catch {
      invalid();
    }
  }
  const deadline = started + budgetMs;
  // The legacy loader receives our private, unmodified signal, not caller
  // shadowed aborted/addEventListener/removeEventListener properties.
  const child = new AbortController();
  const forwardAbort = () => child.abort();
  const check = () => {
    if (signal !== undefined && aborted.call(signal)) {
      throw new Error("Operational source read cancelled");
    }
    if (performance.now() >= deadline) {
      throw new Error("Operational source read deadline exceeded");
    }
  };
  const finish = (
    detail: Pick<
      ECOSOperationalCitationSource,
      "state" | "reason" | "row" | "observation"
    >,
    epoch: string | null,
  ): ECOSOperationalCitationSource => {
    check();
    const result = Object.freeze({
      schema_version: "ecos-operational-citation-source/2.2" as const,
      publication_mode: "shadow" as const,
      organization_id: scope.organizationId,
      owner_id: scope.ownerId,
      project_id: scope.projectId,
      citation,
      ...detail,
      observed_record_epoch_sha256: epoch,
      record_epoch_relation: epoch === null
        ? "not_observed" as const
        : epoch === citation.locator.record_epoch_sha256
        ? "same_as_citation" as const
        : "changed_since_citation" as const,
      read_only: true as const,
      retrieval_authorized: false as const,
      semantic_verified: false as const,
      answer_currentness: "not_revalidated" as const,
      aggregate_currentness: "not_revalidated" as const,
      authorization: "caller_required_before_and_after" as const,
      freshness: epoch === null
        ? "not_established" as const
        : "complete_inventory_rechecked_for_this_source_read" as const,
    });
    if (encoder.encode(JSON.stringify(result)).length > maxResultBytes) {
      throw new Error("Operational source snapshot exceeds result bound");
    }
    check();
    origins.add(result);
    return result as ECOSOperationalCitationSource;
  };
  const unavailable = () =>
    finish({
      state: "unavailable",
      reason: "inventory_unavailable",
      row: null,
      observation: null,
    }, null);
  try {
    check();
    if (signal !== undefined) {
      addListener.call(signal, "abort", forwardAbort, { once: true });
    }
    check();
    let loaded: Awaited<ReturnType<typeof loadECOSProjectRecordInventory>>;
    try {
      loaded = await loadECOSProjectRecordInventory(scope, rpc, {
        signal: child.signal,
        pageLimit,
        budgetMs: Math.max(1, Math.floor(deadline - performance.now())),
        rpcTimeoutMs,
      });
    } catch {
      check();
      return unavailable();
    }
    check();
    assertECOSProjectRecordInventory(loaded.inventory);
    const inventory = loaded.inventory;
    const row = inventory.rows.find((r) =>
      r.source_key === citation.locator.source_key
    );
    let reason: Reason | null = null;
    if (!row) reason = "source_missing";
    else if (row.disposition === "deleted_conflict") reason = "source_deleted";
    else if (row.disposition !== "recorded") reason = "source_needs_review";
    else if (
      row.source_kind !== citation.locator.source_kind ||
      row.source_id !== citation.source_id ||
      row.source_sha256 !== citation.source_sha256
    ) reason = "source_changed";
    const observation = reason === null
      ? loaded.observations.observations.find((o) =>
        o.source_key === citation.locator.source_key &&
        o.source_kind === citation.locator.source_kind &&
        o.source_id === citation.source_id &&
        o.source_sha256 === citation.source_sha256 &&
        o.pointer === citation.locator.pointer &&
        o.value === citation.locator.value &&
        o.meaning === citation.locator.meaning &&
        (typeof o.value === "string" ? o.value : JSON.stringify(o.value)) ===
          citation.quote
      )
      : undefined;
    if (reason === null && !observation) reason = "cited_value_mismatch";
    return finish(
      reason !== null
        ? {
          state: reason === "source_missing" ? "unavailable" : "changed",
          reason,
          row: null,
          observation: null,
        }
        : {
          state: "current_exact_record",
          reason: null,
          row: row!,
          observation: observation!,
        },
      inventory.epoch_sha256,
    );
  } finally {
    if (signal !== undefined) {
      removeListener.call(signal, "abort", forwardAbort);
    }
    child.abort();
  }
}
