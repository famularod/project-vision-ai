export type ECOSStructuredObjectParseResult = Readonly<{
  value: Record<string, unknown> | null;
  normalizedText: string;
  failureReason: 'missing_output_text' | 'invalid_json' | 'not_an_object' | null;
}>;

export function parseECOSStructuredObjectText(output: unknown): ECOSStructuredObjectParseResult {
  const raw = typeof output === 'string' ? output.trim() : '';
  if (!raw) {
    return Object.freeze({
      value: null,
      normalizedText: '',
      failureReason: 'missing_output_text',
    });
  }

  // Some providers occasionally wrap an otherwise valid JSON response in one
  // complete Markdown fence even when JSON output was requested. Accept only
  // a fence that contains the entire response; never extract a JSON-looking
  // substring from surrounding prose.
  const fenced = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const normalizedText = (fenced?.[1] ?? raw).trim();

  try {
    const parsed = JSON.parse(normalizedText);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return Object.freeze({ value: null, normalizedText, failureReason: 'not_an_object' });
    }
    return Object.freeze({
      value: parsed as Record<string, unknown>,
      normalizedText,
      failureReason: null,
    });
  } catch {
    return Object.freeze({ value: null, normalizedText, failureReason: 'invalid_json' });
  }
}
