import { assertEquals } from 'jsr:@std/assert@1.0.18';
import {
  strictNormalizedBounds,
  strictPositiveInteger,
  validPDFAnnotationEvidenceId,
} from './ecos-sheet-provenance-validation.ts';

Deno.test('accepts exact numeric sheet-provenance page and bounds values', () => {
  assertEquals(strictPositiveInteger(6), 6);
  assertEquals(validPDFAnnotationEvidenceId('pdf-annotation-324-page-6', 6), true);
  assertEquals(strictNormalizedBounds({
    x: 0.952546,
    y: 0.907986,
    width: 0.013889,
    height: 0.013889,
  }), {
    x: 0.952546,
    y: 0.907986,
    width: 0.013889,
    height: 0.013889,
  });
});

Deno.test('rejects coerced, fractional, and non-finite page values', () => {
  for (const value of ['6', 6.9, true, false, Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
    assertEquals(strictPositiveInteger(value), null);
  }
  assertEquals(validPDFAnnotationEvidenceId('pdf-annotation-324-page-6', 6.9), false);
});

Deno.test('rejects string, boolean, non-finite, and out-of-range normalized bounds', () => {
  const valid = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 };
  const rejected: unknown[] = [
    { ...valid, x: '0.1' },
    { ...valid, y: true },
    { ...valid, width: Number.NaN },
    { ...valid, height: Number.POSITIVE_INFINITY },
    { ...valid, x: -0.1 },
    { ...valid, y: 1.1 },
    { ...valid, width: 0 },
    { ...valid, height: -0.1 },
    { x: 0.9, y: 0.2, width: 0.2, height: 0.4 },
    { x: 0.1, y: 0.9, width: 0.3, height: 0.2 },
    [],
    null,
  ];
  for (const value of rejected) assertEquals(strictNormalizedBounds(value), null);
});
