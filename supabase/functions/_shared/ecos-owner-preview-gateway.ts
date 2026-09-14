/** Thin, default-off Edge forwarding boundary. No Supabase/service/provider key,
 * source access, model, worker, image decoding or authority implementation lives
 * here. The configured server must independently authorize the original bearer,
 * admit the request, and recheck sources. Cancellation bounds our wait and asks
 * the downstream service to stop; it does not prove remote work was preempted. */
import {
  createECOSOwnerPrivateGatewayIdentity,
  type ECOSOwnerPrivateGatewayIdentity,
} from "./ecos-owner-private-gateway-identity.ts";

export const ECOS_OWNER_PREVIEW_ORIGIN =
  "https://project-photo-update-tool.expo.app";
export interface ECOSOwnerPreviewGatewayConfig {
  enabled?: boolean;
  queryURL?: string;
  gatewayToken?: string;
  /** Exact packaged source-manifest digest, NOT image or source readiness. */
  packagedSourceSha256?: string;
  fetchImpl?: typeof fetch;
  /** Lower-only complete request budget; downstream work is capped at 120s. */
  timeoutMs?: number;
  /** Required by hosted entrypoints; optional only for isolated transport tests. */
  googleIdentity?: ECOSOwnerPrivateGatewayIdentity;
}
type Data = Record<string, unknown>;
const enc = new TextEncoder();
const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
function stop(): never {
  throw new Error("Owner preview unavailable");
}
const ERROR_STATUS = {
  origin_not_allowed: 403,
  preview_not_enabled: 503,
  method_not_allowed: 405,
  json_required: 415,
  sign_in_required: 401,
  invalid_preview_request: 400,
  project_access_denied: 403,
  preview_capacity_unavailable: 429,
  preview_cancelled: 503,
  preview_unavailable: 503,
} as const;
type SafeError = keyof typeof ERROR_STATUS;
function object(value: unknown, keys?: readonly string[]): Data {
  if (
    !value || typeof value !== "object" || Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) stop();
  const out: Data = {}, names = Reflect.ownKeys(value);
  if (
    keys &&
    (names.length !== keys.length || keys.some((k) => !names.includes(k)))
  ) stop();
  for (const key of names) {
    if (
      typeof key !== "string" ||
      ["__proto__", "prototype", "constructor"].includes(key)
    ) stop();
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d?.enumerable || !Object.hasOwn(d, "value")) stop();
    out[key] = d.value;
  }
  return out;
}
function question(value: unknown): string {
  if (
    typeof value !== "string" || !value.trim() || [...value].length > 4000 ||
    enc.encode(value).length > 16 * 1024 ||
    // Ordinary multiline input is retained byte-for-byte; other controls fail.
    // deno-lint-ignore no-control-regex
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(value)
  ) stop();
  return value;
}
function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) stop();
  return value;
}
function sha(value: unknown): string {
  if (typeof value !== "string" || !SHA.test(value)) stop();
  return value;
}
function equal(a: unknown, b: unknown) {
  if (a !== b) stop();
}
function sameData(a: unknown, b: unknown): boolean {
  if (
    a === null || b === null || typeof a !== "object" || typeof b !== "object"
  ) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length &&
      a.every((v, i) => sameData(v, b[i]));
  }
  const x = a as Data, y = b as Data;
  return Object.keys(x).length === Object.keys(y).length &&
    Object.keys(x).every((k) => Object.hasOwn(y, k) && sameData(x[k], y[k]));
}

/** Small strict JSON scanner: duplicate decoded keys, unsafe keys, invalid
 * Unicode, excessive depth/nodes and nonfinite numbers cannot be normalized by
 * JSON.parse into a different request/response. No source semantics are parsed. */
export function parseECOSOwnerGatewayJSON(text: string): unknown {
  let i = 0, nodes = 0;
  const space = () => {
    while (/[\x20\t\r\n]/.test(text[i] ?? "!") && i < text.length) i++;
  };
  const string = (): string => {
    const start = i++;
    while (i < text.length) {
      if (text[i] === '"') {
        const value = JSON.parse(text.slice(start, ++i));
        for (const c of value) {
          const code = c.codePointAt(0)!;
          if (code === 0 || code >= 0xd800 && code <= 0xdfff) stop();
        }
        return value;
      }
      if (text[i++] === "\\") i++;
    }
    return stop();
  };
  const value = (depth: number): void => {
    if (++nodes > 40000 || depth > 24) stop();
    space();
    if (text[i] === '"') {
      string();
      return;
    }
    if (text[i] === "{" || text[i] === "[") {
      const map = text[i++] === "{",
        close = map ? "}" : "]",
        keys = new Set<string>();
      space();
      if (text[i] === close) {
        i++;
        return;
      }
      while (true) {
        if (map) {
          if (text[i] !== '"') stop();
          const key = string();
          if (
            keys.has(key) ||
            ["__proto__", "prototype", "constructor"].includes(key)
          ) stop();
          keys.add(key);
          space();
          if (text[i++] !== ":") stop();
        }
        value(depth + 1);
        space();
        if (text[i] === close) {
          i++;
          return;
        }
        if (text[i++] !== ",") stop();
        space();
      }
    }
    const token =
      /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/
        .exec(text.slice(i));
    if (
      !token || /^-?[0-9]/.test(token[0]) && !Number.isFinite(Number(token[0]))
    ) stop();
    i += token[0].length;
  };
  value(0);
  space();
  if (i !== text.length) stop();
  return JSON.parse(text);
}
function discard(stream: ReadableStream<Uint8Array> | null) {
  try {
    void stream?.cancel().catch(() => {});
  } catch { /* Cleanup is best effort, never another wait. */ }
}
export async function readECOSOwnerGatewayBody(
  body: ReadableStream<Uint8Array> | null,
  headers: Headers,
  maximum: number,
  signal: AbortSignal,
  check: () => void,
): Promise<string> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let cancel = () => discard(body);
  const stopReading = () => cancel();
  signal.addEventListener("abort", stopReading, { once: true });
  try {
    check();
    const length = headers.get("content-length");
    if (
      length !== null && (!/^(?:0|[1-9][0-9]*)$/.test(length) ||
        !Number.isSafeInteger(Number(length)) || Number(length) > maximum)
    ) stop();
    if (!body) stop();
    reader = body.getReader();
    cancel = () => {
      try {
        void reader?.cancel().catch(() => {});
      } catch { /* Do not await hostile cleanup. */ }
    };
    const bytes = new Uint8Array(maximum);
    let total = 0, reads = 0;
    while (true) {
      check();
      // Independent progress bound, including endless zero-length chunks.
      if (++reads > 8192) stop();
      const next = await reader.read();
      check();
      if (next.done) break;
      if (
        !(next.value instanceof Uint8Array) ||
        total + next.value.byteLength > maximum
      ) stop();
      bytes.set(next.value, total);
      total += next.value.byteLength;
    }
    // Fetch may decode gzip/br without rewriting compressed Content-Length.
    const encoding = headers.get("content-encoding");
    if (
      (!encoding || encoding.toLowerCase() === "identity") && length !== null &&
      Number(length) !== total
    ) stop();
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(0, total),
    );
    check();
    return text;
  } catch (error) {
    cancel();
    throw error;
  } finally {
    signal.removeEventListener("abort", stopReading);
    try {
      reader?.releaseLock();
    } catch { /* A noncooperative read may still be pending. */ }
  }
}

function operationalCoverage(value: unknown): Data {
  const c = object(
    value,
    (
      "state record_epoch_sha256 discovery_sha256 total_record_count eligible_record_count matching_record_count returned_record_count oversized_record_count has_more gaps method semantic_relevance selected_record_count selected_records row_gaps aggregate_progress legacy_name_scope local_unsynced_records"
    ).split(" "),
  );
  equal(c.state, "loaded_exact_project_records");
  sha(c.record_epoch_sha256);
  sha(c.discovery_sha256);
  for (
    const key of [
      "total_record_count",
      "eligible_record_count",
      "matching_record_count",
      "returned_record_count",
      "oversized_record_count",
      "selected_record_count",
    ]
  ) {
    if (
      !Number.isSafeInteger(c[key]) || (c[key] as number) < 0 ||
      (c[key] as number) > 1000
    ) stop();
  }
  if (
    (c.eligible_record_count as number) > (c.total_record_count as number) ||
    (c.matching_record_count as number) > (c.eligible_record_count as number) ||
    (c.returned_record_count as number) > 8 ||
    (c.returned_record_count as number) > (c.matching_record_count as number) ||
    (c.selected_record_count as number) > (c.returned_record_count as number) ||
    (c.oversized_record_count as number) >
      (c.matching_record_count as number) - (c.returned_record_count as number)
  ) stop();
  equal(
    c.has_more,
    (c.returned_record_count as number) < (c.matching_record_count as number),
  );
  if (
    !Array.isArray(c.selected_records) ||
    c.selected_records.length !== c.selected_record_count ||
    !Array.isArray(c.row_gaps) ||
    c.row_gaps.length !==
      (c.total_record_count as number) - (c.eligible_record_count as number) ||
    !Array.isArray(c.gaps) || c.gaps.length > 16 ||
    c.gaps.some((v) => typeof v !== "string" || v.length > 128)
  ) stop();
  const seen = new Set<string>();
  const remember = (key: unknown) => {
    if (
      typeof key !== "string" ||
      !/^(?:schedule_item|field_note):[^\u0000-\u001f\u007f-\u009f]{1,300}$/
        .test(key) ||
      seen.has(key)
    ) stop();
    seen.add(key);
  };
  for (const raw of c.selected_records) {
    const r = object(raw, ["source_key", "source_sha256"]);
    remember(r.source_key);
    sha(r.source_sha256);
  }
  for (const raw of c.row_gaps) {
    const r = object(raw, ["source_key", "disposition", "limitations"]);
    remember(r.source_key);
    if (
      !["needs_review", "deleted_conflict"].includes(r.disposition as string) ||
      !Array.isArray(r.limitations) || !r.limitations.length ||
      r.limitations.length > 16 ||
      r.limitations.some((v) =>
        typeof v !== "string" || !v.length || v.length > 128
      )
    ) stop();
  }
  if (
    (c.has_more || c.oversized_record_count || c.row_gaps.length) &&
    !c.gaps.length
  ) stop();
  equal(c.method, "bounded_literal_lexical_search");
  equal(c.semantic_relevance, "not_verified");
  equal(c.aggregate_progress, "not_computed");
  equal(c.legacy_name_scope, "not_assessed");
  equal(c.local_unsynced_records, "not_assessed");
  return c;
}

function success(raw: unknown, request: Data, operational: boolean): Data {
  const body = object(raw, [
    "schemaVersion",
    "projectId",
    "question",
    "preview",
    "result",
  ]);
  for (const key of ["schemaVersion", "projectId", "question"]) {
    equal(body[key], request[key]);
  }
  equal(body.preview, true);
  const r = object(
    body.result,
    "schema_version original_question organization_id owner_id project_id status answer clarification_questions coverage freshness preview_status publication_mode retrieval_authorized actions_executed atomic_project_snapshot limitations"
      .split(" "),
  );
  equal(
    r.schema_version,
    operational ? "ecos-owner-question/2.2" : "ecos-owner-question/2.1",
  );
  equal(r.project_id, request.projectId);
  equal(r.original_question, request.question);
  equal(uuid(r.owner_id), uuid(r.organization_id));
  equal(
    r.preview_status,
    operational
      ? "provisional_limited_owner_source_preview"
      : "provisional_limited_owner_document_preview",
  );
  equal(r.publication_mode, "shadow");
  equal(
    r.freshness,
    operational
      ? "complete_document_and_operational_sources_rechecked_after_model"
      : "complete_source_index_and_requested_rasters_rechecked_after_model",
  );
  for (
    const key of [
      "retrieval_authorized",
      "actions_executed",
      "atomic_project_snapshot",
    ]
  ) equal(r[key], false);
  if (
    !["answer", "no_answer", "clarification_required"].includes(
      r.status as string,
    )
  ) stop();
  if (
    !Array.isArray(r.clarification_questions) || !Array.isArray(r.limitations)
  ) stop();
  const coverage = object(
    r.coverage,
    "source_count expected_page_count inventory_epoch_sha256 index_epoch_sha256 search_epoch_sha256 source_search omitted_matching_lanes selected_pages requested_images operational_records photos project_updates whole_project_completeness"
      .split(" "),
  );
  sha(coverage.inventory_epoch_sha256);
  sha(coverage.index_epoch_sha256);
  if (coverage.search_epoch_sha256 !== null) sha(coverage.search_epoch_sha256);
  const records = operational
    ? operationalCoverage(coverage.operational_records)
    : null;
  if (!operational) equal(coverage.operational_records, "not_supplied");
  equal(coverage.photos, "not_assessed");
  equal(coverage.project_updates, "not_supplied");
  equal(coverage.whole_project_completeness, "not_verified");
  if (r.answer !== null) {
    const a = object(
      r.answer,
      ("schema_version publication_mode status original_question organization_id project_id owner_id inventory_epoch_sha256 index_epoch_sha256 discovery_sha256 counterevidence_search_epoch_sha256 raster_receipts preview_status retrieval_authorized actions_executed semantic_verification deterministic_verification currentness facts recommendations clarification_questions unresolved_requirements coverage semantic_review reason" +
        (operational
          ? " record_epoch_sha256 operational_discovery_sha256"
          : ""))
        .split(" "),
    );
    equal(
      a.schema_version,
      operational
        ? "ecos-owner-source-answer/2.2"
        : "ecos-owner-source-answer/2.1",
    );
    equal(a.publication_mode, "shadow");
    for (
      const key of [
        "owner_id",
        "organization_id",
        "project_id",
        "original_question",
      ]
    ) equal(a[key], r[key]);
    for (const key of ["inventory_epoch_sha256", "index_epoch_sha256"]) {
      equal(a[key], coverage[key]);
    }
    equal(a.counterevidence_search_epoch_sha256, coverage.search_epoch_sha256);
    if (operational && a.discovery_sha256 === null) {
      if (
        !Array.isArray(coverage.selected_pages) ||
        coverage.selected_pages.length !== 0 ||
        !Array.isArray(a.raster_receipts) || a.raster_receipts.length !== 0
      ) stop();
    } else sha(a.discovery_sha256);
    if (records) {
      equal(a.record_epoch_sha256, records.record_epoch_sha256);
      equal(a.operational_discovery_sha256, records.discovery_sha256);
      const answerRecords = operationalCoverage(
        object(a.coverage).operational_records,
      );
      if (!sameData(answerRecords, records)) stop();
    }
    equal(a.retrieval_authorized, false);
    equal(a.actions_executed, false);
    equal(
      a.preview_status,
      operational
        ? "provisional_limited_owner_source_preview"
        : "provisional_limited_preview",
    );
    equal(
      a.deterministic_verification,
      "source_identity_exact_text_and_verified_raster_bytes_only",
    );
    equal(a.currentness, "supplied_readbacks_only_post_model_recheck_required");
    if (!Array.isArray(a.facts) || !Array.isArray(a.recommendations)) stop();
    if (r.status === "answer") {
      equal(a.status, "answer");
      if (!a.facts.length) stop();
      equal(a.semantic_verification, "separate_model_review_passed_not_proof");
    } else {
      if (
        !["no_answer", "insufficient_evidence", "clarification_required"]
          .includes(a.status as string) ||
        a.facts.length || a.recommendations.length
      ) stop();
      equal(a.semantic_verification, "not_performed");
    }
  } else if (r.status === "answer") stop();
  // Citation/geometry parsing remains in the source producer and strict client;
  // this gateway checks envelope binding, not source authenticity or semantics.
  return body;
}

function createOwnerPreviewGateway(
  config: ECOSOwnerPreviewGatewayConfig = {},
  operational: boolean = false,
): (request: Request) => Promise<Response> {
  const c = object(config);
  if (
    Object.keys(c).some((k) =>
      ![
        "enabled",
        "queryURL",
        "gatewayToken",
        "packagedSourceSha256",
        "fetchImpl",
        "timeoutMs",
        "googleIdentity",
      ]
        .includes(k)
    )
  ) stop();
  const enabled = c.enabled ?? false,
    timeoutMs = c.timeoutMs ?? 125000,
    fetchImpl = c.fetchImpl ?? fetch;
  if (
    typeof enabled !== "boolean" || typeof fetchImpl !== "function" ||
    !Number.isSafeInteger(timeoutMs) || (timeoutMs as number) < 1 ||
    (timeoutMs as number) > 125000
  ) stop();
  const queryURL = c.queryURL,
    gatewayToken = c.gatewayToken,
    packagedSourceSha256 = c.packagedSourceSha256;
  if (enabled) {
    if (
      typeof queryURL !== "string" || queryURL.length > 500 ||
      typeof gatewayToken !== "string" ||
      !/^[A-Za-z0-9_-]{32,256}$/.test(gatewayToken) ||
      typeof packagedSourceSha256 !== "string" ||
      !SHA.test(packagedSourceSha256)
    ) stop();
    let url: URL;
    try {
      url = new URL(queryURL);
    } catch {
      return stop();
    }
    if (
      url.href !== queryURL || url.protocol !== "https:" || url.username ||
      url.password || url.port || url.search || url.hash ||
      url.pathname !== "/question" ||
      !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+run\.app$/.test(
        url.hostname,
      )
    ) stop();
  }
  const googleIdentity = enabled && c.googleIdentity !== undefined
    ? createECOSOwnerPrivateGatewayIdentity(
      c.googleIdentity as ECOSOwnerPrivateGatewayIdentity,
      new URL(queryURL as string).origin,
      fetchImpl as typeof fetch,
    )
    : undefined;
  return async (request) => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      Vary: "Origin",
    };
    const error = (code: SafeError) => {
      discard(request.body);
      return new Response(JSON.stringify({ error: code, answer: null }), {
        status: ERROR_STATUS[code],
        headers,
      });
    };
    const origin = request.headers.get("origin");
    if (origin !== null && origin !== ECOS_OWNER_PREVIEW_ORIGIN) {
      return error("origin_not_allowed");
    }
    if (origin !== null) headers["Access-Control-Allow-Origin"] = origin;
    if (!enabled) return error("preview_not_enabled");
    const inbound = new URL(request.url);
    if (
      inbound.search || inbound.hash ||
      !["/ecos-question-preview", "/functions/v1/ecos-question-preview"]
        .includes(inbound.pathname)
    ) return error("invalid_preview_request");
    if (request.method === "OPTIONS") {
      if (
        origin === null ||
        request.headers.get("access-control-request-method") !== "POST" ||
        (request.headers.get("access-control-request-headers") ?? "").split(",")
          .filter((x) => x.trim()).some((x) =>
            !["authorization", "content-type"].includes(x.trim().toLowerCase())
          )
      ) return error("origin_not_allowed");
      headers["Access-Control-Allow-Methods"] = "POST";
      headers["Access-Control-Allow-Headers"] = "authorization,content-type";
      discard(request.body);
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== "POST") return error("method_not_allowed");
    if (
      !/^application\/json(?:\s*;|$)/i.test(
        request.headers.get("content-type") ?? "",
      ) ||
      (request.headers.has("content-encoding") &&
        request.headers.get("content-encoding") !== "identity")
    ) return error("json_required");
    const authorization = request.headers.get("authorization");
    if (
      !authorization || !/^Bearer [A-Za-z0-9._~-]{1,8192}$/.test(authorization)
    ) return error("sign_in_required");
    const child = new AbortController(),
      deadline = performance.now() + (timeoutMs as number);
    const check = () => {
      if (
        request.signal.aborted || child.signal.aborted ||
        performance.now() >= deadline
      ) stop();
    };
    let abort = () => {}, response: Response | undefined;
    const stopped = new Promise<never>((_, reject) => {
      abort = () => {
        child.abort();
        reject(new Error("Owner preview stopped"));
      };
    });
    request.signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, timeoutMs as number);
    try {
      const run = async () => {
        check();
        let input: Data;
        try {
          input = object(
            parseECOSOwnerGatewayJSON(
              await readECOSOwnerGatewayBody(
                request.body,
                request.headers,
                20 * 1024,
                child.signal,
                check,
              ),
            ),
            ["schemaVersion", "projectId", "question"],
          );
          equal(
            input.schemaVersion,
            operational
              ? "ecos-question-preview/2.2"
              : "ecos-question-preview/2.1",
          );
          uuid(input.projectId);
          question(input.question);
          check();
        } catch {
          check();
          return error("invalid_preview_request");
        }
        const outgoingHeaders: Record<string, string> = {
          authorization,
          "content-type": "application/json",
          accept: "application/json",
          "x-ecos-preview-gateway-token": gatewayToken as string,
        };
        if (origin !== null) outgoingHeaders.origin = origin;
        if (googleIdentity) {
          outgoingHeaders["x-serverless-authorization"] = await googleIdentity(
            authorization,
            { signal: child.signal, deadline },
          );
        }
        check();
        const pending = Promise.resolve(
          (fetchImpl as typeof fetch)(queryURL as string, {
            method: "POST",
            body: JSON.stringify(input),
            headers: outgoingHeaders,
            signal: child.signal,
            redirect: "error",
            credentials: "omit",
            cache: "no-store",
          }),
        ).then((value) => {
          if (!(value instanceof Response)) stop();
          response = value;
          try {
            check();
          } catch (e) {
            discard(value.body);
            throw e;
          }
          return value;
        });
        const result = await pending;
        check();
        if (
          result.redirected || result.url && result.url !== queryURL ||
          result.headers.get("x-ecos-owner-packaged-source-sha256") !==
            packagedSourceSha256 ||
          !/^application\/json(?:\s*;|$)/i.test(
            result.headers.get("content-type") ?? "",
          )
        ) stop();
        const raw = parseECOSOwnerGatewayJSON(
          await readECOSOwnerGatewayBody(
            result.body,
            result.headers,
            256 * 1024,
            child.signal,
            check,
          ),
        );
        check();
        if (result.status !== 200) {
          const value = object(raw), keys = Object.keys(value);
          if (
            keys.some((k) => !["error", "answer"].includes(k)) ||
            !Object.hasOwn(value, "error") ||
            Object.hasOwn(value, "answer") && value.answer !== null
          ) stop();
          const code = value.error;
          if (
            typeof code !== "string" || !Object.hasOwn(ERROR_STATUS, code) ||
            ERROR_STATUS[code as SafeError] !== result.status
          ) stop();
          return error(code as SafeError);
        }
        const value = success(raw, input, operational);
        check();
        const serialized = JSON.stringify(value);
        if (enc.encode(serialized).length > 256 * 1024) stop();
        check();
        return new Response(serialized, { status: 200, headers });
      };
      return await Promise.race([run(), stopped]);
    } catch {
      return error(
        request.signal.aborted ? "preview_cancelled" : "preview_unavailable",
      );
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener("abort", abort);
      child.abort();
      discard(response?.body ?? null);
    }
  };
}

/** Preserve the established document-only protocol without reinterpretation. */
export function createECOSOwnerPreviewGateway(
  config: ECOSOwnerPreviewGatewayConfig = {},
) {
  return createOwnerPreviewGateway(config, false);
}

/** Explicit new protocol; neither a client header nor input can select it. */
export function createECOSOwnerOperationalPreviewGateway(
  config: ECOSOwnerPreviewGatewayConfig = {},
) {
  return createOwnerPreviewGateway(config, true);
}
