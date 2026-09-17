import { type ECOSAgentTool } from "./ecos-read-only-agent.ts";
import { rankECOSDescriptiveResearchSources } from "./ecos-research-ranking.ts";
import { hasCompleteECOSDocumentProofClaim, type ECOSDocumentProofReadiness } from "./ecos-answer-proof-authority.ts";
import { ecosEvidenceIdentityCompatible } from "./ecos-evidence-identity.ts";
import { ecosEvidenceQuestionContextScore } from "./ecos-project-answer-policy.ts";
import {
  canonicalizeECOSQuestionLanguage,
  ecosExpandedQuestionTokens,
} from "./ecos-question-language.ts";

export const ECOS_MAX_FRESH_DOCUMENT_SEARCHES = 4;

export type ECOSAgentProjectSource = Readonly<{
  id: string;
  sourceType: "project" | "schedule" | "update" | "memory" | "document";
  title: string;
  excerpt: string;
  updatedAt: string | null;
  score: number;
  documentCitation?: Readonly<Record<string, unknown>>;
  documentRegion?: Readonly<Record<string, unknown>>;
  documentProvenance?: Readonly<Record<string, unknown>>;
  documentLimitations?: readonly string[];
  scheduleData?: Readonly<{
    taskName: string;
    itemType: string | null;
    locationName: string | null;
    status: string | null;
    percentComplete: number | null;
    startDate: string | null;
    finishDate: string | null;
    baselineStartDate: string | null;
    baselineFinishDate: string | null;
    wbsCode: string | null;
    durationDays: number | null;
    dependencies: readonly string[];
    isMilestone: boolean;
    isSummary: boolean;
  }>;
  progressData?: Readonly<{
    recordKind: "update" | "memory";
    taskName: string | null;
    locationName: string | null;
    status: string | null;
    occurredAt: string | null;
    notes: string | null;
    observation: string | null;
    actionKind: string | null;
    actionText: string | null;
    photoCount: number;
    photoSummaries: readonly string[];
  }>;
}>;

export type ECOSAgentProjectToolRegistry<
  TSource extends ECOSAgentProjectSource = ECOSAgentProjectSource,
> = Readonly<{
  tools: readonly ECOSAgentTool[];
  researchSources: () => readonly TSource[];
  rejectedProofSourceIds: () => readonly string[];
  verifiedProofSourceIds: () => readonly string[];
}>;

export function createECOSAgentProjectToolRegistry<
  TSource extends ECOSAgentProjectSource,
>(
  input: Readonly<{
    candidates: readonly TSource[];
    inventory: Readonly<{
      sourceCounts: Readonly<Record<string, number>>;
      unavailableChannels: readonly string[];
      limitations: readonly string[];
      candidateCount: number;
    }>;
    snapshotCapturedAt: string;
    inspectDocumentProof?: (source: TSource, signal: AbortSignal) => Promise<ECOSDocumentProofReadiness>;
    readCurrentDrawingPage?: (source: TSource, pageNumber: number, question: string,
      signal: AbortSignal) => Promise<readonly TSource[]>;
    inspectCurrentDrawingImage?: (source: TSource, question: string, signal: AbortSignal) =>
      Promise<Awaited<ReturnType<ReturnType<typeof import("./ecos-drawing-visual-reader.ts").createECOSDrawingVisualReader>>>>;
    searchCurrentDocuments: (
      query: string,
      signal: AbortSignal,
    ) => Promise<
      Readonly<{
        sources: readonly TSource[];
        semanticAvailable: boolean;
        matchedPageCount: number;
      }>
    >;
  }>,
): ECOSAgentProjectToolRegistry<TSource> {
  const candidatesById = new Map(
    input.candidates.map((source) => [source.id, source]),
  );
  const researchSourcesById = new Map<string, TSource>();
  const rejectedProofIds = new Set<string>();
  const verifiedProofIds = new Set<string>();
  let snapshotSearchCalls = 0;
  let documentSearchCalls = 0;
  const rememberSources = (sources: readonly TSource[]) => {
    sources.forEach((source) => {
      researchSourcesById.set(source.id, source);
      candidatesById.set(source.id, source);
    });
    return sources;
  };
  const describeSources = async (sources: readonly TSource[], signal: AbortSignal) => {
    const results: ReturnType<typeof agentEvidenceSource>[] = [];
    // Sequential by design: at most twelve distinct authenticated checks per
    // question, with no unbounded RPC fan-out from model-selected source ids.
    for (const source of sources) {
      signal.throwIfAborted();
      const readiness = source.sourceType === "document" && input.inspectDocumentProof
        ? await input.inspectDocumentProof(source, signal) : "not_checked";
      if (readiness === "available") verifiedProofIds.add(source.id);
      if (readiness === "rejected") {
        rejectedProofIds.add(source.id);
        researchSourcesById.delete(source.id);
      }
      results.push(agentEvidenceSource(source, readiness));
    }
    return results;
  };

  const inventoryTool: ECOSAgentTool = Object.freeze({
    name: "inspect_project_evidence_inventory",
    description:
      "Inspect counts, availability, and limitations for the authorized current-project evidence snapshot. This returns metadata, not factual evidence.",
    progressStage: "reading",
    providesEvidence: false,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: [],
      properties: {},
    },
    execute: () => ({
      sourceCounts: input.inventory.sourceCounts,
      unavailableChannels: input.inventory.unavailableChannels,
      limitations: input.inventory.limitations,
      candidateCount: input.inventory.candidateCount,
    }),
  });

  const snapshotSearchTool: ECOSAgentTool = Object.freeze({
    name: "search_project_evidence",
    description:
      "Search the authorized stable evidence snapshot using new wording. Use this at most twice, and only use the second query when the first result is incomplete. Results contain exact evidence ids that may be cited.",
    progressStage: "searching",
    providesEvidence: true,
    qualifiesAsEvidence: (value) =>
      isRecord(value) && Array.isArray(value.matches) &&
      value.matches.some(isUsableResearchMatch),
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["query", "sourceTypes", "limit"],
      properties: {
        query: { type: "string", minLength: 2, maxLength: 500 },
        sourceTypes: {
          type: ["array", "null"],
          maxItems: 5,
          items: {
            type: "string",
            enum: ["project", "schedule", "update", "memory", "document"],
          },
        },
        limit: { type: ["integer", "null"], minimum: 1, maximum: 12 },
      },
    },
    execute: async (toolInput, context) => {
      const query = clean(toolInput.query, 500);
      if (query.length < 2) return { matches: [], error: "query_required" };
      snapshotSearchCalls += 1;
      if (snapshotSearchCalls > 2) {
        return { matches: [], error: "snapshot_search_budget_reached" };
      }
      const requestedTypes = Array.isArray(toolInput.sourceTypes)
        ? new Set(
          toolInput.sourceTypes.filter((value): value is string =>
            typeof value === "string"
          ),
        )
        : null;
      const limit = boundedInteger(toolInput.limit, 1, 12, 8);
      const queryTokens = ecosExpandedQuestionTokens(query);
      const rankedMatches = input.candidates.flatMap((source) => {
        if (requestedTypes && !requestedTypes.has(source.sourceType)) return [];
        if (
          !ecosEvidenceIdentityCompatible(query, source.title, source.excerpt)
        ) return [];
        const haystack = `${source.title} ${source.excerpt}`;
        const contextScore = ecosEvidenceQuestionContextScore(query, haystack);
        const coverage = tokenCoverage(queryTokens, haystack);
        if (contextScore <= 0 && coverage <= 0) return [];
        const score = contextScore * 4 + coverage * 3 + source.score * 0.1;
        return [{ source, score, contextScore, coverage }];
      }).sort((left, right) =>
        right.score - left.score ||
        compareDates(right.source.updatedAt, left.source.updatedAt)
      );
      const rankedSources = rankECOSDescriptiveResearchSources(query, rankedMatches.map(({ source }) => source), limit);
      rememberSources(rankedSources);
      return {
        query,
        matches: await describeSources(rankedSources, context.signal),
      };
    },
  });

  const scheduleListTool: ECOSAgentTool = Object.freeze({
    name: "list_project_schedule_activities",
    description:
      "Filter and sort the complete authorized schedule snapshot by task wording, location, status, and scheduled start date. Use this for exact activities, complete status lists, upcoming work, and dependency checks instead of relying on relevance-ranked text search. Every match is returned up to a fixed 25-row safety cap; truncated is true when more rows exist.",
    progressStage: "searching",
    providesEvidence: true,
    qualifiesAsEvidence: (value) =>
      isRecord(value) && Array.isArray(value.matches) &&
      value.matches.length > 0,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: [
        "taskQuery",
        "locationQuery",
        "statuses",
        "startOnOrAfter",
        "startOnOrBefore",
        "sortBy",
        "limit",
      ],
      properties: {
        taskQuery: { type: ["string", "null"], maxLength: 200 },
        locationQuery: { type: ["string", "null"], maxLength: 200 },
        statuses: {
          type: ["array", "null"],
          maxItems: 6,
          items: { type: "string", minLength: 1, maxLength: 80 },
        },
        startOnOrAfter: {
          type: ["string", "null"],
          pattern: "^\\d{4}-\\d{2}-\\d{2}$",
        },
        startOnOrBefore: {
          type: ["string", "null"],
          pattern: "^\\d{4}-\\d{2}-\\d{2}$",
        },
        sortBy: {
          type: "string",
          enum: [
            "start_ascending",
            "start_descending",
            "updated_descending",
            "task_name_ascending",
          ],
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 25,
          description:
            "Compatibility hint only. It cannot reduce a complete matching set below the fixed 25-row safety cap.",
        },
      },
    },
    execute: (toolInput) => {
      const taskQuery = normalize(clean(toolInput.taskQuery, 200));
      const locationQuery = normalize(clean(toolInput.locationQuery, 200));
      const normalizedStatuses = Array.isArray(toolInput.statuses)
        ? toolInput.statuses.map((value) => normalize(clean(value, 80)))
          .filter(Boolean)
        : [];
      const statuses = normalizedStatuses.length > 0
        ? new Set(normalizedStatuses)
        : null;
      const rawStartOnOrAfter = clean(toolInput.startOnOrAfter, 40);
      const rawStartOnOrBefore = clean(toolInput.startOnOrBefore, 40);
      const startOnOrAfter = strictScheduleFilterDate(rawStartOnOrAfter);
      const startOnOrBefore = strictScheduleFilterDate(rawStartOnOrBefore);
      if (
        (rawStartOnOrAfter && !startOnOrAfter) ||
        (rawStartOnOrBefore && !startOnOrBefore)
      ) return { matches: [], error: "invalid_schedule_date" };
      const sortBy = clean(toolInput.sortBy, 80) || "updated_descending";
      if (!SCHEDULE_SORTS.has(sortBy)) {
        return { matches: [], error: "invalid_schedule_sort" };
      }
      const requestedLimit = boundedInteger(toolInput.limit, 1, 25, 20);
      const matching = input.candidates.filter((source) => {
        if (source.sourceType !== "schedule" || !source.scheduleData) {
          return false;
        }
        const schedule = source.scheduleData;
        if (
          taskQuery &&
          !normalize(`${schedule.taskName} ${source.title}`).includes(taskQuery)
        ) return false;
        if (
          locationQuery &&
          !normalize(schedule.locationName || "").includes(locationQuery)
        ) return false;
        if (statuses && !statuses.has(normalize(schedule.status || ""))) {
          return false;
        }
        const startDate = scheduleDateKey(schedule.startDate);
        if (startOnOrAfter && (!startDate || startDate < startOnOrAfter)) {
          return false;
        }
        if (startOnOrBefore && (!startDate || startDate > startOnOrBefore)) {
          return false;
        }
        return true;
      }).sort((left, right) => compareScheduleSources(left, right, sortBy));
      // Schedule-list questions must not become incomplete because a model
      // selected an unnecessarily small result limit. Return the complete
      // matching set whenever it fits inside the fixed 25-row safety cap.
      const appliedLimit = Math.min(25, matching.length);
      const matches = rememberSources(matching.slice(0, appliedLimit));
      return {
        snapshotCapturedAt: input.snapshotCapturedAt,
        matchingCount: matching.length,
        returnedCount: matches.length,
        truncated: matching.length > 25,
        filters: {
          taskQuery: taskQuery || null,
          locationQuery: locationQuery || null,
          statuses: statuses ? [...statuses].sort() : null,
          startOnOrAfter,
          startOnOrBefore,
          sortBy,
          requestedLimit,
          appliedLimit,
        },
        matches: matches.map(source => agentEvidenceSource(source)),
      };
    },
  });

  const documentSearchTool: ECOSAgentTool = Object.freeze({
    name: "search_current_project_documents",
    description:
      `Run a fresh authorized semantic, lexical, metadata, and exact-page search across all current project documents. Up to ${ECOS_MAX_FRESH_DOCUMENT_SEARCHES} searches are available: target a missing requested detail or unresolved conflict on each follow-up, rather than repeating the same broad query. Use it when snapshot results are incomplete for any requested subject or lack openable proof. One matching source does not prove complete coverage. Results contain exact evidence ids and proof readiness.`,
    progressStage: "searching",
    providesEvidence: true,
    qualifiesAsEvidence: (value) =>
      isRecord(value) && Array.isArray(value.matches) &&
      value.matches.some(isUsableResearchMatch),
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["query", "limit"],
      properties: {
        query: { type: "string", minLength: 2, maxLength: 500 },
        limit: { type: "integer", minimum: 1, maximum: 12 },
      },
    },
    execute: async (toolInput, context) => {
      const query = clean(toolInput.query, 500);
      if (query.length < 2) return { matches: [], error: "query_required" };
      documentSearchCalls += 1;
      if (documentSearchCalls > ECOS_MAX_FRESH_DOCUMENT_SEARCHES) {
        return { matches: [], error: "document_search_budget_reached" };
      }
      if (context.signal.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      const normalizedQuery = canonicalizeECOSQuestionLanguage(query);
      const search = await input.searchCurrentDocuments(
        normalizedQuery,
        context.signal,
      );
      const limit = boundedInteger(toolInput.limit, 1, 12, 8);
      const matches = rememberSources(rankECOSDescriptiveResearchSources(normalizedQuery, search.sources, limit));
      return {
        query,
        semanticAvailable: search.semanticAvailable,
        matchedPageCount: search.matchedPageCount,
        matches: await describeSources(matches, context.signal),
      };
    },
  });

  const progressListTool: ECOSAgentTool = Object.freeze({
    name: "list_project_progress_records",
    description:
      "Filter and sort the complete authorized field-update and field-note snapshot by task wording, location, open/resolved status, record kind, and whether photos are attached. Use this for latest task updates, photo-backed work, open field issues, and completion-versus-acceptance research instead of relying on relevance-ranked text search. Every match is returned up to a fixed 25-row safety cap; truncated is true when more rows exist.",
    progressStage: "searching",
    providesEvidence: true,
    qualifiesAsEvidence: (value) =>
      isRecord(value) && Array.isArray(value.matches) &&
      value.matches.length > 0,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: [
        "taskQuery",
        "locationQuery",
        "recordKinds",
        "statuses",
        "photosOnly",
        "sortBy",
        "limit",
      ],
      properties: {
        taskQuery: { type: ["string", "null"], maxLength: 200 },
        locationQuery: { type: ["string", "null"], maxLength: 200 },
        recordKinds: {
          type: ["array", "null"],
          maxItems: 2,
          items: { type: "string", enum: ["update", "memory"] },
        },
        statuses: {
          type: ["array", "null"],
          maxItems: 6,
          items: { type: "string", minLength: 1, maxLength: 80 },
        },
        photosOnly: { type: "boolean" },
        sortBy: {
          type: "string",
          enum: [
            "occurred_descending",
            "occurred_ascending",
            "task_name_ascending",
          ],
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 25,
          description:
            "Compatibility hint only. It cannot reduce a complete matching set below the fixed 25-row safety cap.",
        },
      },
    },
    execute: (toolInput) => {
      const taskQuery = normalize(clean(toolInput.taskQuery, 200));
      const locationQuery = normalize(clean(toolInput.locationQuery, 200));
      const recordKinds = Array.isArray(toolInput.recordKinds) &&
          toolInput.recordKinds.length > 0
        ? new Set(
          toolInput.recordKinds.filter((value): value is string =>
            value === "update" || value === "memory"
          ),
        )
        : null;
      const normalizedStatuses = Array.isArray(toolInput.statuses)
        ? toolInput.statuses.map((value) => normalize(clean(value, 80)))
          .filter(Boolean)
        : [];
      const statuses = normalizedStatuses.length > 0
        ? new Set(normalizedStatuses)
        : null;
      const photosOnly = toolInput.photosOnly === true;
      const sortBy = clean(toolInput.sortBy, 80) || "occurred_descending";
      if (!PROGRESS_SORTS.has(sortBy)) {
        return { matches: [], error: "invalid_progress_sort" };
      }
      const requestedLimit = boundedInteger(toolInput.limit, 1, 25, 20);
      const matching = input.candidates.filter((source) => {
        const progress = source.progressData;
        if (!progress) return false;
        if (recordKinds && !recordKinds.has(progress.recordKind)) return false;
        if (
          taskQuery &&
          !normalize(
            `${progress.taskName || ""} ${source.title} ${
              progress.notes || ""
            } ${progress.observation || ""}`,
          ).includes(taskQuery)
        ) return false;
        if (
          locationQuery &&
          !progressLocationMatches(locationQuery, progress.locationName || "")
        ) return false;
        if (statuses && !statuses.has(normalize(progress.status || ""))) {
          return false;
        }
        if (photosOnly && progress.photoCount <= 0) return false;
        return true;
      }).sort((left, right) => compareProgressSources(left, right, sortBy));
      const appliedLimit = Math.min(25, matching.length);
      const matches = rememberSources(matching.slice(0, appliedLimit));
      return {
        snapshotCapturedAt: input.snapshotCapturedAt,
        matchingCount: matching.length,
        returnedCount: matches.length,
        truncated: matching.length > 25,
        filters: {
          taskQuery: taskQuery || null,
          locationQuery: locationQuery || null,
          recordKinds: recordKinds ? [...recordKinds].sort() : null,
          statuses: statuses ? [...statuses].sort() : null,
          photosOnly,
          sortBy,
          requestedLimit,
          appliedLimit,
        },
        matches: matches.map(source => agentEvidenceSource(source)),
      };
    },
  });

  const openTool: ECOSAgentTool = Object.freeze({
    name: "open_project_evidence",
    description:
      "Open exact authorized evidence records returned by a project evidence search. Use this before relying on a source or comparing records.",
    progressStage: "reading",
    providesEvidence: true,
    qualifiesAsEvidence: (value) =>
      isRecord(value) && Number(value.openedSourceCount) > 0,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["sourceIds"],
      properties: {
        sourceIds: {
          type: "array",
          minItems: 1,
          maxItems: 8,
          items: { type: "string" },
        },
      },
    },
    execute: async (toolInput, context) => {
      const sourceIds = Array.isArray(toolInput.sourceIds)
        ? unique(
          toolInput.sourceIds.map((value) => clean(value, 500)).filter(Boolean),
        ).slice(0, 8)
        : [];
      const openedSources = sourceIds.flatMap((sourceId) => {
        const source = candidatesById.get(sourceId);
        return source ? [source] : [];
      });
      if (openedSources.length === 0) {
        throw new Error("evidence_source_not_found");
      }
      rememberSources(openedSources);
      const sources = await describeSources(openedSources, context.signal);
      return {
        requestedSourceCount: sourceIds.length,
        openedSourceCount: sources.filter(isUsableResearchMatch).length,
        missingSourceIds: sourceIds.filter((sourceId) =>
          !candidatesById.has(sourceId)
        ),
        sources,
      };
    },
  });

  const drawingPageTool: ECOSAgentTool = Object.freeze({
    name: "read_project_drawing_page",
    description: input.inspectCurrentDrawingImage
      ? "Read an exact PDF page of an already researched current drawing, including its original image when an exact authorized reference is available. Use a returned sourceId and one-based PDF page number (not a sheet label). Image observations need separate claim review. Prepared text and image inspection each use one existing fresh-document read."
      : "Read prepared text from an exact PDF page of an already researched current drawing. Use a returned sourceId and a one-based PDF page number (not a sheet label). This reads the stored page index, not the original image. Use for missing details on a known page or a referenced PDF page. It shares the fresh-document research budget.",
    progressStage: "reading",
    providesEvidence: true,
    qualifiesAsEvidence: value => isRecord(value) && Array.isArray(value.sources) && value.sources.some(isUsableResearchMatch),
    inputSchema: { type: "object", additionalProperties: false,
      required: ["sourceId", "pageNumber", "question"],
      properties: { sourceId: {type: "string"}, pageNumber: {type: "integer", minimum: 1},
        question: {type: "string", minLength: 2, maxLength: 500} } },
    execute: async (args, context) => {
      context.signal.throwIfAborted();
      const source = researchSourcesById.get(clean(args.sourceId, 500));
      const page = args.pageNumber;
      const question = clean(args.question, 500);
      if (!source || source.sourceType !== "document" || rejectedProofIds.has(source.id)) {
        return { sources: [], error: "researched_drawing_required" };
      }
      if (typeof page !== "number" || !Number.isSafeInteger(page) || page < 1 || question.length < 2) {
        return { sources: [], error: "exact_pdf_page_and_question_required" };
      }
      if (!input.readCurrentDrawingPage) return { sources: [], error: "drawing_page_reader_unavailable" };
      documentSearchCalls += 1;
      if (documentSearchCalls > ECOS_MAX_FRESH_DOCUMENT_SEARCHES) return { sources: [], error: "document_search_budget_reached" };
      const loaded = await input.readCurrentDrawingPage(source, page, question, context.signal);
      context.signal.throwIfAborted();
      // Defense in depth against a callback accidentally returning a different
      // document/revision/project. New page regions still need exact proof checks.
      const identity = source.documentCitation;
      const exact = loaded.filter(candidate => candidate.sourceType === "document" &&
        candidate.documentCitation?.pageNumber === page && identity &&
        ["projectId", "documentId", "sourceSha256", "evidenceVersion", "revision"].every(key =>
          identity[key] != null && candidate.documentCitation?.[key] === identity[key]));
      rememberSources(exact);
      const described = await describeSources(exact, context.signal);
      // In the opt-in image runtime, opening a known drawing page must not
      // silently stop at OCR. Use an exact returned source, never the original
      // source's old page or a page inferred from a sheet label.
      const imageSource = exact.find(candidate => researchSourcesById.has(candidate.id) &&
        !rejectedProofIds.has(candidate.id) && hasCompleteECOSDocumentProofClaim(candidate));
      const visualResearch = input.inspectCurrentDrawingImage && imageSource
        ? await drawingImageTool.execute({sourceId:imageSource.id,question},context)
        : null;
      return { mode: visualResearch ? "prepared_text_and_visual_research" : "prepared_text_only", pageNumber: page,
        sources: described, ...(visualResearch ? {visualResearch} : {}),
        limitation: "This is bounded prepared page text, not a full visual reading. Empty results do not establish that a detail is absent from the drawing." };
    },
  });

  const drawingImageTool: ECOSAgentTool = Object.freeze({
    name: "inspect_project_drawing_image",
    description: "Inspect original pixels of an already researched exact current drawing page. Returns unverified observations only, not answer evidence. A missing or unreadable detail is not proof of absence from the page or document.",
    progressStage: "reading",
    providesEvidence: false,
    qualifiesAsEvidence: () => false,
    inputSchema: {type:"object",additionalProperties:false,required:["sourceId","question"],
      properties:{sourceId:{type:"string"},question:{type:"string",minLength:2,maxLength:500}}},
    execute: async (args, context) => {
      context.signal.throwIfAborted();
      let source = researchSourcesById.get(clean(args.sourceId,500));
      const question = clean(args.question,500);
      if (!source || source.sourceType !== "document" || rejectedProofIds.has(source.id)) {
        return {error:"researched_drawing_required",answerEvidenceEligible:false};
      }
      if (question.length < 2 || !input.inspectCurrentDrawingImage) {
        return {error:"drawing_image_reader_unavailable",answerEvidenceEligible:false};
      }
      if (!hasCompleteECOSDocumentProofClaim(source)) {
        const original = source;
        const identity = original.documentCitation;
        const page = identity?.pageNumber;
        const exactReference = (candidate: TSource) =>
          candidate.id !== original.id && candidate.sourceType === "document" &&
          !rejectedProofIds.has(candidate.id) &&
          hasCompleteECOSDocumentProofClaim(candidate) && identity &&
          ["projectId", "documentId", "sourceSha256", "evidenceVersion", "revision", "pageNumber"].every(key =>
            identity[key] != null && candidate.documentCitation?.[key] === identity[key]);
        // Reuse an exact reference already in the authorized snapshot before
        // doing another read. Never attach its region to the original excerpt.
        let recovered = [...candidatesById.values()].find(exactReference);
        if (!recovered && input.readCurrentDrawingPage && typeof page === "number" &&
          Number.isSafeInteger(page) && page > 0 && identity &&
          ["projectId", "documentId", "sourceSha256", "evidenceVersion", "revision"].every(key => identity[key] != null)) {
          // Recovery plus inspection needs two of the existing four reads.
          // Reserve capacity before starting; no model-driven retry loop.
          if (documentSearchCalls + 2 > ECOS_MAX_FRESH_DOCUMENT_SEARCHES) {
            return {error:"document_search_budget_reached",answerEvidenceEligible:false};
          }
          documentSearchCalls++;
          const loaded = await input.readCurrentDrawingPage(original,page,question,context.signal);
          context.signal.throwIfAborted();
          recovered = loaded.find(exactReference);
        }
        if (recovered) source = recovered;
        else
        return {error:"exact_drawing_reference_required",answerEvidenceEligible:false,
          instruction:"Read prepared evidence for this exact document/page to obtain a source with a current region reference, then inspect that source. Do not infer missing project information from this reference limitation."};
      }
      documentSearchCalls++;
      if (documentSearchCalls > ECOS_MAX_FRESH_DOCUMENT_SEARCHES) {
        return {error:"document_search_budget_reached",answerEvidenceEligible:false};
      }
      const result = await input.inspectCurrentDrawingImage(source,question,context.signal);
      context.signal.throwIfAborted();
      const citation = source.documentCitation;
      if (!citation || !["projectId","documentId","sourceSha256","revision","pageNumber"].every(key =>
        citation[key] != null && result.source[key as keyof typeof result.source] === citation[key])) {
        throw new Error("drawing_visual_source_identity_invalid");
      }
      // Remember only the source actually inspected, after the authenticated
      // image callback succeeds. Its own source id must be cited downstream.
      rememberSources([source]);
      return {
        mode:result.mode,sourceId:source.id,pageNumber:result.source.pageNumber,
        observations:result.observations,limitations:result.limitations,views:result.views,
        coverage:result.coverage,answerEvidenceEligible:false,semanticVerified:false,
        instruction:"Unverified visual research only. These observations require separate claim review and final source binding before they can support an answer.",
      };
    },
  });

  return Object.freeze({
    tools: Object.freeze([
      inventoryTool,
      snapshotSearchTool,
      scheduleListTool,
      progressListTool,
      documentSearchTool,
      openTool,
      ...(input.readCurrentDrawingPage ? [drawingPageTool] : []),
      ...(input.inspectCurrentDrawingImage ? [drawingImageTool] : []),
    ]),
    researchSources: () => Object.freeze([...researchSourcesById.values()]),
    rejectedProofSourceIds: () => Object.freeze([...rejectedProofIds]),
    verifiedProofSourceIds: () => Object.freeze([...verifiedProofIds]),
  });
}

function isUsableResearchMatch(value: unknown): boolean {
  return isRecord(value) && !(isRecord(value.documentProof) && value.documentProof.status === "rejected");
}

function agentEvidenceSource(source: ECOSAgentProjectSource, proofReadiness: ECOSDocumentProofReadiness = "not_checked") {
  if (proofReadiness === "rejected") return {
    id: source.id,
    sourceType: source.sourceType,
    documentProof: {
      status: "rejected",
      limitation: "This retrieved reference has no matching current proof record. Its content is withheld and cannot support an answer. Search another source; report incomplete coverage if needed, not that the project information does not exist.",
    },
  };
  return {
    id: source.id,
    sourceType: source.sourceType,
    title: source.title,
    excerpt: source.excerpt,
    updatedAt: source.updatedAt,
    citation: source.documentCitation || null,
    observation: source.sourceType === "document" ? {
      method: typeof source.documentRegion?.source === "string" ? source.documentRegion.source.slice(0,80) : null,
      confidence: typeof source.documentRegion?.confidence === "number" &&
          Number.isFinite(source.documentRegion.confidence) && source.documentRegion.confidence >= 0 && source.documentRegion.confidence <= 1
        ? source.documentRegion.confidence : null,
      limitation: "Observation metadata is not answer verification. Identifiers are opaque; their wording does not establish confidence, content, or approval.",
    } : null,
    documentProof: source.sourceType === "document" ? {
      status: proofReadiness,
      limitation: proofReadiness === "unavailable"
        ? "Indexed content exists, but exact protected proof is unavailable. Seek another supporting source or explain this limitation; do not claim the information is absent."
        : proofReadiness === "not_checked" ? "Proof availability has not been checked; final authoritative verification is still required." : "Current authority returned a protected page locator; final binding and device opening are still required.",
    } : null,
    sheetProvenance: source.documentProvenance || null,
    limitations: source.documentLimitations || [],
    schedule: source.scheduleData || null,
    progress: source.progressData || null,
  };
}

function compareProgressSources<TSource extends ECOSAgentProjectSource>(
  left: TSource,
  right: TSource,
  sortBy: string,
) {
  if (sortBy === "task_name_ascending") {
    return normalize(left.progressData?.taskName || left.title).localeCompare(
      normalize(right.progressData?.taskName || right.title),
    ) || left.id.localeCompare(right.id);
  }
  const order = compareDates(
    left.progressData?.occurredAt || left.updatedAt,
    right.progressData?.occurredAt || right.updatedAt,
  );
  return (sortBy === "occurred_descending" ? -order : order) ||
    left.id.localeCompare(right.id);
}

function progressLocationMatches(query: string, candidate: string) {
  const normalizedCandidate = normalize(candidate);
  if (!normalizedCandidate) return false;
  if (
    normalizedCandidate === query || normalizedCandidate.includes(query) ||
    query.includes(normalizedCandidate)
  ) return true;
  return stripProjectLocationPrefix(normalizedCandidate) ===
    stripProjectLocationPrefix(query);
}

function stripProjectLocationPrefix(value: string) {
  return value.replace(/^\d{3,6}\s+/, "").trim();
}

function compareScheduleSources<TSource extends ECOSAgentProjectSource>(
  left: TSource,
  right: TSource,
  sortBy: string,
) {
  const leftSchedule = left.scheduleData;
  const rightSchedule = right.scheduleData;
  if (sortBy === "task_name_ascending") {
    return normalize(leftSchedule?.taskName || left.title).localeCompare(
      normalize(rightSchedule?.taskName || right.title),
    ) || left.id.localeCompare(right.id);
  }
  if (sortBy === "updated_descending") {
    return compareDates(right.updatedAt, left.updatedAt) ||
      left.id.localeCompare(right.id);
  }
  const leftDate = scheduleDateKey(leftSchedule?.startDate) ||
    (sortBy === "start_ascending" ? "9999-12-31" : "0000-01-01");
  const rightDate = scheduleDateKey(rightSchedule?.startDate) ||
    (sortBy === "start_ascending" ? "9999-12-31" : "0000-01-01");
  const order = leftDate.localeCompare(rightDate);
  return (sortBy === "start_descending" ? -order : order) ||
    normalize(leftSchedule?.taskName || left.title).localeCompare(
      normalize(rightSchedule?.taskName || right.title),
    ) || left.id.localeCompare(right.id);
}

function scheduleDateKey(value: unknown) {
  const raw = clean(value, 40);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (!match) return null;
  return `${match[3]}-${match[1].padStart(2, "0")}-${
    match[2].padStart(2, "0")
  }`;
}

function strictScheduleFilterDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

const SCHEDULE_SORTS = new Set([
  "start_ascending",
  "start_descending",
  "updated_descending",
  "task_name_ascending",
]);

const PROGRESS_SORTS = new Set([
  "occurred_descending",
  "occurred_ascending",
  "task_name_ascending",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function tokenCoverage(tokens: readonly string[], value: string) {
  if (tokens.length === 0) return 0;
  const normalizedValue = normalize(value);
  const matched = tokens.filter((token) => normalizedValue.includes(token));
  return matched.length / tokens.length;
}

function compareDates(left: string | null, right: string | null) {
  const leftTime = left ? Date.parse(left) : 0;
  const rightTime = right ? Date.parse(right) : 0;
  return (Number.isFinite(leftTime) ? leftTime : 0) -
    (Number.isFinite(rightTime) ? rightTime : 0);
}

function clean(value: unknown, maximum: number) {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, maximum)
    : "";
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.min(maximum, Math.max(minimum, Math.floor(parsed)))
    : fallback;
}

function unique(values: readonly string[]) {
  return [...new Set(values)];
}
