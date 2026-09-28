export type PhotoAnalysisPriorCandidate = Readonly<{
  update: Readonly<{ id: string }>;
  photo: Readonly<{
    id: string;
    photoIntelligence?: Readonly<{
      diagnostics?: Readonly<{
        selectedPriorPhotoId?: string | null;
        selectedPriorUpdateId?: string | null;
      }> | null;
    }> | null;
  }>;
}>;

// The photo a recorded analysis actually compared against, when that photo is
// among `photos`. Returns null when the analysis names no prior or the named
// prior is not loaded, so callers can fall back to a chronological stand-in.
export function analysisComparedPriorPhoto<T extends PhotoAnalysisPriorCandidate>(
  selected: T,
  photos: readonly T[],
): T | null {
  const diagnostics = selected.photo.photoIntelligence?.diagnostics;
  const priorPhotoId = text(diagnostics?.selectedPriorPhotoId);
  if (!priorPhotoId || priorPhotoId === selected.photo.id) return null;
  const priorUpdateId = text(diagnostics?.selectedPriorUpdateId);

  return photos.find(candidate =>
    candidate.photo.id === priorPhotoId &&
    (!priorUpdateId || candidate.update.id === priorUpdateId),
  ) ?? null;
}

// Stored analyses arrive from cloud JSON without runtime validation.
function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
