import {
  buildECOSDeterministicScheduleAnswer,
} from "./ecos-agent-schedule-answer.ts";
import { type ECOSAgentProjectSource } from "./ecos-agent-project-tools.ts";

const baseSources: ECOSAgentProjectSource[] = [
  scheduleSource("footings", "FORM & PLACE FOOTINGS", {
    locationName: "2321 South Lot",
    status: "Not Started",
    percentComplete: 0,
    startDate: "09/18/2026",
    finishDate: "09/24/2026",
    dependencies: [],
  }),
  scheduleSource("doors", "DEMO EXISTING MAN DOORS & PREP FOR NEW CONDITION", {
    locationName: "SEQUENCE 3 EXIST WAREHOUSE 131",
    status: "In Progress",
    percentComplete: 10,
    startDate: "09/08/2026",
    finishDate: "09/16/2026",
  }),
  scheduleSource("fencing", "INSTALL TEMPORARY FENCING", {
    locationName: "2321 South Lot",
    status: "Not Started",
    percentComplete: 0,
    startDate: "09/15/2026",
    finishDate: "09/15/2026",
  }),
];

Deno.test("deterministic schedule answer preserves exact task identity and fields", () => {
  const result = requiredAnswer(
    "What is the current status of DEMO EXISTING MAN DOORS & PREP FOR NEW CONDITION?",
  );
  assertEquals(result.intent, "exact_task_status");
  const text = result.proposed.shortAnswer;
  assertIncludes(text, "DEMO EXISTING MAN DOORS & PREP FOR NEW CONDITION");
  assertIncludes(text, "SEQUENCE 3 EXIST WAREHOUSE 131");
  assertIncludes(text, "In Progress");
  assertIncludes(text, "10% complete");
  assertIncludes(text, "09/08/2026");
  assertIncludes(text, "09/16/2026");
  assertEquals(result.selectedSources.map((source) => source.id), [
    "schedule:doors",
  ]);
});

Deno.test("deterministic schedule answer returns the complete in-progress set", () => {
  const additional = Array.from(
    { length: 10 },
    (_, index) =>
      scheduleSource(`active-${index}`, `ACTIVE TASK ${index}`, {
        status: "In Progress",
        percentComplete: index + 1,
      }),
  );
  const result = requiredAnswer(
    "Which 2321 activities are in progress right now?",
    [...baseSources, ...additional],
  );
  assertEquals(result.intent, "complete_status_list");
  assertEquals(result.selectedSources.length, 11);
  for (const source of result.selectedSources) {
    assertIncludes(result.proposed.shortAnswer, source.scheduleData!.taskName);
  }
});

Deno.test("deterministic schedule answer chooses every task on the earliest next date", () => {
  const tied = scheduleSource("mobilize", "MOBILIZE SOUTH LOT", {
    locationName: "2321 South Lot",
    status: "Not Started",
    startDate: "09/15/2026",
    finishDate: "09/16/2026",
  });
  const result = requiredAnswer(
    "What work is scheduled next at the 2321 South Lot?",
    [...baseSources, tied],
  );
  assertEquals(result.intent, "next_work");
  assertEquals(result.selectedSources.map((source) => source.id), [
    "schedule:fencing",
    "schedule:mobilize",
  ]);
  assertIncludes(result.proposed.shortAnswer, "2321 South Lot");
  assertIncludes(result.proposed.shortAnswer, "09/15/2026");
  assertIncludes(result.proposed.shortAnswer, "next");
  assertIncludes(result.proposed.limitations.join(" "), "2026-09-10");
});

Deno.test("deterministic next-work answer evaluates more than 25 future activities", () => {
  const later = Array.from(
    { length: 30 },
    (_, index) =>
      scheduleSource(`later-${index}`, `LATER SOUTH LOT TASK ${index}`, {
        locationName: "2321 South Lot",
        status: "Not Started",
        startDate: "09/20/2026",
        finishDate: "09/21/2026",
      }),
  );
  const result = requiredAnswer(
    "What work is scheduled next at the 2321 South Lot?",
    [...baseSources, ...later],
  );
  assertEquals(result.intent, "next_work");
  assertEquals(result.selectedSources.map((source) => source.id), [
    "schedule:fencing",
  ]);
  assertIncludes(result.proposed.shortAnswer, "INSTALL TEMPORARY FENCING");
  assertIncludes(result.proposed.shortAnswer, "2321 South Lot");
  assertIncludes(result.proposed.shortAnswer, "09/15/2026");
  assertIncludes(result.proposed.shortAnswer, "next");
  assertIncludes(result.proposed.limitations.join(" "), "32 non-complete");
});

Deno.test("deterministic schedule answer fails closed on absent dependencies", () => {
  const result = requiredAnswer(
    "What needs to finish before FORM & PLACE FOOTINGS can start?",
  );
  assertEquals(result.intent, "dependency_check");
  assertIncludes(result.proposed.shortAnswer, "FORM & PLACE FOOTINGS");
  assertIncludes(
    result.proposed.shortAnswer,
    "No dependency is recorded",
  );
  assertIncludes(
    result.proposed.limitations.join(" "),
    "does not prove that no real-world predecessor",
  );
});

Deno.test("deterministic schedule answer does not replace broad project research", () => {
  const result = buildECOSDeterministicScheduleAnswer({
    question:
      "What still needs to be completed before this project can be signed off?",
    sources: baseSources,
    snapshotCapturedAt: "2026-09-11T02:44:33.743Z",
  });
  assertEquals(result, null);
});

Deno.test("deterministic next-work answer does not collapse a two-week planning question", () => {
  const result = buildECOSDeterministicScheduleAnswer({
    question:
      "What should the superintendent focus on during the next two weeks?",
    sources: baseSources,
    snapshotCapturedAt: "2026-09-11T02:44:33.743Z",
  });
  assertEquals(result, null);
});

function requiredAnswer(
  question: string,
  sources: readonly ECOSAgentProjectSource[] = baseSources,
) {
  const result = buildECOSDeterministicScheduleAnswer({
    question,
    sources,
    snapshotCapturedAt: "2026-09-11T02:44:33.743Z",
  });
  if (!result) throw new Error("expected deterministic schedule answer");
  return result;
}

function scheduleSource(
  id: string,
  taskName: string,
  overrides: Partial<NonNullable<ECOSAgentProjectSource["scheduleData"]>>,
): ECOSAgentProjectSource {
  const scheduleData = {
    taskName,
    itemType: "Task",
    locationName: "2321 Main Building",
    status: "Not Started",
    percentComplete: 0,
    startDate: "09/20/2026",
    finishDate: "09/22/2026",
    baselineStartDate: null,
    baselineFinishDate: null,
    wbsCode: null,
    durationDays: 2,
    dependencies: [] as string[],
    isMilestone: false,
    isSummary: false,
    ...overrides,
  };
  return {
    id: `schedule:${id}`,
    sourceType: "schedule",
    title: taskName,
    excerpt: [
      `Task: ${taskName}`,
      `Location: ${scheduleData.locationName}`,
      `Status: ${scheduleData.status}`,
      `Percent complete: ${scheduleData.percentComplete}`,
      `Start: ${scheduleData.startDate}`,
      `Finish: ${scheduleData.finishDate}`,
      `Dependencies: ${
        scheduleData.dependencies.join(", ") || "None recorded"
      }`,
    ].join(". "),
    updatedAt: "2026-09-10T20:00:00Z",
    score: 1,
    scheduleData,
  };
}

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function assertIncludes(actual: string, expected: string) {
  if (!actual.includes(expected)) {
    throw new Error(
      `expected ${JSON.stringify(actual)} to include ${
        JSON.stringify(expected)
      }`,
    );
  }
}
