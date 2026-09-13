import { assertEquals } from "jsr:@std/assert@1";
import {
  assureAnswer,
  canRecoverECOSDeterministicCanopyLightingAnswer,
  canRecoverECOSDeterministicCrossDisciplineLightingAnswer,
  canRecoverECOSDeterministicProgressAnswer,
  canRecoverECOSDeterministicScheduleAnswer,
  canRecoverECOSDeterministicSynthesisAnswer,
  ecosDeterministicCanopyLightingDocumentQuery,
  ecosDeterministicCrossDisciplineLightingDocumentQuery,
  isECOSProposedAnswerSchemaValue,
  mergeECOSAgentProjectionSources,
  resolveECOSAgentModelBridgeRoute,
  selectECOSDeterministicRecovery,
} from "./index.ts";
import { buildECOSDeterministicConflictAnswer } from "../_shared/ecos-agent-conflict-answer.ts";
import { getECOSControlledConflictFixture } from "../_shared/ecos-agent-conflict-fixtures.ts";
import { buildECOSDeterministicSynthesisAnswer } from "../_shared/ecos-agent-synthesis-answer.ts";
import { buildECOSDeterministicAcceptanceAnswer } from "../_shared/ecos-agent-acceptance-answer.ts";
import { getECOSControlledAcceptanceFixture } from "../_shared/ecos-agent-acceptance-fixtures.ts";
import { buildECOSDeterministicConversationAnswer } from "../_shared/ecos-agent-conversation-answer.ts";
import { getECOSControlledConversationFixtureTurn } from "../_shared/ecos-agent-conversation-fixtures.ts";

Deno.test("deterministic schedule recovery requires successful schedule research and a formatting failure", () => {
  const scheduleTrace = [{
    name: "list_project_schedule_activities",
    status: "completed",
  }];
  assertEquals(
    canRecoverECOSDeterministicScheduleAnswer({
      errorCode: "agent_output_schema_invalid",
      successfulResearchCalls: 1,
      toolTrace: scheduleTrace,
    }),
    true,
  );
  assertEquals(
    canRecoverECOSDeterministicScheduleAnswer({
      errorCode: "agent_provider_failed",
      successfulResearchCalls: 1,
      toolTrace: scheduleTrace,
    }),
    false,
  );
  assertEquals(
    canRecoverECOSDeterministicScheduleAnswer({
      errorCode: "agent_output_schema_invalid",
      successfulResearchCalls: 0,
      toolTrace: scheduleTrace,
    }),
    false,
  );
  assertEquals(
    canRecoverECOSDeterministicScheduleAnswer({
      errorCode: "agent_output_schema_invalid",
      successfulResearchCalls: 1,
      toolTrace: [{ name: "search_project_evidence", status: "completed" }],
    }),
    false,
  );
});

Deno.test("deterministic synthesis recovery requires complete bounded research", () => {
  const projectResearch = [
    { name: "list_project_schedule_activities", status: "completed" },
    { name: "list_project_progress_records", status: "cached" },
  ];
  assertEquals(
    canRecoverECOSDeterministicSynthesisAnswer({
      errorCode: "agent_output_schema_invalid",
      successfulResearchCalls: 2,
      toolTrace: projectResearch,
      intent: "signoff_readiness",
    }),
    true,
  );
  assertEquals(
    canRecoverECOSDeterministicSynthesisAnswer({
      errorCode: "agent_tool_call_limit_reached",
      successfulResearchCalls: 2,
      toolTrace: projectResearch,
      intent: "signoff_readiness",
    }),
    true,
  );
  assertEquals(
    canRecoverECOSDeterministicSynthesisAnswer({
      errorCode: "agent_output_json_invalid",
      successfulResearchCalls: 3,
      toolTrace: [
        { name: "search_project_evidence", status: "completed" },
        { name: "open_project_source", status: "completed" },
        { name: "list_project_schedule_activities", status: "completed" },
        { name: "list_project_progress_records", status: "completed" },
      ],
      intent: "hazmat_canopy_summary",
    }),
    true,
  );
  assertEquals(
    canRecoverECOSDeterministicSynthesisAnswer({
      errorCode: "agent_output_json_invalid",
      successfulResearchCalls: 1,
      toolTrace: [{ name: "search_project_evidence", status: "completed" }],
      intent: "hazmat_canopy_summary",
    }),
    false,
  );
  assertEquals(
    canRecoverECOSDeterministicSynthesisAnswer({
      errorCode: "agent_output_schema_invalid",
      successfulResearchCalls: 1,
      toolTrace: [{
        name: "list_project_schedule_activities",
        status: "completed",
      }],
      intent: "two_week_focus",
    }),
    false,
  );
  assertEquals(
    canRecoverECOSDeterministicSynthesisAnswer({
      errorCode: "agent_provider_failed",
      successfulResearchCalls: 2,
      toolTrace: projectResearch,
      intent: "overdue_without_recent_update",
    }),
    false,
  );
  assertEquals(
    canRecoverECOSDeterministicSynthesisAnswer({
      errorCode: "agent_tool_call_limit_reached",
      successfulResearchCalls: 1,
      toolTrace: [{
        name: "list_project_schedule_activities",
        status: "completed",
      }],
      intent: "current_risks",
    }),
    false,
  );
  assertEquals(
    canRecoverECOSDeterministicSynthesisAnswer({
      errorCode: "agent_output_schema_invalid",
      successfulResearchCalls: 0,
      toolTrace: projectResearch,
      intent: "current_risks",
    }),
    false,
  );
});

Deno.test("broad synthesis recovery owns a failed model response before narrower projections", () => {
  assertEquals(
    selectECOSDeterministicRecovery({
      synthesis: true,
      progress: true,
      schedule: true,
    }),
    "synthesis",
  );
  assertEquals(
    selectECOSDeterministicRecovery({
      synthesis: false,
      progress: true,
      schedule: true,
    }),
    "progress",
  );
  assertEquals(
    selectECOSDeterministicRecovery({
      synthesis: false,
      progress: false,
      schedule: true,
    }),
    "schedule",
  );
  assertEquals(
    selectECOSDeterministicRecovery({
      synthesis: false,
      progress: false,
      schedule: false,
    }),
    null,
  );
});

Deno.test("deterministic synthesis receives sources researched after the initial candidate set", () => {
  const initialProject = {
    id: "project:project-2321",
    sourceType: "project" as const,
    recordId: "project-2321",
    title: "2321 Compliance Project",
    excerpt: "Project: 2321 Compliance Project",
    updatedAt: "2026-09-11T18:00:00Z",
    score: 1,
  };
  const researchedSchedule = {
    id: "schedule:open-work",
    sourceType: "schedule" as const,
    recordId: "open-work",
    title: "OPEN WORK",
    excerpt:
      "Task: OPEN WORK. Status: In Progress. Percent complete: 50. Finish: 08/20/2026.",
    updatedAt: "2026-09-10T18:00:00Z",
    score: 1,
    scheduleData: {
      taskName: "OPEN WORK",
      itemType: "Task",
      locationName: "North Lot",
      status: "In Progress",
      percentComplete: 50,
      startDate: "08/10/2026",
      finishDate: "08/20/2026",
      baselineStartDate: null,
      baselineFinishDate: null,
      wbsCode: null,
      durationDays: 10,
      dependencies: [] as string[],
      isMilestone: false,
      isSummary: false,
    },
  };
  const researchedIssue = {
    id: "memory:open-safety",
    sourceType: "memory" as const,
    recordId: "open-safety",
    title: "Field note · North Lot",
    excerpt:
      "Observation: Guardrails are needed. Location: North Lot. Action: Confirm protection. Status: open.",
    updatedAt: "2026-09-08T18:00:00Z",
    score: 1,
    progressData: {
      recordKind: "memory" as const,
      taskName: null,
      locationName: "North Lot",
      status: "open",
      occurredAt: "2026-09-08",
      notes: null,
      observation: "Guardrails are needed",
      actionKind: "safety_candidate",
      actionText: "Confirm protection",
      photoCount: 0,
      photoSummaries: [] as string[],
    },
  };
  const projection = buildECOSDeterministicSynthesisAnswer({
    question:
      "What still needs to be completed before this project can be signed off?",
    sources: mergeECOSAgentProjectionSources(
      [initialProject],
      [researchedSchedule, researchedIssue],
    ),
    snapshotCapturedAt: "2026-09-11T18:00:00Z",
  });
  if (!projection) throw new Error("expected deterministic synthesis answer");
  assertEquals(projection.intent, "signoff_readiness");
  if (!projection.proposed.shortAnswer.includes("1 of 1 schedule activities")) {
    throw new Error(
      `missing researched schedule: ${projection.proposed.shortAnswer}`,
    );
  }
  if (
    !projection.proposed.shortAnswer.includes(
      "1 field issue is recorded as open",
    )
  ) {
    throw new Error(
      `missing researched field issue: ${projection.proposed.shortAnswer}`,
    );
  }
});

Deno.test("deterministic canopy lighting recovery requires exact server research and a formatting failure", () => {
  assertEquals(
    canRecoverECOSDeterministicCanopyLightingAnswer({
      errorCode: "agent_output_schema_invalid",
      deterministicDocumentResearchCompleted: true,
    }),
    true,
  );
  assertEquals(
    canRecoverECOSDeterministicCanopyLightingAnswer({
      errorCode: "agent_output_json_invalid",
      deterministicDocumentResearchCompleted: true,
    }),
    true,
  );
  assertEquals(
    canRecoverECOSDeterministicCanopyLightingAnswer({
      errorCode: "agent_provider_failed",
      deterministicDocumentResearchCompleted: true,
    }),
    false,
  );
  assertEquals(
    canRecoverECOSDeterministicCanopyLightingAnswer({
      errorCode: "agent_output_schema_invalid",
      deterministicDocumentResearchCompleted: false,
    }),
    false,
  );
  assertEquals(
    canRecoverECOSDeterministicCanopyLightingAnswer({
      errorCode: "agent_deadline_exceeded",
      deterministicDocumentResearchCompleted: true,
    }),
    false,
  );
});

Deno.test("cross-discipline lighting recovery requires completed search and source opening", () => {
  const researched = [
    { name: "search_project_evidence", status: "completed" },
    { name: "open_project_evidence", status: "cached" },
  ];
  assertEquals(
    canRecoverECOSDeterministicCrossDisciplineLightingAnswer({
      errorCode: "agent_output_schema_invalid",
      successfulResearchCalls: 2,
      toolTrace: researched,
    }),
    true,
  );
  assertEquals(
    canRecoverECOSDeterministicCrossDisciplineLightingAnswer({
      errorCode: "agent_output_schema_invalid",
      successfulResearchCalls: 2,
      toolTrace: researched.slice(0, 1),
    }),
    false,
  );
  assertEquals(
    canRecoverECOSDeterministicCrossDisciplineLightingAnswer({
      errorCode: "agent_deadline_exceeded",
      successfulResearchCalls: 2,
      toolTrace: researched,
    }),
    false,
  );
  assertEquals(
    canRecoverECOSDeterministicCrossDisciplineLightingAnswer({
      errorCode: "agent_output_json_invalid",
      successfulResearchCalls: 0,
      toolTrace: [],
      deterministicDocumentResearchCompleted: true,
    }),
    true,
  );
  assertEquals(
    canRecoverECOSDeterministicCrossDisciplineLightingAnswer({
      errorCode: "agent_output_json_invalid",
      successfulResearchCalls: 0,
      toolTrace: researched,
    }),
    false,
  );
});

Deno.test("cross-discipline lighting questions receive one bounded drawing pre-search", () => {
  const expected =
    "civil area lighting see electrical drawings outdoor lighting controls area lighting plan";
  for (
    const question of [
      "Which plans should the field use to confirm north-lot area lighting?",
      "The civil sheet points lighting elsewhere. Where is it actually shown?",
      "Check civil and electrical and tell me what drawings control the outside lights.",
      "Which current sheets together show the site-lighting work for the north lot?",
      "The crew needs the controlling outside-light drawings—what should they open?",
    ]
  ) {
    assertEquals(
      ecosDeterministicCrossDisciplineLightingDocumentQuery(question),
      expected,
    );
  }
  assertEquals(
    ecosDeterministicCrossDisciplineLightingDocumentQuery(
      "How many square feet is Canopy A?",
    ),
    null,
  );
});

Deno.test("canopy lighting status questions receive one bounded drawing pre-search", () => {
  const expected =
    "canopy new light fixture see electrical exterior storage lighting plan";
  for (
    const question of [
      "Are the canopy lights scheduled, and does that prove they are installed now?",
      "Do the plans show lighting at the canopies, or is that the field status?",
      "Is installation of the canopy fixtures planned?",
    ]
  ) {
    assertEquals(
      ecosDeterministicCanopyLightingDocumentQuery(question),
      expected,
    );
  }
  for (
    const question of [
      "When is concrete scheduled?",
      "Are the parking lot lights installed?",
      "What type of canopy is shown?",
      "Are there lights under the canopy?",
    ]
  ) {
    assertEquals(ecosDeterministicCanopyLightingDocumentQuery(question), null);
  }
  assertEquals(
    ecosDeterministicCanopyLightingDocumentQuery(
      "Which current drawings should the field team use for the north-lot lighting work?",
    ),
    null,
  );
});

Deno.test("deterministic progress recovery requires the exact completed research for each intent", () => {
  const trace = [
    { name: "list_project_progress_records", status: "completed" },
    { name: "list_project_schedule_activities", status: "cached" },
  ];
  assertEquals(
    canRecoverECOSDeterministicProgressAnswer({
      errorCode: "agent_output_schema_invalid",
      successfulResearchCalls: 2,
      toolTrace: trace,
      intent: "latest_task_progress",
    }),
    true,
  );
  assertEquals(
    canRecoverECOSDeterministicProgressAnswer({
      errorCode: "agent_output_json_invalid",
      successfulResearchCalls: 1,
      toolTrace: trace,
      intent: "completion_is_not_acceptance",
    }),
    true,
  );
  assertEquals(
    canRecoverECOSDeterministicProgressAnswer({
      errorCode: "agent_output_schema_invalid",
      successfulResearchCalls: 1,
      toolTrace: [{
        name: "list_project_progress_records",
        status: "completed",
      }],
      intent: "latest_task_progress",
    }),
    false,
  );
  assertEquals(
    canRecoverECOSDeterministicProgressAnswer({
      errorCode: "agent_provider_failed",
      successfulResearchCalls: 2,
      toolTrace: trace,
      intent: "latest_task_progress",
    }),
    false,
  );
  assertEquals(
    canRecoverECOSDeterministicProgressAnswer({
      errorCode: "agent_output_schema_invalid",
      successfulResearchCalls: 0,
      toolTrace: trace,
      intent: "completion_is_not_acceptance",
    }),
    false,
  );
});

Deno.test("private model routing isolates DeepSeek from the OpenAI bridge", () => {
  assertEquals(
    resolveECOSAgentModelBridgeRoute({
      model: "deepseek-v4-flash",
      openAIBridgeUrl: "https://openai-bridge.example",
      deepSeekBridgeUrl: "https://deepseek-bridge.example",
    }),
    {
      provider: "deepseek",
      bridgeUrl: "https://deepseek-bridge.example",
      bridgeRequired: true,
      reasoningEffort: "none",
    },
  );
  assertEquals(
    resolveECOSAgentModelBridgeRoute({
      model: "gpt-5.6-terra",
      openAIBridgeUrl: "https://openai-bridge.example",
      deepSeekBridgeUrl: "https://deepseek-bridge.example",
    }),
    {
      provider: "openai",
      bridgeUrl: "https://openai-bridge.example",
      bridgeRequired: false,
      reasoningEffort: "medium",
    },
  );
});

Deno.test("agent output validation enforces the exact required answer shape", () => {
  assertEquals(isECOSProposedAnswerSchemaValue({}), false);
  assertEquals(
    isECOSProposedAnswerSchemaValue({
      shortAnswer: "The evidence is incomplete.",
      facts: [],
      limitations: ["No accepted inspection record was found."],
      conflicts: [],
      suggestedQuestions: [],
    }),
    true,
  );
  assertEquals(
    isECOSProposedAnswerSchemaValue({
      shortAnswer: "Verified.",
      facts: [{
        statement: "A fact.",
        classification: "fact",
        sourceIds: [],
      }],
      limitations: [],
      conflicts: [],
      suggestedQuestions: [],
    }),
    false,
  );
  assertEquals(
    isECOSProposedAnswerSchemaValue({
      shortAnswer: "Verified.",
      facts: [],
      limitations: [],
      conflicts: [],
      suggestedQuestions: [],
      unexpected: true,
    }),
    false,
  );
});

function documentSource(input: {
  id: string;
  title: string;
  excerpt: string;
  page: number;
  sheet: string;
  region: string;
  score?: number;
}) {
  return {
    id: input.id,
    sourceType: "document" as const,
    recordId: input.id,
    title: input.title,
    excerpt: input.excerpt,
    updatedAt: "2026-09-11T00:00:00.000Z",
    score: input.score || 100,
    documentCitation: {
      documentId: `doc-${input.sheet}`,
      documentName: input.title,
      revision: "current",
      pageNumber: input.page,
      sheetNumber: input.sheet,
      regionId: input.region,
      label: `${input.sheet} page ${input.page}`,
    },
    documentRegion: {
      id: input.region,
      label: null,
      text: input.excerpt,
      areaNames: [],
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      confidence: 0.99,
      source: "vision" as const,
      rawSource: "vision",
      reconstructionMethod: "exact_source_bound_dual_render_consensus",
      evidenceSources: ["render-a", "render-b"],
      constituentEvidence: [],
      corroboratingEvidence: [],
    },
    extractionConfidence: 0.99,
    documentLimitations: [],
  };
}

function updateSource(input: { id: string; title: string; excerpt: string }) {
  return {
    id: input.id,
    sourceType: "update" as const,
    recordId: input.id,
    title: input.title,
    excerpt: input.excerpt,
    updatedAt: "2026-09-11T00:00:00.000Z",
    score: 100,
  };
}

function variableProposal(sourceIds: string[], variant: number) {
  return {
    shortAnswer: variant === 1 ? "First wording." : "Second wording.",
    facts: [{
      statement: variant === 1
        ? "The model proposed the first supported wording."
        : "The model proposed a different supported wording.",
      classification: "fact" as const,
      sourceIds,
    }],
    limitations: variant === 1 ? ["A model-added limitation."] : [],
    conflicts: variant === 1 ? ["A model-added conflict."] : [],
    suggestedQuestions: variant === 1 ? ["A model-added suggestion?"] : [],
  };
}

function stableProjection(value: ReturnType<typeof assureAnswer>) {
  return {
    answer: value.answer,
    facts: value.facts,
    limitations: value.limitations,
    conflicts: value.conflicts,
    suggestedQuestions: value.suggestedQuestions,
    supportingEvidence: value.supportingEvidence,
    assurance: value.assurance,
  };
}

Deno.test("controlled conflict answer exposes both sources and fails closed", () => {
  const question =
    "Two documents are marked current and show different dimensions. What is required?";
  const fixture = getECOSControlledConflictFixture("conflict-04", question);
  if (!fixture) throw new Error("controlled conflict fixture missing");
  const projection = buildECOSDeterministicConflictAnswer({
    fixtureId: fixture.id,
    sources: fixture.sources,
  });
  if (!projection) throw new Error("controlled conflict projection missing");
  const answer = assureAnswer({
    proposed: {
      shortAnswer: projection.proposed.shortAnswer,
      facts: projection.proposed.facts.map((fact) => ({
        statement: fact.statement,
        classification: fact.classification,
        sourceIds: [...fact.sourceIds],
      })),
      limitations: [...projection.proposed.limitations],
      conflicts: [...projection.proposed.conflicts],
      suggestedQuestions: [...projection.proposed.suggestedQuestions],
    },
    sources: fixture.sources,
    projectId: "project-2375",
    projectName: "2375 Compliance Project",
    question,
    model: "gpt-5.6-luna",
  });
  assertEquals(answer.assurance.status, "verified_with_limits");
  assertEquals(answer.assurance.verifiedFactCount, 2);
  assertEquals(answer.supportingEvidence.length, 2);
  assertEquals(answer.conflicts.length, 1);
  if (!/6-inch/i.test(answer.answer) || !/8-inch/i.test(answer.answer)) {
    throw new Error(
      `conflicting dimensions were not both preserved: ${answer.answer}`,
    );
  }
});

Deno.test("controlled acceptance answer preserves fact, assessment, recommendation, and exact proof", () => {
  const question = "Is the project ready for sign-off today?";
  const fixture = getECOSControlledAcceptanceFixture("closeout-05", question);
  if (!fixture) throw new Error("controlled acceptance fixture missing");
  const projection = buildECOSDeterministicAcceptanceAnswer({
    fixtureId: fixture.id,
    sources: fixture.sources,
  });
  if (!projection) throw new Error("controlled acceptance projection missing");
  const answer = assureAnswer({
    proposed: {
      shortAnswer: projection.proposed.shortAnswer,
      facts: projection.proposed.facts.map((fact) => ({
        statement: fact.statement,
        classification: fact.classification,
        sourceIds: [...fact.sourceIds],
      })),
      limitations: [...projection.proposed.limitations],
      conflicts: [...projection.proposed.conflicts],
      suggestedQuestions: [...projection.proposed.suggestedQuestions],
    },
    sources: fixture.sources,
    projectId: "project-2375",
    projectName: "2375 Compliance Project",
    question,
    model: "gpt-5.6-luna",
  });
  assertEquals(answer.assurance.status, "verified_with_limits");
  assertEquals(answer.assurance.verifiedFactCount, 3);
  assertEquals(answer.facts.length, 5);
  assertEquals(answer.supportingEvidence.length, 3);
  if (
    !/not ready for sign-off today/i.test(answer.answer) ||
    !/certificate of occupancy/i.test(answer.answer) ||
    !/Recommended action:/i.test(answer.answer)
  ) {
    throw new Error(`acceptance reasoning was not preserved: ${answer.answer}`);
  }
});

Deno.test("project-switch concrete follow-up survives the complete Assurance boundary", () => {
  const question = "What concrete thickness does the current drawing require?";
  const fixture = getECOSControlledConversationFixtureTurn(
    "conversation-03",
    "2321 Compliance Project",
    "Now answer the same question for 2321.",
  );
  if (!fixture) throw new Error("controlled conversation fixture missing");
  const projection = buildECOSDeterministicConversationAnswer({
    fixtureId: fixture.id,
    sources: fixture.sources,
  });
  if (!projection) {
    throw new Error("controlled conversation projection missing");
  }
  const answer = assureAnswer({
    proposed: {
      shortAnswer: projection.proposed.shortAnswer,
      facts: projection.proposed.facts.map((fact) => ({
        statement: fact.statement,
        classification: fact.classification,
        sourceIds: [...fact.sourceIds],
      })),
      limitations: [...projection.proposed.limitations],
      conflicts: [...projection.proposed.conflicts],
      suggestedQuestions: [...projection.proposed.suggestedQuestions],
    },
    sources: fixture.sources,
    projectId: "project-2321",
    projectName: "2321 Compliance Project",
    question,
    model: "gpt-5.6-luna",
  });
  assertEquals(answer.assurance.status, "verified_with_limits");
  assertEquals(answer.assurance.verifiedFactCount, 1);
  assertEquals(answer.supportingEvidence.length, 1);
  if (!/2321/i.test(answer.answer) || !/8-inch/i.test(answer.answer)) {
    throw new Error(`project-switch measurement was lost: ${answer.answer}`);
  }
});

Deno.test("project-switch safety instruction is not treated as factual question text", () => {
  const semanticQuestion =
    "What concrete thickness does the current drawing require?";
  const scopeInstruction =
    'Answer for the currently selected project "2321 Compliance Project" only. Do not carry facts, evidence, citations, or conclusions from the previously selected project.';
  const fixture = getECOSControlledConversationFixtureTurn(
    "conversation-03",
    "2321 Compliance Project",
    "Now answer the same question for 2321.",
  );
  if (!fixture) throw new Error("controlled conversation fixture missing");
  const projection = buildECOSDeterministicConversationAnswer({
    fixtureId: fixture.id,
    sources: fixture.sources,
  });
  if (!projection) {
    throw new Error("controlled conversation projection missing");
  }
  const answer = assureAnswer({
    proposed: {
      shortAnswer: projection.proposed.shortAnswer,
      facts: projection.proposed.facts.map((fact) => ({
        statement: fact.statement,
        classification: fact.classification,
        sourceIds: [...fact.sourceIds],
      })),
      limitations: [...projection.proposed.limitations],
      conflicts: [...projection.proposed.conflicts],
      suggestedQuestions: [...projection.proposed.suggestedQuestions],
    },
    sources: fixture.sources,
    projectId: "project-2321",
    projectName: "2321 Compliance Project",
    question: semanticQuestion,
    model: "gpt-5.6-luna",
  });
  assertEquals(answer.assurance.status, "verified_with_limits");
  assertEquals(answer.assurance.verifiedFactCount, 1);
  assertEquals(answer.question, semanticQuestion);
  assertEquals(answer.question.includes(scopeInstruction), false);
});

Deno.test("all controlled acceptance decisions survive Assurance without model wording", () => {
  const cases = [
    {
      id: "closeout-01",
      question:
        "The INSPECTION & C OF O task is complete. Is final acceptance documented?",
      verifiedFacts: 1,
      sourceCount: 1,
      answerFragment: "Final acceptance is not documented",
    },
    {
      id: "closeout-02",
      question: "Which required inspections are still open?",
      verifiedFacts: 3,
      sourceCount: 4,
      answerFragment: "Two required inspections remain open",
    },
    {
      id: "closeout-03",
      question: "Did the latest inspection pass, fail, or require corrections?",
      verifiedFacts: 2,
      sourceCount: 2,
      answerFragment: "latest inspection outcome is Corrections Required",
    },
    {
      id: "closeout-04",
      question: "What closeout documents are still missing?",
      verifiedFacts: 2,
      sourceCount: 3,
      answerFragment: "Two required closeout documents remain missing",
    },
    {
      id: "closeout-05",
      question: "Is the project ready for sign-off today?",
      verifiedFacts: 3,
      sourceCount: 3,
      answerFragment: "project is not ready for sign-off today",
    },
  ];
  for (const evaluationCase of cases) {
    const fixture = getECOSControlledAcceptanceFixture(
      evaluationCase.id,
      evaluationCase.question,
    );
    if (!fixture) throw new Error(`fixture missing: ${evaluationCase.id}`);
    const projection = buildECOSDeterministicAcceptanceAnswer({
      fixtureId: fixture.id,
      sources: [...fixture.sources].reverse(),
    });
    if (!projection) {
      throw new Error(`projection missing: ${evaluationCase.id}`);
    }
    const answer = assureAnswer({
      proposed: {
        shortAnswer: projection.proposed.shortAnswer,
        facts: projection.proposed.facts.map((fact) => ({
          statement: fact.statement,
          classification: fact.classification,
          sourceIds: [...fact.sourceIds],
        })),
        limitations: [...projection.proposed.limitations],
        conflicts: [...projection.proposed.conflicts],
        suggestedQuestions: [...projection.proposed.suggestedQuestions],
      },
      sources: fixture.sources,
      projectId: "project-2375",
      projectName: "2375 Compliance Project",
      question: evaluationCase.question,
      model: "gpt-5.6-luna",
    });
    assertEquals(
      answer.assurance.verifiedFactCount,
      evaluationCase.verifiedFacts,
    );
    assertEquals(answer.supportingEvidence.length, evaluationCase.sourceCount);
    assertEquals(answer.answer.includes(evaluationCase.answerFragment), true);
    assertEquals(
      answer.supportingEvidence.every((source) =>
        source.recordId.startsWith("private-acceptance-fixture:")
      ),
      true,
    );
  }
});

Deno.test("project synthesis preserves facts, assessments, and recommendations", () => {
  const sources = [
    {
      id: "project:project-2321",
      sourceType: "project" as const,
      recordId: "project-2321",
      title: "2321 Compliance Project",
      excerpt: "Project: 2321 Compliance Project",
      updatedAt: "2026-09-11T18:00:00Z",
      score: 1,
    },
    {
      id: "schedule:open-work",
      sourceType: "schedule" as const,
      recordId: "open-work",
      title: "OPEN WORK",
      excerpt:
        "Task: OPEN WORK. Status: In Progress. Percent complete: 50. Finish: 08/20/2026. Inspection acceptance: Not recorded in this schedule activity.",
      updatedAt: "2026-09-10T18:00:00Z",
      score: 1,
      scheduleData: {
        taskName: "OPEN WORK",
        itemType: "Task",
        locationName: "North Lot",
        status: "In Progress",
        percentComplete: 50,
        startDate: "08/10/2026",
        finishDate: "08/20/2026",
        baselineStartDate: null,
        baselineFinishDate: null,
        wbsCode: null,
        durationDays: 10,
        dependencies: [],
        isMilestone: false,
        isSummary: false,
      },
    },
    {
      id: "memory:open-safety",
      sourceType: "memory" as const,
      recordId: "open-safety",
      title: "Field note · North Lot",
      excerpt:
        "Observation: Guardrails are needed. Location: North Lot. Action: Confirm protection. Status: open.",
      updatedAt: "2026-09-08T18:00:00Z",
      score: 1,
      progressData: {
        recordKind: "memory" as const,
        taskName: null,
        locationName: "North Lot",
        status: "open",
        occurredAt: "2026-09-08",
        notes: null,
        observation: "Guardrails are needed",
        actionKind: "safety_candidate",
        actionText: "Confirm protection",
        photoCount: 0,
        photoSummaries: [],
      },
    },
  ];
  const question =
    "What still needs to be completed before this project can be signed off?";
  const projection = buildECOSDeterministicSynthesisAnswer({
    question,
    sources,
    snapshotCapturedAt: "2026-09-11T18:00:00Z",
  });
  if (!projection) throw new Error("synthesis projection missing");
  const selected = projection.selectedSources.map((source) => ({
    id: source.id,
    sourceType: source.sourceType,
    recordId: typeof (source as Record<string, unknown>).recordId === "string"
      ? (source as Record<string, unknown>).recordId as string
      : source.id,
    title: source.title,
    excerpt: source.excerpt,
    updatedAt: source.updatedAt,
    score: source.score,
    scheduleData: source.scheduleData,
    progressData: source.progressData,
  }));
  const response = assureAnswer({
    proposed: {
      shortAnswer: projection.proposed.shortAnswer,
      facts: projection.proposed.facts.map((fact) => ({
        statement: fact.statement,
        classification: fact.classification,
        sourceIds: [...fact.sourceIds],
      })),
      limitations: [...projection.proposed.limitations],
      conflicts: [],
      suggestedQuestions: [...projection.proposed.suggestedQuestions],
    },
    sources: selected,
    projectId: "project-2321",
    projectName: "2321 Compliance Project",
    question,
    model: "gpt-5.6-luna",
  });
  assertEquals(response.assurance.status, "verified_with_limits");
  if (!response.answer.includes("Recommended action:")) {
    throw new Error(`missing recommendation: ${response.answer}`);
  }
  if (!response.answer.includes("Assessment:")) {
    throw new Error(`missing assessment: ${response.answer}`);
  }
  if (!response.answer.includes("1 of 1 schedule activities")) {
    throw new Error(`missing complete schedule count: ${response.answer}`);
  }
  assertEquals(response.supportingEvidence.length, 2);
});

Deno.test("hazardous canopy synthesis survives Assurance with exact drawing proof", () => {
  const project = {
    id: "project:project-2321",
    sourceType: "project" as const,
    recordId: "project-2321",
    title: "2321 Compliance Project",
    excerpt: "Project: 2321 Compliance Project",
    updatedAt: "2026-09-11T18:00:00Z",
    score: 1,
  };
  const schedule = {
    id: "schedule:canopy-landscaping",
    sourceType: "schedule" as const,
    recordId: "canopy-landscaping",
    title: "LANDSCAPING AT WEST SIDE OF CANOPY",
    excerpt:
      "Task: LANDSCAPING AT WEST SIDE OF CANOPY. Location: North Lot. Status: Not Started. Percent complete: 0.",
    updatedAt: "2026-09-11T18:00:00Z",
    score: 1,
    scheduleData: {
      taskName: "LANDSCAPING AT WEST SIDE OF CANOPY",
      itemType: "Task",
      locationName: "North Lot",
      status: "Not Started",
      percentComplete: 0,
      startDate: "05/27/2026",
      finishDate: "06/02/2026",
      baselineStartDate: null,
      baselineFinishDate: null,
      wbsCode: null,
      durationDays: 5,
      dependencies: [],
      isMilestone: false,
      isSummary: false,
    },
  };
  const sources = [
    project,
    schedule,
    documentSource({
      id: "canopy-plan-title",
      title: "Architectural drawings",
      excerpt: "Weather Protected Canopy Hazardous Material Plan",
      page: 15,
      sheet: "A-1.5A",
      region: "plan-title",
    }),
    documentSource({
      id: "canopy-area-one",
      title: "Architectural drawings",
      excerpt:
        "Containment Area 1: flammable/combustible and non-hazardous storage",
      page: 15,
      sheet: "A-1.5A",
      region: "area-one",
    }),
    documentSource({
      id: "canopy-area-two",
      title: "Architectural drawings",
      excerpt: "Containment Area 2: corrosive/toxic and non-hazardous storage",
      page: 15,
      sheet: "A-1.5A",
      region: "area-two",
    }),
    documentSource({
      id: "canopy-fire-code",
      title: "Architectural drawings",
      excerpt:
        "Hazardous material storage use or dispensing shall comply with California Fire Code Chapter 50.",
      page: 1,
      sheet: "A-0.0",
      region: "fire-code",
    }),
  ];
  const question =
    "Summarize the current 2321 hazardous-material canopy requirements and progress.";
  const projection = buildECOSDeterministicSynthesisAnswer({
    question,
    sources,
    snapshotCapturedAt: "2026-09-11T18:00:00Z",
  });
  if (!projection) throw new Error("canopy synthesis projection missing");
  const response = assureAnswer({
    proposed: {
      shortAnswer: projection.proposed.shortAnswer,
      facts: projection.proposed.facts.map((fact) => ({
        statement: fact.statement,
        classification: fact.classification,
        sourceIds: [...fact.sourceIds],
      })),
      limitations: [...projection.proposed.limitations],
      conflicts: [],
      suggestedQuestions: [...projection.proposed.suggestedQuestions],
    },
    sources: projection.selectedSources.map((source) => ({
      ...source,
      recordId: typeof (source as Record<string, unknown>).recordId === "string"
        ? (source as Record<string, unknown>).recordId as string
        : source.id,
    })) as unknown as Parameters<typeof assureAnswer>[0]["sources"],
    projectId: "project-2321",
    projectName: "2321 Compliance Project",
    question,
    model: "gpt-5.6-luna",
  });
  assertEquals(response.assurance.status, "verified_with_limits");
  assertEquals(response.assurance.rejectedFactCount, 0);
  if (!response.answer.includes("Weather Protected Canopy")) {
    throw new Error(`missing exact canopy plan identity: ${response.answer}`);
  }
  if (!response.answer.includes("California Fire Code Chapter 50")) {
    throw new Error(`missing substantive requirement: ${response.answer}`);
  }
  if (!response.answer.includes("Assessment:")) {
    throw new Error(`missing progress assessment: ${response.answer}`);
  }
  if (!response.answer.includes("Recommended action:")) {
    throw new Error(`missing recommendation: ${response.answer}`);
  }
  if (
    !response.supportingEvidence.some((source) =>
      source.sourceType === "document" &&
      source.documentCitation?.sheetNumber === "A-1.5A"
    )
  ) {
    throw new Error("exact A-1.5A proof was not retained");
  }
});

Deno.test("deterministic measurement owns variable model wording and limitations", () => {
  const source = documentSource({
    id: "ef1",
    title: "Mechanical drawing",
    excerpt:
      "Exhaust fan EF-1: 100 CFM; serves 4 restrooms and 1 janitor closet.",
    page: 2,
    sheet: "MB-1.2",
    region: "visual-1836",
  });
  const question =
    "How much air does EF-1 move and what rooms does it exhaust?";
  const first = assureAnswer({
    proposed: variableProposal([source.id], 1),
    sources: [source],
    projectId: "project-2321",
    projectName: "2321 Compliance Project",
    question,
    model: "gpt-5.6-luna",
  });
  const second = assureAnswer({
    proposed: variableProposal([source.id], 2),
    sources: [source],
    projectId: "project-2321",
    projectName: "2321 Compliance Project",
    question,
    model: "gpt-5.6-luna",
  });
  assertEquals(stableProjection(first), stableProjection(second));
  assertEquals(first.assurance.status, "verified");
  assertEquals(first.assurance.rejectedFactCount, 0);
});

Deno.test("customer measured-airflow wording returns design proof with a field limit", () => {
  const source = documentSource({
    id: "ef1-measured",
    title: "Mechanical drawing",
    excerpt:
      "Exhaust fan EF-1: 100 CFM; serves 4 restrooms and 1 janitor closet.",
    page: 2,
    sheet: "MB-1.2",
    region: "visual-1836",
  });
  const answer = assureAnswer({
    proposed: {
      shortAnswer: "No measured reading was found.",
      facts: [{
        statement: "No measured air-balance reading for EF-1 was found.",
        classification: "fact",
        sourceIds: [source.id],
      }],
      limitations: ["No field TAB report was found."],
      conflicts: [],
      suggestedQuestions: [],
    },
    sources: [source],
    projectId: "project-2321",
    projectName: "2321 Compliance Project",
    question: "What was the measured air-balance reading for EF-1?",
    model: "gpt-5.6-luna",
  });
  assertEquals(answer.assurance.status, "verified_with_limits");
  assertEquals(answer.supportingEvidence.length, 1);
  if (!/EF-1: 100 CFM/i.test(answer.answer)) {
    throw new Error(`missing design proof: ${answer.answer}`);
  }
  if (!/does not field-verify/i.test(answer.answer)) {
    throw new Error(`missing field limitation: ${answer.answer}`);
  }
});

Deno.test("drawing-only installed quantity owns variable model wording and proof", () => {
  const treeCount = documentSource({
    id: "landscape-tree-count",
    title: "Landscape drawing",
    excerpt:
      "DRAWING PAGE CONTEXT: Sheet L-1 — PARKING-LOT TREES PROVIDED: 78 TREES.",
    page: 1,
    sheet: "L-1",
    region: "visual-2974",
  });
  const species = documentSource({
    id: "landscape-tree-species",
    title: "Landscape drawing",
    excerpt:
      "DRAWING PAGE CONTEXT: Sheet L-4 — PLANTING PLAN. GOLDEN RAIN TREE AND PALO VERDE.",
    page: 4,
    sheet: "L-4",
    region: "visual-720",
  });
  const question = "Are all 78 planned trees installed at 2321?";
  const first = assureAnswer({
    proposed: {
      shortAnswer:
        "The plan lists tree species but field installation is unknown.",
      facts: [{
        statement:
          "The planting plan lists Golden Rain Tree and Palo Verde species.",
        classification: "fact" as const,
        sourceIds: [species.id],
      }],
      limitations: ["No photo-backed field count was found."],
      conflicts: ["The model proposed a conflict."],
      suggestedQuestions: ["Should I inspect the species list?"],
    },
    sources: [species, treeCount],
    projectId: "project-2321",
    projectName: "2321 Compliance Project",
    question,
    model: "gpt-5.6-luna",
  });
  const second = assureAnswer({
    proposed: {
      shortAnswer: "The drawing does not prove installation.",
      facts: [{
        statement: "The landscape drawing shows 78 trees provided.",
        classification: "fact" as const,
        sourceIds: [treeCount.id],
      }],
      limitations: [],
      conflicts: [],
      suggestedQuestions: [],
    },
    sources: [treeCount, species],
    projectId: "project-2321",
    projectName: "2321 Compliance Project",
    question,
    model: "gpt-5.6-sol",
  });
  assertEquals(stableProjection(first), stableProjection(second));
  assertEquals(first.assurance.status, "verified_with_limits");
  assertEquals(first.assurance.rejectedFactCount, 0);
  assertEquals(first.facts.length, 1);
  assertEquals(first.supportingEvidence.length, 1);
  assertEquals(
    first.supportingEvidence[0]?.documentCitation?.regionId,
    "visual-2974",
  );
});

Deno.test("natural-language installed tree questions use the L-1 plan count and answer No directly", () => {
  const treeCount = documentSource({
    id: "landscape-tree-count",
    title: "07 - PLZ CORP - 2321 THIRD STREET - LANDSCAPE",
    excerpt:
      "DRAWING PAGE CONTEXT: Sheet L-1 — PARKING-LOT TREES PROVIDED: 78 TREES.",
    page: 1,
    sheet: "L-1",
    region: "visual-2974",
  });
  const species = documentSource({
    id: "landscape-tree-species",
    title: "07 - PLZ CORP - 2321 THIRD STREET - LANDSCAPE",
    excerpt:
      "DRAWING PAGE CONTEXT: Sheet L-4 — PLANT MATERIAL. PALO VERDE: 12 TREES.",
    page: 4,
    sheet: "L-4",
    region: "visual-722",
  });
  for (
    const question of [
      "Are all 78 trees really installed at 2321?",
      "How many of the planned trees can ECOS confirm are in the ground?",
      "Can you verify from current records that all seventy-eight trees were planted?",
    ]
  ) {
    const result = assureAnswer({
      proposed: {
        shortAnswer: "Landscape Sheet L-4 specifies 12 Palo Verde trees.",
        facts: [{
          statement: "Landscape Sheet L-4 specifies 12 Palo Verde trees.",
          classification: "fact" as const,
          sourceIds: [species.id],
        }],
        limitations: [
          "The drawing verifies the design requirement, not field installation.",
        ],
        conflicts: [],
        suggestedQuestions: [],
      },
      sources: [species, treeCount],
      projectId: "project-2321",
      projectName: "2321 Compliance Project",
      question,
      model: "deepseek-v4-flash",
    });
    assertEquals(/^No\b/i.test(result.answer), true);
    assertEquals(/78 trees provided by the plan/i.test(result.answer), true);
    assertEquals(/does not verify or confirm/i.test(result.answer), true);
    assertEquals(result.facts.length, 1);
    assertEquals(result.facts[0]?.id, "fact-drawing-quantity-fallback");
    assertEquals(result.supportingEvidence.length, 1);
    assertEquals(
      result.supportingEvidence[0]?.documentCitation?.regionId,
      "visual-2974",
    );
  }
});

Deno.test("accepted field evidence is not replaced by drawing-only quantity fallback", () => {
  const treeCount = documentSource({
    id: "landscape-tree-count",
    title: "Landscape drawing",
    excerpt:
      "DRAWING PAGE CONTEXT: Sheet L-1 — PARKING-LOT TREES PROVIDED: 78 TREES.",
    page: 1,
    sheet: "L-1",
    region: "visual-2974",
  });
  for (
    const fieldStatement of [
      "A dated field update confirms all 78 planned trees were installed at 2321.",
      "A dated field update reports that only 74 of 78 planned trees were installed at 2321.",
    ]
  ) {
    const fieldUpdate = updateSource({
      id: `field-update-${fieldStatement.includes("only") ? "partial" : "all"}`,
      title: "Dated landscape field update",
      excerpt: fieldStatement,
    });
    const result = assureAnswer({
      proposed: {
        shortAnswer: fieldStatement,
        facts: [{
          statement: fieldStatement,
          classification: "fact" as const,
          sourceIds: [fieldUpdate.id],
        }],
        limitations: [],
        conflicts: [],
        suggestedQuestions: [],
      },
      sources: [treeCount, fieldUpdate],
      projectId: "project-2321",
      projectName: "2321 Compliance Project",
      question: "Are all 78 planned trees installed at 2321?",
      model: "gpt-5.6-terra",
    });
    assertEquals(result.facts[0]?.statement, fieldStatement);
    assertEquals(
      result.supportingEvidence.some((source) =>
        source.recordId === fieldUpdate.id
      ),
      true,
    );
  }
});

Deno.test("an update that only restates the plan does not prove installation", () => {
  const treeCount = documentSource({
    id: "landscape-tree-count",
    title: "Landscape drawing",
    excerpt:
      "DRAWING PAGE CONTEXT: Sheet L-1 — PARKING-LOT TREES PROVIDED: 78 TREES.",
    page: 1,
    sheet: "L-1",
    region: "visual-2974",
  });
  const planUpdate = updateSource({
    id: "plan-update",
    title: "Landscape coordination update",
    excerpt:
      "The current landscape plan says all 78 trees are to be installed at 2321.",
  });
  const result = assureAnswer({
    proposed: {
      shortAnswer: "The update confirms installation.",
      facts: [{
        statement:
          "A project update confirms all 78 planned trees were installed at 2321.",
        classification: "fact" as const,
        sourceIds: [planUpdate.id],
      }],
      limitations: [],
      conflicts: [],
      suggestedQuestions: [],
    },
    sources: [planUpdate, treeCount],
    projectId: "project-2321",
    projectName: "2321 Compliance Project",
    question: "Are all 78 planned trees installed at 2321?",
    model: "gpt-5.6-luna",
  });
  assertEquals(result.assurance.status, "verified_with_limits");
  assertEquals(result.assurance.rejectedFactCount, 0);
  assertEquals(result.facts.length, 1);
  assertEquals(result.facts[0]?.id, "fact-drawing-quantity-fallback");
  assertEquals(result.supportingEvidence.length, 1);
  assertEquals(
    result.supportingEvidence[0]?.documentCitation?.regionId,
    "visual-2974",
  );
});

Deno.test("deterministic area calculation owns variable model wording", () => {
  const source = documentSource({
    id: "canopy-a",
    title: "Canopy A drawing",
    excerpt:
      "ECOS VERIFIED PLAN-FOOTPRINT CALCULATION: 122'-0\" × 52'-0\" = 6,344 square feet.",
    page: 4,
    sheet: "WPA-4",
    region: "visual-296",
  });
  const question = "How many square feet is Canopy A?";
  const first = assureAnswer({
    proposed: variableProposal([source.id], 1),
    sources: [source],
    projectId: "project-2375",
    projectName: "2375 Compliance Project",
    question,
    model: "gpt-5.6-terra",
  });
  const second = assureAnswer({
    proposed: variableProposal([source.id], 2),
    sources: [source],
    projectId: "project-2375",
    projectName: "2375 Compliance Project",
    question,
    model: "gpt-5.6-terra",
  });
  assertEquals(stableProjection(first), stableProjection(second));
  assertEquals(first.assurance.status, "verified_with_limits");
  assertEquals(first.facts.length, 1);
});

Deno.test("complete Assurance keeps Canopy A, B, and C areas source-bound", () => {
  const sources = [
    documentSource({
      id: "canopy-a",
      title: "08A - Canopy 'A' drawing",
      excerpt:
        "ECOS VERIFIED PLAN-FOOTPRINT CALCULATION: 122'-0\" × 52'-0\" = 6,344 square feet.",
      page: 4,
      sheet: "WPA-4",
      region: "canopy-a-overall",
    }),
    documentSource({
      id: "canopy-b",
      title: "08B - Canopy 'B' drawing",
      excerpt:
        "ECOS VERIFIED PLAN-FOOTPRINT CALCULATION: 82'-0\" × 64'-0\" = 5,248 square feet.",
      page: 4,
      sheet: "WPR-4",
      region: "canopy-b-overall",
    }),
    documentSource({
      id: "canopy-c",
      title: "08C - Canopy 'C' drawing",
      excerpt:
        "ECOS VERIFIED PLAN-FOOTPRINT CALCULATION: 82'-0\" × 32'-0\" = 2,624 square feet.",
      page: 4,
      sheet: "WPR-4",
      region: "canopy-c-overall",
    }),
  ];
  for (
    const [identity, area, sourceId] of [
      ["A", "6,344", "canopy-a"],
      ["B", "5,248", "canopy-b"],
      ["C", "2,624", "canopy-c"],
    ] as const
  ) {
    const result = assureAnswer({
      proposed: variableProposal(sources.map((source) => source.id), 1),
      sources,
      projectId: "project-2375",
      projectName: "2375 Compliance Project",
      question: `What is the square footage for canopy ${identity}?`,
      model: "gpt-5.6-terra",
    });
    assertEquals(result.assurance.status, "verified_with_limits");
    assertEquals(result.facts.length, 1);
    assertEquals(result.facts[0]?.sourceIds, [sourceId]);
    if (!result.answer.includes(`${area} square feet`)) {
      throw new Error(
        `Canopy ${identity} answer used the wrong area: ${result.answer}`,
      );
    }
  }

  const wrongOnly = assureAnswer({
    proposed: {
      shortAnswer: "Canopy B is 6,344 square feet.",
      facts: [{
        statement: "Canopy B is 6,344 square feet.",
        classification: "fact",
        sourceIds: [sources[0].id],
      }],
      limitations: [],
      conflicts: [],
      suggestedQuestions: [],
    },
    sources: [sources[0]],
    projectId: "project-2375",
    projectName: "2375 Compliance Project",
    question: "What is the square footage for canopy B?",
    model: "gpt-5.6-terra",
  });
  assertEquals(wrongOnly.assurance.status, "insufficient_evidence");
  assertEquals(wrongOnly.facts.length, 0);
});

Deno.test("deterministic canopy lighting join owns wording, proof, and status", () => {
  const architectural = documentSource({
    id: "a17",
    title: "Architectural drawing",
    excerpt:
      "WEATHER-PROTECTED CANOPY. NEW LIGHT FIXTURE. SEE ELECTRICAL DRAWINGS FOR ADDITIONAL INFORMATION.",
    page: 14,
    sheet: "A-1.7",
    region: "page-text-0",
  });
  const electrical = documentSource({
    id: "e11",
    title: "Electrical drawing",
    excerpt: "EXTERIOR STORAGE LIGHTING PLAN.",
    page: 4,
    sheet: "E-1.1",
    region: "title-ocr-word-40",
  });
  const unrelated = documentSource({
    id: "e21",
    title: "Electrical drawing",
    excerpt: "OTHER LIGHTING PLAN.",
    page: 7,
    sheet: "E-2.1",
    region: "visual-unrelated",
  });
  const question = "Are there lights under the north-side canopies?";
  const first = assureAnswer({
    proposed: variableProposal([architectural.id, unrelated.id], 1),
    sources: [unrelated, electrical, architectural],
    projectId: "project-2375",
    projectName: "2375 Compliance Project",
    question,
    model: "gpt-5.6-sol",
  });
  const second = assureAnswer({
    proposed: variableProposal([architectural.id, electrical.id], 2),
    sources: [architectural, electrical, unrelated],
    projectId: "project-2375",
    projectName: "2375 Compliance Project",
    question,
    model: "gpt-5.6-sol",
  });
  assertEquals(stableProjection(first), stableProjection(second));
  assertEquals(first.assurance.status, "verified_with_limits");
  assertEquals(first.facts.length, 1);
  assertEquals(first.supportingEvidence.length, 2);
  const scheduled = assureAnswer({
    proposed: {
      shortAnswer: "The drawings show the canopy lighting requirement.",
      facts: [{
        statement:
          "The architectural canopy drawing shows a new light fixture and directs the field to the electrical lighting plan.",
        classification: "fact",
        sourceIds: [architectural.id, electrical.id],
      }],
      limitations: [],
      conflicts: [],
      suggestedQuestions: [],
    },
    sources: [architectural, electrical, unrelated],
    projectId: "project-2375",
    projectName: "2375 Compliance Project",
    question:
      "Are the canopy lights scheduled, and does that prove they are installed now?",
    model: "deepseek-v4-flash",
  });
  if (
    !/^Yes\./.test(scheduled.answer) || !/electrical/i.test(scheduled.answer)
  ) {
    throw new Error(
      `missing bounded canopy-lighting answer: ${scheduled.answer}`,
    );
  }
  if (
    !scheduled.limitations.some((limitation) =>
      /installation date|field status/i.test(limitation)
    )
  ) {
    throw new Error("missing canopy-lighting field-status limitation");
  }
});
