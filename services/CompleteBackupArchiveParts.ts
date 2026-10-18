/**
 * Multi-part device backup.
 *
 * The single-file archive is built entirely in memory — every asset base64
 * encoded into one JSON string — so it carries a hard 128 MB ceiling
 * (MAX_DEVICE_BACKUP_BYTES) to avoid exhausting memory on the device. The
 * owner's phone exceeds that ceiling, so the full backup refuses to run at all
 * and the only export that completes is records-only, which carries no photos.
 * That leaves images with no local protection.
 *
 * Each new part binds a fresh set nonce and its exact position/role into the
 * archive's authenticated state and asset ciphertext. Old unbound multipart
 * backups require explicitly authorized recovery; a standalone v1 archive
 * remains supported as before.
 *
 * Assets are taken as SOURCES, not bytes. Splitting a list of already-loaded
 * buffers would bound each file's size while still holding every photo in
 * memory at once — which is the actual failure the ceiling protects against.
 * Each part reads only its own bytes, hands the finished part to the caller to
 * write out, and releases them before the next part begins. Peak memory is one
 * part, not one backup.
 *
 * Part 0 carries the application state. A restore requires all parts of one
 * backup and refuses a mixed or incomplete set rather than restoring what it
 * can — a partial restore is worse than an obvious failure, because the owner
 * would believe their records were recovered.
 */
import {
  createCompleteBackupArchive,
  decryptCompleteBackupArchive,
  type BackupSha256,
  type CompleteBackupArchive,
  type CompleteBackupArchiveDependencies,
  type CompleteBackupPlainAsset,
} from './CompleteBackupArchive';
import { bytesToHex } from '@noble/hashes/utils';
import { BACKUP_SET_NONCE_BYTES, BOUND_BACKUP_PART_ENVELOPE_VERSION, BOUND_COMPLETE_BACKUP_ARCHIVE_VERSION, backupPartContextKey, parseBackupPartContext, type BackupPartContext } from './BackupPartContext';
import {
  MAX_DEVICE_BACKUP_BYTES,
  createBackupAssetBudget,
} from './BackupExportPolicy';

export const LEGACY_BACKUP_PART_ENVELOPE_VERSION = 1 as const;
export const BACKUP_PART_ENVELOPE_VERSION = BOUND_BACKUP_PART_ENVELOPE_VERSION;

/**
 * Leave room inside each part for the encrypted state, the manifest and JSON
 * overhead. Deliberately well under the ceiling rather than tuned close to it:
 * a part that overshoots is a failed backup.
 */
export const DEFAULT_PART_ASSET_BUDGET_BYTES = 64 * 1024 * 1024;

/**
 * Room kept inside one part for the encrypted records, the manifest and JSON
 * overhead. A single file whose encoded size leaves less than this cannot be
 * carried by any part, so it is refused before anything is shared.
 */
export const PART_OVERHEAD_RESERVE_BYTES = 8 * 1024 * 1024;

/** A file the backup will carry, described before its bytes are loaded. */
export type CompleteBackupAssetSource = Readonly<{
  id: string;
  kind: CompleteBackupPlainAsset['kind'];
  relativePath: string;
  sizeBytes: number;
  read: () => Promise<Uint8Array>;
}>;

export type CompleteBackupPart = Readonly<{
  envelopeVersion: typeof LEGACY_BACKUP_PART_ENVELOPE_VERSION | typeof BACKUP_PART_ENVELOPE_VERSION;
  setNonce?: string;
  backupId: string;
  partIndex: number;
  partCount: number;
  archive: CompleteBackupArchive;
}>;

export class CompleteBackupPartsError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'CompleteBackupPartsError';
    this.code = code;
  }
}

function encodedSize(sizeBytes: number): number {
  // base64 is 4 bytes out for every 3 in, which is what actually lands in the
  // archive. Measuring raw bytes would undercount by a third.
  return 4 * Math.ceil(sizeBytes / 3);
}

function assertTrustworthySize(source: CompleteBackupAssetSource): void {
  if (
    typeof source.sizeBytes !== 'number' ||
    !Number.isSafeInteger(source.sizeBytes) ||
    source.sizeBytes < 0
  ) {
    throw new CompleteBackupPartsError(
      'untrustworthy_size',
      'A file in this backup has no trustworthy size. No partial backup will be written.',
    );
  }
}

/**
 * Greedy split, in the order given, by DECLARED size — no bytes are read here.
 * One asset larger than the budget still gets its own part rather than being
 * rejected: a single oversized file should not fail the whole backup.
 */
export function splitBackupAssetsIntoParts(
  sources: readonly CompleteBackupAssetSource[],
  budgetBytes: number = DEFAULT_PART_ASSET_BUDGET_BYTES,
): CompleteBackupAssetSource[][] {
  if (!Number.isSafeInteger(budgetBytes) || budgetBytes <= 0) {
    throw new CompleteBackupPartsError('invalid_budget', 'Invalid part budget.');
  }
  sources.forEach(assertTrustworthySize);
  if (sources.length === 0) return [[]];

  const parts: CompleteBackupAssetSource[][] = [];
  let current: CompleteBackupAssetSource[] = [];
  let used = 0;

  for (const source of sources) {
    const size = encodedSize(source.sizeBytes);
    if (current.length > 0 && used + size > budgetBytes) {
      parts.push(current);
      current = [];
      used = 0;
    }
    current.push(source);
    used += size;
  }
  parts.push(current);
  return parts;
}

/** How many parts a backup will need, before any bytes are read. */
export function countBackupParts(
  sources: readonly CompleteBackupAssetSource[],
  budgetBytes: number = DEFAULT_PART_ASSET_BUDGET_BYTES,
): number {
  return splitBackupAssetsIntoParts(sources, budgetBytes).length;
}

function megabytes(bytes: number): number {
  return Math.max(1, Math.round(bytes / (1024 * 1024)));
}

/**
 * Refuse, before any bytes are read or any part is shared, a backup that some
 * part could not hold: one file too large for a part on its own, or two files
 * claiming the same identity. Failing here matters because parts leave the
 * phone one at a time — a failure after part 1 was shared leaves an incomplete
 * set the owner may believe is a backup.
 */
export function assertBackupAssetsFitParts(
  sources: readonly CompleteBackupAssetSource[],
  partCeilingBytes: number = MAX_DEVICE_BACKUP_BYTES,
): void {
  const seen = new Set<string>();
  for (const source of sources) {
    assertTrustworthySize(source);
    if (!source.id || seen.has(source.id)) {
      throw new CompleteBackupPartsError(
        'duplicate_asset',
        'Two files in this backup share one identity. No partial backup will be written.',
      );
    }
    seen.add(source.id);
    if (encodedSize(source.sizeBytes) > partCeilingBytes - PART_OVERHEAD_RESERVE_BYTES) {
      throw new CompleteBackupPartsError(
        'asset_too_large',
        `The file "${source.relativePath}" is about ${megabytes(source.sizeBytes)} MB, ` +
        `too large for one ${megabytes(partCeilingBytes)} MB backup part on this phone. ` +
        'Nothing was shared. Use Export Records Only to protect your records, and keep the original file.',
      );
    }
  }
}

/**
 * Build the parts, handing each one to `onPart` as it is finished so the
 * caller can write it out and let it go. Returns how many parts were written.
 */
export async function createCompleteBackupParts(
  input: Readonly<{
    state: unknown;
    assets: readonly CompleteBackupAssetSource[];
    passphrase: string;
    createdAt: string;
    backupId: string;
    partAssetBudgetBytes?: number;
  }>,
  dependencies: CompleteBackupArchiveDependencies,
  onPart: (part: CompleteBackupPart) => Promise<void>,
  onPartStart?: (partNumber: number, partCount: number) => void,
): Promise<number> {
  assertBackupAssetsFitParts(input.assets);
  const groups = splitBackupAssetsIntoParts(
    input.assets,
    input.partAssetBudgetBytes ?? DEFAULT_PART_ASSET_BUDGET_BYTES,
  );

  const nonceBytes = await dependencies.randomBytes(BACKUP_SET_NONCE_BYTES);
  if (!(nonceBytes instanceof Uint8Array) || nonceBytes.length !== BACKUP_SET_NONCE_BYTES) {
    throw new CompleteBackupPartsError('invalid_context', 'The backup set nonce could not be generated.');
  }
  const setNonce = bytesToHex(nonceBytes);
  for (let index = 0; index < groups.length; index += 1) {
    onPartStart?.(index + 1, groups.length);
    const loaded: CompleteBackupPlainAsset[] = [];
    // The single-file budget, applied per part: every part must itself fit the
    // device ceiling, and it reserves each file from its declared size before
    // the bytes are read.
    const partBudget = createBackupAssetBudget();
    for (const source of groups[index]) {
      partBudget.reserve(source.id, source.sizeBytes);
      const bytes = await source.read();
      if (bytes.byteLength !== source.sizeBytes) {
        // Same discipline as the single-file budget: a file that changed while
        // it was being read makes the backup untrustworthy.
        throw new CompleteBackupPartsError(
          'size_drift',
          'A file changed while the backup was being written. No partial backup will be shared.',
        );
      }
      loaded.push({
        id: source.id,
        kind: source.kind,
        relativePath: source.relativePath,
        bytes,
      });
    }

    const archive = await createCompleteBackupArchive({
      // Only part 0 carries the records. Later parts hold assets alone, so a
      // restore reads the state once and cannot find two disagreeing copies.
      state: index === 0 ? input.state : { backupPartPlaceholder: index },
      assets: loaded,
      passphrase: input.passphrase,
      createdAt: input.createdAt,
      partContext: { version: 1, setNonce, backupId: input.backupId, partIndex: index,
        partCount: groups.length, role: index === 0 ? 'records_and_assets' : 'assets' },
    }, dependencies);

    await onPart(Object.freeze({
      envelopeVersion: BOUND_BACKUP_PART_ENVELOPE_VERSION,
      setNonce,
      backupId: input.backupId,
      partIndex: index,
      partCount: groups.length,
      archive,
    }));
    // `loaded` goes out of scope here; the next part starts from nothing.
  }

  return groups.length;
}

export const LEGACY_MULTIPART_RECOVERY_WARNING =
  'This older multipart backup cannot verify that all selected files belong to the same backup. Files from different backups using the same passphrase could be combined. Recover only files you trust and saved together.';

export type BackupPartReadOptions = Readonly<{ allowLegacyMultipart?: boolean }>;

/** A malformed/new wrapper must never fall back to standalone legacy restore. */
export function hasBackupPartMarker(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) &&
    ['envelopeVersion', 'backupId', 'partIndex', 'partCount', 'archive', 'setNonce', 'partContext']
      .some(key => Object.prototype.hasOwnProperty.call(value, key)));
}

export function backupPartContext(part: CompleteBackupPart): BackupPartContext | null {
  if (part.envelopeVersion !== BOUND_BACKUP_PART_ENVELOPE_VERSION) return null;
  return parseBackupPartContext({ version: 1, setNonce: part.setNonce, backupId: part.backupId,
    partIndex: part.partIndex, partCount: part.partCount, role: part.partIndex === 0 ? 'records_and_assets' : 'assets' });
}

export function parseCompleteBackupPart(value: unknown, options: BackupPartReadOptions = {}): CompleteBackupPart {
  const p = value as Partial<CompleteBackupPart> | null;
  if (!p || typeof p !== 'object' || Array.isArray(p) ||
      (p.envelopeVersion !== LEGACY_BACKUP_PART_ENVELOPE_VERSION && p.envelopeVersion !== BACKUP_PART_ENVELOPE_VERSION) ||
      typeof p.backupId !== 'string' || !p.backupId.trim() ||
      !Number.isSafeInteger(p.partIndex) || !Number.isSafeInteger(p.partCount) ||
      (p.partIndex as number) < 0 || (p.partCount as number) < 1 || (p.partIndex as number) >= (p.partCount as number) ||
      !p.archive || typeof p.archive !== 'object') {
    throw new CompleteBackupPartsError('part_unreadable', 'One of the selected files is not a Vitruvius backup part.');
  }
  const part = Object.freeze({ envelopeVersion: p.envelopeVersion, backupId: p.backupId,
    partIndex: p.partIndex as number, partCount: p.partCount as number, archive: p.archive,
    ...(p.envelopeVersion === BOUND_BACKUP_PART_ENVELOPE_VERSION ? { setNonce: p.setNonce } : {}) });
  if (part.envelopeVersion === BOUND_BACKUP_PART_ENVELOPE_VERSION) {
    const expected = backupPartContext(part), carried = parseBackupPartContext(part.archive.partContext);
    if (!expected || part.archive.archiveVersion !== BOUND_COMPLETE_BACKUP_ARCHIVE_VERSION || !carried) {
      throw new CompleteBackupPartsError('part_unreadable', 'The multipart backup authentication context is missing or unsupported.');
    }
    if (backupPartContextKey(expected) !== backupPartContextKey(carried)) {
      throw new CompleteBackupPartsError('mixed_backups', 'These files come from different backups or their part headers were modified.');
    }
  } else {
    if (part.archive.archiveVersion !== 1 || Object.prototype.hasOwnProperty.call(p, 'setNonce') ||
        Object.prototype.hasOwnProperty.call(p, 'partContext') || Object.prototype.hasOwnProperty.call(part.archive, 'partContext')) {
      throw new CompleteBackupPartsError('part_unreadable', 'This multipart backup version or context is unsupported.');
    }
    if (options.allowLegacyMultipart !== true) {
      throw new CompleteBackupPartsError('legacy_multipart_unbound', LEGACY_MULTIPART_RECOVERY_WARNING);
    }
  }
  return part;
}

export function isCompleteBackupPart(value: unknown): value is CompleteBackupPart {
  try { parseCompleteBackupPart(value, { allowLegacyMultipart: true }); return true; } catch { return false; }
}

export type BackupPartHeader = Readonly<{
  backupId: string;
  partIndex: number;
  partCount: number;
  envelopeVersion?: CompleteBackupPart['envelopeVersion'];
  setNonce?: string;
}>;

/**
 * Refuses anything other than exactly one complete backup: mixed backups,
 * missing parts, duplicates, or a set whose declared count disagrees. Works on
 * headers alone, so a restore can check the whole set before decrypting any of
 * it and without holding every part in memory.
 */
export function validateBackupPartSet(parts: readonly BackupPartHeader[]): void {
  if (parts.length === 0) {
    throw new CompleteBackupPartsError('no_parts', 'No backup parts were selected.');
  }
  if (parts.some(part => !Number.isSafeInteger(part.partCount) || !Number.isSafeInteger(part.partIndex) ||
      part.partCount < 1 || part.partIndex < 0 || part.partIndex >= part.partCount)) {
    throw new CompleteBackupPartsError('part_unreadable', 'The backup part count or index is invalid.');
  }
  if (new Set(parts.map(part => part.backupId)).size !== 1 ||
      new Set(parts.map(part => part.envelopeVersion ?? 1)).size !== 1 ||
      new Set(parts.map(part => part.setNonce ?? null)).size !== 1) {
    throw new CompleteBackupPartsError(
      'mixed_backups',
      'These files come from different backups. Select the parts of a single backup.',
    );
  }
  if (new Set(parts.map(part => part.partCount)).size !== 1) {
    throw new CompleteBackupPartsError(
      'inconsistent_part_count',
      'These backup parts disagree about how many parts the backup has.',
    );
  }

  const partCount = parts[0].partCount;
  const seen = new Set(parts.map(part => part.partIndex));
  if (seen.size !== parts.length) {
    throw new CompleteBackupPartsError(
      'duplicate_part',
      'The same backup part was selected more than once.',
    );
  }
  if (seen.size !== partCount) {
    const missing: number[] = [];
    const missingCount = partCount - seen.size;
    // At most selected-file count + ten iterations, never an unauthenticated count-sized loop.
    for (let index = 0; index < partCount && missing.length < 10; index += 1) {
      if (!seen.has(index)) missing.push(index + 1);
    }
    throw new CompleteBackupPartsError(
      'incomplete_backup',
      `This backup has ${partCount} parts and ${missingCount} ${
        missingCount === 1 ? 'is' : 'are'
      } missing (part ${missing.join(', ')}${missingCount > missing.length ? ', …' : ''}). Nothing was restored.`,
    );
  }
}

/**
 * Restore from a set of parts. Refuses anything other than exactly one
 * complete backup: mixed backups, missing parts, duplicates, or a set whose
 * declared count disagrees.
 */
export async function readCompleteBackupParts(
  files: readonly unknown[],
  passphrase: string,
  dependencies: Readonly<{ sha256Hex?: BackupSha256 }> & BackupPartReadOptions = {},
): Promise<{ state: unknown; assets: Map<string, Uint8Array>; integrity: 'bound' | 'legacy_unbound' }> {
  if (files.length === 0) {
    throw new CompleteBackupPartsError('no_parts', 'No backup parts were selected.');
  }

  const parts = files.map(file => parseCompleteBackupPart(file, dependencies));

  validateBackupPartSet(parts);

  const ordered = [...parts].sort((left, right) => left.partIndex - right.partIndex);
  const assets = new Map<string, Uint8Array>();
  let state: unknown = null;

  for (const part of ordered) {
    const decrypted = await decryptCompleteBackupArchive(part.archive, passphrase, {
      sha256Hex: dependencies.sha256Hex, ...(backupPartContext(part) ? { partContext: backupPartContext(part)! } : {}),
    });
    if (part.partIndex === 0) state = decrypted.state;
    decrypted.assets.forEach((bytes, id) => {
      if (assets.has(id)) {
        throw new CompleteBackupPartsError(
          'duplicate_asset',
          'Two backup parts claim the same file. Nothing was restored.',
        );
      }
      assets.set(id, bytes);
    });
  }

  return { state, assets, integrity: parts[0].envelopeVersion === BOUND_BACKUP_PART_ENVELOPE_VERSION ? 'bound' : 'legacy_unbound' };
}

/** The single-file ceiling this exists to work around. */
export const SINGLE_FILE_CEILING_BYTES = MAX_DEVICE_BACKUP_BYTES;
