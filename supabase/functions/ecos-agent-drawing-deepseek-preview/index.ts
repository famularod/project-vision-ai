import { createECOSAgentDeepSeekModelBridgeHandler } from "../ecos-agent-deepseek-model-bridge/index.ts";

// Separate private acceptance endpoint. Existing customer bridge and global
// secrets/feature flags are unchanged. Both service and worker credentials are
// checked by the shared handler before any provider request or body parsing.
if (import.meta.main) {
  const required = (name: string) => {
    const value = Deno.env.get(name)?.trim();
    if (!value) throw new Error("private_agent_model_configuration_unavailable");
    return value;
  };
  Deno.serve(createECOSAgentDeepSeekModelBridgeHandler({
    serviceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
    workerToken: required("ECOS_SERVICE_WORKER_TOKEN"),
    deepSeekKey: required("DEEPSEEK_API_KEY"),
    allowDrawingImages: true,
  }));
}
