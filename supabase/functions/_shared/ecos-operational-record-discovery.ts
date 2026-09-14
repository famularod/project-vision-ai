import {
  assertECOSProjectRecordInventory,
  type ECOSProjectRecordInventory,
  type ECOSProjectRecordInventoryRow,
} from './ecos-project-record-inventory.ts';

const encoder = new TextEncoder();
const MAX_CANDIDATES = 8;
const MAX_CANDIDATE_BYTES = 48 * 1024;
const origins = new WeakMap<object, ECOSProjectRecordInventory>();

export interface ECOSOperationalRecordCandidate {
  row: Readonly<ECOSProjectRecordInventoryRow>;
  matched_terms: readonly string[];
  lexical_score: number;
}
export interface ECOSOperationalRecordDiscovery {
  schema_version: 'ecos-operational-record-discovery/2.0';
  query: string;
  record_epoch_sha256: string;
  discovery_sha256: string;
  coverage: Readonly<{
    total_record_count: number;
    eligible_record_count: number;
    matching_record_count: number;
    returned_record_count: number;
    oversized_record_count: number;
    has_more: boolean;
    gaps: readonly string[];
    method: 'bounded_literal_lexical_search';
    semantic_relevance: 'not_verified';
  }>;
  candidates: readonly Readonly<ECOSOperationalRecordCandidate>[];
}

function tokens(text: string): Set<string> {
  return new Set(
    text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [],
  );
}
function compare(a: string, b: string): number {
  const left = encoder.encode(a), right = encoder.encode(b);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return left.length - right.length;
}
function checkSignal(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error('Operational discovery cancelled');
}

/** Searches every recorded row in the genuine complete inventory. This is
 * literal lexical discovery, not language understanding or site verification.
 * Ranking never clips a note or drops a qualifier from a returned record. */
export async function discoverECOSOperationalRecordCandidates(
  inventory: Readonly<ECOSProjectRecordInventory>,
  query: string,
  signal?: AbortSignal,
): Promise<Readonly<ECOSOperationalRecordDiscovery>> {
  assertECOSProjectRecordInventory(inventory);
  if (
    typeof query !== 'string' || !query.trim() || [...query].length > 4000 ||
    encoder.encode(query).length > 16 * 1024 ||
    [...query].some((character) => {
      const code = character.codePointAt(0)!;
      return (code < 32 && code !== 9 && code !== 10 && code !== 13) ||
        (code >= 127 && code <= 159);
    }) ||
    /[\ud800-\udfff]/u.test(
      query.replace(/[\ud800-\udbff][\udc00-\udfff]/gu, ''),
    )
  ) throw new Error('Invalid bounded operational search query');
  checkSignal(signal);
  const terms = [...tokens(query)].sort(compare);
  if (terms.length > 64) {
    throw new Error('Operational query exceeds lexical term bound');
  }
  const eligible = inventory.rows.filter((row) =>
    row.disposition === 'recorded'
  );
  const frequencies = new Map(terms.map((term) => [term, 0]));
  const matched = eligible.map((row) => {
    checkSignal(signal);
    // Decode JSON before searching so escaped Unicode/newlines are not mistaken
    // for literal source text. Keys and all scalar values are searchable; no
    // scalar is interpreted as instructions and unknown fields remain intact.
    const found = new Set<string>();
    const stack: unknown[] = [JSON.parse(row.record_json)];
    while (stack.length) {
      const value = stack.pop();
      if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) {
          for (const term of tokens(key)) {
            if (frequencies.has(term)) found.add(term);
          }
          stack.push(child);
        }
      } else if (
        typeof value === 'string' || typeof value === 'number' ||
        typeof value === 'boolean'
      ) {
        for (const term of tokens(String(value))) {
          if (frequencies.has(term)) found.add(term);
        }
      }
    }
    for (const term of found) frequencies.set(term, frequencies.get(term)! + 1);
    return { row, matched_terms: [...found].sort(compare) };
  }).filter((entry) => entry.matched_terms.length > 0);
  const ranked = matched.map((entry) =>
    Object.freeze({
      row: entry.row,
      matched_terms: Object.freeze(entry.matched_terms),
      lexical_score: entry.matched_terms.reduce(
        (score, term) =>
          score + Math.log(1 + eligible.length / (frequencies.get(term)! + 1)),
        0,
      ),
    })
  ).sort((a, b) =>
    b.lexical_score - a.lexical_score ||
    compare(a.row.source_key, b.row.source_key)
  );
  const candidates: Readonly<ECOSOperationalRecordCandidate>[] = [];
  let bytes = 2, oversized = 0;
  for (const candidate of ranked) {
    checkSignal(signal);
    const size = encoder.encode(JSON.stringify(candidate)).length + 1;
    if (size + 2 > MAX_CANDIDATE_BYTES) {
      oversized++;
      continue;
    }
    if (
      candidates.length < MAX_CANDIDATES && bytes + size <= MAX_CANDIDATE_BYTES
    ) {
      candidates.push(candidate);
      bytes += size;
    }
  }
  const gaps: string[] = [];
  if (inventory.rows.some((row) => row.disposition === 'needs_review')) {
    gaps.push('records_needing_review_not_selected');
  }
  if (inventory.rows.some((row) => row.disposition === 'deleted_conflict')) {
    gaps.push('deleted_conflict_records_not_selected');
  }
  if (!terms.length) gaps.push('query_has_no_searchable_terms');
  if (!ranked.length) gaps.push('no_literal_record_matches');
  if (oversized) gaps.push('matching_whole_record_exceeds_context_budget');
  if (candidates.length < ranked.length) {
    gaps.push('matching_records_not_returned_within_candidate_budget');
  }
  const coverage = Object.freeze({
    total_record_count: inventory.total_count,
    eligible_record_count: eligible.length,
    matching_record_count: ranked.length,
    returned_record_count: candidates.length,
    oversized_record_count: oversized,
    has_more: candidates.length < ranked.length,
    gaps: Object.freeze(gaps),
    method: 'bounded_literal_lexical_search' as const,
    semantic_relevance: 'not_verified' as const,
  });
  const digestInput = JSON.stringify({
    algorithm: 'ecos-operational-record-discovery/2.0',
    query,
    epoch: inventory.epoch_sha256,
    max_candidates: MAX_CANDIDATES,
    max_candidate_bytes: MAX_CANDIDATE_BYTES,
    coverage,
    matches: ranked.map(({ row, matched_terms, lexical_score }) => ({
      source_key: row.source_key,
      source_sha256: row.source_sha256,
      matched_terms,
      lexical_score,
    })),
    selected: candidates.map(({ row }) => row.source_key),
  });
  const digest = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(digestInput),
  );
  checkSignal(signal);
  const discovery: Readonly<ECOSOperationalRecordDiscovery> = Object.freeze({
    schema_version: 'ecos-operational-record-discovery/2.0',
    query,
    record_epoch_sha256: inventory.epoch_sha256,
    discovery_sha256: [...new Uint8Array(digest)].map((b) =>
      b.toString(16).padStart(2, '0')
    ).join(''),
    coverage,
    candidates: Object.freeze(candidates),
  });
  origins.set(discovery, inventory);
  return discovery;
}

export function assertECOSOperationalRecordDiscovery(
  value: unknown,
  inventory: Readonly<ECOSProjectRecordInventory>,
  query: string,
): asserts value is Readonly<ECOSOperationalRecordDiscovery> {
  assertECOSProjectRecordInventory(inventory);
  if (
    !value || typeof value !== 'object' || origins.get(value) !== inventory ||
    (value as ECOSOperationalRecordDiscovery).query !== query
  ) {
    throw new Error(
      'Operational discovery must come from this exact inventory and query',
    );
  }
}
