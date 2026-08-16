import {
  ecosGeminiPrepaymentFallback,
} from './ecos-drawing-provider-capacity.ts';

const assertEquals = (actual: unknown, expected: unknown, message: string) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: ${JSON.stringify(actual)}`);
  }
};

Deno.test('uses only the independently authorized OpenAI fallback for depleted Gemini credit', () => {
  assertEquals(
    ecosGeminiPrepaymentFallback('', 'gpt-5.4-mini'),
    { visionProvider: 'openai', model: 'gpt-5.4-mini' },
    'default fallback mismatch',
  );
  assertEquals(
    ecosGeminiPrepaymentFallback('openai', 'gpt-5.4-mini'),
    { visionProvider: 'openai', model: 'gpt-5.4-mini' },
    'explicit fallback mismatch',
  );
});

Deno.test('does not retry depleted credit through Gemini or a disabled provider', () => {
  for (const configured of ['gemini', 'disabled', 'none', 'off']) {
    assertEquals(
      ecosGeminiPrepaymentFallback(configured, 'gpt-5.4-mini'),
      null,
      `${configured} must not authorize a fallback`,
    );
  }
  assertEquals(ecosGeminiPrepaymentFallback('openai', '  '), null, 'blank model must fail closed');
});
