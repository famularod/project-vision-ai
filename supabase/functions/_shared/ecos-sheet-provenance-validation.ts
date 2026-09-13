export type ECOSNormalizedBounds = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export function strictPositiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : null;
}

export function strictNormalizedBounds(value: unknown): ECOSNormalizedBounds | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const bounds = value as Record<string, unknown>;
  const x = strictNormalizedNumber(bounds.x);
  const y = strictNormalizedNumber(bounds.y);
  const width = strictNormalizedNumber(bounds.width);
  const height = strictNormalizedNumber(bounds.height);
  if (x == null || y == null || width == null || height == null ||
      width <= 0 || height <= 0 || x + width > 1.001 || y + height > 1.001) return null;
  return { x, y, width, height };
}

export function validPDFAnnotationEvidenceId(id: string, pageNumber: number): boolean {
  if (strictPositiveInteger(pageNumber) == null) return false;
  const match = /^pdf-annotation-[0-9]+-page-([1-9][0-9]*)$/.exec(id);
  return Boolean(match && match[1] === String(pageNumber));
}

function strictNormalizedNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null;
}
