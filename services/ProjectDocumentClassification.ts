export const PROJECT_DOCUMENT_CATEGORIES = [
  'Schedule',
  'Permit Card',
  'Drawing',
  'Scope',
  'Contract',
  'Inspection',
  'Safety',
  'Compliance',
  'RFI / Field Decision',
  'Vendor Document',
  'Other',
] as const;

export type ProjectDocumentCategory = typeof PROJECT_DOCUMENT_CATEGORIES[number];

export function suggestProjectDocumentCategory(input: {
  name?: string | null;
  mimeType?: string | null;
}): ProjectDocumentCategory {
  const text = `${input.name || ''} ${input.mimeType || ''}`.toLowerCase();

  if (/schedule|look[ -]?ahead|gantt/.test(text)) return 'Schedule';
  if (/permit/.test(text)) return 'Permit Card';
  if (/drawing|blueprint|site[ -]?plan|floor[ -]?plan/.test(text)) return 'Drawing';
  if (/scope|statement of work|\bsow\b/.test(text)) return 'Scope';
  if (/contract|agreement/.test(text)) return 'Contract';
  if (/inspection|punch[ -]?list/.test(text)) return 'Inspection';
  if (/safety|\bjsa\b|job safety/.test(text)) return 'Safety';
  if (/compliance|certification/.test(text)) return 'Compliance';
  if (/\brfi\b|field[ -]?decision/.test(text)) return 'RFI / Field Decision';
  if (/vendor|submittal|cut[ -]?sheet|product data/.test(text)) return 'Vendor Document';
  return 'Other';
}
