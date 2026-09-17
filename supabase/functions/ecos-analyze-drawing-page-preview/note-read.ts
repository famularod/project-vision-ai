export const NOTE_READ_SOURCE = "fixed_visual_tile_note_transcription";

export function boundedPrivateNoteCandidate(candidate: Record<string, unknown>): boolean {
  const box = candidate.bounds as Record<string,unknown> | undefined;
  if (!box || typeof candidate.text !== 'string' || candidate.text.length > 500 ||
      (candidate.text.match(/[A-Za-z]{2,}/g) || []).length < 5) return false;
  const values = ['x','y','width','height'].map(key=>box[key]);
  if (values.some(value=>typeof value !== 'number' || !Number.isFinite(value))) return false;
  const [x,y,width,height] = values as number[];
  return x>=0 && y>=0 && width>0 && height>0 && width<=.164001 && height<=.054001 && x+width<=1 && y+height<=1;
}

/** A format/anchor check only. Independent blind pixel agreement is mandatory. */
export function exactPrintedNoteFact(fact: Record<string, unknown>, candidate: string): boolean {
  if (typeof fact.statement !== "string" || fact.statement !== fact.evidenceText ||
      fact.statement.length < 5 || fact.statement.length > 800) return false;
  const words = (value: string) => new Set(value.toLowerCase().match(/[a-z]{3,}/g) || []);
  const anchors = words(candidate);
  return [...words(fact.statement)].filter(word => anchors.has(word)).length >= 2;
}
