import { createECOSAgentQueryServerHandler } from "./main.ts";

const hash = "a".repeat(64);
const token = "agent_gateway_abcdefghijklmnopqrstuvwxyz0123456789";

Deno.test("agent query server exposes safe health and denies unknown routes", async () => {
  const handler = createECOSAgentQueryServerHandler({
    enabled: false,
    packagedSourceSha256: hash,
    gatewayToken: token,
  });
  const health = await handler(new Request("https://example.test/healthz"));
  const body = await health.json();
  if (
    health.status !== 200 || body.enabled !== false ||
    body.customerTraffic !== false || body.packagedSourceSha256 !== hash
  ) throw new Error("health contract failed");
  const status = await handler(new Request("https://example.test/status"));
  if (status.status !== 200) throw new Error("status contract failed");
  const missing = await handler(new Request("https://example.test/other"));
  if (missing.status !== 404) {
    throw new Error("unknown route did not fail closed");
  }
});

Deno.test("agent query server requires its private gateway and strips it downstream", async () => {
  let calls = 0;
  const handler = createECOSAgentQueryServerHandler({
    enabled: true,
    packagedSourceSha256: hash,
    gatewayToken: token,
    downstream: async (request) => {
      calls += 1;
      if (request.headers.has("x-ecos-agent-gateway-token")) {
        throw new Error("gateway token propagated downstream");
      }
      return new Response(JSON.stringify({ answer: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  const denied = await handler(
    new Request("https://example.test/question", {
      method: "POST",
      body: "{}",
    }),
  );
  if (denied.status !== 403 || calls !== 0) {
    throw new Error("gateway not enforced");
  }
  const allowed = await handler(
    new Request("https://example.test/question", {
      method: "POST",
      headers: { "x-ecos-agent-gateway-token": token },
      body: "{}",
    }),
  );
  if (
    allowed.status !== 200 || calls !== 1 ||
    allowed.headers.get("x-ecos-agent-packaged-source-sha256") !== hash
  ) throw new Error("authorized request was not forwarded");
});
