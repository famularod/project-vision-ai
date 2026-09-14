import { copyECOSV2JSON, readECOSV2BoundedBody } from "./ecos-v2-json-model.ts";
import type { ECOSV2PreviewScope } from "./ecos-v2-preview-handler.ts";

export const ECOS_OWNER_SOURCE_VIEW_PROTOCOL = "ecos-owner-source-view/2.2";
export const ECOS_OWNER_SOURCE_VIEW_REQUEST_BYTES = 384 * 1024;
export const ECOS_OWNER_SOURCE_VIEW_RESPONSE_BYTES = 12 * 1024 * 1024;
type Data = Record<string, unknown>;
const enc = new TextEncoder();
const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const ORIGIN = "https://project-photo-update-tool.expo.app";
const invalid = () => new Error("Invalid source-view request or result");

export type ECOSOwnerSourceViewRequest = Readonly<{
  schemaVersion: typeof ECOS_OWNER_SOURCE_VIEW_PROTOCOL;
  answerSchemaVersion:
    | "ecos-owner-source-answer/2.1"
    | "ecos-owner-source-answer/2.2";
  projectId: string;
  requestId: string;
  citation: Readonly<Data>;
}>;

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/** Strict wire scanner before JSON.parse: duplicated decoded keys, unsafe
 * object keys, invalid Unicode and noncanonical numeric tokens cannot silently
 * change source identities. This validates syntax, not a source locator. */
function strictJSON(text: string): unknown {
  let offset = 0, nodes = 0;
  const space = () => {
    while (offset < text.length && /[\x20\t\r\n]/.test(text[offset])) offset++;
  };
  const string = (): string => {
    const start = offset++;
    while (offset < text.length) {
      if (text[offset] === '"') {
        const value = JSON.parse(text.slice(start, ++offset));
        for (const c of value) {
          const code = c.codePointAt(0)!;
          if (code === 0 || code >= 0xd800 && code <= 0xdfff) throw invalid();
        }
        return value;
      }
      if (text[offset++] === "\\") offset++;
    }
    throw invalid();
  };
  const visit = (depth: number): void => {
    if (++nodes > 24000 || depth > 24) throw invalid();
    space();
    if (text[offset] === '"') {
      string();
      return;
    }
    if (text[offset] === "{" || text[offset] === "[") {
      const object = text[offset++] === "{",
        end = object ? "}" : "]",
        keys = new Set<string>();
      space();
      if (text[offset] === end) {
        offset++;
        return;
      }
      while (true) {
        if (object) {
          if (text[offset] !== '"') throw invalid();
          const key = string();
          if (
            keys.has(key) ||
            ["__proto__", "prototype", "constructor"].includes(key)
          ) throw invalid();
          keys.add(key);
          space();
          if (text[offset++] !== ":") throw invalid();
        }
        visit(depth + 1);
        space();
        if (text[offset] === end) {
          offset++;
          return;
        }
        if (text[offset++] !== ",") throw invalid();
        space();
      }
    }
    const token =
      /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/
        .exec(text.slice(offset));
    if (!token) throw invalid();
    if (
      /^-?[0-9]/.test(token[0]) &&
      (!Number.isFinite(Number(token[0])) ||
        JSON.stringify(Number(token[0])) !== token[0])
    ) throw invalid();
    offset += token[0].length;
  };
  visit(0);
  space();
  if (offset !== text.length) throw invalid();
  return JSON.parse(text);
}

export function parseECOSOwnerSourceViewRequest(
  text: string,
): ECOSOwnerSourceViewRequest {
  if (
    typeof text !== "string" ||
    enc.encode(text).length > ECOS_OWNER_SOURCE_VIEW_REQUEST_BYTES
  ) throw invalid();
  const b = strictJSON(text) as Data;
  if (
    !b || typeof b !== "object" || Array.isArray(b) ||
    Object.keys(b).sort().join(",") !==
      "answerSchemaVersion,citation,projectId,requestId,schemaVersion" ||
    b.schemaVersion !== ECOS_OWNER_SOURCE_VIEW_PROTOCOL ||
    !["ecos-owner-source-answer/2.1", "ecos-owner-source-answer/2.2"].includes(
      b.answerSchemaVersion as string,
    ) ||
    typeof b.projectId !== "string" || !UUID.test(b.projectId) ||
    typeof b.requestId !== "string" || !UUID.test(b.requestId) ||
    b.requestId[14] !== "4"
  ) throw invalid();
  const c = b.citation as Data;
  if (
    !c || typeof c !== "object" || Array.isArray(c) ||
    !["native_excerpt", "table_cell", "visual_page", "operational_observation"]
      .includes(c.kind as string) ||
    c.kind === "operational_observation" &&
      b.answerSchemaVersion !== "ecos-owner-source-answer/2.2"
  ) throw invalid();
  // The chosen internal resolver must validate its entire locator, expected
  // quote and exact owner scope before making its first source RPC.
  return freeze(b) as ECOSOwnerSourceViewRequest;
}

export interface ECOSOwnerSourceViewDependencies {
  enabled: boolean;
  authorize(
    token: string,
    projectId: string,
    signal: AbortSignal,
  ): Promise<ECOSV2PreviewScope | null>;
  /** Trusted server assembly only: use the distinct exact record/page resolvers
   * and serializer. Never pass normalized client data or a model-provided URL.
   * No model, question admission, auth refresh or project write belongs here. */
  resolve(
    scope: Readonly<ECOSV2PreviewScope>,
    request: ECOSOwnerSourceViewRequest,
    signal: AbortSignal,
    budgetMs: number,
  ): Promise<unknown>;
  budgetMs?: number;
  maxConcurrent?: number;
}

function scopeCopy(
  value: ECOSV2PreviewScope,
  projectId: string,
): Readonly<ECOSV2PreviewScope> {
  const s = copyECOSV2JSON(value, 2048) as ECOSV2PreviewScope;
  if (
    !s || typeof s !== "object" || Array.isArray(s) ||
    Object.keys(s).sort().join(",") !== "organizationId,ownerId,projectId" ||
    s.projectId !== projectId || typeof s.ownerId !== "string" ||
    !UUID.test(s.ownerId) ||
    s.organizationId !== s.ownerId
  ) throw invalid();
  return Object.freeze({
    organizationId: s.organizationId,
    ownerId: s.ownerId,
    projectId: s.projectId,
  });
}

/** Unwired source-reading HTTP boundary. Default off and fixed customer origin;
 * owner authorization runs before and after exact source read. Internal trusted
 * assembly remains responsible for source/result brands and wire serialization.
 *
 * Concurrency bounds are INSTANCE-LOCAL resource guards, not distributed hosted
 * rate limiting. They do not charge model questions. A timed-out resolver keeps
 * its slot until its promise settles, preventing overlapping abandoned reads.
 * Cancellation bounds our wait; it cannot prove remote database work stopped.
 * This function creates no deployment or route and performs no network itself. */
export function createECOSOwnerSourceViewHandler(
  input: ECOSOwnerSourceViewDependencies,
) {
  if (!input || Object.getPrototypeOf(input) !== Object.prototype) {
    throw invalid();
  }
  const d = Object.getOwnPropertyDescriptors(input),
    names = Reflect.ownKeys(input);
  if (
    names.some((k) =>
      typeof k !== "string" ||
      !["enabled", "authorize", "resolve", "budgetMs", "maxConcurrent"]
        .includes(k)
    ) ||
    ["enabled", "authorize", "resolve"].some((k) => !Object.hasOwn(d, k)) ||
    Object.values(d).some((p) => !p.enumerable || !Object.hasOwn(p, "value")) ||
    typeof d.enabled.value !== "boolean" ||
    typeof d.authorize.value !== "function" ||
    typeof d.resolve.value !== "function"
  ) throw invalid();
  const enabled = input.enabled,
    authorize = input.authorize,
    resolve = input.resolve;
  const budget = input.budgetMs ?? 30000,
    maxConcurrent = input.maxConcurrent ?? 4;
  if (
    !Number.isSafeInteger(budget) || budget < 1 || budget > 120000 ||
    !Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1 ||
    maxConcurrent > 4
  ) throw invalid();
  let active = 0;
  const owners = new Set<string>();
  return async (request: Request): Promise<Response> => {
    const started = performance.now();
    // Fixed private stages only. Never log caller tokens, source locators,
    // response bodies or exception messages, including on an auth failure.
    let phase = "request";
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      Vary: "Origin",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    };
    const cancelBody = () => {
      // Rejected uploads do not need draining. Cancellation is best effort and
      // never awaited: an uncooperative stream cannot delay an error response.
      try {
        void request.body?.cancel().catch(() => {});
      } catch { /* No payload diagnostics. */ }
    };
    const error = (code: string, status: number) => {
      cancelBody();
      return new Response(JSON.stringify({ error: code, source: null }), {
        status,
        headers,
      });
    };
    const origin = request.headers.get("origin");
    if (origin !== null && origin !== ORIGIN) {
      return error("origin_not_allowed", 403);
    }
    if (origin !== null) headers["Access-Control-Allow-Origin"] = origin;
    if (!enabled) return error("source_view_not_enabled", 503);
    if (request.method === "OPTIONS") {
      cancelBody();
      headers["Access-Control-Allow-Methods"] = "POST";
      headers["Access-Control-Allow-Headers"] = "authorization,content-type";
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== "POST") return error("method_not_allowed", 405);
    if (
      !/^application\/json(?:\s*;|$)/i.test(
        request.headers.get("content-type") ?? "",
      ) ||
      !["", "identity"].includes(request.headers.get("content-encoding") ?? "")
    ) return error("json_required", 415);
    const auth = request.headers.get("authorization");
    if (!auth || !/^Bearer [^\s]{1,8192}$/.test(auth)) {
      return error("sign_in_required", 401);
    }
    if (request.signal.aborted) return error("source_view_cancelled", 503);
    if (active >= maxConcurrent) return error("source_view_busy", 429);
    active++;
    let owner: string | null = null, released = false;
    const release = () => {
      if (!released) {
        released = true;
        active--;
        if (owner) owners.delete(owner);
      }
    };
    const child = new AbortController(), deadline = performance.now() + budget;
    const remaining = () => {
      const left = Math.floor(deadline - performance.now());
      if (request.signal.aborted || child.signal.aborted || left < 1) {
        throw invalid();
      }
      return left;
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort = () => {};
    const stopped = new Promise<never>((_, reject) => {
      abort = () => {
        child.abort();
        reject(invalid());
      };
      request.signal.addEventListener("abort", abort, { once: true });
      timer = setTimeout(abort, budget);
    });
    const run = async () => {
      remaining();
      let body: ECOSOwnerSourceViewRequest;
      try {
        body = parseECOSOwnerSourceViewRequest(
          await readECOSV2BoundedBody(
            request.body,
            ECOS_OWNER_SOURCE_VIEW_REQUEST_BYTES,
            child.signal,
          ),
        );
      } catch {
        remaining();
        return error("invalid_source_view_request", 400);
      }
      remaining();
      phase = "authorize_initial";
      const grant = await authorize(
        auth.slice(7),
        body.projectId,
        child.signal,
      );
      remaining();
      if (!grant) return error("project_access_denied", 403);
      const scope = scopeCopy(grant, body.projectId);
      if (owners.has(scope.ownerId)) return error("source_view_busy", 429);
      owner = scope.ownerId;
      owners.add(owner);
      phase = "resolve_source";
      const value = await resolve(scope, body, child.signal, remaining());
      remaining();
      // Reject getters/typed buffers/non-JSON before final authorization. PNGs
      // must be explicitly serialized by the reviewed server adapter, not here.
      phase = "serialize_source";
      const source = copyECOSV2JSON(
        value,
        ECOS_OWNER_SOURCE_VIEW_RESPONSE_BYTES,
      );
      remaining();
      phase = "authorize_final";
      const finalGrant = await authorize(
        auth.slice(7),
        body.projectId,
        child.signal,
      );
      remaining();
      if (
        !finalGrant ||
        JSON.stringify(scopeCopy(finalGrant, body.projectId)) !==
          JSON.stringify(scope)
      ) return error("project_access_denied", 403);
      phase = "response";
      const text = JSON.stringify({
        schemaVersion: ECOS_OWNER_SOURCE_VIEW_PROTOCOL,
        projectId: scope.projectId,
        requestId: body.requestId,
        preview: true,
        read_only: true,
        server_checks: "owner_before_and_after_source_read_only",
        source,
      });
      if (enc.encode(text).length > ECOS_OWNER_SOURCE_VIEW_RESPONSE_BYTES) {
        throw invalid();
      }
      remaining();
      return new Response(text, { status: 200, headers });
    };
    // Capture both branches so late failures do not become unhandled rejections.
    const work = run().finally(release);
    try {
      return await Promise.race([work, stopped]);
    } catch {
      try {
        console.warn(JSON.stringify({
          event: "ecos_owner_source_view_failed",
          phase,
          elapsedMs: Math.round(performance.now() - started),
        }));
      } catch { /* Diagnostics never change the fail-closed response. */ }
      return error(
        request.signal.aborted
          ? "source_view_cancelled"
          : "source_view_unavailable",
        503,
      );
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      request.signal.removeEventListener("abort", abort);
      child.abort();
    }
  };
}
