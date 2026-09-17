import { createECOSAgentModelBridgeHandler } from "../ecos-agent-model-bridge/index.ts";

type DeepSeekBridgeConfig = Readonly<{
  serviceRoleKey: string;
  workerToken: string;
  deepSeekKey: string;
  fetchImplementation?: typeof fetch;
  allowDrawingImages?: boolean;
}>;

export function createECOSAgentDeepSeekModelBridgeHandler(
  config: DeepSeekBridgeConfig,
) {
  return createECOSAgentModelBridgeHandler({
    serviceRoleKey: config.serviceRoleKey,
    workerToken: config.workerToken,
    provider: "deepseek",
    providerKey: config.deepSeekKey,
    fetchImplementation: config.fetchImplementation,
    allowDrawingImages: config.allowDrawingImages,
  });
}

if (import.meta.main) {
  const required = (name: string) => {
    const value = Deno.env.get(name)?.trim();
    if (!value) {
      throw new Error("private_agent_model_configuration_unavailable");
    }
    return value;
  };
  Deno.serve(createECOSAgentDeepSeekModelBridgeHandler({
    serviceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
    workerToken: required("ECOS_SERVICE_WORKER_TOKEN"),
    deepSeekKey: required("DEEPSEEK_API_KEY"),
    allowDrawingImages: Deno.env.get("ECOS_DRAWING_IMAGE_RESEARCH") === "enabled",
  }));
}
