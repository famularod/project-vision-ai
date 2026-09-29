/**
 * Field test, 28 Sep 2026 (Build 212): every downloaded cloud document failed
 * its integrity check with "NotTypedArrayException", because the native
 * expo-crypto digest takes only a TypedArray and was handed an ArrayBuffer.
 * The mock below enforces the native rule, which Node's real crypto does not.
 */
import { createHash } from 'crypto';

jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digest: jest.fn(async (_algorithm: string, data: unknown) => {
    if (!ArrayBuffer.isView(data)) {
      throw new Error('NotTypedArrayException: Given argument is not an instance of TypedArray');
    }
    const view = data as Uint8Array;
    const hash = jest.requireActual('crypto').createHash('sha256')
      .update(Buffer.from(view.buffer, view.byteOffset, view.byteLength)).digest();
    return new Uint8Array(hash).buffer;
  }),
}));

import * as Crypto from 'expo-crypto';
import { sha256Hex } from '../../services/ExpoSha256';

describe('sha256Hex', () => {
  it('hands the digest a TypedArray and returns lowercase hex', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    await expect(sha256Hex(bytes)).resolves.toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(ArrayBuffer.isView((Crypto.digest as jest.Mock).mock.calls[0][1])).toBe(true);
  });

  it('hashes only the viewed bytes of a view into a larger buffer', async () => {
    const backing = new Uint8Array([9, 9, 1, 2, 3, 9]);
    const view = backing.subarray(2, 5);
    await expect(sha256Hex(view)).resolves.toBe(createHash('sha256').update(Buffer.from([1, 2, 3])).digest('hex'));
  });

  it('passes a whole-buffer array as is, without a copy', async () => {
    const bytes = new Uint8Array([5, 6, 7]);
    (Crypto.digest as jest.Mock).mockClear();
    await sha256Hex(bytes);
    expect((Crypto.digest as jest.Mock).mock.calls[0][1]).toBe(bytes);
  });

  it('is what both document downloads and the device backup use', () => {
    const fs = jest.requireActual('fs') as typeof import('fs');
    const path = jest.requireActual('path') as typeof import('path');
    const backupIO = fs.readFileSync(path.resolve(__dirname, '../../services/ExpoBackupFileIO.ts'), 'utf8');
    expect(backupIO).toContain("import { sha256Hex } from './ExpoSha256';");
    expect(backupIO).toContain('  sha256Hex,');
    for (const file of ['ExpoReferenceDocumentByteRestore.ts', 'ExpoProjectDocumentByteRestore.ts']) {
      const source = fs.readFileSync(path.resolve(__dirname, '../../services', file), 'utf8');
      expect(source).toContain('sha256: sha256Hex,');
      expect(source).not.toContain('Crypto.digest(');
    }
  });
});
