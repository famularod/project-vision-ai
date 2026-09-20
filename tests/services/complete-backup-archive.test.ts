import {
  CompleteBackupArchiveError,
  createCompleteBackupArchive,
  decryptCompleteBackupArchive,
} from '../../services/CompleteBackupArchive';

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

describe('CompleteBackupArchive', () => {
  test('encrypts application state and media and restores exact bytes', async () => {
    const state = {
      version: 1,
      projects: ['2321 Compliance Project'],
      savedUpdates: [{ id: 'update-1', notes: 'Concrete placed' }],
    };
    const archive = await createCompleteBackupArchive({
      state,
      passphrase: 'correct horse battery staple',
      createdAt: '2026-07-26T00:00:00.000Z',
      assets: [{
        id: 'photo-1',
        kind: 'photo',
        relativePath: 'photos/photo-1.jpg',
        bytes: Uint8Array.from([1, 2, 3, 4, 5]),
      }],
    }, { randomBytes: deterministicRandom() });

    const serialized = JSON.stringify(archive);
    expect(serialized).not.toContain('Concrete placed');
    expect(serialized).not.toContain('[1,2,3,4,5]');
    const restored = await decryptCompleteBackupArchive(
      JSON.parse(serialized),
      'correct horse battery staple',
    );
    expect(restored.state).toEqual(state);
    expect(Array.from(restored.assets.get('photo-1') || [])).toEqual([1, 2, 3, 4, 5]);
  });

  test('a records-only archive carries every record and no file bytes', async () => {
    // Added 2026-09-20 with the records-only export. The owner's full backup
    // exceeds the 128 MB archive limit and refuses to run, so this is the only
    // export that completes on that phone — it must round trip exactly.
    // Photo details are kept so the records stay intact; no asset id is
    // written, because there are no bytes for one to point at.
    const state = {
      version: 1,
      projects: ['2321 Compliance Project'],
      savedUpdates: [{
        id: 'update-1',
        notes: 'Concrete placed',
        photos: [{ id: 'photo-1', uri: '', fileName: 'photo-1.jpg' }],
      }],
      scheduleItems: [{ id: 'task-1', taskName: 'SURVEY' }],
    };

    const archive = await createCompleteBackupArchive({
      state,
      passphrase: 'correct horse battery staple',
      createdAt: '2026-09-20T00:00:00.000Z',
      assets: [],
    }, { randomBytes: deterministicRandom() });

    expect(archive.manifest.counts.assetCount).toBe(0);
    expect(archive.manifest.counts.assetBytes).toBe(0);

    const serialized = JSON.stringify(archive);
    expect(serialized).not.toContain('Concrete placed');
    expect(serialized).not.toContain('SURVEY');

    const restored = await decryptCompleteBackupArchive(
      JSON.parse(serialized),
      'correct horse battery staple',
    );

    expect(restored.state).toEqual(state);
    expect(restored.assets.size).toBe(0);
    // No dangling asset reference: restore must not go looking for bytes that
    // this archive never claimed to carry.
    const [update] = (restored.state as typeof state).savedUpdates;
    expect(update.photos[0]).not.toHaveProperty('_backupAssetId');
  });

  test('rejects the wrong passphrase without returning partial data', async () => {
    const archive = await createCompleteBackupArchive({
      state: { projects: ['A'] },
      passphrase: 'correct horse battery staple',
      createdAt: '2026-07-26T00:00:00.000Z',
      assets: [],
    }, { randomBytes: deterministicRandom() });

    await expect(
      decryptCompleteBackupArchive(archive, 'wrong password but long'),
    ).rejects.toMatchObject({
      code: 'wrong_passphrase_or_tampered',
    });
  });

  test('rejects archive tampering before restore', async () => {
    const archive = await createCompleteBackupArchive({
      state: { projects: ['A'] },
      passphrase: 'correct horse battery staple',
      createdAt: '2026-07-26T00:00:00.000Z',
      assets: [],
    }, { randomBytes: deterministicRandom() });
    const tampered = {
      ...archive,
      encryption: {
        ...archive.encryption,
        saltBase64: archive.encryption.saltBase64.replace(/.$/, 'A'),
      },
    };
    await expect(
      decryptCompleteBackupArchive(tampered, 'correct horse battery staple'),
    ).rejects.toBeInstanceOf(CompleteBackupArchiveError);
  });

  test('requires a meaningful passphrase', async () => {
    await expect(
      createCompleteBackupArchive({
        state: {},
        passphrase: 'short',
        createdAt: '2026-07-26T00:00:00.000Z',
        assets: [],
      }, { randomBytes: deterministicRandom() }),
    ).rejects.toMatchObject({
      code: 'passphrase_too_short',
    });
  });
});
