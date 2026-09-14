import { loadECOSLinkedProjectDocumentInventory } from './ecos-linked-project-document-inventory-loader.ts';
import { loadECOSLinkedProjectDocumentIndexes } from './ecos-linked-project-document-indexes-loader.ts';
import { loadECOSProjectRecordInventory } from './ecos-project-record-inventory-loader.ts';
import { loadECOSLinkedTableRetrievalBundle } from './ecos-linked-table-retrieval-loader.ts';
import { loadECOSLinkedNativePageSearch } from './ecos-linked-native-page-search-loader.ts';
import { discoverECOSOperationalRecordCandidates } from './ecos-operational-record-discovery.ts';
import {
  bindECOSQuestionInterpretation,
  bindECOSQuestionPlan,
  createECOSQuestionPlanningInput,
  type ECOSQuestionPlanningInput,
  validateECOSQuestionText,
} from './ecos-question-plan.ts';

export interface ECOSQuestionEvidenceRequest {
  organizationId: string;
  projectId: string;
  ownerId: string;
  question: string;
}
export type ECOSQuestionEvidenceRPC = (
  name:
    | 'ecos_list_linked_project_document_inventory'
    | 'ecos_resolve_linked_project_document_indexes'
    | 'ecos_list_project_record_inventory'
    | 'ecos_load_linked_manifest_table_source'
    | 'ecos_search_linked_native_page_sources',
  parameters: Readonly<Record<string, string | number | null>>,
  signal: AbortSignal,
) => Promise<unknown>;
export type ECOSQuestionEvidencePlanner = (
  input: Readonly<ECOSQuestionPlanningInput>,
  signal: AbortSignal,
) => Promise<unknown>;
export type ECOSQuestionEvidenceInterpreter = (
  question: string,
  signal: AbortSignal,
) => Promise<unknown>;
const preparedOrigins = new WeakSet<object>();
const revalidators = new WeakMap<
  object,
  (
    signal?: AbortSignal,
  ) => Promise<
    Readonly<
      {
        freshness: 'all_input_channels_rechecked_sequentially';
        rpc_calls: number;
      }
    >
  >
>();
function freezeContext<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) freezeContext(item);
    Object.freeze(value);
  }
  return value;
}

function copyRequest(value: ECOSQuestionEvidenceRequest) {
  if (
    !value || typeof value !== 'object' || Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) throw new Error('Invalid question request');
  const fields = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(value).length !== 4 ||
    Object.keys(fields).sort().join(',') !==
      'organizationId,ownerId,projectId,question' ||
    Object.values(fields).some((p) =>
      !p.enumerable || !Object.hasOwn(p, 'value')
    )
  ) throw new Error('Invalid question request');
  const identity = (input: unknown, uuid = false) => {
    if (
      typeof input !== 'string' || !input || input !== input.trim() ||
      new TextEncoder().encode(input).length > 500 ||
      [...input].some((char) => {
        const code = char.codePointAt(0)!;
        return code < 32 || (code >= 127 && code <= 159) ||
          (code >= 0xd800 && code <= 0xdfff);
      }) || (uuid &&
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
          .test(input))
    ) throw new Error('Invalid question scope');
    return input;
  };
  return Object.freeze({
    organizationId: identity(fields.organizationId.value),
    projectId: identity(fields.projectId.value, true),
    ownerId: identity(fields.ownerId.value, true),
    question: validateECOSQuestionText(fields.question.value),
  });
}

/** Internal, local-shadow question-to-evidence composition. The service adapter
 * must establish the caller's owner/project authority BEFORE calling this code.
 * This is not an HTTP handler, model implementation, customer answer or release
 * gate. Planner output is untrusted interpretation, never evidence or authority.
 *
 * It uses the actual inventory, resolver, record and table consumers rather than
 * accepting caller-provided evidence or manufactured ready flags. All steps,
 * including planning and final freshness reads, share one operation budget.
 * A failed/changed channel yields no successful partial context or fallback. */
export async function prepareECOSQuestionEvidence(
  request: ECOSQuestionEvidenceRequest,
  rpc: ECOSQuestionEvidenceRPC,
  planner: ECOSQuestionEvidencePlanner,
  options: {
    signal?: AbortSignal;
    budgetMs?: number;
    rpcTimeoutMs?: number;
    plannerTimeoutMs?: number;
    interpreter?: ECOSQuestionEvidenceInterpreter;
    interpreterTimeoutMs?: number;
    documentPageLimit?: number;
    recordPageLimit?: number;
    maxRpcCalls?: number;
  } = {},
) {
  const input = copyRequest(request);
  const scope = Object.freeze({
    organizationId: input.organizationId,
    projectId: input.projectId,
    ownerId: input.ownerId,
  });
  const budgetMs = options.budgetMs ?? 120_000;
  const rpcTimeoutMs = options.rpcTimeoutMs ?? 25_000;
  const plannerTimeoutMs = options.plannerTimeoutMs ?? 30_000;
  const interpreterTimeoutMs = options.interpreterTimeoutMs ?? 30_000;
  const interpreter = options.interpreter;
  const documentPageLimit = options.documentPageLimit ?? 25;
  const recordPageLimit = options.recordPageLimit ?? 16;
  const maxRpcCalls = options.maxRpcCalls ?? 128;
  const signal = options.signal;
  if (
    typeof rpc !== 'function' || typeof planner !== 'function' ||
    !Number.isSafeInteger(budgetMs) || budgetMs < 1 || budgetMs > 120_000 ||
    !Number.isSafeInteger(rpcTimeoutMs) || rpcTimeoutMs < 1 ||
    rpcTimeoutMs > 25_000 || !Number.isSafeInteger(plannerTimeoutMs) ||
    plannerTimeoutMs < 1 || plannerTimeoutMs > 30_000 ||
    !Number.isSafeInteger(interpreterTimeoutMs) || interpreterTimeoutMs < 1 ||
    interpreterTimeoutMs > 30_000 ||
    (interpreter !== undefined && typeof interpreter !== 'function') ||
    !Number.isSafeInteger(documentPageLimit) || documentPageLimit < 1 ||
    documentPageLimit > 25 || !Number.isSafeInteger(recordPageLimit) ||
    recordPageLimit < 1 || recordPageLimit > 16 ||
    !Number.isSafeInteger(maxRpcCalls) || maxRpcCalls < 1 ||
    maxRpcCalls > 128 ||
    (signal !== undefined && !(signal instanceof AbortSignal))
  ) throw new Error('Invalid question evidence bounds');
  const deadline = performance.now() + budgetMs;
  const encoder = new TextEncoder();
  const MAX_CONTEXT_BYTES = 16 * 1024 * 1024;
  let calls = 0;
  const remaining = () => {
    if (signal?.aborted) throw new Error('Question evidence cancelled');
    const value = Math.floor(deadline - performance.now());
    if (value < 1) throw new Error('Question evidence deadline exceeded');
    return value;
  };
  async function bounded<T>(
    maximumMs: number,
    run: (child: AbortSignal) => Promise<T>,
    parent?: AbortSignal,
  ): Promise<T> {
    const limit = Math.min(maximumMs, remaining());
    if (parent?.aborted) throw new Error('Question evidence cancelled');
    const child = new AbortController();
    const callDeadline = performance.now() + limit;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    const check = () => {
      remaining();
      if (
        parent?.aborted || child.signal.aborted ||
        performance.now() >= callDeadline
      ) {
        throw new Error('Question evidence request stopped');
      }
    };
    const stop = new Promise<never>((_resolve, reject) => {
      abort = () => {
        child.abort();
        reject(new Error('Question evidence request stopped'));
      };
      signal?.addEventListener('abort', abort, { once: true });
      parent?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(abort, limit);
    });
    try {
      const result = await Promise.race([
        Promise.resolve().then(async () => {
          check();
          const value = await run(child.signal);
          check();
          return value;
        }),
        stop,
      ]);
      check();
      return result;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (abort) {
        signal?.removeEventListener('abort', abort);
        parent?.removeEventListener('abort', abort);
      }
      child.abort();
    }
  }
  const transport: ECOSQuestionEvidenceRPC = (name, parameters, parent) => {
    remaining();
    if (parent.aborted || calls >= maxRpcCalls) {
      throw new Error('Question evidence request budget exhausted');
    }
    calls++;
    return bounded(
      rpcTimeoutMs,
      (child) => rpc(name, parameters, child),
      parent,
    );
  };
  const documents = (parent?: AbortSignal) =>
    bounded(
      remaining(),
      (child) =>
        loadECOSLinkedProjectDocumentInventory(scope, transport, {
          signal: child,
          budgetMs: remaining(),
          rpcTimeoutMs,
          pageLimit: documentPageLimit,
        }),
      parent,
    );
  const records = (parent?: AbortSignal) =>
    bounded(
      remaining(),
      (child) =>
        loadECOSProjectRecordInventory(scope, transport, {
          signal: child,
          budgetMs: remaining(),
          rpcTimeoutMs,
          pageLimit: recordPageLimit,
        }),
      parent,
    );
  const checkContextSize = (value: unknown) => {
    // Each upstream channel is already bounded. This measurement accounts for
    // duplicated representations in the combined wire context; it is not a
    // claim to reject before allocating the bounded upstream inputs.
    const bytes = encoder.encode(JSON.stringify(value)).length;
    remaining();
    if (bytes > MAX_CONTEXT_BYTES) {
      throw new Error('Combined question context exceeds retained byte budget');
    }
  };
  try {
    const interpretation = interpreter
      ? await bounded(
        interpreterTimeoutMs,
        async (child) =>
          bindECOSQuestionInterpretation(
            await interpreter(input.question, child),
            input.question,
          ),
      )
      : null;
    const searchQuery = interpretation?.search_query ?? input.question;
    // These full inventories describe bounded observed coverage, not a claim
    // that every project artifact has been extracted or understood.
    const documentResult = await documents();
    const documentInventory = documentResult.inventory;
    const resolve = (parent?: AbortSignal) =>
      bounded(
        remaining(),
        (child) =>
          loadECOSLinkedProjectDocumentIndexes(documentInventory, transport, {
            signal: child,
            budgetMs: remaining(),
            rpcTimeoutMs,
            pageLimit: documentPageLimit,
          }),
        parent,
      );
    const indexResult = await resolve();
    const recordResult = await records();
    checkContextSize({
      documents: documentInventory,
      indexes: indexResult.resolved,
      records: recordResult.inventory,
      observations: recordResult.observations,
    });
    const searchNativePages = (
      expectedSearchEpoch?: string,
      parent?: AbortSignal,
    ) =>
      bounded(remaining(), (child) =>
        loadECOSLinkedNativePageSearch(
          documentInventory,
          indexResult.resolved,
          searchQuery,
          transport,
          {
            signal: child,
            budgetMs: remaining(),
            rpcTimeoutMs,
            limit: 8,
            expectedSearchEpoch,
          },
        ), parent);
    // This is source discovery, not model interpretation or answer authority.
    // It uses precomputed lexical vectors, never an answer-time raw PDF scan.
    const nativePages = await searchNativePages();
    const operationalDiscovery = await bounded(
      remaining(),
      (child) =>
        discoverECOSOperationalRecordCandidates(
          recordResult.inventory,
          searchQuery,
          child,
        ),
    );
    const planningInput = createECOSQuestionPlanningInput(
      input.question,
      documentInventory,
      indexResult.resolved,
      recordResult.inventory,
      nativePages,
      interpretation,
      operationalDiscovery,
    );
    checkContextSize({
      documents: documentInventory,
      indexes: indexResult.resolved,
      records: recordResult.inventory,
      observations: recordResult.observations,
      planningInput,
    });
    const plan = await bounded(plannerTimeoutMs, async (child) => {
      const raw = await planner(planningInput, child);
      return bindECOSQuestionPlan(raw, planningInput);
    });
    remaining();
    const tables = plan.table_selections.length === 0
      ? null
      : await bounded(remaining(), (child) =>
        loadECOSLinkedTableRetrievalBundle(
          documentInventory,
          indexResult.resolved,
          plan.table_selections.map((selection) => ({
            sourceId: selection.source_id,
            pageNumbers: selection.page_numbers,
          })),
          transport,
          {
            signal: child,
            budgetMs: remaining(),
            rpcTimeoutMs,
            pageLimit: documentPageLimit,
          },
        ));
    const evidence = {
      question: input.question,
      planningInput,
      plan,
      documents: documentInventory,
      indexes: indexResult.resolved,
      records: recordResult.inventory,
      operational_discovery: operationalDiscovery,
      selected_operational_records: Object.freeze(
        operationalDiscovery.candidates
          .filter(({ row }) =>
            plan.operational_record_selections?.some((selected) =>
              selected.source_key === row.source_key &&
              selected.source_sha256 === row.source_sha256
            )
          )
          .map(({ row }) => row),
      ),
      tables,
      native_pages: nativePages,
      selected_native_pages: Object.freeze(
        plan.intent === 'clarification'
          ? []
          : nativePages.hits.filter((hit) =>
            plan.native_page_selections.some((selection) =>
              selection.source_id === hit.source_id &&
              selection.page_numbers.includes(hit.page_number)
            )
          ),
      ),
      operational_observations: plan.include_operational_records
        ? Object.freeze({
          ...recordResult.observations,
          observations: Object.freeze(
            recordResult.observations.observations.filter((observation) =>
              plan.operational_record_selections?.some((selected) =>
                selected.source_key === observation.source_key &&
                selected.source_sha256 === observation.source_sha256
              )
            ),
          ),
        })
        : null,
    };
    checkContextSize(evidence);
    // Recheck even when the planner selected no content or requested a
    // clarification. Replanning is required on drift; no stale cached plan is
    // silently applied to replacement records or newly appeared sources.
    const verifyFreshness = async (parent?: AbortSignal) => {
      const finalRecords = await records(parent);
      if (
        JSON.stringify(finalRecords.inventory) !==
          JSON.stringify(recordResult.inventory)
      ) {
        throw new Error(
          'Operational records changed during question preparation',
        );
      }
      const finalDocuments = await documents(parent);
      if (
        JSON.stringify(finalDocuments.inventory) !==
          JSON.stringify(documentInventory)
      ) {
        throw new Error(
          'Document inventory changed during question preparation',
        );
      }
      const finalIndexes = await resolve(parent);
      if (
        JSON.stringify(finalIndexes.resolved) !==
          JSON.stringify(indexResult.resolved)
      ) {
        throw new Error('Extraction changed during question preparation');
      }
      const finalNativePages = await searchNativePages(
        nativePages.search_epoch_sha256,
        parent,
      );
      if (JSON.stringify(finalNativePages) !== JSON.stringify(nativePages)) {
        throw new Error(
          'Native source search changed during question preparation',
        );
      }
      remaining();
    };
    await verifyFreshness();
    const result = freezeContext({
      schema_version: 'ecos-question-evidence/2.0' as const,
      publication_mode: 'shadow' as const,
      ...evidence,
      state: plan.intent === 'clarification'
        ? 'clarification_required' as const
        : 'evidence_prepared_requires_assurance' as const,
      answer_readiness: 'requires_source_assurance' as const,
      customer_answer: null,
      retrieval_authorized: false as const,
      semantic_discovery: 'not_implemented' as const,
      freshness: 'all_input_channels_rechecked_sequentially' as const,
      atomic_project_snapshot: false as const,
      rpc_calls: calls,
    });
    checkContextSize(result);
    preparedOrigins.add(result);
    revalidators.set(result, async (parent) => {
      if (parent !== undefined && !(parent instanceof AbortSignal)) {
        throw new Error('Invalid question revalidation signal');
      }
      try {
        await bounded(remaining(), (child) => verifyFreshness(child), parent);
        remaining();
        return Object.freeze({
          freshness: 'all_input_channels_rechecked_sequentially' as const,
          rpc_calls: calls,
        });
      } catch {
        throw new Error(
          'Question evidence changed or expired before answer delivery',
        );
      }
    });
    return result;
  } catch {
    // No provider diagnostic, credential, source prefix or fabricated answer.
    throw new Error(
      signal?.aborted
        ? 'Question evidence cancelled'
        : 'Question evidence unavailable, invalid or changed',
    );
  }
}
export type ECOSPreparedQuestionEvidence = Awaited<
  ReturnType<typeof prepareECOSQuestionEvidence>
>;
export function assertECOSPreparedQuestionEvidence(
  value: unknown,
): asserts value is ECOSPreparedQuestionEvidence {
  if (!value || typeof value !== 'object' || !preparedOrigins.has(value)) {
    throw new Error(
      'Question evidence must originate from the fully rechecked coordinator',
    );
  }
}
/** A returned context is not a timeless permission. Composition must recheck all
 * input channels immediately before delivery under the original shared budget. */
export async function revalidateECOSPreparedQuestionEvidence(
  value: ECOSPreparedQuestionEvidence,
  signal?: AbortSignal,
) {
  assertECOSPreparedQuestionEvidence(value);
  return await revalidators.get(value)!(signal);
}
