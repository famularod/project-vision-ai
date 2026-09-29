import { Directory, File, Paths } from 'expo-file-system';
import { blobToBytes } from './BlobBytes';
import { sha256Hex } from './ExpoSha256';
import { downloadPhoto } from './SupabaseService';
import {
  restoreVerifiedReferenceDocumentBytes,
  type ReferenceDocumentByteRestoreInput,
  type ReferenceDocumentByteRestoreResult,
} from './ReferenceDocumentByteRestore';

const RESTORED_REFERENCE_DOCUMENTS_FOLDER = 'restored-reference-documents';

/**
 * Expo/Supabase adapter for the pure verified-byte restore contract.
 * This API is intentionally not invoked automatically; the live hydration
 * path must explicitly opt in after it detects a missing app-owned file.
 */
export function restoreReferenceDocumentBytesFromCloud(
  input: ReferenceDocumentByteRestoreInput,
): Promise<ReferenceDocumentByteRestoreResult> {
  return restoreVerifiedReferenceDocumentBytes(input, {
    downloadBytes: async (bucket, storagePath) => {
      const result = await downloadPhoto({ bucket, path: storagePath });
      if (!result.ok || !result.data) {
        throw new Error(
          result.error || result.message || 'Protected document download failed.',
        );
      }
      return blobToBytes(result.data);
    },
    createOwnedDestination: async (documentId, originalFileName) => {
      const root = new Directory(Paths.document, RESTORED_REFERENCE_DOCUMENTS_FOLDER);
      root.create({ intermediates: true, idempotent: true });
      const documentDirectory = new Directory(root, safeSegment(documentId));
      documentDirectory.create({ intermediates: true, idempotent: true });
      return new File(documentDirectory, safeFileName(originalFileName)).uri;
    },
    writeBytes: async (uri, bytes) => {
      const file = new File(uri);
      file.create({ intermediates: true, overwrite: true });
      file.write(bytes);
    },
    readBytes: uri => new File(uri).bytes(),
    deleteFile: async uri => {
      const file = new File(uri);
      if (file.exists) file.delete();
    },
    sha256: sha256Hex,
  });
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-');
}

function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-') || 'reference-document';
}
