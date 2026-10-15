import { Directory, File } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import type {
  OwnedLocalFileStoreDependencies,
  OwnedLocalFileStat,
} from './OwnedLocalFileStore';
import { hashExpoFileSha256 } from './FileSizePreflight';

/**
 * Native dependency adapter for Expo SDK 54. This intentionally uses the SDK
 * 54 File/Directory API from `expo-file-system`, not the legacy module.
 */
export function createExpoSdk54OwnedLocalFileStoreDependencies(): OwnedLocalFileStoreDependencies {
  return Object.freeze({
    generateOpaqueFileId: Crypto.randomUUID,

    async ensureDirectory(directoryUri: string) {
      const directory = new Directory(directoryUri);
      if (!directory.exists) {
        directory.create({
          intermediates: true,
          idempotent: true,
        });
      }

      if (!directory.exists) {
        throw new Error('Expo could not create the app-owned directory.');
      }
    },

    async copyFile(sourceUri: string, destinationUri: string) {
      const source = new File(sourceUri);
      if (!source.exists) {
        throw new Error('Expo source file does not exist.');
      }

      // Open item 5.26 (older): since Expo SDK 56 copy() returns a promise and copies off the JS thread (copySync()
      // is the old call). Not waited for, the check that follows looked before the copy was there and refused every
      // document added on the phone and iPad: "The manifest-owned file is missing from local storage."
      await source.copy(new File(destinationUri));
    },

    async readBytes(fileUri: string) {
      const file = new File(fileUri);
      if (!file.exists) {
        throw new Error('Expo file does not exist.');
      }

      return file.bytes();
    },

    async hashFile(fileUri: string, maxBytes?: number) {
      return hashExpoFileSha256({
        uri: fileUri,
        ...(maxBytes !== undefined ? { maxBytes } : {}),
      });
    },

    async statFile(fileUri: string): Promise<OwnedLocalFileStat> {
      const file = new File(fileUri);
      return {
        exists: file.exists,
        sizeBytes: file.exists ? file.size : null,
      };
    },

    async deleteFile(fileUri: string) {
      const file = new File(fileUri);
      if (!file.exists) {
        throw new Error('Expo file does not exist.');
      }

      file.delete();
    },

    async sha256(bytes: Uint8Array) {
      const digest = await Crypto.digest(
        Crypto.CryptoDigestAlgorithm.SHA256,
        bytes as Uint8Array<ArrayBuffer>,
      );

      return Array.from(new Uint8Array(digest))
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('');
    },
  });
}
