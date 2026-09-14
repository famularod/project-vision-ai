import { type ECOSAgentTool } from "./ecos-read-only-agent.ts";
import { ecosEvidenceIdentityCompatible } from "./ecos-evidence-identity.ts";
import { ecosEvidenceQuestionContextScore } from "./ecos-project-answer-policy.ts";
import {
  canonicalizeECOSQuestionLanguage,
  ecosExpandedQuestionTokens,
} from "./ecos-question-language.ts";

export type ECOSAgentProjectSource = Readonly<{
  id: string;
  sourceType: "project" | "schedule" | "update" | "memory" | "document";
  title: string;
  excerpt: string;
  updatedAt: string | null;
  score: number;
  documentCitation?: Readonly<Record<string, unknown>>;
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
  let snapshotSearchCalls = 0;
  let snapshotSearchReturnedMatches = false;
  let documentSearchCalls = 0;
  const rememberSources = (sources: readonly TSource[]) => {
    sources.forEach((source) => {
      researchSourcesById.set(source.id, source);
      candidatesById.set(source.id, source);
    });
    return sources;
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
      value.matches.length > 0,
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
    execute: (toolInput) => {
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
      ).slice(0, limit);
      const rankedSources = rankedMatches.map(({ source }) => source);
      if (
        rankedMatches.some(({ source, contextScore, coverage }) =>
          source.sourceType === "document" &&
          (contextScore >= 2 || coverage >= 0.5)
        )
      ) {
        snapshotSearchReturnedMatches = true;
      }
      rememberSources(rankedSources);
      return {
        query,
        matches: rankedSources.map(agentEvidenceSource),
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
        matches: matches.map(agentEvidenceSource),
      };
    },
  });

  const documentSearchTool: ECOSAgentTool = Object.freeze({
    name: "search_current_project_documents",
    description:
      "Run one fresh authorized semantic, lexical, metadata, and exact-page search across all current project documents. Use it only when snapshot search found no responsive document evidence. Results contain exact evidence ids that may be cited.",
    progressStage: "searching",
    providesEvidence: true,
    qualifiesAsEvidence: (value) =>
      isRecord(value) && Array.isArray(value.matches) &&
      value.matches.length > 0,
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
      if (snapshotSearchReturnedMatches) {
        return {
          matches: [],
          error: "responsive_snapshot_evidence_already_available",
        };
      }
      documentSearchCalls += 1;
      if (documentSearchCalls > 1) {
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
      const matches = rememberSources(search.sources.slice(0, limit));
      return {
        query,
        semanticAvailable: search.semanticAvailable,
        matchedPageCount: search.matchedPageCount,
        matches: matches.map(agentEvidenceSource),
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
        matches: matches.map(agentEvidenceSource),
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
    execute: (toolInput) => {
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
      return {
        requestedSourceCount: sourceIds.length,
        openedSourceCount: openedSources.length,
        missingSourceIds: sourceIds.filter((sourceId) =>
          !candidatesById.has(sourceId)
        ),
        sources: openedSources.map(agentEvidenceSource),
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
    ]),
    researchSources: () => Object.freeze([...researchSourcesById.values()]),
  });
}

function agentEvidenceSource(source: ECOSAgentProjectSource) {
  return {
    id: source.id,
    sourceType: source.sourceType,
    title: source.title,
    excerpt: source.excerpt,
    updatedAt: source.updatedAt,
    citation: source.documentCitation || null,
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
