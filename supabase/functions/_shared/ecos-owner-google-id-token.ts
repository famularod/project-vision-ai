/** Server-only credential supplier, composed by default-off private gateways.
 * No keys, sessions, IAM changes or
 * gateway/runtime dispatch are performed by construction. Original JWT checks
 * below are syntax/claim prechecks, NOT signature verification or owner access.
 * Google STS verifies the external signature; Cloud Run verifies the Google ID
 * token. The original bearer and current before/after application checks remain
 * mandatory. This is OWNER USER delegation, not proof of an Edge workload.
 *
 * Google service-account ID tokens have a one-hour validity and cannot be
 * individually revoked. Discarding them locally does not shorten that validity.
 * IAM-authenticated Internet ingress is not internal-only networking.
 * https://docs.cloud.google.com/run/docs/authenticating/service-to-service
 * https://docs.cloud.google.com/docs/authentication/token-types
 */
export const ECOS_OWNER_GOOGLE_ISSUER =
  "https://xdytqlpsqsseoeuxgzre.supabase.co/auth/v1";
export const ECOS_OWNER_GOOGLE_ORIGINAL_AUDIENCE = "authenticated";
const STS = "https://sts.googleapis.com/v1/token";
const IAM = "https://iamcredentials.googleapis.com/v1/";
const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const PROVIDER =
  /^\/\/iam\.googleapis\.com\/projects\/[1-9][0-9]{5,19}\/locations\/global\/workloadIdentityPools\/(?!gcp-)[a-z][a-z0-9-]{3,31}\/providers\/(?!gcp-)[a-z][a-z0-9-]{3,31}$/;
const INVOKER =
  /^projects\/-\/serviceAccounts\/([a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com)$/;
const BODY_CAP = 32 * 1024, TOKEN_CAP = 16 * 1024;
const encoder = new TextEncoder();
const aborted = Object.getOwnPropertyDescriptor(
  AbortSignal.prototype,
  "aborted",
)!.get!;
const add = EventTarget.prototype.addEventListener;
const remove = EventTarget.prototype.removeEventListener;
type Data = Record<string, unknown>;
type Config = Readonly<{
  ownerId: string;
  providerResource: string;
  invokerResource: string;
  serviceURL: string;
  fetchImpl?: typeof fetch;
}>;
export type ECOSOwnerGoogleIDToken = Readonly<{
  owner_id: string;
  provider_resource: string;
  invoker_resource: string;
  service_url: string;
  headers: Readonly<
    { Authorization: string; "X-Serverless-Authorization": string }
  >;
  original_expires_at: number;
  google_expires_at: number;
  delegation: "owner_user_not_edge_service_identity";
  original_signature_verified_locally: false;
  google_signature_verified_locally: false;
  session_revocation_checked: false;
  application_authorized: false;
  internal_ingress_established: false;
  google_id_token_individually_revocable: false;
}>;
const origins = new WeakMap<
  object,
  { deadline: number; signal: AbortSignal }
>();
const unavailable = (): never => {
  throw new Error("Owner Google credential unavailable");
};
function assert(value: unknown): asserts value {
  if (!value) unavailable();
}
function snapshot(
  value: unknown,
  required: string[],
  optional: string[] = [],
): Data {
  assert(value !== null && typeof value === "object" && !Array.isArray(value));
  assert([Object.prototype, null].includes(Object.getPrototypeOf(value)));
  const keys = Reflect.ownKeys(value);
  assert(
    keys.length ===
      required.length +
        keys.filter((k) => typeof k === "string" && optional.includes(k))
          .length,
  );
  assert(required.every((k) => keys.includes(k)));
  const out: Data = Object.create(null);
  for (const key of keys) {
    assert(typeof key === "string" && [...required, ...optional].includes(key));
    const d = Object.getOwnPropertyDescriptor(value, key);
    assert(d?.enumerable && Object.hasOwn(d, "value"));
    out[key] = d.value;
  }
  return out;
}
/** Bounded strict JSON parser. Duplicate/unsafe keys and invalid Unicode cannot
 * be normalized away; security-relevant top-level numbers retain raw tokens. */
function json(raw: string): { value: Data; numbers: Map<string, string> } {
  assert(raw.length <= BODY_CAP && encoder.encode(raw).length <= BODY_CAP);
  let at = 0, nodes = 0;
  const numbers = new Map<string, string>();
  const space = () => {
    while (/[ \t\r\n]/.test(raw[at] ?? "!")) at++;
  };
  const string = () => {
    assert(raw[at] === '"');
    const start = at++;
    while (at < raw.length) {
      if (raw[at] === '"') {
        const value: unknown = JSON.parse(raw.slice(start, ++at));
        assert(typeof value === "string");
        for (const c of value) {
          const n = c.codePointAt(0)!;
          assert(n !== 0 && !(n >= 0xd800 && n <= 0xdfff));
        }
        return value;
      }
      if (raw[at++] === "\\") at++;
    }
    return unavailable();
  };
  const parse = (depth: number, key = ""): unknown => {
    assert(++nodes <= 2048 && depth <= 16);
    space();
    if (raw[at] === '"') return string();
    if (raw[at] === "{" || raw[at] === "[") {
      const object = raw[at++] === "{", end = object ? "}" : "]";
      const out: Data = Object.create(null), values: unknown[] = [];
      space();
      if (raw[at] === end) {
        at++;
        return object ? out : values;
      }
      while (true) {
        space();
        let name = "";
        if (object) {
          name = string();
          assert(
            !["__proto__", "prototype", "constructor"].includes(name) &&
              !Object.hasOwn(out, name),
          );
          space();
          assert(raw[at++] === ":");
        }
        const next = parse(depth + 1, name);
        if (object) out[name] = next;
        else values.push(next);
        space();
        if (raw[at] === end) {
          at++;
          return object ? out : values;
        }
        assert(raw[at++] === ",");
      }
    }
    const token =
      /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/
        .exec(raw.slice(at))?.[0];
    assert(token);
    at += token.length;
    if (token === "true") return true;
    if (token === "false") return false;
    if (token === "null") return null;
    const n = Number(token);
    assert(Number.isFinite(n));
    if (depth === 1) numbers.set(key, token);
    return n;
  };
  const value = parse(0);
  space();
  assert(
    at === raw.length && value !== null && typeof value === "object" &&
      !Array.isArray(value),
  );
  return { value: value as Data, numbers };
}
function integer(parsed: ReturnType<typeof json>, name: string): number {
  const token = parsed.numbers.get(name), value = parsed.value[name];
  assert(token && /^(?:0|[1-9][0-9]*)$/.test(token));
  assert(typeof value === "number" && Number.isSafeInteger(value));
  return value;
}
function base64url(value: string): Uint8Array {
  assert(/^[A-Za-z0-9_-]+$/.test(value) && value.length <= TOKEN_CAP);
  const bytes = Uint8Array.from(
    atob(value.replace(/-/g, "+").replace(/_/g, "/")),
    (c) => c.charCodeAt(0),
  );
  const canonical = btoa(String.fromCharCode(...bytes)).replace(/=/g, "")
    .replace(/\+/g, "-").replace(/\//g, "_");
  assert(canonical === value);
  return bytes;
}
function jwt(token: string, alg: "ES256" | "RS256") {
  assert(token.length <= TOKEN_CAP);
  const parts = token.split(".");
  assert(parts.length === 3);
  const header =
    json(new TextDecoder("utf-8", { fatal: true }).decode(base64url(parts[0])))
      .value;
  const h = snapshot(header, ["alg", "kid"], ["typ"]);
  assert(
    h.alg === alg && typeof h.kid === "string" &&
      /^[A-Za-z0-9_-]{1,128}$/.test(h.kid),
  );
  assert(h.typ === undefined || h.typ === "JWT");
  const signature = base64url(parts[2]);
  assert(
    alg === "ES256"
      ? signature.length === 64
      : signature.length >= 128 && signature.length <= 512,
  );
  return json(
    new TextDecoder("utf-8", { fatal: true }).decode(base64url(parts[1])),
  );
}
function times(parsed: ReturnType<typeof json>, maximumLifetime: number) {
  const now = Math.floor(Date.now() / 1000),
    exp = integer(parsed, "exp"),
    iat = integer(parsed, "iat");
  assert(
    exp > now && iat <= now + 30 && iat >= 0 && exp > iat &&
      exp - iat <= maximumLifetime,
  );
  if (Object.hasOwn(parsed.value, "nbf")) {
    assert(integer(parsed, "nbf") <= now + 30);
  }
  return exp;
}
function discard(body: ReadableStream<Uint8Array> | null) {
  try {
    void body?.cancel().catch(() => {});
  } catch { /* No cleanup wait. */ }
}
export function assertECOSOwnerGoogleIDToken(
  value: unknown,
): asserts value is ECOSOwnerGoogleIDToken {
  assert(value !== null && typeof value === "object");
  const origin = origins.get(value);
  assert(origin);
  const result = value as ECOSOwnerGoogleIDToken;
  assert(
    !aborted.call(origin.signal) && performance.now() < origin.deadline &&
      Math.floor(Date.now() / 1000) <
        Math.min(result.original_expires_at, result.google_expires_at),
  );
}

export function createECOSOwnerGoogleIDTokenSupplier(config: Config) {
  try {
    return makeSupplier(config);
  } catch {
    return unavailable();
  }
}
function makeSupplier(config: Config) {
  const c = snapshot(config, [
    "ownerId",
    "providerResource",
    "invokerResource",
    "serviceURL",
  ], ["fetchImpl"]);
  assert(typeof c.ownerId === "string" && UUID.test(c.ownerId));
  assert(
    typeof c.providerResource === "string" && PROVIDER.test(c.providerResource),
  );
  assert(typeof c.invokerResource === "string");
  const account = INVOKER.exec(c.invokerResource)?.[1];
  assert(account);
  assert(typeof c.serviceURL === "string");
  const service = new URL(c.serviceURL);
  assert(
    service.protocol === "https:" &&
      // Canonical Cloud Run hosts include regional labels (for example .a.run.app).
      // Still pin the exact configured origin as the token audience.
      /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+run\.app$/.test(
        service.hostname,
      ) &&
      !service.port && !service.username && !service.password &&
      !service.search && !service.hash && service.pathname === "/" &&
      c.serviceURL === service.origin,
  );
  const fetchImpl = c.fetchImpl === undefined ? fetch : c.fetchImpl;
  assert(typeof fetchImpl === "function");
  const owner = c.ownerId,
    provider = c.providerResource,
    invoker = c.invokerResource,
    serviceURL = c.serviceURL;
  const target = IAM + invoker + ":generateIdToken";
  const supply = async (
    originalAuthorization: string,
    options: { signal: AbortSignal; deadline: number },
  ): Promise<ECOSOwnerGoogleIDToken> => {
    const started = performance.now();
    // Snapshot all caller data before any asynchronous operation. No caller
    // Google header, URL, scope, key or replacement token can enter this API.
    const o = snapshot(options, ["signal", "deadline"]);
    assert(
      typeof o.deadline === "number" && Number.isFinite(o.deadline) &&
        o.deadline > started && o.deadline - started <= 125000,
    );
    const deadline = o.deadline, signal = o.signal as AbortSignal;
    assert(!aborted.call(signal));
    const child = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectStopped: (error: Error) => void = () => {};
    const stopped = new Promise<never>((_, reject) => {
      rejectStopped = reject;
    });
    const cancel = () => {
      child.abort();
      rejectStopped(new Error("Owner Google credential unavailable"));
    };
    const check = () => {
      assert(
        !aborted.call(signal) && !child.signal.aborted &&
          performance.now() < deadline,
      );
    };
    const work = async () => {
      check();
      assert(
        typeof originalAuthorization === "string" &&
          originalAuthorization.length <= 8199,
      );
      const match = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(originalAuthorization);
      assert(match);
      const original = match[1],
        parsed = jwt(original, "ES256"),
        p = parsed.value;
      assert(
        p.iss === ECOS_OWNER_GOOGLE_ISSUER &&
          p.aud === ECOS_OWNER_GOOGLE_ORIGINAL_AUDIENCE && p.sub === owner &&
          p.role === "authenticated" && p.is_anonymous === false,
      );
      const originalExpiry = times(parsed, 86400);
      const request = async (
        url: string,
        body: Data,
        authorization?: string,
      ) => {
        check();
        const response = await fetchImpl(url, {
          method: "POST",
          redirect: "error",
          credentials: "omit",
          cache: "no-store",
          signal: child.signal,
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            ...(authorization ? { Authorization: authorization } : {}),
          },
          body: JSON.stringify(body),
        });
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        const close = () => {
          if (reader) {
            try {
              void reader.cancel().catch(() => {});
            } catch { /* No cleanup wait. */ }
          } else discard(response.body);
        };
        try {
          check();
          assert(
            response instanceof Response && response.url === url &&
              !response.redirected && response.status === 200,
          );
          assert(
            /^application\/json(?:\s*;|$)/i.test(
              response.headers.get("content-type") ?? "",
            ),
          );
          const length = response.headers.get("content-length");
          if (length !== null) {
            assert(
              /^(?:0|[1-9][0-9]*)$/.test(length) &&
                Number.isSafeInteger(Number(length)) &&
                Number(length) <= BODY_CAP,
            );
          }
          assert(response.body);
          reader = response.body.getReader();
          add.call(child.signal, "abort", close, { once: true });
          const bytes = new Uint8Array(BODY_CAP);
          let used = 0, count = 0;
          while (true) {
            check();
            assert(++count <= 1024);
            const next = await reader.read();
            check();
            if (next.done) break;
            assert(
              next.value instanceof Uint8Array &&
                used + next.value.length <= BODY_CAP,
            );
            bytes.set(next.value, used);
            used += next.value.length;
          }
          const encoding = response.headers.get("content-encoding");
          if (
            length !== null &&
            (encoding === null || encoding.toLowerCase() === "identity")
          ) assert(Number(length) === used);
          const result = json(
            new TextDecoder("utf-8", { fatal: true }).decode(
              bytes.subarray(0, used),
            ),
          );
          check();
          return result;
        } finally {
          remove.call(child.signal, "abort", close);
          close();
          try {
            reader?.releaseLock();
          } catch { /* A late read may still own it. */ }
        }
      };
      const sts = await request(STS, {
        grantType: "urn:ietf:params:oauth:grant-type:token-exchange",
        audience: provider,
        scope: "https://www.googleapis.com/auth/iam",
        requestedTokenType: "urn:ietf:params:oauth:token-type:access_token",
        subjectToken: original,
        subjectTokenType: "urn:ietf:params:oauth:token-type:jwt",
      });
      const s = snapshot(sts.value, [
        "access_token",
        "issued_token_type",
        "token_type",
        "expires_in",
      ]);
      assert(
        typeof s.access_token === "string" &&
          /^[\x21-\x7e]{1,12288}$/.test(s.access_token),
      );
      assert(
        s.token_type === "Bearer" &&
          s.issued_token_type ===
            "urn:ietf:params:oauth:token-type:access_token",
      );
      const lifetime = integer(sts, "expires_in");
      assert(lifetime > 0 && lifetime <= 86400);
      check();
      assert(Math.floor(Date.now() / 1000) < originalExpiry);
      const iam = await request(target, {
        audience: serviceURL,
        includeEmail: true,
      }, `Bearer ${s.access_token}`);
      const i = snapshot(iam.value, ["token"]);
      assert(typeof i.token === "string");
      const google = jwt(i.token, "RS256"), g = google.value;
      assert(
        g.iss === "https://accounts.google.com" && g.aud === serviceURL &&
          g.email === account && g.email_verified === true &&
          typeof g.sub === "string" && /^[1-9][0-9]{5,24}$/.test(g.sub),
      );
      const googleExpiry = times(google, 3600);
      check();
      assert(Math.floor(Date.now() / 1000) < originalExpiry);
      const result: ECOSOwnerGoogleIDToken = Object.freeze({
        owner_id: owner,
        provider_resource: provider,
        invoker_resource: invoker,
        service_url: serviceURL,
        headers: Object.freeze({
          Authorization: originalAuthorization,
          "X-Serverless-Authorization": `Bearer ${i.token}`,
        }),
        original_expires_at: originalExpiry,
        google_expires_at: googleExpiry,
        delegation: "owner_user_not_edge_service_identity",
        original_signature_verified_locally: false,
        google_signature_verified_locally: false,
        session_revocation_checked: false,
        application_authorized: false,
        internal_ingress_established: false,
        google_id_token_individually_revocable: false,
      });
      origins.set(result, { deadline, signal });
      return result;
    };
    try {
      add.call(signal, "abort", cancel, { once: true });
      check();
      timer = setTimeout(cancel, Math.max(1, deadline - performance.now()));
      return await Promise.race([stopped, work()]);
    } catch {
      // Never expose original/STS/Google tokens or raw provider error bodies.
      return unavailable();
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      remove.call(signal, "abort", cancel);
      child.abort();
    }
  };
  return async (
    ...args: Parameters<typeof supply>
  ): Promise<ECOSOwnerGoogleIDToken> => {
    try {
      return await supply(...args);
    } catch {
      return unavailable();
    }
  };
}
