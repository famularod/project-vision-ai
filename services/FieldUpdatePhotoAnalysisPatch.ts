/**
 * A photo analysis result that finished after its field update was saved,
 * sent on its own (whole-app audit A4 pass 13 G1, 30 Sep 2026).
 *
 * A late result queued this phone's whole copy of the update again, stamped
 * now. When the iPad had edited the note meanwhile, the conflict check read
 * the phone's copy as the newer one, and its older note went over the iPad's.
 * The result now waits in the queue as a patch, with the document changes
 * (FieldUpdateDocumentPatch), and goes onto the cloud's current copy at
 * upload: the photo's analysis and the update's analysis summary, nothing
 * else of this phone's copy.
 */

type UpdatePhoto = Readonly<{ id: string; photoIntelligence?: unknown }>;
type UpdateWithPhotos = Readonly<{ photos?: readonly UpdatePhoto[] | null }>;

/** The update's summary of its photos' analysis, as the phone has it with the result: always sent. */
const ANALYSIS_SUMMARY_FIELDS = ['pieStatus', 'pieSummary', 'pieStartedAt', 'pieCompletedAt'] as const;
/** What a result may clear or fill in with an empty value: sent only when it did, so an iPad's own value stays. */
const ANALYSIS_CLEARED_FIELDS = ['observedFindings', 'possibleInterpretations', 'pieSuggestedNote', 'pieSuggestedNoteAccepted'] as const;

/** One photo's analysis result, and the update's analysis fields that go with it. */
export type FieldUpdatePhotoAnalysisPatch = Readonly<{
  photoId: string;
  photoIntelligence: unknown;
  analysis: Readonly<Record<string, unknown>>;
}>;

export function isFieldUpdatePhotoAnalysisPatch(patch: object): patch is FieldUpdatePhotoAnalysisPatch {
  return typeof (patch as { photoId?: unknown }).photoId === 'string';
}

/** The patch that brings `before` to `after`, the same update with this photo's result. */
export function fieldUpdatePhotoAnalysisPatchFor(before: object, after: object, photoId: string): FieldUpdatePhotoAnalysisPatch {
  const was = before as Record<string, unknown>;
  const now = after as Record<string, unknown>;
  return {
    photoId,
    photoIntelligence: (after as UpdateWithPhotos).photos?.find(photo => photo.id === photoId)?.photoIntelligence ?? null,
    analysis: Object.fromEntries([
      ...ANALYSIS_SUMMARY_FIELDS,
      ...ANALYSIS_CLEARED_FIELDS.filter(field => !sameValue(was[field], now[field])),
    ].map(field => [field, now[field] ?? null])),
  };
}

/**
 * The update with the result; the same object when it has it already. A
 * photo the update no longer lists is not added back: it was taken off
 * elsewhere.
 */
export function applyFieldUpdatePhotoAnalysisPatch<TUpdate extends object>(
  update: TUpdate,
  patch: FieldUpdatePhotoAnalysisPatch,
): TUpdate {
  const photos = (update as UpdateWithPhotos).photos;
  const photo = Array.isArray(photos) ? photos.find(item => item?.id === patch.photoId) : undefined;
  if (!photos || !photo) return update;
  const current = update as Record<string, unknown>;
  if (
    sameValue(photo.photoIntelligence, patch.photoIntelligence) &&
    Object.entries(patch.analysis).every(([field, value]) => sameValue(current[field], value))
  ) return update;
  return {
    ...update,
    ...patch.analysis,
    photos: photos.map(item => item.id === patch.photoId ? { ...item, photoIntelligence: patch.photoIntelligence } : item),
  };
}

/**
 * The update without its photos' analysis and its analysis summary. A result
 * is not an edit: a sync attempt that read the update before a result landed
 * keeps the time David saved it (whole-app audit A4 pass 13 G1).
 */
export function withoutPhotoAnalysis(update: unknown): unknown {
  if (!update || typeof update !== 'object') return update;
  const rest: Record<string, unknown> = { ...update };
  [...ANALYSIS_SUMMARY_FIELDS, ...ANALYSIS_CLEARED_FIELDS].forEach(field => { delete rest[field]; });
  const photos = (update as UpdateWithPhotos).photos;
  if (Array.isArray(photos)) {
    rest.photos = photos.map(photo => {
      if (!photo || typeof photo !== 'object') return photo;
      const { photoIntelligence: _photoIntelligence, ...other } = photo;
      return other;
    });
  }
  return rest;
}

/**
 * Whether the update holds a result for the patch's photo that finished
 * later than the patch's (whole-app audit A4 pass 23 L2): by the results'
 * own times; a photo still analysing has none.
 */
export function photoAnalysisFinishedAfterPatch(update: object, patch: FieldUpdatePhotoAnalysisPatch): boolean {
  const finishedAt = (analysis: unknown) => {
    const { status, updatedAt } = (analysis && typeof analysis === 'object' ? analysis : {}) as { status?: unknown; updatedAt?: unknown };
    return typeof status === 'string' && status !== 'analyzing'
      ? Date.parse(typeof updatedAt === 'string' ? updatedAt : '') || 0 : null;
  };
  const held = finishedAt((update as UpdateWithPhotos).photos?.find(photo => photo?.id === patch.photoId)?.photoIntelligence);
  return held !== null && held > (finishedAt(patch.photoIntelligence) ?? 0);
}

/** A later result for the same photo: its own, with what the earlier one cleared. */
export function mergeFieldUpdatePhotoAnalysisPatches(
  earlier: FieldUpdatePhotoAnalysisPatch,
  incoming: FieldUpdatePhotoAnalysisPatch,
): FieldUpdatePhotoAnalysisPatch {
  return { ...incoming, analysis: { ...earlier.analysis, ...incoming.analysis } };
}

/** The same value, key order aside (a cloud copy comes back with its keys in another order); null for none. */
function sameValue(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right);
}

function stableJson(value: unknown): string {
  if (value === undefined || value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter(key => record[key] !== undefined).sort()
      .map(key => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
