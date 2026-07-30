const mockResume = jest.fn();
const mockStart = jest.fn();
const mockFindPreviousUploads = jest.fn();
const mockUploadInstances: Array<{ options: Record<string, any> }> = [];

jest.mock('tus-js-client', () => ({
  Upload: class {
    options: Record<string, any>;
    constructor(_file: unknown, options: Record<string, any>) {
      this.options = options;
      mockUploadInstances.push(this);
    }
    findPreviousUploads = mockFindPreviousUploads;
    resumeFromPreviousUpload = mockResume;
    start() {
      mockStart();
      this.options.onProgress(6, 12);
      this.options.onSuccess();
    }
  },
}));

import { uploadWebFileResumably } from '../../services/ResumableWebStorageUpload';
import { TUS_UPLOAD_CHUNK_BYTES } from '../../services/StorageUploadPolicy';

const CONTENT_SHA256 = 'a'.repeat(64);

beforeEach(() => {
  jest.clearAllMocks();
  mockUploadInstances.length = 0;
  mockFindPreviousUploads.mockResolvedValue([]);
});

describe('resumable desktop project-document upload', () => {
  it('uploads a browser file to Supabase in required 6 MiB chunks', async () => {
    const onProgress = jest.fn();
    const file = new Blob([new Uint8Array(12)], { type: 'application/pdf' });

    await expect(uploadWebFileResumably({
      projectUrl: 'https://example.supabase.co/',
      accessToken: 'access-token',
      bucket: 'project-documents',
      path: 'owner/web/document/drawing.pdf',
      file,
      contentSha256: CONTENT_SHA256,
      contentType: 'application/pdf',
      onProgress,
    })).resolves.toBeUndefined();

    const options = mockUploadInstances[0]?.options;
    expect(options.endpoint).toBe(
      'https://example.supabase.co/storage/v1/upload/resumable',
    );
    expect(options.chunkSize).toBe(TUS_UPLOAD_CHUNK_BYTES);
    expect(options.headers.authorization).toBe('Bearer access-token');
    expect(options.metadata).toMatchObject({
      bucketName: 'project-documents',
      objectName: 'owner/web/document/drawing.pdf',
      contentType: 'application/pdf',
    });
    await expect(options.fingerprint()).resolves.toContain(CONTENT_SHA256);
    expect(onProgress).toHaveBeenCalledWith(0.5);
    expect(onProgress).toHaveBeenLastCalledWith(1);
  });

  it('resumes the newest matching browser upload', async () => {
    const older = {
      size: 12,
      creationTime: '2026-07-27T10:00:00.000Z',
      uploadUrl: 'https://example.supabase.co/older',
    };
    const newer = {
      ...older,
      creationTime: '2026-07-28T10:00:00.000Z',
      uploadUrl: 'https://example.supabase.co/newer',
    };
    mockFindPreviousUploads.mockResolvedValue([older, newer]);

    await uploadWebFileResumably({
      projectUrl: 'https://example.supabase.co',
      accessToken: 'access-token',
      bucket: 'project-documents',
      path: 'owner/web/document/drawing.pdf',
      file: new Blob([new Uint8Array(12)]),
      contentSha256: CONTENT_SHA256,
      contentType: 'application/pdf',
    });

    expect(mockResume).toHaveBeenCalledWith(newer);
    expect(mockStart).toHaveBeenCalledTimes(1);
  });
});
