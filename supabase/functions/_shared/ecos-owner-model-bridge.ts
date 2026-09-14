/** Server-to-server model transport. Provider credentials stay in Supabase.
 * This is not an owner authorization or evidence authority: the query runtime
 * must authenticate/admit the question and verify source images before calling.
 * No original PDFs, URLs, tools, sessions, retries, or provider-key export. */
import {
  copyECOSV2JSON,
  createECOSV2JSONModel,
  type ECOSV2JSONModel,
  type ECOSV2JSONModelRequest,
  type ECOSV2PNGImage,
  prepareECOSV2PNGImageContent,
  readECOSV2BoundedBody,
} from "./ecos-v2-json-model.ts";

export const ECOS_OWNER_MODEL_BRIDGE_URL =
  "https://xdytqlpsqsseoeuxgzre.supabase.co/functions/v1/ecos-owner-model-bridge";
const SCHEMA = "ecos-owner-model-bridge/1";
const WIRE = 12 * 1024 * 1024, OUTPUT = 256 * 1024;
const IMAGE_BYTES = 8 * 1024 * 1024;
const TEXT_KEYS = [
  "stage",
  "instructions",
  "input",
  "schemaName",
  "schema",
  "maxOutputTokens",
];
const IMAGE_KEYS = [
  "imageId",
  "sourceId",
  "sourceSha256",
  "pageNumber",
  "sourcePageCount",
  "rasterSha256",
];
const encoder = new TextEncoder();
const unavailable = () => new Error("Private model bridge unavailable");
function data(
  value: unknown,
  required: string[],
  optional: string[] = [],
): Record<string, unknown> {
  if (
    !value || typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) throw unavailable();
  const d = Object.getOwnPropertyDescriptors(value);
  if (
    required.some((k) => !Object.hasOwn(d, k)) ||
    Reflect.ownKeys(value).some((k) =>
      typeof k !== "string" || ![...required, ...optional].includes(k)
    ) ||
    Object.values(d).some((p) => !p.enumerable || !Object.hasOwn(p, "value"))
  ) throw unavailable();
  return Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.value]));
}
function credentials(serviceKey: string, workerToken: string, model: string) {
  if (
    typeof serviceKey !== "string" || !/^[!-~]{1,8192}$/.test(serviceKey) ||
    typeof workerToken !== "string" ||
    !/^[A-Za-z0-9_-]{32,256}$/.test(workerToken) ||
    typeof model !== "string" || !/^[a-zA-Z0-9._:-]{1,120}$/.test(model)
  ) throw unavailable();
}
function textRequest(value: unknown) {
  const v = data(value, TEXT_KEYS, ["images"]);
  const text = copyECOSV2JSON(
    Object.fromEntries(TEXT_KEYS.map((k) => [k, v[k]])),
    128 * 1024,
  ) as Record<string, unknown>;
  if (
    !["interpret", "plan", "compose", "verify"].includes(String(text.stage)) ||
    typeof text.instructions !== "string" || !text.instructions.trim() ||
    encoder.encode(text.instructions).length > 16384 ||
    typeof text.schemaName !== "string" ||
    !/^[a-zA-Z0-9_-]{1,64}$/.test(text.schemaName) ||
    !Number.isSafeInteger(text.maxOutputTokens) ||
    Number(text.maxOutputTokens) < 1 || Number(text.maxOutputTokens) > 6000 ||
    (v.images !== undefined &&
      !["compose", "verify"].includes(String(text.stage)))
  ) throw unavailable();
  copyECOSV2JSON(text.input, 96 * 1024);
  copyECOSV2JSON(text.schema, 24 * 1024);
  return { text, images: v.images };
}
function bounded<T>(
  signal: AbortSignal,
  milliseconds: number,
  run: (signal: AbortSignal, check: () => void) => Promise<T>,
): Promise<T> {
  if (!(signal instanceof AbortSignal) || signal.aborted) {
    return Promise.reject(unavailable());
  }
  const controller = new AbortController();
  const deadline = performance.now() + milliseconds;
  const check = () => {
    if (
      controller.signal.aborted || signal.aborted ||
      performance.now() >= deadline
    ) throw unavailable();
  };
  let timer: ReturnType<typeof setTimeout>;
  let stop: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    stop = () => {
      controller.abort();
      reject(unavailable());
    };
    signal.addEventListener("abort", stop, { once: true });
    timer = setTimeout(stop, milliseconds);
  });
  let running: Promise<T>;
  try {
    check();
    // Invoke synchronously so caller-owned bytes are copied before a yield.
    running = run(controller.signal, check).then((value) => {
      check();
      return value;
    });
  } catch (error) {
    running = Promise.reject(error);
  }
  return Promise.race([running, cancelled]).finally(() => {
    clearTimeout(timer!);
    signal.removeEventListener("abort", stop!);
    controller.abort();
  });
}
async function matches(actual: string | null, expected: string) {
  if (actual === null || actual.length > 10000) return false;
  const hashes = await Promise.all(
    [actual, expected].map((v) =>
      crypto.subtle.digest("SHA-256", encoder.encode(v))
    ),
  );
  const a = new Uint8Array(hashes[0]), b = new Uint8Array(hashes[1]);
  let different = 0;
  for (let i = 0; i < a.length; i++) different |= a[i] ^ b[i];
  return different === 0;
}
function cancelBody(response: Response) {
  try {
    void response.body?.cancel().catch(() => {});
  } catch { /* no raw diagnostics */ }
}

/** One instance per admitted question. Maximum four calls, including failures. */
export function createECOSOwnerBridgeModel(options: {
  serviceRoleKey: string;
  workerToken: string;
  model: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxCalls?: number;
}): ECOSV2JSONModel {
  const {
    serviceRoleKey,
    workerToken,
    model,
    fetchImpl = fetch,
    timeoutMs = 30000,
    maxCalls = 4,
  } = options;
  credentials(serviceRoleKey, workerToken, model);
  if (
    typeof fetchImpl !== "function" || !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 || timeoutMs > 30000 ||
    !Number.isSafeInteger(maxCalls) || maxCalls < 1 || maxCalls > 4
  ) throw unavailable();
  let calls = 0;
  return async (request, signal) => {
    if (calls >= maxCalls) throw unavailable();
    calls++;
    try {
      // Copy text and validate/copy image identities BEFORE asynchronous work.
      return await bounded(signal, timeoutMs, async (active, check) => {
        const captured = textRequest(request);
        const wire: Record<string, unknown> = captured.text;
        if (captured.images !== undefined) {
          const prepared = await prepareECOSV2PNGImageContent(
            captured.images as ECOSV2PNGImage[],
            active,
          );
          check();
          wire.images = prepared.identities.map((identity, i) => {
            const content = prepared.content[i + 1];
            if (content.type !== "input_image") throw unavailable();
            return {
              ...Object.fromEntries(
                IMAGE_KEYS.map(
                  (k) => [k, identity[k as keyof typeof identity]],
                ),
              ),
              pngBase64: content.image_url.slice(
                "data:image/png;base64,".length,
              ),
            };
          });
        }
        const body = JSON.stringify({
          schemaVersion: SCHEMA,
          model,
          request: wire,
        });
        check();
        if (encoder.encode(body).length > WIRE) {
          throw unavailable();
        }
        const response = await fetchImpl(ECOS_OWNER_MODEL_BRIDGE_URL, {
          method: "POST",
          redirect: "error",
          credentials: "omit",
          cache: "no-store",
          signal: active,
          headers: {
            "Content-Type": "application/json",
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`,
            "x-ecos-worker-token": workerToken,
          },
          body,
        });
        try {
          check();
        } catch {
          cancelBody(response);
          throw unavailable();
        }
        if (
          active.aborted || response.status !== 200 || response.redirected ||
          (response.url && response.url !== ECOS_OWNER_MODEL_BRIDGE_URL)
        ) {
          cancelBody(response);
          throw unavailable();
        }
        const result = data(
          JSON.parse(
            await readECOSV2BoundedBody(response.body, OUTPUT, active),
          ),
          ["schemaVersion", "model", "output"],
        );
        if (
          active.aborted || result.schemaVersion !== SCHEMA ||
          result.model !== model
        ) throw unavailable();
        return copyECOSV2JSON(result.output, OUTPUT);
      });
    } catch {
      throw unavailable();
    }
  };
}

/** Dedicated default-off Edge bridge, not the legacy operator smoke endpoint.
 * Two existing service credentials; browser/owner/anonymous callers denied.
 * The configured model is pinned by both peers. PNG decode/source authority
 * remains upstream; here the existing model adapter rechecks exact hash/header.
 */
export function createECOSOwnerModelBridgeHandler(config: {
  enabled: boolean;
  serviceRoleKey: string;
  workerToken: string;
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
}) {
  credentials(config.serviceRoleKey, config.workerToken, config.model);
  if (typeof config.enabled !== "boolean") throw unavailable();
  const { enabled, serviceRoleKey, workerToken, apiKey, model, fetchImpl } =
    config;
  // Configuration validation only; no network or model request.
  createECOSV2JSONModel({ apiKey, model, fetchImpl, maxCalls: 1 });
  const send = (value: unknown, status: number) =>
    new Response(JSON.stringify(value), {
      status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  return async (request: Request): Promise<Response> => {
    const reject = (status: number) => {
      try {
        void request.body?.cancel().catch(() => {});
      } catch { /* bounded */ }
      return send({ error: "private_model_unavailable" }, status);
    };
    if (!enabled) return reject(503);
    if (request.method !== "POST") return reject(405);
    if (request.headers.has("origin")) return reject(403);
    if (
      !await matches(
        request.headers.get("authorization"),
        `Bearer ${serviceRoleKey}`,
      ) ||
      !await matches(request.headers.get("x-ecos-worker-token"), workerToken)
    ) return reject(403);
    try {
      return await bounded(request.signal, 35000, async (signal, check) => {
        const wire = data(
          JSON.parse(await readECOSV2BoundedBody(request.body, WIRE, signal)),
          ["schemaVersion", "model", "request"],
        );
        check();
        if (wire.schemaVersion !== SCHEMA || wire.model !== model) {
          throw unavailable();
        }
        const captured = textRequest(wire.request);
        const call = captured.text as unknown as ECOSV2JSONModelRequest;
        const decoded: ECOSV2PNGImage[] = [];
        try {
          if (captured.images !== undefined) {
            if (
              !Array.isArray(captured.images) || captured.images.length < 1 ||
              captured.images.length > 4
            ) throw unavailable();
            let bytes = 0;
            for (const raw of captured.images) {
              check();
              const item = data(raw, [...IMAGE_KEYS, "pngBase64"]);
              const encoded = item.pngBase64;
              if (
                typeof encoded !== "string" ||
                encoded.length > Math.ceil(IMAGE_BYTES / 3) * 4 ||
                encoded.length % 4 !== 0 ||
                !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
              ) throw unavailable();
              const binary = atob(encoded);
              bytes += binary.length;
              if (bytes > IMAGE_BYTES || btoa(binary) !== encoded) {
                throw unavailable();
              }
              const pngBytes = new Uint8Array(binary.length);
              for (let i = 0; i < binary.length; i++) {
                if (i % 65536 === 0) check();
                pngBytes[i] = binary.charCodeAt(i);
              }
              decoded.push(
                {
                  ...Object.fromEntries(IMAGE_KEYS.map((k) => [k, item[k]])),
                  pngBytes,
                } as unknown as ECOSV2PNGImage,
              );
            }
            call.images = decoded;
          }
          check();
          const provider = createECOSV2JSONModel({
            apiKey,
            model,
            fetchImpl,
            maxCalls: 1,
            timeoutMs: 30000,
          });
          const output = await provider(call, signal);
          check();
          const result = { schemaVersion: SCHEMA, model, output };
          if (encoder.encode(JSON.stringify(result)).length > OUTPUT) {
            throw unavailable();
          }
          return send(result, 200);
        } finally {
          for (const image of decoded) image.pngBytes.fill(0);
        }
      });
    } catch {
      return send({ error: "private_model_unavailable" }, 503);
    }
  };
}
