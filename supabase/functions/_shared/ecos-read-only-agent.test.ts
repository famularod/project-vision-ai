import {
  createOpenAIResponsesAgentGateway,
  ecosAgentFailureResponse,
  type ECOSAgentModelGateway,
  type ECOSAgentModelTurn,
  type ECOSAgentTool,
  runECOSReadOnlyAgent,
} from "./ecos-read-only-agent.ts";
import { parseECOSAgentExecutionLimits, ECOS_AGENT_LIMITS_CONTRACT } from "./ecos-agent-telemetry.ts";

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["shortAnswer"],
  properties: { shortAnswer: { type: "string" } },
};

Deno.test("provider failures stay distinct from evidence and user authentication failures", async () => {
  for (const status of [401, 402, 429, 502, 503, 504]) {
    const code = `agent_provider_http_${status}`;
    const result = await runECOSReadOnlyAgent({
      gateway: { complete: () => { throw new Error(code); } },
      instructions: "Use authorized evidence.", inputItems: [{ role: "user", content: "Q" }],
      tools: [], outputSchemaName: "answer", outputSchema: OUTPUT_SCHEMA,
    });
    assertEquals(result.errorCode, code);
    assertEquals(result.modelTurns, 0);
    assertEquals(ecosAgentFailureResponse(code), {status:503,error:"answer_provider_unavailable"});
  }
  assertEquals(ecosAgentFailureResponse("agent_deadline_exceeded"), {status:503,error:"answer_timed_out"});
  assertEquals(ecosAgentFailureResponse("agent_research_required"), {status:502,error:"answer_invalid"});
  assertEquals(ecosAgentFailureResponse("agent_research_unavailable"), {status:503,error:"answer_research_unavailable"});
  assertEquals(ecosAgentFailureResponse("private credential or document text"), {status:502,error:"answer_invalid"});
});

const SEARCH_TOOL: ECOSAgentTool = Object.freeze({
  name: "search_project_evidence",
  description: "Search authorized project evidence.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["query"],
    properties: { query: { type: "string" } },
  },
  progressStage: "searching",
  providesEvidence: true,
  execute: (input) => ({
    matches: [{ id: "document:1", text: input.query }],
  }),
});

Deno.test("server first research uses the real tool and appears before the first model turn", async () => {
  let searches=0;
  const result=await runECOSReadOnlyAgent({
    gateway:{complete:async request=>{
      assertEquals(searches,1);
      assertEquals(request.toolChoice,"auto");
      const items=request.inputItems as Array<Record<string,unknown>>;
      assertEquals(items[0].type,"function_call");
      assertEquals(items[1].type,"function_call_output");
      assertEquals(JSON.parse(String(items[1].output)).result.matches[0].text,"Complete original question");
      return turn({outputText:'{"shortAnswer":"Supported answer."}'});
    }},instructions:"Use evidence",inputItems:[],
    initialResearchCall:{name:SEARCH_TOOL.name,arguments:{query:"Complete original question"}},
    tools:[{...SEARCH_TOOL,execute:input=>{searches++;return SEARCH_TOOL.execute(input,{signal:new AbortController().signal});}}],
    outputSchemaName:"answer",outputSchema:OUTPUT_SCHEMA,
  });
  assertEquals(result.status,"completed");
  assertEquals(result.modelTurns,1);
  assertEquals(result.toolCalls,1);
  assertEquals(result.successfulResearchCalls,1);
  assertEquals(result.trace[0].status,"completed");
});

Deno.test("server first research consumes the shared tool budget", async () => {
  const result=await runECOSReadOnlyAgent({
    gateway:queuedGateway([turn({toolCalls:[{callId:"later",name:SEARCH_TOOL.name,argumentsJson:'{"query":"another search"}'}]})]),
    instructions:"Use evidence",inputItems:[],tools:[SEARCH_TOOL],
    initialResearchCall:{name:SEARCH_TOOL.name,arguments:{query:"original"}},
    outputSchemaName:"answer",outputSchema:OUTPUT_SCHEMA,limits:{maxToolCalls:1},
  });
  assertEquals(result.errorCode,"agent_tool_call_limit_reached");
  assertEquals(result.toolCalls,1);
});

Deno.test("empty bootstrap research does not authorize an answer", async () => {
  const result=await runECOSReadOnlyAgent({
    gateway:{complete:async request=>{
      assertEquals(request.toolChoice,"required");
      throw new Error("stop_after_inspection");
    }},instructions:"Use evidence",inputItems:[],
    tools:[{...SEARCH_TOOL,execute:()=>({matches:[]}),qualifiesAsEvidence:()=>false}],
    initialResearchCall:{name:SEARCH_TOOL.name,arguments:{query:"original"}},
    outputSchemaName:"answer",outputSchema:OUTPUT_SCHEMA,
  });
  assertEquals(result.successfulResearchCalls,0);
  assertEquals(result.status,"failed");
});

Deno.test("approved advanced profile executes eight rounds and sixteen research actions without clamping", async () => {
  const limits = parseECOSAgentExecutionLimits({ schemaVersion: ECOS_AGENT_LIMITS_CONTRACT, maxModelTurns: 8, maxToolCalls: 16, maxElapsedMs: 75_000, maxToolElapsedMs: 15_000, maxToolOutputBytes: 48_000, maxOutputTokens: 4_000 });
  let completed = 0;
  const distribution = [3, 3, 2, 2, 2, 2, 2];
  const result = await runECOSReadOnlyAgent({
    gateway: { complete: async (request) => {
      assertEquals(request.maxOutputTokens, 4_000);
      const index = completed++;
      return index < 7 ? turn({ toolCalls: Array.from({ length: distribution[index] }, (_, item) => ({ callId: `${index}-${item}`, name: SEARCH_TOOL.name, argumentsJson: JSON.stringify({ query: `distinct detail ${index}-${item}` }) })) }) : turn({ outputText: '{"shortAnswer":"Complete supported answer."}' });
    } },
    instructions: "Use authorized evidence.", inputItems: [], tools: [SEARCH_TOOL], outputSchemaName: "answer", outputSchema: OUTPUT_SCHEMA, limits,
  });
  assertEquals(result.status, "completed");
  assertEquals(result.modelTurns, 8);
  assertEquals(result.toolCalls, 16);
  assertEquals(result.successfulResearchCalls, 16);
});

Deno.test("read-only agent researches before returning a structured answer", async () => {
  const requests: unknown[] = [];
  const gateway = queuedGateway([
    turn({
      outputItems: [{
        type: "function_call",
        call_id: "call-1",
        name: "search_project_evidence",
        arguments: JSON.stringify({ query: "north lot concrete thickness" }),
      }],
      toolCalls: [{
        callId: "call-1",
        name: "search_project_evidence",
        argumentsJson: JSON.stringify({
          query: "north lot concrete thickness",
        }),
      }],
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        total_tokens: 120,
        input_tokens_details: { cached_tokens: 40 },
        output_tokens_details: { reasoning_tokens: 8 },
      },
    }),
    turn({
      outputItems: [{
        type: "message",
        content: [{
          type: "output_text",
          text: JSON.stringify({ shortAnswer: "Six inches." }),
        }],
      }],
      outputText: JSON.stringify({ shortAnswer: "Six inches." }),
      usage: {
        input_tokens: 200,
        output_tokens: 30,
        total_tokens: 230,
        input_tokens_details: { cached_tokens: 60 },
        output_tokens_details: { reasoning_tokens: 12 },
      },
    }),
  ], requests);

  const result = await runECOSReadOnlyAgent({
    gateway,
    instructions: "Use the tools.",
    inputItems: [{ role: "user", content: "Question" }],
    tools: [SEARCH_TOOL],
    outputSchemaName: "answer",
    outputSchema: OUTPUT_SCHEMA,
  });

  assertEquals(result.status, "completed");
  assertEquals(result.successfulResearchCalls, 1);
  assertEquals(result.toolCalls, 1);
  assertEquals(result.modelTurns, 2);
  assertEquals(result.usage, {
    inputTokens: 300,
    cachedInputTokens: 100,
    outputTokens: 50,
    reasoningTokens: 20,
    totalTokens: 350,
  });
  assert(/^[a-f0-9]{64}$/.test(result.trace[0]?.outputSha256 || ""));
  assertEquals(
    JSON.parse(result.outputText || "{}").shortAnswer,
    "Six inches.",
  );
  assertEquals(
    (requests[0] as { toolChoice?: string }).toolChoice,
    "required",
  );
  assertEquals(
    (requests[1] as { toolChoice?: string }).toolChoice,
    "auto",
  );
  const secondInput = (requests[1] as { inputItems: unknown[] }).inputItems;
  assert(
    secondInput.some((item) =>
      isRecord(item) && item.type === "function_call_output" &&
      typeof item.output === "string" && item.output.includes("document:1")
    ),
  );
});

Deno.test("read-only agent rejects an answer produced without research", async () => {
  const requests: Array<{ instructions?: string }> = [];
  const result = await runECOSReadOnlyAgent({
    gateway: queuedGateway([
      turn({ outputText: JSON.stringify({ shortAnswer: "Guess" }) }),
      turn({ outputText: JSON.stringify({ shortAnswer: "Still a guess" }) }),
    ], requests),
    instructions: "Use the tools.",
    inputItems: [{ role: "user", content: "Question" }],
    tools: [SEARCH_TOOL],
    outputSchemaName: "answer",
    outputSchema: OUTPUT_SCHEMA,
  });
  assertEquals(result.status, "failed");
  assertEquals(result.errorCode, "agent_research_required");
  assert(
    requests[1]?.instructions?.includes(
      "did not use an authorized project research tool",
    ) === true,
  );
});

Deno.test("read-only agent gives one bounded reminder before allowing a grounded answer", async () => {
  const requests: Array<{ instructions?: string }> = [];
  const result = await runECOSReadOnlyAgent({
    gateway: queuedGateway([
      turn({ outputText: JSON.stringify({ shortAnswer: "Premature" }) }),
      turn({
        outputItems: [{ type: "function_call" }],
        toolCalls: [{
          callId: "call-after-reminder",
          name: SEARCH_TOOL.name,
          argumentsJson: JSON.stringify({ query: "verified evidence" }),
        }],
      }),
      turn({ outputText: JSON.stringify({ shortAnswer: "Verified" }) }),
    ], requests),
    instructions: "Use the tools.",
    inputItems: [{ role: "user", content: "Question" }],
    tools: [SEARCH_TOOL],
    outputSchemaName: "answer",
    outputSchema: OUTPUT_SCHEMA,
  });
  assertEquals(result.status, "completed");
  assertEquals(result.successfulResearchCalls, 1);
  assertEquals(result.toolCalls, 1);
  assertEquals(result.modelTurns, 3);
  assert(
    requests[1]?.instructions?.includes(
      "did not use an authorized project research tool",
    ) === true,
  );
});

Deno.test("read-only agent repairs one malformed structured answer after research", async () => {
  const requests: Array<{
    tools: readonly unknown[];
    toolChoice: string;
    instructions: string;
  }> = [];
  const gateway = queuedGateway([
    turn({
      outputItems: [{
        type: "function_call",
        call_id: "call-research",
        name: SEARCH_TOOL.name,
        arguments: '{"query":"canopy"}',
      }],
      toolCalls: [{
        callId: "call-research",
        name: SEARCH_TOOL.name,
        argumentsJson: '{"query":"canopy"}',
      }],
    }),
    turn({
      outputItems: [{
        type: "message",
        content: [{ type: "output_text", text: "not valid json" }],
      }],
      outputText: "not valid json",
    }),
    turn({ outputText: '{"shortAnswer":"verified"}' }),
  ], requests);
  const result = await runECOSReadOnlyAgent({
    gateway,
    instructions: "Research before answering.",
    inputItems: [{ role: "user", content: "Question" }],
    tools: [SEARCH_TOOL],
    outputSchemaName: "answer",
    outputSchema: OUTPUT_SCHEMA,
  });
  assertEquals(result.status, "completed");
  assertEquals(result.outputText, '{"shortAnswer":"verified"}');
  assertEquals(result.modelTurns, 3);
  assertEquals(requests[2]?.tools.length, 0);
  assertEquals(requests[2]?.toolChoice, "none");
  assert(
    requests[2]?.instructions.includes(
      "previous answer was not valid JSON",
    ) === true,
  );
});

Deno.test("read-only agent normalizes a whole-response JSON fence", async () => {
  const result = await runECOSReadOnlyAgent({
    gateway: queuedGateway([
      turn({
        outputItems: [{ type: "function_call" }],
        toolCalls: [{
          callId: "call-research",
          name: SEARCH_TOOL.name,
          argumentsJson: '{"query":"canopy"}',
        }],
      }),
      turn({ outputText: '```json\n{"shortAnswer":"verified"}\n```' }),
    ]),
    instructions: "Research before answering.",
    inputItems: [{ role: "user", content: "Question" }],
    tools: [SEARCH_TOOL],
    outputSchemaName: "answer",
    outputSchema: OUTPUT_SCHEMA,
  });
  assertEquals(result.status, "completed");
  assertEquals(result.outputText, '{"shortAnswer":"verified"}');
  assertEquals(result.modelTurns, 2);
});

Deno.test("read-only agent repairs one schema-invalid structured answer", async () => {
  const requests: unknown[] = [];
  const result = await runECOSReadOnlyAgent({
    gateway: queuedGateway([
      turn({
        outputItems: [{ type: "function_call" }],
        toolCalls: [{
          callId: "call-research",
          name: SEARCH_TOOL.name,
          argumentsJson: '{"query":"canopy"}',
        }],
      }),
      turn({
        outputItems: [{
          type: "message",
          content: [{ type: "output_text", text: '{"wrong":"shape"}' }],
        }],
        outputText: '{"wrong":"shape"}',
      }),
      turn({ outputText: '{"shortAnswer":"verified"}' }),
    ], requests),
    instructions: "Research before answering.",
    inputItems: [{ role: "user", content: "Question" }],
    tools: [SEARCH_TOOL],
    outputSchemaName: "answer",
    outputSchema: OUTPUT_SCHEMA,
    validateOutputText: (value) =>
      typeof JSON.parse(value).shortAnswer === "string",
  });
  assertEquals(result.status, "completed");
  assertEquals(result.modelTurns, 3);
  assertEquals(
    (requests[2] as { toolChoice?: string })?.toolChoice,
    "none",
  );
});

Deno.test("read-only agent repairs a structured answer on the second bounded retry", async () => {
  const gateway = queuedGateway([
    turn({
      outputItems: [{
        type: "function_call",
        call_id: "call-research",
        name: SEARCH_TOOL.name,
        arguments: '{"query":"canopy"}',
      }],
      toolCalls: [{
        callId: "call-research",
        name: SEARCH_TOOL.name,
        argumentsJson: '{"query":"canopy"}',
      }],
    }),
    turn({
      outputItems: [{
        type: "message",
        content: [{ type: "output_text", text: "not valid json" }],
      }],
      outputText: "not valid json",
    }),
    turn({ outputText: "still not valid json" }),
    turn({ outputText: '{"shortAnswer":"verified"}' }),
  ]);
  const result = await runECOSReadOnlyAgent({
    gateway,
    instructions: "Research before answering.",
    inputItems: [{ role: "user", content: "Question" }],
    tools: [SEARCH_TOOL],
    outputSchemaName: "answer",
    outputSchema: OUTPUT_SCHEMA,
  });
  assertEquals(result.status, "completed");
  assertEquals(result.outputText, '{"shortAnswer":"verified"}');
  assertEquals(result.modelTurns, 4);
});

Deno.test("read-only agent fails after two malformed structured-answer retries", async () => {
  const gateway = queuedGateway([
    turn({
      outputItems: [{
        type: "function_call",
        call_id: "call-research",
        name: SEARCH_TOOL.name,
        arguments: '{"query":"canopy"}',
      }],
      toolCalls: [{
        callId: "call-research",
        name: SEARCH_TOOL.name,
        argumentsJson: '{"query":"canopy"}',
      }],
    }),
    turn({ outputText: "not valid json" }),
    turn({ outputText: "still not valid json" }),
    turn({ outputText: "third invalid output" }),
  ]);
  const result = await runECOSReadOnlyAgent({
    gateway,
    instructions: "Research before answering.",
    inputItems: [{ role: "user", content: "Question" }],
    tools: [SEARCH_TOOL],
    outputSchemaName: "answer",
    outputSchema: OUTPUT_SCHEMA,
  });
  assertEquals(result.status, "failed");
  assertEquals(result.errorCode, "agent_output_json_invalid");
  assertEquals(result.modelTurns, 4);
});

Deno.test("read-only agent reserves a repair turn after four research turns", async () => {
  const requests: Array<{ tools?: readonly unknown[]; toolChoice?: string }> = [];
  const researchTurn = (index: number) =>
    turn({
      outputItems: [{ type: "function_call" }],
      toolCalls: [{
        callId: `call-${index}`,
        name: SEARCH_TOOL.name,
        argumentsJson: JSON.stringify({ query: `search ${index}` }),
      }],
    });
  const result = await runECOSReadOnlyAgent({
    gateway: queuedGateway([
      researchTurn(1),
      researchTurn(2),
      researchTurn(3),
      researchTurn(4),
      turn({
        outputItems: [{
          type: "message",
          content: [{ type: "output_text", text: "not valid json" }],
        }],
        outputText: "not valid json",
      }),
      turn({ outputText: '{"shortAnswer":"verified"}' }),
    ], requests),
    instructions: "Research before answering.",
    inputItems: [{ role: "user", content: "Question" }],
    tools: [SEARCH_TOOL],
    outputSchemaName: "answer",
    outputSchema: OUTPUT_SCHEMA,
    validateOutputText: (value) =>
      typeof JSON.parse(value).shortAnswer === "string",
    limits: { maxModelTurns: 6 },
  });
  assertEquals(result.status, "completed");
  assertEquals(result.modelTurns, 6);
  assertEquals(result.successfulResearchCalls, 4);
  assertEquals(requests[4]?.tools?.length, 0);
  assertEquals(requests[4]?.toolChoice, "none");
  assertEquals(requests[5]?.tools?.length, 0);
  assertEquals(requests[5]?.toolChoice, "none");
});

Deno.test("read-only agent repairs one missing final output after research", async () => {
  const result = await runECOSReadOnlyAgent({
    gateway: queuedGateway([
      turn({
        outputItems: [{ type: "function_call" }],
        toolCalls: [{
          callId: "call-research",
          name: SEARCH_TOOL.name,
          argumentsJson: '{"query":"canopy"}',
        }],
      }),
      turn({ outputText: null }),
      turn({ outputText: '{"shortAnswer":"verified"}' }),
    ]),
    instructions: "Research before answering.",
    inputItems: [{ role: "user", content: "Question" }],
    tools: [SEARCH_TOOL],
    outputSchemaName: "answer",
    outputSchema: OUTPUT_SCHEMA,
  });
  assertEquals(result.status, "completed");
  assertEquals(result.outputText, '{"shortAnswer":"verified"}');
  assertEquals(result.modelTurns, 3);
});

Deno.test("inventory metadata alone cannot authorize an answer", async () => {
  const inventoryTool: ECOSAgentTool = {
    ...SEARCH_TOOL,
    name: "inspect_project_evidence_inventory",
    providesEvidence: false,
  };
  const result = await runECOSReadOnlyAgent({
    gateway: queuedGateway([
      turn({
        outputItems: [{ type: "function_call" }],
        toolCalls: [{
          callId: "call-inventory",
          name: inventoryTool.name,
          argumentsJson: "{}",
        }],
      }),
      turn({ outputText: JSON.stringify({ shortAnswer: "Unsupported" }) }),
      turn({ outputText: JSON.stringify({ shortAnswer: "Still unsupported" }) }),
    ]),
    instructions: "Use the tools.",
    inputItems: [{ role: "user", content: "Question" }],
    tools: [inventoryTool],
    outputSchemaName: "answer",
    outputSchema: OUTPUT_SCHEMA,
  });
  assertEquals(result.status, "failed");
  assertEquals(result.errorCode, "agent_research_required");
});

Deno.test("failed research is distinguished from empty evidence without leaking exception text", async () => {
  for (const code of ["proof_authority_permission_denied", "secret-credential"]) {
    const tool: ECOSAgentTool={...SEARCH_TOOL,execute:()=>{throw Object.assign(new Error("private document and credential"),{code});}};
    const result=await runECOSReadOnlyAgent({
      gateway:queuedGateway([
        turn({outputItems:[{type:"function_call"}],toolCalls:[{callId:"failed",name:tool.name,argumentsJson:"{}"}]}),
        turn({outputText:JSON.stringify({shortAnswer:"Unavailable"})}),
      ]),
      instructions:"Use tools",inputItems:[],tools:[tool],outputSchemaName:"answer",outputSchema:OUTPUT_SCHEMA,limits:{maxModelTurns:2},
    });
    assertEquals(result.errorCode,"agent_research_unavailable");
    assertEquals(result.trace[0].errorCode,code === "secret-credential" ? "tool_unavailable" : code);
    assertEquals(JSON.stringify(result).includes("private document"),false);
    assertEquals(JSON.stringify(result).includes("secret-credential"),false);
  }
});

Deno.test("read-only agent caches identical tool calls", async () => {
  let executions = 0;
  const tool: ECOSAgentTool = {
    ...SEARCH_TOOL,
    execute: () => {
      executions += 1;
      return { matches: [] };
    },
  };
  const call = {
    callId: "call-1",
    name: tool.name,
    argumentsJson: JSON.stringify({ query: "same" }),
  };
  const result = await runECOSReadOnlyAgent({
    gateway: queuedGateway([
      turn({ outputItems: [{ type: "function_call" }], toolCalls: [call] }),
      turn({
        outputItems: [{ type: "function_call" }],
        toolCalls: [{ ...call, callId: "call-2" }],
      }),
      turn({
        outputText: JSON.stringify({ shortAnswer: "No matching evidence." }),
      }),
    ]),
    instructions: "Use the tools.",
    inputItems: [{ role: "user", content: "Question" }],
    tools: [tool],
    outputSchemaName: "answer",
    outputSchema: OUTPUT_SCHEMA,
  });
  assertEquals(result.status, "completed");
  assertEquals(executions, 1);
  assertEquals(result.trace.map((item) => item.status), [
    "completed",
    "cached",
  ]);
  assertEquals(result.trace[0]?.outputSha256, result.trace[1]?.outputSha256);
});

Deno.test("read-only agent enforces the tool-call budget", async () => {
  const result = await runECOSReadOnlyAgent({
    gateway: queuedGateway([
      turn({
        outputItems: [{ type: "function_call" }],
        toolCalls: [
          {
            callId: "call-1",
            name: SEARCH_TOOL.name,
            argumentsJson: '{"query":"one"}',
          },
          {
            callId: "call-2",
            name: SEARCH_TOOL.name,
            argumentsJson: '{"query":"two"}',
          },
        ],
      }),
    ]),
    instructions: "Use the tools.",
    inputItems: [{ role: "user", content: "Question" }],
    tools: [SEARCH_TOOL],
    outputSchemaName: "answer",
    outputSchema: OUTPUT_SCHEMA,
    limits: { maxToolCalls: 1 },
  });
  assertEquals(result.status, "failed");
  assertEquals(result.errorCode, "agent_tool_call_limit_reached");
});

Deno.test("read-only agent reserves its final model turn for bounded composition", async () => {
  const requests: Array<{ tools?: unknown[]; instructions?: string }> = [];
  const toolCall = (index: number) =>
    turn({
      outputItems: [{ type: "function_call" }],
      toolCalls: [{
        callId: `call-${index}`,
        name: SEARCH_TOOL.name,
        argumentsJson: JSON.stringify({ query: `search ${index}` }),
      }],
    });
  const result = await runECOSReadOnlyAgent({
    gateway: queuedGateway([
      toolCall(1),
      toolCall(2),
      turn({ outputText: JSON.stringify({ shortAnswer: "Bounded answer." }) }),
    ], requests),
    instructions: "Use the tools.",
    inputItems: [{ role: "user", content: "Question" }],
    tools: [SEARCH_TOOL],
    outputSchemaName: "answer",
    outputSchema: OUTPUT_SCHEMA,
    limits: { maxModelTurns: 3 },
  });
  assertEquals(result.status, "completed");
  assertEquals(requests[0]?.tools?.length, 1);
  assertEquals(requests[1]?.tools?.length, 1);
  assertEquals(requests[2]?.tools?.length, 0);
  assertEquals(
    (requests[0] as { toolChoice?: string }).toolChoice,
    "required",
  );
  assertEquals(
    (requests[1] as { toolChoice?: string }).toolChoice,
    "auto",
  );
  assertEquals(
    (requests[2] as { toolChoice?: string }).toolChoice,
    "none",
  );
  assert(
    requests[2]?.instructions?.includes("Research is now complete") === true,
  );
});

Deno.test("final composition is reserved even before exact evidence is opened", async () => {
  const requests: Array<{ tools?: unknown[] }> = [];
  const searchOnlyTool: ECOSAgentTool = {
    ...SEARCH_TOOL,
    providesEvidence: false,
  };
  const result = await runECOSReadOnlyAgent({
    gateway: queuedGateway([
      turn({
        outputItems: [{ type: "function_call" }],
        toolCalls: [{
          callId: "call-search",
          name: searchOnlyTool.name,
          argumentsJson: JSON.stringify({ query: "search only" }),
        }],
      }),
      turn({ outputText: JSON.stringify({ shortAnswer: "Not verified." }) }),
    ], requests),
    instructions: "Use the tools.",
    inputItems: [{ role: "user", content: "Question" }],
    tools: [searchOnlyTool],
    outputSchemaName: "answer",
    outputSchema: OUTPUT_SCHEMA,
    limits: { maxModelTurns: 2 },
  });
  assertEquals(requests[1]?.tools?.length, 0);
  assertEquals(result.status, "failed");
  assertEquals(result.errorCode, "agent_research_required");
});

Deno.test("OpenAI gateway sends strict server-side tools and parses calls", async () => {
  const captured: { requestBody?: Record<string, unknown> } = {};
  let authorization = "";
  const fetchImpl: typeof fetch = (_url, init) => {
    captured.requestBody = JSON.parse(String(init?.body));
    authorization = new Headers(init?.headers).get("authorization") || "";
    return Promise.resolve(
      new Response(
        JSON.stringify({
          output: [{
            type: "function_call",
            call_id: "call-7",
            name: SEARCH_TOOL.name,
            arguments: '{"query":"canopy"}',
          }],
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
  };
  const gateway = createOpenAIResponsesAgentGateway({
    apiKey: "private-key",
    model: "test-model",
    fetchImpl,
  });
  const response = await gateway.complete({
    instructions: "Use project tools.",
    inputItems: [{ role: "user", content: "Question" }],
    tools: [SEARCH_TOOL],
    toolChoice: "required",
    outputSchemaName: "answer",
    outputSchema: OUTPUT_SCHEMA,
    maxOutputTokens: 500,
    signal: new AbortController().signal,
  });
  const requestBody = captured.requestBody || {};
  assertEquals(authorization, "Bearer private-key");
  assertEquals(response.toolCalls[0]?.name, SEARCH_TOOL.name);
  assertEquals(requestBody.store as boolean, false);
  assertEquals(requestBody.tool_choice, "required");
  const tools = requestBody.tools as Array<Record<string, unknown>>;
  assertEquals(tools[0]?.strict, true);
  assert(!JSON.stringify(requestBody).includes("private-key"));
});

Deno.test("OpenAI gateway retries one transient provider response", async () => {
  let calls = 0;
  const gateway = createOpenAIResponsesAgentGateway({
    apiKey: "private-key",
    model: "test-model",
    fetchImpl: () => {
      calls += 1;
      return Promise.resolve(calls === 1
        ? new Response("temporary", { status: 502 })
        : new Response(JSON.stringify({ output: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }));
    },
  });
  await gateway.complete({
    instructions: "Use project tools.",
    inputItems: [{ role: "user", content: "Question" }],
    tools: [SEARCH_TOOL],
    toolChoice: "required",
    outputSchemaName: "answer",
    outputSchema: OUTPUT_SCHEMA,
    maxOutputTokens: 500,
    signal: new AbortController().signal,
  });
  assertEquals(calls, 2);
});

Deno.test("OpenAI gateway stops after one retry for persistent failures", async () => {
  let calls = 0;
  const gateway = createOpenAIResponsesAgentGateway({
    apiKey: "private-key",
    model: "test-model",
    fetchImpl: () => {
      calls += 1;
      return Promise.resolve(new Response("temporary", { status: 502 }));
    },
  });
  let message = "";
  try {
    await gateway.complete({
      instructions: "Use project tools.",
      inputItems: [{ role: "user", content: "Question" }],
      tools: [SEARCH_TOOL],
      toolChoice: "required",
      outputSchemaName: "answer",
      outputSchema: OUTPUT_SCHEMA,
      maxOutputTokens: 500,
      signal: new AbortController().signal,
    });
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assertEquals(message, "agent_provider_http_502");
  assertEquals(calls, 2);
});

function queuedGateway(
  turns: ECOSAgentModelTurn[],
  requests: unknown[] = [],
): ECOSAgentModelGateway {
  let index = 0;
  return {
    complete: (request) => {
      requests.push(request);
      const value = turns[index++];
      if (!value) throw new Error("unexpected_model_turn");
      return Promise.resolve(value);
    },
  };
}

function turn(value: Partial<ECOSAgentModelTurn>): ECOSAgentModelTurn {
  return {
    outputItems: value.outputItems || [],
    toolCalls: value.toolCalls || [],
    outputText: value.outputText || null,
    usage: value.usage || null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}
