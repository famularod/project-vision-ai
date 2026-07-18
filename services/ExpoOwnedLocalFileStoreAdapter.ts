import { Directory, File } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import type {
  OwnedLocalFileStoreDependencies,
  OwnedLocalFileStat,
} from './OwnedLocalFileStore';

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

      source.copy(new File(destinationUri));
    },

    async readBytes(fileUri: string) {
      const file = new File(fileUri);
      if (!file.exists) {
        throw new Error('Expo file does not exist.');
      }

      return file.bytes();
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
