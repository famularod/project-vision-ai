export type PhotoDirectoryCleanupFile = Readonly<{
  uri: string;
  modificationTimeMs: number | null;
}>;

export type PhotoDirectoryCleanupStorage = Readonly<{
  getAllKeys(): Promise<readonly string[]>;
  multiGet(keys: readonly string[]): Promise<readonly (readonly [string, string | null])[]>;
}>;

export type PhotoDirectoryCleanupFileSystem = Readonly<{
  getInfoAsync(uri: string): Promise<Readonly<{
    exists: boolean;
    modificationTime?: number;
  }>>;
  readDirectoryAsync(uri: string): Promise<string[]>;
  deleteAsync(uri: string, options: { idempotent: boolean }): Promise<void>;
}>;

export const PROJECT_PHOTO_CLEANUP_MINIMUM_AGE_MS = 14 * 24 * 60 * 60 * 1_000;

export function selectProjectPhotoUrisForCleanup({
  files,
  referencedUris,
  referencedFileNames = new Set<string>(),
  currentOwnerId,
  hasStartupQuarantine,
  nowMs,
}: Readonly<{
  files: readonly PhotoDirectoryCleanupFile[];
  referencedUris: ReadonlySet<string>;
  /** Decoded file names referenced under ANY path prefix. iOS can change the
   * app container path after an update or reinstall, so a saved URI may carry
   * an old prefix while the file lives in the current folder. */
  referencedFileNames?: ReadonlySet<string>;
  currentOwnerId: string | null;
  hasStartupQuarantine: boolean;
  nowMs: number;
}>): string[] {
  if (!currentOwnerId || hasStartupQuarantine) return [];
  return files
    .filter(file =>
      !referencedUris.has(file.uri) &&
      !referencedFileNames.has(photoFileNameFromUri(file.uri)) &&
      file.modificationTimeMs !== null &&
      nowMs - file.modificationTimeMs >= PROJECT_PHOTO_CLEANUP_MINIMUM_AGE_MS,
    )
    .map(file => file.uri);
}

/**
 * Every file name referenced under `/<folderName>/` anywhere in the given
 * texts, regardless of path prefix, JSON nesting depth, backslash escaping or
 * percent-encoding. Deliberately a raw text scan: a reference hidden by a
 * parsing difference would otherwise let a photo in use be deleted.
 */
export function collectProjectPhotoFileNames(
  texts: readonly (string | null | undefined)[],
  folderName: string,
): ReadonlySet<string> {
  const names = new Set<string>();
  if (!folderName) return names;
  const marker = `/${folderName}/`;
  texts.forEach(raw => {
    if (typeof raw !== 'string' || raw.length === 0) return;
    textVariants(raw).forEach(text => {
      let start = text.indexOf(marker);
      while (start >= 0) {
        let end = start + marker.length;
        while (end < text.length && !/[\s"'\\/?#<>|]/.test(text[end])) end += 1;
        const name = text.slice(start + marker.length, end);
        if (name) {
          names.add(name);
          names.add(safeDecode(name));
        }
        start = text.indexOf(marker, end);
      }
    });
  });
  return names;
}

function textVariants(raw: string): string[] {
  const variants = new Set<string>([raw]);
  // Nested JSON strings escape "/" and quotes once per nesting level.
  let unescaped = raw;
  for (let depth = 0; depth < 4; depth += 1) {
    const next = unescaped.replace(/\\+(["/])/g, '$1');
    if (next === unescaped) break;
    unescaped = next;
    variants.add(unescaped);
  }
  Array.from(variants).forEach(text => {
    if (/%2f/i.test(text)) variants.add(text.replace(/%2f/gi, '/'));
  });
  return Array.from(variants);
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function photoFileNameFromUri(uri: string): string {
  const withoutQuery = uri.split(/[?#]/)[0];
  return safeDecode(withoutQuery.slice(withoutQuery.lastIndexOf('/') + 1));
}

export function storageContainsStartupQuarantine(keys: readonly string[]): boolean {
  return keys.some(key => {
    const normalized = key.toLowerCase();
    return (
      normalized.includes('.corrupt.') ||
      normalized.includes('.quarantine.') ||
      normalized.includes('%2ecorrupt%2e') ||
      normalized.includes('%2equarantine%2e')
    );
  });
}

export async function cleanupProjectPhotoDirectory({
  directoryUri,
  folderName,
  currentOwnerId,
  referencedUris,
  storage,
  fileSystem,
  now = () => Date.now(),
}: Readonly<{
  directoryUri: string | null;
  /** Owned folder name, e.g. "project-photos". Used to recognise references
   * that were saved under an older app-container path. */
  folderName: string;
  currentOwnerId: string | null;
  referencedUris: ReadonlySet<string>;
  storage: PhotoDirectoryCleanupStorage;
  fileSystem: PhotoDirectoryCleanupFileSystem;
  now?: () => number;
}>): Promise<readonly string[]> {
  if (!directoryUri || !folderName || !currentOwnerId) return [];
  let keys: readonly string[];
  let storedValues: readonly (readonly [string, string | null])[];
  try {
    keys = await storage.getAllKeys();
    if (storageContainsStartupQuarantine(keys)) return [];
    storedValues = await storage.multiGet(keys);
  } catch {
    // Cannot prove what is referenced, so nothing may be deleted.
    return [];
  }
  const referencedFileNames = new Set(collectProjectPhotoFileNames(
    [...Array.from(referencedUris), ...storedValues.map(([, raw]) => raw)],
    folderName,
  ));
  Array.from(referencedUris).forEach(uri =>
    referencedFileNames.add(photoFileNameFromUri(uri)),
  );
  const info = await fileSystem.getInfoAsync(directoryUri);
  if (!info.exists) return [];
  const filenames = await fileSystem.readDirectoryAsync(directoryUri);
  const files = await Promise.all(filenames.map(async filename => {
    const uri = `${directoryUri}${filename}`;
    const fileInfo = await fileSystem.getInfoAsync(uri);
    return {
      uri,
      modificationTimeMs: typeof fileInfo.modificationTime === 'number'
        ? fileInfo.modificationTime * 1_000
        : null,
    };
  }));
  // Files exist but no reference to this folder was found anywhere: treat as
  // "cannot prove" instead of "everything is unreferenced".
  if (files.length > 0 && referencedFileNames.size === 0) return [];
  const deletions = selectProjectPhotoUrisForCleanup({
    files,
    referencedUris,
    referencedFileNames,
    currentOwnerId,
    hasStartupQuarantine: false,
    nowMs: now(),
  });
  await Promise.all(deletions.map(uri =>
    fileSystem.deleteAsync(uri, { idempotent: true }),
  ));
  return deletions;
}
