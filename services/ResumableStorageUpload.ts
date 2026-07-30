import AsyncStorage from '@react-native-async-storage/async-storage';
import { File } from 'expo-file-system';
import { Upload } from 'tus-js-client';
import {
  RESUMABLE_UPLOAD_THRESHOLD_BYTES,
  TUS_UPLOAD_CHUNK_BYTES,
} from './StorageUploadPolicy';

export {
  RESUMABLE_UPLOAD_THRESHOLD_BYTES,
  TUS_UPLOAD_CHUNK_BYTES,
};

type PreviousUpload = Readonly<{
  size: number | null;
  metadata: Record<string, string>;
  creationTime: string;
  urlStorageKey: string;
  uploadUrl: string | null;
  parallelUploadUrls: string[] | null;
}>;

type ResumableUploadInput = Readonly<{
  projectUrl: string;
  accessToken: string;
  bucket: string;
  path: string;
  uri: string;
  sizeBytes: number;
  contentSha256: string;
  contentType: string;
  cacheControl: string;
  upsert: boolean;
  onProgress?: (fraction: number) => void;
}>;

const URL_STORAGE_PREFIX = 'vitruvius:tus::';

class AsyncStorageTusUrlStorage {
  async findAllUploads(): Promise<PreviousUpload[]> {
    return this.findEntries(URL_STORAGE_PREFIX);
  }

  async findUploadsByFingerprint(fingerprint: string): Promise<PreviousUpload[]> {
    return this.findEntries(`${URL_STORAGE_PREFIX}${fingerprint}::`);
  }

  async removeUpload(urlStorageKey: string): Promise<void> {
    await AsyncStorage.removeItem(urlStorageKey);
  }

  async addUpload(
    fingerprint: string,
    upload: Omit<PreviousUpload, 'urlStorageKey'>,
  ): Promise<string> {
    const key = `${URL_STORAGE_PREFIX}${fingerprint}::${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    await AsyncStorage.setItem(key, JSON.stringify(upload));
    return key;
  }

  private async findEntries(prefix: string): Promise<PreviousUpload[]> {
    const keys = (await AsyncStorage.getAllKeys()).filter(key => key.startsWith(prefix));
    if (keys.length === 0) return [];
    const entries = await AsyncStorage.multiGet(keys);
    const uploads: PreviousUpload[] = [];

    for (const [key, serialized] of entries) {
      if (!serialized) continue;
      try {
        const parsed = JSON.parse(serialized) as Omit<PreviousUpload, 'urlStorageKey'>;
        uploads.push(Object.freeze({ ...parsed, urlStorageKey: key }));
      } catch {
        await AsyncStorage.removeItem(key);
      }
    }

    return uploads;
  }
}

class ExpoChunkedFileReader {
  async openFile(input: { uri: string; sizeBytes: number }) {
    const file = new File(input.uri);
    if (!file.exists || file.size !== input.sizeBytes) {
      throw new Error('The selected file changed before the resumable upload began.');
    }
    const handle = file.open();
    if (handle.size !== input.sizeBytes) {
      handle.close();
      throw new Error('The selected file changed before the resumable upload began.');
    }

    return {
      size: input.sizeBytes,
      async slice(start: number, end: number) {
        const length = Math.max(0, Math.min(end, input.sizeBytes) - start);
        handle.offset = start;
        const bytes = handle.readBytes(length);
        if (bytes.byteLength !== length) {
          throw new Error('The selected file changed during the resumable upload.');
        }
        return {
          value: bytes.buffer,
          done: start + bytes.byteLength >= input.sizeBytes,
        };
      },
      close() {
        handle.close();
      },
    };
  }
}

export async function uploadFileResumably(
  input: ResumableUploadInput,
): Promise<Readonly<{ path: string; uploadUrl: string | null }>> {
  const projectUrl = input.projectUrl.replace(/\/+$/, '');
  const fingerprint = resumableUploadFingerprint(input);
  const urlStorage = new AsyncStorageTusUrlStorage();
  const fileReader = new ExpoChunkedFileReader();

  return new Promise((resolve, reject) => {
    const upload = new Upload(
      { uri: input.uri, sizeBytes: input.sizeBytes } as never,
      {
        endpoint: `${projectUrl}/storage/v1/upload/resumable`,
        uploadSize: input.sizeBytes,
        chunkSize: TUS_UPLOAD_CHUNK_BYTES,
        retryDelays: [0, 3_000, 5_000, 10_000, 20_000],
        headers: {
          authorization: `Bearer ${input.accessToken}`,
          ...(input.upsert ? { 'x-upsert': 'true' } : {}),
        },
        metadata: {
          bucketName: input.bucket,
          objectName: input.path,
          contentType: input.contentType,
          cacheControl: input.cacheControl,
        },
        fingerprint: async () => fingerprint,
        fileReader,
        urlStorage,
        removeFingerprintOnSuccess: true,
        onProgress(bytesSent, bytesTotal) {
          input.onProgress?.(
            bytesTotal > 0 ? Math.min(1, Math.max(0, bytesSent / bytesTotal)) : 0,
          );
        },
        onError(error) {
          reject(error);
        },
        onSuccess() {
          input.onProgress?.(1);
          resolve(Object.freeze({
            path: input.path,
            uploadUrl: upload.url,
          }));
        },
      },
    );

    upload.findPreviousUploads()
      .then(previousUploads => {
        const previous = previousUploads
          .filter(item => item.size === input.sizeBytes && Boolean(item.uploadUrl))
          .sort((left, right) => right.creationTime.localeCompare(left.creationTime))[0];
        if (previous) upload.resumeFromPreviousUpload(previous);
        upload.start();
      })
      .catch(reject);
  });
}

export function resumableUploadFingerprint(
  input: Pick<
    ResumableUploadInput,
    'bucket' | 'path' | 'sizeBytes' | 'contentSha256'
  >,
) {
  const contentSha256 = input.contentSha256.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(contentSha256)) {
    throw new Error(
      'A verified SHA-256 content identity is required before resuming this upload.',
    );
  }
  return [
    'vitruvius-project-document',
    input.bucket,
    input.path,
    input.sizeBytes,
    contentSha256,
  ].join(':');
}
