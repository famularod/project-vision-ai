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
  currentOwnerId,
  hasStartupQuarantine,
  nowMs,
}: Readonly<{
  files: readonly PhotoDirectoryCleanupFile[];
  referencedUris: ReadonlySet<string>;
  currentOwnerId: string | null;
  hasStartupQuarantine: boolean;
  nowMs: number;
}>): string[] {
  if (!currentOwnerId || hasStartupQuarantine) return [];
  return files
    .filter(file =>
      !referencedUris.has(file.uri) &&
      file.modificationTimeMs !== null &&
      nowMs - file.modificationTimeMs >= PROJECT_PHOTO_CLEANUP_MINIMUM_AGE_MS,
    )
    .map(file => file.uri);
}

export function collectProjectPhotoReferences(
  values: readonly (readonly [string, string | null])[],
  directoryUri: string,
): ReadonlySet<string> {
  const references = new Set<string>();
  values.forEach(([, raw]) => {
    if (raw === null) return;
    try {
      collectUris(JSON.parse(raw), directoryUri, references, new Set());
    } catch {
      collectUrisFromRawText(raw, directoryUri, references);
    }
  });
  return references;
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
  currentOwnerId,
  referencedUris,
  storage,
  fileSystem,
  now = () => Date.now(),
}: Readonly<{
  directoryUri: string | null;
  currentOwnerId: string | null;
  referencedUris: ReadonlySet<string>;
  storage: PhotoDirectoryCleanupStorage;
  fileSystem: PhotoDirectoryCleanupFileSystem;
  now?: () => number;
}>): Promise<readonly string[]> {
  if (!directoryUri || !currentOwnerId) return [];
  const keys = await storage.getAllKeys();
  if (storageContainsStartupQuarantine(keys)) return [];
  const storedValues = await storage.multiGet(keys);
  const allReferencedUris = new Set(referencedUris);
  collectProjectPhotoReferences(storedValues, directoryUri).forEach(uri =>
    allReferencedUris.add(uri),
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
  const deletions = selectProjectPhotoUrisForCleanup({
    files,
    referencedUris: allReferencedUris,
    currentOwnerId,
    hasStartupQuarantine: false,
    nowMs: now(),
  });
  await Promise.all(deletions.map(uri =>
    fileSystem.deleteAsync(uri, { idempotent: true }),
  ));
  return deletions;
}

function collectUris(
  value: unknown,
  directoryUri: string,
  output: Set<string>,
  visited: Set<object>,
) {
  if (typeof value === 'string') {
    if (value.startsWith(directoryUri)) output.add(value);
    return;
  }
  if (!value || typeof value !== 'object' || visited.has(value)) return;
  visited.add(value);
  if (Array.isArray(value)) {
    value.forEach(item => collectUris(item, directoryUri, output, visited));
    return;
  }
  Object.values(value).forEach(item =>
    collectUris(item, directoryUri, output, visited),
  );
}

function collectUrisFromRawText(
  raw: string,
  directoryUri: string,
  output: Set<string>,
) {
  let start = raw.indexOf(directoryUri);
  while (start >= 0) {
    let end = start + directoryUri.length;
    while (end < raw.length && !/[\s"'\\]/.test(raw[end])) end += 1;
    output.add(raw.slice(start, end));
    start = raw.indexOf(directoryUri, end);
  }
}
