import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { parseECOSStructuredObjectText } from './ecos-structured-provider-output.ts';

Deno.test('parses a strict structured object', () => {
  const result = parseECOSStructuredObjectText('{"facts":[],"verified":true}');
  assertEquals(result.failureReason, null);
  assertEquals(result.value, { facts: [], verified: true });
});

Deno.test('accepts only a whole-response JSON code fence', () => {
  const result = parseECOSStructuredObjectText('```json\n{"facts":[]}\n```');
  assertEquals(result.failureReason, null);
  assertEquals(result.value, { facts: [] });
});

Deno.test('rejects truncated JSON instead of repairing unsupported evidence', () => {
  const result = parseECOSStructuredObjectText('{"facts":[');
  assertEquals(result.failureReason, 'invalid_json');
  assertEquals(result.value, null);
});

Deno.test('rejects surrounding prose and array roots', () => {
  assertEquals(
    parseECOSStructuredObjectText('Answer: {"facts":[]}').failureReason,
    'invalid_json',
  );
  assertEquals(parseECOSStructuredObjectText('[]').failureReason, 'not_an_object');
});

Deno.test('reports a missing provider response', () => {
  assertEquals(parseECOSStructuredObjectText('  ').failureReason, 'missing_output_text');
});
