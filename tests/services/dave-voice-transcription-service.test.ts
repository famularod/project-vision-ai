const mockGetInfoAsync = jest.fn();
const mockUploadAsync = jest.fn();
const mockInvoke = jest.fn();
const mockParseResponse = jest.fn((value: unknown) => value);

jest.mock('expo-file-system/legacy', () => ({
  getInfoAsync: (...args: unknown[]) => mockGetInfoAsync(...args),
  uploadAsync: (...args: unknown[]) => mockUploadAsync(...args),
  FileSystemUploadType: { MULTIPART: 1 },
  FileSystemSessionType: { FOREGROUND: 1 },
}));

jest.mock('react-native', () => ({
  NativeModules: {},
  Platform: { OS: 'ios' },
  TurboModuleRegistry: { get: jest.fn(() => null) },
}));

jest.mock('../../services/SupabaseService', () => ({
  getSupabaseClient: () => ({ functions: { invoke: mockInvoke } }),
  getCurrentSessionAccessToken: jest.fn(async () => ({
    ok: true,
    data: { status: 'token_present', accessToken: 'session-token' },
  })),
}));

jest.mock('../../services/DAVEVoiceUnderstanding', () => ({
  parseDAVEVoiceUnderstandingResponse: (value: unknown) => mockParseResponse(value),
}));

describe('DAVE native voice transcription upload', () => {
  const projectId = '607c7eed-5dea-4a5a-8b52-0f165c71c4b5';
  const originalUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const originalAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  let transcribe: typeof import('../../services/DAVEVoiceTranscriptionService').transcribeDAVECaptureMemoryAudio;

  beforeAll(() => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'publishable-key';
    ({ transcribeDAVECaptureMemoryAudio: transcribe } = require('../../services/DAVEVoiceTranscriptionService'));
  });

  afterAll(() => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = originalUrl;
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = originalAnonKey;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetInfoAsync.mockResolvedValue({ exists: true, size: 4_096 });
    mockUploadAsync.mockResolvedValue({
      status: 200,
      body: JSON.stringify({ schemaVersion: 'dave-voice-understanding/1.0', transcript: 'Use test answer' }),
      headers: {},
      mimeType: 'application/json',
    });
  });

  it('uses the native multipart uploader with the signed-in session', async () => {
    await transcribe({
      uri: 'file:///recording.m4a',
      projectId,
      projectName: '2321 Compliance Project',
      candidateLocations: ['Roof'],
    });

    expect(mockUploadAsync).toHaveBeenCalledWith(
      'https://example.supabase.co/functions/v1/dave-transcribe-memory',
      'file:///recording.m4a',
      expect.objectContaining({
        uploadType: 1,
        fieldName: 'audio',
        mimeType: 'audio/mp4',
        headers: {
          apikey: 'publishable-key',
          Authorization: 'Bearer session-token',
        },
        parameters: expect.objectContaining({
          projectName: '2321 Compliance Project',
          projectId,
        }),
      }),
    );
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('rejects an empty recording before any upload', async () => {
    mockGetInfoAsync.mockResolvedValue({ exists: true, size: 0 });

    await expect(transcribe({
      uri: 'file:///empty.m4a',
      projectId,
      projectName: '2321 Compliance Project',
      candidateLocations: [],
    })).rejects.toThrow('No usable audio was recorded');
    expect(mockUploadAsync).not.toHaveBeenCalled();
  });

  it('turns an empty-audio response into a useful retry instruction', async () => {
    mockUploadAsync.mockResolvedValue({
      status: 400,
      body: JSON.stringify({ error: 'audio_file_empty' }),
      headers: {},
      mimeType: 'application/json',
    });

    await expect(transcribe({
      uri: 'file:///recording.m4a',
      projectId,
      projectName: '2321 Compliance Project',
      candidateLocations: [],
    })).rejects.toThrow('speak for at least one second');
  });

  it('rejects a fabricated or missing project identifier before upload', async () => {
    await expect(transcribe({
      uri: 'file:///recording.m4a',
      projectId: 'project-2321-compliance-project',
      projectName: '2321 Compliance Project',
      candidateLocations: [],
    })).rejects.toThrow('project is still loading');
    expect(mockUploadAsync).not.toHaveBeenCalled();
  });
});
