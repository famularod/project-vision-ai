export const OWNED_LOCAL_FILE_MANIFEST_VERSION = 1 as const;

export const OWNED_LOCAL_FILE_KINDS = [
  'photo',
  'reference_document',
  'project_document',
  'project_cover',
] as const;

export type OwnedLocalFileKind = typeof OWNED_LOCAL_FILE_KINDS[number];

export type OwnedLocalFileManifestRecord = Readonly<{
  version: typeof OWNED_LOCAL_FILE_MANIFEST_VERSION;
  fileId: string;
  kind: OwnedLocalFileKind;
  generatedBasename: string;
  sha256: string;
  sizeBytes: number;
  mimeType: string;
  relativePath: string;
}>;

export type OwnedLocalFileManifestRecordInput = Readonly<
  Omit<OwnedLocalFileManifestRecord, 'version'>
>;

export type OwnedLocalFileManifest = Readonly<{
  version: typeof OWNED_LOCAL_FILE_MANIFEST_VERSION;
  files: Readonly<Record<string, OwnedLocalFileManifestRecord>>;
}>;

export type ResolveOwnedLocalFilePathInput = Readonly<{
  ownedRoot: string;
  manifest: unknown;
  fileId: string;
  expectedKind?: OwnedLocalFileKind;
}>;

export type OwnedLocalFileAuthorizationInput = ResolveOwnedLocalFilePathInput & Readonly<{
  candidatePath: string;
}>;

export type LegacyOwnedLocalFileResolutionInput = Readonly<{
  ownedRoot: string;
  legacyFolderName: string;
  candidatePath: string;
}>;

const CANONICAL_UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const OPAQUE_FILE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{15,127}$/;
const EXTENSION_RE = /^[a-z0-9]{1,10}$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
const MIME_TYPE_RE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;
const CONTROL_CHARACTER_RE = /[\u0000-\u001f\u007f]/;
const URI_SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:/;

const RECORD_KEYS = [
  'version',
  'fileId',
  'kind',
  'generatedBasename',
  'sha256',
  'sizeBytes',
  'mimeType',
  'relativePath',
] as const;

const MANIFEST_KEYS = ['version', 'files'] as const;

/**
 * Generates the only basename shape accepted by an owned-file manifest.
 * Extensions are deliberately narrow and lowercase so the resulting value is
 * a filename, never a caller-controlled path.
 */
export function generateOwnedLocalFileBasename(
  fileId: string,
  extension: string,
): string {
  assertFileId(fileId);

  if (typeof extension !== 'string' || !EXTENSION_RE.test(extension)) {
    throw new TypeError(
      'Owned local file extension must be 1-10 lowercase alphanumeric characters.',
    );
  }

  return `${fileId}.${extension}`;
}

/**
 * Creates and validates an immutable manifest record. No source URI or caller
 * path is retained; the relative path must be the generated basename itself.
 */
export function createOwnedLocalFileManifestRecord(
  input: OwnedLocalFileManifestRecordInput,
): OwnedLocalFileManifestRecord {
  return parseOwnedLocalFileManifestRecord({
    version: OWNED_LOCAL_FILE_MANIFEST_VERSION,
    fileId: input.fileId,
    kind: input.kind,
    generatedBasename: input.generatedBasename,
    sha256: input.sha256,
    sizeBytes: input.sizeBytes,
    mimeType: input.mimeType,
    relativePath: input.relativePath,
  });
}

/**
 * Builds an immutable manifest keyed by exact file ID. Duplicate IDs are
 * rejected instead of silently replacing a previously authorized file.
 */
export function createOwnedLocalFileManifest(
  records: readonly OwnedLocalFileManifestRecord[],
): OwnedLocalFileManifest {
  if (!Array.isArray(records)) {
    throw new TypeError('Owned local file manifest records must be an array.');
  }

  const files: Record<string, OwnedLocalFileManifestRecord> = {};

  records.forEach(recordValue => {
    const record = parseOwnedLocalFileManifestRecord(recordValue);

    if (Object.prototype.hasOwnProperty.call(files, record.fileId)) {
      throw new TypeError(`Duplicate owned local file ID: ${record.fileId}.`);
    }

    files[record.fileId] = record;
  });

  return Object.freeze({
    version: OWNED_LOCAL_FILE_MANIFEST_VERSION,
    files: Object.freeze(files),
  });
}

/**
 * Strictly parses persisted manifest data. Unknown fields, accessor properties,
 * invalid versions, and malformed records are treated as corruption.
 */
export function parseOwnedLocalFileManifest(
  value: unknown,
): OwnedLocalFileManifest {
  assertPlainDataObject(value, 'Owned local file manifest');
  assertExactKeys(value, MANIFEST_KEYS, 'Owned local file manifest');

  if (value.version !== OWNED_LOCAL_FILE_MANIFEST_VERSION) {
    throw new TypeError(
      `Owned local file manifest version must be ${OWNED_LOCAL_FILE_MANIFEST_VERSION}.`,
    );
  }

  const manifestFiles = value.files;
  assertPlainDataObject(manifestFiles, 'Owned local file manifest files');

  const files: Record<string, OwnedLocalFileManifestRecord> = {};
  const fileIds = Reflect.ownKeys(manifestFiles);

  if (fileIds.some(fileId => typeof fileId !== 'string')) {
    throw new TypeError('Owned local file manifest files must use string file IDs only.');
  }

  (fileIds as string[]).forEach(fileId => {
    const descriptor = Object.getOwnPropertyDescriptor(manifestFiles, fileId);
    if (descriptor?.enumerable !== true) {
      throw new TypeError('Owned local file manifest file entries must be enumerable.');
    }

    assertFileId(fileId);
    const record = parseOwnedLocalFileManifestRecord(manifestFiles[fileId]);

    if (record.fileId !== fileId) {
      throw new TypeError(
        `Owned local file manifest key ${fileId} does not match record file ID ${record.fileId}.`,
      );
    }

    files[fileId] = record;
  });

  return Object.freeze({
    version: OWNED_LOCAL_FILE_MANIFEST_VERSION,
    files: Object.freeze(files),
  });
}

export function isValidOwnedLocalFileManifest(value: unknown): boolean {
  try {
    parseOwnedLocalFileManifest(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks exact manifest membership. Corrupt manifests throw so callers cannot
 * accidentally treat corruption as a valid but empty manifest.
 */
export function isOwnedLocalFileManifestMember(
  manifestValue: unknown,
  fileId: string,
  expectedKind?: OwnedLocalFileKind,
): boolean {
  const manifest = parseOwnedLocalFileManifest(manifestValue);
  assertFileId(fileId);

  if (expectedKind !== undefined) {
    assertOwnedLocalFileKind(expectedKind);
  }

  const record = manifest.files[fileId];
  return record !== undefined &&
    (expectedKind === undefined || record.kind === expectedKind);
}

/**
 * Resolves only a validated manifest record directly beneath a validated owned
 * root. It never accepts a caller-supplied path or URI from the record.
 */
export function resolveOwnedLocalFilePath(
  input: ResolveOwnedLocalFilePathInput,
): string {
  const manifest = parseOwnedLocalFileManifest(input.manifest);
  assertFileId(input.fileId);

  if (input.expectedKind !== undefined) {
    assertOwnedLocalFileKind(input.expectedKind);
  }

  const record = manifest.files[input.fileId];

  if (record === undefined) {
    throw new Error(`Owned local file ${input.fileId} is not present in the manifest.`);
  }

  if (input.expectedKind !== undefined && record.kind !== input.expectedKind) {
    throw new Error(
      `Owned local file ${input.fileId} is not authorized as ${input.expectedKind}.`,
    );
  }

  const ownedRoot = normalizeOwnedRoot(input.ownedRoot);
  const resolvedPath = `${ownedRoot}/${record.relativePath}`;
  const exactRootBoundary = `${ownedRoot}/`;

  if (!resolvedPath.startsWith(exactRootBoundary)) {
    throw new Error('Owned local file resolved outside the supplied owned root.');
  }

  if (resolvedPath.slice(exactRootBoundary.length) !== record.generatedBasename) {
    throw new Error('Owned local file resolved to a non-canonical relative path.');
  }

  return resolvedPath;
}

/**
 * Fail-closed authorization for both reads and deletes. The candidate must be
 * the exact canonical resolution of an exact manifest member. Lexical prefix
 * similarity (for example, `owned-other`) never grants access.
 */
export function isOwnedLocalFileReadDeleteAuthorized(
  input: OwnedLocalFileAuthorizationInput,
): boolean {
  if (typeof input.candidatePath !== 'string') return false;

  try {
    return input.candidatePath === resolveOwnedLocalFilePath(input);
  } catch {
    return false;
  }
}

/**
 * Transitional authorization for records created before the manifest-backed
 * store existed. Only an exact, path-safe file directly beneath the owned root
 * is accepted. Prefix similarity, descendants, traversal syntax, encoded
 * separators, query strings, and fragments all fail closed.
 */
export function resolveLegacyOwnedLocalFilePath(
  input: LegacyOwnedLocalFileResolutionInput,
): string | null {
  if (typeof input.candidatePath !== 'string' || !input.candidatePath) return null;

  try {
    const ownedRoot = normalizeOwnedRoot(input.ownedRoot);
    if (!ownedRoot.startsWith('file://') || !input.candidatePath.startsWith('file://')) {
      return null;
    }
    assertPathSafeFilename('legacy folder name', input.legacyFolderName);
    assertSafeCandidatePath(input.candidatePath);

    const exactRootBoundary = `${ownedRoot}/`;
    if (input.candidatePath.startsWith(exactRootBoundary)) {
      const basename = input.candidatePath.slice(exactRootBoundary.length);
      assertPathSafeFilename('legacy basename', basename);
      return `${ownedRoot}/${basename}`;
    }

    // iOS changes the application-container UUID after reinstall/update. A
    // legacy record may therefore contain an older absolute prefix. Rebind
    // only its single safe basename, never a caller-controlled relative path.
    const folderMarker = `/${input.legacyFolderName}/`;
    const folderIndex = input.candidatePath.lastIndexOf(folderMarker);
    if (folderIndex < 0) return null;
    const basename = input.candidatePath.slice(folderIndex + folderMarker.length);
    assertPathSafeFilename('legacy basename', basename);
    return `${ownedRoot}/${basename}`;
  } catch {
    return null;
  }
}

export function isLegacyOwnedLocalFileReadDeleteAuthorized(
  input: LegacyOwnedLocalFileResolutionInput,
): boolean {
  return resolveLegacyOwnedLocalFilePath(input) === input.candidatePath;
}

function parseOwnedLocalFileManifestRecord(
  value: unknown,
): OwnedLocalFileManifestRecord {
  assertPlainDataObject(value, 'Owned local file manifest record');
  assertExactKeys(value, RECORD_KEYS, 'Owned local file manifest record');

  if (value.version !== OWNED_LOCAL_FILE_MANIFEST_VERSION) {
    throw new TypeError(
      `Owned local file record version must be ${OWNED_LOCAL_FILE_MANIFEST_VERSION}.`,
    );
  }

  assertFileId(value.fileId);
  assertOwnedLocalFileKind(value.kind);
  assertPathSafeFilename('generated basename', value.generatedBasename);
  assertSha256(value.sha256);
  assertSizeBytes(value.sizeBytes);
  assertMimeType(value.mimeType);
  assertPathSafeFilename('relative path', value.relativePath);

  const extension = value.generatedBasename.slice(value.fileId.length + 1);
  const expectedBasename = generateOwnedLocalFileBasename(value.fileId, extension);

  if (value.generatedBasename !== expectedBasename) {
    throw new TypeError(
      'Owned local file generated basename must be the file ID followed by a safe extension.',
    );
  }

  if (value.relativePath !== value.generatedBasename) {
    throw new TypeError(
      'Owned local file relative path must exactly equal its generated basename.',
    );
  }

  return Object.freeze({
    version: OWNED_LOCAL_FILE_MANIFEST_VERSION,
    fileId: value.fileId,
    kind: value.kind,
    generatedBasename: value.generatedBasename,
    sha256: value.sha256,
    sizeBytes: value.sizeBytes,
    mimeType: value.mimeType,
    relativePath: value.relativePath,
  });
}

function assertFileId(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    (!CANONICAL_UUID_RE.test(value) && !OPAQUE_FILE_ID_RE.test(value))
  ) {
    throw new TypeError(
      'Owned local file ID must be a canonical UUID or a 16-128 character opaque identifier.',
    );
  }
}

function assertOwnedLocalFileKind(
  value: unknown,
): asserts value is OwnedLocalFileKind {
  if (
    typeof value !== 'string' ||
    !(OWNED_LOCAL_FILE_KINDS as readonly string[]).includes(value)
  ) {
    throw new TypeError('Owned local file kind is invalid.');
  }
}

function assertPathSafeFilename(field: string, value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`Owned local file ${field} must be a non-empty string.`);
  }

  if (
    CONTROL_CHARACTER_RE.test(value) ||
    value.includes('%') ||
    value.includes('/') ||
    value.includes('\\') ||
    value === '.' ||
    value === '..' ||
    value.startsWith('.') ||
    URI_SCHEME_RE.test(value) ||
    value.includes(':')
  ) {
    throw new TypeError(`Owned local file ${field} must be a path-safe filename.`);
  }
}

function assertSafeCandidatePath(value: string) {
  if (
    CONTROL_CHARACTER_RE.test(value) ||
    value.includes('%') ||
    value.includes('\\') ||
    value.includes('?') ||
    value.includes('#')
  ) {
    throw new TypeError('Owned local file candidate path contains unsafe syntax.');
  }
}

function assertSha256(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !SHA256_RE.test(value)) {
    throw new TypeError('Owned local file SHA-256 must be 64 lowercase hexadecimal characters.');
  }
}

function assertSizeBytes(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new TypeError('Owned local file size must be a positive safe integer.');
  }
}

function assertMimeType(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !MIME_TYPE_RE.test(value)) {
    throw new TypeError('Owned local file MIME type must be a canonical lowercase media type.');
  }
}

function normalizeOwnedRoot(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError('Owned local file root must be a non-empty absolute path or file URI.');
  }

  if (
    CONTROL_CHARACTER_RE.test(value) ||
    value.includes('%') ||
    value.includes('\\') ||
    value.includes('?') ||
    value.includes('#')
  ) {
    throw new TypeError('Owned local file root contains unsafe path syntax.');
  }

  const isFileUri = value.startsWith('file:///');

  if (!isFileUri && URI_SCHEME_RE.test(value)) {
    throw new TypeError('Owned local file root must not use a non-file URI scheme.');
  }

  if (!isFileUri && !value.startsWith('/')) {
    throw new TypeError('Owned local file root must be an absolute POSIX path or file URI.');
  }

  const pathPortion = isFileUri ? value.slice('file://'.length) : value;
  const normalizedPath = pathPortion.replace(/\/+$/, '');

  if (normalizedPath.length === 0 || normalizedPath === '/') {
    throw new TypeError('Owned local file root must be narrower than the filesystem root.');
  }

  const pathSegments = normalizedPath.split('/').slice(1);

  if (
    pathSegments.some(segment =>
      segment.length === 0 || segment === '.' || segment === '..' || URI_SCHEME_RE.test(segment)
    )
  ) {
    throw new TypeError('Owned local file root contains invalid path segments.');
  }

  return isFileUri ? `file://${normalizedPath}` : normalizedPath;
}

function assertPlainDataObject(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain object.`);
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object.`);
  }

  Object.getOwnPropertyNames(value).forEach(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throw new TypeError(`${label} must contain data properties only.`);
    }
  });
}

function assertExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
  label: string,
) {
  const keys = Reflect.ownKeys(value);

  if (
    keys.length !== expectedKeys.length ||
    keys.some(key => typeof key !== 'string' || !expectedKeys.includes(key))
  ) {
    throw new TypeError(`${label} contains missing or unexpected fields.`);
  }
}
