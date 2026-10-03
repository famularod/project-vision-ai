/**
 * How the phone reads a shared document's name and category (whole-app audit
 * A7 pass 7 L1, 30 Sep 2026). One rule for the normalizer and for the record
 * of the cloud copy's shared details (referenceDocumentSharedDetailsFingerprint):
 * the record is taken from the phone's normalized copy and compared, at
 * upload, with the cloud's row as listed. A row with a blank or unknown
 * category, or a blank name, read as "Other" or its file name on one side
 * only; the two never matched, and text typed just before Make Current was
 * dropped again.
 */

export const REFERENCE_DOCUMENT_CATEGORIES: ReadonlySet<string> = new Set([
  'Plans', 'Specifications', 'Permits', 'Inspection', 'Safety', 'Quality',
  'Contract', 'Change Order', 'RFI', 'Submittal', 'Environmental',
  'Electrical', 'Mechanical', 'Schedules', 'Schedule', 'Drawing', 'Scope',
  'Compliance', 'Permit Card', 'RFI / Field Decision', 'Vendor Document',
  'Report', 'Other',
]);

/** A known category, or "Other". */
export function referenceDocumentCategory(value: unknown): string {
  const category = trimmedText(value) || 'Other';
  return REFERENCE_DOCUMENT_CATEGORIES.has(category) ? category : 'Other';
}

/** The name, else the file name, else "Reference Document". */
export function referenceDocumentName(name: unknown, originalFileName: unknown): string {
  return trimmedText(name) || trimmedText(originalFileName) || 'Reference Document';
}

function trimmedText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
