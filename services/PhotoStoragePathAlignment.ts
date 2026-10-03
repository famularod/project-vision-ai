/**
 * Photos' cloud storage paths, when two copies of an update are compared.
 *
 * Staging stamps the path on the queued copy only, and the phone's own
 * copy lacks it until the cloud copy is merged back, so a missing path on
 * one side must not count as a difference (whole-app audit A4 batch 3,
 * 30 Sep 2026: the phone never matched its own upload echo). When both
 * sides carry a path, the paths are compared: a legacy path relocated on
 * the phone must still reach the cloud row the desktop reads (audit A4
 * pass 3: ignoring the path everywhere silently undid that relocation).
 */
type PhotoLike = Readonly<{ id?: unknown; cloudStoragePath?: unknown }>;
type UpdateLike = Readonly<{ photos?: unknown; [key: string]: unknown }>;

function pathOf(photo: PhotoLike): string {
  return typeof photo.cloudStoragePath === 'string' ? photo.cloudStoragePath.trim() : '';
}

function withoutPath<T extends PhotoLike>(photo: T): T {
  const { cloudStoragePath: _path, ...rest } = photo as T & { cloudStoragePath?: unknown };
  return rest as T;
}

/**
 * Both updates with the storage path key removed from both copies of any
 * photo that carries a path on only one side (a null or empty path on the
 * other side is removed too, so the two copies stringify alike).
 */
export function alignPhotoStoragePaths<TLeft extends UpdateLike, TRight extends UpdateLike>(
  left: TLeft,
  right: TRight,
): readonly [TLeft, TRight] {
  if (!Array.isArray(left.photos) || !Array.isArray(right.photos)) return [left, right];
  const byId = (photos: unknown[]) => {
    const map = new Map<unknown, PhotoLike>();
    for (const photo of photos as PhotoLike[]) {
      if (photo && typeof photo === 'object') map.set(photo.id, photo);
    }
    return map;
  };
  const leftById = byId(left.photos);
  const rightById = byId(right.photos);
  // Compared only when both copies carry a path; otherwise the key goes
  // from both, so null (a stored record) and absent (a fresh photo) also
  // read alike (audit A4 pass 4).
  const oneSided = (photo: PhotoLike, other: PhotoLike | undefined) =>
    Boolean(other) && (pathOf(photo) === '' || pathOf(other as PhotoLike) === '');
  const align = (photos: unknown[], others: Map<unknown, PhotoLike>) =>
    (photos as PhotoLike[]).map(photo =>
      photo && typeof photo === 'object' && 'cloudStoragePath' in photo && oneSided(photo, others.get(photo.id))
        ? withoutPath(photo)
        : photo,
    );
  return [
    { ...left, photos: align(left.photos, rightById) },
    { ...right, photos: align(right.photos, leftById) },
  ];
}
