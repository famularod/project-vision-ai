export const COMPLETE_APP_BACKUP_VERSION = 2 as const;

export type AppBackupRestoreMode = 'replace' | 'merge' | 'validate_only';
export type AppBackupAssetKind =
  | 'reference_document'
  | 'project_document'
  | 'photo'
  | 'other';

export type EncryptedBackupSection = Readonly<{
  format: 'encrypted';
  algorithm: 'AES-256-GCM';
  keyId: string;
  ivBase64: string;
  ciphertextBase64: string;
  authTagBase64: string;
}>;

export type CompleteBackupDomain = Readonly<{
  id: string;
  sensitive: boolean;
  itemCount: number;
  byteLength: number;
  sha256: string;
  payload: unknown;
}>;

export type CompleteBackupAsset = Readonly<{
  id: string;
  kind: AppBackupAssetKind;
  relativePath: string;
  sizeBytes: number;
  sha256: string;
}>;

export type CompleteAppBackupManifest = Readonly<{
  version: typeof COMPLETE_APP_BACKUP_VERSION;
  createdAt: string;
  restoreMode: AppBackupRestoreMode;
  domains: readonly CompleteBackupDomain[];
  assets: readonly CompleteBackupAsset[];
  counts: Readonly<{
    domainCount: number;
    recordCount: number;
    assetCount: number;
    assetBytes: number;
  }>;
  manifestSha256: string;
}>;

export type CompleteBackupDomainInput =
  | Readonly<{
      id: string;
      sensitive?: false;
      payload: unknown;
    }>
  | Readonly<{
      id: string;
      sensitive: true;
      payload: EncryptedBackupSection;
      itemCount: number;
    }>;

export type CompleteBackupAssetInput = Readonly<{
  id: string;
  kind: AppBackupAssetKind;
  relativePath: string;
  sizeBytes: number;
  sha256: string;
}>;

export type CompleteBackupManifestDependencies = Readonly<{
  sha256Text: (value: string) => Promise<string>;
  utf8ByteLength?: (value: string) => number;
}>;

export type CompleteBackupValidationInput = Readonly<{
  manifest: CompleteAppBackupManifest;
  requiredDomainIds: readonly string[];
  requiredSensitiveDomainIds?: readonly string[];
}>;

export class AppBackupManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppBackupManifestError';
  }
}

export async function createCompleteAppBackupManifest(
  input: Readonly<{
    createdAt: string;
    restoreMode: AppBackupRestoreMode;
    requiredDomainIds: readonly string[];
    requiredSensitiveDomainIds?: readonly string[];
    domains: readonly CompleteBackupDomainInput[];
    assets?: readonly CompleteBackupAssetInput[];
  }>,
  dependencies: CompleteBackupManifestDependencies,
): Promise<CompleteAppBackupManifest> {
  assertTimestamp(input.createdAt);
  assertRestoreMode(input.restoreMode);
  const requiredDomainIds = uniqueDomainIds(input.requiredDomainIds, 'required domain');
  const requiredSensitiveDomainIds = new Set(uniqueDomainIds(
    input.requiredSensitiveDomainIds || [],
    'required sensitive domain',
  ));
  const suppliedIds = uniqueDomainIds(input.domains.map(domain => domain.id), 'backup domain');
  assertExactDomainSet(requiredDomainIds, suppliedIds);
  for (const id of requiredSensitiveDomainIds) {
    if (!requiredDomainIds.includes(id)) {
      throw new AppBackupManifestError(
        `Sensitive backup domain "${id}" is not registered as a required domain.`,
      );
    }
  }

  const byteLength = dependencies.utf8ByteLength || utf8ByteLength;
  const domains: CompleteBackupDomain[] = [];
  for (const domainInput of input.domains) {
    const id = requireIdentifier(domainInput.id, 'backup domain');
    const mustEncrypt = requiredSensitiveDomainIds.has(id);
    if (mustEncrypt !== Boolean(domainInput.sensitive)) {
      throw new AppBackupManifestError(
        mustEncrypt
          ? `Sensitive backup domain "${id}" must use the encrypted section contract.`
          : `Backup domain "${id}" is marked sensitive but is not registered as sensitive.`,
      );
    }
    if (domainInput.sensitive) {
      assertEncryptedSection(domainInput.payload, id);
      assertCount(domainInput.itemCount, `${id} item count`);
    }
    const canonicalPayload = canonicalJson(domainInput.payload);
    const itemCount = domainInput.sensitive
      ? domainInput.itemCount
      : countDomainItems(domainInput.payload);
    domains.push(Object.freeze({
      id,
      sensitive: Boolean(domainInput.sensitive),
      itemCount,
      byteLength: byteLength(canonicalPayload),
      sha256: requireSha256(await dependencies.sha256Text(canonicalPayload), `${id} checksum`),
      payload: deepFreezeJson(cloneJson(domainInput.payload)),
    }));
  }

  const assets = (input.assets || []).map(asset => normalizeAsset(asset));
  uniqueDomainIds(assets.map(asset => asset.id), 'backup asset');
  const counts = Object.freeze({
    domainCount: domains.length,
    recordCount: domains.reduce((sum, domain) => sum + domain.itemCount, 0),
    assetCount: assets.length,
    assetBytes: assets.reduce((sum, asset) => sum + asset.sizeBytes, 0),
  });
  const unsigned = {
    version: COMPLETE_APP_BACKUP_VERSION,
    createdAt: input.createdAt,
    restoreMode: input.restoreMode,
    domains,
    assets,
    counts,
  } as const;
  const manifestSha256 = requireSha256(
    await dependencies.sha256Text(canonicalJson(unsigned)),
    'manifest checksum',
  );

  return Object.freeze({
    ...unsigned,
    domains: Object.freeze(domains),
    assets: Object.freeze(assets),
    manifestSha256,
  });
}

/**
 * Validates the complete backup envelope before a restore implementation is
 * permitted to mutate any durable domain. The caller supplies its authoritative
 * domain registry so missing and unrecognized domains both fail closed.
 */
export async function verifyCompleteAppBackupManifest(
  input: CompleteBackupValidationInput,
  dependencies: CompleteBackupManifestDependencies,
): Promise<CompleteAppBackupManifest> {
  const { manifest } = input;
  if (!isRecord(manifest) || manifest.version !== COMPLETE_APP_BACKUP_VERSION) {
    throw new AppBackupManifestError('The complete backup version is missing or unsupported.');
  }
  assertTimestamp(manifest.createdAt);
  assertRestoreMode(manifest.restoreMode);
  if (!Array.isArray(manifest.domains) || !Array.isArray(manifest.assets)) {
    throw new AppBackupManifestError('Backup domains and assets must be arrays.');
  }
  const requiredDomainIds = uniqueDomainIds(input.requiredDomainIds, 'required domain');
  const requiredSensitive = new Set(uniqueDomainIds(
    input.requiredSensitiveDomainIds || [],
    'required sensitive domain',
  ));
  const suppliedDomainIds = uniqueDomainIds(
    manifest.domains.map(domain => domain.id),
    'backup domain',
  );
  assertExactDomainSet(requiredDomainIds, suppliedDomainIds);

  const byteLength = dependencies.utf8ByteLength || utf8ByteLength;
  let recordCount = 0;
  for (const domain of manifest.domains) {
    const id = requireIdentifier(domain.id, 'backup domain');
    const mustEncrypt = requiredSensitive.has(id);
    if (domain.sensitive !== mustEncrypt) {
      throw new AppBackupManifestError(
        `Backup domain "${id}" does not match its sensitive-domain registry entry.`,
      );
    }
    assertCount(domain.itemCount, `${id} item count`);
    if (domain.sensitive) {
      assertEncryptedSection(domain.payload, id);
    } else if (domain.itemCount !== countDomainItems(domain.payload)) {
      throw new AppBackupManifestError(`Backup domain "${id}" has an invalid item count.`);
    }
    const canonicalPayload = canonicalJson(domain.payload);
    if (domain.byteLength !== byteLength(canonicalPayload)) {
      throw new AppBackupManifestError(`Backup domain "${id}" has an invalid byte count.`);
    }
    const observedSha = requireSha256(
      await dependencies.sha256Text(canonicalPayload),
      `${id} observed checksum`,
    );
    if (domain.sha256 !== observedSha) {
      throw new AppBackupManifestError(`Backup domain "${id}" failed checksum verification.`);
    }
    recordCount += domain.itemCount;
  }

  uniqueDomainIds(manifest.assets.map(asset => asset.id), 'backup asset');
  const assets = manifest.assets.map(asset => normalizeAsset(asset));
  const expectedCounts = {
    domainCount: manifest.domains.length,
    recordCount,
    assetCount: assets.length,
    assetBytes: assets.reduce((sum, asset) => sum + asset.sizeBytes, 0),
  };
  if (
    !isRecord(manifest.counts) ||
    Object.keys(expectedCounts).some(key =>
      manifest.counts[key as keyof typeof expectedCounts] !==
        expectedCounts[key as keyof typeof expectedCounts])
  ) {
    throw new AppBackupManifestError('The complete backup aggregate counts are invalid.');
  }

  const unsigned = {
    version: manifest.version,
    createdAt: manifest.createdAt,
    restoreMode: manifest.restoreMode,
    domains: manifest.domains,
    assets: manifest.assets,
    counts: manifest.counts,
  };
  const observedManifestSha = requireSha256(
    await dependencies.sha256Text(canonicalJson(unsigned)),
    'observed manifest checksum',
  );
  if (manifest.manifestSha256 !== observedManifestSha) {
    throw new AppBackupManifestError('The complete backup manifest checksum is invalid.');
  }
  return manifest;
}

export async function verifyCompleteBackupAssetBytes(
  manifest: CompleteAppBackupManifest,
  readAssetBytes: (asset: CompleteBackupAsset) => Promise<Uint8Array>,
  sha256Bytes: (bytes: Uint8Array) => Promise<string>,
): Promise<void> {
  for (const asset of manifest.assets) {
    const bytes = await readAssetBytes(asset);
    const sha = requireSha256(await sha256Bytes(bytes), `${asset.id} observed checksum`);
    if (bytes.byteLength !== asset.sizeBytes || sha !== asset.sha256) {
      throw new AppBackupManifestError(
        `Backup asset "${asset.id}" failed byte-for-byte integrity verification.`,
      );
    }
  }
}

function normalizeAsset(asset: CompleteBackupAssetInput): CompleteBackupAsset {
  const id = requireIdentifier(asset.id, 'backup asset');
  if (!['reference_document', 'project_document', 'photo', 'other'].includes(asset.kind)) {
    throw new AppBackupManifestError(`Backup asset "${id}" has an invalid kind.`);
  }
  const relativePath = requireRelativePath(asset.relativePath, id);
  if (!Number.isSafeInteger(asset.sizeBytes) || asset.sizeBytes <= 0) {
    throw new AppBackupManifestError(`Backup asset "${id}" has an invalid byte count.`);
  }
  return Object.freeze({
    id,
    kind: asset.kind,
    relativePath,
    sizeBytes: asset.sizeBytes,
    sha256: requireSha256(asset.sha256, `${id} checksum`),
  });
}

function assertExactDomainSet(required: readonly string[], supplied: readonly string[]) {
  const requiredSet = new Set(required);
  const suppliedSet = new Set(supplied);
  const missing = required.filter(id => !suppliedSet.has(id));
  const unexpected = supplied.filter(id => !requiredSet.has(id));
  if (missing.length || unexpected.length) {
    throw new AppBackupManifestError(
      `Backup domain registry mismatch. Missing: ${missing.join(', ') || 'none'}. ` +
      `Unexpected: ${unexpected.join(', ') || 'none'}.`,
    );
  }
}

function uniqueDomainIds(values: readonly string[], label: string): string[] {
  const normalized = values.map(value => requireIdentifier(value, label));
  if (new Set(normalized).size !== normalized.length) {
    throw new AppBackupManifestError(`The ${label} registry contains duplicate identities.`);
  }
  return normalized;
}

function requireIdentifier(value: unknown, label: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(normalized)) {
    throw new AppBackupManifestError(`A canonical ${label} identity is required.`);
  }
  return normalized;
}

function requireRelativePath(value: unknown, id: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  let decoded = normalized;
  try {
    for (let pass = 0; pass < 3; pass += 1) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
  } catch {
    decoded = '..';
  }
  if (
    !normalized ||
    normalized.startsWith('/') ||
    normalized.includes('\\') ||
    decoded.startsWith('/') ||
    decoded.includes('\\') ||
    decoded.split('/').some(segment => !segment || segment === '.' || segment === '..') ||
    /^[a-z][a-z0-9+.-]*:/i.test(decoded)
  ) {
    throw new AppBackupManifestError(`Backup asset "${id}" has an unsafe relative path.`);
  }
  return normalized;
}

function requireSha256(value: unknown, label: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new AppBackupManifestError(`The ${label} must be a canonical SHA-256 value.`);
  }
  return normalized;
}

function assertRestoreMode(value: unknown): asserts value is AppBackupRestoreMode {
  if (value !== 'replace' && value !== 'merge' && value !== 'validate_only') {
    throw new AppBackupManifestError('The backup restore mode is invalid.');
  }
}

function assertTimestamp(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new AppBackupManifestError('The backup creation timestamp is invalid.');
  }
}

function assertCount(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new AppBackupManifestError(`The ${label} must be a non-negative safe integer.`);
  }
}

function assertEncryptedSection(value: unknown, id: string): asserts value is EncryptedBackupSection {
  if (
    !isRecord(value) ||
    Object.keys(value).sort().join(',') !==
      'algorithm,authTagBase64,ciphertextBase64,format,ivBase64,keyId' ||
    value.format !== 'encrypted' ||
    value.algorithm !== 'AES-256-GCM' ||
    typeof value.keyId !== 'string' ||
    !value.keyId.trim() ||
    !isCanonicalBase64(value.ivBase64) ||
    !isCanonicalBase64(value.ciphertextBase64) ||
    !isCanonicalBase64(value.authTagBase64)
  ) {
    throw new AppBackupManifestError(
      `Sensitive backup domain "${id}" is not an authenticated encrypted section.`,
    );
  }
}

function isCanonicalBase64(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length >= 4 &&
    value.length % 4 === 0 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

function countDomainItems(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (value === null) return 0;
  if (isRecord(value)) return Object.keys(value).length;
  return 1;
}

function canonicalJson(value: unknown): string {
  const seen = new Set<object>();
  return serialize(value);

  function serialize(candidate: unknown): string {
    if (candidate === null) return 'null';
    if (typeof candidate === 'string' || typeof candidate === 'boolean') {
      return JSON.stringify(candidate);
    }
    if (typeof candidate === 'number') {
      if (!Number.isFinite(candidate)) {
        throw new AppBackupManifestError('Backup payloads must contain finite numbers.');
      }
      return JSON.stringify(candidate);
    }
    if (Array.isArray(candidate)) {
      if (seen.has(candidate)) throw new AppBackupManifestError('Backup payloads must not contain cycles.');
      seen.add(candidate);
      const result = `[${candidate.map(serialize).join(',')}]`;
      seen.delete(candidate);
      return result;
    }
    if (!isRecord(candidate)) {
      throw new AppBackupManifestError('Backup payloads must contain JSON-safe values only.');
    }
    if (seen.has(candidate)) throw new AppBackupManifestError('Backup payloads must not contain cycles.');
    seen.add(candidate);
    const keys = Object.keys(candidate).sort();
    const result = `{${keys.map(key => {
      const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) {
        throw new AppBackupManifestError('Backup payloads must contain enumerable data properties only.');
      }
      return `${JSON.stringify(key)}:${serialize(descriptor.value)}`;
    }).join(',')}}`;
    seen.delete(candidate);
    return result;
  }
}

function cloneJson<T>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T;
}

function deepFreezeJson<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach(deepFreezeJson);
    Object.freeze(value);
  }
  return value;
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
