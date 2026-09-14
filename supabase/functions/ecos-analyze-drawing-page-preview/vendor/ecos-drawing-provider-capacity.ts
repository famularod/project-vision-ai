export type ECOSDrawingCapacityProvider = 'openai' | 'gemini';

export type ECOSDrawingCapacityFallback = Readonly<{
  visionProvider: ECOSDrawingCapacityProvider;
  model: string;
}>;

export function ecosGeminiPrepaymentFallback(
  configuredProvider: unknown,
  openAIModel: string,
): ECOSDrawingCapacityFallback | null {
  const configured = typeof configuredProvider === 'string'
    ? configuredProvider.trim().toLowerCase()
    : '';
  if (configured === 'disabled' || configured === 'none' || configured === 'off') return null;
  if (configured && configured !== 'openai') return null;
  const model = openAIModel.trim();
  return model ? Object.freeze({ visionProvider: 'openai', model }) : null;
}

