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

  // Field test, 28 Sep 2026: hashing in JavaScript on the phone took minutes
  // per part. The phone now passes its native SHA-256. An archive must be the
  // same whichever implementation wrote or reads it.
  test('a native SHA-256 writes the same hashes, is used for media and envelope, and is read either way', async () => {
    const { createHash } = jest.requireActual('crypto') as typeof import('crypto');
    const hashed: number[] = [];
    const nativeSha256 = async (bytes: Uint8Array) => {
      hashed.push(bytes.byteLength);
      return createHash('sha256').update(bytes).digest('hex');
    };
    const input = {
      state: { version: 1, savedUpdates: [{ id: 'update-1' }] },
      passphrase: 'correct horse battery staple',
      createdAt: '2026-09-28T00:00:00.000Z',
      assets: [{ id: 'photo-1', kind: 'photo' as const, relativePath: 'photo-1.jpg', bytes: new Uint8Array(4096).fill(7) }],
    };
    const withNative = await createCompleteBackupArchive(input, { randomBytes: deterministicRandom(), sha256Hex: nativeSha256 });
    const withJavaScript = await createCompleteBackupArchive(input, { randomBytes: deterministicRandom() });

    expect(withNative.manifest.assets[0].sha256).toBe(withJavaScript.manifest.assets[0].sha256);
    expect(withNative.envelopeSha256).toBe(withJavaScript.envelopeSha256);
    expect(hashed[0]).toBe(4096);
    expect(hashed[1]).toBeGreaterThan(4096);

    const readByJavaScript = await decryptCompleteBackupArchive(JSON.parse(JSON.stringify(withNative)), input.passphrase);
    expect(Array.from(readByJavaScript.assets.get('photo-1') ?? []).every(value => value === 7)).toBe(true);
    hashed.length = 0;
    const readByNative = await decryptCompleteBackupArchive(
      JSON.parse(JSON.stringify(withJavaScript)), input.passphrase, { sha256Hex: nativeSha256 },
    );
    expect(readByNative.assets.get('photo-1')?.byteLength).toBe(4096);
    expect(hashed).toHaveLength(2);
  });

  test('a native SHA-256 still catches a changed envelope', async () => {
    const { createHash } = jest.requireActual('crypto') as typeof import('crypto');
    const nativeSha256 = async (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
    const archive = await createCompleteBackupArchive({
      state: { version: 1 }, passphrase: 'correct horse battery staple', createdAt: '2026-09-28T00:00:00.000Z',
      assets: [{ id: 'photo-1', kind: 'photo', relativePath: 'p.jpg', bytes: Uint8Array.from([1, 2, 3]) }],
    }, { randomBytes: deterministicRandom(), sha256Hex: nativeSha256 });
    const changed = JSON.parse(JSON.stringify(archive));
    changed.manifest.createdAt = '2026-09-29T00:00:00.000Z';
    await expect(decryptCompleteBackupArchive(changed, 'correct horse battery staple', { sha256Hex: nativeSha256 }))
      .rejects.toMatchObject({ code: 'invalid_archive' });
  });

  // Field test, 28 Sep 2026: restore decrypted part 1 in full to preview its
  // records, then again to stage its files.
  test('a records-only read returns the state, no files, and still checks the envelope and passphrase', async () => {
    const archive = await createCompleteBackupArchive({
      state: { version: 1, savedUpdates: [{ id: 'update-1' }] },
      passphrase: 'correct horse battery staple',
      createdAt: '2026-09-28T00:00:00.000Z',
      assets: [{ id: 'photo-1', kind: 'photo', relativePath: 'p.jpg', bytes: Uint8Array.from([1, 2, 3]) }],
    }, { randomBytes: deterministicRandom() });
    const copy = () => JSON.parse(JSON.stringify(archive));

    const read = await decryptCompleteBackupArchive(copy(), 'correct horse battery staple', { stateOnly: true });
    expect(read.state).toEqual({ version: 1, savedUpdates: [{ id: 'update-1' }] });
    expect(read.assets.size).toBe(0);
    expect(read.manifest.assets.map(asset => asset.id)).toEqual(['photo-1']);

    await expect(decryptCompleteBackupArchive(copy(), 'a different passphrase', { stateOnly: true }))
      .rejects.toMatchObject({ code: 'wrong_passphrase_or_tampered' });
    const changed = copy();
    changed.encryptedAssets[0].encrypted.ciphertextBase64 = 'AAAA';
    await expect(decryptCompleteBackupArchive(changed, 'correct horse battery staple', { stateOnly: true }))
      .rejects.toMatchObject({ code: 'invalid_archive' });
  });
});
