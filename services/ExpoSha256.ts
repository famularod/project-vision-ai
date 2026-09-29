import * as Crypto from 'expo-crypto';

/**
 * SHA-256 of bytes as lowercase hex, through expo-crypto.
 *
 * The native digest accepts only a TypedArray. Passing an ArrayBuffer throws
 * "NotTypedArrayException" on the phone while working in Node. Field test,
 * 28 Sep 2026 (Build 212): every downloaded cloud document failed its
 * integrity check this way. A view into a larger buffer is copied, so the
 * digest always gets a plain, zero-offset Uint8Array.
 */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // A whole-buffer view is passed as is; copying a 170 MB envelope costs time
  // and memory for nothing.
  const digestInput = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes as Uint8Array<ArrayBuffer>
    : bytes.slice();
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, digestInput);
  return [...new Uint8Array(digest)]
    .map(value => value.toString(16).padStart(2, '0'))
    .join('');
}
