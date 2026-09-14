import {
  createECOSOwnerOperationalPreviewRuntime,
  createECOSOwnerPreviewRuntime,
  type ECOSOwnerPreviewRuntimeConfig,
} from "../../supabase/functions/_shared/ecos-owner-preview-runtime.ts";
import {
  createECOSOwnerSourceViewRuntime,
  type ECOSOwnerSourceViewRuntimeConfig,
} from "../../supabase/functions/_shared/ecos-owner-source-view-runtime.ts";

const HASH = /^[a-f0-9]{64}$/;
const reply = (value: unknown, status: number, digest: string) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "x-ecos-owner-packaged-source-sha256": digest,
    },
  });

/** Packaging shell only. Configuration is supplied by trusted startup code,
 * never request JSON/headers. The factory still performs gateway + original
 * user authentication, exact scoped admission and all source/model work. */
type ServerOptions = {
  enabled: boolean;
  packagedSourceSha256: string;
  readConfiguration: () => Omit<ECOSOwnerPreviewRuntimeConfig, "enabled">;
  sourceView?: {
    enabled: boolean;
    readConfiguration: () => Omit<ECOSOwnerSourceViewRuntimeConfig, "enabled">;
  };
};
function createOwnerQueryServerHandler(
  options: ServerOptions,
  operational: boolean,
): (request: Request) => Promise<Response> {
  const { enabled, packagedSourceSha256, readConfiguration } = options;
  if (
    typeof enabled !== "boolean" ||
    typeof packagedSourceSha256 !== "string" ||
    !HASH.test(packagedSourceSha256) ||
    typeof readConfiguration !== "function"
  ) throw new Error("Invalid owner query server configuration");
  const sourceView = options.sourceView === undefined ? null : Object.freeze({
    enabled: options.sourceView.enabled,
    readConfiguration: options.sourceView.readConfiguration,
  });
  if (
    sourceView &&
    (typeof sourceView.enabled !== "boolean" ||
      typeof sourceView.readConfiguration !== "function")
  ) {
    throw new Error("Invalid source view server configuration");
  }
  let runtime: ReturnType<typeof createECOSOwnerPreviewRuntime> | null = null;
  let unavailable = false;
  let sourceRuntime:
    | ReturnType<typeof createECOSOwnerSourceViewRuntime>
    | null = null;
  let sourceUnavailable = false;
  return async (request) => {
    const url = new URL(request.url);
    if (
      request.method === "GET" &&
      (url.pathname === "/status" || url.pathname === "/healthz") &&
      !url.search
    ) {
      return reply(
        {
          service: "ecos-owner-preview",
          protocol: operational
            ? "ecos-question-preview/2.2"
            : "ecos-question-preview/2.1",
          enabled,
          packagedSourceSha256,
          packageIdentity: "sha256_of_packaged_source_manifest",
          sourceReadiness: "not_assessed",
          modelReadiness: "not_assessed",
          hostedReadiness: "not_assessed",
          ...(sourceView
            ? {
              sourceViewEnabled: sourceView.enabled,
              sourceViewReadiness: "not_assessed",
            }
            : {}),
        },
        200,
        packagedSourceSha256,
      );
    }
    if (url.pathname === "/source" && !url.search) {
      const sourceFailure = (error: string, status: number) => {
        try {
          void request.body?.cancel().catch(() => {});
        } catch { /* bounded best effort */ }
        return reply({ error, source: null }, status, packagedSourceSha256);
      };
      if (!sourceView?.enabled) {
        return sourceFailure("source_view_not_enabled", 503);
      }
      try {
        if (sourceUnavailable) {
          throw new Error("Unavailable source configuration");
        }
        if (!sourceRuntime) {
          try {
            sourceRuntime = createECOSOwnerSourceViewRuntime({
              ...sourceView.readConfiguration(),
              enabled: true,
            });
          } catch {
            sourceUnavailable = true;
            throw new Error("Unavailable source configuration");
          }
        }
        const result = await sourceRuntime(request);
        const headers = new Headers(result.headers);
        headers.set(
          "x-ecos-owner-packaged-source-sha256",
          packagedSourceSha256,
        );
        return new Response(result.body, { status: result.status, headers });
      } catch {
        return sourceFailure("source_view_unavailable", 503);
      }
    }
    if (url.pathname !== "/question" || url.search) {
      return reply({ error: "not_found" }, 404, packagedSourceSha256);
    }
    if (!enabled) {
      return reply({ error: "preview_not_enabled" }, 503, packagedSourceSha256);
    }
    try {
      if (unavailable) throw new Error("Unavailable configuration");
      if (!runtime) {
        try {
          const factory = operational
            ? createECOSOwnerOperationalPreviewRuntime
            : createECOSOwnerPreviewRuntime;
          runtime = factory({
            ...readConfiguration(),
            enabled: true,
          });
        } catch {
          unavailable = true;
          throw new Error("Unavailable configuration");
        }
      }
      const result = await runtime(request);
      const headers = new Headers(result.headers);
      headers.set("x-ecos-owner-packaged-source-sha256", packagedSourceSha256);
      return new Response(result.body, { status: result.status, headers });
    } catch {
      // Never echo environment values or exception/provider/source messages.
      return reply(
        { error: "preview_unavailable", answer: null },
        503,
        packagedSourceSha256,
      );
    }
  };
}

export function createECOSOwnerQueryServerHandler(options: ServerOptions) {
  return createOwnerQueryServerHandler(options, false);
}

export function createECOSOwnerOperationalQueryServerHandler(
  options: ServerOptions,
) {
  return createOwnerQueryServerHandler(options, true);
}

function required(name: string): string {
  const value = Deno.env.get(name);
  if (value === undefined || value.length === 0) {
    throw new Error("Required owner query server configuration missing");
  }
  return value;
}

if (import.meta.main) {
  try {
    const setting = Deno.env.get("ECOS_OWNER_QUERY_ENABLED");
    if (setting !== undefined && setting !== "false" && setting !== "true") {
      throw new Error("Invalid enabled setting");
    }
    const sourceSetting = Deno.env.get("ECOS_OWNER_SOURCE_VIEW_ENABLED");
    if (
      sourceSetting !== undefined && sourceSetting !== "false" &&
      sourceSetting !== "true"
    ) throw new Error("Invalid source view setting");
    // Fixed listen port permits an exact Deno network permission. Cloud Run
    // must be configured to use this port; there is no unbounded port fallback.
    if (required("PORT") !== "8080") throw new Error("Invalid listen port");
    const rawDigest = await Deno.readTextFile(
      "/app/owner-runtime-source.sha256",
    );
    if (
      rawDigest.length !== 65 || rawDigest[64] !== "\n" ||
      !HASH.test(rawDigest.slice(0, 64))
    ) {
      throw new Error("Packaged source identity missing");
    }
    const digest = rawDigest.slice(0, 64);
    const handler = createECOSOwnerOperationalQueryServerHandler({
      enabled: setting === "true",
      packagedSourceSha256: digest,
      sourceView: {
        enabled: sourceSetting === "true",
        readConfiguration: () => ({
          anonKey: required("ECOS_OWNER_QUERY_ANON_KEY"),
          serviceRoleKey: required("ECOS_OWNER_QUERY_SERVICE_ROLE_KEY"),
          gatewayToken: required("ECOS_OWNER_QUERY_GATEWAY_TOKEN"),
        }),
      },
      readConfiguration: () => {
        const transport = Deno.env.get("ECOS_OWNER_QUERY_MODEL_TRANSPORT") ??
          "direct";
        if (transport !== "direct" && transport !== "supabase_bridge") {
          throw new Error("Invalid model transport");
        }
        return {
          anonKey: required("ECOS_OWNER_QUERY_ANON_KEY"),
          serviceRoleKey: required("ECOS_OWNER_QUERY_SERVICE_ROLE_KEY"),
          ...(transport === "direct"
            ? { apiKey: required("ECOS_OWNER_QUERY_OPENAI_API_KEY") }
            : {
              bridgeWorkerToken: required(
                "ECOS_OWNER_QUERY_BRIDGE_WORKER_TOKEN",
              ),
            }),
          model: required("ECOS_OWNER_QUERY_MODEL"),
          gatewayToken: required("ECOS_OWNER_QUERY_GATEWAY_TOKEN"),
        };
      },
    });
    Deno.serve({
      hostname: "0.0.0.0",
      port: 8080,
      onListen: () =>
        console.log(JSON.stringify({
          event: "owner_query_listening",
          packagedSourceSha256: digest,
          enabled: setting === "true",
        })),
    }, handler);
  } catch {
    console.error("Owner query server startup unavailable");
    Deno.exit(1);
  }
}
