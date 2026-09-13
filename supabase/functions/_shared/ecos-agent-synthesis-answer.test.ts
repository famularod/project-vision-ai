import {
  buildECOSDeterministicSynthesisAnswer,
  ecosDeterministicSynthesisDocumentQuery,
  ecosDeterministicSynthesisResearchRequirement,
} from "./ecos-agent-synthesis-answer.ts";
import { type ECOSAgentProjectSource } from "./ecos-agent-project-tools.ts";

const sources: ECOSAgentProjectSource[] = [
  {
    id: "project:project-2321",
    sourceType: "project",
    title: "2321 Compliance Project",
    excerpt: "Project: 2321 Compliance Project",
    updatedAt: "2026-09-10T18:00:00Z",
    score: 1,
  },
  schedule("complete", "COMPLETED WORK", {
    status: "Complete",
    percentComplete: 100,
    startDate: "08/01/2026",
    finishDate: "08/02/2026",
  }),
  schedule("overdue-no-update", "OVERDUE WITHOUT UPDATE", {
    locationName: "North Lot",
    status: "In Progress",
    percentComplete: 40,
    startDate: "08/10/2026",
    finishDate: "08/20/2026",
  }),
  schedule("overdue-with-update", "OVERDUE WITH UPDATE", {
    locationName: "South Lot",
    status: "In Progress",
    percentComplete: 60,
    startDate: "08/15/2026",
    finishDate: "09/01/2026",
  }),
  schedule("upcoming", "UPCOMING WORK", {
    locationName: "Warehouse 131",
    status: "Not Started",
    percentComplete: 0,
    startDate: "09/20/2026",
    finishDate: "09/21/2026",
  }),
  progress("recent-update", "update", {
    taskName: "OVERDUE WITH UPDATE",
    occurredAt: "2026-09-05",
  }),
  progress("open-safety", "memory", {
    locationName: "North Lot",
    status: "open",
    occurredAt: "2026-09-08",
    observation: "Guardrails are needed at the loading dock",
    actionKind: "safety_candidate",
    actionText: "Confirm temporary protection",
  }),
];

Deno.test("synthesis readiness reports exact open, overdue, and issue counts", () => {
  const result = required(
    "What still needs to be completed before this project can be signed off?",
  );
  assertEquals(result.intent, "signoff_readiness");
  assertIncludes(result.proposed.shortAnswer, "3 of 4");
  assertIncludes(
    result.proposed.shortAnswer,
    "2 with scheduled finish dates before",
  );
  assertIncludes(
    result.proposed.shortAnswer,
    "1 field issue is recorded as open",
  );
  assertIncludes(
    result.proposed.shortAnswer,
    "do not establish final inspection acceptance",
  );
  assert(
    result.selectedSources.some((source) =>
      source.excerpt.includes("ECOS VERIFIED PROJECT SYNTHESIS:")
    ),
  );
});

Deno.test("hyphenated sign-off briefing wording uses the verified synthesis", () => {
  const result = required(
    "Give me a sign-off readiness brief with incomplete and overdue work, open field issues, and actual inspection acceptance.",
  );
  assertEquals(result.intent, "signoff_readiness");
  assertIncludes(result.proposed.shortAnswer, "3 of 4");
  assertIncludes(result.proposed.shortAnswer, "inspection acceptance");
});

Deno.test("broad project synthesis supplies one bounded research plan", () => {
  const requirement = ecosDeterministicSynthesisResearchRequirement(
    "Audit overdue work against recent field updates and show which activities have no update.",
  );
  if (!requirement) throw new Error("expected synthesis research requirement");
  assertIncludes(requirement, "inspect_project_evidence_inventory once");
  assertIncludes(requirement, "list_project_schedule_activities once");
  assertIncludes(requirement, "list_project_progress_records once");
  assertIncludes(requirement, "Do not repeat either list call");
  assertEquals(
    ecosDeterministicSynthesisResearchRequirement(
      "How thick is the new concrete on the north lot?",
    ),
    null,
  );
});

Deno.test("synthesis risk answer labels prioritization as recommendations", () => {
  const result = required(
    "What are the highest documented project risks right now?",
  );
  assertEquals(result.intent, "current_risks");
  assertIncludes(result.proposed.shortAnswer, "Guardrails are needed");
  assertIncludes(
    result.proposed.shortAnswer,
    "2 incomplete schedule activities",
  );
  assert(
    result.proposed.facts.some((item) =>
      item.classification === "recommendation"
    ),
  );
  assert(
    result.proposed.facts.some((item) => item.classification === "inference"),
  );
});

Deno.test("synthesis two-week answer preserves the complete bounded window", () => {
  const result = required(
    "What should the superintendent focus on during the next two weeks?",
  );
  assertEquals(result.intent, "two_week_focus");
  assertIncludes(
    result.proposed.shortAnswer,
    "1 non-complete schedule activities",
  );
  assertIncludes(result.proposed.shortAnswer, "UPCOMING WORK");
  assertIncludes(result.proposed.shortAnswer, "09/20/2026");
  assertIncludes(result.proposed.shortAnswer, "Guardrails are needed");
  assertIncludes(
    result.proposed.limitations.join(" "),
    "2026-09-11 through 2026-09-25",
  );
});

Deno.test("synthesis overdue answer joins exact task names to recent updates", () => {
  const result = required("Which overdue work has no recent field update?");
  assertEquals(result.intent, "overdue_without_recent_update");
  assertIncludes(result.proposed.shortAnswer, "1 incomplete activities");
  assertIncludes(result.proposed.shortAnswer, "OVERDUE WITHOUT UPDATE");
  assert(!result.proposed.shortAnswer.includes("OVERDUE WITH UPDATE"));
  assertIncludes(result.proposed.limitations.join(" "), "2026-08-28");
  assertIncludes(
    result.proposed.limitations.join(" "),
    "exact normalized task-name matching",
  );
});

Deno.test("duplicate task names require a matching update location", () => {
  const duplicateSources: ECOSAgentProjectSource[] = [
    ...sources,
    schedule("duplicate-north", "REPEATED WORK", {
      locationName: "North Lot",
      status: "In Progress",
      percentComplete: 20,
      finishDate: "08/20/2026",
    }),
    schedule("duplicate-south", "REPEATED WORK", {
      locationName: "South Lot",
      status: "In Progress",
      percentComplete: 20,
      finishDate: "08/20/2026",
    }),
    progress("duplicate-north-update", "update", {
      taskName: "REPEATED WORK",
      locationName: "North Lot",
      occurredAt: "2026-09-05",
    }),
  ];
  const result = buildECOSDeterministicSynthesisAnswer({
    question: "Which overdue work has no recent field update?",
    sources: duplicateSources,
    snapshotCapturedAt: "2026-09-11T18:00:00Z",
  });
  if (!result) throw new Error("expected deterministic synthesis answer");
  assert(!result.proposed.shortAnswer.includes("REPEATED WORK at North Lot"));
  assertIncludes(result.proposed.shortAnswer, "REPEATED WORK at South Lot");
  assertIncludes(
    result.proposed.limitations.join(" "),
    "same normalized location",
  );
});

Deno.test("hazardous-material canopy summary joins exact drawing requirements and progress limits", () => {
  const canopySources: ECOSAgentProjectSource[] = [
    sources[0],
    schedule("canopy-landscaping", "LANDSCAPING AT WEST SIDE OF CANOPY", {
      locationName: "North Lot",
      status: "Not Started",
      percentComplete: 0,
      startDate: "05/27/2026",
      finishDate: "06/02/2026",
    }),
    document(
      "plan-title",
      "A-1.5A",
      "Weather Protected Canopy Hazardous Material Plan",
    ),
    document(
      "area-one",
      "A-1.5A",
      "Containment Area 1: flammable/combustible and non-hazardous storage",
    ),
    document(
      "area-two",
      "A-1.5A",
      "Containment Area 2: corrosive/toxic and non-hazardous storage",
    ),
    document(
      "components",
      "A-1.5",
      "New concrete slab area. New sump pump. New bollard protection.",
    ),
    document(
      "containment-detail",
      "A-1.7",
      "New 6 x 6 concrete containment curb. Gutter discharge tied into the retention system.",
    ),
    document(
      "fire-code",
      "A-0.0",
      "Hazardous material storage use or dispensing shall comply with California Fire Code Chapter 50. Spills shall be cleaned up.",
    ),
  ];
  const result = buildECOSDeterministicSynthesisAnswer({
    question:
      "Summarize the current 2321 hazardous-material canopy requirements and progress.",
    sources: canopySources,
    snapshotCapturedAt: "2026-09-11T18:00:00Z",
  });
  if (!result) throw new Error("expected canopy synthesis answer");
  assertEquals(result.intent, "hazmat_canopy_summary");
  assertIncludes(
    result.proposed.shortAnswer,
    "Weather Protected Canopy Hazardous Material Plan",
  );
  assertIncludes(result.proposed.shortAnswer, "Containment Area 1");
  assertIncludes(result.proposed.shortAnswer, "Containment Area 2");
  assertIncludes(
    result.proposed.shortAnswer,
    "California Fire Code Chapter 50",
  );
  assertIncludes(result.proposed.shortAnswer, "No canopy-matched field update");
  assertIncludes(result.proposed.shortAnswer, "inspection or acceptance");
  assert(
    result.proposed.facts.some((item) =>
      item.classification === "recommendation"
    ),
  );
});

Deno.test("hazardous-material canopy summary fails closed without both containment assignments", () => {
  const result = buildECOSDeterministicSynthesisAnswer({
    question:
      "Summarize the current hazardous-material canopy requirements and progress.",
    sources: [
      sources[0],
      document(
        "plan-title",
        "A-1.5A",
        "Weather Protected Canopy Hazardous Material Plan",
      ),
      document(
        "area-one",
        "A-1.5A",
        "Containment Area 1: flammable/combustible storage",
      ),
      document("components", "A-1.5", "New concrete slab area."),
    ],
    snapshotCapturedAt: "2026-09-11T18:00:00Z",
  });
  assertEquals(result, null);
});

Deno.test("only hazardous-canopy synthesis requests trigger canonical document research", () => {
  const query = ecosDeterministicSynthesisDocumentQuery(
    "Summarize the current 2321 hazmat canopy requirements and progress.",
  );
  if (!query) throw new Error("expected a canonical document query");
  assertIncludes(query, "containment area 1");
  assertIncludes(query, "containment area 2");
  assertEquals(
    ecosDeterministicSynthesisDocumentQuery(
      "What should the superintendent focus on during the next two weeks?",
    ),
    null,
  );
  assertEquals(
    ecosDeterministicSynthesisDocumentQuery(
      "Which current architectural sheets make up the 2321 hazardous-material canopy plan set?",
    ),
    null,
  );
});

Deno.test("synthesis answer does not replace unrelated exact research", () => {
  const result = buildECOSDeterministicSynthesisAnswer({
    question: "How thick is the new concrete on the north lot?",
    sources,
    snapshotCapturedAt: "2026-09-11T18:00:00Z",
  });
  assertEquals(result, null);
});

function required(question: string) {
  const result = buildECOSDeterministicSynthesisAnswer({
    question,
    sources,
    snapshotCapturedAt: "2026-09-11T18:00:00Z",
  });
  if (!result) throw new Error("expected deterministic synthesis answer");
  return result;
}

function schedule(
  id: string,
  taskName: string,
  overrides: Partial<NonNullable<ECOSAgentProjectSource["scheduleData"]>>,
): ECOSAgentProjectSource {
  const scheduleData = {
    taskName,
    itemType: "Task",
    locationName: "Building 2321",
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
      "Inspection acceptance: Not recorded in this schedule activity",
    ].join(". "),
    updatedAt: "2026-09-10T18:00:00Z",
    score: 1,
    scheduleData,
  };
}

function progress(
  id: string,
  recordKind: "update" | "memory",
  overrides: Partial<NonNullable<ECOSAgentProjectSource["progressData"]>>,
): ECOSAgentProjectSource {
  const progressData = {
    recordKind,
    taskName: null,
    locationName: null,
    status: null,
    occurredAt: null,
    notes: null,
    observation: null,
    actionKind: null,
    actionText: null,
    photoCount: 0,
    photoSummaries: [] as string[],
    ...overrides,
  };
  return {
    id: `${recordKind}:${id}`,
    sourceType: recordKind,
    title: progressData.taskName || progressData.locationName ||
      "Progress record",
    excerpt: [
      `Task: ${progressData.taskName || "not recorded"}`,
      `Location: ${progressData.locationName || "not recorded"}`,
      `Status: ${progressData.status || "not recorded"}`,
      `Date: ${progressData.occurredAt || "not recorded"}`,
      `Observation: ${progressData.observation || "not recorded"}`,
      `Action: ${progressData.actionText || "not recorded"}`,
    ].join(". "),
    updatedAt: progressData.occurredAt,
    score: 1,
    progressData,
  };
}

function document(
  id: string,
  sheetNumber: string,
  excerpt: string,
): ECOSAgentProjectSource {
  return {
    id: "document:" + id,
    sourceType: "document",
    title: "Architectural " + sheetNumber,
    excerpt,
    updatedAt: "2026-09-10T18:00:00Z",
    score: 1,
    documentCitation: {
      documentId: "architectural",
      documentName: "Architectural drawings",
      revision: "1",
      pageNumber: 1,
      sheetNumber,
      regionId: id,
      label: "Architectural " + sheetNumber,
    },
  };
}

function assert(condition: boolean) {
  if (!condition) throw new Error("assertion failed");
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
