import { Upload } from 'tus-js-client';
import { TUS_UPLOAD_CHUNK_BYTES } from './StorageUploadPolicy';

export async function uploadWebFileResumably(input: Readonly<{
  projectUrl: string;
  accessToken: string;
  bucket: string;
  path: string;
  file: Blob;
  contentSha256: string;
  contentType: string;
  cacheControl?: string;
  upsert?: boolean;
  onProgress?: (fraction: number) => void;
}>): Promise<void> {
  const endpoint = `${input.projectUrl.replace(/\/+$/, '')}/storage/v1/upload/resumable`;
  const contentSha256 = input.contentSha256.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(contentSha256)) {
    throw new Error(
      'A verified SHA-256 content identity is required before resuming this upload.',
    );
  }
  const fingerprint = [
    'vitruvius-web-document',
    input.bucket,
    input.path,
    input.file.size,
    contentSha256,
  ].join(':');

  return new Promise((resolve, reject) => {
    const upload = new Upload(input.file, {
      endpoint,
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
        cacheControl: input.cacheControl || '3600',
      },
      fingerprint: async () => fingerprint,
      removeFingerprintOnSuccess: true,
      onProgress(bytesSent, bytesTotal) {
        input.onProgress?.(
          bytesTotal > 0 ? Math.min(1, Math.max(0, bytesSent / bytesTotal)) : 0,
        );
      },
      onError: reject,
      onSuccess() {
        input.onProgress?.(1);
        resolve();
      },
    });

    upload.findPreviousUploads()
      .then(previousUploads => {
        const previous = previousUploads
          .filter(item => item.size === input.file.size && Boolean(item.uploadUrl))
          .sort((left, right) => right.creationTime.localeCompare(left.creationTime))[0];
        if (previous) upload.resumeFromPreviousUpload(previous);
        upload.start();
      })
      .catch(reject);
  });
}
