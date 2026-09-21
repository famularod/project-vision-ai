/**
 * Multi-part backup: the export that lets photos be protected at all on a
 * phone whose single-file archive exceeds the 128 MB ceiling.
 *
 * The rule these tests exist to hold: a restore either has one complete
 * backup or it fails loudly. A partial restore is worse than an obvious
 * failure, because the owner would believe their records were recovered.
 */
import {
  countBackupParts,
  createCompleteBackupParts,
  readCompleteBackupParts,
  splitBackupAssetsIntoParts,
  CompleteBackupPartsError,
  type CompleteBackupPart,
} from '../../services/CompleteBackupArchiveParts';

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

function asset(id: string, rawBytes: number) {
  const bytes = new Uint8Array(rawBytes).fill(7);
  return {
    id,
    kind: 'photo' as const,
    relativePath: `photos/${id}.jpg`,
    sizeBytes: rawBytes,
    bytes,
    read: async () => bytes,
  };
}

const PASSPHRASE = 'correct horse battery staple';
const STATE = {
  version: 1,
  projects: ['2321 Compliance Project'],
  scheduleItems: [{ id: 'task-1', taskName: 'SURVEY' }],
};

async function makeParts(assets: ReturnType<typeof asset>[], budget: number) {
  const collected: CompleteBackupPart[] = [];
  await createCompleteBackupParts({
    state: STATE,
    assets,
    passphrase: PASSPHRASE,
    createdAt: '2026-09-20T00:00:00.000Z',
    backupId: 'backup-1',
    partAssetBudgetBytes: budget,
  }, { randomBytes: deterministicRandom() }, async part => { collected.push(part); });
  return collected;
}

describe('splitBackupAssetsIntoParts', () => {
  it('measures encoded size, not raw size', () => {
    // base64 adds a third. Splitting on raw bytes would undercount and produce
    // parts that overshoot the ceiling they exist to stay under.
    const assets = [asset('a', 900), asset('b', 900)];

    expect(splitBackupAssetsIntoParts(assets, 1600)).toHaveLength(2);
    expect(splitBackupAssetsIntoParts(assets, 2400)).toHaveLength(1);
  });

  it('gives an oversized single asset its own part rather than failing', () => {
    const parts = splitBackupAssetsIntoParts([asset('huge', 10_000)], 100);

    expect(parts).toHaveLength(1);
    expect(parts[0].map(item => item.id)).toEqual(['huge']);
  });

  it('returns one empty part when there is nothing to carry', () => {
    expect(splitBackupAssetsIntoParts([], 1000)).toEqual([[]]);
    expect(countBackupParts([], 1000)).toBe(1);
  });

  it('rejects a nonsensical budget', () => {
    expect(() => splitBackupAssetsIntoParts([asset('a', 10)], 0)).toThrow(CompleteBackupPartsError);
    expect(() => splitBackupAssetsIntoParts([asset('a', 10)], -1)).toThrow(CompleteBackupPartsError);
  });
});

describe('multi-part backup round trip', () => {
  it('splits assets across parts and restores every byte', async () => {
    const assets = [asset('a', 600), asset('b', 600), asset('c', 600)];
    const parts = await makeParts(assets, 900);

    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every(part => part.partCount === parts.length)).toBe(true);
    expect(parts.map(part => part.partIndex)).toEqual(parts.map((_, index) => index));

    const restored = await readCompleteBackupParts(parts, PASSPHRASE);

    expect(restored.state).toEqual(STATE);
    expect(restored.assets.size).toBe(3);
    for (const item of assets) {
      expect(Array.from(restored.assets.get(item.id) || [])).toEqual(Array.from(item.bytes));
    }
  });

  it('keeps the records out of every part except the first', async () => {
    const parts = await makeParts([asset('a', 600), asset('b', 600)], 900);
    const serialized = parts.slice(1).map(part => JSON.stringify(part));

    // Records live in part 0 only, so a restore cannot find two disagreeing
    // copies of the same state.
    for (const text of serialized) {
      expect(text).not.toContain('SURVEY');
      expect(text).not.toContain('2321 Compliance Project');
    }
  });

  it('accepts the parts in any order', async () => {
    const parts = await makeParts([asset('a', 600), asset('b', 600)], 900);
    const restored = await readCompleteBackupParts([...parts].reverse(), PASSPHRASE);

    expect(restored.state).toEqual(STATE);
    expect(restored.assets.size).toBe(2);
  });

  it('still works as a single part when everything fits', async () => {
    const parts = await makeParts([asset('a', 100)], 10_000);

    expect(parts).toHaveLength(1);
    expect((await readCompleteBackupParts(parts, PASSPHRASE)).state).toEqual(STATE);
  });
});

describe('memory discipline: a part reads only its own files', () => {
  it('does not load every file before writing the first part', async () => {
    // This is the whole reason the API takes sources rather than buffers.
    // Splitting a list of already-loaded photos would bound each file's size
    // while still holding the entire backup in memory — exactly the failure
    // the 128 MB ceiling exists to prevent. Peak memory must be one part.
    const readOrder: string[] = [];
    const sources = ['a', 'b', 'c'].map(id => {
      const bytes = new Uint8Array(600).fill(7);
      return {
        id,
        kind: 'photo' as const,
        relativePath: `photos/${id}.jpg`,
        sizeBytes: 600,
        read: async () => { readOrder.push(id); return bytes; },
      };
    });

    const readsWhenPartWritten: number[] = [];
    const count = await createCompleteBackupParts({
      state: STATE,
      assets: sources,
      passphrase: PASSPHRASE,
      createdAt: '2026-09-20T00:00:00.000Z',
      backupId: 'backup-1',
      partAssetBudgetBytes: 900,
    }, { randomBytes: deterministicRandom() }, async () => {
      readsWhenPartWritten.push(readOrder.length);
    });

    expect(count).toBe(3);
    // One file per part here, so each part must have read exactly one more.
    expect(readsWhenPartWritten).toEqual([1, 2, 3]);
  });

  it('refuses a file that changed size while the backup was being written', async () => {
    const shifty = {
      id: 'a',
      kind: 'photo' as const,
      relativePath: 'photos/a.jpg',
      sizeBytes: 600,
      read: async () => new Uint8Array(599).fill(7),
    };

    await expect(createCompleteBackupParts({
      state: STATE,
      assets: [shifty],
      passphrase: PASSPHRASE,
      createdAt: '2026-09-20T00:00:00.000Z',
      backupId: 'backup-1',
    }, { randomBytes: deterministicRandom() }, async () => {}))
      .rejects.toThrow(/changed while/i);
  });

  it('refuses an untrustworthy declared size before reading anything', () => {
    for (const bad of [undefined, null, -1, 1.5, Number.NaN]) {
      expect(() => splitBackupAssetsIntoParts([{
        id: 'a',
        kind: 'photo' as const,
        relativePath: 'photos/a.jpg',
        sizeBytes: bad as number,
        read: async () => new Uint8Array(0),
      }], 1000)).toThrow(/trustworthy size/i);
    }
  });
});

describe('a restore refuses anything but one complete backup', () => {
  it('names the missing parts instead of restoring what it has', async () => {
    const parts = await makeParts([asset('a', 600), asset('b', 600), asset('c', 600)], 900);

    await expect(readCompleteBackupParts([parts[0]], PASSPHRASE))
      .rejects.toThrow(/missing/i);
  });

  it('rejects parts from two different backups', async () => {
    const first = await makeParts([asset('a', 600), asset('b', 600)], 900);
    const second: CompleteBackupPart[] = [];
    await createCompleteBackupParts({
      state: STATE,
      assets: [asset('a', 600), asset('b', 600)],
      passphrase: PASSPHRASE,
      createdAt: '2026-09-21T00:00:00.000Z',
      backupId: 'backup-2',
      partAssetBudgetBytes: 900,
    }, { randomBytes: deterministicRandom() }, async part => { second.push(part); });

    await expect(readCompleteBackupParts([first[0], second[1]], PASSPHRASE))
      .rejects.toThrow(/different backups/i);
  });

  it('rejects the same part selected twice', async () => {
    const parts = await makeParts([asset('a', 600), asset('b', 600)], 900);

    await expect(readCompleteBackupParts([parts[0], parts[0]], PASSPHRASE))
      .rejects.toThrow(/more than once/i);
  });

  it('rejects a file that is not a backup part', async () => {
    await expect(readCompleteBackupParts([{ hello: 'world' }], PASSPHRASE))
      .rejects.toThrow(/not a Vitruvius backup part/i);
    await expect(readCompleteBackupParts([null], PASSPHRASE))
      .rejects.toThrow(CompleteBackupPartsError);
  });

  it('rejects an empty selection', async () => {
    await expect(readCompleteBackupParts([], PASSPHRASE))
      .rejects.toThrow(/No backup parts/i);
  });

  it('does not accept the wrong passphrase for a later part', async () => {
    const parts = await makeParts([asset('a', 600), asset('b', 600)], 900);

    await expect(readCompleteBackupParts(parts, 'a different passphrase entirely'))
      .rejects.toThrow();
  });
});
