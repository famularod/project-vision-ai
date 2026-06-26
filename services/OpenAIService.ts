export type AIProviderName = 'openai' | 'azure-openai' | 'custom';

export type AIProviderConfig = {
  provider: AIProviderName;
  apiKey: string;
  model: string;
  endpoint: string;
};

export type AIConfigurationStatus = {
  configured: boolean;
  provider: AIProviderName;
  model: string;
  message: string;
};

export type AIEnvironmentStatus = {
  providerDetected: AIProviderName;
  modelDetected: string;
  apiKeyPresent: boolean;
  endpointDetected: string;
};

export type GenerateAITextParams = {
  instructions: string;
  input: string;
};

type OpenAIResponseContent = {
  type?: string;
  text?: string;
};

type OpenAIResponseOutputItem = {
  type?: string;
  content?: OpenAIResponseContent[];
};

type OpenAIResponseBody = {
  output_text?: string;
  output?: OpenAIResponseOutputItem[];
  error?: {
    message?: string;
  };
};

const DEFAULT_OPENAI_MODEL = 'gpt-5.5';
const DEFAULT_OPENAI_RESPONSES_ENDPOINT = 'https://api.openai.com/v1/responses';

function configuredProvider(): AIProviderName {
  const value = process.env.EXPO_PUBLIC_AI_PROVIDER?.trim().toLowerCase();

  if (value === 'azure-openai' || value === 'custom') return value;

  return 'openai';
}

export function getAIEnvironmentStatus(): AIEnvironmentStatus {
  return {
    providerDetected: configuredProvider(),
    modelDetected:
      process.env.EXPO_PUBLIC_OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL,
    apiKeyPresent: Boolean(process.env.EXPO_PUBLIC_OPENAI_API_KEY?.trim()),
    endpointDetected:
      process.env.EXPO_PUBLIC_OPENAI_RESPONSES_URL?.trim() ||
      DEFAULT_OPENAI_RESPONSES_ENDPOINT,
  };
}

export function getAIProviderConfig(): AIProviderConfig | null {
  const environment = getAIEnvironmentStatus();
  const provider = environment.providerDetected;

  if (provider !== 'openai') return null;

  const apiKey = process.env.EXPO_PUBLIC_OPENAI_API_KEY?.trim();

  if (!apiKey) return null;

  return {
    provider,
    apiKey,
    model: environment.modelDetected,
    endpoint: environment.endpointDetected,
  };
}

export function getAIConfigurationStatus(): AIConfigurationStatus {
  const environment = getAIEnvironmentStatus();
  const provider = environment.providerDetected;
  const model = environment.modelDetected;

  if (provider !== 'openai') {
    return {
      configured: false,
      provider,
      model,
      message:
        'Only the OpenAI provider is wired in v1. Azure OpenAI and custom providers can use this abstraction in a later version.',
    };
  }

  if (!environment.apiKeyPresent) {
    return {
      configured: false,
      provider,
      model,
      message:
        'No OpenAI API key is configured. Add EXPO_PUBLIC_OPENAI_API_KEY to enable opt-in AI analysis, or continue with rule-based analysis.',
    };
  }

  return {
    configured: true,
    provider,
    model,
    message: 'OpenAI analysis is configured and will run only after you tap Analyze with AI.',
  };
}

function extractText(body: OpenAIResponseBody) {
  if (typeof body.output_text === 'string' && body.output_text.trim()) {
    return body.output_text;
  }

  const outputText = body.output
    ?.flatMap(item => item.content || [])
    .filter(content => content.type === 'output_text' || content.text)
    .map(content => content.text || '')
    .join('\n')
    .trim();

  return outputText || '';
}

export async function generateOpenAIText({
  instructions,
  input,
}: GenerateAITextParams) {
  const config = getAIProviderConfig();

  if (!config) {
    throw new Error(getAIConfigurationStatus().message);
  }

  const response = await fetch(config.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      instructions,
      input,
      max_output_tokens: 1400,
      store: false,
    }),
  });
  const body = (await response.json()) as OpenAIResponseBody;
  const text = extractText(body);

  if (!response.ok) {
    throw new Error(
      body.error?.message ||
        `OpenAI request failed with status ${response.status}.`,
    );
  }

  if (!text) {
    throw new Error('OpenAI returned an empty analysis response.');
  }

  return {
    text,
    provider: config.provider,
    model: config.model,
  };
}
