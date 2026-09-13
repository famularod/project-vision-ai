import { createECOSAgentCustomerGatewayHandler } from "../ecos-agent-customer-gateway/index.ts";
import { mintECOSCloudRunIdToken } from "./ecos-google-wif-token.ts";

function assert(value: unknown, message = "Expected value to be truthy") {
  if (!value) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, received ${
        JSON.stringify(actual)
      }`,
    );
  }
}

const OWNER = "baa00267-082c-4951-97bb-d7894e98e432";
const OTHER = "caa00267-082c-4951-97bb-d7894e98e432";
const PACKAGE = "a".repeat(64);
const BODY = JSON.stringify({
  schemaVersion: "ecos-project-question/2.0",
  clientRequestId: "11111111-1111-4111-8111-111111111111",
  clientSurface: "iphone",
  projectId: "22222222-2222-4222-8222-222222222222",
  projectName: "2375 Compliance Project",
  question: "How thick is the concrete on the north lot?",
});

Deno.test("authorized beta owner reaches the exact DeepSeek runtime", async () => {
  const calls: string[] = [];
  const handler = createECOSAgentCustomerGatewayHandler(options({
    fetchImpl: async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/auth/v1/user")) return json({ id: OWNER });
      assertEquals(
        new Headers(init?.headers).get("authorization"),
        "Bearer owner-token",
      );
      assertEquals(
        new Headers(init?.headers).get("x-serverless-authorization"),
        "Bearer cloud-run-token",
      );
      assertEquals(
        new Headers(init?.headers).get("x-ecos-agent-gateway-token"),
        "g".repeat(40),
      );
      assertEquals(
        new Headers(init?.headers).get("x-ecos-worker-token"),
        "w".repeat(40),
      );
      assertEquals(
        new Headers(init?.headers).get("x-ecos-agent-route"),
        "deepseek-owner-beta-v1",
      );
      assertEquals(
        new Headers(init?.headers).get("origin"),
        null,
      );
      const forwarded = await new Response(init?.body).json();
      assertEquals(forwarded.validationMode, "shadow");
      assertEquals(
        forwarded.question,
        "How thick is the concrete on the north lot?",
      );
      return json(
        customerAnswer({
          clientRequestId: String(forwarded.clientRequestId),
          clientSurface: String(forwarded.clientSurface),
        }),
        200,
        {
          "x-ecos-agent-packaged-source-sha256": PACKAGE,
        },
      );
    },
    mintIdToken: async () => "cloud-run-token",
  }));
  const response = await handler(request());
  assertEquals(response.status, 200);
  assertEquals(
    response.headers.get("x-ecos-agent-route"),
    "deepseek-owner-beta-v1",
  );
  assertEquals(response.headers.get("x-ecos-agent-client-surface"), "iphone");
  assertEquals(calls.length, 2);
});

Deno.test("legacy Build 188 web requests receive a server-bound request identity", async () => {
  const forwardedBodies: Record<string, unknown>[] = [];
  const handler = createECOSAgentCustomerGatewayHandler(options({
    fetchImpl: async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      if (String(input).endsWith("/auth/v1/user")) return json({ id: OWNER });
      const forwarded = await new Response(init?.body).json();
      forwardedBodies.push(forwarded);
      return json(
        customerAnswer({
          schemaVersion: "ecos-project-question/1.0",
          clientRequestId: String(forwarded.clientRequestId),
          clientSurface: "web",
        }),
        200,
        {
          "x-ecos-agent-packaged-source-sha256": PACKAGE,
        },
      );
    },
    mintIdToken: async () => "cloud-run-token",
  }));
  const response = await handler(request(JSON.stringify({
    schemaVersion: "ecos-project-question/1.0",
    projectId: "22222222-2222-4222-8222-222222222222",
    projectName: "2375 Compliance Project",
    question: "How thick is the concrete on the north lot?",
  })));
  assertEquals(response.status, 200);
  assertEquals(response.headers.get("x-ecos-agent-client-surface"), "web");
  assertEquals(forwardedBodies.length, 1);
  const forwarded = forwardedBodies[0];
  assertEquals(forwarded.schemaVersion, "ecos-project-question/1.0");
  assertEquals(forwarded.clientSurface, "web");
  assert(
    typeof forwarded.clientRequestId === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
        .test(
          forwarded.clientRequestId,
        ),
  );
  assertEquals(forwarded.validationMode, "shadow");
});

Deno.test("legacy native requests receive a server-bound unknown surface", async () => {
  const forwardedBodies: Record<string, unknown>[] = [];
  const handler = createECOSAgentCustomerGatewayHandler(options({
    fetchImpl: async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith("/auth/v1/user")) return json({ id: OWNER });
      const forwarded = await new Response(init?.body).json();
      forwardedBodies.push(forwarded);
      return json(
        customerAnswer({
          schemaVersion: "ecos-project-question/1.0",
          clientRequestId: String(forwarded.clientRequestId),
          clientSurface: "unknown",
        }),
        200,
        { "x-ecos-agent-packaged-source-sha256": PACKAGE },
      );
    },
    mintIdToken: async () => "cloud-run-token",
  }));
  const response = await handler(
    new Request("https://gateway.test", {
      method: "POST",
      headers: {
        Authorization: "Bearer owner-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        schemaVersion: "ecos-project-question/1.0",
        projectId: "22222222-2222-4222-8222-222222222222",
        projectName: "2375 Compliance Project",
        question: "How thick is the concrete on the north lot?",
      }),
    }),
  );
  assertEquals(response.status, 200);
  assertEquals(response.headers.get("x-ecos-agent-client-surface"), "unknown");
  assertEquals(forwardedBodies.length, 1);
  assertEquals(forwardedBodies[0].clientSurface, "unknown");
  assert(
    typeof forwardedBodies[0].clientRequestId === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
        .test(forwardedBodies[0].clientRequestId as string),
  );
});

Deno.test("malformed current requests fail as compatibility errors, not authorization", async () => {
  let runtimeCalled = false;
  const handler = createECOSAgentCustomerGatewayHandler(options({
    fetchImpl: async (input: string | URL | Request) => {
      if (String(input).endsWith("/auth/v1/user")) return json({ id: OWNER });
      runtimeCalled = true;
      return json({});
    },
  }));
  const response = await handler(request(JSON.stringify({
    schemaVersion: "ecos-project-question/2.0",
    projectId: "22222222-2222-4222-8222-222222222222",
    projectName: "2375 Compliance Project",
    question: "How thick is the concrete on the north lot?",
  })));
  assertEquals(response.status, 400);
  assertEquals(await response.json(), {
    error: "client_contract_incompatible",
  });
  assertEquals(runtimeCalled, false);
});

Deno.test("other authenticated owners remain on the classic fallback", async () => {
  let minted = false;
  const handler = createECOSAgentCustomerGatewayHandler(options({
    fetchImpl: async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/auth/v1/user")) return json({ id: OTHER });
      assert(url.endsWith("/functions/v1/ecos-ask-project-classic-fallback"));
      return json({ model: "gpt-5.6-terra", answer: "classic" });
    },
    mintIdToken: async () => {
      minted = true;
      return "should-not-run";
    },
  }));
  const response = await handler(request());
  assertEquals(response.status, 200);
  assertEquals(
    response.headers.get("x-ecos-agent-route"),
    "classic-fallback-v1",
  );
  assertEquals(minted, false);
});

Deno.test("owner identity failure stops safely without classic fallback", async () => {
  let requestCount = 0;
  const handler = createECOSAgentCustomerGatewayHandler(options({
    fetchImpl: async () => {
      requestCount += 1;
      return json({ id: OWNER });
    },
    mintIdToken: async () => {
      throw new Error("provider details must not escape");
    },
  }));
  const response = await handler(request());
  assertEquals(response.status, 503);
  assertEquals(await response.json(), { error: "agent_gateway_unavailable" });
  assertEquals(requestCount, 1);
});

Deno.test("runtime package drift fails closed", async () => {
  const handler = createECOSAgentCustomerGatewayHandler(options({
    fetchImpl: async (input: string | URL | Request) =>
      String(input).endsWith("/auth/v1/user")
        ? json({ id: OWNER })
        : json({ model: "deepseek-v4-flash", secret: "must-not-escape" }, 200, {
          "x-ecos-agent-packaged-source-sha256": "b".repeat(64),
        }),
    mintIdToken: async () => "cloud-run-token",
  }));
  const response = await handler(request());
  assertEquals(response.status, 503);
  assertEquals(await response.json(), {
    error: "agent_runtime_identity_mismatch",
  });
});

Deno.test("unexpected provider model fails closed", async () => {
  const handler = createECOSAgentCustomerGatewayHandler(options({
    fetchImpl: async (input: string | URL | Request) =>
      String(input).endsWith("/auth/v1/user")
        ? json({ id: OWNER })
        : json({ model: "gpt-5.6-terra", answer: "must-not-escape" }, 200, {
          "x-ecos-agent-packaged-source-sha256": PACKAGE,
        }),
    mintIdToken: async () => "cloud-run-token",
  }));
  const response = await handler(request());
  assertEquals(response.status, 503);
  assertEquals(await response.json(), {
    error: "agent_model_identity_mismatch",
  });
});

Deno.test("document proof missing customer identity fields fails closed", async () => {
  const handler = createECOSAgentCustomerGatewayHandler(options({
    fetchImpl: async (input: string | URL | Request) =>
      String(input).endsWith("/auth/v1/user") ? json({ id: OWNER }) : json(
        {
          ...customerAnswer(),
          supportingEvidence: [{
            sourceType: "document",
            recordId: "document-1",
            summary: "Civil drawing, Sheet C6, Rev 1",
            excerpt: "6.0 inch PCC paving",
            documentCitation: {
              documentId: "document-1",
              documentName: "Civil drawing",
              revision: "1",
              pageNumber: 6,
              sheetNumber: "C6",
              regionId: null,
              label: "Civil drawing, Sheet C6, Rev 1",
            },
            documentRegion: null,
          }],
        },
        200,
        {
          "x-ecos-agent-packaged-source-sha256": PACKAGE,
        },
      ),
    mintIdToken: async () => "cloud-run-token",
  }));
  const response = await handler(request());
  assertEquals(response.status, 503);
  assertEquals(await response.json(), {
    error: "agent_customer_contract_mismatch",
  });
});

Deno.test("document proof with an unbound region fails closed", async () => {
  const handler = createECOSAgentCustomerGatewayHandler(options({
    fetchImpl: async (input: string | URL | Request) =>
      String(input).endsWith("/auth/v1/user") ? json({ id: OWNER }) : json(
        {
          ...customerAnswer(),
          supportingEvidence: [{
            ...customerAnswer().supportingEvidence[0],
            documentCitation: {
              ...customerAnswer().supportingEvidence[0].documentCitation,
              regionId: "region-1",
            },
            documentRegion: null,
          }],
        },
        200,
        {
          "x-ecos-agent-packaged-source-sha256": PACKAGE,
        },
      ),
    mintIdToken: async () => "cloud-run-token",
  }));
  const response = await handler(request());
  assertEquals(response.status, 503);
  assertEquals(await response.json(), {
    error: "agent_customer_contract_mismatch",
  });
});

Deno.test("unknown native surface remains compatible and trace-bound", async () => {
  const body = JSON.stringify({
    ...JSON.parse(BODY),
    clientSurface: "unknown",
  });
  const handler = createECOSAgentCustomerGatewayHandler(options({
    fetchImpl: async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith("/auth/v1/user")) return json({ id: OWNER });
      const forwarded = await new Response(init?.body).json();
      return json(
        customerAnswer({
          clientRequestId: String(forwarded.clientRequestId),
          clientSurface: "unknown",
        }),
        200,
        {
          "x-ecos-agent-packaged-source-sha256": PACKAGE,
        },
      );
    },
    mintIdToken: async () => "cloud-run-token",
  }));
  const response = await handler(request(body));
  assertEquals(response.status, 200);
  assertEquals(response.headers.get("x-ecos-agent-client-surface"), "unknown");
});

Deno.test("invalid owner session is rejected before routing", async () => {
  const handler = createECOSAgentCustomerGatewayHandler(options({
    fetchImpl: async () => json({ error: "invalid" }, 401),
  }));
  const response = await handler(request());
  assertEquals(response.status, 401);
  assertEquals(await response.json(), { error: "unauthorized" });
});

Deno.test("oversized input is rejected before external work", async () => {
  let called = false;
  const handler = createECOSAgentCustomerGatewayHandler(options({
    fetchImpl: async () => {
      called = true;
      return json({});
    },
  }));
  const response = await handler(request("x".repeat(9 * 1024)));
  assertEquals(response.status, 413);
  assertEquals(called, false);
});

Deno.test("customer cannot inject protected validation controls", async () => {
  let runtimeCalled = false;
  const handler = createECOSAgentCustomerGatewayHandler(options({
    fetchImpl: async (input: string | URL | Request) => {
      if (String(input).endsWith("/auth/v1/user")) return json({ id: OWNER });
      runtimeCalled = true;
      return json({});
    },
  }));
  const response = await handler(request(JSON.stringify({
    ...JSON.parse(BODY),
    validationMode: "shadow",
  })));
  assertEquals(response.status, 403);
  assertEquals(await response.json(), { error: "protected_field_forbidden" });
  assertEquals(runtimeCalled, false);
});

Deno.test("browser origin is exact and preflight is bounded", async () => {
  const handler = createECOSAgentCustomerGatewayHandler(options());
  const accepted = await handler(
    new Request("https://gateway.test", {
      method: "OPTIONS",
      headers: { Origin: "https://project-photo-update-tool.expo.app" },
    }),
  );
  assertEquals(accepted.status, 204);
  assertEquals(
    accepted.headers.get("access-control-allow-origin"),
    "https://project-photo-update-tool.expo.app",
  );
  const rejected = await handler(
    new Request("https://gateway.test", {
      method: "OPTIONS",
      headers: { Origin: "https://evil.example" },
    }),
  );
  assertEquals(rejected.status, 403);
});

Deno.test("WIF exchange mints an audience-bound Cloud Run token", async () => {
  const calls: Readonly<{ url: string; init?: RequestInit }>[] = [];
  const token = await mintECOSCloudRunIdToken({
    subjectToken: "owner-jwt",
    providerResource:
      "//iam.googleapis.com/projects/123/locations/global/workloadIdentityPools/pool/providers/provider",
    serviceAccountEmail: "invoker@example.iam.gserviceaccount.com",
    serviceAudience: "https://agent-123-us.a.run.app",
    fetchImpl: async (input, init) => {
      calls.push({ url: String(input), init });
      return calls.length === 1
        ? json({ access_token: "federated-token" })
        : json({ token: "cloud-run-token" });
    },
  });
  assertEquals(token, "cloud-run-token");
  assertEquals(calls.length, 2);
  assert(calls[0].url.includes("sts.googleapis.com"));
  assert(String(calls[0].init?.body).includes("subject_token=owner-jwt"));
  assert(
    String(calls[1].init?.body).includes(
      '"audience":"https://agent-123-us.a.run.app"',
    ),
  );
  assertEquals(
    new Headers(calls[1].init?.headers).get("authorization"),
    "Bearer federated-token",
  );
});

Deno.test("WIF rejects tagged audiences before any provider request", async () => {
  let called = false;
  let errorCode = "";
  try {
    await mintECOSCloudRunIdToken({
      subjectToken: "owner-jwt",
      providerResource:
        "//iam.googleapis.com/projects/123/locations/global/workloadIdentityPools/pool/providers/provider",
      serviceAccountEmail: "invoker@example.iam.gserviceaccount.com",
      serviceAudience: "https://tag---agent-123-us.a.run.app",
      fetchImpl: async () => {
        called = true;
        return json({});
      },
    });
  } catch (error) {
    errorCode = error instanceof Error ? error.message : "";
  }
  assertEquals(errorCode, "wif_service_audience_invalid");
  assertEquals(called, false);
});

Deno.test("WIF provider errors do not expose provider response content", async () => {
  let errorCode = "";
  try {
    await mintECOSCloudRunIdToken({
      subjectToken: "owner-jwt",
      providerResource:
        "//iam.googleapis.com/projects/123/locations/global/workloadIdentityPools/pool/providers/provider",
      serviceAccountEmail: "invoker@example.iam.gserviceaccount.com",
      serviceAudience: "https://agent-123-us.a.run.app",
      fetchImpl: async () => json({ error: "secret provider details" }, 403),
    });
  } catch (error) {
    errorCode = error instanceof Error ? error.message : "";
  }
  assertEquals(errorCode, "wif_exchange_failed:403");
  assertEquals(errorCode.includes("secret provider details"), false);
});

function options(overrides: Record<string, unknown> = {}) {
  return {
    supabaseUrl: "https://project.supabase.co",
    anonKey: "anon-key",
    betaOwnerId: OWNER,
    agentRuntimeUrl: "https://tag---agent-123-us.a.run.app",
    agentRuntimeGatewayToken: "g".repeat(40),
    serviceWorkerToken: "w".repeat(40),
    expectedPackageSha256: PACKAGE,
    expectedModel: "deepseek-v4-flash",
    wifProviderResource:
      "//iam.googleapis.com/projects/123/locations/global/workloadIdentityPools/pool/providers/provider",
    wifServiceAccount: "invoker@example.iam.gserviceaccount.com",
    serverlessAudience: "https://agent-123-us.a.run.app",
    classicFallbackUrl:
      "https://project.supabase.co/functions/v1/ecos-ask-project-classic-fallback",
    allowedOrigins: ["https://project-photo-update-tool.expo.app"],
    fetchImpl: async () => json({ id: OWNER }),
    mintIdToken: async () => "cloud-run-token",
    ...overrides,
  } as Parameters<typeof createECOSAgentCustomerGatewayHandler>[0];
}

function request(body = BODY) {
  return new Request("https://gateway.test", {
    method: "POST",
    headers: {
      Authorization: "Bearer owner-token",
      "Content-Type": "application/json",
      Origin: "https://project-photo-update-tool.expo.app",
    },
    body,
  });
}

function customerAnswer({
  schemaVersion = "ecos-project-question/2.0",
  clientRequestId = "11111111-1111-4111-8111-111111111111",
  clientSurface = "iphone",
}: {
  schemaVersion?: string;
  clientRequestId?: string;
  clientSurface?: string;
} = {}) {
  return {
    schemaVersion,
    projectId: "22222222-2222-4222-8222-222222222222",
    projectName: "2375 Compliance Project",
    question: "How thick is the concrete on the north lot?",
    answer: "The current drawing specifies 6.0 inches of PCC paving.",
    confidence: "high",
    facts: [{
      id: "fact-1",
      statement: "The current drawing specifies 6.0 inches of PCC paving.",
      classification: "fact",
      sourceIds: ["document-1"],
    }],
    limitations: [],
    conflicts: [],
    suggestedQuestions: [],
    supportingEvidence: [{
      sourceType: "document",
      recordId: "document-1",
      summary: "Civil drawing, Sheet C6, Rev 1",
      excerpt: "6.0 inch PCC paving",
      documentCitation: {
        documentId: "document-1",
        projectId: "22222222-2222-4222-8222-222222222222",
        sourceSha256: "c".repeat(64),
        evidenceVersion: "ecos-hosted-evidence/1.3",
        documentName: "Civil drawing",
        revision: "1",
        pageNumber: 6,
        sheetNumber: "C6",
        regionId: null,
        label: "Civil drawing, Sheet C6, Rev 1",
      },
      documentRegion: null,
    }],
    assurance: {
      status: "verified",
      checkedSourceCount: 1,
      verifiedFactCount: 1,
      rejectedFactCount: 0,
      message: "Verified against current project evidence.",
    },
    generatedAt: "2026-09-12T00:00:00.000Z",
    model: "deepseek-v4-flash",
    ...(schemaVersion === "ecos-project-question/2.0"
      ? {
        diagnostics: {
          schemaVersion: "ecos-question-trace/1.0",
          traceId: "33333333-3333-4333-8333-333333333333",
          clientRequestId,
          clientSurface,
          evidenceSnapshotId: null,
          evidenceDossierId: null,
          replayed: false,
          persisted: true,
        },
      }
      : {}),
  };
}

function json(
  value: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}
