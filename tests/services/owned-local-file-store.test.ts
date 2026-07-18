import {
  OwnedLocalFileStoreError,
  createOwnedLocalFileStore,
  type OwnedLocalFileStoreDependencies,
} from '../../services/OwnedLocalFileStore';
import {
  createOwnedLocalFileManifest,
  resolveOwnedLocalFilePath,
} from '../../services/OwnedLocalFileRepository';

const FILE_ID = '550e8400-e29b-41d4-a716-446655440000';
const SOURCE_URI = 'content://document-provider/external-photo';
const OWNED_ROOT = 'file:///data/app/Documents/dave-owned-files';
const BASENAME = `${FILE_ID}.jpg`;
const OWNED_PATH = `${OWNED_ROOT}/${BASENAME}`;
const SOURCE_BYTES = new Uint8Array([1, 2, 3, 4, 5, 6]);

class FailureInjectingFileSystem {
  readonly files = new Map<string, Uint8Array>();
  readonly ensuredDirectories: string[] = [];
  readonly readCalls: string[] = [];
  readonly deleteCalls: string[] = [];
  failCopy = false;
  corruptCopy = false;

  readonly dependencies: OwnedLocalFileStoreDependencies = {
    generateOpaqueFileId: () => FILE_ID,
    ensureDirectory: async directoryUri => {
      this.ensuredDirectories.push(directoryUri);
    },
    copyFile: async (sourceUri, destinationUri) => {
      const source = this.files.get(sourceUri);
      if (!source) throw new Error('source missing');

      if (this.failCopy) {
        this.files.set(destinationUri, new Uint8Array([255]));
        throw new Error('injected copy failure');
      }

      const copied = new Uint8Array(source);
      if (this.corruptCopy) copied[0] = copied[0] ^ 0xff;
      this.files.set(destinationUri, copied);
    },
    readBytes: async fileUri => {
      this.readCalls.push(fileUri);
      const bytes = this.files.get(fileUri);
      if (!bytes) throw new Error('file missing');
      return new Uint8Array(bytes);
    },
    statFile: async fileUri => {
      const bytes = this.files.get(fileUri);
      return {
        exists: bytes !== undefined,
        sizeBytes: bytes?.byteLength ?? null,
      };
    },
    deleteFile: async fileUri => {
      this.deleteCalls.push(fileUri);
      if (!this.files.delete(fileUri)) throw new Error('file missing');
    },
    sha256: async bytes => testSha256(bytes),
  };

  constructor() {
    this.files.set(SOURCE_URI, new Uint8Array(SOURCE_BYTES));
  }
}

function testSha256(bytes: Uint8Array) {
  return Array.from(bytes)
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
    .padEnd(64, '0')
    .slice(0, 64);
}

function expectStoreError(
  error: unknown,
  code: OwnedLocalFileStoreError['code'],
) {
  expect(error).toBeInstanceOf(OwnedLocalFileStoreError);
  expect(error).toMatchObject({ code });
}

function createFixture() {
  const fileSystem = new FailureInjectingFileSystem();
  const store = createOwnedLocalFileStore({
    ownedRoot: OWNED_ROOT,
    dependencies: fileSystem.dependencies,
  });

  return { fileSystem, store };
}

async function storePhoto() {
  const fixture = createFixture();
  const record = await fixture.store.storeExternalFile({
    sourceUri: SOURCE_URI,
    kind: 'photo',
    extension: 'jpg',
    mimeType: 'image/jpeg',
  });
  const manifest = createOwnedLocalFileManifest([record]);

  return { ...fixture, record, manifest };
}

describe('OwnedLocalFileStore', () => {
  it('returns a manifest record only after a durable size and SHA-256 verified copy', async () => {
    const { fileSystem, store } = createFixture();

    const record = await store.storeExternalFile({
      sourceUri: SOURCE_URI,
      kind: 'photo',
      extension: 'jpg',
      mimeType: 'image/jpeg',
    });

    expect(record).toEqual({
      version: 1,
      fileId: FILE_ID,
      kind: 'photo',
      generatedBasename: BASENAME,
      sha256: testSha256(SOURCE_BYTES),
      sizeBytes: SOURCE_BYTES.byteLength,
      mimeType: 'image/jpeg',
      relativePath: BASENAME,
    });
    expect(fileSystem.ensuredDirectories).toEqual([OWNED_ROOT]);
    expect(fileSystem.files.get(OWNED_PATH)).toEqual(SOURCE_BYTES);
    expect(Object.isFrozen(record)).toBe(true);
  });

  it('cleans a partial destination and returns no record when copy fails', async () => {
    const { fileSystem, store } = createFixture();
    fileSystem.failCopy = true;

    let caught: unknown;
    try {
      await store.storeExternalFile({
        sourceUri: SOURCE_URI,
        kind: 'photo',
        extension: 'jpg',
        mimeType: 'image/jpeg',
      });
    } catch (error) {
      caught = error;
    }

    expectStoreError(caught, 'copy_failed');
    expect(caught).toMatchObject({
      recoveryState: 'retryable',
      cleanupRequired: false,
    });
    expect(fileSystem.files.has(OWNED_PATH)).toBe(false);
    expect(fileSystem.deleteCalls).toEqual([OWNED_PATH]);
  });

  it('rejects and cleans a copied file whose checksum differs from the source', async () => {
    const { fileSystem, store } = createFixture();
    fileSystem.corruptCopy = true;

    let caught: unknown;
    try {
      await store.storeExternalFile({
        sourceUri: SOURCE_URI,
        kind: 'photo',
        extension: 'jpg',
        mimeType: 'image/jpeg',
      });
    } catch (error) {
      caught = error;
    }

    expectStoreError(caught, 'integrity_mismatch');
    expect(fileSystem.files.has(OWNED_PATH)).toBe(false);
    expect(fileSystem.deleteCalls).toEqual([OWNED_PATH]);
  });

  it.each([
    `${OWNED_ROOT}/../private/secret.jpg`,
    `${OWNED_ROOT}/%2e%2e%2fprivate%2fsecret.jpg`,
    'file:///etc/passwd',
    `file:///data/app/Documents/dave-owned-files-other/${BASENAME}`,
  ])('rejects traversal, absolute, or same-prefix candidate %p before I/O', async candidatePath => {
    const { fileSystem, store, record, manifest } = await storePhoto();
    const readCount = fileSystem.readCalls.length;
    const deleteCount = fileSystem.deleteCalls.length;

    await expect(store.readAuthorizedFile({
      manifest,
      fileId: record.fileId,
      candidatePath,
      expectedKind: 'photo',
    })).rejects.toMatchObject({ code: 'authorization_denied' });

    await expect(store.deleteAuthorizedFile({
      manifest,
      fileId: record.fileId,
      candidatePath,
      expectedKind: 'photo',
    })).rejects.toMatchObject({ code: 'authorization_denied' });

    expect(fileSystem.readCalls).toHaveLength(readCount);
    expect(fileSystem.deleteCalls).toHaveLength(deleteCount);
    expect(fileSystem.files.has(OWNED_PATH)).toBe(true);
  });

  it('rejects missing, corrupt, and nonmember manifests before file I/O', async () => {
    const { fileSystem, store, record } = await storePhoto();
    const readCount = fileSystem.readCalls.length;

    await expect(store.readAuthorizedFile({
      manifest: null,
      fileId: record.fileId,
      candidatePath: OWNED_PATH,
    })).rejects.toMatchObject({
      code: 'manifest_invalid',
      recoveryState: 'restore_or_reselect',
    });

    await expect(store.readAuthorizedFile({
      manifest: { version: 2, files: {} },
      fileId: record.fileId,
      candidatePath: OWNED_PATH,
    })).rejects.toMatchObject({ code: 'manifest_invalid' });

    await expect(store.readAuthorizedFile({
      manifest: createOwnedLocalFileManifest([]),
      fileId: record.fileId,
      candidatePath: OWNED_PATH,
    })).rejects.toMatchObject({ code: 'manifest_member_missing' });

    expect(fileSystem.readCalls).toHaveLength(readCount);
  });

  it('rejects missing and mismatched manifest-owned bytes without deleting them', async () => {
    const missing = await storePhoto();
    missing.fileSystem.files.delete(OWNED_PATH);

    await expect(missing.store.readAuthorizedFile({
      manifest: missing.manifest,
      fileId: missing.record.fileId,
      candidatePath: OWNED_PATH,
    })).rejects.toMatchObject({
      code: 'file_missing',
      recoveryState: 'restore_or_reselect',
    });

    const mismatched = await storePhoto();
    mismatched.fileSystem.files.set(OWNED_PATH, new Uint8Array([9, 9, 9, 9, 9, 9]));

    await expect(mismatched.store.readAuthorizedFile({
      manifest: mismatched.manifest,
      fileId: mismatched.record.fileId,
      candidatePath: OWNED_PATH,
    })).rejects.toMatchObject({ code: 'integrity_mismatch' });

    await expect(mismatched.store.deleteAuthorizedFile({
      manifest: mismatched.manifest,
      fileId: mismatched.record.fileId,
      candidatePath: OWNED_PATH,
    })).rejects.toMatchObject({ code: 'integrity_mismatch' });

    expect(mismatched.fileSystem.files.has(OWNED_PATH)).toBe(true);
    expect(mismatched.fileSystem.deleteCalls).toEqual([]);
  });

  it('reads and deletes a legitimate exact manifest member', async () => {
    const { fileSystem, store, record, manifest } = await storePhoto();
    const candidatePath = resolveOwnedLocalFilePath({
      ownedRoot: OWNED_ROOT,
      manifest,
      fileId: record.fileId,
      expectedKind: 'photo',
    });

    await expect(store.readAuthorizedFile({
      manifest,
      fileId: record.fileId,
      candidatePath,
      expectedKind: 'photo',
    })).resolves.toEqual(SOURCE_BYTES);

    await expect(store.deleteAuthorizedFile({
      manifest,
      fileId: record.fileId,
      candidatePath,
      expectedKind: 'photo',
    })).resolves.toEqual({
      fileId: record.fileId,
      deleted: true,
    });

    expect(fileSystem.files.has(OWNED_PATH)).toBe(false);
    expect(fileSystem.deleteCalls).toEqual([OWNED_PATH]);
  });
});
