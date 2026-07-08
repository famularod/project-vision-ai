export type AIProviderName = 'edge-function-only';

export type AIConfigurationStatus = {
  configured: false;
  provider: AIProviderName;
  model: string;
  message: string;
};

export type AIEnvironmentStatus = {
  providerDetected: AIProviderName;
  modelDetected: string;
  apiKeyPresent: false;
  endpointDetected: string;
};

export function getAIEnvironmentStatus(): AIEnvironmentStatus {
  return {
    providerDetected: 'edge-function-only',
    modelDetected: 'server-managed',
    apiKeyPresent: false,
    endpointDetected: 'supabase-edge-function',
  };
}

export function getAIConfigurationStatus(): AIConfigurationStatus {
  return {
    configured: false,
    provider: 'edge-function-only',
    model: 'server-managed',
    message:
      'Direct mobile AI providers are disabled. Photo intelligence runs through the Supabase Edge Function.',
  };
}
