import { handleECOSAskProjectCandidateRequest } from "../../supabase/functions/ecos-ask-project-candidate/index.ts";

const HASH = /^[a-f0-9]{64}$/;

type ServerOptions = Readonly<{
  enabled: boolean;
  packagedSourceSha256: string;
  gatewayToken: string;
  downstream?: (request: Request) => Promise<Response>;
}>;

export function createECOSAgentQueryServerHandler(options: ServerOptions) {
  if (
    typeof options.enabled !== "boolean" ||
    !HASH.test(options.packagedSourceSha256) ||
    !/^[A-Za-z0-9_-]{32,256}$/.test(options.gatewayToken) ||
    (options.downstream !== undefined &&
      typeof options.downstream !== "function")
  ) throw new Error("Invalid agent query server configuration");
  const downstream = options.downstream || handleECOSAskProjectCandidateRequest;
  const expectedTokenDigest = crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(options.gatewayToken),
  );
  const reply = (value: unknown, status: number) =>
    new Response(JSON.stringify(value), {
      status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "x-ecos-agent-packaged-source-sha256": options.packagedSourceSha256,
      },
    });

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (
      request.method === "GET" &&
      (url.pathname === "/healthz" || url.pathname === "/status") &&
      !url.search
    ) {
      return reply({
        service: "ecos-agent-query-preview",
        protocol: "ecos-agent-query-preview/1.0",
        enabled: options.enabled,
        packagedSourceSha256: options.packagedSourceSha256,
        customerTraffic: false,
      }, 200);
    }
    if (url.pathname !== "/question" || url.search) {
      return rejectRequest(request, reply, 404, "not_found");
    }
    if (!options.enabled) {
      return rejectRequest(request, reply, 503, "preview_not_enabled");
    }
    if (request.method !== "POST") {
      return rejectRequest(request, reply, 405, "method_not_allowed");
    }
    const supplied = request.headers.get("x-ecos-agent-gateway-token");
    if (!supplied || !/^[A-Za-z0-9_-]{32,256}$/.test(supplied)) {
      return rejectRequest(request, reply, 403, "gateway_required");
    }
    const suppliedDigest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(supplied)),
    );
    const expectedDigest = new Uint8Array(await expectedTokenDigest);
    let difference = 0;
    for (let index = 0; index < expectedDigest.length; index += 1) {
      difference |= expectedDigest[index] ^ suppliedDigest[index];
    }
    if (difference !== 0) {
      return rejectRequest(request, reply, 403, "gateway_required");
    }
    const headers = new Headers(request.headers);
    headers.delete("x-ecos-agent-gateway-token");
    const response = await downstream(
      new Request(request.url, {
        method: "POST",
        headers,
        body: request.body,
        signal: request.signal,
      }),
    );
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set(
      "x-ecos-agent-packaged-source-sha256",
      options.packagedSourceSha256,
    );
    responseHeaders.set("Cache-Control", "no-store");
    responseHeaders.set("X-Content-Type-Options", "nosniff");
    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  };
}

function rejectRequest(
  request: Request,
  reply: (value: unknown, status: number) => Response,
  status: number,
  error: string,
) {
  try {
    void request.body?.cancel().catch(() => {});
  } catch { /* bounded best effort */ }
  return reply({ error }, status);
}

function required(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error("Agent query server configuration unavailable");
  return value;
}

if (import.meta.main) {
  try {
    if (required("PORT") !== "8080") throw new Error("Invalid listen port");
    const setting = Deno.env.get("ECOS_AGENT_RUNTIME_ENABLED");
    if (setting !== "true" && setting !== "false") {
      throw new Error("Invalid enabled setting");
    }
    const packagedSourceSha256 = (await Deno.readTextFile(
      "/app/ecos-agent-runtime-source.sha256",
    )).trim();
    if (
      !HASH.test(packagedSourceSha256) ||
      packagedSourceSha256 !== required("ECOS_AGENT_PACKAGE_SHA256")
    ) throw new Error("Packaged source identity mismatch");
    const handler = createECOSAgentQueryServerHandler({
      enabled: setting === "true",
      packagedSourceSha256,
      gatewayToken: required("ECOS_AGENT_PREVIEW_GATEWAY_TOKEN"),
    });
    Deno.serve({
      hostname: "0.0.0.0",
      port: 8080,
      onListen: () =>
        console.log(JSON.stringify({
          event: "ecos_agent_query_listening",
          packagedSourceSha256,
          enabled: setting === "true",
          customerTraffic: false,
        })),
    }, handler);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const errorCode = message === "Packaged source identity mismatch"
      ? "packaged_source_identity_mismatch"
      : message === "Invalid listen port"
      ? "invalid_listen_port"
      : message === "Invalid enabled setting"
      ? "invalid_enabled_setting"
      : "agent_query_server_configuration_unavailable";
    console.error(JSON.stringify({
      event: "ecos_agent_query_startup_failed",
      errorCode,
    }));
    Deno.exit(1);
  }
}
