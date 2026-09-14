import {
  type ECOSLinkedOwnerProjectDocumentInventoryRPC,
  loadECOSLinkedOwnerProjectDocumentInventory,
} from "./ecos-linked-owner-project-document-inventory-loader.ts";
import { loadECOSLinkedOwnerProjectDocumentIndexes } from "./ecos-linked-owner-project-document-indexes-loader.ts";
import {
  type ECOSOwnerIndexedPageRPC,
  loadECOSOwnerIndexedPageObservations,
} from "./ecos-owner-indexed-page-observations-loader.ts";
import { buildECOSOwnerObservationBundle } from "./ecos-owner-observation-bundle.ts";
import { discoverECOSOwnerObservationCandidates } from "./ecos-owner-observation-discovery.ts";
import {
  type ECOSOwnerRasterDownload,
  loadECOSOwnerRasterImages,
  revalidateECOSOwnerRasterImages,
} from "./ecos-owner-raster-images.ts";
import {
  type ECOSOwnerPageSearchRPC,
  loadECOSOwnerPageSearch,
} from "./ecos-owner-page-search.ts";
import {
  assertECOSOwnerCombinedSourcePlan,
  assertECOSOwnerPagePlan,
  type ECOSOwnerCombinedSourcePlan,
  getECOSOwnerLanguageFailureCode,
  interpretECOSOwnerOperationalQuestion,
  interpretECOSOwnerQuestion,
  planECOSOwnerPages,
  planECOSOwnerSources,
} from "./ecos-owner-language-planner.ts";
import {
  assertECOSOwnerOperationalSourceAnswer,
  assertECOSOwnerSourceAnswer,
  composeECOSOwnerOperationalSourceAnswer,
  composeECOSOwnerSourceAnswer,
  type ECOSOwnerSourceAnswerInput,
} from "./ecos-v2-source-answer.ts";
import { copyECOSV2JSON, type ECOSV2JSONModel } from "./ecos-v2-json-model.ts";
import type { ECOSV2OwnerRasterReadRPC } from "./ecos-v2-preview-rpc-transport.ts";
import type { ECOSV2PreviewScope } from "./ecos-v2-preview-handler.ts";
import { validateECOSQuestionText } from "./ecos-question-plan.ts";
import {
  type ECOSProjectRecordInventoryRPC,
  loadECOSProjectRecordInventory,
} from "./ecos-project-record-inventory-loader.ts";
import { discoverECOSOperationalRecordCandidates } from "./ecos-operational-record-discovery.ts";
import {
  createECOSOwnerOperationalContext,
  type ECOSOwnerOperationalContext,
} from "./ecos-owner-operational-context.ts";

export interface ECOSOwnerQuestionDependencies {
  inventoryRPC: ECOSLinkedOwnerProjectDocumentInventoryRPC;
  pageRPC: ECOSOwnerIndexedPageRPC;
  searchRPC: ECOSOwnerPageSearchRPC;
  rasterRPC: ECOSV2OwnerRasterReadRPC;
  download: ECOSOwnerRasterDownload;
  /** The authenticated handler wraps this with durable pre-dispatch charges. */
  model: ECOSV2JSONModel;
}
export interface ECOSOwnerQuestionResult {
  readonly schema_version: "ecos-owner-question/2.1";
  readonly original_question: string;
  readonly organization_id: string;
  readonly owner_id: string;
  readonly project_id: string;
  readonly status: "answer" | "no_answer" | "clarification_required";
  readonly answer:
    | Awaited<ReturnType<typeof composeECOSOwnerSourceAnswer>>
    | null;
  readonly clarification_questions: readonly string[];
  readonly coverage: Readonly<{
    source_count: number;
    expected_page_count: number;
    inventory_epoch_sha256: string;
    index_epoch_sha256: string;
    search_epoch_sha256: string | null;
    source_search: unknown;
    omitted_matching_lanes: number;
    selected_pages: readonly { sourceId: string; pageNumber: number }[];
    requested_images: readonly { sourceId: string; pageNumber: number }[];
    operational_records: "not_supplied";
    photos: "not_assessed";
    project_updates: "not_supplied";
    whole_project_completeness: "not_verified";
  }>;
  readonly freshness:
    "complete_source_index_and_requested_rasters_rechecked_after_model";
  readonly preview_status: "provisional_limited_owner_document_preview";
  readonly publication_mode: "shadow";
  readonly retrieval_authorized: false;
  readonly actions_executed: false;
  readonly atomic_project_snapshot: false;
  readonly limitations: readonly string[];
}
const results = new WeakSet<object>();
const operationalResults = new WeakSet<object>();
export interface ECOSOwnerOperationalQuestionDependencies
  extends ECOSOwnerQuestionDependencies {
  recordRPC: ECOSProjectRecordInventoryRPC;
}
export type ECOSOwnerOperationalQuestionResult =
  & Omit<
    ECOSOwnerQuestionResult,
    "schema_version" | "answer" | "coverage" | "freshness" | "preview_status"
  >
  & {
    readonly schema_version: "ecos-owner-question/2.2";
    readonly answer:
      | Awaited<ReturnType<typeof composeECOSOwnerOperationalSourceAnswer>>
      | null;
    readonly coverage:
      & Omit<ECOSOwnerQuestionResult["coverage"], "operational_records">
      & {
        readonly operational_records: ECOSOwnerOperationalContext["coverage"];
      };
    readonly freshness:
      "complete_document_and_operational_sources_rechecked_after_model";
    readonly preview_status: "provisional_limited_owner_source_preview";
  };
const aborted = Object.getOwnPropertyDescriptor(
  AbortSignal.prototype,
  "aborted",
)!.get!;
const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const fail = (): never => {
  throw new Error(
    "Owner question unavailable, changed, cancelled or over bounds",
  );
};
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/** Owner-only document preview coordinator, never a legacy /2.0 adapter.
 * Auth/admission belong to the HTTP caller; source operations here are read-only.
 * Whole-corpus search is bounded lexical discovery driven by an unverified
 * semantic interpretation; it does not establish full semantic coverage.
 * Selected raw lanes and independently decoded images, not search text, reach
 * composition/review. Rechecks include unselected heads and absent raster heads.
 * No result is an atomic or continuing access grant. Task/progress/photo channels
 * remain explicitly unsupplied rather than being invented from documents.
 */
async function answerOwnerQuestion(
  suppliedScope: ECOSV2PreviewScope,
  suppliedQuestion: string,
  deps:
    | ECOSOwnerQuestionDependencies
    | ECOSOwnerOperationalQuestionDependencies,
  options: { signal: AbortSignal; budgetMs?: number },
  operationalMode: boolean,
): Promise<
  Readonly<ECOSOwnerQuestionResult | ECOSOwnerOperationalQuestionResult>
> {
  const controller = new AbortController();
  // Fixed internal phase only: never serialize questions, sources, credentials,
  // provider output or exception messages into operator diagnostics.
  let phase = "input";
  const started = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined,
    parent: AbortSignal | undefined,
    onAbort: (() => void) | undefined;
  try {
    const scope = copyECOSV2JSON(suppliedScope, 2048) as ECOSV2PreviewScope;
    if (
      !scope ||
      Object.keys(scope).sort().join(",") !==
        "organizationId,ownerId,projectId" ||
      !UUID.test(scope.ownerId) || !UUID.test(scope.projectId) ||
      scope.organizationId !== scope.ownerId
    ) return fail();
    const question = validateECOSQuestionText(suppliedQuestion);
    if (!options || Object.getPrototypeOf(options) !== Object.prototype) {
      return fail();
    }
    const ds = Object.getOwnPropertyDescriptors(options);
    if (
      Reflect.ownKeys(options).some((k) =>
        typeof k !== "string" || !["signal", "budgetMs"].includes(k)
      ) || Object.values(ds).some((d) =>
        !d.enumerable || !Object.hasOwn(d, "value")
      )
    ) return fail();
    parent = ds.signal?.value;
    const signal = parent!, budget = ds.budgetMs?.value ?? 120000;
    if (
      aborted.call(signal) || !Number.isSafeInteger(budget) || budget < 1 ||
      budget > 120000
    ) return fail();
    const ports = Object.getOwnPropertyDescriptors(deps);
    const names = [
      "inventoryRPC",
      "pageRPC",
      "searchRPC",
      "rasterRPC",
      "download",
      "model",
      ...(operationalMode ? ["recordRPC"] : []),
    ] as const;
    if (
      !deps || Object.getPrototypeOf(deps) !== Object.prototype ||
      Reflect.ownKeys(deps).length !== names.length || names.some((k) =>
        !ports[k]?.enumerable || !Object.hasOwn(ports[k], "value") ||
        typeof ports[k].value !== "function"
      )
    ) {
      return fail();
    }
    const safe = Object.fromEntries(
      names.map((k) => [k, ports[k].value]),
    ) as unknown as ECOSOwnerOperationalQuestionDependencies;
    const deadline = performance.now() + budget;
    const remaining = () => {
      const left = Math.floor(deadline - performance.now());
      if (aborted.call(signal) || controller.signal.aborted || left < 1) {
        return fail();
      }
      return left;
    };
    const stopped = new Promise<never>((_, reject) => {
      onAbort = () => {
        controller.abort();
        reject(new Error("Owner question stopped"));
      };
      EventTarget.prototype.addEventListener.call(signal, "abort", onAbort, {
        once: true,
      });
      timer = setTimeout(onAbort, budget);
    });
    const run = async () => {
      remaining();
      phase = "inventory";
      const { inventory } = await loadECOSLinkedOwnerProjectDocumentInventory(
        scope,
        safe.inventoryRPC,
        { signal: controller.signal, budgetMs: remaining() },
      );
      phase = "indexes";
      const { resolved: indexes } =
        await loadECOSLinkedOwnerProjectDocumentIndexes(
          inventory,
          safe.pageRPC,
          { signal: controller.signal, budgetMs: remaining() },
        );
      phase = "interpret";
      const interpretation = await (operationalMode
        ? interpretECOSOwnerOperationalQuestion
        : interpretECOSOwnerQuestion)(
          question,
          safe.model,
          { signal: controller.signal, budgetMs: Math.min(30000, remaining()) },
        );
      remaining();
      phase = "records";
      const records = operationalMode
        ? (await loadECOSProjectRecordInventory(scope, safe.recordRPC, {
          signal: controller.signal,
          budgetMs: remaining(),
        })).inventory
        : null;
      phase = "record_discovery";
      const recordDiscovery = records
        ? await discoverECOSOperationalRecordCandidates(
          records,
          interpretation.searchQuery || question,
          controller.signal,
        )
        : null;
      remaining();
      phase = "source_search";
      const search = interpretation.status === "clarification_required"
        ? null
        : await loadECOSOwnerPageSearch(
          inventory,
          indexes,
          interpretation.searchQuery,
          safe.searchRPC,
          { signal: controller.signal, budgetMs: remaining() },
        );
      phase = "plan";
      const plan = search === null
        ? null
        : records && recordDiscovery
        ? await planECOSOwnerSources(
          inventory,
          indexes,
          interpretation,
          search,
          records,
          recordDiscovery,
          safe.model,
          { signal: controller.signal, budgetMs: Math.min(30000, remaining()) },
        )
        : await planECOSOwnerPages(
          inventory,
          indexes,
          interpretation,
          search,
          safe.model,
          { signal: controller.signal, budgetMs: Math.min(30000, remaining()) },
        );
      if (plan && search) {
        if (records && recordDiscovery) {
          assertECOSOwnerCombinedSourcePlan(
            plan,
            inventory,
            indexes,
            interpretation,
            search,
            records,
            recordDiscovery,
          );
        } else {assertECOSOwnerPagePlan(
            plan,
            inventory,
            indexes,
            interpretation,
            search,
          );}
      }
      remaining();
      phase = "operational_context";
      const operational = records && recordDiscovery
        ? createECOSOwnerOperationalContext(
          records,
          recordDiscovery,
          recordDiscovery.query,
          (plan as ECOSOwnerCombinedSourcePlan | null)?.operationalSelections ??
            [],
        )
        : null;
      let answer:
        | ECOSOwnerQuestionResult["answer"]
        | ECOSOwnerOperationalQuestionResult["answer"] = null;
      let documents: ECOSOwnerSourceAnswerInput | null = null;
      let images: Awaited<ReturnType<typeof loadECOSOwnerRasterImages>> | null =
        null;
      if (plan?.status === "ready" && plan.selections.length) {
        phase = "page_observations";
        const selected = await loadECOSOwnerIndexedPageObservations(
          inventory,
          indexes,
          plan.selections,
          safe.pageRPC,
          { signal: controller.signal, budgetMs: remaining() },
        );
        phase = "observation_bundle";
        const bundle = await buildECOSOwnerObservationBundle(
          inventory,
          indexes,
          selected,
          { signal: controller.signal, budgetMs: Math.min(30000, remaining()) },
        );
        phase = "observation_discovery";
        const discovery = await discoverECOSOwnerObservationCandidates(
          inventory,
          indexes,
          selected,
          bundle,
          question,
          { signal: controller.signal, budgetMs: Math.min(30000, remaining()) },
        );
        if (plan.imageSelections.length) {
          phase = "raster_images";
          const pages = plan.imageSelections.map((s) => {
            const p = selected.pages.find((p) =>
              p.source_id === s.sourceId && p.page_number === s.pageNumber
            );
            if (!p) {
              return fail();
            }
            return p;
          });
          images = await loadECOSOwnerRasterImages(
            inventory,
            indexes,
            pages,
            safe.rasterRPC,
            safe.pageRPC,
            safe.download,
            { signal: controller.signal, budgetMs: remaining() },
          );
        }
        documents = {
          inventory,
          indexes,
          selected,
          bundle,
          discovery,
          images,
          counterevidence: search,
          question,
        };
      }
      if (
        plan?.status === "ready" &&
        (documents || operational?.coverage.selected_record_count)
      ) {
        phase = "compose_and_verify";
        answer = operational
          ? await composeECOSOwnerOperationalSourceAnswer(
            {
              inventory,
              indexes,
              documents,
              counterevidence: search,
              question,
              operational,
            },
            safe.model,
            {
              signal: controller.signal,
              budgetMs: Math.min(90000, remaining()),
              modelTimeoutMs: 30000,
            },
          )
          : await composeECOSOwnerSourceAnswer(
            documents!,
            safe.model,
            {
              signal: controller.signal,
              budgetMs: Math.min(90000, remaining()),
              modelTimeoutMs: 30000,
            },
          );
        remaining();
        if (operational) {
          assertECOSOwnerOperationalSourceAnswer(answer);
        } else assertECOSOwnerSourceAnswer(answer);
      }
      if (records) {
        phase = "records_recheck";
        const finalRecords = await loadECOSProjectRecordInventory(
          scope,
          safe.recordRPC,
          { signal: controller.signal, budgetMs: remaining() },
        );
        if (
          JSON.stringify(finalRecords.inventory) !== JSON.stringify(records)
        ) {
          return fail();
        }
      }
      // Search material can change without a page-head change. Recheck that
      // whole-corpus epoch too; no background backfill/retry is authorized here.
      if (search) {
        phase = "search_recheck";
        await loadECOSOwnerPageSearch(
          inventory,
          indexes,
          search.query,
          safe.searchRPC,
          {
            signal: controller.signal,
            budgetMs: remaining(),
            expectedSearchEpoch: search.search_epoch_sha256,
          },
        );
      }
      if (images) {
        phase = "raster_recheck";
        await revalidateECOSOwnerRasterImages(
          images,
          inventory,
          indexes,
          safe.rasterRPC,
          safe.pageRPC,
          { signal: controller.signal, budgetMs: remaining() },
        );
      } else {
        phase = "indexes_recheck";
        const final = await loadECOSLinkedOwnerProjectDocumentIndexes(
          inventory,
          safe.pageRPC,
          {
            signal: controller.signal,
            budgetMs: remaining(),
            expectedIndexEpoch: indexes.index_epoch_sha256,
          },
        );
        if (JSON.stringify(final.resolved) !== JSON.stringify(indexes)) {
          return fail();
        }
      }
      remaining();
      phase = "result";
      const clarification =
        interpretation.status === "clarification_required" ||
        plan?.status === "clarification_required" ||
        answer?.status === "clarification_required";
      const result = {
        schema_version: operationalMode
          ? "ecos-owner-question/2.2" as const
          : "ecos-owner-question/2.1" as const,
        original_question: question,
        organization_id: scope.organizationId,
        owner_id: scope.ownerId,
        project_id: scope.projectId,
        status: answer?.status === "answer"
          ? "answer"
          : clarification
          ? "clarification_required"
          : "no_answer",
        answer,
        clarification_questions: clarification
          ? [
            "Which document, location, or condition should ECOS use to resolve your question?",
          ]
          : [],
        coverage: {
          source_count: indexes.total_source_count,
          expected_page_count: indexes.total_expected_page_count,
          inventory_epoch_sha256: inventory.epoch_sha256,
          index_epoch_sha256: indexes.index_epoch_sha256,
          search_epoch_sha256: search?.search_epoch_sha256 ?? null,
          source_search: search?.coverage ?? null,
          omitted_matching_lanes: search?.omitted_matching_lane_count ?? 0,
          selected_pages: plan?.selections ?? [],
          requested_images: plan?.imageSelections ?? [],
          operational_records: operational?.coverage ?? "not_supplied" as const,
          photos: "not_assessed" as const,
          project_updates: "not_supplied" as const,
          whole_project_completeness: "not_verified" as const,
        },
        freshness: operationalMode
          ? "complete_document_and_operational_sources_rechecked_after_model" as const
          : "complete_source_index_and_requested_rasters_rechecked_after_model" as const,
        preview_status: operationalMode
          ? "provisional_limited_owner_source_preview" as const
          : "provisional_limited_owner_document_preview" as const,
        publication_mode: "shadow" as const,
        retrieval_authorized: false as const,
        actions_executed: false as const,
        atomic_project_snapshot: false as const,
        limitations: operationalMode
          ? [
            "bounded_owner_documents_and_recorded_values_not_whole_project_assurance",
            "semantic_interpretation_selection_and_review_are_fallible",
            "search_omissions_are_not_evidence_of_absence",
            "recorded_progress_not_site_verification_or_aggregate_completion",
            "project_updates_photos_and_local_unsynced_records_not_supplied",
            "sequential_source_rechecks_not_atomic_or_continuing_access",
          ]
          : [
            "owner_document_preview_not_complete_app_beta",
            "semantic_interpretation_selection_and_review_are_fallible",
            "search_omissions_are_not_evidence_of_absence",
            "directly_printed_document_facts_only_no_geometry_arithmetic",
            "operational_records_project_updates_and_photos_not_supplied",
            "sequential_source_rechecks_not_atomic_or_continuing_access",
          ],
      };
      if (
        new TextEncoder().encode(JSON.stringify(result)).length > 256 * 1024
      ) {
        return fail();
      }
      const frozen = freeze(result);
      (operationalMode ? operationalResults : results).add(frozen);
      return frozen as Readonly<
        ECOSOwnerQuestionResult | ECOSOwnerOperationalQuestionResult
      >;
    };
    return await Promise.race([run(), stopped]);
  } catch (error) {
    console.warn(JSON.stringify({
      event: "ecos_owner_question_failed",
      phase,
      languageFailureCode: getECOSOwnerLanguageFailureCode(error),
      elapsedMs: Math.round(performance.now() - started),
    }));
    return fail();
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (parent && onAbort) {
      EventTarget.prototype.removeEventListener.call(parent, "abort", onAbort);
    }
    controller.abort();
  }
}
export async function answerECOSOwnerQuestion(
  scope: ECOSV2PreviewScope,
  question: string,
  deps: ECOSOwnerQuestionDependencies,
  options: { signal: AbortSignal; budgetMs?: number },
): Promise<Readonly<ECOSOwnerQuestionResult>> {
  return await answerOwnerQuestion(
    scope,
    question,
    deps,
    options,
    false,
  ) as ECOSOwnerQuestionResult;
}
export async function answerECOSOwnerOperationalQuestion(
  scope: ECOSV2PreviewScope,
  question: string,
  deps: ECOSOwnerOperationalQuestionDependencies,
  options: { signal: AbortSignal; budgetMs?: number },
): Promise<Readonly<ECOSOwnerOperationalQuestionResult>> {
  return await answerOwnerQuestion(
    scope,
    question,
    deps,
    options,
    true,
  ) as ECOSOwnerOperationalQuestionResult;
}
export function assertECOSOwnerOperationalQuestionResult(
  value: unknown,
): asserts value is Readonly<ECOSOwnerOperationalQuestionResult> {
  if (!value || typeof value !== "object" || !operationalResults.has(value)) {
    return fail();
  }
}
export function assertECOSOwnerQuestionResult(
  value: unknown,
): asserts value is Readonly<ECOSOwnerQuestionResult> {
  if (!value || typeof value !== "object" || !results.has(value)) return fail();
}
