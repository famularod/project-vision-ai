import { createECOSOwnerSourceViewHandler } from "./ecos-owner-source-view-handler.ts";
import { createECOSOwnerSourceViewResolver } from "./ecos-owner-source-view-resolver.ts";
import { createECOSV2OwnerPreviewAuthorizer } from "./ecos-v2-owner-preview-authorizer.ts";
import {
  createECOSV2OwnerEvidenceRPCTransport,
  createECOSV2OwnerRasterReadRPCTransport,
  createECOSV2OwnerRecordsRPCTransport,
  createECOSV2PreviewRPCTransport,
  ECOS_V2_PREVIEW_RPC_PROJECT_URL,
} from "./ecos-v2-preview-rpc-transport.ts";
import { createECOSOwnerRasterDownloadTransport } from "./ecos-owner-raster-images.ts";
import { sourceDatabaseFailure } from "./ecos-source-diagnostics.ts";

export interface ECOSOwnerSourceViewRuntimeConfig {
  enabled: boolean;
  anonKey: string;
  serviceRoleKey: string;
  gatewayToken: string;
  fetchImpl?: typeof fetch;
}

/** Memory-provisioned, server-only source-opening assembly. No model secret,
 * question charge, source enrollment, sync or project write is available here.
 * This application gateway token is NOT Cloud Run IAM/ingress authorization;
 * deployment must independently establish that boundary. Default-off startup
 * and user-before/after access checks are still required. */
export function createECOSOwnerSourceViewRuntime(
  input: ECOSOwnerSourceViewRuntimeConfig,
) {
  const invalid = () => new Error("Invalid source view configuration");
  if (!input || Object.getPrototypeOf(input) !== Object.prototype) {
    throw invalid();
  }
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const required = ["enabled", "anonKey", "serviceRoleKey", "gatewayToken"];
  if (
    Reflect.ownKeys(input).some((k) =>
      typeof k !== "string" || ![...required, "fetchImpl"].includes(k)
    ) ||
    required.some((k) => !Object.hasOwn(descriptors, k)) ||
    Object.values(descriptors).some((d) =>
      !d.enumerable || !Object.hasOwn(d, "value")
    )
  ) throw invalid();
  const { enabled, anonKey, serviceRoleKey, gatewayToken, fetchImpl = fetch } =
    input;
  if (
    typeof enabled !== "boolean" || typeof fetchImpl !== "function" ||
    ![anonKey, serviceRoleKey].every((v) =>
      typeof v === "string" && /^[!-~]{1,8192}$/.test(v)
    ) ||
    typeof gatewayToken !== "string" ||
    !/^[A-Za-z0-9_-]{32,256}$/.test(gatewayToken)
  ) throw invalid();
  const expected = crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(gatewayToken),
  );
  const handler = createECOSOwnerSourceViewHandler({
    enabled,
    budgetMs: 120000,
    maxConcurrent: 1,
    authorize: createECOSV2OwnerPreviewAuthorizer({
      supabaseUrl: ECOS_V2_PREVIEW_RPC_PROJECT_URL,
      anonKey,
      fetchImpl,
    }),
    resolve: (scope, request, signal, budgetMs) => {
      // Transport diagnostics are private fixed labels and numeric status only.
      // A URL, request/response body or thrown message may contain credentials
      // or project content; none of those may be serialized into logs.
      const warn = (value: Record<string, unknown>) => {
        try {
          console.warn(JSON.stringify(value));
        } catch { /* No control-flow effect. */ }
      };
      const sourceFetch: typeof fetch = async (input, init) => {
        const url = new URL(String(input));
        const allowedRPCs = [
          "ecos_list_linked_owner_project_document_inventory",
          "ecos_resolve_linked_owner_project_document_indexes",
          "ecos_read_owner_page_observations",
          "ecos_read_owner_page_raster",
          "ecos_list_project_record_inventory",
        ];
        const name = url.pathname.split("/").at(-1) ?? "";
        const operation = url.origin === ECOS_V2_PREVIEW_RPC_PROJECT_URL
          ? url.pathname.startsWith("/rest/v1/rpc/") &&
              allowedRPCs.includes(name)
            ? name
            : url.pathname.startsWith("/storage/v1/object/")
            ? "raster_download"
            : "other_source_read"
          : "other_source_read";
        const started = performance.now();
        try {
          const response = await fetchImpl(input, init);
          if (response.status >= 400) {
            warn({
              event: "ecos_owner_source_transport_failed",
              operation,
              status: response.status,
              databaseFailure: allowedRPCs.includes(operation)
                ? await sourceDatabaseFailure(response) : "not_database_rpc",
              elapsedMs: Math.round(performance.now() - started),
            });
          }
          return response;
        } catch (error) {
          warn({
            event: "ecos_owner_source_transport_failed",
            operation,
            status: null,
            elapsedMs: Math.round(performance.now() - started),
          });
          throw error;
        }
      };
      const options = { scope, serviceRoleKey, fetchImpl: sourceFetch };
      const evidence = createECOSV2OwnerEvidenceRPCTransport(options);
      return createECOSOwnerSourceViewResolver({
        inventoryRPC:
          createECOSV2PreviewRPCTransport(options).ownerInventoryRPC,
        indexRPC: evidence,
        pageRPC: evidence,
        rasterRPC: createECOSV2OwnerRasterReadRPCTransport(options),
        download: createECOSOwnerRasterDownloadTransport(options),
        recordRPC: createECOSV2OwnerRecordsRPCTransport(options),
      })(scope, request, signal, budgetMs);
    },
  });
  return async (request: Request) => {
    const reply = (error: string, status: number) => {
      try {
        void request.body?.cancel().catch(() => {});
      } catch { /* no wait */ }
      return new Response(JSON.stringify({ error, source: null }), {
        status,
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      });
    };
    const url = new URL(request.url);
    if (url.pathname !== "/source" || url.search) {
      return reply("not_found", 404);
    }
    if (!enabled) return reply("source_view_not_enabled", 503);
    if (request.signal.aborted) return reply("source_view_cancelled", 503);
    const supplied = request.headers.get("x-ecos-preview-gateway-token");
    if (!supplied || !/^[A-Za-z0-9_-]{32,256}$/.test(supplied)) {
      return reply("gateway_required", 403);
    }
    const actual = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(supplied)),
    );
    const digest = new Uint8Array(await expected);
    let difference = 0;
    for (let i = 0; i < digest.length; i++) difference |= digest[i] ^ actual[i];
    if (difference) return reply("gateway_required", 403);
    if (request.signal.aborted) return reply("source_view_cancelled", 503);
    return handler(request);
  };
}
