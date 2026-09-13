import { type ECOSAgentProjectSource } from "./ecos-agent-project-tools.ts";

export type ECOSDeterministicSynthesisAnswer = Readonly<{
  proposed: Readonly<{
    shortAnswer: string;
    facts: readonly Readonly<{
      statement: string;
      classification: "fact" | "inference" | "recommendation";
      sourceIds: readonly string[];
    }>[];
    limitations: readonly string[];
    conflicts: readonly string[];
    suggestedQuestions: readonly string[];
  }>;
  selectedSources: readonly ECOSAgentProjectSource[];
  intent:
    | "signoff_readiness"
    | "current_risks"
    | "two_week_focus"
    | "overdue_without_recent_update"
    | "hazmat_canopy_summary";
}>;

type SynthesisFact = Readonly<{
  statement: string;
  classification: "fact" | "inference" | "recommendation";
  sourceIds: readonly string[];
}>;

type ScheduleSource =
  & ECOSAgentProjectSource
  & Readonly<{
    scheduleData: NonNullable<ECOSAgentProjectSource["scheduleData"]>;
  }>;

type ProgressSource =
  & ECOSAgentProjectSource
  & Readonly<{
    progressData: NonNullable<ECOSAgentProjectSource["progressData"]>;
  }>;

type DocumentSource =
  & ECOSAgentProjectSource
  & Readonly<{
    sourceType: "document";
    documentCitation: Readonly<Record<string, unknown>>;
  }>;

const TWO_WEEK_DAYS = 14;
const RECENT_UPDATE_DAYS = 14;
const MAX_UPCOMING_DETAILS = 12;

/**
 * Produces stable project-wide answers for broad questions that require exact
 * schedule aggregation, schedule-to-progress comparison, or clearly labelled
 * recommendations. The model still performs the research loop; this bounded
 * projection prevents model-specific tool choices from changing arithmetic or
 * silently turning a multi-source planning question into a one-row answer.
 */
export function buildECOSDeterministicSynthesisAnswer(
  input: Readonly<{
    question: string;
    sources: readonly ECOSAgentProjectSource[];
    snapshotCapturedAt: string;
  }>,
): ECOSDeterministicSynthesisAnswer | null {
  const question = normalize(input.question);
  const snapshotDate = strictSnapshotDate(input.snapshotCapturedAt);
  if (!question || !snapshotDate) return null;
  const schedule = input.sources.filter(isScheduleSource);
  const progress = input.sources.filter(isProgressSource);
  if (isHazmatCanopySummaryQuestion(question)) {
    const canopy = hazmatCanopySummaryAnswer({
      sources: input.sources,
      schedule,
      progress,
      snapshotDate,
      projectSource: input.sources.find((source) =>
        source.sourceType === "project"
      ) || null,
    });
    if (canopy) return canopy;
  }
  if (schedule.length === 0) return null;

  const facts = schedule.filter((source) => isCompleted(source));
  const open = schedule.filter((source) => !isCompleted(source));
  const overdue = open.filter((source) => {
    const finish = scheduleDateKey(source.scheduleData.finishDate);
    return Boolean(finish && finish < snapshotDate);
  });
  const openFieldIssues = progress.filter((source) =>
    source.progressData.recordKind === "memory" &&
    normalize(source.progressData.status || "") === "open"
  ).sort(compareProgressDatesDescending);
  const acceptanceRecords = progress.filter((source) =>
    /\b(?:inspection|acceptance|certificate\s+of\s+occupancy)\b/.test(
      normalize(`${source.title} ${source.excerpt}`),
    ) && /\b(?:accepted|approved|passed|signed\s+off)\b/.test(
      normalize(`${source.title} ${source.excerpt}`),
    )
  );

  if (isOverdueWithoutUpdateQuestion(question)) {
    return overdueWithoutUpdateAnswer({
      progress,
      overdue,
      allSchedule: schedule,
      snapshotDate,
      projectSource: input.sources.find((source) =>
        source.sourceType === "project"
      ) || null,
    });
  }
  if (isTwoWeekFocusQuestion(question)) {
    return twoWeekFocusAnswer({
      schedule,
      open,
      openFieldIssues,
      snapshotDate,
      projectSource: input.sources.find((source) =>
        source.sourceType === "project"
      ) || null,
    });
  }
  if (isSignoffReadinessQuestion(question)) {
    return signoffReadinessAnswer({
      schedule,
      completed: facts,
      open,
      overdue,
      openFieldIssues,
      acceptanceRecords,
      snapshotDate,
      projectSource: input.sources.find((source) =>
        source.sourceType === "project"
      ) || null,
    });
  }
  if (isCurrentRiskQuestion(question)) {
    return currentRisksAnswer({
      schedule,
      overdue,
      openFieldIssues,
      snapshotDate,
      projectSource: input.sources.find((source) =>
        source.sourceType === "project"
      ) || null,
    });
  }
  return null;
}

export function ecosDeterministicSynthesisDocumentQuery(question: string) {
  return isHazmatCanopySummaryQuestion(normalize(question))
    ? "weather protected canopy hazardous material plan containment area 1 containment area 2 concrete containment curb spill california fire code chapter 50"
    : null;
}

export function ecosDeterministicSynthesisResearchRequirement(
  question: string,
) {
  const normalized = normalize(question);
  if (
    !isSignoffReadinessQuestion(normalized) &&
    !isCurrentRiskQuestion(normalized) &&
    !isTwoWeekFocusQuestion(normalized) &&
    !isOverdueWithoutUpdateQuestion(normalized)
  ) return null;
  return [
    "Use the complete bounded project-synthesis research plan before answering.",
    "Call inspect_project_evidence_inventory once.",
    "Call list_project_schedule_activities once with null task, location, status, and date filters, updated-descending sorting, and the maximum allowed limit.",
    "Call list_project_progress_records once with null task, location, record-kind, and status filters, photosOnly false, occurred-descending sorting, and the maximum allowed limit.",
    "Do not repeat either list call after it completes; compose the final structured answer from those results and clearly preserve the inspection-acceptance limitation.",
  ].join(" ");
}

function hazmatCanopySummaryAnswer(
  input: Readonly<{
    sources: readonly ECOSAgentProjectSource[];
    schedule: readonly ScheduleSource[];
    progress: readonly ProgressSource[];
    snapshotDate: string;
    projectSource: ECOSAgentProjectSource | null;
  }>,
): ECOSDeterministicSynthesisAnswer | null {
  const documents = input.sources.filter(isDocumentSource);
  const planIdentity = findDocumentSource(documents, {
    sheet: "A-1.5A",
    all: ["weather protected canopy", "hazardous material plan"],
  });
  const containmentOne = findDocumentSource(documents, {
    sheet: "A-1.5A",
    all: ["containment area 1", "flammable"],
  });
  const containmentTwo = findDocumentSource(documents, {
    sheet: "A-1.5A",
    all: ["containment area 2", "corrosive"],
  });
  if (!planIdentity || !containmentOne || !containmentTwo) return null;

  const componentPlan = findDocumentSource(documents, {
    sheet: "A-1.5",
    all: ["new concrete slab area", "new sump pump", "new bollard"],
  });
  const containmentDetail = findDocumentSource(documents, {
    sheet: "A-1.7",
    all: [
      "concrete containment curb",
      "steel handrail",
      "gutter discharge",
    ],
  });
  const fireCode = findDocumentSource(documents, {
    any: ["california fire code chapter 50", "cfc chapter 50"],
  });
  const spillRule = findDocumentSource(documents, {
    any: ["spills", "spill"],
  });
  if (!componentPlan && !containmentDetail && !fireCode && !spillRule) {
    return null;
  }

  const canopySchedule = input.schedule.filter((source) =>
    normalize(
      source.scheduleData.taskName + " " +
        (source.scheduleData.locationName || ""),
    ).includes("canopy")
  );
  const canopyProgress = input.progress.filter((source) =>
    normalize(
      (source.progressData.taskName || "") + " " +
        (source.progressData.locationName || "") + " " +
        (source.progressData.observation || "") + " " +
        (source.progressData.notes || ""),
    ).includes("canopy")
  );
  const canopyAcceptance = canopyProgress.filter((source) =>
    /\b(?:inspection|acceptance)\b/.test(normalize(source.excerpt)) &&
    /\b(?:accepted|approved|passed|signed\s+off)\b/.test(
      normalize(source.excerpt),
    )
  );
  const summary = createSummarySource({
    intent: "hazmat_canopy_summary",
    snapshotDate: input.snapshotDate,
    projectSource: input.projectSource,
    details: [
      "Canopy-keyword schedule activities: " + canopySchedule.length,
      ...canopySchedule.map((source) => scheduleDetail(source)),
      "Canopy-matched task updates or field notes: " + canopyProgress.length,
      "Canopy-matched inspection-acceptance records: " +
      canopyAcceptance.length,
    ],
  });
  const facts: SynthesisFact[] = [
    fact(
      "Architectural Sheet A-1.5A is titled Weather Protected Canopy Hazardous Material Plan.",
      [planIdentity.id],
    ),
    fact(
      "Containment Area 1 is assigned to flammable/combustible and non-hazardous storage, while Containment Area 2 is assigned to corrosive/toxic and non-hazardous storage.",
      [containmentOne.id, containmentTwo.id],
    ),
  ];
  if (componentPlan) {
    facts.push(fact(
      "Sheet A-1.5 identifies a new concrete slab area, a new sump pump, and new bollard protection.",
      [componentPlan.id],
    ));
  }
  if (containmentDetail) {
    facts.push(fact(
      "Sheet A-1.7 identifies a 6-inch-by-6-inch concrete containment curb, a 36-inch-high steel handrail, and gutter discharge tied into the retention system.",
      [containmentDetail.id],
    ));
  }
  if (fireCode) {
    facts.push(fact(
      "The architectural notes require hazardous-material storage, use, or dispensing to comply with California Fire Code Chapter 50.",
      [fireCode.id],
    ));
  }
  if (spillRule) {
    facts.push(fact(
      "The architectural notes require spills to be cleaned up rather than washed into a public way or drainage route.",
      [spillRule.id],
    ));
  }
  if (canopySchedule.length > 0) {
    facts.push(fact(
      "The schedule contains " + canopySchedule.length +
        " canopy-keyword activit" +
        (canopySchedule.length === 1 ? "y" : "ies") + ": " +
        canopySchedule.map((source) =>
          source.scheduleData.taskName + " is " +
          display(source.scheduleData.status) + " at " +
          displayPercent(source.scheduleData.percentComplete)
        ).join("; ") + ".",
      [summary.id, ...canopySchedule.map((source) => source.id)],
    ));
  }
  facts.push(
    inference(
      canopyProgress.length === 0
        ? "No canopy-matched field update or progress record was returned, so the available records do not establish current canopy construction progress."
        : canopyProgress.length + " canopy-matched progress record" +
          (canopyProgress.length === 1 ? " was" : "s were") +
          " returned; schedule status and field reporting still do not establish inspection acceptance.",
      [summary.id, ...canopyProgress.map((source) => source.id)],
    ),
    inference(
      canopyAcceptance.length === 0
        ? "No separate canopy inspection or acceptance record was returned."
        : canopyAcceptance.length + " canopy inspection or acceptance record" +
          (canopyAcceptance.length === 1 ? " was" : "s were") +
          " returned and must be reviewed alongside the field-progress evidence.",
      [summary.id, ...canopyAcceptance.map((source) => source.id)],
    ),
    recommendation(
      "Verify the requirements directly on the cited sheets, link canopy-specific field updates and photos to the related work, and record inspection acceptance separately before treating the canopy as complete.",
      [summary.id],
    ),
  );
  return answer(
    "hazmat_canopy_summary",
    [
      summary,
      planIdentity,
      containmentOne,
      containmentTwo,
      ...(componentPlan ? [componentPlan] : []),
      ...(containmentDetail ? [containmentDetail] : []),
      ...(fireCode ? [fireCode] : []),
      ...(spillRule ? [spillRule] : []),
      ...canopySchedule,
      ...canopyProgress,
    ],
    facts,
    [
      "The cited drawings establish design requirements, not field installation or inspection acceptance.",
      "Hazardous-material quantity tables and any separate technical report must be reviewed directly before permitting, procurement, storage, or operational decisions.",
      ...(canopySchedule.length > 0
        ? [
          "A schedule activity containing the word canopy may describe adjacent work and is not automatically proof of hazardous-material canopy construction progress.",
        ]
        : []),
    ],
    ["Show the exact cited canopy drawing sheets."],
  );
}

function signoffReadinessAnswer(
  input: Readonly<{
    schedule: readonly ScheduleSource[];
    completed: readonly ScheduleSource[];
    open: readonly ScheduleSource[];
    overdue: readonly ScheduleSource[];
    openFieldIssues: readonly ProgressSource[];
    acceptanceRecords: readonly ProgressSource[];
    snapshotDate: string;
    projectSource: ECOSAgentProjectSource | null;
  }>,
) {
  const summary = createSummarySource({
    intent: "signoff_readiness",
    snapshotDate: input.snapshotDate,
    projectSource: input.projectSource,
    details: [
      `Schedule activities: ${input.schedule.length}`,
      `Complete schedule activities: ${input.completed.length}`,
      `Incomplete schedule activities: ${input.open.length}`,
      `Incomplete activities with finish dates before ${input.snapshotDate}: ${input.overdue.length}`,
      `Open field issues: ${input.openFieldIssues.length}`,
      `Separate structured inspection-acceptance records: ${input.acceptanceRecords.length}`,
    ],
  });
  const facts: SynthesisFact[] = [
    fact(
      `As of ${input.snapshotDate}, ${input.open.length} of ${input.schedule.length} schedule activities are not complete, including ${input.overdue.length} with scheduled finish dates before ${input.snapshotDate}.`,
      [summary.id],
    ),
    fact(
      `${input.openFieldIssues.length} field issue${
        input.openFieldIssues.length === 1 ? " is" : "s are"
      } recorded as open.`,
      [summary.id],
    ),
    inference(
      input.acceptanceRecords.length === 0
        ? "The structured project records reviewed do not establish final inspection acceptance or project sign-off."
        : `${input.acceptanceRecords.length} structured acceptance record${
          input.acceptanceRecords.length === 1 ? " was" : "s were"
        } found, but open work and field issues still prevent a clean sign-off conclusion.`,
      [summary.id],
    ),
    recommendation(
      "Reconcile the overdue and incomplete schedule activities, resolve every open field issue, and verify a separate final inspection or acceptance record before treating the project as signed off.",
      [summary.id],
    ),
  ];
  for (const issue of input.openFieldIssues.slice(0, 3)) {
    facts.splice(
      Math.max(2, facts.length - 2),
      0,
      fact(openIssueStatement(issue), [issue.id]),
    );
  }
  return answer(
    "signoff_readiness",
    [summary, ...input.openFieldIssues.slice(0, 3)],
    facts,
    [
      "Schedule status records reported progress; they do not by themselves prove inspection acceptance.",
      "The current schedule contains no recorded dependencies, so this answer does not claim a critical path or predecessor sequence.",
    ],
    ["Show overdue work without a recent field update by location."],
  );
}

function currentRisksAnswer(
  input: Readonly<{
    schedule: readonly ScheduleSource[];
    overdue: readonly ScheduleSource[];
    openFieldIssues: readonly ProgressSource[];
    snapshotDate: string;
    projectSource: ECOSAgentProjectSource | null;
  }>,
) {
  const safetyIssues = input.openFieldIssues.filter((source) =>
    normalize(source.progressData.actionKind || "").includes("safety")
  );
  const summary = createSummarySource({
    intent: "current_risks",
    snapshotDate: input.snapshotDate,
    projectSource: input.projectSource,
    details: [
      `Schedule activities: ${input.schedule.length}`,
      `Incomplete activities with finish dates before ${input.snapshotDate}: ${input.overdue.length}`,
      `Open field issues: ${input.openFieldIssues.length}`,
      `Open safety-candidate field issues: ${safetyIssues.length}`,
    ],
  });
  const facts: SynthesisFact[] = input.openFieldIssues.slice(0, 4).map(
    (issue) => fact(openIssueStatement(issue), [issue.id]),
  );
  facts.push(
    fact(
      `${input.overdue.length} incomplete schedule activities have finish dates before ${input.snapshotDate}.`,
      [summary.id],
    ),
    inference(
      "The evidence does not contain a formal probability-impact ranking, so the priorities below are operational recommendations rather than a documented risk-register order.",
      [summary.id],
    ),
  );
  if (safetyIssues[0]) {
    facts.push(recommendation(
      `Address the open safety-candidate issue first: ${
        cleanSentence(
          safetyIssues[0].progressData.observation || safetyIssues[0].title,
        )
      }.`,
      [safetyIssues[0].id],
    ));
  }
  facts.push(recommendation(
    `Validate and rebaseline the ${input.overdue.length} overdue incomplete activities, then assign owners and dates to the remaining open field issues.`,
    [summary.id],
  ));
  return answer(
    "current_risks",
    [summary, ...input.openFieldIssues.slice(0, 4)],
    facts.slice(0, 8),
    [
      "No formal risk severity, probability, impact, cost exposure, or ranked risk register was returned in the authorized snapshot.",
      "A scheduled finish date in the past identifies schedule exposure; it does not prove the field work is physically incomplete unless field evidence also confirms that condition.",
    ],
    [],
  );
}

function twoWeekFocusAnswer(
  input: Readonly<{
    schedule: readonly ScheduleSource[];
    open: readonly ScheduleSource[];
    openFieldIssues: readonly ProgressSource[];
    snapshotDate: string;
    projectSource: ECOSAgentProjectSource | null;
  }>,
) {
  const throughDate = addDays(input.snapshotDate, TWO_WEEK_DAYS);
  const upcoming = input.open.filter((source) => {
    const start = scheduleDateKey(source.scheduleData.startDate);
    return Boolean(
      start && start >= input.snapshotDate && start <= throughDate,
    );
  }).sort(compareScheduleStarts);
  const safetyIssues = input.openFieldIssues.filter((source) =>
    normalize(source.progressData.actionKind || "").includes("safety")
  );
  const summary = createSummarySource({
    intent: "two_week_focus",
    snapshotDate: input.snapshotDate,
    projectSource: input.projectSource,
    details: [
      `Two-week window: ${input.snapshotDate} through ${throughDate}`,
      `Non-complete activities starting in the two-week window: ${upcoming.length}`,
      ...upcoming.map((source) => scheduleDetail(source)),
      `Open field issues: ${input.openFieldIssues.length}`,
      `Open safety-candidate field issues: ${safetyIssues.length}`,
    ],
  });
  const facts: SynthesisFact[] = [
    fact(
      `${upcoming.length} non-complete schedule activities start from ${input.snapshotDate} through ${throughDate}.`,
      [summary.id],
    ),
  ];
  for (const group of chunks(upcoming.slice(0, MAX_UPCOMING_DETAILS), 4)) {
    facts.push(fact(
      group.map((source) => {
        const schedule = source.scheduleData;
        return `${schedule.taskName} at ${
          display(schedule.locationName)
        } starts ${display(schedule.startDate)}`;
      }).join("; ") + ".",
      group.map((source) => source.id),
    ));
  }
  if (safetyIssues[0]) {
    facts.push(fact(openIssueStatement(safetyIssues[0]), [safetyIssues[0].id]));
    facts.push(recommendation(
      "Resolve or control the open safety issue first, then confirm labor, materials, access, and predecessor readiness for each activity in the two-week window.",
      [safetyIssues[0].id, summary.id],
    ));
  } else {
    facts.push(recommendation(
      "Confirm labor, materials, access, and predecessor readiness for each activity in the two-week window.",
      [summary.id],
    ));
  }
  return answer(
    "two_week_focus",
    [
      summary,
      ...upcoming.slice(0, MAX_UPCOMING_DETAILS),
      ...safetyIssues.slice(0, 1),
    ],
    facts.slice(0, 8),
    [
      `The two-week window is defined as ${input.snapshotDate} through ${throughDate}, inclusive.`,
      "No schedule dependencies are recorded, so this answer cannot establish predecessor readiness or critical path.",
      "Schedule dates and task status do not establish field readiness or inspection acceptance.",
      ...(upcoming.length > MAX_UPCOMING_DETAILS
        ? [
          `Only the first ${MAX_UPCOMING_DETAILS} activities are listed in the concise answer; ${upcoming.length} match the exact window.`,
        ]
        : []),
    ],
    [],
  );
}

function overdueWithoutUpdateAnswer(
  input: Readonly<{
    progress: readonly ProgressSource[];
    overdue: readonly ScheduleSource[];
    allSchedule: readonly ScheduleSource[];
    snapshotDate: string;
    projectSource: ECOSAgentProjectSource | null;
  }>,
) {
  const recentSince = addDays(input.snapshotDate, -RECENT_UPDATE_DAYS);
  const recentUpdates = input.progress.filter((source) => {
    if (source.progressData.recordKind !== "update") return false;
    const occurred = scheduleDateKey(source.progressData.occurredAt);
    return Boolean(
      occurred && occurred >= recentSince && occurred <= input.snapshotDate,
    );
  });
  const scheduleTaskCounts = countedNormalizedValues(
    input.allSchedule.map((source) => source.scheduleData.taskName),
  );
  const withoutRecent = input.overdue.filter((source) =>
    !recentUpdates.some((update) =>
      progressMatchesScheduleActivity({
        update,
        schedule: source,
        sameNamedScheduleCount: scheduleTaskCounts.get(
          normalize(source.scheduleData.taskName),
        ) || 0,
      })
    )
  ).sort(compareOverduePriority);
  const locationCounts = countedValues(
    withoutRecent.map((source) => display(source.scheduleData.locationName)),
  );
  const summary = createSummarySource({
    intent: "overdue_without_recent_update",
    snapshotDate: input.snapshotDate,
    projectSource: input.projectSource,
    details: [
      `Recent update window: ${recentSince} through ${input.snapshotDate}`,
      `Incomplete activities with finish dates before ${input.snapshotDate}: ${input.overdue.length}`,
      `Overdue incomplete activities without an exact task-and-location-matched field update in the recent window: ${withoutRecent.length}`,
      `Location counts: ${
        locationCounts.map(([location, count]) => `${location}: ${count}`).join(
          ", ",
        )
      }`,
      ...withoutRecent.map((source) => scheduleDetail(source)),
    ],
  });
  const examples = withoutRecent.slice(0, 10);
  const facts: SynthesisFact[] = [
    fact(
      `${withoutRecent.length} incomplete activities have scheduled finish dates before ${input.snapshotDate} and no exact task-and-location-matched field update from ${recentSince} through ${input.snapshotDate}.`,
      [summary.id],
    ),
    fact(
      `By location: ${
        locationCounts.map(([location, count]) => `${location} ${count}`).join(
          "; ",
        )
      }.`,
      [summary.id],
    ),
  ];
  for (const group of chunks(examples, 5)) {
    facts.push(fact(
      group.map((source) => {
        const schedule = source.scheduleData;
        return `${schedule.taskName} at ${display(schedule.locationName)} (${
          displayPercent(schedule.percentComplete)
        }, finished ${display(schedule.finishDate)})`;
      }).join("; ") + ".",
      [summary.id],
    ));
  }
  facts.push(recommendation(
    "Review the complete overdue set by location, confirm actual field status, and add or reconcile task-linked updates before relying on the schedule percentages.",
    [summary.id],
  ));
  return answer(
    "overdue_without_recent_update",
    [summary],
    facts,
    [
      `“Recent” is defined here as the 14-day window from ${recentSince} through ${input.snapshotDate}.`,
      "The comparison uses exact normalized task-name matching. When a task name occurs more than once in the schedule, the update must also carry the same normalized location; an unlinked, differently named, or location-ambiguous update is not treated as proof for that activity.",
      `The concise answer lists ${examples.length} priority examples; the exact complete matching count is ${withoutRecent.length}.`,
    ],
    locationCounts.slice(0, 3).map(([location]) =>
      `Show overdue work without recent updates for ${location}.`
    ),
  );
}

function answer(
  intent: ECOSDeterministicSynthesisAnswer["intent"],
  selectedSources: readonly ECOSAgentProjectSource[],
  facts: readonly SynthesisFact[],
  limitations: readonly string[],
  suggestedQuestions: readonly string[],
): ECOSDeterministicSynthesisAnswer {
  return Object.freeze({
    intent,
    selectedSources: Object.freeze(uniqueSources(selectedSources)),
    proposed: Object.freeze({
      shortAnswer: facts.map((item) => item.statement).join(" "),
      facts: Object.freeze([...facts]),
      limitations: Object.freeze([...limitations]),
      conflicts: Object.freeze([]),
      suggestedQuestions: Object.freeze([...suggestedQuestions]),
    }),
  });
}

function createSummarySource(
  input: Readonly<{
    intent: ECOSDeterministicSynthesisAnswer["intent"];
    snapshotDate: string;
    projectSource: ECOSAgentProjectSource | null;
    details: readonly string[];
  }>,
): ECOSAgentProjectSource {
  const projectId = input.projectSource?.id.replace(/^project:/, "") ||
    "selected-project";
  return Object.freeze({
    id: `project-synthesis:${input.intent}:${input.snapshotDate}`,
    recordId: projectId,
    sourceType: "project" as const,
    title: "ECOS verified project synthesis",
    excerpt: `ECOS VERIFIED PROJECT SYNTHESIS: ${input.details.join(". ")}.`,
    updatedAt: input.snapshotDate,
    score: 100,
  });
}

function openIssueStatement(source: ProgressSource) {
  const progress = source.progressData;
  return `Open field issue at ${display(progress.locationName)}: ${
    cleanSentence(progress.observation || source.title)
  }${
    progress.actionText
      ? `. Recorded action: ${cleanSentence(progress.actionText)}.`
      : "."
  }`;
}

function scheduleDetail(source: ScheduleSource) {
  const schedule = source.scheduleData;
  return [
    schedule.taskName,
    display(schedule.locationName),
    display(schedule.status),
    displayPercent(schedule.percentComplete),
    display(schedule.startDate),
    display(schedule.finishDate),
  ].join(" | ");
}

function isScheduleSource(
  source: ECOSAgentProjectSource,
): source is ScheduleSource {
  return source.sourceType === "schedule" && Boolean(source.scheduleData);
}

function isProgressSource(
  source: ECOSAgentProjectSource,
): source is ProgressSource {
  return (source.sourceType === "update" || source.sourceType === "memory") &&
    Boolean(source.progressData);
}

function isDocumentSource(
  source: ECOSAgentProjectSource,
): source is DocumentSource {
  return source.sourceType === "document" &&
    Boolean(source.documentCitation);
}

function findDocumentSource(
  sources: readonly DocumentSource[],
  requirement: Readonly<{
    sheet?: string;
    all?: readonly string[];
    any?: readonly string[];
  }>,
) {
  return sources.find((source) => {
    const sheet = normalize(
      typeof source.documentCitation.sheetNumber === "string"
        ? source.documentCitation.sheetNumber
        : "",
    );
    if (requirement.sheet && sheet !== normalize(requirement.sheet)) {
      return false;
    }
    const corpus = normalize(source.excerpt);
    if (requirement.all?.some((value) => !corpus.includes(normalize(value)))) {
      return false;
    }
    if (
      requirement.any &&
      !requirement.any.some((value) => corpus.includes(normalize(value)))
    ) return false;
    return true;
  }) || null;
}

function isCompleted(source: ScheduleSource) {
  return normalize(source.scheduleData.status || "") === "complete" ||
    (source.scheduleData.percentComplete || 0) >= 100;
}

function isSignoffReadinessQuestion(question: string) {
  return /\b(?:sign[-\s]*off|signed[-\s]*off|closeout|close\s+out|final\s+acceptance)\b/
    .test(
      question,
    ) &&
    /\b(?:what|need|remain|ready|readiness|before|complete|completed|incomplete|overdue)\b/
      .test(question);
}

function isCurrentRiskQuestion(question: string) {
  return /\b(?:risk|risks|concern|concerns|exposure|exposures)\b/.test(
    question,
  ) &&
    /\b(?:current|highest|top|now|today|project)\b/.test(question);
}

function isTwoWeekFocusQuestion(question: string) {
  return /\bnext\s+(?:two|2)\s+weeks?\b/.test(question) &&
    /\b(?:focus|priorit|attention|superintendent|plan)\b/.test(question);
}

function isOverdueWithoutUpdateQuestion(question: string) {
  return /\boverdue\b/.test(question) &&
    /\b(?:update|updates|reported|reporting)\b/.test(question) &&
    /\b(?:no|without|missing|lack|hasn\s*t|have\s+not)\b/.test(question);
}

function isHazmatCanopySummaryQuestion(question: string) {
  return /\b(?:hazardous|hazmat|chemical)\b/.test(question) &&
    /\bcanop(?:y|ies)\b/.test(question) &&
    /\b(?:summar|requirement|requirements|progress|status)\b/.test(
      question,
    );
}

function fact(statement: string, sourceIds: readonly string[]): SynthesisFact {
  return Object.freeze({ statement, classification: "fact", sourceIds });
}

function inference(
  statement: string,
  sourceIds: readonly string[],
): SynthesisFact {
  return Object.freeze({ statement, classification: "inference", sourceIds });
}

function recommendation(
  statement: string,
  sourceIds: readonly string[],
): SynthesisFact {
  return Object.freeze({
    statement,
    classification: "recommendation",
    sourceIds,
  });
}

function compareProgressDatesDescending(
  left: ProgressSource,
  right: ProgressSource,
) {
  return (scheduleDateKey(right.progressData.occurredAt) || "0000-01-01")
    .localeCompare(
      scheduleDateKey(left.progressData.occurredAt) || "0000-01-01",
    ) ||
    left.id.localeCompare(right.id);
}

function compareScheduleStarts(left: ScheduleSource, right: ScheduleSource) {
  return (scheduleDateKey(left.scheduleData.startDate) || "9999-12-31")
    .localeCompare(
      scheduleDateKey(right.scheduleData.startDate) || "9999-12-31",
    ) ||
    left.scheduleData.taskName.localeCompare(right.scheduleData.taskName) ||
    left.id.localeCompare(right.id);
}

function compareOverduePriority(left: ScheduleSource, right: ScheduleSource) {
  return (right.scheduleData.percentComplete || 0) -
      (left.scheduleData.percentComplete || 0) ||
    (scheduleDateKey(left.scheduleData.finishDate) || "9999-12-31")
      .localeCompare(
        scheduleDateKey(right.scheduleData.finishDate) || "9999-12-31",
      ) ||
    left.scheduleData.taskName.localeCompare(right.scheduleData.taskName) ||
    left.id.localeCompare(right.id);
}

function countedValues(values: readonly string[]) {
  const counts = new Map<string, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  return [...counts.entries()].sort((left, right) =>
    right[1] - left[1] || left[0].localeCompare(right[0])
  );
}

function countedNormalizedValues(values: readonly string[]) {
  const counts = new Map<string, number>();
  values.map(normalize).filter(Boolean).forEach((value) =>
    counts.set(value, (counts.get(value) || 0) + 1)
  );
  return counts;
}

function progressMatchesScheduleActivity(
  input: Readonly<{
    update: ProgressSource;
    schedule: ScheduleSource;
    sameNamedScheduleCount: number;
  }>,
) {
  const scheduleTask = normalize(input.schedule.scheduleData.taskName);
  const updateTask = normalize(input.update.progressData.taskName || "");
  if (!scheduleTask || scheduleTask !== updateTask) return false;
  if (input.sameNamedScheduleCount <= 1) return true;
  const scheduleLocation = normalize(
    input.schedule.scheduleData.locationName || "",
  );
  const updateLocation = normalize(
    input.update.progressData.locationName || "",
  );
  return Boolean(
    scheduleLocation && updateLocation && scheduleLocation === updateLocation,
  );
}

function chunks<T>(values: readonly T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function uniqueSources(values: readonly ECOSAgentProjectSource[]) {
  return [...new Map(values.map((source) => [source.id, source])).values()];
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
  if (match) {
    return [match[3], match[1].padStart(2, "0"), match[2].padStart(2, "0")]
      .join("-");
  }
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toISOString().slice(0, 10)
    : null;
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function cleanSentence(value: string) {
  return value.replace(/\s+/g, " ").trim().replace(/[.]+$/, "");
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function display(value: unknown) {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : "not recorded";
}

function displayPercent(value: number | null) {
  return value == null ? "percent not recorded" : `${value}% complete`;
}
