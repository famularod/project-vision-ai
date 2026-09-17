export const COUNT_READ_SOURCE = 'fixed_visual_tile_labeled_count_read';
export function countLabelIdentity(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const key = value.toUpperCase().replace(/[\s.!:\[\]()]+/g, ' ').trim();
  return ['QTY','QUANTITY','COUNT','OCC LOAD','OCCUPANT LOAD','OCCUPANCY LOAD'].includes(key) ? key : null;
}
export function exactPrintedCountFact(fact: Record<string, unknown>, label: string): boolean {
  if (typeof fact.statement !== 'string' || fact.statement !== fact.evidenceText) return false;
  const match = fact.statement.match(/^\s*([A-Za-z.! ]+)\s*:\s*(\d{1,5})\s*$/);
  return Boolean(match && countLabelIdentity(match[1]) && countLabelIdentity(match[1]) === countLabelIdentity(label));
}
export function privatePreparationMode(mode: unknown, jobId: string): boolean {
  return mode === 'shadow' || mode === 'shadow_refresh:' + jobId;
}
