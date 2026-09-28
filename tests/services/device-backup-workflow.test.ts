/**
 * The device backup workflow end to end, on an in-memory file system:
 * describe files → write and share parts → pick them → stage → place.
 *
 * The rules these hold: nothing leaves the phone until every file is measured
 * and the owner agrees to the part count; a restore needs every part of one
 * backup; and a restore puts every photo's exact bytes back.
 */
import { createCompleteBackupArchive } from '../../services/CompleteBackupArchive';
import {
  backupPartFileName,
  decryptedBytesAssetProvider,
  describeBackupAssetSource,
  exportBackupInParts,
  materializeCompleteBackupState,
  multiPartBackupNotice,
  openSelectedBackup,
  stagedAssetProvider,
  type BackupFileIO,
  type MaterializeBackupDependencies,
} from '../../services/DeviceBackupWorkflow';
import { CompleteBackupPartsError } from '../../services/CompleteBackupArchiveParts';

const PASSPHRASE = 'correct horse battery staple';

function deterministicRandom() {
  let seed = 1;
  return async (length: number) => {
    const bytes = new Uint8Array(length);
    for (let index = 0; index < length; index += 1) {
      bytes[index] = seed % 251;
      seed += 1;
    }
    return bytes;
  };
}

function memoryFileSystem() {
  const files = new Map<string, Uint8Array | string>();
  const directories = new Set<string>();
  const io: BackupFileIO = {
    sizeOf: async uri => {
      const value = files.get(uri);
      if (value === undefined) return null;
      return typeof value === 'string' ? value.length : value.byteLength;
    },
    readBytes: async uri => {
      const value = files.get(uri);
      if (!(value instanceof Uint8Array)) throw new Error(`no bytes at ${uri}`);
      return value;
    },
    readText: async uri => {
      const value = files.get(uri);
      if (typeof value !== 'string') throw new Error(`no text at ${uri}`);
      return value;
    },
    writeText: async (uri, text) => { files.set(uri, text); },
    writeBytes: async (uri, bytes) => { files.set(uri, new Uint8Array(bytes)); },
    move: async (from, to) => {
      const value = files.get(from);
      if (value === undefined) throw new Error(`nothing to move at ${from}`);
      files.delete(from);
      files.set(to, value);
    },
    remove: async uri => {
      files.delete(uri);
      directories.delete(uri);
      for (const key of [...files.keys()]) {
        if (uri.endsWith('/') && key.startsWith(uri)) files.delete(key);
      }
    },
    makeDirectory: async uri => { directories.add(uri); },
  };
  return { files, directories, io };
}

function photoBytes(size: number, fill: number) {
  return new Uint8Array(size).fill(fill);
}

const STATE_TEMPLATE = () => ({
  version: 2,
  savedUpdates: [{
    id: 'update-1',
    projectName: '2321 Compliance Project',
    photos: [
      { id: 'p1', uri: '', _backupAssetId: 'photo:update:update-1:p1' },
      { id: 'p2', uri: '', _backupAssetId: 'photo:update:update-1:p2' },
      { id: 'p3', uri: '', _backupAssetId: 'photo:update:update-1:p3' },
    ],
  }],
  referenceDocuments: [],
  projectDocuments: [],
  scheduleItems: [{ id: 'task-1', taskName: 'SURVEY' }],
});

async function sourcesFor(io: BackupFileIO, files: Map<string, Uint8Array | string>) {
  const photos = [
    ['p1', photoBytes(600, 1)],
    ['p2', photoBytes(600, 2)],
    ['p3', photoBytes(600, 3)],
  ] as const;
  const sources = [];
  for (const [id, bytes] of photos) {
    files.set(`file:///photos/${id}.jpg`, bytes);
    sources.push(await describeBackupAssetSource(io, {
      id: `photo:update:update-1:${id}`,
      kind: 'photo',
      relativePath: `${id}.jpg`,
      uri: `file:///photos/${id}.jpg`,
    }));
  }
  return sources;
}

function materializeDependencies(io: BackupFileIO): MaterializeBackupDependencies {
  let next = 0;
  return {
    io,
    newId: () => `id${(next += 1)}`,
    sanitizeFilename: name => name.replace(/[^A-Za-z0-9._-]/g, '_'),
    photoDirectory: async () => 'file:///restored-photos/',
    referenceDocumentsDirectory: async () => 'file:///restored-references/',
    ownedProjectDocumentsRoot: 'file:///owned/',
    cacheDirectory: 'file:///cache/',
    importProjectDocument: async () => { throw new Error('not used'); },
  };
}

async function exportToShared(budget: number, confirm = true) {
  const fs = memoryFileSystem();
  const sources = await sourcesFor(fs.io, fs.files);
  const shared: { uri: string; text: string; partNumber: number; partCount: number }[] = [];
  const confirmations: number[] = [];
  const result = await exportBackupInParts({
    state: STATE_TEMPLATE(),
    sources,
    passphrase: PASSPHRASE,
    createdAt: '2026-09-27T00:00:00.000Z',
    backupId: 'backup-1',
    directory: 'file:///cache/',
    fileStem: 'vitruvius-device-backup-2026-09-27',
    partAssetBudgetBytes: budget,
  }, {
    io: fs.io,
    randomBytes: deterministicRandom(),
    confirmPartCount: async count => { confirmations.push(count); return confirm; },
    share: async (uri, partNumber, partCount) => {
      shared.push({ uri, text: await fs.io.readText(uri), partNumber, partCount });
    },
  });
  return { fs, result, shared, confirmations };
}

describe('exportBackupInParts', () => {
  it('asks once with the part count, then shares every part and leaves no file behind', async () => {
    const { fs, result, shared, confirmations } = await exportToShared(900);

    expect(result).toEqual({ status: 'shared', partCount: 3 });
    expect(confirmations).toEqual([3]);
    expect(shared.map(item => [item.partNumber, item.partCount])).toEqual([[1, 3], [2, 3], [3, 3]]);
    expect(shared.map(item => item.uri)).toEqual([
      'file:///cache/vitruvius-device-backup-2026-09-27-part-1-of-3.vitruvius-backup',
      'file:///cache/vitruvius-device-backup-2026-09-27-part-2-of-3.vitruvius-backup',
      'file:///cache/vitruvius-device-backup-2026-09-27-part-3-of-3.vitruvius-backup',
    ]);
    for (const item of shared) expect(fs.files.has(item.uri)).toBe(false);
  });

  it('does not ask when the backup fits one file, and keeps the plain file name', async () => {
    const { result, shared, confirmations } = await exportToShared(64 * 1024 * 1024);

    expect(result).toEqual({ status: 'shared', partCount: 1 });
    expect(confirmations).toEqual([]);
    expect(shared.map(item => item.uri)).toEqual([
      'file:///cache/vitruvius-device-backup-2026-09-27.vitruvius-backup',
    ]);
  });

  it('writes and shares nothing when the owner declines the part count', async () => {
    const { fs, result, shared } = await exportToShared(900, false);

    expect(result).toEqual({ status: 'cancelled', partCount: 3 });
    expect(shared).toEqual([]);
    expect([...fs.files.keys()].some(key => key.startsWith('file:///cache/'))).toBe(false);
  });

  it('refuses a file too large for any part before sharing anything', async () => {
    const fs = memoryFileSystem();
    const share = jest.fn();
    const confirm = jest.fn();
    await expect(exportBackupInParts({
      state: STATE_TEMPLATE(),
      sources: [{
        id: 'reference_document:big',
        kind: 'reference_document',
        relativePath: 'drawings.pdf',
        sizeBytes: 100 * 1024 * 1024,
        read: async () => new Uint8Array(0),
      }],
      passphrase: PASSPHRASE,
      createdAt: '2026-09-27T00:00:00.000Z',
      backupId: 'backup-1',
      directory: 'file:///cache/',
      fileStem: 'stem',
    }, { io: fs.io, randomBytes: deterministicRandom(), share, confirmPartCount: confirm }))
      .rejects.toThrow(/drawings\.pdf.*too large/);
    expect(share).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('refuses two files with one identity before sharing anything', async () => {
    const fs = memoryFileSystem();
    const share = jest.fn();
    const source = {
      id: 'photo:same',
      kind: 'photo' as const,
      relativePath: 'a.jpg',
      sizeBytes: 10,
      read: async () => new Uint8Array(10),
    };
    await expect(exportBackupInParts({
      state: STATE_TEMPLATE(),
      sources: [source, { ...source, relativePath: 'b.jpg' }],
      passphrase: PASSPHRASE,
      createdAt: '2026-09-27T00:00:00.000Z',
      backupId: 'backup-1',
      directory: 'file:///cache/',
      fileStem: 'stem',
    }, { io: fs.io, randomBytes: deterministicRandom(), share, confirmPartCount: async () => true }))
      .rejects.toMatchObject({ code: 'duplicate_asset' });
    expect(share).not.toHaveBeenCalled();
  });

  it('names a missing file when describing it', async () => {
    const fs = memoryFileSystem();
    await expect(describeBackupAssetSource(fs.io, {
      id: 'photo:x',
      kind: 'project_document',
      relativePath: 'x.pdf',
      uri: 'file:///missing.pdf',
    })).rejects.toThrow('The required project document file is unavailable.');
  });
});

async function pickShared(shared: { text: string }[], fs = memoryFileSystem()) {
  const uris = shared.map((item, index) => {
    const uri = `file:///picked/${index}.vitruvius-backup`;
    fs.files.set(uri, item.text);
    return uri;
  });
  return { fs, uris };
}

describe('restore from parts', () => {
  it('restores every photo byte from a three-part backup, in any selection order', async () => {
    const { shared } = await exportToShared(900);
    const { fs, uris } = await pickShared([...shared].reverse());

    const opened = await openSelectedBackup(uris, PASSPHRASE, fs.io);
    expect(opened.kind).toBe('parts');
    if (opened.kind !== 'parts') return;
    expect(opened.partCount).toBe(3);
    expect(opened.state).toEqual(STATE_TEMPLATE());

    const staged = await opened.stageAssets('file:///cache/staging/');
    const materialized = await materializeCompleteBackupState(
      opened.state,
      stagedAssetProvider(staged, fs.io),
      materializeDependencies(fs.io),
    );
    await staged.cleanup();

    const photos = (materialized.state.savedUpdates as any[])[0].photos;
    expect(photos.map((photo: any) => photo._backupAssetId)).toEqual([undefined, undefined, undefined]);
    photos.forEach((photo: any, index: number) => {
      expect(photo.uri.startsWith('file:///restored-photos/')).toBe(true);
      expect(Array.from(fs.files.get(photo.uri) as Uint8Array)).toEqual(
        Array.from(photoBytes(600, index + 1)),
      );
    });
    expect([...fs.files.keys()].some(key => key.startsWith('file:///cache/staging/'))).toBe(false);
  });

  it('refuses an incomplete set and names the missing part', async () => {
    const { shared } = await exportToShared(900);
    const { fs, uris } = await pickShared([shared[0], shared[2]]);

    await expect(openSelectedBackup(uris, PASSPHRASE, fs.io))
      .rejects.toThrow(/3 parts and 1 is missing \(part 2\)/);
  });

  it('refuses a lone later part instead of treating it as a whole backup', async () => {
    const { shared } = await exportToShared(900);
    const { fs, uris } = await pickShared([shared[1]]);

    await expect(openSelectedBackup(uris, PASSPHRASE, fs.io))
      .rejects.toBeInstanceOf(CompleteBackupPartsError);
  });

  it('refuses parts of two different backups', async () => {
    const first = await exportToShared(900);
    const second = await exportToShared(900);
    const other = JSON.parse(second.shared[1].text);
    other.backupId = 'backup-2';
    const { fs, uris } = await pickShared([
      first.shared[0],
      { text: JSON.stringify(other) },
      first.shared[2],
    ]);

    await expect(openSelectedBackup(uris, PASSPHRASE, fs.io))
      .rejects.toMatchObject({ code: 'mixed_backups' });
  });

  it('refuses a wrong passphrase before any file is written', async () => {
    const { shared } = await exportToShared(900);
    const { fs, uris } = await pickShared(shared);

    await expect(openSelectedBackup(uris, 'a different passphrase', fs.io)).rejects.toThrow();
    expect([...fs.files.keys()].some(key => !key.startsWith('file:///picked/'))).toBe(false);
  });

  it('removes staged files when a part changed after it was selected', async () => {
    const { shared } = await exportToShared(900);
    const { fs, uris } = await pickShared(shared);
    const opened = await openSelectedBackup(uris, PASSPHRASE, fs.io);
    if (opened.kind !== 'parts') throw new Error('expected parts');
    fs.files.set(uris[2], shared[0].text);

    await expect(opened.stageAssets('file:///cache/staging/'))
      .rejects.toMatchObject({ code: 'part_changed' });
    expect([...fs.files.keys()].some(key => key.startsWith('file:///cache/staging/'))).toBe(false);
  });

  it('refuses a mix of a single-file backup and parts', async () => {
    const { shared } = await exportToShared(900);
    const legacy = await createCompleteBackupArchive({
      state: STATE_TEMPLATE(),
      assets: [],
      passphrase: PASSPHRASE,
      createdAt: '2026-09-27T00:00:00.000Z',
    }, { randomBytes: deterministicRandom() });
    const { fs, uris } = await pickShared([{ text: JSON.stringify(legacy) }, shared[0]]);

    await expect(openSelectedBackup(uris, PASSPHRASE, fs.io))
      .rejects.toThrow(/select only that file/);
  });
});

describe('restore from a legacy single-file backup', () => {
  it('still opens and places its files', async () => {
    const state = STATE_TEMPLATE();
    state.savedUpdates[0].photos = [state.savedUpdates[0].photos[0]];
    const legacy = await createCompleteBackupArchive({
      state,
      assets: [{ id: 'photo:update:update-1:p1', kind: 'photo', relativePath: 'p1.jpg', bytes: photoBytes(50, 9) }],
      passphrase: PASSPHRASE,
      createdAt: '2026-09-27T00:00:00.000Z',
    }, { randomBytes: deterministicRandom() });
    const { fs, uris } = await pickShared([{ text: JSON.stringify(legacy) }]);

    const opened = await openSelectedBackup(uris, PASSPHRASE, fs.io);
    expect(opened.kind).toBe('single');
    if (opened.kind !== 'single') return;
    const materialized = await materializeCompleteBackupState(
      opened.state,
      decryptedBytesAssetProvider(opened.decrypted, fs.io),
      materializeDependencies(fs.io),
    );
    const photo = (materialized.state.savedUpdates as any[])[0].photos[0];
    expect(Array.from(fs.files.get(photo.uri) as Uint8Array)).toEqual(Array.from(photoBytes(50, 9)));
  });

  it('refuses media the records never reference, and removes what it placed', async () => {
    const state = STATE_TEMPLATE();
    state.savedUpdates[0].photos = [state.savedUpdates[0].photos[0]];
    const legacy = await createCompleteBackupArchive({
      state,
      assets: [
        { id: 'photo:update:update-1:p1', kind: 'photo', relativePath: 'p1.jpg', bytes: photoBytes(50, 9) },
        { id: 'photo:orphan', kind: 'photo', relativePath: 'orphan.jpg', bytes: photoBytes(50, 4) },
      ],
      passphrase: PASSPHRASE,
      createdAt: '2026-09-27T00:00:00.000Z',
    }, { randomBytes: deterministicRandom() });
    const { fs, uris } = await pickShared([{ text: JSON.stringify(legacy) }]);
    const opened = await openSelectedBackup(uris, PASSPHRASE, fs.io);
    if (opened.kind !== 'single') throw new Error('expected single');

    await expect(materializeCompleteBackupState(
      opened.state,
      decryptedBytesAssetProvider(opened.decrypted, fs.io),
      materializeDependencies(fs.io),
    )).rejects.toThrow('unreferenced encrypted media');
    expect([...fs.files.keys()].some(key => key.startsWith('file:///restored-photos/'))).toBe(false);
  });
});

describe('owner-facing wording', () => {
  it('says how many files and that every part is needed', () => {
    expect(multiPartBackupNotice(4)).toMatch(/4 files/);
    expect(multiPartBackupNotice(4)).toMatch(/every part/);
    expect(backupPartFileName('stem', 1, 4)).toBe('stem-part-2-of-4.vitruvius-backup');
  });
});
