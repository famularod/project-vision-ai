import type { ECOSLinkedOwnerProjectDocumentInventory } from './ecos-linked-owner-project-document-inventory.ts';
import type { ECOSLinkedOwnerProjectDocumentIndexes } from './ecos-linked-owner-project-document-indexes.ts';
import type { ECOSOwnerIndexedPageObservations } from './ecos-owner-indexed-page-observations-loader.ts';
import {
  assertECOSOwnerObservationBundle,
  type ECOSOwnerObservationBundle,
  type ECOSOwnerObservationPage,
} from './ecos-owner-observation-bundle.ts';
import type {
  ECOSOriginalNativeObservations,
  ECOSOriginalTable,
  ECOSOriginalTableObservations,
} from './ecos-original-page-observations.ts';

/** Discovery over ALREADY LOADED native/table observations only. This is not
 * project-corpus search, semantic selection, image/OCR inspection or an answer.
 * Whole native pages and whole tables are indivisible context units. In
 * particular, a match never removes negation, another row or unknown columns.
 */
export interface ECOSOwnerObservationCandidate {
  readonly candidate_id: string;
  readonly kind: 'native_page' | 'native_table';
  readonly provenance: Readonly<{
    source_id: string;
    source_sha256: string;
    source_revision: string | null;
    source_page_count: number;
    page_number: number;
    execution_id: string;
    binding_id: string;
    extraction_version: 'ecos-owner-native-preview/2.0';
    page_attempt_id: string;
    page_sha256: string;
    payload_sha256: string;
    modality: 'native' | 'table';
  }>;
  readonly matched_terms: readonly string[];
  readonly lexical_score: number;
  readonly content:
    | Readonly<{ native: ECOSOriginalNativeObservations }>
    | Readonly<{
      table: ECOSOriginalTable;
      page_geometry: ECOSOriginalTableObservations['pageGeometry'];
      limitation_codes: readonly string[];
      header_interpretation: 'not_performed_all_rows_retained';
    }>;
}
interface OmittedUnit {
  readonly candidate_id: string;
  readonly source_id: string;
  readonly page_number: number;
  readonly kind: ECOSOwnerObservationCandidate['kind'];
  readonly reason:
    | 'whole_unit_over_byte_limit'
    | 'context_budget'
    | 'candidate_limit';
}
export interface ECOSOwnerObservationDiscovery {
  readonly schema_version: 'ecos-owner-observation-discovery/2.1';
  readonly publication_mode: 'shadow';
  readonly organization_id: string;
  readonly project_id: string;
  readonly owner_id: string;
  readonly query: string;
  readonly terms: readonly string[];
  readonly inventory_epoch_sha256: string;
  readonly index_epoch_sha256: string;
  readonly discovery_sha256: string;
  readonly coverage: Readonly<{
    scope: 'already_loaded_native_tables_not_project_corpus';
    index_coverage: ECOSOwnerObservationBundle['coverage'];
    loaded_pages: readonly Readonly<{
      source_id: string;
      page_number: number;
      page_attempt_id: string;
      page_sha256: string;
      modalities: ECOSOwnerObservationPage['head']['modalities'];
    }>[];
    eligible_unit_count: number;
    matching_unit_count: number;
    returned_unit_count: number;
    omitted_matching_units: readonly OmittedUnit[];
    has_more: boolean;
    limitations: readonly string[];
  }>;
  readonly candidates: readonly ECOSOwnerObservationCandidate[];
  readonly limits: Readonly<
    { max_candidates: number; max_serialized_bytes: number }
  >;
  readonly method: 'bounded_normalized_literal_token_overlap';
  readonly semantic_relevance: 'not_verified';
  readonly answer_readiness: 'not_assessed';
  readonly whole_project_completeness: 'not_assessed';
  readonly currentness: 'supplied_bundle_only_no_network_recheck';
  readonly image_available: false;
  readonly retrieval_authorized: false;
  readonly semantic_verified: false;
  readonly atomic_project_snapshot: false;
}
export interface ECOSOwnerObservationDiscoveryOptions {
  signal?: AbortSignal;
  budgetMs?: number;
  /** Lower-only ceilings. The 96KiB limit is for this whole result, not a
   * guarantee that a later model request including prompts/schemas will fit. */
  maxCandidateBytes?: number;
  maxCandidates?: number;
}
const encoder = new TextEncoder();
const MAX_BYTES = 96 * 1024;
const origins = new WeakMap<
  object,
  { bundle: WeakRef<ECOSOwnerObservationBundle>; query: string }
>();
const abortedGetter = Object.getOwnPropertyDescriptor(
  AbortSignal.prototype,
  'aborted',
)!.get!;
const invalid = () =>
  new Error('Owner observation discovery invalid, cancelled or over bounds');
const bytes = (value: unknown) => encoder.encode(JSON.stringify(value));
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function options(raw: ECOSOwnerObservationDiscoveryOptions) {
  if (
    !raw || typeof raw !== 'object' ||
    Object.getPrototypeOf(raw) !== Object.prototype
  ) throw invalid();
  const keys = Reflect.ownKeys(raw), d = Object.getOwnPropertyDescriptors(raw);
  if (
    keys.some((k) =>
      typeof k !== 'string' ||
      !['signal', 'budgetMs', 'maxCandidateBytes', 'maxCandidates'].includes(k)
    ) ||
    Object.values(d).some((v) => !v.enumerable || !Object.hasOwn(v, 'value'))
  ) throw invalid();
  const signal = d.signal?.value as AbortSignal | undefined;
  const budgetMs = d.budgetMs?.value === undefined ? 30000 : d.budgetMs.value,
    maxCandidateBytes = d.maxCandidateBytes?.value === undefined
      ? MAX_BYTES
      : d.maxCandidateBytes.value,
    maxCandidates = d.maxCandidates?.value === undefined
      ? 8
      : d.maxCandidates.value;
  for (
    const [v, max] of [[budgetMs, 30000], [maxCandidateBytes, MAX_BYTES], [
      maxCandidates,
      8,
    ]]
  ) {
    if (!Number.isSafeInteger(v) || v < 1 || v > max) throw invalid();
  }
  if (signal !== undefined) abortedGetter.call(signal);
  return { signal, budgetMs, maxCandidateBytes, maxCandidates };
}
function queryText(value: string) {
  if (typeof value !== 'string' || value.length > 16000 || !value.trim()) {
    throw invalid();
  }
  let points = 0;
  for (const c of value) {
    const n = c.codePointAt(0)!;
    if (
      ++points > 4000 || n < 32 && ![9, 10, 13].includes(n) ||
      n >= 127 && n <= 159 || n >= 0xd800 && n <= 0xdfff
    ) throw invalid();
  }
  if (encoder.encode(value).length > 16000) throw invalid();
  return value;
}
function tokens(value: string) {
  return value.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}
function compare(a: string, b: string) {
  const left = encoder.encode(a), right = encoder.encode(b);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return left.length - right.length;
}

/** All identity arguments are independently branded; the bundle must originate
 * from these exact inventory/index/selected-read instances. No caller-supplied
 * source list, model selection, synthetic job or currentness assertion is used.
 * Work is cooperatively bounded; synchronous tokenization cannot be preempted.
 * Hash awaits are raced against cancellation/deadline even if noncooperative.
 */
export async function discoverECOSOwnerObservationCandidates(
  inventory: ECOSLinkedOwnerProjectDocumentInventory,
  indexes: ECOSLinkedOwnerProjectDocumentIndexes,
  selected: ECOSOwnerIndexedPageObservations,
  bundle: ECOSOwnerObservationBundle,
  exactQuery: string,
  suppliedOptions: ECOSOwnerObservationDiscoveryOptions = {},
): Promise<Readonly<ECOSOwnerObservationDiscovery>> {
  let timer: ReturnType<typeof setTimeout> | undefined,
    onAbort: (() => void) | undefined,
    signal: AbortSignal | undefined;
  try {
    const o = options(suppliedOptions);
    signal = o.signal;
    const deadline = performance.now() + o.budgetMs;
    const check = () => {
      if (
        signal && abortedGetter.call(signal) || performance.now() >= deadline
      ) throw invalid();
    };
    check();
    assertECOSOwnerObservationBundle(bundle, inventory, indexes, selected);
    if (bundle.pages.length < 1 || bundle.pages.length > 8) throw invalid();
    const query = queryText(exactQuery),
      terms = [...new Set(tokens(query))].sort(compare);
    if (terms.length > 64) throw invalid();
    const wanted = new Set(terms);
    const units: ECOSOwnerObservationCandidate[] = [];
    let eligible = 0;
    const orderedPages = [...bundle.pages].sort((a, b) =>
      compare(a.source_id, b.source_id) || a.page_number - b.page_number
    );
    const add = (
      page: ECOSOwnerObservationPage,
      modality: 'native' | 'table',
      content: ECOSOwnerObservationCandidate['content'],
      strings: Iterable<string>,
    ) => {
      check();
      const id = `c${++eligible}`, found = new Set<string>();
      for (const text of strings) {
        check();
        for (const term of tokens(text)) if (wanted.has(term)) found.add(term);
      }
      if (!found.size) return;
      const payloadSha = page.modalities[modality].payload_sha256;
      if (!payloadSha) throw invalid();
      units.push(freeze({
        candidate_id: id,
        kind: modality === 'native' ? 'native_page' : 'native_table',
        provenance: {
          source_id: page.source_id,
          source_sha256: page.source_sha256,
          source_revision: page.source_revision,
          source_page_count: page.source_page_count,
          page_number: page.page_number,
          execution_id: page.execution_id,
          binding_id: page.binding_id,
          extraction_version: page.extraction_version,
          page_attempt_id: page.head.attempt_id,
          page_sha256: page.head.page_sha256,
          payload_sha256: payloadSha,
          modality,
        },
        matched_terms: [...found].sort(compare),
        lexical_score: found.size,
        content,
      }));
      check();
    };
    for (const page of orderedPages) {
      check();
      const native = page.modalities.native, table = page.modalities.table;
      if (native.state === 'partial' && native.observations) {
        add(page, 'native', { native: native.observations }, [
          native.observations.pageText,
        ]);
      }
      if (table.state === 'partial' && table.observations) {
        for (const raw of table.observations.tables) {
          add(
            page,
            'table',
            {
              table: raw,
              page_geometry: table.observations.pageGeometry,
              limitation_codes: table.limitation_codes,
              header_interpretation: 'not_performed_all_rows_retained',
            },
            raw.rows.flatMap((row) =>
              row.cells.flatMap((cell) => cell.text === null ? [] : [cell.text])
            ),
          );
        }
      }
    }
    // Stable ties use the original bounded unit order, not authority/revision,
    // numerical agreement, positive wording or a merged subject identity.
    units.sort((a, b) =>
      b.lexical_score - a.lexical_score ||
      Number(a.candidate_id.slice(1)) - Number(b.candidate_id.slice(1))
    );
    const omissions = new Map(
      units.map((
        unit,
      ) => [
        unit.candidate_id,
        bytes(unit).length > o.maxCandidateBytes
          ? 'whole_unit_over_byte_limit' as const
          : 'context_budget' as OmittedUnit['reason'],
      ]),
    );
    const candidates: ECOSOwnerObservationCandidate[] = [];
    const limitations = [
      'lexical_overlap_is_not_semantic_relevance',
      'only_already_loaded_native_and_table_content_searched',
      'visual_ocr_and_raster_images_not_searched',
      'whole_project_library_completeness_not_assessed',
      'no_match_is_not_source_absence',
      'native_visibility_reading_order_and_table_semantics_not_verified',
      'conflicting_sources_and_qualifiers_not_resolved',
      'partial_extraction_does_not_account_for_all_page_content',
      'serialized_discovery_limit_not_full_model_request_budget',
    ];
    if (!terms.length) limitations.push('query_has_no_searchable_tokens');
    if (!units.length) {
      limitations.push('no_literal_matches_in_loaded_native_tables');
    }
    const assemble = (): ECOSOwnerObservationDiscovery => ({
      schema_version: 'ecos-owner-observation-discovery/2.1',
      publication_mode: 'shadow',
      organization_id: inventory.organization_id,
      project_id: inventory.project_id,
      owner_id: inventory.owner_id,
      query,
      terms,
      inventory_epoch_sha256: inventory.epoch_sha256,
      index_epoch_sha256: indexes.index_epoch_sha256,
      discovery_sha256: '0'.repeat(64),
      coverage: {
        scope: 'already_loaded_native_tables_not_project_corpus',
        index_coverage: bundle.coverage,
        loaded_pages: orderedPages.map((p) => ({
          source_id: p.source_id,
          page_number: p.page_number,
          page_attempt_id: p.head.attempt_id,
          page_sha256: p.head.page_sha256,
          modalities: p.head.modalities,
        })),
        eligible_unit_count: eligible,
        matching_unit_count: units.length,
        returned_unit_count: candidates.length,
        omitted_matching_units: units.filter((u) =>
          omissions.has(u.candidate_id)
        ).map((u) => ({
          candidate_id: u.candidate_id,
          source_id: u.provenance.source_id,
          page_number: u.provenance.page_number,
          kind: u.kind,
          reason: omissions.get(u.candidate_id)!,
        })),
        has_more: omissions.size > 0,
        limitations,
      },
      candidates: [...candidates],
      limits: {
        max_candidates: o.maxCandidates,
        max_serialized_bytes: o.maxCandidateBytes,
      },
      method: 'bounded_normalized_literal_token_overlap',
      semantic_relevance: 'not_verified',
      answer_readiness: 'not_assessed',
      whole_project_completeness: 'not_assessed',
      currentness: 'supplied_bundle_only_no_network_recheck',
      image_available: false,
      retrieval_authorized: false,
      semantic_verified: false,
      atomic_project_snapshot: false,
    });
    // Never silently discard the coverage denominator to make content fit.
    if (bytes(assemble()).length > o.maxCandidateBytes) throw invalid();
    for (const unit of units) {
      check();
      if (omissions.get(unit.candidate_id) === 'whole_unit_over_byte_limit') {
        continue;
      }
      if (candidates.length >= o.maxCandidates) {
        omissions.set(unit.candidate_id, 'candidate_limit');
        continue;
      }
      candidates.push(unit);
      omissions.delete(unit.candidate_id);
      if (bytes(assemble()).length > o.maxCandidateBytes) {
        candidates.pop();
        omissions.set(unit.candidate_id, 'context_budget');
      }
    }
    const result = assemble(), encoded = bytes(result);
    if (encoded.length > o.maxCandidateBytes) throw invalid();
    check();
    const stop = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(invalid());
      if (signal) {
        EventTarget.prototype.addEventListener.call(signal, 'abort', onAbort, {
          once: true,
        });
      }
      timer = setTimeout(onAbort, Math.max(1, deadline - performance.now()));
    });
    const digest = await Promise.race([
      Promise.resolve().then(() => {
        check();
        return crypto.subtle.digest('SHA-256', encoded);
      }),
      stop,
    ]);
    check();
    const out = freeze({
      ...result,
      discovery_sha256: [...new Uint8Array(digest)].map((b) =>
        b.toString(16).padStart(2, '0')
      ).join(''),
    });
    origins.set(out, { bundle: new WeakRef(bundle), query });
    return out;
  } catch {
    throw invalid();
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (signal && onAbort) {
      EventTarget.prototype.removeEventListener.call(signal, 'abort', onAbort);
    }
  }
}

export function assertECOSOwnerObservationDiscovery(
  value: unknown,
  bundle: ECOSOwnerObservationBundle,
  exactQuery: string,
): asserts value is Readonly<ECOSOwnerObservationDiscovery> {
  const origin = value && typeof value === 'object' ? origins.get(value) : null;
  if (
    !origin || origin.bundle.deref() !== bundle || origin.query !== exactQuery
  ) throw invalid();
}
