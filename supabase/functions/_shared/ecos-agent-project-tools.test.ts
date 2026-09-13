import {
  createECOSAgentProjectToolRegistry,
  type ECOSAgentProjectSource,
} from "./ecos-agent-project-tools.ts";
import {
  type ECOSAgentModelGateway,
  type ECOSAgentModelTurn,
  runECOSReadOnlyAgent,
} from "./ecos-read-only-agent.ts";

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["shortAnswer"],
  properties: { shortAnswer: { type: "string" } },
};

const candidates: ECOSAgentProjectSource[] = [
  {
    id: "schedule:1",
    sourceType: "schedule",
    title: "North lot concrete paving",
    excerpt: "Six inch PCC paving is scheduled on the north side.",
    updatedAt: "2026-09-10T12:00:00Z",
    score: 0.5,
    scheduleData: {
      taskName: "North lot concrete paving",
      itemType: "Task",
      locationName: "North Lot",
      status: "Not Started",
      percentComplete: 0,
      startDate: "09/15/2026",
      finishDate: "09/17/2026",
      baselineStartDate: "09/14/2026",
      baselineFinishDate: "09/16/2026",
      wbsCode: "1.2.3",
      durationDays: 3,
      dependencies: ["A100 FS 0"],
      isMilestone: false,
      isSummary: false,
    },
  },
  {
    id: "schedule:3",
    sourceType: "schedule",
    title: "Form and place footings",
    excerpt:
      "Task: Form and place footings. Location: South Lot. Status: In Progress. Start: 09/11/2026. Finish: 09/18/2026.",
    updatedAt: "2026-09-10T13:00:00Z",
    score: 0.4,
    scheduleData: {
      taskName: "Form and place footings",
      itemType: "Task",
      locationName: "South Lot",
      status: "In Progress",
      percentComplete: 50,
      startDate: "09/11/2026",
      finishDate: "09/18/2026",
      baselineStartDate: null,
      baselineFinishDate: null,
      wbsCode: "1.2.4",
      durationDays: 6,
      dependencies: [],
      isMilestone: false,
      isSummary: false,
    },
  },
  {
    id: "memory:2",
    sourceType: "memory",
    title: "South warehouse note",
    excerpt: "Door preparation continues.",
    updatedAt: "2026-09-09T12:00:00Z",
    score: 0.9,
  },
];

Deno.test("project tools expose inventory as metadata, not answer evidence", async () => {
  const registry = createRegistry();
  const tool = requiredTool(
    registry.tools,
    "inspect_project_evidence_inventory",
  );
  assertEquals(tool.providesEvidence, false);
  const result = await tool.execute({}, {
    signal: new AbortController().signal,
  });
  assertEquals((result as { candidateCount: number }).candidateCount, 3);
  assertEquals(registry.researchSources().length, 0);
});

Deno.test("snapshot search reranks authorized sources using the tool query", async () => {
  const registry = createRegistry();
  const tool = requiredTool(registry.tools, "search_project_evidence");
  assertEquals(tool.providesEvidence, true);
  const result = await tool.execute({
    query: "How thick is the cement on the north lot?",
    sourceTypes: null,
    limit: 8,
  }, { signal: new AbortController().signal }) as {
    matches: Array<{ id: string }>;
  };
  assertEquals(result.matches[0]?.id, "schedule:1");
  assertEquals(registry.researchSources().map((source) => source.id), [
    "schedule:1",
    "schedule:3",
  ]);
});

Deno.test("fresh document search is bounded to one call and makes results openable", async () => {
  let calls = 0;
  const documentSource: ECOSAgentProjectSource = {
    id: "document:page-7",
    sourceType: "document",
    title: "Civil plan page 7",
    excerpt: "PCC pavement shall be 6 inches thick.",
    updatedAt: "2026-09-10T12:00:00Z",
    score: 2,
    documentCitation: { documentId: "document-1", pageNumber: 7 },
  };
  const registry = createRegistry(() => {
    calls += 1;
    return Promise.resolve({
      sources: [documentSource],
      semanticAvailable: true,
      matchedPageCount: 1,
    });
  });
  const search = requiredTool(
    registry.tools,
    "search_current_project_documents",
  );
  assertEquals(search.providesEvidence, true);
  for (let index = 0; index < 4; index += 1) {
    await search.execute({ query: `north lot concrete ${index}`, limit: 8 }, {
      signal: new AbortController().signal,
    });
  }
  assertEquals(calls, 1);
  const open = requiredTool(registry.tools, "open_project_evidence");
  assertEquals(open.providesEvidence, true);
  const opened = await open.execute({ sourceIds: [documentSource.id] }, {
    signal: new AbortController().signal,
  }) as { openedSourceCount: number; sources: Array<{ id: string }> };
  assertEquals(opened.openedSourceCount, 1);
  assertEquals(opened.sources[0]?.id, documentSource.id);
  assertEquals(registry.researchSources().map((source) => source.id), [
    documentSource.id,
  ]);
});

Deno.test("responsive snapshot evidence prevents a redundant fresh document search", async () => {
  let calls = 0;
  const documentSource: ECOSAgentProjectSource = {
    id: "document:north-lot",
    sourceType: "document",
    title: "Civil plan north lot",
    excerpt: "North lot concrete paving is shown on the civil plan.",
    updatedAt: "2026-09-10T12:00:00Z",
    score: 2,
    documentCitation: { documentId: "document-1", pageNumber: 7 },
  };
  const registry = createRegistry(() => {
    calls += 1;
    return Promise.resolve({
      sources: [] as ECOSAgentProjectSource[],
      semanticAvailable: true,
      matchedPageCount: 0,
    });
  }, [...candidates, documentSource]);
  const snapshotSearch = requiredTool(
    registry.tools,
    "search_project_evidence",
  );
  const snapshot = await snapshotSearch.execute({
    query: "north lot concrete",
    sourceTypes: null,
    limit: 8,
  }, { signal: new AbortController().signal }) as {
    matches: Array<{ id: string }>;
  };
  assertEquals(snapshot.matches.length > 0, true);

  const freshSearch = requiredTool(
    registry.tools,
    "search_current_project_documents",
  );
  const fresh = await freshSearch.execute({
    query: "north lot concrete thickness",
    limit: 8,
  }, { signal: new AbortController().signal }) as {
    matches: Array<{ id: string }>;
    error: string;
  };
  assertEquals(fresh, {
    matches: [],
    error: "responsive_snapshot_evidence_already_available",
  });
  assertEquals(calls, 0);
});

Deno.test("weak snapshot overlap still permits one broader fresh document search", async () => {
  let calls = 0;
  const weakDocumentSource: ECOSAgentProjectSource = {
    id: "document:weak",
    sourceType: "document",
    title: "General project notes",
    excerpt: "Concrete coordination note.",
    updatedAt: "2026-09-10T12:00:00Z",
    score: 0.1,
    documentCitation: { documentId: "document-weak", pageNumber: 1 },
  };
  const registry = createRegistry(() => {
    calls += 1;
    return Promise.resolve({
      sources: [] as ECOSAgentProjectSource[],
      semanticAvailable: true,
      matchedPageCount: 0,
    });
  }, [weakDocumentSource]);
  const snapshotSearch = requiredTool(
    registry.tools,
    "search_project_evidence",
  );
  const snapshot = await snapshotSearch.execute({
    query: "north lot concrete drawings",
    sourceTypes: ["document"],
    limit: 8,
  }, { signal: new AbortController().signal }) as {
    matches: Array<{ id: string }>;
  };
  assertEquals(snapshot.matches.length, 1);

  const freshSearch = requiredTool(
    registry.tools,
    "search_current_project_documents",
  );
  await freshSearch.execute({
    query: "north lot lighting electrical civil",
    limit: 8,
  }, { signal: new AbortController().signal });
  assertEquals(calls, 1);
});

Deno.test("snapshot evidence search is bounded to two materially different queries", async () => {
  const registry = createRegistry();
  const search = requiredTool(registry.tools, "search_project_evidence");
  const results = [];
  for (let index = 0; index < 3; index += 1) {
    results.push(
      await search.execute({
        query: `north lot concrete ${index}`,
        sourceTypes: null,
        limit: 8,
      }, { signal: new AbortController().signal }),
    );
  }
  assertEquals(
    (results[2] as { error: string }).error,
    "snapshot_search_budget_reached",
  );
});

Deno.test("schedule tool filters and sorts the complete authorized snapshot", async () => {
  const registry = createRegistry();
  const tool = requiredTool(
    registry.tools,
    "list_project_schedule_activities",
  );
  const result = await tool.execute({
    taskQuery: null,
    locationQuery: "lot",
    statuses: ["Not Started", "In Progress"],
    startOnOrAfter: "2026-09-10",
    startOnOrBefore: null,
    sortBy: "start_ascending",
    limit: 25,
  }, { signal: new AbortController().signal }) as {
    snapshotCapturedAt: string;
    matchingCount: number;
    truncated: boolean;
    matches: Array<{ id: string; schedule: { startDate: string } }>;
  };
  assertEquals(result.matchingCount, 2);
  assertEquals(result.snapshotCapturedAt, "2026-09-10T14:00:00Z");
  assertEquals(result.truncated, false);
  assertEquals(result.matches.map((source) => source.id), [
    "schedule:3",
    "schedule:1",
  ]);
  assertEquals(result.matches[0]?.schedule.startDate, "09/11/2026");
  assertEquals(registry.researchSources().map((source) => source.id), [
    "schedule:3",
    "schedule:1",
  ]);
});

Deno.test("schedule tool preserves complete results when the model asks for too few", async () => {
  const registry = createRegistry();
  const tool = requiredTool(
    registry.tools,
    "list_project_schedule_activities",
  );
  const result = await tool.execute({
    taskQuery: null,
    locationQuery: "lot",
    statuses: null,
    startOnOrAfter: null,
    startOnOrBefore: null,
    sortBy: "task_name_ascending",
    limit: 1,
  }, { signal: new AbortController().signal }) as {
    matchingCount: number;
    returnedCount: number;
    truncated: boolean;
  };
  assertEquals(result.matchingCount, 2);
  assertEquals(result.returnedCount, 2);
  assertEquals(result.truncated, false);
});

Deno.test("schedule tool caps results at 25 and discloses truncation", async () => {
  const many = Array.from({ length: 30 }, (_, index) => ({
    ...candidates[0],
    id: `schedule:bounded-${String(index).padStart(2, "0")}`,
    title: `Bounded activity ${String(index).padStart(2, "0")}`,
    scheduleData: {
      ...candidates[0].scheduleData!,
      taskName: `Bounded activity ${String(index).padStart(2, "0")}`,
    },
  }));
  const registry = createRegistry(undefined, many);
  const tool = requiredTool(
    registry.tools,
    "list_project_schedule_activities",
  );
  const result = await tool.execute({
    taskQuery: "bounded activity",
    locationQuery: null,
    statuses: null,
    startOnOrAfter: null,
    startOnOrBefore: null,
    sortBy: "task_name_ascending",
    limit: 3,
  }, { signal: new AbortController().signal }) as {
    matchingCount: number;
    returnedCount: number;
    truncated: boolean;
    filters: { requestedLimit: number; appliedLimit: number };
  };
  assertEquals(result.matchingCount, 30);
  assertEquals(result.returnedCount, 25);
  assertEquals(result.truncated, true);
  assertEquals(result.filters.requestedLimit, 3);
  assertEquals(result.filters.appliedLimit, 25);
});

Deno.test("schedule tool treats empty statuses as all and rejects invalid dates", async () => {
  const registry = createRegistry();
  const tool = requiredTool(
    registry.tools,
    "list_project_schedule_activities",
  );
  const all = await tool.execute({
    taskQuery: null,
    locationQuery: "lot",
    statuses: [],
    startOnOrAfter: null,
    startOnOrBefore: null,
    sortBy: "start_ascending",
    limit: 25,
  }, { signal: new AbortController().signal }) as {
    matchingCount: number;
  };
  assertEquals(all.matchingCount, 2);
  const invalid = await tool.execute({
    taskQuery: null,
    locationQuery: null,
    statuses: null,
    startOnOrAfter: "09/10/2026",
    startOnOrBefore: null,
    sortBy: "start_ascending",
    limit: 25,
  }, { signal: new AbortController().signal }) as { error: string };
  assertEquals(invalid.error, "invalid_schedule_date");
});

Deno.test("progress tool returns only photo-backed updates at the requested location", async () => {
  const progressCandidates: ECOSAgentProjectSource[] = [
    progressSource("update:1", {
      taskName: "INSTALL TEMPORARY FENCING",
      locationName: "2321 South Lot",
      occurredAt: "2026-08-11",
      photoCount: 1,
    }),
    progressSource("update:2", {
      taskName: "INSTALL TEMPORARY FENCING",
      locationName: "2321 South Lot",
      occurredAt: "2026-08-12",
      photoCount: 0,
    }),
    progressSource("update:3", {
      taskName: "NORTH LOT WORK",
      locationName: "2321 North Lot",
      occurredAt: "2026-08-13",
      photoCount: 2,
    }),
  ];
  const registry = createRegistry(undefined, progressCandidates);
  const tool = requiredTool(registry.tools, "list_project_progress_records");
  const result = await tool.execute({
    taskQuery: null,
    locationQuery: "2321 South Lot",
    recordKinds: ["update"],
    statuses: null,
    photosOnly: true,
    sortBy: "occurred_ascending",
    limit: 1,
  }, { signal: new AbortController().signal }) as {
    matchingCount: number;
    returnedCount: number;
    truncated: boolean;
    matches: Array<{ id: string; progress: { photoCount: number } }>;
  };
  assertEquals(result.matchingCount, 1);
  assertEquals(result.returnedCount, 1);
  assertEquals(result.truncated, false);
  assertEquals(result.matches[0]?.id, "update:1");
  assertEquals(result.matches[0]?.progress.photoCount, 1);
});

Deno.test("progress tool matches project-qualified locations and excludes resolved issues", async () => {
  const progressCandidates: ECOSAgentProjectSource[] = [
    progressSource("memory:open", {
      recordKind: "memory",
      locationName: "North Lot",
      status: "open",
      observation: "Fire lane markings are needed.",
    }),
    progressSource("memory:resolved", {
      recordKind: "memory",
      locationName: "2375 North Lot",
      status: "resolved",
      observation: "Guardrails were resolved.",
    }),
    progressSource("memory:other", {
      recordKind: "memory",
      locationName: "Canopy A",
      status: "open",
      observation: "Replace a damaged cover.",
    }),
  ];
  const registry = createRegistry(undefined, progressCandidates);
  const tool = requiredTool(registry.tools, "list_project_progress_records");
  const result = await tool.execute({
    taskQuery: null,
    locationQuery: "2375 North Lot",
    recordKinds: ["memory"],
    statuses: ["open"],
    photosOnly: false,
    sortBy: "occurred_descending",
    limit: 25,
  }, { signal: new AbortController().signal }) as {
    matchingCount: number;
    matches: Array<{ id: string }>;
  };
  assertEquals(result.matchingCount, 1);
  assertEquals(result.matches.map((source) => source.id), ["memory:open"]);
});

Deno.test("exact search results authorize an answer without a duplicate open", async () => {
  const registry = createRegistry();
  const searchOnly = await runECOSReadOnlyAgent({
    gateway: queuedGateway([
      modelTurn("search_project_evidence", "search-1", {
        query: "north lot paving",
        sourceTypes: null,
        limit: 8,
      }),
      answerTurn("Six inches."),
    ]),
    instructions: "Research and open evidence before answering.",
    inputItems: [{ role: "user", content: "Question" }],
    tools: registry.tools,
    outputSchemaName: "answer",
    outputSchema: OUTPUT_SCHEMA,
  });
  assertEquals(searchOnly.status, "completed");
  assertEquals(searchOnly.successfulResearchCalls, 1);

  const registryWithOpen = createRegistry();
  const opened = await runECOSReadOnlyAgent({
    gateway: queuedGateway([
      modelTurn("search_project_evidence", "search-2", {
        query: "north lot paving",
        sourceTypes: null,
        limit: 8,
      }),
      modelTurn("open_project_evidence", "open-1", {
        sourceIds: ["schedule:1"],
      }),
      answerTurn("Six inches."),
    ]),
    instructions: "Research and open evidence before answering.",
    inputItems: [{ role: "user", content: "Question" }],
    tools: registryWithOpen.tools,
    outputSchemaName: "answer",
    outputSchema: OUTPUT_SCHEMA,
  });
  assertEquals(opened.status, "completed");
  assertEquals(opened.successfulResearchCalls, 2);
});

Deno.test("an empty exact search cannot authorize an answer", async () => {
  const registry = createRegistry();
  const result = await runECOSReadOnlyAgent({
    gateway: queuedGateway([
      modelTurn("search_project_evidence", "search-empty", {
        query: "evidence that does not exist",
        sourceTypes: ["document"],
        limit: 8,
      }),
      answerTurn("Unsupported answer."),
      answerTurn("Still unsupported."),
    ]),
    instructions: "Use exact project evidence.",
    inputItems: [{ role: "user", content: "Question" }],
    tools: registry.tools,
    outputSchemaName: "answer",
    outputSchema: OUTPUT_SCHEMA,
  });
  assertEquals(result.status, "failed");
  assertEquals(result.errorCode, "agent_research_required");
});

function createRegistry(
  searchCurrentDocuments = () =>
    Promise.resolve({
      sources: [] as ECOSAgentProjectSource[],
      semanticAvailable: true,
      matchedPageCount: 0,
    }),
  registryCandidates: readonly ECOSAgentProjectSource[] = candidates,
) {
  return createECOSAgentProjectToolRegistry({
    candidates: registryCandidates,
    inventory: {
      sourceCounts: { tasks: 2, field_notes: 1 },
      unavailableChannels: [],
      limitations: [],
      candidateCount: registryCandidates.length,
    },
    snapshotCapturedAt: "2026-09-10T14:00:00Z",
    searchCurrentDocuments,
  });
}

function progressSource(
  id: string,
  overrides: Partial<NonNullable<ECOSAgentProjectSource["progressData"]>>,
): ECOSAgentProjectSource {
  const progressData = {
    recordKind: "update" as const,
    taskName: "Project task",
    locationName: "Main Building",
    status: null,
    occurredAt: "2026-09-10T12:00:00Z",
    notes: null,
    observation: null,
    actionKind: null,
    actionText: null,
    photoCount: 0,
    photoSummaries: [] as string[],
    ...overrides,
  };
  return {
    id,
    sourceType: progressData.recordKind,
    title: progressData.taskName || "Field note",
    excerpt: [
      `Task: ${progressData.taskName || ""}`,
      `Location: ${progressData.locationName || ""}`,
      `Status: ${progressData.status || ""}`,
      `Observation: ${progressData.observation || ""}`,
      `Photo count: ${progressData.photoCount}`,
    ].join(". "),
    updatedAt: progressData.occurredAt,
    score: 1,
    progressData,
  };
}

function requiredTool(
  tools: ReturnType<typeof createRegistry>["tools"],
  name: string,
) {
  const tool = tools.find((item) => item.name === name);
  if (!tool) throw new Error(`missing tool ${name}`);
  return tool;
}

function modelTurn(
  name: string,
  callId: string,
  args: Record<string, unknown>,
): ECOSAgentModelTurn {
  return {
    outputItems: [{ type: "function_call", call_id: callId }],
    toolCalls: [{ callId, name, argumentsJson: JSON.stringify(args) }],
    outputText: null,
    usage: null,
  };
}

function answerTurn(shortAnswer: string): ECOSAgentModelTurn {
  return {
    outputItems: [],
    toolCalls: [],
    outputText: JSON.stringify({ shortAnswer }),
    usage: null,
  };
}

function queuedGateway(turns: ECOSAgentModelTurn[]): ECOSAgentModelGateway {
  let index = 0;
  return {
    complete: () => {
      const value = turns[index++];
      if (!value) throw new Error("unexpected_model_turn");
      return Promise.resolve(value);
    },
  };
}

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}
