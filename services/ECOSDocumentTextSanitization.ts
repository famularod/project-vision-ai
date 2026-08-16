const UNSUPPORTED_JSON_CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/**
 * Removes invisible control characters that can be emitted by CAD/PDF text
 * layers but cannot be stored in PostgreSQL jsonb (notably U+0000).
 */
export function sanitizeECOSDocumentText(value: unknown): string {
  return typeof value === 'string'
    ? value
      .replace(UNSUPPORTED_JSON_CONTROL_CHARACTERS, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    : '';
}
