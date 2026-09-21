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
 * This splits the assets across several parts, each one a complete, valid
 * archive in its own right produced by the proven createCompleteBackupArchive.
 * Nothing about the archive format changes; the parts are wrapped in a small
 * plaintext envelope naming which backup they belong to and how many there
 * are. Reuse is the point: the encryption path is the last place to introduce
 * a novel implementation.
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
  type CompleteBackupArchive,
  type CompleteBackupArchiveDependencies,
  type CompleteBackupPlainAsset,
} from './CompleteBackupArchive';
import { MAX_DEVICE_BACKUP_BYTES } from './BackupExportPolicy';

export const BACKUP_PART_ENVELOPE_VERSION = 1 as const;

/**
 * Leave room inside each part for the encrypted state, the manifest and JSON
 * overhead. Deliberately well under the ceiling rather than tuned close to it:
 * a part that overshoots is a failed backup.
 */
export const DEFAULT_PART_ASSET_BUDGET_BYTES = 64 * 1024 * 1024;

/** A file the backup will carry, described before its bytes are loaded. */
export type CompleteBackupAssetSource = Readonly<{
  id: string;
  kind: CompleteBackupPlainAsset['kind'];
  relativePath: string;
  sizeBytes: number;
  read: () => Promise<Uint8Array>;
}>;

export type CompleteBackupPart = Readonly<{
  envelopeVersion: typeof BACKUP_PART_ENVELOPE_VERSION;
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
): Promise<number> {
  const groups = splitBackupAssetsIntoParts(
    input.assets,
    input.partAssetBudgetBytes ?? DEFAULT_PART_ASSET_BUDGET_BYTES,
  );

  for (let index = 0; index < groups.length; index += 1) {
    const loaded: CompleteBackupPlainAsset[] = [];
    for (const source of groups[index]) {
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
    }, dependencies);

    await onPart(Object.freeze({
      envelopeVersion: BACKUP_PART_ENVELOPE_VERSION,
      backupId: input.backupId,
      partIndex: index,
      partCount: groups.length,
      archive,
    }));
    // `loaded` goes out of scope here; the next part starts from nothing.
  }

  return groups.length;
}

export function isCompleteBackupPart(value: unknown): value is CompleteBackupPart {
  const part = value as Partial<CompleteBackupPart> | null;
  return Boolean(
    part &&
    typeof part === 'object' &&
    part.envelopeVersion === BACKUP_PART_ENVELOPE_VERSION &&
    typeof part.backupId === 'string' &&
    part.backupId &&
    Number.isSafeInteger(part.partIndex) &&
    Number.isSafeInteger(part.partCount) &&
    (part.partIndex as number) >= 0 &&
    (part.partCount as number) >= 1 &&
    (part.partIndex as number) < (part.partCount as number) &&
    part.archive,
  );
}

/**
 * Restore from a set of parts. Refuses anything other than exactly one
 * complete backup: mixed backups, missing parts, duplicates, or a set whose
 * declared count disagrees.
 */
export async function readCompleteBackupParts(
  files: readonly unknown[],
  passphrase: string,
): Promise<{ state: unknown; assets: Map<string, Uint8Array> }> {
  if (files.length === 0) {
    throw new CompleteBackupPartsError('no_parts', 'No backup parts were selected.');
  }

  const parts: CompleteBackupPart[] = [];
  for (const file of files) {
    if (!isCompleteBackupPart(file)) {
      throw new CompleteBackupPartsError(
        'part_unreadable',
        'One of the selected files is not a Vitruvius backup part.',
      );
    }
    parts.push(file);
  }

  if (new Set(parts.map(part => part.backupId)).size !== 1) {
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
    for (let index = 0; index < partCount; index += 1) {
      if (!seen.has(index)) missing.push(index + 1);
    }
    throw new CompleteBackupPartsError(
      'incomplete_backup',
      `This backup has ${partCount} parts and ${missing.length} ${
        missing.length === 1 ? 'is' : 'are'
      } missing (part ${missing.join(', ')}). Nothing was restored.`,
    );
  }

  const ordered = [...parts].sort((left, right) => left.partIndex - right.partIndex);
  const assets = new Map<string, Uint8Array>();
  let state: unknown = null;

  for (const part of ordered) {
    const decrypted = await decryptCompleteBackupArchive(part.archive, passphrase);
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

  return { state, assets };
}

/** The single-file ceiling this exists to work around. */
export const SINGLE_FILE_CEILING_BYTES = MAX_DEVICE_BACKUP_BYTES;
