import { type ECOSAgentProjectSource } from "./ecos-agent-project-tools.ts";

export type ECOSDeterministicScheduleAnswer<
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
    | "exact_task_schedule"
    | "exact_task_status"
    | "complete_status_list"
    | "next_work"
    | "dependency_check";
}>;

const MAX_COMPLETE_SCHEDULE_ROWS = 25;

/**
 * Converts bounded, structured schedule evidence into a stable user answer.
 * The model still plans and researches, but it cannot silently drop a matching
 * activity, task identity, date, location, status, or dependency limitation.
 */
export function buildECOSDeterministicScheduleAnswer<
  TSource extends ECOSAgentProjectSource,
>(
  input: Readonly<{
    question: string;
    sources: readonly TSource[];
    snapshotCapturedAt: string;
  }>,
): ECOSDeterministicScheduleAnswer<TSource> | null {
  const question = normalize(input.question);
  const scheduleSources = input.sources.filter((source) =>
    source.sourceType === "schedule" && Boolean(source.scheduleData)
  );
  if (!question || scheduleSources.length === 0) return null;

  const exactTask = exactTaskSource(question, scheduleSources);
  const snapshotDate = strictSnapshotDate(input.snapshotCapturedAt);
  const dependencyQuestion =
    /\b(?:depend|dependency|dependencies|predecessor|prerequisite|before|needs?\s+to\s+finish|must\s+finish)\b/
      .test(
        question,
      );
  if (exactTask && dependencyQuestion) {
    return dependencyAnswer(exactTask, snapshotDate);
  }

  const statusQuestion =
    /\b(?:status|progress|percent|percentage|complete|completed|done)\b/.test(
      question,
    );
  if (exactTask && statusQuestion) {
    return exactTaskStatusAnswer(exactTask, snapshotDate);
  }

  const scheduleQuestion =
    /\b(?:when|where|schedule|scheduled|start|finish|date)\b/.test(
      question,
    );
  if (exactTask && scheduleQuestion) {
    return exactTaskScheduleAnswer(exactTask, snapshotDate);
  }

  const inProgressQuestion =
    /\b(?:in\s+progress|underway|ongoing|being\s+worked|working\s+on)\b/.test(
      question,
    );
  if (inProgressQuestion) {
    const matching = scheduleSources.filter((source) => {
      const schedule = source.scheduleData!;
      const status = normalize(schedule.status || "");
      const percent = schedule.percentComplete;
      return status === "in progress" ||
        (percent != null && percent > 0 && percent < 100);
    }).sort(compareTaskNames);
    if (matching.length === 0 || matching.length > MAX_COMPLETE_SCHEDULE_ROWS) {
      return null;
    }
    return completeStatusAnswer(matching, snapshotDate);
  }

  const nextQuestion = /\b(?:next|upcoming|coming\s+up)\b/.test(question) &&
    /\b(?:work|task|tasks|activity|activities|scheduled|schedule)\b/.test(
      question,
    ) &&
    !/\bnext\s+(?:two|2)\s+weeks?\b/.test(question) &&
    !/\b(?:focus|priorit|attention|superintendent)\b/.test(question);
  if (nextQuestion && snapshotDate) {
    const location = longestQuestionLocation(question, scheduleSources);
    const candidates = scheduleSources.filter((source) => {
      const schedule = source.scheduleData!;
      if (normalize(schedule.status || "") === "complete") return false;
      if (
        location && normalize(schedule.locationName || "") !== location
      ) return false;
      const startDate = scheduleDateKey(schedule.startDate);
      return Boolean(startDate && startDate >= snapshotDate);
    }).sort(compareStartDates);
    if (candidates.length === 0) return null;
    const firstDate = scheduleDateKey(candidates[0].scheduleData!.startDate);
    const matching = candidates.filter((source) =>
      scheduleDateKey(source.scheduleData!.startDate) === firstDate
    );
    if (matching.length > MAX_COMPLETE_SCHEDULE_ROWS) return null;
    return nextWorkAnswer(matching, candidates, location, snapshotDate);
  }

  return null;
}

function exactTaskScheduleAnswer<TSource extends ECOSAgentProjectSource>(
  source: TSource,
  snapshotDate: string | null,
): ECOSDeterministicScheduleAnswer<TSource> {
  const schedule = source.scheduleData!;
  const statement = `${schedule.taskName} is scheduled to start ${
    display(schedule.startDate)
  } and finish ${display(schedule.finishDate)} at ${
    display(schedule.locationName)
  }.`;
  return answer(
    "exact_task_schedule",
    [source],
    [fact(statement, source.id)],
    snapshotLimitations(snapshotDate),
  );
}

function exactTaskStatusAnswer<TSource extends ECOSAgentProjectSource>(
  source: TSource,
  snapshotDate: string | null,
): ECOSDeterministicScheduleAnswer<TSource> {
  const schedule = source.scheduleData!;
  const statement = `${schedule.taskName} at ${
    display(schedule.locationName)
  } is ${display(schedule.status)} and ${
    displayPercent(schedule.percentComplete)
  } complete. It is scheduled to start ${
    display(schedule.startDate)
  } and finish ${display(schedule.finishDate)}.`;
  return answer(
    "exact_task_status",
    [source],
    [fact(statement, source.id)],
    snapshotLimitations(snapshotDate),
  );
}

function completeStatusAnswer<TSource extends ECOSAgentProjectSource>(
  sources: readonly TSource[],
  snapshotDate: string | null,
): ECOSDeterministicScheduleAnswer<TSource> {
  const facts = sources.map((source) => {
    const schedule = source.scheduleData!;
    return fact(
      `${schedule.taskName} is In Progress (${
        displayPercent(schedule.percentComplete)
      } complete).`,
      source.id,
    );
  });
  return answer(
    "complete_status_list",
    sources,
    facts,
    snapshotLimitations(snapshotDate),
  );
}

function nextWorkAnswer<TSource extends ECOSAgentProjectSource>(
  nextSources: readonly TSource[],
  candidateSources: readonly TSource[],
  normalizedLocation: string | null,
  snapshotDate: string,
): ECOSDeterministicScheduleAnswer<TSource> {
  const proofSourceIds = nextSources.map((source) => source.id);
  const facts = nextSources.map((source) => {
    const schedule = source.scheduleData!;
    return factWithSources(
      `${schedule.taskName} is next at ${
        display(schedule.locationName || normalizedLocation)
      }, scheduled to start ${display(schedule.startDate)} and finish ${
        display(schedule.finishDate)
      }.`,
      proofSourceIds,
    );
  });
  return answer(
    "next_work",
    nextSources,
    facts,
    [
      `This answer compares ${candidateSources.length} non-complete schedule activities at ${
        display(normalizedLocation)
      } with start dates on or after ${snapshotDate}.`,
      `This answer uses the current schedule snapshot dated ${snapshotDate}.`,
    ],
  );
}

function dependencyAnswer<TSource extends ECOSAgentProjectSource>(
  source: TSource,
  snapshotDate: string | null,
): ECOSDeterministicScheduleAnswer<TSource> {
  const schedule = source.scheduleData!;
  const dependencies = schedule.dependencies.map((value) => value.trim())
    .filter(Boolean);
  if (dependencies.length === 0) {
    return answer(
      "dependency_check",
      [source],
      [fact(
        `No dependency is recorded for ${schedule.taskName} in the current schedule.`,
        source.id,
      )],
      [
        ...snapshotLimitations(snapshotDate),
        "No recorded dependency does not prove that no real-world predecessor or critical-path constraint exists.",
      ],
    );
  }
  return answer(
    "dependency_check",
    [source],
    [fact(
      `${schedule.taskName} records these schedule dependencies: ${
        dependencies.join(
          ", ",
        )
      }.`,
      source.id,
    )],
    snapshotLimitations(snapshotDate),
  );
}

function answer<TSource extends ECOSAgentProjectSource>(
  intent: ECOSDeterministicScheduleAnswer["intent"],
  sources: readonly TSource[],
  facts: readonly Readonly<{
    statement: string;
    classification: "fact";
    sourceIds: readonly string[];
  }>[],
  limitations: readonly string[],
): ECOSDeterministicScheduleAnswer<TSource> {
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
  return factWithSources(statement, [sourceId]);
}

function factWithSources(statement: string, sourceIds: readonly string[]) {
  return Object.freeze({
    statement,
    classification: "fact" as const,
    sourceIds: Object.freeze([...sourceIds]),
  });
}

function exactTaskSource<TSource extends ECOSAgentProjectSource>(
  question: string,
  sources: readonly TSource[],
) {
  const matches = sources.filter((source) => {
    const taskName = normalize(source.scheduleData!.taskName);
    return taskName.length >= 8 && question.includes(taskName);
  }).sort((left, right) =>
    normalize(right.scheduleData!.taskName).length -
    normalize(left.scheduleData!.taskName).length
  );
  return matches[0] || null;
}

function longestQuestionLocation<TSource extends ECOSAgentProjectSource>(
  question: string,
  sources: readonly TSource[],
) {
  const locations = [
    ...new Set(
      sources.map((source) =>
        normalize(source.scheduleData!.locationName || "")
      ).filter((value) => value.length >= 3),
    ),
  ].filter((location) => question.includes(location)).sort((left, right) =>
    right.length - left.length
  );
  return locations[0] || null;
}

function compareTaskNames(
  left: ECOSAgentProjectSource,
  right: ECOSAgentProjectSource,
) {
  return normalize(left.scheduleData!.taskName).localeCompare(
    normalize(right.scheduleData!.taskName),
  ) || left.id.localeCompare(right.id);
}

function compareStartDates(
  left: ECOSAgentProjectSource,
  right: ECOSAgentProjectSource,
) {
  return (scheduleDateKey(left.scheduleData!.startDate) || "9999-12-31")
    .localeCompare(
      scheduleDateKey(right.scheduleData!.startDate) || "9999-12-31",
    ) || compareTaskNames(left, right);
}

function snapshotLimitations(snapshotDate: string | null) {
  return snapshotDate
    ? [`This answer uses the current schedule snapshot dated ${snapshotDate}.`]
    : ["The current schedule snapshot time was unavailable."];
}

function strictSnapshotDate(value: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(parsed);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = values.get("year");
  const month = values.get("month");
  const day = values.get("day");
  return year && month && day ? `${year}-${month}-${day}` : null;
}

function scheduleDateKey(value: unknown) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  return match
    ? [match[3], match[1].padStart(2, "0"), match[2].padStart(2, "0")]
      .join("-")
    : null;
}

function display(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  return "not recorded";
}

function displayPercent(value: number | null) {
  return value == null ? "an unrecorded percentage" : `${value}%`;
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
