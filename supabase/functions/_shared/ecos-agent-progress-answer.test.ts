import {
  buildECOSDeterministicProgressAnswer,
} from "./ecos-agent-progress-answer.ts";
import { type ECOSAgentProjectSource } from "./ecos-agent-project-tools.ts";

const sources: ECOSAgentProjectSource[] = [
  scheduleSource("panels", "INSTALL PANELS & GIRTS", {
    locationName: "Canopy A",
    status: "Complete",
    percentComplete: 100,
  }),
  scheduleSource("cover", "Make water shutoff cover flush with cement", {
    locationName: "2375 North Side",
    status: "Complete",
    percentComplete: 100,
  }),
  updateSource("panels-12", "INSTALL PANELS & GIRTS", {
    locationName: "Canopy A",
    occurredAt: "2026-08-12",
    photoCount: 1,
    photoSummaries: [
      "Photo 1 · Panels have been delivered and are being installed. · Canopy A · This photo is saved as the best available baseline for future comparison.",
    ],
  }),
  updateSource("panels-17", "INSTALL PANELS & GIRTS", {
    locationName: "Canopy A",
    occurredAt: "2026-08-17",
    photoCount: 1,
    photoSummaries: [
      "Photo 1 · Side panels completed. · Canopy A · Prior photo unavailable",
    ],
  }),
  updateSource("cover-27", "Make water shutoff cover flush with cement", {
    locationName: "Unassigned / Unknown Area",
    occurredAt: "2026-07-27",
    photoCount: 2,
  }),
  updateSource("cover-03", "Make water shutoff cover flush with cement", {
    locationName: "2375 North Side",
    occurredAt: "2026-08-03",
    photoCount: 1,
    photoSummaries: [
      "Photo 1 · Cover is now flush with concrete · 2375 North Side · This photo is saved as the best available baseline for future comparison.",
    ],
  }),
  updateSource("south-11", "INSTALL TEMPORARY FENCING", {
    locationName: "2321 South Lot",
    occurredAt: "2026-08-11",
    photoCount: 1,
    photoSummaries: ["Photo 1 · INSTALL TEMPORARY FENCING · 2321 South Lot"],
  }),
  updateSource("south-12", "INSTALL TEMPORARY FENCING", {
    locationName: "2321 South Lot",
    occurredAt: "2026-08-12",
    photoCount: 1,
  }),
  updateSource("south-no-photo", "SOUTH LOT OTHER WORK", {
    locationName: "2321 South Lot",
    occurredAt: "2026-08-13",
    photoCount: 0,
  }),
  memorySource("north-open", {
    locationName: "North Lot",
    status: "open",
    occurredAt: "2026-08-17T15:23:53Z",
    observation: "Fire lane markings are needed for truck traffic.",
    actionText: "Meeting with Matt is already scheduled",
  }),
  memorySource("north-resolved", {
    locationName: "2375 North Lot",
    status: "resolved",
    occurredAt: "2026-08-17T15:21:39Z",
    observation: "When will canopy C guardrails be installed?",
  }),
  memorySource("canopy-open", {
    locationName: "Canopy A",
    status: "open",
    occurredAt: "2026-08-17T15:23:38Z",
    observation: "Electrical box cover needs replacement.",
  }),
];

Deno.test("deterministic progress answer selects the latest task update and preserves acceptance boundary", () => {
  const result = requiredAnswer(
    "What is the latest documented progress on INSTALL PANELS & GIRTS at Canopy A?",
  );
  assertEquals(result.intent, "latest_task_progress");
  assertEquals(result.selectedSources.map((source) => source.id), [
    "update:panels-17",
    "schedule:panels",
  ]);
  assertIncludes(result.proposed.shortAnswer, "2026-08-17");
  assertIncludes(result.proposed.shortAnswer, "Side panels completed.");
  assertIncludes(result.proposed.shortAnswer, "100% complete");
  assertIncludes(result.proposed.shortAnswer, "no inspection acceptance");
});

Deno.test("deterministic progress answer returns exact location and date for the latest matching task update", () => {
  const result = requiredAnswer(
    "Where and when was the most recent update for the water-shutoff cover task?",
  );
  assertEquals(result.intent, "latest_task_update");
  assertEquals(result.selectedSources.map((source) => source.id), [
    "update:cover-03",
  ]);
  assertIncludes(result.proposed.shortAnswer, "2375 North Side");
  assertIncludes(result.proposed.shortAnswer, "2026-08-03");
});

Deno.test("deterministic progress answer includes only photo-backed work at the exact location", () => {
  const result = requiredAnswer(
    "What photo-backed work has been reported for the 2321 South Lot?",
  );
  assertEquals(result.intent, "photo_backed_work");
  assertEquals(result.selectedSources.map((source) => source.id), [
    "update:south-11",
    "update:south-12",
  ]);
  assertIncludes(result.proposed.shortAnswer, "2026-08-11");
  assertIncludes(result.proposed.shortAnswer, "2026-08-12");
  if (result.proposed.shortAnswer.includes("SOUTH LOT OTHER WORK")) {
    throw new Error("no-photo update must not be included");
  }
});

Deno.test("deterministic progress answer includes open exact-location issues and excludes resolved or nested areas", () => {
  const result = requiredAnswer(
    "Which open field issues are recorded for the 2375 North Lot?",
  );
  assertEquals(result.intent, "open_field_issues");
  assertEquals(result.selectedSources.map((source) => source.id), [
    "memory:north-open",
  ]);
  assertIncludes(result.proposed.shortAnswer, "Fire lane markings");
  assertIncludes(result.proposed.shortAnswer, "2026-08-17");
  assertIncludes(result.selectedSources[0].excerpt, "Last updated: 2026-08-17");
  if (/guardrail|Electrical box/i.test(result.proposed.shortAnswer)) {
    throw new Error("resolved or different-area issue must not be included");
  }
});

Deno.test("deterministic progress answer does not equate completion with inspection acceptance", () => {
  const result = requiredAnswer(
    "Does a completed task prove the work passed inspection?",
  );
  assertEquals(result.intent, "completion_is_not_acceptance");
  assertIncludes(result.proposed.shortAnswer, "No.");
  assertIncludes(result.proposed.shortAnswer, "no inspection acceptance");
  assertIncludes(
    result.proposed.limitations.join(" "),
    "separate inspection or acceptance record",
  );
});

Deno.test("deterministic progress answer does not replace broad cross-source synthesis", () => {
  const result = buildECOSDeterministicProgressAnswer({
    question: "What are the highest documented project risks right now?",
    sources,
    snapshotCapturedAt: "2026-09-10T22:00:00Z",
  });
  assertEquals(result, null);
});

function requiredAnswer(question: string) {
  const result = buildECOSDeterministicProgressAnswer({
    question,
    sources,
    snapshotCapturedAt: "2026-09-10T22:00:00Z",
  });
  if (!result) throw new Error("expected deterministic progress answer");
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
    locationName: "Main Building",
    status: "Not Started",
    percentComplete: 0,
    startDate: null,
    finishDate: null,
    baselineStartDate: null,
    baselineFinishDate: null,
    wbsCode: null,
    durationDays: null,
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
      "Inspection acceptance: Not recorded in this schedule activity",
    ].join(". "),
    updatedAt: "2026-09-01T20:27:58Z",
    score: 1,
    scheduleData,
  };
}

function updateSource(
  id: string,
  taskName: string,
  overrides: Partial<NonNullable<ECOSAgentProjectSource["progressData"]>>,
): ECOSAgentProjectSource {
  const progressData = {
    recordKind: "update" as const,
    taskName,
    locationName: "Main Building",
    status: null,
    occurredAt: "2026-09-10",
    notes: null,
    observation: null,
    actionKind: null,
    actionText: null,
    photoCount: 0,
    photoSummaries: [] as string[],
    ...overrides,
  };
  return {
    id: `update:${id}`,
    sourceType: "update",
    title: taskName,
    excerpt: [
      `Field update date: ${progressData.occurredAt}`,
      `Task: ${taskName}`,
      `Area: ${progressData.locationName}`,
      `Photo evidence: ${progressData.photoSummaries.join(". ")}`,
    ].join(". "),
    updatedAt: progressData.occurredAt,
    score: 1,
    progressData,
  };
}

function memorySource(
  id: string,
  overrides: Partial<NonNullable<ECOSAgentProjectSource["progressData"]>>,
): ECOSAgentProjectSource {
  const progressData = {
    recordKind: "memory" as const,
    taskName: null,
    locationName: "Main Building",
    status: "open",
    occurredAt: "2026-09-10",
    notes: null,
    observation: null,
    actionKind: "issue_candidate",
    actionText: null,
    photoCount: 0,
    photoSummaries: [] as string[],
    ...overrides,
  };
  return {
    id: `memory:${id}`,
    sourceType: "memory",
    title: `Field note · ${progressData.locationName}`,
    excerpt: [
      `Observation: ${progressData.observation || ""}`,
      `Location: ${progressData.locationName}`,
      `Action: ${progressData.actionText || ""}`,
      `Status: ${progressData.status}`,
      `Last updated: ${progressData.occurredAt}`,
    ].join(". "),
    updatedAt: progressData.occurredAt,
    score: 1,
    progressData,
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
