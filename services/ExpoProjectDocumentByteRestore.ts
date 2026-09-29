import { Directory, File } from 'expo-file-system';
import { blobToBytes } from './BlobBytes';
import { sha256Hex } from './ExpoSha256';
import { downloadPhoto } from './SupabaseService';
import {
  restoreVerifiedReferenceDocumentBytes,
  type ReferenceDocumentByteRestoreResult,
} from './ReferenceDocumentByteRestore';
import type { OwnedLocalFileManifestRecord } from './OwnedLocalFileRepository';

const PROJECT_DOCUMENT_BUCKET = 'project-documents';

/**
 * Restores a cloud project attachment into the exact app-owned manifest path.
 * The caller must supply a previously validated manifest record.
 */
export function restoreProjectDocumentBytesFromCloud({
  storagePath,
  ownedRoot,
  record,
}: Readonly<{
  storagePath: string;
  ownedRoot: string;
  record: OwnedLocalFileManifestRecord;
}>): Promise<ReferenceDocumentByteRestoreResult> {
  return restoreVerifiedReferenceDocumentBytes({
    documentId: record.fileId,
    storagePath,
    originalFileName: record.generatedBasename,
    expectedSizeBytes: record.sizeBytes,
    expectedSha256: record.sha256,
    bucket: PROJECT_DOCUMENT_BUCKET,
  }, {
    downloadBytes: async (bucket, path) => {
      const result = await downloadPhoto({ bucket, path });
      if (!result.ok || !result.data) {
        throw new Error(
          result.error || result.message || 'Protected document download failed.',
        );
      }
      return blobToBytes(result.data);
    },
    createOwnedDestination: async () => {
      const root = new Directory(ownedRoot);
      root.create({ intermediates: true, idempotent: true });
      return new File(root, record.generatedBasename).uri;
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
