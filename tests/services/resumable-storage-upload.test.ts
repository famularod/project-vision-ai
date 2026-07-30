const mockResume = jest.fn();
const mockStart = jest.fn();
const mockFindPreviousUploads = jest.fn();
const mockUploadInstances: Array<{ options: Record<string, any> }> = [];

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getAllKeys: jest.fn(async () => []),
    multiGet: jest.fn(async () => []),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

jest.mock('expo-file-system', () => ({
  File: class {
    exists = true;
    size = 12;
    open() {
      return {
        size: 12,
        offset: 0,
        readBytes(length: number) {
          return new Uint8Array(length);
        },
        close: jest.fn(),
      };
    }
  },
}));

jest.mock('tus-js-client', () => ({
  Upload: class {
    url = 'https://example.supabase.co/storage/v1/upload/resumable/1';
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

import {
  TUS_UPLOAD_CHUNK_BYTES,
  uploadFileResumably,
} from '../../services/ResumableStorageUpload';

beforeEach(() => {
  jest.clearAllMocks();
  mockUploadInstances.length = 0;
  mockFindPreviousUploads.mockResolvedValue([]);
});

describe('resumable project-document upload', () => {
  it('uses Supabase-required 6 MiB chunks and reports progress', async () => {
    const onProgress = jest.fn();

    await expect(uploadFileResumably({
      projectUrl: 'https://example.supabase.co/',
      accessToken: 'access-token',
      bucket: 'project-documents',
      path: 'mobile/document/drawing.pdf',
      uri: 'file:///drawing.pdf',
      sizeBytes: 12,
      contentType: 'application/pdf',
      cacheControl: '3600',
      upsert: true,
      onProgress,
    })).resolves.toMatchObject({
      path: 'mobile/document/drawing.pdf',
    });

    const options = mockUploadInstances[0]?.options;
    expect(TUS_UPLOAD_CHUNK_BYTES).toBe(6 * 1024 * 1024);
    expect(options.chunkSize).toBe(TUS_UPLOAD_CHUNK_BYTES);
    expect(options.endpoint).toBe(
      'https://example.supabase.co/storage/v1/upload/resumable',
    );
    expect(options.headers).toMatchObject({
      authorization: 'Bearer access-token',
      'x-upsert': 'true',
    });
    expect(options.metadata).toMatchObject({
      bucketName: 'project-documents',
      objectName: 'mobile/document/drawing.pdf',
    });
    expect(onProgress).toHaveBeenCalledWith(0.5);
    expect(onProgress).toHaveBeenLastCalledWith(1);
  });

  it('resumes the newest matching incomplete upload', async () => {
    const older = {
      size: 12,
      metadata: {},
      creationTime: '2026-07-27T10:00:00.000Z',
      urlStorageKey: 'older',
      uploadUrl: 'https://example.supabase.co/older',
      parallelUploadUrls: null,
    };
    const newer = {
      ...older,
      creationTime: '2026-07-28T10:00:00.000Z',
      urlStorageKey: 'newer',
      uploadUrl: 'https://example.supabase.co/newer',
    };
    mockFindPreviousUploads.mockResolvedValue([older, newer]);

    await uploadFileResumably({
      projectUrl: 'https://example.supabase.co',
      accessToken: 'access-token',
      bucket: 'project-documents',
      path: 'mobile/document/drawing.pdf',
      uri: 'file:///drawing.pdf',
      sizeBytes: 12,
      contentType: 'application/pdf',
      cacheControl: '3600',
      upsert: true,
    });

    expect(mockResume).toHaveBeenCalledWith(newer);
    expect(mockStart).toHaveBeenCalledTimes(1);
  });
});
