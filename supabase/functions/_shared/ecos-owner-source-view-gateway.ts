import {
  createECOSOwnerPrivateGatewayIdentity,
  type ECOSOwnerPrivateGatewayIdentity,
} from "./ecos-owner-private-gateway-identity.ts";
import {
  parseECOSOwnerGatewayJSON as json,
  readECOSOwnerGatewayBody as read,
} from "./ecos-owner-preview-gateway.ts";

/** Thin/default-off forwarding only. No model, source RPC, decoder or service
 * credential dependency. Server must authorize original caller before/after;
 * client must validate the distinct record/page wire. Package/envelope checks
 * here are NOT semantic verification, IAM security or an authenticity proof.
 * One instance-local read slot bounds buffering, not distributed admission. */
export interface ECOSOwnerSourceViewGatewayConfig {
  enabled?: boolean;
  sourceURL?: string;
  gatewayToken?: string;
  packagedSourceSha256?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Required by hosted entrypoints; optional only for isolated transport tests. */
  googleIdentity?: ECOSOwnerPrivateGatewayIdentity;
}
const ORIGIN = "https://project-photo-update-tool.expo.app";
const PROTOCOL = "ecos-owner-source-view/2.2";
const CAP = 12 * 1024 * 1024;
const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const encoder = new TextEncoder();
type Data = Record<string, unknown>;
const stop = () => {
  throw Error("Source view unavailable");
};
function obj(v: unknown, keys?: string[]): Data {
  if (!v || Object.getPrototypeOf(v) !== Object.prototype) return stop();
  const names = Reflect.ownKeys(v), d = Object.getOwnPropertyDescriptors(v);
  if (
    names.some((k) =>
      typeof k !== "string" ||
      ["__proto__", "prototype", "constructor"].includes(k)
    ) ||
    Object.values(d).some((p) => !p.enumerable || !Object.hasOwn(p, "value")) ||
    keys &&
      (names.length !== keys.length || keys.some((k) => !names.includes(k)))
  ) return stop();
  return Object.fromEntries(Object.entries(d).map(([k, p]) => [k, p.value]));
}
const discard = (s: ReadableStream<Uint8Array> | null) => {
  try {
    void s?.cancel().catch(() => {});
  } catch { /* no wait */ }
};
const errors = {
  origin_not_allowed: 403,
  source_view_not_enabled: 503,
  method_not_allowed: 405,
  json_required: 415,
  sign_in_required: 401,
  invalid_source_view_request: 400,
  project_access_denied: 403,
  source_view_busy: 429,
  source_view_cancelled: 503,
  source_view_unavailable: 503,
} as const;
type ErrorCode = keyof typeof errors;

export function createECOSOwnerSourceViewGateway(
  config: ECOSOwnerSourceViewGatewayConfig = {},
) {
  const c = obj(config);
  if (
    Object.keys(c).some((k) =>
      ![
        "enabled",
        "sourceURL",
        "gatewayToken",
        "packagedSourceSha256",
        "fetchImpl",
        "timeoutMs",
        "googleIdentity",
      ].includes(k)
    )
  ) stop();
  const enabled = c.enabled === undefined ? false : c.enabled;
  const timeoutMs = c.timeoutMs === undefined ? 125000 : c.timeoutMs;
  const fetchImpl = c.fetchImpl === undefined ? fetch : c.fetchImpl;
  if (
    typeof enabled !== "boolean" || typeof fetchImpl !== "function" ||
    !Number.isSafeInteger(timeoutMs) ||
    (timeoutMs as number) < 1 || (timeoutMs as number) > 125000
  ) stop();
  const { sourceURL, gatewayToken, packagedSourceSha256 } = c;
  if (enabled) {
    if (
      typeof sourceURL !== "string" || sourceURL.length > 500 ||
      typeof gatewayToken !== "string" ||
      !/^[A-Za-z0-9_-]{32,256}$/.test(gatewayToken) ||
      typeof packagedSourceSha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(packagedSourceSha256)
    ) stop();
    const u = new URL(sourceURL as string);
    if (
      u.href !== sourceURL || u.protocol !== "https:" || u.username ||
      u.password || u.port || u.search || u.hash || u.pathname !== "/source" ||
      !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+run\.app$/.test(u.hostname)
    ) stop();
  }
  const googleIdentity = enabled && c.googleIdentity !== undefined
    ? createECOSOwnerPrivateGatewayIdentity(
      c.googleIdentity as ECOSOwnerPrivateGatewayIdentity,
      new URL(sourceURL as string).origin,
      fetchImpl as typeof fetch,
    )
    : undefined;
  let occupied = false;
  return async (request: Request): Promise<Response> => {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      vary: "Origin",
    };
    const error = (code: ErrorCode) => {
      discard(request.body);
      return new Response(JSON.stringify({ error: code, source: null }), {
        status: errors[code],
        headers,
      });
    };
    const origin = request.headers.get("origin");
    if (origin !== null && origin !== ORIGIN) {
      return error("origin_not_allowed");
    }
    if (origin !== null) headers["access-control-allow-origin"] = origin;
    if (!enabled) return error("source_view_not_enabled");
    const u = new URL(request.url);
    if (
      u.search || u.hash ||
      !["/ecos-source-preview", "/functions/v1/ecos-source-preview"].includes(
        u.pathname,
      )
    ) return error("invalid_source_view_request");
    if (request.method === "OPTIONS") {
      if (
        origin === null ||
        request.headers.get("access-control-request-method") !== "POST" ||
        (request.headers.get("access-control-request-headers") ?? "").split(",")
          .filter((x) => x.trim()).some((x) =>
            !["authorization", "content-type"].includes(x.trim().toLowerCase())
          )
      ) return error("origin_not_allowed");
      headers["access-control-allow-methods"] = "POST";
      headers["access-control-allow-headers"] = "authorization,content-type";
      discard(request.body);
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== "POST") return error("method_not_allowed");
    if (
      !/^application\/json(?:\s*;|$)/i.test(
        request.headers.get("content-type") ?? "",
      ) ||
      request.headers.has("content-encoding") &&
        request.headers.get("content-encoding") !== "identity"
    ) return error("json_required");
    const authorization = request.headers.get("authorization");
    if (
      !authorization || !/^Bearer [A-Za-z0-9._~-]{1,8192}$/.test(authorization)
    ) return error("sign_in_required");
    if (request.signal.aborted) return error("source_view_cancelled");
    if (occupied) return error("source_view_busy");
    occupied = true;
    const child = new AbortController(),
      deadline = performance.now() + (timeoutMs as number);
    const check = () => {
      if (
        request.signal.aborted || child.signal.aborted ||
        performance.now() >= deadline
      ) stop();
    };
    let abort = () => {},
      response: Response | undefined,
      work: Promise<Response> | undefined;
    const stopped = new Promise<never>((_, reject) => {
      abort = () => {
        child.abort();
        reject(Error("Source read stopped"));
      };
    });
    request.signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, timeoutMs as number);
    try {
      work = (async () => {
        check();
        let input: Data, requestText: string;
        try {
          requestText = await read(
            request.body,
            request.headers,
            384 * 1024,
            child.signal,
            check,
          );
          input = obj(
            json(requestText),
            [
              "schemaVersion",
              "answerSchemaVersion",
              "projectId",
              "requestId",
              "citation",
            ],
          );
          if (
            input.schemaVersion !== PROTOCOL ||
            !["ecos-owner-source-answer/2.1", "ecos-owner-source-answer/2.2"]
              .includes(input.answerSchemaVersion as string) ||
            typeof input.projectId !== "string" ||
            !UUID.test(input.projectId) ||
            typeof input.requestId !== "string" ||
            !UUID.test(input.requestId) || input.requestId[14] !== "4"
          ) stop();
          const citation = obj(input.citation);
          if (
            ![
              "native_excerpt",
              "table_cell",
              "visual_page",
              "operational_observation",
            ].includes(citation.kind as string) ||
            citation.kind === "operational_observation" &&
              input.answerSchemaVersion !== "ecos-owner-source-answer/2.2"
          ) stop();
        } catch {
          check();
          return error("invalid_source_view_request");
        }
        check();
        const outgoing: Record<string, string> = {
          authorization,
          "content-type": "application/json",
          accept: "application/json",
          "x-ecos-preview-gateway-token": gatewayToken as string,
        };
        if (origin !== null) outgoing.origin = origin;
        if (googleIdentity) {
          outgoing["x-serverless-authorization"] = await googleIdentity(
            authorization,
            { signal: child.signal, deadline },
          );
        }
        check();
        response = await (fetchImpl as typeof fetch)(sourceURL as string, {
          method: "POST",
          // Preserve numeric tokens and all original text for the downstream
          // stricter grammar. Parsing must not normalize an invalid citation.
          body: requestText,
          headers: outgoing,
          signal: child.signal,
          redirect: "error",
          cache: "no-store",
          credentials: "omit",
        });
        if (!(response instanceof Response)) stop();
        check();
        if (
          response.redirected || response.url !== sourceURL ||
          response.headers.get("x-ecos-owner-packaged-source-sha256") !==
            packagedSourceSha256 ||
          !/^application\/json(?:\s*;|$)/i.test(
            response.headers.get("content-type") ?? "",
          )
        ) stop();
        const responseText = await read(
          response.body,
          response.headers,
          CAP,
          child.signal,
          check,
        );
        const raw = json(responseText);
        check();
        if (response.status !== 200) {
          const failure = obj(raw, ["error", "source"]);
          if (
            failure.source !== null || typeof failure.error !== "string" ||
            !Object.hasOwn(errors, failure.error) ||
            errors[failure.error as ErrorCode] !== response.status
          ) stop();
          return error(failure.error as ErrorCode);
        }
        const out = obj(raw, [
          "schemaVersion",
          "projectId",
          "requestId",
          "preview",
          "read_only",
          "server_checks",
          "source",
        ]);
        if (
          out.schemaVersion !== PROTOCOL || out.projectId !== input.projectId ||
          out.requestId !== input.requestId || out.preview !== true ||
          out.read_only !== true ||
          out.server_checks !== "owner_before_and_after_source_read_only"
        ) stop();
        // Nested row/image authenticity and binding are server+client duties,
        // not inferred here from an HTTP200 or source-manifest header.
        const source = obj(out.source);
        if (
          !["document_page", "operational_record"].includes(
            source.kind as string,
          )
        ) stop();
        if (encoder.encode(responseText).length > CAP) stop();
        check();
        return new Response(responseText, { status: 200, headers });
      })();
      return await Promise.race([work, stopped]);
    } catch {
      return error(
        request.signal.aborted
          ? "source_view_cancelled"
          : "source_view_unavailable",
      );
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener("abort", abort);
      child.abort();
      discard(response?.body ?? null);
      // Retain the slot if a downstream fetch/read ignores cancellation; no
      // overlapping accumulation is allowed after the caller deadline returns.
      if (work) {
        void work.then(() => {
          discard(response?.body ?? null);
          occupied = false;
        }, () => {
          discard(response?.body ?? null);
          occupied = false;
        });
      } else occupied = false;
    }
  };
}
