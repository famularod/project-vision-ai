/**
 * The bytes of a downloaded Blob, on every platform.
 *
 * React Native's Blob (0.86) has no arrayBuffer(), so calling it throws on a
 * phone while passing in Node, where the tests run. Field test, 28 Sep 2026:
 * every cloud-only document on the iPhone failed to open or back up for this
 * reason. FileReader.readAsArrayBuffer works on React Native, and it is the
 * same fallback Expo's own blob helper uses.
 */
export type BlobByteReader = {
  readAsArrayBuffer: (blob: Blob) => void;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  result: unknown;
  error: unknown;
};

export async function blobToBytes(
  blob: Blob,
  createReader: () => BlobByteReader = () => new FileReader() as unknown as BlobByteReader,
): Promise<Uint8Array> {
  if (typeof (blob as { arrayBuffer?: unknown }).arrayBuffer === 'function') {
    return new Uint8Array(await blob.arrayBuffer());
  }
  return new Promise((resolve, reject) => {
    const reader = createReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(new Uint8Array(reader.result));
      } else {
        reject(new Error('The downloaded file could not be read as bytes.'));
      }
    };
    reader.onerror = () => {
      const message = (reader.error as { message?: unknown } | null)?.message;
      reject(reader.error instanceof Error
        ? reader.error
        : new Error(typeof message === 'string' && message
          ? message
          : 'The downloaded file could not be read.'));
    };
    reader.readAsArrayBuffer(blob);
  });
}
