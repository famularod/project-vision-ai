/** Private inline-PNG policy, distinct from the ordinary text request ceiling.
 * Source authorization is the protected image session's job, not this parser's.
 * DeepSeek vision docs checked 2026-09-15: at most 1,024 tokens per image.
 * https://api-docs.deepseek.com/guides/vision/
 */
export const ECOS_DRAWING_REQUEST_BYTES = 4 * 1024 * 1024;
export const ECOS_DRAWING_IMAGE_BYTES = 3 * 1024 * 1024;
export const ECOS_DRAWING_IMAGES_PER_REQUEST = 9;
export const ECOS_DRAWING_TOKENS_PER_IMAGE = 1024;

export function measureECOSDrawingMedia(inputItems: readonly unknown[]) {
  const encoder = new TextEncoder();
  if (encoder.encode(JSON.stringify(inputItems)).length > ECOS_DRAWING_REQUEST_BYTES) invalid();
  const allowed = new Set<unknown>();
  for (const value of inputItems) {
    if (record(value) && value.role === "user" && Array.isArray(value.content)) {
      for (const part of value.content) allowed.add(part);
    }
  }
  let images = 0, imageBytes = 0, nodes = 0;
  function visit(value: unknown, depth: number): unknown {
    if (++nodes > 64_000 || depth > 24) invalid();
    if (Array.isArray(value)) return value.map(v => visit(v, depth + 1));
    if (!record(value)) return value;
    if (value.type === "input_image") {
      if (!allowed.has(value) || Object.keys(value).sort().join(",") !== "detail,image_url,type" ||
        value.detail !== "original" || typeof value.image_url !== "string") invalid();
      const prefix = "data:image/png;base64,";
      if (!value.image_url.startsWith(prefix)) invalid();
      const encoded = value.image_url.slice(prefix.length);
      if (!encoded.length || encoded.length % 4 || encoded.length > 4 * Math.ceil(ECOS_DRAWING_IMAGE_BYTES / 3) ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) invalid();
      let binary: string;
      try { binary = atob(encoded); } catch { return invalid(); }
      if (btoa(binary) !== encoded || binary.length < 33 || binary.length > ECOS_DRAWING_IMAGE_BYTES) invalid();
      const bytes = Uint8Array.from(binary.slice(0, 24), char => char.charCodeAt(0));
      if ([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82].some((n,i) => bytes[i] !== n)) invalid();
      const view = new DataView(bytes.buffer);
      const width = view.getUint32(16), height = view.getUint32(20);
      if (!width || !height || width > 8000 || height > 8000 || width * height > 24_000_000) invalid();
      if (++images > ECOS_DRAWING_IMAGES_PER_REQUEST) invalid();
      imageBytes += binary.length;
      if (imageBytes > ECOS_DRAWING_IMAGE_BYTES) invalid();
      return {type: "input_image", detail: "original", image_url: "[bounded PNG image]"};
    }
    if (["input_file", "image", "image_url", "file"].includes(String(value.type)) ||
      ["file_id", "file_data", "image_url"].some(key => Object.hasOwn(value, key))) invalid();
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, visit(child, depth + 1)]));
  }
  const textInput = visit(inputItems, 0);
  return Object.freeze({images, imageBytes, imageTokenCeiling: images * ECOS_DRAWING_TOKENS_PER_IMAGE, textInput});
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function invalid(): never { throw new Error("agent_provider_budget_input_invalid"); }
