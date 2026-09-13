const DRAWING_CATEGORIES = new Set(['drawing', 'plans']);

/** Mirrors public.ecos_reference_document_category for drawing-family checks. */
export function isECOSDrawingCategory(value: unknown) {
  return typeof value === 'string' && DRAWING_CATEGORIES.has(
    value.trim().toLowerCase().replace(/\s+/g, ' '),
  );
}
