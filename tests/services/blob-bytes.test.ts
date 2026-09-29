/**
 * Field test, 28 Sep 2026: every cloud-only document failed to open or back up
 * on the iPhone. React Native's Blob has no arrayBuffer(), which the download
 * called unguarded; Node's Blob has one, so the tests never saw it.
 */
import { blobToBytes, type BlobByteReader } from '../../services/BlobBytes';

function reactNativeLikeBlob(): Blob {
  // No arrayBuffer(), as on React Native 0.86.
  return { size: 3, type: 'application/pdf' } as unknown as Blob;
}

function fakeReader(outcome: { bytes?: number[]; error?: unknown; result?: unknown }) {
  const reader: BlobByteReader = {
    onload: null,
    onerror: null,
    result: null,
    error: null,
    readAsArrayBuffer: () => {
      queueMicrotask(() => {
        if (outcome.error !== undefined) {
          reader.error = outcome.error;
          reader.onerror?.();
        } else {
          reader.result = outcome.result ?? new Uint8Array(outcome.bytes ?? []).buffer;
          reader.onload?.();
        }
      });
    },
  };
  return reader;
}

describe('blobToBytes', () => {
  it('uses arrayBuffer() where the Blob has it', async () => {
    const createReader = jest.fn();
    const bytes = await blobToBytes(new Blob([new Uint8Array([1, 2, 3])]), createReader);
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
    expect(createReader).not.toHaveBeenCalled();
  });

  it('reads a React Native Blob through FileReader instead of throwing', async () => {
    const bytes = await blobToBytes(reactNativeLikeBlob(), () => fakeReader({ bytes: [7, 8, 9] }));
    expect(Array.from(bytes)).toEqual([7, 8, 9]);
  });

  it('passes on the reader\'s reason when the read fails', async () => {
    await expect(blobToBytes(reactNativeLikeBlob(), () => fakeReader({ error: { message: 'blob released' } })))
      .rejects.toThrow('blob released');
    await expect(blobToBytes(reactNativeLikeBlob(), () => fakeReader({ error: 'odd' })))
      .rejects.toThrow('The downloaded file could not be read.');
  });

  it('refuses a result that is not bytes', async () => {
    await expect(blobToBytes(reactNativeLikeBlob(), () => fakeReader({ result: 'data:...' })))
      .rejects.toThrow('could not be read as bytes');
  });

  it('is what both document downloads use', () => {
    const fs = jest.requireActual('fs') as typeof import('fs');
    const path = jest.requireActual('path') as typeof import('path');
    for (const file of ['ExpoReferenceDocumentByteRestore.ts', 'ExpoProjectDocumentByteRestore.ts']) {
      const source = fs.readFileSync(path.resolve(__dirname, '../../services', file), 'utf8');
      expect(source).toContain('return blobToBytes(result.data);');
      expect(source).not.toContain('.arrayBuffer()');
    }
  });
});
