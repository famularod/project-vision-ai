import {
  ECOS_AGENT_MODEL_PROFILES,
  type ECOSAgentEvaluationObservation,
  isECOSAgentEvaluationModel,
  resolveECOSAgentOrchestrationMode,
  runECOSAgentModelEvaluation,
  summarizeECOSAgentModelEvaluation,
} from "./ecos-agent-model-evaluation.ts";

Deno.test("only explicitly approved private API model ids are valid", () => {
  assertEquals(isECOSAgentEvaluationModel("gpt-5.6-luna"), true);
  assertEquals(isECOSAgentEvaluationModel("gpt-5.6-terra"), true);
  assertEquals(isECOSAgentEvaluationModel("gpt-5.6-sol"), true);
  assertEquals(isECOSAgentEvaluationModel("deepseek-v4-flash"), true);
  assertEquals(isECOSAgentEvaluationModel("deepseek-flash"), false);
  assertEquals(isECOSAgentEvaluationModel("gpt-6-astra"), false);
  assertEquals(isECOSAgentEvaluationModel("unknown"), false);
});

Deno.test("protected model evaluation selects the private agent without a project secret", () => {
  assertEquals(
    resolveECOSAgentOrchestrationMode({
      evaluationModel: "gpt-5.6-luna",
      environmentMode: "",
    }),
    "private_read_only_v1",
  );
  assertEquals(
    resolveECOSAgentOrchestrationMode({
      evaluationModel: "",
      environmentMode: "private_read_only_v1",
    }),
    "private_read_only_v1",
  );
  assertEquals(
    resolveECOSAgentOrchestrationMode({
      evaluationModel: "",
      environmentMode: "unexpected",
    }),
    "single_pass",
  );
});

Deno.test("model evaluation runs the identical case matrix for every model", async () => {
  const calls: string[] = [];
  const report = await runECOSAgentModelEvaluation({
    models: ECOS_AGENT_MODEL_PROFILES,
    cases: [
      { id: "answer-1", expectedDisposition: "answer" },
      { id: "refuse-1", expectedDisposition: "refuse" },
    ],
    repetitions: 2,
    runCase: (model, evaluationCase, repetition) => {
      calls.push(`${model}:${evaluationCase.id}:${repetition}`);
      return Promise.resolve(observation({
        model,
        caseId: evaluationCase.id,
        repetition,
        expectedDisposition: evaluationCase.expectedDisposition,
        actualDisposition: evaluationCase.expectedDisposition,
        answerFingerprint: `${evaluationCase.id}-stable`,
      }));
    },
  });
  assertEquals(calls.length, 12);
  assertEquals(report.observations.length, 12);
  assertEquals(report.scores.length, 3);
  assertEquals(report.recommendedModel, "gpt-5.6-luna");
});

Deno.test("quality and safety gates outrank a cheaper unreliable model", () => {
  const observations: ECOSAgentEvaluationObservation[] = [
    observation({
      model: "gpt-5.6-luna",
      caseId: "answer-1",
      expectedDisposition: "answer",
      actualDisposition: "failed",
      correct: false,
      citationsOpenable: false,
      answerFingerprint: null,
      errorCode: "provider_failed",
    }),
    observation({
      model: "gpt-5.6-terra",
      caseId: "answer-1",
      expectedDisposition: "answer",
      actualDisposition: "answer",
      answerFingerprint: "correct",
    }),
    observation({
      model: "gpt-5.6-terra",
      caseId: "refuse-1",
      expectedDisposition: "refuse",
      actualDisposition: "refuse",
      answerFingerprint: "safe-refusal",
    }),
    observation({
      model: "gpt-5.6-sol",
      caseId: "answer-1",
      expectedDisposition: "answer",
      actualDisposition: "answer",
      answerFingerprint: "correct",
    }),
    observation({
      model: "gpt-5.6-sol",
      caseId: "refuse-1",
      expectedDisposition: "refuse",
      actualDisposition: "refuse",
      answerFingerprint: "safe-refusal",
    }),
  ];
  const report = summarizeECOSAgentModelEvaluation(
    ECOS_AGENT_MODEL_PROFILES,
    observations,
  );
  assertEquals(report.recommendedModel, "gpt-5.6-terra");
  assertEquals(report.scores.at(-1)?.model, "gpt-5.6-luna");
});

Deno.test("cost includes cached input and every model turn", () => {
  const report = summarizeECOSAgentModelEvaluation(
    [ECOS_AGENT_MODEL_PROFILES[0]],
    [observation({
      model: "gpt-5.6-luna",
      caseId: "answer-1",
      expectedDisposition: "answer",
      actualDisposition: "answer",
      answerFingerprint: "correct",
      usage: {
        inputTokens: 1_000_000,
        cachedInputTokens: 500_000,
        outputTokens: 1_000_000,
        reasoningTokens: 100,
        totalTokens: 2_000_000,
      },
    })],
  );
  assertEquals(report.scores[0]?.estimatedCostUsd, 1.31);
});

function observation(
  overrides: Partial<ECOSAgentEvaluationObservation>,
): ECOSAgentEvaluationObservation {
  return {
    model: "gpt-5.6-terra",
    caseId: "case-1",
    repetition: 1,
    expectedDisposition: "answer",
    actualDisposition: "answer",
    correct: true,
    citationsOpenable: true,
    projectIsolationPreserved: true,
    answerFingerprint: "stable-answer",
    elapsedMs: 1_000,
    modelTurns: 2,
    toolCalls: 2,
    usage: {
      inputTokens: 1_000,
      cachedInputTokens: 0,
      outputTokens: 100,
      reasoningTokens: 20,
      totalTokens: 1_100,
    },
    errorCode: null,
    ...overrides,
  };
}

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}
