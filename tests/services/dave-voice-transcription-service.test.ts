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

const mockReadSavedSignIn = jest.fn(async (): Promise<unknown> => null);
jest.mock('../../services/SupabaseService', () => ({
  getSupabaseClient: () => ({ functions: { invoke: mockInvoke } }),
  getCurrentSessionAccessToken: jest.fn(async () => ({
    ok: true,
    data: { status: 'token_present', accessToken: 'session-token' },
  })),
  // The sign-in saved on this phone (A11 pass 4 L1); auth-js removes it when
  // the server refuses a refresh.
  readSavedSignIn: () => mockReadSavedSignIn(),
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

  it('retries a transient native connection loss once with the identical recording and context', async () => {
    mockUploadAsync.mockRejectedValueOnce(new Error('Domain=NSURLErrorDomain Code=-1005 "lost connection"'));
    await transcribe({ uri: 'file:///recording.m4a', projectId, projectName: '2375 Compliance Project', candidateLocations: ['Canopy A'], purpose: 'question' });
    expect(mockUploadAsync).toHaveBeenCalledTimes(2);
    expect(mockUploadAsync.mock.calls[1]).toEqual(mockUploadAsync.mock.calls[0]);
    expect(mockParseResponse).toHaveBeenCalledTimes(1);
  });

  it('bounds transient retries and reports only an allowlisted diagnostic, not native private details', async () => {
    mockUploadAsync.mockRejectedValue(new Error('Domain=NSURLErrorDomain Code=-1001 https://private.example/?token=secret file:///private/recording.m4a'));
    await expect(transcribe({ uri: 'file:///recording.m4a', projectId, projectName: '2375 Compliance Project', candidateLocations: [] }))
      .rejects.toThrow('VOICE-TIMEOUT');
    expect(mockUploadAsync).toHaveBeenCalledTimes(2);
    expect(mockParseResponse).not.toHaveBeenCalled();
  });

  it.each([
    [-1009, 'VOICE-OFFLINE'], [-999, 'VOICE-CANCELLED'], [-1202, 'VOICE-SECURITY'],
  ])('does not automatically retry native error %s', async (code, diagnostic) => {
    mockUploadAsync.mockRejectedValue(new Error(`Domain=NSURLErrorDomain Code=${code} private-url-and-token`));
    try {
      await transcribe({ uri: 'file:///recording.m4a', projectId, projectName: '2375 Compliance Project', candidateLocations: [] });
      throw new Error('Expected failure');
    } catch (error) {
      expect((error as Error).message).toContain(diagnostic);
      expect((error as Error).message).not.toContain('private-url-and-token');
    }
    expect(mockUploadAsync).toHaveBeenCalledTimes(1);
  });

  it('does not mislabel unknown local upload errors as an internet outage', async () => {
    mockUploadAsync.mockRejectedValue(new Error('file:///private/recording.m4a could not be read'));
    await expect(transcribe({ uri: 'file:///recording.m4a', projectId, projectName: '2375 Compliance Project', candidateLocations: [] }))
      .rejects.toThrow('VOICE-UPLOAD');
    expect(mockUploadAsync).toHaveBeenCalledTimes(1);
  });

  it('does not start the retry after the sheet is closed or its project changes', async () => {
    let current = true;
    mockUploadAsync.mockImplementationOnce(async () => {
      current = false;
      throw new Error('Domain=NSURLErrorDomain Code=-1005');
    });
    await expect(transcribe({ uri: 'file:///recording.m4a', projectId, projectName: '2375 Compliance Project', candidateLocations: [], isRequestCurrent: () => current }))
      .rejects.toThrow('VOICE-CANCELLED');
    expect(mockUploadAsync).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403, 409, 429, 502, 503])('does not automatically retry a completed HTTP %s response', async status => {
    mockUploadAsync.mockResolvedValue({ status, body: '{}', headers: {} });
    await expect(transcribe({ uri: 'file:///recording.m4a', projectId, projectName: '2375 Compliance Project', candidateLocations: [] })).rejects.toThrow();
    expect(mockUploadAsync).toHaveBeenCalledTimes(1);
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
    // Audit A11 pass 3: this said "This project is still loading. Close and
    // reopen Talk", which never ended for a project not yet uploaded.
    await expect(transcribe({
      uri: 'file:///recording.m4a',
      projectId: 'project-2321-compliance-project',
      projectName: '2321 Compliance Project',
      candidateLocations: [],
    })).rejects.toThrow("2321 Compliance Project hasn't reached the cloud yet");
    await expect(transcribe({
      uri: 'file:///recording.m4a',
      projectId: null,
      projectName: '2321 Compliance Project',
      candidateLocations: [],
    })).rejects.toThrow(/^(?!.*loading).*type it instead\.$/);
    await expect(transcribe({
      uri: 'file:///recording.m4a',
      projectId: null,
      projectName: ' ',
      candidateLocations: [],
    })).rejects.toThrow('Choose a project');
    expect(mockUploadAsync).not.toHaveBeenCalled();
  });
});

// Whole-app audit A11 pass 4 L1 (30 Sep 2026): opened "offline, sign-in
// pending" (owner answer Q13), the expired token made the token lookup fail
// and voice said "Sign in before transcribing a recorded memory." The
// recording is kept and works once signal returns.
describe('voice while the sign-in waits for signal (A11 pass 4 L1)', () => {
  const projectId = '607c7eed-5dea-4a5a-8b52-0f165c71c4b5';
  const session = () => jest.requireMock('../../services/SupabaseService').getCurrentSessionAccessToken as jest.Mock;
  const savedSignIn = { ownerId: 'owner-a', email: null, lastRefreshedAtMs: 0, expiresAtMs: 0 };
  const noToken = (missingReason: string) => ({ ok: true, data: { status: 'token_missing', missingReason } });
  let transcribe: typeof import('../../services/DAVEVoiceTranscriptionService').transcribeDAVECaptureMemoryAudio;
  const voice = (signInPending: boolean) => transcribe({
    uri: 'file:///recording.m4a', projectId, projectName: '2321 Compliance Project', candidateLocations: [],
    signInPending: () => signInPending,
  });
  async function failure(work: Promise<unknown>): Promise<Error> {
    try {
      await work;
    } catch (error) {
      return error as Error;
    }
    throw new Error('Expected failure');
  }

  beforeAll(() => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'publishable-key';
    ({ transcribeDAVECaptureMemoryAudio: transcribe } = require('../../services/DAVEVoiceTranscriptionService'));
  });
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetInfoAsync.mockResolvedValue({ exists: true, size: 4_096 });
    mockReadSavedSignIn.mockResolvedValue(savedSignIn);
  });

  it.each([
    ['offline, sign-in pending, lookup unsettled', true, 'unknown'],
    ['offline, sign-in pending, lookup still loading', true, 'auth_loading'],
    ['not yet marked pending, lookup still loading', false, 'auth_loading'],
    ['not yet marked pending, lookup unsettled', false, 'unknown'],
  ])('%s: says no signal and keeps the recording; nothing is uploaded', async (_label, pending, reason) => {
    session().mockResolvedValueOnce(noToken(reason));
    const { daveVoiceFailureMessage } = require('../../services/DAVEVoiceSignalWait');
    const error = await failure(voice(pending));
    expect(error.message).not.toMatch(/sign in/i);
    expect(daveVoiceFailureMessage(error, 'Use Note'))
      .toBe('No signal. Your recording is kept while Vitruvius stays open — tap Use Note when you have signal.');
    expect(mockUploadAsync).not.toHaveBeenCalled();
  });

  it('a sign-in the server refused (no saved sign-in left) still asks to sign in, never "no signal"', async () => {
    mockReadSavedSignIn.mockResolvedValue(null);
    session().mockResolvedValueOnce(noToken('unknown'));
    const refused = await failure(voice(true));
    expect(refused.message).toBe('Sign in before transcribing a recorded memory.');
    session().mockResolvedValueOnce(noToken('signed_out'));
    mockReadSavedSignIn.mockResolvedValue(savedSignIn);
    const signedOut = await failure(voice(true));
    expect(signedOut.message).toBe('Sign in before transcribing a recorded memory.');
    const { daveVoiceFailureMessage } = require('../../services/DAVEVoiceSignalWait');
    expect(daveVoiceFailureMessage(signedOut, 'Use Note')).toBe('Sign in before transcribing a recorded memory.');
    expect(mockUploadAsync).not.toHaveBeenCalled();
  });
});

