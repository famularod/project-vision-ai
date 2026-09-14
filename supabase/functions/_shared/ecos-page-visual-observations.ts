/** Source-neutral validation of persisted OCR observations. This checks the
 * projected geometry and transcription shape, NOT the original TSV, PDF pixels,
 * an owner's authority, semantic relationships, or the truth of an answer.
 * It deliberately does not flatten neighboring words/columns into prose. */
export interface ECOSExpectedVisualPage {
  sourceSha256: string;
  sourcePageCount: number;
  pageNumber: number;
  rasterSha256: string;
}
type JSONValue = null | boolean | number | string | JSONValue[] | {
  [key: string]: JSONValue;
};
type ObjectValue = { [key: string]: JSONValue };
type Box = readonly [number, number, number, number];
export interface ECOSVisualWord {
  wordId: string;
  text: string;
  bbox: Box;
  engineConfidence: number;
  engineConfidenceRaw: string;
  containedInReportedLine: boolean;
}
export interface ECOSVisualLine {
  lineId: string;
  bbox: Box;
  reportedBlockBbox: Box;
  reportedParagraphBbox: Box;
  containedInReportedParent: boolean;
  words: readonly Readonly<ECOSVisualWord>[];
}
export interface ECOSVisualPage extends ECOSExpectedVisualPage {
  schemaVersion: "ecos-validated-visual-observations/2.1";
  validation: "projected_word_and_geometry_consistency_only";
  state: "partial" | "unreadable";
  width: number;
  height: number;
  coordinateSystem: "rotated_display_cropbox_pixels_top_left";
  lines: readonly Readonly<ECOSVisualLine>[];
  limitationCodes: readonly string[];
  observedWordCount: number;
  lowEngineConfidenceWordCount: number;
  geometryConflictCount: number;
  /** Complete copied raw projection, including engine/source/conflict metadata. */
  raw: Readonly<ObjectValue>;
  sourceAuthorityVerified: false;
  rasterBytesVerified: false;
  retrievalAuthorized: false;
  semanticVerified: false;
}
const encoder = new TextEncoder();
const LIMIT = 4 * 1024 * 1024;
const BASE = [
  "pixel_ocr_not_native_text",
  "ocr_transcription_not_visually_verified",
  "layout_grouping_is_engine_observation_not_semantic_association",
  "reading_order_not_verified",
  "unrecognized_visual_content_not_accounted",
  "no_project_or_execution_authority",
];
function fail(): never {
  throw new Error("Visual observation projection invalid");
}
/** Snapshot data properties only. No getters, toJSON hooks, shared references,
 * sparse arrays, exotic prototypes, or unbounded recursive graph is traversed. */
function snapshot(value: unknown): JSONValue {
  const seen = new WeakSet<object>();
  let nodes = 0, bytes = 0;
  function copy(v: unknown, depth: number): JSONValue {
    if (++nodes > 250000 || depth > 16 || bytes > LIMIT) fail();
    if (v === null || typeof v === "boolean") return v;
    if (typeof v === "number") {
      if (!Number.isFinite(v)) fail();
      return v;
    }
    if (typeof v === "string") {
      if (v.length > LIMIT) fail();
      bytes += encoder.encode(v).length;
      if (bytes > LIMIT || /[\ud800-\udfff]/u.test(v)) fail();
      return v;
    }
    if (!v || typeof v !== "object" || seen.has(v)) fail();
    seen.add(v);
    const descriptors = Object.getOwnPropertyDescriptors(v);
    if (Reflect.ownKeys(v).some((key) => typeof key !== "string")) fail();
    if (Array.isArray(v)) {
      if (
        Object.getPrototypeOf(v) !== Array.prototype || v.length > 16000 ||
        Object.keys(descriptors).length !== v.length + 1
      ) fail();
      return Array.from({ length: v.length }, (_, index) => {
        const d = descriptors[String(index)];
        if (!d?.enumerable || !Object.hasOwn(d, "value")) fail();
        return copy(d.value, depth + 1);
      });
    }
    if (![Object.prototype, null].includes(Object.getPrototypeOf(v))) fail();
    const result: ObjectValue = Object.create(null);
    for (const [key, d] of Object.entries(descriptors)) {
      if (
        !d.enumerable || !Object.hasOwn(d, "value") ||
        ["__proto__", "constructor", "prototype"].includes(key) ||
        key.length > 100
      ) fail();
      bytes += key.length;
      result[key] = copy(d.value, depth + 1);
    }
    return result;
  }
  const result = copy(value, 0);
  if (encoder.encode(JSON.stringify(result)).length > LIMIT) fail();
  return result;
}
function object(v: JSONValue, keys: readonly string[]): ObjectValue {
  if (!v || typeof v !== "object" || Array.isArray(v)) fail();
  const actual = Object.keys(v);
  if (actual.length !== keys.length || actual.some((k) => !keys.includes(k))) {
    fail();
  }
  return v;
}
function integer(v: JSONValue | undefined, minimum: number, maximum: number) {
  if (
    typeof v !== "number" || !Number.isSafeInteger(v) ||
    v < minimum || v > maximum
  ) fail();
  return v;
}
function number(v: JSONValue, minimum: number, maximum: number) {
  if (
    typeof v !== "number" || !Number.isFinite(v) || v < minimum || v > maximum
  ) {
    fail();
  }
  return v;
}
function text(v: JSONValue, maximum: number) {
  if (
    typeof v !== "string" || !v || v.length > maximum ||
    encoder.encode(v).length > maximum ||
    // deno-lint-ignore no-control-regex
    /[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(v)
  ) fail();
  return v;
}
function sha(v: JSONValue) {
  if (typeof v !== "string" || !/^[a-f0-9]{64}$/.test(v)) fail();
  return v;
}
function array(v: JSONValue, maximum: number) {
  if (!Array.isArray(v) || v.length > maximum) fail();
  return v;
}
function box(v: JSONValue, width: number, height: number): Box {
  const a = array(v, 4);
  if (a.length !== 4) fail();
  const b = a.map((n, i) => integer(n, 0, i % 2 ? height : width));
  if (b[2] <= b[0] || b[3] <= b[1]) fail();
  return Object.freeze(b) as unknown as Box;
}
function contains(parent: Box, child: Box) {
  return child[0] >= parent[0] && child[1] >= parent[1] &&
    child[2] <= parent[2] && child[3] <= parent[3];
}
function same(a: readonly number[], b: readonly number[]) {
  return a.length === b.length && a.every((n, i) => n === b[i]);
}
function compare(a: readonly number[], b: readonly number[]) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}
function hierarchy(id: JSONValue, word: boolean) {
  const m = text(id, 100).match(
    word
      ? /^b([1-9][0-9]{0,5}):p([1-9][0-9]{0,5}):l([1-9][0-9]{0,5}):w([1-9][0-9]{0,5})$/
      : /^b([1-9][0-9]{0,5}):p([1-9][0-9]{0,5}):l([1-9][0-9]{0,5})$/,
  );
  if (!m) fail();
  return [1, ...m.slice(1).map(Number)];
}
function freeze(v: JSONValue): JSONValue {
  if (v && typeof v === "object") {
    Object.values(v).forEach(freeze);
    Object.freeze(v);
  }
  return v;
}

/** Parsed input must come through a duplicate-safe JSON transport/binder.
 * Expected pins are supplied independently; matching them is NOT authorization.
 * No image bytes are accepted here, hence rasterBytesVerified is always false. */
export function parseECOSPageVisualObservations(
  value: unknown,
  independentlyExpected: ECOSExpectedVisualPage,
): Readonly<ECOSVisualPage> {
  const expected = object(snapshot(independentlyExpected), [
    "sourceSha256",
    "sourcePageCount",
    "pageNumber",
    "rasterSha256",
  ]);
  const sourceSha256 = sha(expected.sourceSha256);
  const rasterSha256 = sha(expected.rasterSha256);
  const sourcePageCount = integer(expected.sourcePageCount, 1, 10000);
  const pageNumber = integer(expected.pageNumber, 1, sourcePageCount);
  const raw = object(snapshot(value), [
    "schema_version",
    "source",
    "raster",
    "engine",
    "raw_tsv_sha256",
    "raw_tsv_bytes",
    "observed_row_count",
    "observed_word_count",
    "low_engine_confidence_word_count",
    "geometry_conflicts",
    "state",
    "lines",
    "limitation_codes",
    "retrieval_authorized",
    "semantic_verified",
  ]);
  if (
    raw.schema_version !== "ecos-page-visual-observations/2.1" ||
    raw.retrieval_authorized !== false || raw.semantic_verified !== false
  ) fail();
  const source = object(raw.source, [
    "source_sha256",
    "source_page_count",
    "page_number",
    "rotation_degrees",
    "display_width_points",
    "display_height_points",
    "cropbox",
    "mediabox",
  ]);
  if (
    source.source_sha256 !== sourceSha256 ||
    source.source_page_count !== sourcePageCount ||
    source.page_number !== pageNumber ||
    ![0, 90, 180, 270].includes(source.rotation_degrees as number)
  ) fail();
  let crop: number[] = [];
  for (const key of ["cropbox", "mediabox"]) {
    const a = array(source[key], 4);
    if (a.length !== 4) fail();
    const b = a.map((n) => number(n, -100000, 100000));
    if (b[2] <= b[0] || b[3] <= b[1]) fail();
    if (key === "cropbox") crop = b;
  }
  const displayed = [crop[2] - crop[0], crop[3] - crop[1]];
  if ([90, 270].includes(source.rotation_degrees as number)) {
    displayed.reverse();
  }
  if (
    Math.abs(number(source.display_width_points, 1e-9, 100000) - displayed[0]) >
      0.01 ||
    Math.abs(
        number(source.display_height_points, 1e-9, 100000) - displayed[1],
      ) > 0.01
  ) fail();
  const raster = object(raw.raster, [
    "sha256",
    "byte_count",
    "width",
    "height",
    "coordinate_system",
    "hash_scope",
    "decode_verified_by_parser",
  ]);
  const width = integer(raster.width, 1, 8000),
    height = integer(raster.height, 1, 8000);
  integer(raster.byte_count, 33, 32 * 1024 * 1024);
  if (
    raster.sha256 !== rasterSha256 || width * height > 24000000 ||
    raster.coordinate_system !== "rotated_display_cropbox_pixels_top_left" ||
    raster.hash_scope !== "exact_png_bytes" ||
    raster.decode_verified_by_parser !== false
  ) fail();
  const engine = object(raw.engine, [
    "name",
    "version",
    "language",
    "oem",
    "psm",
    "invoked_executable_sha256",
  ]);
  if (
    engine.name !== "tesseract" || engine.oem !== 1 ||
    ![3, 6, 11].includes(engine.psm as number)
  ) fail();
  text(engine.version, 256);
  text(engine.language, 100);
  sha(engine.invoked_executable_sha256);
  sha(raw.raw_tsv_sha256);
  integer(raw.raw_tsv_bytes, 1, 1024 * 1024);
  const rows = integer(raw.observed_row_count, 1, 16000);
  const observedWordCount = integer(raw.observed_word_count, 0, 10000);
  const lowEngineConfidenceWordCount = integer(
    raw.low_engine_confidence_word_count,
    0,
    observedWordCount,
  );
  if (raw.state !== (observedWordCount ? "partial" : "unreadable")) fail();
  const known = new Map<string, { child: Box; parent: Box }>();
  const parentBoxes = new Map<string, Box>();
  const putParent = (key: string, b: Box) => {
    const prior = parentBoxes.get(key);
    if (prior && !same(prior, b)) fail();
    parentBoxes.set(key, b);
  };
  let count = 0, low = 0, previous: number[] = [];
  const lines = array(raw.lines, 16000).map((r): Readonly<ECOSVisualLine> => {
    const line = object(r, [
      "bbox",
      "line_id",
      "words",
      "reported_block_bbox",
      "reported_paragraph_bbox",
      "contained_in_reported_parent",
    ]);
    const key = hierarchy(line.line_id, false);
    if (compare(previous, key) >= 0) fail();
    previous = key;
    const bounds = box(line.bbox, width, height);
    const block = box(line.reported_block_bbox, width, height);
    const paragraph = box(line.reported_paragraph_bbox, width, height);
    putParent(key.slice(0, 2).join(":"), block);
    putParent(key.slice(0, 3).join(":"), paragraph);
    known.set(key.slice(0, 3).join(":"), { child: paragraph, parent: block });
    known.set(key.join(":"), { child: bounds, parent: paragraph });
    if (line.contained_in_reported_parent !== contains(paragraph, bounds)) {
      fail();
    }
    let priorWord = key;
    const words = array(line.words, 10000).map(
      (w): Readonly<ECOSVisualWord> => {
        const word = object(w, [
          "word_id",
          "text",
          "bbox",
          "engine_confidence",
          "engine_confidence_raw",
          "contained_in_reported_line",
        ]);
        const wordKey = hierarchy(word.word_id, true);
        if (
          !same(wordKey.slice(0, 4), key) || compare(priorWord, wordKey) >= 0
        ) fail();
        priorWord = wordKey;
        const b = box(word.bbox, width, height);
        const confidenceRaw = text(word.engine_confidence_raw, 16);
        if (!/^(?:0|[1-9][0-9]{0,2})(?:\.[0-9]{1,12})?$/.test(confidenceRaw)) {
          fail();
        }
        const confidence = number(word.engine_confidence, 0, 100);
        if (
          confidence !== Number(confidenceRaw) ||
          word.contained_in_reported_line !== contains(bounds, b)
        ) fail();
        known.set(wordKey.join(":"), { child: b, parent: bounds });
        if (++count > 10000) fail();
        if (confidence < 50) low++;
        return Object.freeze({
          wordId: word.word_id as string,
          text: text(word.text, 4096),
          bbox: b,
          engineConfidence: confidence,
          engineConfidenceRaw: confidenceRaw,
          containedInReportedLine: word.contained_in_reported_line as boolean,
        });
      },
    );
    return Object.freeze({
      lineId: line.line_id as string,
      bbox: bounds,
      reportedBlockBbox: block,
      reportedParagraphBbox: paragraph,
      containedInReportedParent: line.contained_in_reported_parent as boolean,
      words: Object.freeze(words),
    });
  });
  if (
    count !== observedWordCount || low !== lowEngineConfidenceWordCount ||
    rows < 1 + lines.length + count + parentBoxes.size
  ) fail();
  const conflicts = array(raw.geometry_conflicts, 16000);
  const conflictKeys = new Set<string>();
  previous = [];
  for (const r of conflicts) {
    const c = object(r, ["hierarchy", "bbox", "reported_parent_bbox"]);
    const key = array(c.hierarchy, 5).map((n) => integer(n, 1, 999999));
    if (key.length < 3 || key[0] !== 1 || compare(previous, key) >= 0) fail();
    previous = key;
    const child = box(c.bbox, width, height),
      parent = box(c.reported_parent_bbox, width, height);
    if (contains(parent, child)) fail();
    const k = key.join(":"), related = known.get(k);
    if (
      related && (!same(related.child, child) || !same(related.parent, parent))
    ) fail();
    // Every projected line/word must have been retained, not an orphan conflict.
    if (key.length >= 4 && !related) fail();
    conflictKeys.add(k);
  }
  for (const [k, v] of known) {
    if ((!contains(v.parent, v.child)) !== conflictKeys.has(k)) fail();
  }
  if (conflicts.length > rows) fail();
  const limitations = array(raw.limitation_codes, 8).map((v) => text(v, 100));
  const expectedLimitations = [...BASE];
  if (!count) {
    expectedLimitations.push("ocr_no_text_detected_not_verified_empty");
  }
  if (conflicts.length) {
    expectedLimitations.push("ocr_parent_child_geometry_conflicts_unresolved");
  }
  if (JSON.stringify(limitations) !== JSON.stringify(expectedLimitations)) {
    fail();
  }
  freeze(raw);
  return Object.freeze({
    schemaVersion: "ecos-validated-visual-observations/2.1",
    validation: "projected_word_and_geometry_consistency_only",
    sourceSha256,
    sourcePageCount,
    pageNumber,
    rasterSha256,
    state: raw.state as "partial" | "unreadable",
    width,
    height,
    coordinateSystem: "rotated_display_cropbox_pixels_top_left",
    lines: Object.freeze(lines),
    limitationCodes: Object.freeze(limitations),
    observedWordCount,
    lowEngineConfidenceWordCount,
    geometryConflictCount: conflicts.length,
    raw,
    sourceAuthorityVerified: false,
    rasterBytesVerified: false,
    retrievalAuthorized: false,
    semanticVerified: false,
  });
}
