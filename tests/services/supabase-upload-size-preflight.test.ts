const mockPrepareUploadPayload = jest.fn();
const mockPreflightUpload = jest.fn();
const mockResumableUpload = jest.fn();
const mockStorageUpload = jest.fn();

const mockSupabaseClient = {
  auth: {
    getSession: jest.fn(async () => ({
      data: { session: { access_token: 'session-token' } },
      error: null,
    })),
    onAuthStateChange: jest.fn(),
    startAutoRefresh: jest.fn(),
    stopAutoRefresh: jest.fn(),
  },
  storage: {
    from: jest.fn(() => ({ upload: mockStorageUpload })),
  },
};

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => mockSupabaseClient),
}));

jest.mock('react-native-url-polyfill/auto', () => ({}));

jest.mock('expo-file-system/legacy', () => ({
  getInfoAsync: jest.fn(),
  readAsStringAsync: jest.fn(),
  EncodingType: { Base64: 'base64' },
}));

jest.mock('react-native', () => {
  return {
    AppState: {
      currentState: 'active',
      addEventListener: jest.fn(),
    },
    NativeModules: {},
    Platform: {
      OS: 'ios',
      select: (values: Record<string, unknown>) =>
        values.ios ?? values.native ?? values.default,
    },
    TurboModuleRegistry: { get: jest.fn(() => null) },
  };
});

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

jest.mock('../../services/SupabaseAuthStorage', () => ({
  isAuthStorageSecure: jest.fn(async () => true),
  supabaseSecureAuthStorage: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

jest.mock('../../services/FileSizePreflight', () => {
  const actual = jest.requireActual('../../services/FileSizePreflight');
  return {
    ...actual,
    preflightExpoFileRead: (...args: unknown[]) =>
      mockPreflightUpload(...args),
    prepareExpoFileUploadPayload: (...args: unknown[]) =>
      mockPrepareUploadPayload(...args),
  };
});

jest.mock('../../services/ResumableStorageUpload', () => ({
  RESUMABLE_UPLOAD_THRESHOLD_BYTES: 6 * 1024 * 1024,
  uploadFileResumably: (...args: unknown[]) => mockResumableUpload(...args),
}));

describe('Supabase upload file-size boundary', () => {
  const originalUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const originalAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  let uploadPhoto: typeof import('../../services/SupabaseService').uploadPhoto;
  let FileSizePreflightError: typeof import('../../services/FileSizePreflight').FileSizePreflightError;

  beforeAll(() => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
    ({ uploadPhoto } = require('../../services/SupabaseService'));
    ({ FileSizePreflightError } = jest.requireActual('../../services/FileSizePreflight'));
  });

  afterAll(() => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = originalUrl;
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = originalAnonKey;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockStorageUpload.mockResolvedValue({
      data: { path: 'owner/file.pdf', fullPath: 'bucket/owner/file.pdf' },
      error: null,
    });
    mockPreflightUpload.mockResolvedValue({
      uri: 'file:///app/cache/file.pdf',
      sizeBytes: 3,
      maxBytes: 15 * 1024 * 1024,
    });
    mockResumableUpload.mockResolvedValue({
      path: 'owner/drawing.pdf',
      uploadUrl: 'https://example.supabase.co/resumable/1',
    });
  });

  it('returns a retryable 413 result without calling storage for an oversized file', async () => {
    mockPreflightUpload.mockRejectedValue(new FileSizePreflightError({
      code: 'file_too_large',
      message: 'This file is larger than 15 MB. Compress, optimize, or split it, then retry.',
      maxBytes: 15 * 1024 * 1024,
      observedSizeBytes: 15 * 1024 * 1024 + 1,
    }));

    const result = await uploadPhoto({
      uri: 'file:///app/cache/large.pdf',
      path: 'owner/large.pdf',
    });

    expect(result).toMatchObject({
      ok: false,
      configured: true,
      status: 413,
      code: 'file_too_large',
    });
    expect(mockStorageUpload).not.toHaveBeenCalled();
    expect(mockResumableUpload).not.toHaveBeenCalled();
  });

  it('uploads only the bounded ArrayBuffer returned by verified preparation', async () => {
    const data = new Uint8Array([1, 2, 3]).buffer;
    mockPrepareUploadPayload.mockResolvedValue({ data, sizeBytes: 3 });

    await expect(uploadPhoto({
      uri: 'file:///app/cache/file.pdf',
      path: 'owner/file.pdf',
      contentType: 'application/pdf',
    })).resolves.toMatchObject({ ok: true });

    expect(mockPrepareUploadPayload).toHaveBeenCalledWith({
      uri: 'file:///app/cache/file.pdf',
      reportedSizeBytes: 3,
    });
    expect(mockStorageUpload).toHaveBeenCalledWith(
      'owner/file.pdf',
      data,
      expect.objectContaining({ contentType: 'application/pdf' }),
    );
  });

  it('routes a large project document to the resumable uploader', async () => {
    mockPreflightUpload.mockResolvedValue({
      uri: 'file:///app/documents/drawing.pdf',
      sizeBytes: 20 * 1024 * 1024,
      maxBytes: 50 * 1024 * 1024,
    });

    await uploadPhoto({
      uri: 'file:///app/documents/drawing.pdf',
      path: 'owner/drawing.pdf',
      reportedSizeBytes: 20 * 1024 * 1024,
      maxBytes: 50 * 1024 * 1024,
    });

    expect(mockResumableUpload).toHaveBeenCalledWith(expect.objectContaining({
      bucket: 'project-photos',
      path: 'owner/drawing.pdf',
      uri: 'file:///app/documents/drawing.pdf',
      sizeBytes: 20 * 1024 * 1024,
      accessToken: 'session-token',
    }));
    expect(mockPrepareUploadPayload).not.toHaveBeenCalled();
    expect(mockStorageUpload).not.toHaveBeenCalled();
  });
});
