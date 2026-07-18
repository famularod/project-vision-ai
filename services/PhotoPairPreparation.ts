export const MAX_PHOTO_SOURCE_BYTES = 12 * 1024 * 1024;
export const MAX_PHOTO_DIMENSION_PIXELS = 12_000;
export const MAX_PHOTO_PIXEL_COUNT = 50_000_000;

export type PhotoSourceLimitFailure =
  | 'too_large'
  | 'invalid_dimensions'
  | 'dimensions_too_large';

export type PhotoSourceMetadata = Readonly<{
  sizeBytes: number;
  width: number;
  height: number;
}>;

export type RankedPriorPhotoCandidate<TPhoto> = Readonly<{
  photo: TPhoto;
  continuityScore: number;
  capturedAt: number;
  candidateIndex: number;
}>;

export function validatePhotoSourceLimits(
  metadata: PhotoSourceMetadata,
): { ok: true } | { ok: false; reason: PhotoSourceLimitFailure } {
  if (metadata.sizeBytes > MAX_PHOTO_SOURCE_BYTES) {
    return { ok: false, reason: 'too_large' };
  }

  if (
    !Number.isFinite(metadata.width) ||
    !Number.isFinite(metadata.height) ||
    metadata.width <= 0 ||
    metadata.height <= 0
  ) {
    return { ok: false, reason: 'invalid_dimensions' };
  }

  if (
    metadata.width > MAX_PHOTO_DIMENSION_PIXELS ||
    metadata.height > MAX_PHOTO_DIMENSION_PIXELS ||
    metadata.width * metadata.height > MAX_PHOTO_PIXEL_COUNT
  ) {
    return { ok: false, reason: 'dimensions_too_large' };
  }

  return { ok: true };
}

export async function readPhotoBase64WithinLimits(
  metadata: PhotoSourceMetadata,
  readBase64: () => Promise<string>,
): Promise<
  | { ok: true; base64: string }
  | { ok: false; reason: PhotoSourceLimitFailure }
> {
  const validation = validatePhotoSourceLimits(metadata);
  if (!validation.ok) return validation;
  return { ok: true, base64: await readBase64() };
}

export function rankPriorPhotoCandidates<
  TCandidate extends RankedPriorPhotoCandidate<unknown>,
>(candidates: readonly TCandidate[]): TCandidate[] {
  return [...candidates].sort(
    (left, right) =>
      right.continuityScore - left.continuityScore ||
      right.capturedAt - left.capturedAt ||
      left.candidateIndex - right.candidateIndex,
  );
}

export function selectWinningPriorPhotoCandidate<
  TCandidate extends RankedPriorPhotoCandidate<unknown>,
>(
  confirmedAreaCandidates: readonly TCandidate[],
  areaFallbackCandidates: readonly TCandidate[],
): TCandidate | null {
  return rankPriorPhotoCandidates(confirmedAreaCandidates)[0] ??
    rankPriorPhotoCandidates(areaFallbackCandidates)[0] ??
    null;
}

export async function prepareSelectedPhotoPair<TPhoto, TPrepared extends { ok: boolean }>(
  input: Readonly<{
    currentPhoto: TPhoto;
    priorPhoto: TPhoto;
    prepare: (photo: TPhoto, role: 'current' | 'prior') => Promise<TPrepared>;
  }>,
): Promise<Readonly<{
  current: TPrepared;
  prior: TPrepared | null;
}>> {
  const current = await input.prepare(input.currentPhoto, 'current');
  if (!current.ok) return { current, prior: null };

  const prior = await input.prepare(input.priorPhoto, 'prior');
  return { current, prior };
}
