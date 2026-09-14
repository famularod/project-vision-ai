import {
  assertECOSLinkedOwnerProjectDocumentInventory,
  type ECOSLinkedOwnerProjectDocumentInventory,
} from "./ecos-linked-owner-project-document-inventory.ts";
import {
  assertECOSLinkedOwnerProjectDocumentIndexes,
  type ECOSLinkedOwnerProjectDocumentIndexes,
} from "./ecos-linked-owner-project-document-indexes.ts";

/** Whole-corpus literal DISCOVERY only. Text retains whole native lanes,
 * table rows/cells or OCR lines/words. It is not raw-page/citation authority,
 * geometry validation, meaning verification or a complete semantic answer. */
type Data = Record<string, unknown>;
export type ECOSOwnerSearchModality = "native" | "table" | "visual";
export interface ECOSOwnerPageSearchHit {
  readonly source_id: string;
  readonly source_sha256: string;
  readonly source_revision: string | null;
  readonly source_page_count: number;
  readonly execution_id: string;
  readonly binding_id: string;
  readonly page_number: number;
  readonly attempt_id: string;
  readonly page_sha256: string;
  readonly extraction_version: "ecos-owner-native-preview/2.0";
  readonly modality: ECOSOwnerSearchModality;
  readonly payload_sha256: string;
  readonly material_sha256: string;
  readonly planning_sha256: string;
  readonly planning_bytes: number;
  readonly score: number;
  readonly planning_json: string | null;
  readonly planning_state: "whole_lane" | "whole_lane_text_over_preview_limit";
  readonly planning: Readonly<Data> | null;
}
export interface ECOSOwnerPageSearch {
  readonly schema_version: "ecos-owner-page-search/2.1";
  readonly publication_mode: "shadow";
  readonly organization_id: string;
  readonly project_id: string;
  readonly owner_id: string;
  readonly inventory_epoch_sha256: string;
  readonly index_epoch_sha256: string;
  readonly search_epoch_sha256: string;
  readonly query: string;
  readonly lexemes: readonly string[];
  readonly total_source_count: number;
  readonly total_expected_page_count: number;
  readonly coverage: readonly Readonly<Data>[];
  readonly matching_lane_count: number;
  readonly returned_lane_count: number;
  readonly omitted_matching_lane_count: number;
  readonly has_more: boolean;
  readonly limit: number;
  readonly hits: readonly Readonly<ECOSOwnerPageSearchHit>[];
  readonly method: "postgres_simple_lexeme_or";
  readonly purpose: "planning_only_not_citations";
  readonly semantic_relevance: "not_verified";
  readonly retrieval_authorized: false;
  readonly semantic_verified: false;
  readonly image_available: false;
  readonly binding_basis: "exact_complete_owner_index_and_query";
  readonly currentness: "at_search_read_only_not_atomic";
}
export interface ECOSOwnerPageSearchExpected {
  query: string;
  limit?: number;
  expectedSearchEpoch?: string | null;
}
const encoder = new TextEncoder(),
  MAX = 2 * 1024 * 1024,
  SHA = /^[a-f0-9]{64}$/;
const lanes = ["native", "table", "visual"] as const;
const states = ["partial", "unreadable", "failed", "not_attempted"] as const;
const material = [
  "searchable",
  "nontext",
  "material_missing",
  "invalid",
  "over_limit",
] as const;
const fail = (): never => {
  throw new Error(
    "Owner page planning search invalid, changed, cancelled or over bounds",
  );
};
const origins = new WeakMap<
  object,
  {
    inventory: ECOSLinkedOwnerProjectDocumentInventory;
    indexes: ECOSLinkedOwnerProjectDocumentIndexes;
  }
>();
function text(v: unknown, max = 8192) {
  if (typeof v !== "string" || encoder.encode(v).length > max) return fail();
  for (const c of v) {
    const n = c.codePointAt(0)!;
    if (n === 0 || n >= 0xd800 && n <= 0xdfff) return fail();
  }
  return v;
}
function integer(v: unknown, max: number, min = 0) {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < min || v > max) {
    return fail();
  }
  return v;
}
function digest(v: unknown) {
  const s = text(v, 64);
  if (!SHA.test(s)) return fail();
  return s;
}
function object(v: unknown, keys: readonly string[]) {
  if (
    !v || typeof v !== "object" || Array.isArray(v) ||
    Object.getPrototypeOf(v) !== Object.prototype
  ) return fail();
  const ds = Object.getOwnPropertyDescriptors(v);
  if (
    Reflect.ownKeys(v).length !== keys.length ||
    keys.some((k) => !Object.hasOwn(ds, k)) ||
    Object.values(ds).some((d) => !d.enumerable || !Object.hasOwn(d, "value"))
  ) return fail();
  return Object.fromEntries(keys.map((k) => [k, ds[k].value]));
}
function array(v: unknown, max: number) {
  if (
    !Array.isArray(v) || Object.getPrototypeOf(v) !== Array.prototype ||
    v.length > max || Reflect.ownKeys(v).length !== v.length + 1
  ) return fail();
  return Array.from({ length: v.length }, (_, i) => {
    const d = Object.getOwnPropertyDescriptor(v, String(i));
    if (!d?.enumerable || !Object.hasOwn(d, "value")) return fail();
    return d.value;
  });
}
function snapshot(v: unknown) {
  let nodes = 0, total = 0;
  const visit = (x: unknown, depth: number): unknown => {
    if (++nodes > 200000 || depth > 20) return fail();
    if (x === null || typeof x === "boolean") return x;
    if (typeof x === "number") {
      if (!Number.isFinite(x)) return fail();
      return x;
    }
    if (typeof x === "string") {
      total += encoder.encode(x).length;
      if (total > MAX) return fail();
      return text(x, MAX);
    }
    if (Array.isArray(x)) {
      return array(x, 20600).map((y) => visit(y, depth + 1));
    }
    if (
      !x || typeof x !== "object" ||
      Object.getPrototypeOf(x) !== Object.prototype
    ) return fail();
    const ds = Object.getOwnPropertyDescriptors(x);
    if (
      Reflect.ownKeys(x).length !== Object.keys(ds).length ||
      Object.values(ds).some((d) => !d.enumerable || !Object.hasOwn(d, "value"))
    ) return fail();
    return Object.fromEntries(
      Object.entries(ds).map(([k, d]) => {
        total += encoder.encode(k).length;
        if (
          total > MAX || ["__proto__", "constructor", "prototype"].includes(k)
        ) return fail();
        return [k, visit(d.value, depth + 1)];
      }),
    );
  };
  const result = visit(v, 0);
  if (encoder.encode(JSON.stringify(result)).length > MAX) return fail();
  return result;
}
function freeze<T>(v: T): T {
  if (v && typeof v === "object" && !Object.isFrozen(v)) {
    Object.values(v).forEach(freeze);
    Object.freeze(v);
  }
  return v;
}
async function hash(raw: string) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(raw)),
    ),
  ].map((x) => x.toString(16).padStart(2, "0")).join("");
}
function compare(a: string, b: string) {
  const x = encoder.encode(a), y = encoder.encode(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i] !== y[i]) return x[i] - y[i];
  }
  return x.length - y.length;
}
function expectation(raw: ECOSOwnerPageSearchExpected) {
  const ds = Object.getOwnPropertyDescriptors(raw ?? {});
  if (
    !raw || Object.getPrototypeOf(raw) !== Object.prototype ||
    Reflect.ownKeys(raw).some((k) =>
      typeof k !== "string" ||
      !["query", "limit", "expectedSearchEpoch"].includes(k)
    ) ||
    Object.values(ds).some((d) => !d.enumerable || !Object.hasOwn(d, "value"))
  ) return fail();
  const q = text(ds.query?.value, 8192);
  if (
    [...q].length < 1 || [...q].length > 2048 ||
    [...q].some((c) => {
      const n = c.codePointAt(0)!;
      return n < 32 && ![9, 10, 13].includes(n) || n === 127;
    })
  ) return fail();
  return {
    query: q,
    limit: integer(ds.limit?.value ?? 8, 8, 1),
    expectedSearchEpoch: ds.expectedSearchEpoch?.value == null
      ? null
      : digest(ds.expectedSearchEpoch.value),
  };
}
// SQL emits canonical JSON, never duplicate keys. Reject rehashed noncanonical
// duplicate objects or rounded structural integer tokens before parsing them.
function planningJSON(raw: string) {
  let p = 0;
  const parsed = JSON.parse(raw),
    ws = () => {
      while (/[\x20\t\r\n]/.test(raw[p] ?? "x")) p++;
    };
  const str = () => {
    const start = p++;
    while (p < raw.length) {
      const c = raw[p++];
      if (c === "\\") p++;
      else if (c === '"') return text(JSON.parse(raw.slice(start, p)), 8192);
    }
    return fail();
  };
  const visit = (depth: number, key = "") => {
    if (depth > 16) return fail();
    ws();
    const op = raw[p];
    if (op === "{" || op === "[") {
      p++;
      const end = op === "{" ? "}" : "]", seen = new Set<string>();
      ws();
      while (raw[p] !== end) {
        let k = "";
        if (op === "{") {
          k = str();
          if (
            seen.has(k) || ["__proto__", "constructor", "prototype"].includes(k)
          ) return fail();
          seen.add(k);
          ws();
          p++;
        }
        visit(depth + 1, k);
        ws();
        if (raw[p] === end) break;
        p++;
        ws();
      }
      p++;
    } else if (op === '"') str();
    else {
      const start = p;
      while (p < raw.length && !/[\x20\t\r\n,}\]]/.test(raw[p])) p++;
      const token = raw.slice(start, p);
      if (
        ["row_number", "column_number"].includes(key) &&
        (!/^[1-9][0-9]*$/.test(token) || !Number.isSafeInteger(Number(token)))
      ) return fail();
    }
  };
  visit(0);
  return parsed;
}
function planning(raw: string, lane: ECOSOwnerSearchModality, page: number) {
  const p = object(planningJSON(raw), [
    "modality",
    "checkpoint_limitation_codes",
    "observation_limitation_codes",
    "content",
  ]);
  if (p.modality !== lane) return fail();
  for (
    const k of ["checkpoint_limitation_codes", "observation_limitation_codes"]
  ) {
    const list = array(p[k], 32);
    if (
      list.length < 1 || new Set(list).size !== list.length ||
      list.some((x) =>
        typeof x !== "string" || !/^[a-z][a-z0-9_]{0,99}$/.test(x)
      )
    ) return fail();
  }
  if (lane === "native") {
    const c = object(p.content, ["page_text"]);
    text(c.page_text, 8192);
  } else if (lane === "table") {
    const c = object(p.content, ["tables"]);
    array(c.tables, 16).forEach((raw, i) => {
      const t = object(raw, ["table_id", "rows"]);
      if (t.table_id !== `page:${page}:table:${i + 1}`) return fail();
      array(t.rows, 256).forEach((raw, j) => {
        const r = object(raw, ["row_number", "cells"]);
        if (r.row_number !== j + 1) return fail();
        array(r.cells, 32).forEach((raw, k) => {
          const c = object(raw, ["column_number", "text"]);
          if (c.column_number !== k + 1) return fail();
          if (c.text !== null) text(c.text, 8192);
        });
      });
    });
  } else {
    const c = object(p.content, ["lines", "geometry_conflicts"]);
    array(c.geometry_conflicts, 16000);
    array(c.lines, 16000).forEach((raw) => {
      const line = object(raw, ["line_id", "words"]);
      if (
        !/^b[1-9][0-9]*:p[1-9][0-9]*:l[1-9][0-9]*$/.test(
          text(line.line_id, 100),
        )
      ) return fail();
      array(line.words, 10000).forEach((raw) => {
        const w = object(raw, [
          "word_id",
          "text",
          "engine_confidence",
          "engine_confidence_raw",
        ]);
        text(w.word_id, 100);
        text(w.text, 4096);
        text(w.engine_confidence_raw, 32);
        if (
          typeof w.engine_confidence !== "number" ||
          !Number.isFinite(w.engine_confidence) || w.engine_confidence < 0 ||
          w.engine_confidence > 100
        ) return fail();
      });
    });
  }
  return freeze(p);
}
const rootKeys = [
  "schema_version",
  "publication_mode",
  "organization_id",
  "project_id",
  "owner_id",
  "inventory_epoch_sha256",
  "index_epoch_sha256",
  "search_epoch_sha256",
  "query",
  "lexemes",
  "total_source_count",
  "total_expected_page_count",
  "coverage",
  "matching_lane_count",
  "returned_lane_count",
  "omitted_matching_lane_count",
  "has_more",
  "limit",
  "hits",
  "method",
  "purpose",
  "semantic_relevance",
  "retrieval_authorized",
  "semantic_verified",
  "image_available",
];
const hitKeys = [
  "source_id",
  "source_sha256",
  "source_revision",
  "source_page_count",
  "execution_id",
  "binding_id",
  "extraction_version",
  "page_number",
  "attempt_id",
  "page_sha256",
  "modality",
  "payload_sha256",
  "material_sha256",
  "planning_sha256",
  "planning_bytes",
  "score",
  "planning_json",
  "planning_state",
];

export async function bindECOSOwnerPageSearch(
  raw: unknown,
  inventory: ECOSLinkedOwnerProjectDocumentInventory,
  indexes: ECOSLinkedOwnerProjectDocumentIndexes,
  independentlyExpected: ECOSOwnerPageSearchExpected,
): Promise<Readonly<ECOSOwnerPageSearch>> {
  try {
    assertECOSLinkedOwnerProjectDocumentInventory(inventory);
    assertECOSLinkedOwnerProjectDocumentIndexes(indexes, inventory);
    const e = expectation(independentlyExpected),
      r = object(snapshot(raw), rootKeys);
    if (
      r.schema_version !== "ecos-owner-page-search/2.1" ||
      r.publication_mode !== "shadow" ||
      r.organization_id !== inventory.organization_id ||
      r.project_id !== inventory.project_id ||
      r.owner_id !== inventory.owner_id ||
      r.inventory_epoch_sha256 !== inventory.epoch_sha256 ||
      r.index_epoch_sha256 !== indexes.index_epoch_sha256 ||
      r.query !== e.query || r.limit !== e.limit ||
      r.method !== "postgres_simple_lexeme_or" ||
      r.purpose !== "planning_only_not_citations" ||
      r.semantic_relevance !== "not_verified" ||
      r.retrieval_authorized !== false || r.semantic_verified !== false ||
      r.image_available !== false
    ) return fail();
    const epoch = digest(r.search_epoch_sha256);
    if (e.expectedSearchEpoch !== null && epoch !== e.expectedSearchEpoch) {
      return fail();
    }
    const lexemes = array(r.lexemes, 32).map((x) => text(x, 2048));
    if (
      new Set(lexemes).size !== lexemes.length ||
      lexemes.some((v, i) => !v || i > 0 && compare(lexemes[i - 1], v) >= 0)
    ) return fail();
    if (
      r.total_source_count !== indexes.total_source_count ||
      r.total_expected_page_count !== indexes.total_expected_page_count
    ) return fail();
    const coverage = array(r.coverage, 600);
    if (coverage.length !== indexes.sources.length) return fail();
    let searchable = 0;
    coverage.forEach((raw, i) => {
      const c = object(raw, [
          "source_id",
          "source_page_count",
          "resolution_state",
          "page_head_count",
          "missing_page_count",
          "lanes",
        ]),
        source = indexes.sources[i];
      if (
        c.source_id !== source.resolution.source_id ||
        c.source_page_count !== source.resolution.source_page_count ||
        c.resolution_state !== source.resolution.resolution_state
      ) return fail();
      const heads = source.pages.filter((p) => p.head !== null);
      if (
        c.page_head_count !== heads.length ||
        c.missing_page_count !== source.pages.length - heads.length
      ) return fail();
      const ls = object(c.lanes, lanes);
      for (const lane of lanes) {
        const s = object(ls[lane], [...states, "head_missing", ...material]);
        for (const k of Object.keys(s)) integer(s[k], 20000);
        if (
          s.head_missing !== source.pages.length - heads.length ||
          states.some((state) =>
            s[state] !==
              heads.filter((p) => p.head!.modalities[lane].state === state)
                .length
          )
        ) return fail();
        if (
          material.reduce((sum, k) => sum + (s[k] as number), 0) !==
            heads.length ||
          (s.searchable as number) > (s.partial as number) ||
          (s.nontext as number) > heads.length - (s.partial as number) ||
          (s.invalid as number) + (s.over_limit as number) +
                (s.searchable as number) > (s.partial as number)
        ) return fail();
        searchable += s.searchable as number;
      }
    });
    const matches = integer(r.matching_lane_count, 60000),
      returned = integer(r.returned_lane_count, 8),
      omitted = integer(r.omitted_matching_lane_count, 60000);
    if (
      matches > searchable || returned !== Math.min(matches, e.limit) ||
      omitted !== matches - returned || r.has_more !== (omitted > 0) ||
      lexemes.length === 0 && matches !== 0
    ) return fail();
    const rawHits = array(r.hits, 8);
    if (rawHits.length !== returned) return fail();
    const seen = new Set<string>();
    let previous: Data | null = null;
    const hits: Readonly<ECOSOwnerPageSearchHit>[] = [];
    for (const rawHit of rawHits) {
      const h = object(rawHit, hitKeys),
        source = indexes.sources.find((s) =>
          s.resolution.source_id === h.source_id
        ),
        ex = source?.resolution.execution;
      if (
        !source || !ex ||
        !["execution_current", "execution_in_progress"].includes(
          source.resolution.resolution_state,
        )
      ) return fail();
      const no = integer(h.page_number, ex.source_page_count, 1),
        head = source.pages.find((p) => p.page_number === no)?.head,
        lane = h.modality as ECOSOwnerSearchModality;
      if (
        !head || !lanes.includes(lane) ||
        head.modalities[lane].state !== "partial" ||
        h.attempt_id !== head.attempt_id ||
        h.page_sha256 !== head.page_sha256 ||
        h.payload_sha256 !== head.modalities[lane].payload_sha256
      ) return fail();
      for (
        const k of [
          "source_sha256",
          "source_revision",
          "source_page_count",
          "execution_id",
          "binding_id",
          "extraction_version",
        ] as const
      ) if (h[k] !== ex[k]) return fail();
      digest(h.material_sha256);
      digest(h.planning_sha256);
      const bytes = integer(h.planning_bytes, 1048576, 1);
      if (
        typeof h.score !== "number" || !Number.isFinite(h.score) ||
        h.score < 0 || h.score > 1000000
      ) return fail();
      const key = JSON.stringify([h.attempt_id, lane]);
      if (seen.has(key)) return fail();
      seen.add(key);
      if (previous) {
        const cmp = (previous.score as number) - (h.score as number);
        if (
          cmp < 0 ||
          cmp === 0 &&
            (compare(previous.source_id as string, h.source_id as string) > 0 ||
              previous.source_id === h.source_id &&
                ((previous.page_number as number) > no ||
                  previous.page_number === no &&
                    compare(previous.modality as string, lane) >= 0))
        ) return fail();
      }
      previous = h;
      let content: Readonly<Data> | null = null;
      if (bytes > 8192) {
        if (
          h.planning_json !== null ||
          h.planning_state !== "whole_lane_text_over_preview_limit"
        ) return fail();
      } else {
        const raw = text(h.planning_json, 8192);
        if (
          h.planning_state !== "whole_lane" ||
          encoder.encode(raw).length !== bytes ||
          await hash(raw) !== h.planning_sha256
        ) return fail();
        content = planning(raw, lane, no);
      }
      hits.push(
        freeze({ ...h, planning: content }) as unknown as Readonly<
          ECOSOwnerPageSearchHit
        >,
      );
    }
    const result = freeze({
      ...r,
      hits,
      binding_basis: "exact_complete_owner_index_and_query",
      currentness: "at_search_read_only_not_atomic",
    }) as unknown as Readonly<ECOSOwnerPageSearch>;
    if (encoder.encode(JSON.stringify(result)).length > MAX) return fail();
    origins.set(result, { inventory, indexes });
    return result;
  } catch {
    return fail();
  }
}
export function assertECOSOwnerPageSearch(
  value: unknown,
  inventory: ECOSLinkedOwnerProjectDocumentInventory,
  indexes: ECOSLinkedOwnerProjectDocumentIndexes,
): asserts value is ECOSOwnerPageSearch {
  const origin = value && typeof value === "object"
    ? origins.get(value)
    : undefined;
  if (!origin || origin.inventory !== inventory || origin.indexes !== indexes) {
    return fail();
  }
}

export type ECOSOwnerPageSearchRPC = (
  name: "ecos_search_linked_owner_page_observations",
  parameters: Readonly<
    {
      p_organization_id: string;
      p_project_id: string;
      p_owner_id: string;
      p_expected_inventory_epoch: string;
      p_expected_index_epoch: string;
      p_query: string;
      p_expected_search_epoch: string | null;
      p_limit: number;
    }
  >,
  signal: AbortSignal,
) => Promise<unknown>;
/** One discovery read followed by exact search+complete-index-epoch recheck.
 * Request data is captured before awaits; no hidden retry, writes or credentials.
 * Hashing/JSON work is bounded cooperatively, not a preallocation/RSS promise. */
export async function loadECOSOwnerPageSearch(
  inventory: ECOSLinkedOwnerProjectDocumentInventory,
  indexes: ECOSLinkedOwnerProjectDocumentIndexes,
  query: string,
  rpc: ECOSOwnerPageSearchRPC,
  options: {
    signal?: AbortSignal;
    budgetMs?: number;
    limit?: number;
    expectedSearchEpoch?: string | null;
  } = {},
) {
  let timer: ReturnType<typeof setTimeout> | undefined,
    onAbort: (() => void) | undefined,
    signal: AbortSignal | undefined;
  const controller = new AbortController();
  try {
    assertECOSLinkedOwnerProjectDocumentInventory(inventory);
    assertECOSLinkedOwnerProjectDocumentIndexes(indexes, inventory);
    const ds = Object.getOwnPropertyDescriptors(options);
    if (
      !options || Object.getPrototypeOf(options) !== Object.prototype ||
      Reflect.ownKeys(options).some((k) =>
        typeof k !== "string" ||
        !["signal", "budgetMs", "limit", "expectedSearchEpoch"].includes(k)
      ) || Object.values(ds).some((d) =>
        !d.enumerable || !Object.hasOwn(d, "value")
      ) || typeof rpc !== "function"
    ) {
      return fail();
    }
    const e = expectation({
        query,
        limit: ds.limit?.value ?? 8,
        expectedSearchEpoch: ds.expectedSearchEpoch?.value ?? null,
      }),
      budget = integer(ds.budgetMs?.value ?? 30000, 120000, 1);
    signal = ds.signal?.value as AbortSignal | undefined;
    const aborted = Object.getOwnPropertyDescriptor(
      AbortSignal.prototype,
      "aborted",
    )!.get!;
    if (signal !== undefined && aborted.call(signal)) {
      return fail();
    }
    const deadline = performance.now() + budget;
    const check = () => {
      if (
        controller.signal.aborted ||
        signal !== undefined && aborted.call(signal) ||
        performance.now() >= deadline
      ) {
        return fail();
      }
    };
    const stop = new Promise<never>((_, reject) => {
      onAbort = () => {
        controller.abort();
        reject(new Error("Owner search stopped"));
      };
      if (signal) {
        EventTarget.prototype.addEventListener.call(signal, "abort", onAbort, {
          once: true,
        });
      }
      timer = setTimeout(onAbort, budget);
    });
    const call = async (expected: string | null) => {
      check();
      const end = Math.min(deadline, performance.now() + 25000);
      let callTimer: ReturnType<typeof setTimeout> | undefined;
      const callStop = new Promise<never>((_, reject) => {
        callTimer = setTimeout(() => {
          controller.abort();
          reject(new Error("Owner search call deadline"));
        }, Math.max(1, end - performance.now()));
      });
      const parameters = Object.freeze({
        p_organization_id: inventory.organization_id,
        p_project_id: inventory.project_id,
        p_owner_id: inventory.owner_id,
        p_expected_inventory_epoch: inventory.epoch_sha256,
        p_expected_index_epoch: indexes.index_epoch_sha256,
        p_query: e.query,
        p_expected_search_epoch: expected,
        p_limit: e.limit,
      });
      try {
        const read = await Promise.race([
          Promise.resolve().then(() => {
            check();
            return rpc(
              "ecos_search_linked_owner_page_observations",
              parameters,
              controller.signal,
            );
          }).then((raw) => {
            check();
            if (performance.now() >= end) {
              return fail();
            }
            return bindECOSOwnerPageSearch(raw, inventory, indexes, {
              ...e,
              expectedSearchEpoch: expected,
            });
          }),
          stop,
          callStop,
        ]);
        check();
        if (performance.now() >= end) {
          return fail();
        }
        return read;
      } finally {
        if (callTimer !== undefined) {
          clearTimeout(callTimer);
        }
      }
    };
    const result = await call(e.expectedSearchEpoch),
      final = await call(result.search_epoch_sha256);
    if (JSON.stringify(result) !== JSON.stringify(final)) {
      return fail();
    }
    check();
    return result;
  } catch {
    return fail();
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (onAbort && signal) {
      EventTarget.prototype.removeEventListener.call(signal, "abort", onAbort);
    }
    controller.abort();
  }
}
