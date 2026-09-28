import * as FileSystem from 'expo-file-system/legacy';
import { fromByteArray, toByteArray } from 'base64-js';
import type { BackupFileIO } from './DeviceBackupWorkflow';

/** The device file system behind the backup workflow. */
export const expoBackupFileIO: BackupFileIO = Object.freeze({
  async sizeOf(uri: string) {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) return null;
    // The parts service refuses a size that is not a whole, non-negative
    // number, so an unmeasurable file fails the backup rather than being
    // guessed at.
    return 'size' in info ? info.size : Number.NaN;
  },
  async readBytes(uri: string) {
    return toByteArray(await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    }));
  },
  readText: (uri: string) => FileSystem.readAsStringAsync(uri),
  writeText: (uri: string, text: string) => FileSystem.writeAsStringAsync(uri, text),
  writeBytes: (uri: string, bytes: Uint8Array) => FileSystem.writeAsStringAsync(uri, fromByteArray(bytes), {
    encoding: FileSystem.EncodingType.Base64,
  }),
  move: (from: string, to: string) => FileSystem.moveAsync({ from, to }),
  remove: (uri: string) => FileSystem.deleteAsync(uri, { idempotent: true }),
  makeDirectory: (uri: string) => FileSystem.makeDirectoryAsync(uri, { intermediates: true }),
});
