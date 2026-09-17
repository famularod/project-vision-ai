import type { ReferenceDocument } from '../types';

/** Suggestions are editable upload labels, never page identity or answer evidence. */
export function suggestECOSDrawingIntake(fileName: string) {
  const name = fileName.split(/[\\/]/).at(-1)?.replace(/\.[^.]+$/, '') || '';
  const words = name.replace(/[_-]+/g, ' ');
  const disciplines = [
    ['Architectural', /\barchitectural\b/i],
    ['Civil', /\bcivil\b/i],
    ['Electrical', /\belectrical\b/i],
    ['Structural', /\bstructural\b/i],
    ['Mechanical', /\bmechanical\b/i],
    ['Plumbing', /\bplumbing\b/i],
    ['Fire Protection', /\bfire\s+protection\b/i],
    ['Landscape', /\blandscape\b/i],
  ] as const;
  const matches = disciplines.filter(([, pattern]) => pattern.test(words)).map(([label]) => label);
  const sheets = [...name.toUpperCase().matchAll(/(?:^|[\s_])([ACEMPS](?:-?\d{1,3}\.\d{1,3}|-\d{1,3}))(?=$|[\s_])/g)]
    .map(match => match[1]);
  const uniqueSheets = [...new Set(sheets)];
  const revisions = [...words.matchAll(/\brev(?:ision)?\s*\.?\s*([A-Z]|\d{1,3})\b/gi)].map(match => match[1].toUpperCase());
  const uniqueRevisions = [...new Set(revisions)];
  return Object.freeze({
    drawingDiscipline: matches.join(' / '),
    drawingNumber: uniqueSheets.length === 1 ? uniqueSheets[0] : '',
    drawingRevision: uniqueRevisions.length === 1 ? uniqueRevisions[0] : '',
  });
}

export function mergeECOSDrawingIntakeSuggestion(current: string, previousSuggestion: string, nextSuggestion: string) {
  return !current.trim() || current === previousSuggestion ? nextSuggestion : current;
}

/** Use the reviewed form at SAVE time, not a stale file-selection snapshot. */
export function reviewedECOSDrawingUpload<T extends ReferenceDocument>(
  document: T,
  controls: Readonly<{
    drawingNumber: string;
    drawingRevision: string;
    drawingDiscipline: string;
    drawingStatus: NonNullable<ReferenceDocument['drawingStatus']>;
    drawingIssuedAt: string;
  }>,
): T {
  return {
    ...document,
    drawingNumber: controls.drawingNumber.trim(),
    drawingRevision: controls.drawingRevision.trim(),
    drawingDiscipline: controls.drawingDiscipline.trim() || null,
    drawingStatus: controls.drawingStatus,
    drawingIssuedAt: controls.drawingIssuedAt.trim() || null,
  };
}
