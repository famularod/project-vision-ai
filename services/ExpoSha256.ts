import * as Crypto from 'expo-crypto';

/**
 * SHA-256 of bytes as lowercase hex, through expo-crypto.
 *
 * The native digest accepts only a TypedArray. Passing an ArrayBuffer throws
 * "NotTypedArrayException" on the phone while working in Node. Field test,
 * 28 Sep 2026 (Build 212): every downloaded cloud document failed its
 * integrity check this way. The copy gives the digest a plain, zero-offset
 * Uint8Array whatever view it was handed.
 */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digestInput = new Uint8Array(bytes.byteLength);
  digestInput.set(bytes);
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, digestInput);
  return [...new Uint8Array(digest)]
    .map(value => value.toString(16).padStart(2, '0'))
    .join('');
}
