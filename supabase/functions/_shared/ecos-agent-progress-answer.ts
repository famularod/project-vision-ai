import { type ECOSAgentProjectSource } from "./ecos-agent-project-tools.ts";

export type ECOSDeterministicProgressAnswer<
  TSource extends ECOSAgentProjectSource = ECOSAgentProjectSource,
> = Readonly<{
  proposed: Readonly<{
    shortAnswer: string;
    facts: readonly Readonly<{
      statement: string;
      classification: "fact";
      sourceIds: readonly string[];
    }>[];
    limitations: readonly string[];
    conflicts: readonly string[];
    suggestedQuestions: readonly string[];
  }>;
  selectedSources: readonly TSource[];
  intent:
    | "latest_task_progress"
    | "latest_task_update"
    | "photo_backed_work"
    | "open_field_issues"
    | "completion_is_not_acceptance";
}>;

const MAX_COMPLETE_PROGRESS_ROWS = 25;
const TASK_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "for",
  "in",
  "is",
  "make",
  "of",
  "on",
  "the",
  "to",
  "with",
]);

/**
 * Converts structured task, field-update, photo, and field-note records into a
 * stable answer for the bounded progress research activity. The model still
 * plans and researches, but it cannot silently select an older update, include
 * a no-photo record in a photo-backed result, include resolved issues, or treat
 * task completion as inspection acceptance.
 */
export function buildECOSDeterministicProgressAnswer<
  TSource extends ECOSAgentProjectSource,
>(
  input: Readonly<{
    question: string;
    sources: readonly TSource[];
    snapshotCapturedAt: string;
  }>,
): ECOSDeterministicProgressAnswer<TSource> | null {
  const question = normalize(input.question);
  if (!question) return null;
  const scheduleSources = input.sources.filter((source) =>
    source.sourceType === "schedule" && Boolean(source.scheduleData)
  );
  const progressSources = input.sources.filter((source) =>
    Boolean(source.progressData)
  );
  const snapshotDate = strictSnapshotDate(input.snapshotCapturedAt);

  if (asksWhetherCompletionProvesAcceptance(question)) {
    const completed = scheduleSources.filter((source) => {
      const schedule = source.scheduleData!;
      return normalize(schedule.status || "") === "complete" ||
        schedule.percentComplete === 100;
    }).sort(compareTaskNames)[0];
    if (!completed) return null;
    const schedule = completed.scheduleData!;
    const statement = `No. ${schedule.taskName} is marked ${
      display(schedule.status)
    } and ${
      displayPercent(schedule.percentComplete)
    } complete in the current schedule, but that schedule activity records no inspection acceptance.`;
    return answer(
      "completion_is_not_acceptance",
      [completed],
      [fact(statement, completed.id)],
      [
        ...snapshotLimitations(snapshotDate),
        "Task completion and documented inspection acceptance are separate records. A separate inspection or acceptance record is required before claiming sign-off.",
      ],
    );
  }

  if (asksForPhotoBackedWork(question)) {
    const location = longestQuestionLocation(question, progressSources);
    const matching = progressSources.filter((source) => {
      const progress = source.progressData!;
      return progress.recordKind === "update" && progress.photoCount > 0 &&
        (!location || progressLocationMatches(location, progress.locationName));
    }).sort(compareOccurredAscending);
    if (
      matching.length === 0 || matching.length > MAX_COMPLETE_PROGRESS_ROWS
    ) return null;
    const facts = matching.map((source) => {
      const progress = source.progressData!;
      const detail = meaningfulPhotoDetail(progress);
      return fact(
        `${
          display(progress.taskName || source.title)
        } has a photo-backed field update dated ${
          displayDate(progress.occurredAt)
        } at ${
          display(progress.locationName)
        } with ${progress.photoCount} attached photo${
          progress.photoCount === 1 ? "" : "s"
        }${
          detail
            ? `; the record states: ${withoutTerminalPunctuation(detail)}`
            : ""
        }.`,
        source.id,
      );
    });
    return answer(
      "photo_backed_work",
      matching,
      facts,
      [
        ...snapshotLimitations(snapshotDate),
        "An attached photo documents that a photo was submitted with the field update; it does not by itself prove task completion or inspection acceptance.",
      ],
    );
  }

  if (asksForOpenFieldIssues(question)) {
    const location = longestQuestionLocation(question, progressSources);
    const matching = progressSources.filter((source) => {
      const progress = source.progressData!;
      return progress.recordKind === "memory" &&
        normalize(progress.status || "") === "open" &&
        (!location || progressLocationMatches(location, progress.locationName));
    }).sort(compareOccurredDescending);
    if (
      matching.length === 0 || matching.length > MAX_COMPLETE_PROGRESS_ROWS
    ) return null;
    const facts = matching.map((source) => {
      const progress = source.progressData!;
      const observation = withoutTerminalPunctuation(
        display(progress.observation || source.title),
      );
      const action = progress.actionText
        ? ` The recorded action is: ${
          withoutTerminalPunctuation(progress.actionText)
        }.`
        : "";
      return fact(
        `${observation} is recorded as an open field issue at ${
          display(progress.locationName)
        }, last updated ${displayDate(progress.occurredAt)}.${action}`,
        source.id,
      );
    });
    return answer(
      "open_field_issues",
      matching,
      facts,
      snapshotLimitations(snapshotDate),
    );
  }

  const taskName = bestQuestionTaskName(question, [
    ...scheduleSources.map((source) => source.scheduleData!.taskName),
    ...progressSources.map((source) => source.progressData!.taskName || ""),
  ]);
  if (!taskName) return null;
  const taskUpdates = progressSources.filter((source) => {
    const progress = source.progressData!;
    return progress.recordKind === "update" &&
      normalize(progress.taskName || "") === normalize(taskName);
  }).sort(compareOccurredDescending);
  const latestUpdate = taskUpdates[0];
  if (!latestUpdate) return null;

  if (asksForLatestTaskProgress(question)) {
    const schedule = scheduleSources.find((source) =>
      normalize(source.scheduleData!.taskName) === normalize(taskName)
    );
    if (!schedule) return null;
    const progress = latestUpdate.progressData!;
    const task = schedule.scheduleData!;
    const detail = meaningfulPhotoDetail(progress) || progress.observation ||
      progress.notes;
    const facts = [
      fact(
        `The latest field update for ${taskName} is dated ${
          displayDate(progress.occurredAt)
        } at ${display(progress.locationName)}${
          detail ? ` and states: ${withoutTerminalPunctuation(detail)}` : ""
        }.`,
        latestUpdate.id,
      ),
      fact(
        `${taskName} is marked ${display(task.status)} and ${
          displayPercent(task.percentComplete)
        } complete in the current schedule; that schedule activity records no inspection acceptance.`,
        schedule.id,
      ),
    ];
    return answer(
      "latest_task_progress",
      [latestUpdate, schedule],
      facts,
      [
        ...snapshotLimitations(snapshotDate),
        "The latest field report and the schedule status are reported progress. No separate inspection-acceptance record was used to claim accepted work.",
      ],
    );
  }

  if (asksForLatestTaskUpdate(question)) {
    const progress = latestUpdate.progressData!;
    return answer(
      "latest_task_update",
      [latestUpdate],
      [fact(
        `The most recent field update for ${taskName} is dated ${
          displayDate(progress.occurredAt)
        } at ${display(progress.locationName)}.`,
        latestUpdate.id,
      )],
      snapshotLimitations(snapshotDate),
    );
  }

  return null;
}

function answer<TSource extends ECOSAgentProjectSource>(
  intent: ECOSDeterministicProgressAnswer["intent"],
  sources: readonly TSource[],
  facts: readonly Readonly<{
    statement: string;
    classification: "fact";
    sourceIds: readonly string[];
  }>[],
  limitations: readonly string[],
): ECOSDeterministicProgressAnswer<TSource> {
  return Object.freeze({
    intent,
    selectedSources: Object.freeze([...sources]),
    proposed: Object.freeze({
      shortAnswer: facts.map((item) => item.statement).join(" "),
      facts: Object.freeze([...facts]),
      limitations: Object.freeze([...limitations]),
      conflicts: Object.freeze([]),
      suggestedQuestions: Object.freeze([]),
    }),
  });
}

function fact(statement: string, sourceId: string) {
  return Object.freeze({
    statement,
    classification: "fact" as const,
    sourceIds: Object.freeze([sourceId]),
  });
}

function asksWhetherCompletionProvesAcceptance(question: string) {
  return /\b(?:complete|completed|completion|done)\b/.test(question) &&
    /\b(?:prove|proof|inspection|inspected|acceptance|accepted|sign[- ]?off)\b/
      .test(question);
}

function asksForPhotoBackedWork(question: string) {
  return /\b(?:photo|photos|picture|pictures|image|images)\b/.test(question) &&
    /\b(?:backed|work|progress|reported|documented|show)\b/.test(question);
}

function asksForOpenFieldIssues(question: string) {
  return /\b(?:open|unresolved|outstanding|active)\b/.test(question) &&
    /\b(?:field\s+)?(?:issue|issues|problem|problems|concern|concerns)\b/.test(
      question,
    );
}

function asksForLatestTaskProgress(question: string) {
  return /\b(?:latest|current|recent)\b/.test(question) &&
    /\b(?:documented\s+)?progress\b/.test(question);
}

function asksForLatestTaskUpdate(question: string) {
  return /\b(?:latest|most\s+recent|newest|recent)\b/.test(question) &&
    /\b(?:field\s+)?update\b/.test(question);
}

function bestQuestionTaskName(question: string, names: readonly string[]) {
  const questionTokens = new Set(meaningfulTaskTokens(question));
  const ranked = [...new Set(names.filter(Boolean))].flatMap((name) => {
    const normalizedName = normalize(name);
    const nameTokens = meaningfulTaskTokens(normalizedName);
    if (nameTokens.length === 0) return [];
    const matched = nameTokens.filter((token) => questionTokens.has(token));
    const exact = question.includes(normalizedName);
    if (!exact && matched.length < Math.min(3, nameTokens.length)) return [];
    return [{
      name,
      score: (exact ? 100 : 0) + matched.length * 5 +
        matched.length / nameTokens.length,
    }];
  }).sort((left, right) =>
    right.score - left.score ||
    right.name.length - left.name.length
  );
  return ranked[0]?.name || null;
}

function meaningfulTaskTokens(value: string) {
  return normalize(value).split(" ").filter((token) =>
    token.length >= 2 && !TASK_STOP_WORDS.has(token)
  );
}

function longestQuestionLocation<TSource extends ECOSAgentProjectSource>(
  question: string,
  sources: readonly TSource[],
) {
  const locations = [
    ...new Set(
      sources.map((source) =>
        normalize(source.progressData?.locationName || "")
      )
        .filter((value) => value.length >= 3),
    ),
  ].flatMap((location) => {
    const stripped = stripProjectLocationPrefix(location);
    if (question.includes(location)) {
      return [{ location, score: location.length }];
    }
    if (stripped && question.includes(stripped)) {
      return [{ location: stripped, score: stripped.length }];
    }
    return [];
  }).sort((left, right) => right.score - left.score);
  return locations[0]?.location || null;
}

function progressLocationMatches(query: string, candidate: string | null) {
  const normalizedCandidate = normalize(candidate || "");
  if (!normalizedCandidate) return false;
  return normalizedCandidate === query ||
    stripProjectLocationPrefix(normalizedCandidate) ===
      stripProjectLocationPrefix(query);
}

function stripProjectLocationPrefix(value: string) {
  return value.replace(/^\d{3,6}\s+/, "").trim();
}

function meaningfulPhotoDetail(
  progress: NonNullable<ECOSAgentProjectSource["progressData"]>,
) {
  for (const summary of progress.photoSummaries) {
    const candidates = summary.split("·").map((part) => part.trim()).filter(
      Boolean,
    );
    for (const candidate of candidates) {
      const normalized = normalize(candidate);
      if (!normalized || /^photo\s+\d+$/.test(normalized)) continue;
      if (normalized === normalize(progress.locationName || "")) continue;
      if (/^(?:update|progress|photo|field update)$/.test(normalized)) continue;
      if (
        /\b(?:prior photo unavailable|unavailable comparison|retry analysis|could not finish|comparing this photo|best available baseline)\b/
          .test(normalized)
      ) continue;
      return candidate;
    }
  }
  return null;
}

function withoutTerminalPunctuation(value: string) {
  return value.replace(/[.!?]+\s*$/, "").trim();
}

function compareOccurredDescending(
  left: ECOSAgentProjectSource,
  right: ECOSAgentProjectSource,
) {
  return -compareDates(
    left.progressData?.occurredAt || left.updatedAt,
    right.progressData?.occurredAt || right.updatedAt,
  ) || left.id.localeCompare(right.id);
}

function compareOccurredAscending(
  left: ECOSAgentProjectSource,
  right: ECOSAgentProjectSource,
) {
  return compareDates(
    left.progressData?.occurredAt || left.updatedAt,
    right.progressData?.occurredAt || right.updatedAt,
  ) || left.id.localeCompare(right.id);
}

function compareTaskNames(
  left: ECOSAgentProjectSource,
  right: ECOSAgentProjectSource,
) {
  return normalize(left.scheduleData?.taskName || left.title).localeCompare(
    normalize(right.scheduleData?.taskName || right.title),
  ) || left.id.localeCompare(right.id);
}

function compareDates(left: string | null, right: string | null) {
  const leftTime = left ? Date.parse(left) : 0;
  const rightTime = right ? Date.parse(right) : 0;
  return (Number.isFinite(leftTime) ? leftTime : 0) -
    (Number.isFinite(rightTime) ? rightTime : 0);
}

function snapshotLimitations(snapshotDate: string | null) {
  return snapshotDate
    ? [`This answer uses the current project snapshot dated ${snapshotDate}.`]
    : ["The current project snapshot date was unavailable."];
}

function strictSnapshotDate(value: string) {
  const date = /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0] || null;
  return date && !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) ? date : null;
}

function displayDate(value: string | null) {
  const date = /^\d{4}-\d{2}-\d{2}/.exec(value || "")?.[0];
  return date || display(value);
}

function displayPercent(value: number | null) {
  return value == null ? "an unrecorded percentage" : `${value}%`;
}

function display(value: unknown) {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : "not recorded";
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
