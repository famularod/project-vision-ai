/** Server-only, bounded Responses API transport. JSON shape is not factual
 * verification. Each downstream stage must validate its own untrusted output.
 * Create one instance per question: at most four calls, no invisible retries,
 * no retained provider conversations, tools, or caller-selected destination. */
export interface ECOSV2JSONModelRequest {
  stage: "interpret" | "plan" | "compose" | "verify";
  instructions: string;
  input: unknown;
  schemaName: string;
  schema: Record<string, unknown>;
  maxOutputTokens: number;
  images?: readonly ECOSV2PNGImage[];
}
/** Supplied by a future independently authorized original/raster adapter.
 * Hash equality binds these exact bytes, NOT their source or page authority. */
export interface ECOSV2PNGImage {
  imageId: string;
  sourceId: string;
  sourceSha256: string;
  pageNumber: number;
  sourcePageCount: number;
  rasterSha256: string;
  pngBytes: Uint8Array;
}
export type ECOSV2PNGImageIdentity = Omit<ECOSV2PNGImage, "pngBytes"> & {
  width: number;
  height: number;
  byteLength: number;
  detail: "high";
  validation: "exact_bytes_sha256_and_png_header_only";
  sourceAuthorityVerified: false;
};
export type ECOSV2JSONModel = (
  request: ECOSV2JSONModelRequest,
  signal: AbortSignal,
) => Promise<unknown>;

const ENDPOINT = "https://api.openai.com/v1/responses";
const encoder = new TextEncoder();
const INPUT_LIMIT = 96 * 1024;
const WIRE_LIMIT = 128 * 1024;
const IMAGE_BYTE_LIMIT = 8 * 1024 * 1024;
const IMAGE_WIRE_LIMIT = 12 * 1024 * 1024;
const OUTPUT_LIMIT = 256 * 1024;
const STAGES = ["interpret", "plan", "compose", "verify"];
const abortedGetter = Object.getOwnPropertyDescriptor(
  AbortSignal.prototype,
  "aborted",
)!.get!;
const SAFE_PROVIDER_CODES = new Set([
  "insufficient_quota",
  "rate_limit_exceeded",
  "invalid_json_schema",
  "model_not_found",
  "invalid_api_key",
  "invalid_request_error",
  "server_error",
  "context_length_exceeded",
  "max_output_tokens",
  "content_filter",
]);
export interface ECOSV2ModelFailureDiagnostic {
  category:
    | "request_rejected"
    | "provider_transport"
    | "provider_http"
    | "provider_incomplete"
    | "provider_output"
    | "cancelled_or_deadline";
  provider_status: number | null;
  provider_code: string | null;
  dispatch_started: boolean;
}
const failureDiagnostics = new WeakMap<
  Error,
  Readonly<ECOSV2ModelFailureDiagnostic>
>();
/** Operator-only, fixed-enum/numeric response context. Separate from the stable
 * customer-safe diagnostic contract; never includes provider text or headers
 * verbatim. Unknown/absent data remains null, not a quota diagnosis. */
export interface ECOSV2ModelFailureContext {
  body_format: "json" | "non_json" | "unreadable" | null;
  provider_type:
    | "insufficient_quota"
    | "rate_limit_exceeded"
    | "rate_limit_error"
    | "requests"
    | "tokens"
    | "invalid_request_error"
    | "server_error"
    | null;
  code_present: boolean | null;
  retry_after_seconds: number | null;
  remaining_requests: number | null;
  remaining_tokens: number | null;
  remaining_project_tokens: number | null;
}
const failureContexts = new WeakMap<
  Error,
  Readonly<ECOSV2ModelFailureContext>
>();
const SAFE_PROVIDER_TYPES = new Set([
  "insufficient_quota",
  "rate_limit_exceeded",
  "rate_limit_error",
  "requests",
  "tokens",
  "invalid_request_error",
  "server_error",
]);
function numericHeader(headers: Headers, name: string, maximum: number) {
  const value = headers.get(name);
  if (value === null || !/^(?:0|[1-9][0-9]{0,12})$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number <= maximum ? number : null;
}
export function getECOSV2ModelFailureContext(error: unknown) {
  return error instanceof Error ? failureContexts.get(error) ?? null : null;
}

function exactData(
  value: unknown,
  required: string[],
  optional: string[] = [],
) {
  if (
    !value || typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new Error("Invalid model data");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    required.some((k) => !Object.hasOwn(descriptors, k)) ||
    Reflect.ownKeys(value).some((k) =>
      typeof k !== "string" || ![...required, ...optional].includes(k)
    ) ||
    Object.values(descriptors).some((d) =>
      !d.enumerable || !Object.hasOwn(d, "value")
    )
  ) {
    throw new Error("Invalid model data");
  }
  return Object.fromEntries(
    Object.entries(descriptors).map(([k, d]) => [k, d.value]),
  );
}

/** PNG container-header validation only; not independent decoding or proof
 * of PDF rendering, readability, authorization, or semantic correctness.
 * Returns immutable data URLs plus a positional identity map, never raw bytes.
 * All caller data is copied before the first asynchronous hash operation. */
export async function prepareECOSV2PNGImageContent(
  images: readonly ECOSV2PNGImage[],
  signal: AbortSignal,
) {
  try {
    return await preparePNGImageContent(images, signal);
  } catch {
    throw new Error("PNG image input invalid or cancelled");
  }
}
async function preparePNGImageContent(
  images: readonly ECOSV2PNGImage[],
  signal: AbortSignal,
) {
  const check = () => {
    if (abortedGetter.call(signal)) {
      throw new Error("Image preparation cancelled");
    }
  };
  check();
  if (
    !Array.isArray(images) ||
    Object.getPrototypeOf(images) !== Array.prototype ||
    images.length < 1 || images.length > 4 ||
    Reflect.ownKeys(images).length !== images.length + 1
  ) {
    throw new Error("Invalid model images");
  }
  let total = 0, previous = "";
  const pairs = new Set<string>();
  const sources = new Map<string, string>();
  const typedPrototype = Object.getPrototypeOf(Uint8Array.prototype);
  const byteLength = Object.getOwnPropertyDescriptor(
    typedPrototype,
    "byteLength",
  )!.get!;
  const buffer = Object.getOwnPropertyDescriptor(typedPrototype, "buffer")!
    .get!;
  const copies = Array.from({ length: images.length }, (_, index) => {
    const d = Object.getOwnPropertyDescriptor(images, String(index));
    if (!d?.enumerable || !Object.hasOwn(d, "value")) {
      throw new Error("Invalid image slot");
    }
    const v = exactData(d.value, [
      "imageId",
      "sourceId",
      "sourceSha256",
      "pageNumber",
      "sourcePageCount",
      "rasterSha256",
      "pngBytes",
    ]);
    if (
      typeof v.imageId !== "string" ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(v.imageId) || v.imageId <= previous ||
      typeof v.sourceId !== "string" || !v.sourceId ||
      v.sourceId.length > 300 ||
      v.sourceId !== v.sourceId.trim() ||
      encoder.encode(v.sourceId).length > 300 ||
      // Source identifiers, unlike visible source content, cannot contain controls.
      // deno-lint-ignore no-control-regex
      /[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(v.sourceId) ||
      typeof v.sourceSha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(v.sourceSha256) ||
      typeof v.rasterSha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(v.rasterSha256) ||
      !Number.isSafeInteger(v.pageNumber) ||
      !Number.isSafeInteger(v.sourcePageCount) ||
      v.pageNumber < 1 || v.pageNumber > v.sourcePageCount ||
      v.sourcePageCount > 10000
    ) {
      throw new Error("Invalid image identity");
    }
    previous = v.imageId;
    const pair = JSON.stringify([v.sourceId, v.pageNumber]);
    const source = JSON.stringify([v.sourceSha256, v.sourcePageCount]);
    if (
      pairs.has(pair) ||
      sources.has(v.sourceId) && sources.get(v.sourceId) !== source
    ) {
      throw new Error("Conflicting image source");
    }
    pairs.add(pair);
    sources.set(v.sourceId, source);
    if (
      !(v.pngBytes instanceof Uint8Array) ||
      Object.getPrototypeOf(v.pngBytes) !== Uint8Array.prototype ||
      !(buffer.call(v.pngBytes) instanceof ArrayBuffer)
    ) throw new Error("Invalid image bytes");
    const size = byteLength.call(v.pngBytes);
    if (size < 33 || size > IMAGE_BYTE_LIMIT - total) {
      throw new Error("Image byte limit");
    }
    total += size;
    const bytes = new Uint8Array(size);
    Uint8Array.prototype.set.call(bytes, v.pngBytes);
    if (
      ![137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n) ||
      new DataView(bytes.buffer).getUint32(8) !== 13 ||
      ![73, 72, 68, 82].every((n, i) => bytes[i + 12] === n)
    ) throw new Error("Invalid PNG header");
    const width = new DataView(bytes.buffer).getUint32(16),
      height = new DataView(bytes.buffer).getUint32(20);
    if (
      !width || !height || width > 8000 || height > 8000 ||
      width * height > 24_000_000
    ) {
      throw new Error("PNG dimension limit");
    }
    const identity: ECOSV2PNGImageIdentity = {
      imageId: v.imageId,
      sourceId: v.sourceId,
      sourceSha256: v.sourceSha256,
      pageNumber: v.pageNumber,
      sourcePageCount: v.sourcePageCount,
      rasterSha256: v.rasterSha256,
      width,
      height,
      byteLength: size,
      detail: "high",
      validation: "exact_bytes_sha256_and_png_header_only",
      sourceAuthorityVerified: false,
    };
    return { bytes, identity: Object.freeze(identity) };
  });
  const dataURLs: string[] = [];
  for (const item of copies) {
    check();
    const sha = [
      ...new Uint8Array(await crypto.subtle.digest("SHA-256", item.bytes)),
    ]
      .map((n) => n.toString(16).padStart(2, "0")).join("");
    check();
    if (sha !== item.identity.rasterSha256) {
      throw new Error("PNG byte hash mismatch");
    }
    let binary = "";
    for (let offset = 0; offset < item.bytes.length; offset += 8192) {
      check();
      binary += String.fromCharCode(
        ...item.bytes.subarray(offset, offset + 8192),
      );
    }
    dataURLs.push(`data:image/png;base64,${btoa(binary)}`);
  }
  check();
  const identities = Object.freeze(copies.map((item) => item.identity));
  const content = Object.freeze(
    [
      Object.freeze({
        type: "input_text" as const,
        text: JSON.stringify({
          image_identity_mapping: identities,
          order: "following_input_images_in_same_order",
          limitations: [
            "source_authority_requires_independent_adapter",
            "png_decode_not_verified_here",
            "vision_and_ocr_can_misread_small_text_and_diagrams",
          ],
        }),
      }),
      ...dataURLs.map((image_url) =>
        Object.freeze({
          type: "input_image" as const,
          image_url,
          detail: "high" as const,
        })
      ),
    ] as const,
  );
  return Object.freeze({ identities, content });
}
/** Only transport-created, fixed-category diagnostics are observable. Never
 * return a provider message/body, source, token, URL or arbitrary exception. */
export function getECOSV2ModelFailureDiagnostic(error: unknown) {
  return error instanceof Error ? failureDiagnostics.get(error) ?? null : null;
}

/** Copy JSON without running getters/toJSON or accepting mutable/prototype
 * tricks. A node/byte budget also bounds recursive validation work. */
export function copyECOSV2JSON(
  value: unknown,
  maxBytes = INPUT_LIMIT,
): unknown {
  let nodes = 0;
  let bytes = 0;
  const visit = (v: unknown, depth: number): unknown => {
    if (++nodes > 24_000 || depth > 32) throw new Error("JSON limit exceeded");
    if (v === null || typeof v === "boolean") return v;
    if (typeof v === "string") {
      bytes += encoder.encode(v).length;
      if (bytes > maxBytes) throw new Error("JSON limit exceeded");
      return v;
    }
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (!v || typeof v !== "object") throw new Error("Invalid JSON");
    if (Array.isArray(v)) {
      if (
        Object.getPrototypeOf(v) !== Array.prototype || v.length > 24_000 ||
        Reflect.ownKeys(v).length !== v.length + 1
      ) throw new Error("Invalid JSON");
      return Array.from({ length: v.length }, (_, i) => {
        const p = Object.getOwnPropertyDescriptor(v, String(i));
        if (!p?.enumerable || !Object.hasOwn(p, "value")) {
          throw new Error("Invalid JSON");
        }
        return visit(p.value, depth + 1);
      });
    }
    if (![Object.prototype, null].includes(Object.getPrototypeOf(v))) {
      throw new Error("Invalid JSON");
    }
    const copy: Record<string, unknown> = Object.create(null);
    for (const key of Reflect.ownKeys(v)) {
      if (
        typeof key !== "string" ||
        ["__proto__", "prototype", "constructor"].includes(key)
      ) {
        throw new Error("Invalid JSON");
      }
      bytes += encoder.encode(key).length;
      if (bytes > maxBytes) throw new Error("JSON limit exceeded");
      const p = Object.getOwnPropertyDescriptor(v, key)!;
      if (!p.enumerable || !Object.hasOwn(p, "value")) {
        throw new Error("Invalid JSON");
      }
      copy[key] = visit(p.value, depth + 1);
    }
    return copy;
  };
  const result = visit(value, 0);
  if (encoder.encode(JSON.stringify(result)).length > maxBytes) {
    throw new Error("JSON limit exceeded");
  }
  return result;
}

export async function readECOSV2BoundedBody(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
  signal: AbortSignal,
): Promise<string> {
  if (!body || signal.aborted) throw new Error("Body unavailable");
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      const part = await reader.read();
      if (signal.aborted) throw new Error("Body cancelled");
      if (part.done) break;
      length += part.value.length;
      if (length > limit) throw new Error("Body too large");
      chunks.push(part.value);
    }
    const joined = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.length;
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(joined);
  } finally {
    signal.removeEventListener("abort", abort);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function createECOSV2JSONModel(options: {
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxCalls?: number;
}): ECOSV2JSONModel {
  const { apiKey, model } = options;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxCalls = options.maxCalls ?? 4;
  const fetchImpl = options.fetchImpl ?? fetch;
  if (
    typeof apiKey !== "string" || !apiKey.trim() || apiKey !== apiKey.trim() ||
    /[\r\n]/.test(apiKey) || apiKey.length > 2000 ||
    typeof model !== "string" || !/^[a-zA-Z0-9._:-]{1,120}$/.test(model) ||
    !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000 ||
    !Number.isSafeInteger(maxCalls) || maxCalls < 1 || maxCalls > 4 ||
    typeof fetchImpl !== "function"
  ) throw new Error("Invalid model configuration");
  let calls = 0;
  return async (request, signal) => {
    const controller = new AbortController();
    let validSignal = false;
    let deadline: number | null = null;
    const isAborted = () => validSignal && abortedGetter.call(signal) === true;
    const diagnostic: ECOSV2ModelFailureDiagnostic = {
      category: "request_rejected",
      provider_status: null,
      provider_code: null,
      dispatch_started: false,
    };
    const context: ECOSV2ModelFailureContext = {
      body_format: null,
      provider_type: null,
      code_present: null,
      retry_after_seconds: null,
      remaining_requests: null,
      remaining_tokens: null,
      remaining_project_tokens: null,
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    try {
      if (!(signal instanceof AbortSignal)) {
        throw new Error("Invalid cancellation signal");
      }
      const alreadyAborted = abortedGetter.call(signal);
      validSignal = true;
      if (alreadyAborted) {
        throw new Error("Cancelled");
      }
      deadline = performance.now() + timeoutMs;
      // Capture all request fields before image hashing yields; reject accessors
      // and caller-selected URL/tool fields without ever executing them.
      request = exactData(request, [
        "stage",
        "instructions",
        "input",
        "schemaName",
        "schema",
        "maxOutputTokens",
      ], ["images"]) as unknown as ECOSV2JSONModelRequest;
      const input = copyECOSV2JSON(request.input);
      const schema = copyECOSV2JSON(request.schema, 24 * 1024);
      if (
        !STAGES.includes(request.stage) ||
        typeof request.instructions !== "string" ||
        !request.instructions.trim() ||
        encoder.encode(request.instructions).length > 16 * 1024 ||
        !/^[a-zA-Z0-9_-]{1,64}$/.test(request.schemaName) ||
        !Number.isSafeInteger(request.maxOutputTokens) ||
        request.maxOutputTokens < 1 ||
        request.maxOutputTokens > 6000 || calls >= maxCalls ||
        (request.images !== undefined &&
          !["compose", "verify"].includes(request.stage))
      ) throw new Error("Invalid model request");
      const bodyValue = {
        model,
        store: false,
        stream: false,
        truncation: "disabled",
        max_output_tokens: request.maxOutputTokens,
        input: [
          {
            role: "developer",
            content: [{ type: "input_text", text: request.instructions }],
          },
          {
            role: "user",
            content: [{ type: "input_text", text: JSON.stringify(input) }],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: request.schemaName,
            schema,
            strict: true,
          },
        },
      };
      const textBody = JSON.stringify(bodyValue);
      if (encoder.encode(textBody).length > WIRE_LIMIT) {
        throw new Error("Model request too large");
      }
      calls++;
      const stopped = new Promise<never>((_, reject) => {
        abort = () => {
          diagnostic.category = "cancelled_or_deadline";
          controller.abort();
          reject(new Error("Model stopped"));
        };
        signal.addEventListener("abort", abort, { once: true });
        timer = setTimeout(abort, Math.max(1, deadline! - performance.now()));
      });
      const run = async () => {
        const check = () => {
          if (
            controller.signal.aborted || isAborted() ||
            performance.now() >= deadline!
          ) {
            throw new Error("Model stopped");
          }
        };
        check();
        let body = textBody;
        if (request.images !== undefined) {
          const prepared = await prepareECOSV2PNGImageContent(
            request.images,
            controller.signal,
          );
          check();
          // Image identity text is part of the unchanged text-input budget.
          if (
            encoder.encode(JSON.stringify(input)).length +
                encoder.encode(prepared.content[0].text!).length > INPUT_LIMIT
          ) {
            throw new Error("Image identity text exceeds input limit");
          }
          body = JSON.stringify({
            ...bodyValue,
            input: [bodyValue.input[0], {
              ...bodyValue.input[1],
              content: [...bodyValue.input[1].content, ...prepared.content],
            }],
          });
          if (encoder.encode(body).length > IMAGE_WIRE_LIMIT) {
            throw new Error("Image wire limit");
          }
        }
        check();
        diagnostic.category = "provider_transport";
        diagnostic.dispatch_started = true;
        const response = await fetchImpl(ENDPOINT, {
          method: "POST",
          redirect: "error",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body,
          signal: controller.signal,
        });
        if (
          controller.signal.aborted || isAborted() ||
          performance.now() >= deadline!
        ) {
          diagnostic.category = "cancelled_or_deadline";
          void response.body?.cancel().catch(() => {});
          throw new Error("Model stopped");
        }
        if (!response.ok || response.redirected) {
          diagnostic.category = "provider_http";
          diagnostic.provider_status = response.status;
          context.retry_after_seconds = numericHeader(
            response.headers,
            "retry-after",
            86400,
          );
          context.remaining_requests = numericHeader(
            response.headers,
            "x-ratelimit-remaining-requests",
            1_000_000_000_000,
          );
          context.remaining_tokens = numericHeader(
            response.headers,
            "x-ratelimit-remaining-tokens",
            1_000_000_000_000,
          );
          context.remaining_project_tokens = numericHeader(
            response.headers,
            "x-ratelimit-remaining-project-tokens",
            1_000_000_000_000,
          );
          // An allowlisted machine code is enough for quota/schema diagnosis.
          // Arbitrary provider text is never retained or returned.
          try {
            context.body_format = "unreadable";
            const rejectedText = await readECOSV2BoundedBody(
              response.body,
              16 * 1024,
              controller.signal,
            );
            context.body_format = "non_json";
            const rejected = JSON.parse(rejectedText);
            context.body_format = "json";
            context.code_present = rejected?.error?.code !== null &&
              rejected?.error?.code !== undefined;
            if (SAFE_PROVIDER_TYPES.has(rejected?.error?.type)) {
              context.provider_type = rejected.error.type;
            }
            if (SAFE_PROVIDER_CODES.has(rejected?.error?.code)) {
              diagnostic.provider_code = rejected.error.code;
            }
          } catch { /* Preserve safe status without raw provider details. */ }
          throw new Error("Model unavailable");
        }
        diagnostic.category = "provider_output";
        const text = await readECOSV2BoundedBody(
          response.body,
          OUTPUT_LIMIT,
          controller.signal,
        );
        const envelope = JSON.parse(text);
        if (
          envelope?.status !== "completed" || envelope.error ||
          envelope.incomplete_details ||
          !Array.isArray(envelope.output)
        ) {
          diagnostic.category = "provider_incomplete";
          if (SAFE_PROVIDER_CODES.has(envelope?.incomplete_details?.reason)) {
            diagnostic.provider_code = envelope.incomplete_details.reason;
          }
          throw new Error("Incomplete model response");
        }
        const messages = envelope.output.filter((item: { type?: string }) =>
          item?.type === "message"
        );
        if (
          messages.length !== 1 ||
          envelope.output.some((item: { type?: string }) =>
            !["message", "reasoning"].includes(item?.type ?? "")
          )
        ) throw new Error("Unexpected model output");
        const message = messages[0];
        if (
          message.status !== "completed" || message.role !== "assistant" ||
          !Array.isArray(message.content) || message.content.length !== 1 ||
          message.content[0]?.type !== "output_text" ||
          typeof message.content[0].text !== "string"
        ) {
          throw new Error("Model refused or returned invalid content");
        }
        const result = copyECOSV2JSON(
          JSON.parse(message.content[0].text),
          INPUT_LIMIT,
        );
        if (
          controller.signal.aborted || isAborted() ||
          performance.now() >= deadline!
        ) throw new Error("Model stopped");
        return result;
      };
      return await Promise.race([run(), stopped]);
    } catch {
      if (
        isAborted() || controller.signal.aborted ||
        (deadline !== null && performance.now() >= deadline)
      ) {
        diagnostic.category = "cancelled_or_deadline";
      }
      // Never include key, source material, provider body, or raw provider errors.
      const error = new Error(
        "ECOS language service unavailable, incomplete or cancelled",
      );
      failureDiagnostics.set(error, Object.freeze({ ...diagnostic }));
      failureContexts.set(error, Object.freeze({ ...context }));
      throw error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (abort && validSignal) signal.removeEventListener("abort", abort);
      controller.abort();
    }
  };
}
