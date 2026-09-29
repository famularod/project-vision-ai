/**
 * Device backup workflow: the file handling around the encrypted archive.
 *
 * The full device backup leaves the phone as several parts (see
 * CompleteBackupArchiveParts) because the owner's photos exceed the 128 MB
 * single-file ceiling. This module owns what happens around those parts:
 * describing the files to carry without loading them, writing and sharing
 * one part at a time, opening either a legacy single-file backup or a set of
 * parts for restore, and placing the restored files back on the device.
 *
 * Everything touches the file system through BackupFileIO so the whole round
 * trip is tested in memory; ExpoBackupFileIO is the device adapter.
 *
 * Restore holds at most one part in memory: parts are checked from their
 * plaintext headers first, then decrypted one by one and their files staged
 * on disk before any record is replaced.
 */
import {
  decryptCompleteBackupArchive,
  type CompleteBackupArchiveDependencies,
  type CompleteBackupPlainAsset,
  type DecryptedCompleteBackup,
} from './CompleteBackupArchive';
import {
  assertBackupAssetsFitParts,
  countBackupParts,
  createCompleteBackupParts,
  isCompleteBackupPart,
  validateBackupPartSet,
  CompleteBackupPartsError,
  type CompleteBackupAssetSource,
} from './CompleteBackupArchiveParts';
import { assertBackupSerializedFits } from './BackupExportPolicy';

export type BackupFileIO = Readonly<{
  /** Size in bytes, or null when there is no file at the address. */
  sizeOf: (uri: string) => Promise<number | null>;
  readBytes: (uri: string) => Promise<Uint8Array>;
  readText: (uri: string) => Promise<string>;
  writeText: (uri: string, text: string) => Promise<void>;
  writeBytes: (uri: string, bytes: Uint8Array) => Promise<void>;
  move: (from: string, to: string) => Promise<void>;
  remove: (uri: string) => Promise<void>;
  makeDirectory: (uri: string) => Promise<void>;
}>;

type BackupAssetInput = Readonly<{
  id: string;
  kind: CompleteBackupPlainAsset['kind'];
  relativePath: string;
  uri: string;
}>;

/** The file to carry, or null when there is no file at its address. */
export async function measureBackupAssetSource(
  io: BackupFileIO,
  input: BackupAssetInput,
): Promise<CompleteBackupAssetSource | null> {
  const sizeBytes = await io.sizeOf(input.uri);
  if (sizeBytes === null) return null;
  return Object.freeze({
    id: input.id,
    kind: input.kind,
    relativePath: input.relativePath,
    sizeBytes,
    read: () => io.readBytes(input.uri),
  });
}

export async function describeBackupAssetSource(
  io: BackupFileIO,
  input: BackupAssetInput,
): Promise<CompleteBackupAssetSource> {
  const source = await measureBackupAssetSource(io, input);
  if (!source) {
    throw new Error(`The required ${input.kind.replace('_', ' ')} file is unavailable.`);
  }
  return source;
}

/**
 * A photo whose file is neither on this device nor downloadable from the
 * cloud. The backup keeps its field update and leaves the photo out, with the
 * owner's agreement, instead of refusing to back up anything at all.
 */
export type UnavailableBackupPhoto = Readonly<{ projectName: string; updateDate: string }>;

/** A document whose file could not be read or downloaded now, and why. */
export type UnavailableBackupDocument = Readonly<{ name: string; reason: string }>;

const NOTICE_DATES_PER_PROJECT = 5;
const NOTICE_DOCUMENTS = 5;
const NOTICE_REASON_CHARACTERS = 160;

/** A reason short enough to read in an alert; native errors carry long cause chains. */
function shortReason(reason: string): string {
  const firstLine = reason.split(/\s*(?:\n|→)\s*/)[0].trim() || reason.trim();
  return firstLine.length > NOTICE_REASON_CHARACTERS
    ? `${firstLine.slice(0, NOTICE_REASON_CHARACTERS - 1).trimEnd()}…`
    : firstLine;
}

export function unavailablePhotosNotice(missing: readonly UnavailableBackupPhoto[]): string {
  const byProject = new Map<string, Map<string, number>>();
  for (const photo of missing) {
    const project = photo.projectName.trim() || 'No project';
    const day = photo.updateDate.trim().slice(0, 10) || 'undated';
    const days = byProject.get(project) ?? new Map<string, number>();
    days.set(day, (days.get(day) ?? 0) + 1);
    byProject.set(project, days);
  }
  const lines = [...byProject].map(([project, days]) => {
    const count = [...days.values()].reduce((sum, value) => sum + value, 0);
    const dates = [...days.keys()].sort();
    const shown = dates.slice(0, NOTICE_DATES_PER_PROJECT).join(', ');
    const more = dates.length > NOTICE_DATES_PER_PROJECT
      ? ` and ${dates.length - NOTICE_DATES_PER_PROJECT} more`
      : '';
    return `${project}: ${count} ${count === 1 ? 'photo' : 'photos'}, from updates dated ${shown}${more}`;
  });
  const n = missing.length;
  return (
    `${n} ${n === 1 ? 'photo is' : 'photos are'} not on this device and could not be downloaded ` +
    `from the cloud, so this backup will leave ${n === 1 ? 'it' : 'them'} out. ` +
    `The field updates themselves are kept.\n\n${lines.join('\n')}`
  );
}

export function unavailableFilesNotice(
  photos: readonly UnavailableBackupPhoto[],
  documents: readonly UnavailableBackupDocument[],
): string {
  const sections = photos.length > 0 ? [unavailablePhotosNotice(photos)] : [];
  if (documents.length > 0) {
    const n = documents.length;
    const shown = documents.slice(0, NOTICE_DOCUMENTS).map(document => `${document.name}: ${shortReason(document.reason)}`);
    const more = n > NOTICE_DOCUMENTS ? `\nand ${n - NOTICE_DOCUMENTS} more` : '';
    sections.push(
      `${n} ${n === 1 ? 'document' : 'documents'} could not be read on this device, so this backup ` +
      `will leave ${n === 1 ? 'its file' : 'their files'} out. The document records are kept, ` +
      `and copies stored in the cloud are not affected.\n\n${shown.join('\n')}${more}`,
    );
  }
  return sections.join('\n\n');
}

export function backupPartFileName(stem: string, partIndex: number, partCount: number): string {
  return partCount === 1
    ? `${stem}.vitruvius-backup`
    : `${stem}-part-${partIndex + 1}-of-${partCount}.vitruvius-backup`;
}

export function multiPartBackupNotice(partCount: number): string {
  return (
    `This backup is too large for one file, so it will be saved as ${partCount} files. ` +
    `A share sheet opens for each one: save all ${partCount} to the same place. ` +
    'A restore needs every part; a missing part restores nothing.'
  );
}

export type BackupPartsExportResult = Readonly<{
  status: 'shared' | 'cancelled';
  partCount: number;
}>;

/**
 * Write each part, share it, delete it, then build the next. Nothing is
 * written until every file has been measured and the owner has agreed to the
 * number of parts.
 */
export async function exportBackupInParts(
  input: Readonly<{
    state: unknown;
    sources: readonly CompleteBackupAssetSource[];
    passphrase: string;
    createdAt: string;
    backupId: string;
    directory: string;
    fileStem: string;
    partAssetBudgetBytes?: number;
    unavailablePhotos?: readonly UnavailableBackupPhoto[];
    unavailableDocuments?: readonly UnavailableBackupDocument[];
  }>,
  dependencies: CompleteBackupArchiveDependencies & Readonly<{
    io: BackupFileIO;
    share: (uri: string, partNumber: number, partCount: number) => Promise<void>;
    confirmPartCount: (partCount: number) => Promise<boolean>;
    /** Required when any file is unavailable; it is asked before anything else. */
    confirmUnavailableFiles?: (notice: string) => Promise<boolean>;
  }>,
): Promise<BackupPartsExportResult> {
  const photos = input.unavailablePhotos ?? [];
  const documents = input.unavailableDocuments ?? [];
  if (photos.length + documents.length > 0) {
    const notice = unavailableFilesNotice(photos, documents);
    if (!dependencies.confirmUnavailableFiles) throw new Error(notice);
    if (!(await dependencies.confirmUnavailableFiles(notice))) {
      return { status: 'cancelled', partCount: 0 };
    }
  }
  assertBackupAssetsFitParts(input.sources);
  const partCount = countBackupParts(input.sources, input.partAssetBudgetBytes);
  if (partCount > 1 && !(await dependencies.confirmPartCount(partCount))) {
    return { status: 'cancelled', partCount };
  }

  await createCompleteBackupParts({
    state: input.state,
    assets: input.sources,
    passphrase: input.passphrase,
    createdAt: input.createdAt,
    backupId: input.backupId,
    partAssetBudgetBytes: input.partAssetBudgetBytes,
  }, { randomBytes: dependencies.randomBytes }, async part => {
    const serialized = JSON.stringify(part);
    assertBackupSerializedFits(serialized);
    const uri = `${input.directory}${backupPartFileName(
      input.fileStem,
      part.partIndex,
      part.partCount,
    )}`;
    try {
      await dependencies.io.writeText(uri, serialized);
      await dependencies.share(uri, part.partIndex + 1, part.partCount);
    } finally {
      await dependencies.io.remove(uri).catch(() => undefined);
    }
  });

  return { status: 'shared', partCount };
}

export type StagedBackupAsset = Readonly<{
  uri: string;
  fileName: string;
  byteLength: number;
}>;

export type StagedBackupAssets = Readonly<{
  assets: ReadonlyMap<string, StagedBackupAsset>;
  cleanup: () => Promise<void>;
}>;

export type OpenedBackup =
  | Readonly<{ kind: 'single'; state: unknown; decrypted: DecryptedCompleteBackup }>
  | Readonly<{
      kind: 'parts';
      state: unknown;
      partCount: number;
      stageAssets: (stagingDirectory: string) => Promise<StagedBackupAssets>;
    }>;

function parseBackupFile(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new CompleteBackupPartsError(
      'part_unreadable',
      'One of the selected files is not a Vitruvius backup.',
    );
  }
}

/**
 * Open what the owner picked: one legacy single-file backup, or every part of
 * one multi-part backup. Decrypts only the records (part 1) so the restore can
 * be previewed and confirmed before any file is written.
 */
export async function openSelectedBackup(
  uris: readonly string[],
  passphrase: string,
  io: BackupFileIO,
): Promise<OpenedBackup> {
  if (uris.length === 0) {
    throw new CompleteBackupPartsError('no_parts', 'No backup was selected.');
  }

  const headers: { uri: string; backupId: string; partIndex: number; partCount: number }[] = [];
  let firstPart: unknown = null;
  for (const uri of uris) {
    const parsed = parseBackupFile(await io.readText(uri));
    if (!isCompleteBackupPart(parsed)) {
      if (uris.length === 1) {
        const decrypted = await decryptCompleteBackupArchive(parsed, passphrase);
        return { kind: 'single', state: decrypted.state, decrypted };
      }
      throw new CompleteBackupPartsError(
        'part_unreadable',
        'One of the selected files is not part of a multi-part Vitruvius backup. ' +
          'To restore an older single-file backup, select only that file.',
      );
    }
    headers.push({
      uri,
      backupId: parsed.backupId,
      partIndex: parsed.partIndex,
      partCount: parsed.partCount,
    });
    // Keep only the part that carries the records; the rest are re-read one
    // at a time when their files are staged.
    if (parsed.partIndex === 0) firstPart = parsed.archive;
  }

  validateBackupPartSet(headers);
  const ordered = [...headers].sort((left, right) => left.partIndex - right.partIndex);
  const { state } = await decryptCompleteBackupArchive(firstPart, passphrase);

  return {
    kind: 'parts',
    state,
    partCount: ordered.length,
    stageAssets: stagingDirectory => stageBackupPartAssets(ordered, passphrase, io, stagingDirectory),
  };
}

async function stageBackupPartAssets(
  ordered: readonly Readonly<{ uri: string; backupId: string; partIndex: number }>[],
  passphrase: string,
  io: BackupFileIO,
  stagingDirectory: string,
): Promise<StagedBackupAssets> {
  const staged = new Map<string, StagedBackupAsset>();
  const cleanup = async () => {
    await io.remove(stagingDirectory).catch(() => undefined);
  };

  try {
    await io.makeDirectory(stagingDirectory);
    for (const expected of ordered) {
      const parsed = parseBackupFile(await io.readText(expected.uri));
      if (
        !isCompleteBackupPart(parsed) ||
        parsed.backupId !== expected.backupId ||
        parsed.partIndex !== expected.partIndex
      ) {
        throw new CompleteBackupPartsError(
          'part_changed',
          'A backup part changed after it was selected. Nothing was restored.',
        );
      }
      const decrypted = await decryptCompleteBackupArchive(parsed.archive, passphrase);
      const names = new Map(decrypted.manifest.assets.map(asset => [asset.id, asset.relativePath]));
      let fileNumber = 0;
      for (const [id, bytes] of decrypted.assets) {
        if (staged.has(id)) {
          throw new CompleteBackupPartsError(
            'duplicate_asset',
            'Two backup parts claim the same file. Nothing was restored.',
          );
        }
        const uri = `${stagingDirectory}${expected.partIndex}-${fileNumber}.bin`;
        fileNumber += 1;
        await io.writeBytes(uri, bytes);
        staged.set(id, {
          uri,
          fileName: names.get(id) || 'restored-file.bin',
          byteLength: bytes.byteLength,
        });
      }
      // `decrypted` goes out of scope here; the next part starts from nothing.
    }
    return { assets: staged, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

/** A restored file, taken once, then written or moved to its final place. */
export type BackupAssetProvider = Readonly<{
  take: (assetId: unknown) => Readonly<{
    fileName: string;
    byteLength: number;
    placeAt: (uri: string) => Promise<void>;
  }>;
  assertAllTaken: () => void;
}>;

function createAssetProvider(
  total: number,
  lookup: (id: string) => Readonly<{
    fileName: string;
    byteLength: number;
    placeAt: (uri: string) => Promise<void>;
  }> | null,
): BackupAssetProvider {
  const taken = new Set<string>();
  return Object.freeze({
    take(assetId: unknown) {
      if (typeof assetId !== 'string' || !assetId.trim()) {
        throw new Error('A restored media record is missing its encrypted media id.');
      }
      const found = lookup(assetId);
      if (!found) throw new Error(`Encrypted media "${assetId}" is missing.`);
      if (taken.has(assetId)) {
        throw new Error(`Encrypted media "${assetId}" is referenced more than once.`);
      }
      taken.add(assetId);
      return found;
    },
    assertAllTaken() {
      if (taken.size !== total) {
        throw new Error('The backup contains unreferenced encrypted media.');
      }
    },
  });
}

/** Files decrypted into memory from a legacy single-file backup. */
export function decryptedBytesAssetProvider(
  decrypted: DecryptedCompleteBackup,
  io: BackupFileIO,
): BackupAssetProvider {
  const names = new Map(decrypted.manifest.assets.map(asset => [asset.id, asset.relativePath]));
  return createAssetProvider(decrypted.assets.size, id => {
    const bytes = decrypted.assets.get(id);
    if (!bytes) return null;
    return {
      fileName: names.get(id) || 'restored-file.bin',
      byteLength: bytes.byteLength,
      placeAt: uri => io.writeBytes(uri, bytes),
    };
  });
}

/** Files already staged on disk from a multi-part backup. */
export function stagedAssetProvider(
  staged: StagedBackupAssets,
  io: BackupFileIO,
): BackupAssetProvider {
  return createAssetProvider(staged.assets.size, id => {
    const asset = staged.assets.get(id);
    if (!asset) return null;
    return {
      fileName: asset.fileName,
      byteLength: asset.byteLength,
      placeAt: uri => io.move(asset.uri, uri),
    };
  });
}

export type OwnedProjectDocumentImport = (input: Readonly<{
  sourceUri: string;
  ownedRoot: string;
  fileName: string;
  mimeType: string;
  reportedSizeBytes: number;
}>) => Promise<Readonly<{
  localUri: string;
  fileId: string;
  manifest: unknown;
  record: Readonly<{ sizeBytes: number }>;
}>>;

export type MaterializeBackupDependencies = Readonly<{
  io: BackupFileIO;
  newId: () => string;
  sanitizeFilename: (fileName: string) => string;
  photoDirectory: () => Promise<string>;
  referenceDocumentsDirectory: () => Promise<string>;
  ownedProjectDocumentsRoot: string | null;
  cacheDirectory: string | null;
  importProjectDocument: OwnedProjectDocumentImport;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/**
 * Put every restored file in its final place and point the records at it.
 * Returns the state to commit plus a cleanup that removes the files this
 * wrote, for when the commit does not happen. On any failure, everything
 * written so far is removed before the error is rethrown.
 */
export async function materializeCompleteBackupState(
  stateInput: unknown,
  provider: BackupAssetProvider,
  dependencies: MaterializeBackupDependencies,
): Promise<{ state: Record<string, unknown>; cleanup: () => Promise<void> }> {
  const { io } = dependencies;
  const state = JSON.parse(JSON.stringify(stateInput)) as Record<string, unknown>;
  const createdUris: string[] = [];
  const removeCreated = async () => {
    await Promise.all(createdUris.map(uri => io.remove(uri).catch(() => undefined)));
  };
  const place = async (directory: string, assetId: unknown) => {
    const asset = provider.take(assetId);
    const uri = `${directory}${dependencies.newId()}-${dependencies.sanitizeFilename(asset.fileName)}`;
    await asset.placeAt(uri);
    createdUris.push(uri);
    return { uri, asset };
  };
  const materializeUpdatePhotos = async (update: unknown) => {
    if (!isRecord(update) || !Array.isArray(update.photos)) return;
    const directory = await dependencies.photoDirectory();
    for (const photo of update.photos) {
      if (!isRecord(photo)) {
        throw new Error('A restored photo record is invalid.');
      }
      // A records-only archive carries no file bytes by design. Restore the
      // photo's details and leave it without a local file, rather than
      // failing the whole restore over a file the archive never claimed.
      if (!photo._backupAssetId) {
        photo.uri = '';
        continue;
      }
      photo.uri = (await place(directory, photo._backupAssetId)).uri;
      delete photo._backupAssetId;
    }
  };

  try {
    if (!Array.isArray(state.savedUpdates) ||
        !Array.isArray(state.referenceDocuments) ||
        !Array.isArray(state.projectDocuments)) {
      throw new Error('The encrypted application state is incomplete.');
    }
    for (const update of state.savedUpdates) {
      await materializeUpdatePhotos(update);
    }
    if (isRecord(state.activeDraft)) {
      await materializeUpdatePhotos(state.activeDraft.draft);
    }
    const referenceDirectory = await dependencies.referenceDocumentsDirectory();
    for (const document of state.referenceDocuments) {
      if (!isRecord(document)) {
        throw new Error('A restored reference document record is invalid.');
      }
      if (!document._backupAssetId) {
        document.uri = '';
        continue;
      }
      const placed = await place(referenceDirectory, document._backupAssetId);
      document.uri = placed.uri;
      document.sizeBytes = placed.asset.byteLength;
      delete document._backupAssetId;
    }
    const ownedRoot = dependencies.ownedProjectDocumentsRoot;
    const cacheDirectory = dependencies.cacheDirectory;
    if (!ownedRoot || !cacheDirectory) {
      throw new Error('Verified project document storage is unavailable.');
    }
    for (const document of state.projectDocuments) {
      if (!isRecord(document)) {
        throw new Error('A restored project document record is invalid.');
      }
      if (!document._backupAssetId) {
        document.localUri = null;
        document.ownedFileId = null;
        document.ownedFileManifest = null;
        continue;
      }
      const temporary = await place(cacheDirectory, document._backupAssetId);
      const mimeType = typeof document.mimeType === 'string'
        ? document.mimeType
        : 'application/octet-stream';
      const owned = await dependencies.importProjectDocument({
        sourceUri: temporary.uri,
        ownedRoot,
        fileName: typeof document.name === 'string' ? document.name : temporary.asset.fileName,
        mimeType,
        reportedSizeBytes: temporary.asset.byteLength,
      });
      createdUris.push(owned.localUri);
      await io.remove(temporary.uri);
      createdUris.splice(createdUris.indexOf(temporary.uri), 1);
      document.localUri = owned.localUri;
      document.ownedFileId = owned.fileId;
      document.ownedFileManifest = owned.manifest;
      document.sizeBytes = owned.record.sizeBytes;
      delete document._backupAssetId;
    }
    provider.assertAllTaken();
    return { state, cleanup: removeCreated };
  } catch (error) {
    await removeCreated();
    throw error;
  }
}
