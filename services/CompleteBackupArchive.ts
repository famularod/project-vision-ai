import { gcm } from '@noble/ciphers/aes';
import { pbkdf2Async } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, bytesToUtf8, utf8ToBytes } from '@noble/hashes/utils';
import {
  fromByteArray,
  toByteArray,
} from 'base64-js';
import {
  createCompleteAppBackupManifest,
  verifyCompleteAppBackupManifest,
  type AppBackupAssetKind,
  type CompleteAppBackupManifest,
  type EncryptedBackupSection,
} from './AppBackupManifest';

export const COMPLETE_BACKUP_ARCHIVE_VERSION = 1 as const;
export const COMPLETE_BACKUP_DOMAIN_ID = 'application_state';
export const COMPLETE_BACKUP_KDF_ITERATIONS = 210_000;
export const COMPLETE_BACKUP_MINIMUM_PASSPHRASE_LENGTH = 12;
const AES_GCM_NONCE_BYTES = 12;
const AES_GCM_TAG_BYTES = 16;
const DERIVED_KEY_BYTES = 32;
const KDF_SALT_BYTES = 32;

export type CompleteBackupPlainAsset = Readonly<{
  id: string;
  kind: AppBackupAssetKind;
  relativePath: string;
  bytes: Uint8Array;
}>;

export type CompleteBackupEncryptedAsset = Readonly<{
  id: string;
  encrypted: EncryptedBackupSection;
}>;

export type CompleteBackupArchive = Readonly<{
  archiveVersion: typeof COMPLETE_BACKUP_ARCHIVE_VERSION;
  encryption: Readonly<{
    algorithm: 'AES-256-GCM';
    kdf: 'PBKDF2-HMAC-SHA256';
    iterations: typeof COMPLETE_BACKUP_KDF_ITERATIONS;
    saltBase64: string;
  }>;
  manifest: CompleteAppBackupManifest;
  encryptedAssets: readonly CompleteBackupEncryptedAsset[];
  envelopeSha256: string;
}>;

export type DecryptedCompleteBackup = Readonly<{
  state: unknown;
  assets: ReadonlyMap<string, Uint8Array>;
  manifest: CompleteAppBackupManifest;
}>;

export type CompleteBackupArchiveDependencies = Readonly<{
  randomBytes: (length: number) => Uint8Array | Promise<Uint8Array>;
}>;

export class CompleteBackupArchiveError extends Error {
  readonly code:
    | 'passphrase_too_short'
    | 'invalid_archive'
    | 'wrong_passphrase_or_tampered'
    | 'asset_mismatch';

  constructor(
    code: CompleteBackupArchiveError['code'],
    message: string,
  ) {
    super(message);
    this.name = 'CompleteBackupArchiveError';
    this.code = code;
  }
}

export async function createCompleteBackupArchive(
  input: Readonly<{
    state: unknown;
    assets: readonly CompleteBackupPlainAsset[];
    passphrase: string;
    createdAt: string;
  }>,
  dependencies: CompleteBackupArchiveDependencies,
): Promise<CompleteBackupArchive> {
  const passphrase = requireBackupPassphrase(input.passphrase);
  const salt = await dependencies.randomBytes(KDF_SALT_BYTES);
  assertRandomLength(salt, KDF_SALT_BYTES, 'backup salt');
  const key = await deriveBackupKey(passphrase, salt);
  const stateBytes = utf8ToBytes(JSON.stringify(input.state));
  const encryptedState = await encryptBytes(
    key,
    stateBytes,
    dependencies,
    utf8ToBytes(COMPLETE_BACKUP_DOMAIN_ID),
  );
  const encryptedAssets: CompleteBackupEncryptedAsset[] = [];
  const manifestAssets = [];
  const seenAssetIds = new Set<string>();

  for (const asset of input.assets) {
    const id = requireAssetId(asset.id);
    if (seenAssetIds.has(id)) {
      throw new CompleteBackupArchiveError(
        'invalid_archive',
        `The complete backup contains the duplicate media id "${id}".`,
      );
    }
    seenAssetIds.add(id);
    manifestAssets.push({
      id,
      kind: asset.kind,
      relativePath: requireRelativePath(asset.relativePath),
      sizeBytes: asset.bytes.byteLength,
      sha256: sha256Hex(asset.bytes),
    });
    encryptedAssets.push(Object.freeze({
      id,
      encrypted: await encryptBytes(
        key,
        asset.bytes,
        dependencies,
        utf8ToBytes(`asset:${id}`),
      ),
    }));
  }

  const manifest = await createCompleteAppBackupManifest({
    createdAt: input.createdAt,
    restoreMode: 'replace',
    requiredDomainIds: [COMPLETE_BACKUP_DOMAIN_ID],
    requiredSensitiveDomainIds: [COMPLETE_BACKUP_DOMAIN_ID],
    domains: [{
      id: COMPLETE_BACKUP_DOMAIN_ID,
      sensitive: true,
      payload: encryptedState,
      itemCount: countStateRecords(input.state),
    }],
    assets: manifestAssets,
  }, {
    sha256Text: async value => sha256Hex(utf8ToBytes(value)),
  });
  const unsigned = {
    archiveVersion: COMPLETE_BACKUP_ARCHIVE_VERSION,
    encryption: {
      algorithm: 'AES-256-GCM' as const,
      kdf: 'PBKDF2-HMAC-SHA256' as const,
      iterations: COMPLETE_BACKUP_KDF_ITERATIONS as typeof COMPLETE_BACKUP_KDF_ITERATIONS,
      saltBase64: fromByteArray(salt),
    },
    manifest,
    encryptedAssets,
  };
  return Object.freeze({
    ...unsigned,
    encryption: Object.freeze(unsigned.encryption),
    encryptedAssets: Object.freeze(encryptedAssets),
    envelopeSha256: sha256Hex(utf8ToBytes(canonicalJson(unsigned))),
  });
}

export async function decryptCompleteBackupArchive(
  rawArchive: unknown,
  passphraseInput: string,
): Promise<DecryptedCompleteBackup> {
  const passphrase = requireBackupPassphrase(passphraseInput);
  const archive = parseArchive(rawArchive);
  const unsigned = {
    archiveVersion: archive.archiveVersion,
    encryption: archive.encryption,
    manifest: archive.manifest,
    encryptedAssets: archive.encryptedAssets,
  };
  if (
    archive.envelopeSha256 !==
    sha256Hex(utf8ToBytes(canonicalJson(unsigned)))
  ) {
    throw new CompleteBackupArchiveError(
      'invalid_archive',
      'The complete backup envelope failed integrity verification.',
    );
  }
  await verifyCompleteAppBackupManifest({
    manifest: archive.manifest,
    requiredDomainIds: [COMPLETE_BACKUP_DOMAIN_ID],
    requiredSensitiveDomainIds: [COMPLETE_BACKUP_DOMAIN_ID],
  }, {
    sha256Text: async value => sha256Hex(utf8ToBytes(value)),
  });
  const salt = decodeBase64(archive.encryption.saltBase64, 'backup salt');
  if (salt.byteLength !== KDF_SALT_BYTES) {
    throw new CompleteBackupArchiveError(
      'invalid_archive',
      'The complete backup salt is invalid.',
    );
  }
  const key = await deriveBackupKey(passphrase, salt);
  const stateDomain = archive.manifest.domains.find(
    domain => domain.id === COMPLETE_BACKUP_DOMAIN_ID,
  );
  if (!stateDomain?.sensitive) {
    throw new CompleteBackupArchiveError(
      'invalid_archive',
      'The encrypted application state is missing.',
    );
  }
  let state: unknown;
  try {
    const stateBytes = decryptBytes(
      key,
      stateDomain.payload as EncryptedBackupSection,
      utf8ToBytes(COMPLETE_BACKUP_DOMAIN_ID),
    );
    state = JSON.parse(bytesToUtf8(stateBytes));
  } catch {
    throw new CompleteBackupArchiveError(
      'wrong_passphrase_or_tampered',
      'The passphrase is incorrect or the backup was modified.',
    );
  }

  const encryptedAssetById = new Map(
    archive.encryptedAssets.map(asset => [asset.id, asset.encrypted]),
  );
  if (encryptedAssetById.size !== archive.manifest.assets.length) {
    throw new CompleteBackupArchiveError(
      'invalid_archive',
      'The encrypted media index does not match the backup manifest.',
    );
  }
  const assets = new Map<string, Uint8Array>();
  for (const asset of archive.manifest.assets) {
    const encrypted = encryptedAssetById.get(asset.id);
    if (!encrypted) {
      throw new CompleteBackupArchiveError(
        'invalid_archive',
        `The encrypted media file "${asset.id}" is missing.`,
      );
    }
    let bytes: Uint8Array;
    try {
      bytes = decryptBytes(
        key,
        encrypted,
        utf8ToBytes(`asset:${asset.id}`),
      );
    } catch {
      throw new CompleteBackupArchiveError(
        'wrong_passphrase_or_tampered',
        'The passphrase is incorrect or encrypted media was modified.',
      );
    }
    if (
      bytes.byteLength !== asset.sizeBytes ||
      sha256Hex(bytes) !== asset.sha256
    ) {
      throw new CompleteBackupArchiveError(
        'asset_mismatch',
        `The restored media file "${asset.id}" failed integrity verification.`,
      );
    }
    assets.set(asset.id, bytes);
  }
  return Object.freeze({
    state,
    assets,
    manifest: archive.manifest,
  });
}

export function requireBackupPassphrase(value: string): string {
  const passphrase = value.trim();
  if (passphrase.length < COMPLETE_BACKUP_MINIMUM_PASSPHRASE_LENGTH) {
    throw new CompleteBackupArchiveError(
      'passphrase_too_short',
      `Use a backup passphrase with at least ${COMPLETE_BACKUP_MINIMUM_PASSPHRASE_LENGTH} characters.`,
    );
  }
  return passphrase;
}

async function deriveBackupKey(passphrase: string, salt: Uint8Array) {
  return pbkdf2Async(sha256, utf8ToBytes(passphrase), salt, {
    c: COMPLETE_BACKUP_KDF_ITERATIONS,
    dkLen: DERIVED_KEY_BYTES,
    asyncTick: 10,
  });
}

async function encryptBytes(
  key: Uint8Array,
  plaintext: Uint8Array,
  dependencies: CompleteBackupArchiveDependencies,
  associatedData: Uint8Array,
): Promise<EncryptedBackupSection> {
  const nonce = await dependencies.randomBytes(AES_GCM_NONCE_BYTES);
  assertRandomLength(nonce, AES_GCM_NONCE_BYTES, 'AES-GCM nonce');
  const combined = gcm(key, nonce, associatedData).encrypt(plaintext);
  const ciphertext = combined.slice(0, combined.length - AES_GCM_TAG_BYTES);
  const authTag = combined.slice(combined.length - AES_GCM_TAG_BYTES);
  return Object.freeze({
    format: 'encrypted',
    algorithm: 'AES-256-GCM',
    keyId: 'PBKDF2-HMAC-SHA256',
    ivBase64: fromByteArray(nonce),
    ciphertextBase64: fromByteArray(ciphertext),
    authTagBase64: fromByteArray(authTag),
  });
}

function decryptBytes(
  key: Uint8Array,
  section: EncryptedBackupSection,
  associatedData: Uint8Array,
): Uint8Array {
  const nonce = decodeBase64(section.ivBase64, 'AES-GCM nonce');
  const ciphertext = decodeBase64(section.ciphertextBase64, 'ciphertext');
  const authTag = decodeBase64(section.authTagBase64, 'authentication tag');
  if (
    section.format !== 'encrypted' ||
    section.algorithm !== 'AES-256-GCM' ||
    section.keyId !== 'PBKDF2-HMAC-SHA256' ||
    nonce.byteLength !== AES_GCM_NONCE_BYTES ||
    authTag.byteLength !== AES_GCM_TAG_BYTES
  ) {
    throw new CompleteBackupArchiveError(
      'invalid_archive',
      'The encrypted backup section is invalid.',
    );
  }
  const combined = new Uint8Array(ciphertext.byteLength + authTag.byteLength);
  combined.set(ciphertext, 0);
  combined.set(authTag, ciphertext.byteLength);
  return gcm(key, nonce, associatedData).decrypt(combined);
}

function parseArchive(value: unknown): CompleteBackupArchive {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CompleteBackupArchiveError(
      'invalid_archive',
      'The selected file is not a Vitruvius complete backup.',
    );
  }
  const candidate = value as Partial<CompleteBackupArchive>;
  if (
    candidate.archiveVersion !== COMPLETE_BACKUP_ARCHIVE_VERSION ||
    !candidate.encryption ||
    candidate.encryption.algorithm !== 'AES-256-GCM' ||
    candidate.encryption.kdf !== 'PBKDF2-HMAC-SHA256' ||
    candidate.encryption.iterations !== COMPLETE_BACKUP_KDF_ITERATIONS ||
    typeof candidate.encryption.saltBase64 !== 'string' ||
    !candidate.manifest ||
    !Array.isArray(candidate.encryptedAssets) ||
    typeof candidate.envelopeSha256 !== 'string'
  ) {
    throw new CompleteBackupArchiveError(
      'invalid_archive',
      'The selected complete backup is incomplete or unsupported.',
    );
  }
  return candidate as CompleteBackupArchive;
}

function countStateRecords(state: unknown): number {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return 1;
  return Object.values(state as Record<string, unknown>).reduce<number>(
    (count, value) => count + (Array.isArray(value) ? value.length : value === null ? 0 : 1),
    0,
  );
}

function requireAssetId(value: string): string {
  const id = value.trim();
  if (!id || id.includes('\0')) {
    throw new CompleteBackupArchiveError(
      'invalid_archive',
      'Every backup media file requires a stable id.',
    );
  }
  return id;
}

function requireRelativePath(value: string): string {
  const path = value.trim().replace(/\\/g, '/');
  if (
    !path ||
    path.startsWith('/') ||
    path.includes('../') ||
    path.includes('\0')
  ) {
    throw new CompleteBackupArchiveError(
      'invalid_archive',
      'Backup media paths must remain inside the Vitruvius archive.',
    );
  }
  return path;
}

function assertRandomLength(
  value: Uint8Array,
  expected: number,
  label: string,
) {
  if (!(value instanceof Uint8Array) || value.byteLength !== expected) {
    throw new CompleteBackupArchiveError(
      'invalid_archive',
      `The generated ${label} has an invalid length.`,
    );
  }
}

function decodeBase64(value: string, label: string): Uint8Array {
  try {
    return toByteArray(value);
  } catch {
    throw new CompleteBackupArchiveError(
      'invalid_archive',
      `The backup ${label} is not valid base64.`,
    );
  }
}

function sha256Hex(value: Uint8Array): string {
  return bytesToHex(sha256(value));
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      result[key] = sortJson((value as Record<string, unknown>)[key]);
      return result;
    }, {});
}
