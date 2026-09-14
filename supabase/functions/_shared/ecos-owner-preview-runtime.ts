import {
  createECOSOwnerOperationalPreviewHandler,
  createECOSOwnerPreviewHandler,
  type ECOSOwnerOperationalPreviewDependencies,
} from "./ecos-v2-preview-handler.ts";
import { createECOSV2OwnerPreviewAuthorizer } from "./ecos-v2-owner-preview-authorizer.ts";
import { createECOSV2OwnerPreviewAdmission } from "./ecos-v2-owner-preview-admission.ts";
import { createECOSV2JSONModel } from "./ecos-v2-json-model.ts";
import { createECOSOwnerBridgeModel } from "./ecos-owner-model-bridge.ts";
import {
  createECOSV2OwnerEvidenceRPCTransport,
  createECOSV2OwnerPageSearchRPCTransport,
  createECOSV2OwnerRasterReadRPCTransport,
  createECOSV2OwnerRecordsRPCTransport,
  createECOSV2PreviewRPCTransport,
  ECOS_V2_PREVIEW_RPC_PROJECT_URL,
} from "./ecos-v2-preview-rpc-transport.ts";
import { createECOSOwnerRasterDownloadTransport } from "./ecos-owner-raster-images.ts";

export interface ECOSOwnerPreviewRuntimeConfig {
  anonKey: string;
  serviceRoleKey: string;
  apiKey?: string;
  /** Server-only alternative; never send the provider key out of Supabase. */
  bridgeWorkerToken?: string;
  model: string;
  gatewayToken: string;
  enabled: boolean;
  fetchImpl?: typeof fetch;
}
const unavailable = () =>
  new Error("Invalid owner preview runtime configuration");
const reply = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });

/** Dedicated memory-provisioned server assembly. Never import this module into
 * a client or the thin Edge gateway: original image decoding can exceed Edge
 * memory. Private gateway authentication is additional to, NOT a substitute for,
 * the actual customer bearer/owner authorization performed twice by the handler.
 * No source claims, publication, fallback model, session writes or legacy route.
 */
export function createECOSOwnerPreviewRuntime(
  config: ECOSOwnerPreviewRuntimeConfig,
): (request: Request) => Promise<Response> {
  return createOwnerRuntime(config, false);
}
export function createECOSOwnerOperationalPreviewRuntime(
  config: ECOSOwnerPreviewRuntimeConfig,
): (request: Request) => Promise<Response> {
  return createOwnerRuntime(config, true);
}
function createOwnerRuntime(
  config: ECOSOwnerPreviewRuntimeConfig,
  operational: boolean,
): (request: Request) => Promise<Response> {
  if (!config || Object.getPrototypeOf(config) !== Object.prototype) {
    throw unavailable();
  }
  const descriptors = Object.getOwnPropertyDescriptors(config);
  const required = [
    "anonKey",
    "serviceRoleKey",
    "model",
    "gatewayToken",
    "enabled",
  ];
  if (
    Reflect.ownKeys(config).some((key) =>
      typeof key !== "string" ||
      ![...required, "apiKey", "bridgeWorkerToken", "fetchImpl"].includes(key)
    ) ||
    required.some((key) => !Object.hasOwn(descriptors, key)) ||
    Object.hasOwn(descriptors, "apiKey") ===
      Object.hasOwn(descriptors, "bridgeWorkerToken") ||
    Object.values(descriptors).some((d) =>
      !d.enumerable || !Object.hasOwn(d, "value")
    )
  ) throw unavailable();
  const {
    anonKey,
    serviceRoleKey,
    apiKey,
    bridgeWorkerToken,
    model,
    gatewayToken,
    enabled,
    fetchImpl = fetch,
  } = config;
  if (
    typeof enabled !== "boolean" || typeof fetchImpl !== "function" ||
    ![anonKey, serviceRoleKey].every((v) =>
      typeof v === "string" && /^[!-~]{1,8192}$/.test(v)
    ) ||
    typeof gatewayToken !== "string" ||
    !/^[A-Za-z0-9_-]{32,256}$/.test(gatewayToken)
  ) throw unavailable();
  // Validate model config at startup without sending anything. A separate
  // bounded model object is then created for each admitted question.
  const modelFactory = Object.hasOwn(descriptors, "bridgeWorkerToken")
    ? () =>
      createECOSOwnerBridgeModel({
        serviceRoleKey,
        workerToken: bridgeWorkerToken!,
        model,
        fetchImpl,
        maxCalls: 4,
        timeoutMs: 30000,
      })
    : () =>
      createECOSV2JSONModel({
        apiKey: apiKey!,
        model,
        fetchImpl,
        maxCalls: 4,
        timeoutMs: 30000,
      });
  modelFactory();
  const expectedTokenDigest = crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(gatewayToken),
  );
  const dependencies: ECOSOwnerOperationalPreviewDependencies = {
    enabled,
    allowedOrigins: ["https://project-photo-update-tool.expo.app"],
    budgetMs: 120000,
    authorize: createECOSV2OwnerPreviewAuthorizer({
      supabaseUrl: ECOS_V2_PREVIEW_RPC_PROJECT_URL,
      anonKey,
      fetchImpl,
    }),
    admit: async (scope, requestId, signal, requestSha256) => {
      const { admissionRPC } = createECOSV2PreviewRPCTransport({
        serviceRoleKey,
        scope,
        fetchImpl,
        timeoutMs: 5000,
      });
      return await createECOSV2OwnerPreviewAdmission({
        rpc: admissionRPC,
        timeoutMs: 5000,
        cleanupTimeoutMs: 1000,
      })(scope, requestId, signal, requestSha256);
    },
    evidenceFactory: (scope) => {
      const options = { serviceRoleKey, scope, fetchImpl };
      return {
        inventoryRPC:
          createECOSV2PreviewRPCTransport(options).ownerInventoryRPC,
        pageRPC: createECOSV2OwnerEvidenceRPCTransport(options),
        searchRPC: createECOSV2OwnerPageSearchRPCTransport(options),
        rasterRPC: createECOSV2OwnerRasterReadRPCTransport(options),
        download: createECOSOwnerRasterDownloadTransport(options),
        recordRPC: createECOSV2OwnerRecordsRPCTransport(options),
      };
    },
    modelFactory,
  };
  const handler = operational
    ? createECOSOwnerOperationalPreviewHandler(dependencies)
    : createECOSOwnerPreviewHandler({
      ...dependencies,
      evidenceFactory: (scope) => {
        const p = dependencies.evidenceFactory(scope);
        return {
          inventoryRPC: p.inventoryRPC,
          pageRPC: p.pageRPC,
          searchRPC: p.searchRPC,
          rasterRPC: p.rasterRPC,
          download: p.download,
        };
      },
    });
  return async (request) => {
    const url = new URL(request.url);
    if (
      request.method === "GET" && url.pathname === "/healthz" && !url.search
    ) {
      return reply({
        service: "ecos-owner-preview",
        protocol: operational
          ? "ecos-question-preview/2.2"
          : "ecos-question-preview/2.1",
        enabled,
        sourceReadiness: "not_assessed",
        modelReadiness: "not_assessed",
      });
    }
    if (url.pathname !== "/question" || url.search) {
      return reply({ error: "not_found" }, 404);
    }
    if (request.signal.aborted) {
      return reply({ error: "preview_cancelled", answer: null }, 503);
    }
    const supplied = request.headers.get("x-ecos-preview-gateway-token");
    if (!supplied || !/^[A-Za-z0-9_-]{32,256}$/.test(supplied)) {
      return reply({ error: "gateway_required" }, 403);
    }
    const actual = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(supplied)),
    );
    const expected = new Uint8Array(await expectedTokenDigest);
    let difference = 0;
    for (let i = 0; i < expected.length; i++) {
      difference |= expected[i] ^ actual[i];
    }
    if (difference !== 0) return reply({ error: "gateway_required" }, 403);
    if (request.signal.aborted) {
      return reply({ error: "preview_cancelled", answer: null }, 503);
    }
    return await handler(request);
  };
}
