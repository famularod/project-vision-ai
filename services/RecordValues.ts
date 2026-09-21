/**
 * Small value helpers shared by the record normalizers.
 *
 * Extracted from App.tsx 2026-09-20. They lived there only because everything
 * did; nothing about them is specific to the app shell, and keeping them there
 * forced the normalizers to stay too.
 */

export const uid = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export function optionalString(value: unknown) {
  return typeof value === 'string' && value.trim()
    ? value
    : null;
}
