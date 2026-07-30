const mockGetInfoAsync = jest.fn();
const mockReadAsStringAsync = jest.fn();

jest.mock('expo-file-system/legacy', () => ({
  getInfoAsync: (...args: unknown[]) => mockGetInfoAsync(...args),
  readAsStringAsync: (...args: unknown[]) => mockReadAsStringAsync(...args),
  EncodingType: { Base64: 'base64' },
}));

import {
  FileSizePreflightError,
  MAX_PROJECT_DOCUMENT_FILE_BYTES,
  MAX_SAFE_LOCAL_FILE_BYTES,
  prepareExpoFileUploadPayload,
  preflightLocalFileRead,
} from '../../services/FileSizePreflight';

const URI = 'file:///app/cache/selected-document.pdf';

function statWith(sizeBytes: number | null, exists = true) {
  return jest.fn(async () => ({ exists, sizeBytes }));
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('whole-file size preflight', () => {
  it('supports project documents up to 100 MiB', () => {
    expect(MAX_PROJECT_DOCUMENT_FILE_BYTES).toBe(50 * 1024 * 1024);
  });

  it('accepts a verified file exactly at the hard limit', async () => {
    await expect(preflightLocalFileRead({
      uri: URI,
      statFile: statWith(MAX_SAFE_LOCAL_FILE_BYTES),
    })).resolves.toEqual({
      uri: URI,
      sizeBytes: MAX_SAFE_LOCAL_FILE_BYTES,
      maxBytes: MAX_SAFE_LOCAL_FILE_BYTES,
    });
  });

  it('rejects one byte over the hard limit', async () => {
    const statFile = statWith(MAX_SAFE_LOCAL_FILE_BYTES + 1);

    await expect(preflightLocalFileRead({ uri: URI, statFile })).rejects.toMatchObject({
      code: 'file_too_large',
      recoveryState: 'retry_or_reselect',
      observedSizeBytes: MAX_SAFE_LOCAL_FILE_BYTES + 1,
    });
  });

  it('re-stats and accepts a file when picker size metadata is missing', async () => {
    const statFile = statWith(4_096);

    await expect(preflightLocalFileRead({
      uri: URI,
      reportedSizeBytes: undefined,
      statFile,
    })).resolves.toMatchObject({ sizeBytes: 4_096 });
    expect(statFile).toHaveBeenCalledWith(URI);
  });

  it('fails closed when the filesystem cannot verify a size', async () => {
    const result = preflightLocalFileRead({
      uri: URI,
      reportedSizeBytes: 4_096,
      statFile: statWith(null),
    });

    await expect(result).rejects.toBeInstanceOf(FileSizePreflightError);
    await expect(result).rejects.toMatchObject({
      code: 'file_size_unavailable',
      recoveryState: 'retry_or_reselect',
    });
  });

  it('rejects changed picker metadata rather than reading an uncertain file', async () => {
    await expect(preflightLocalFileRead({
      uri: URI,
      reportedSizeBytes: 4_096,
      statFile: statWith(4_097),
    })).rejects.toMatchObject({ code: 'file_changed' });
  });
});

describe('bounded Expo upload payload preparation', () => {
  it('does not base64-read an oversized file', async () => {
    mockGetInfoAsync.mockResolvedValue({
      exists: true,
      size: MAX_SAFE_LOCAL_FILE_BYTES + 1,
    });

    await expect(prepareExpoFileUploadPayload({ uri: URI })).rejects.toMatchObject({
      code: 'file_too_large',
    });
    expect(mockReadAsStringAsync).not.toHaveBeenCalled();
  });

  it('does not base64-read a file whose size is unavailable', async () => {
    mockGetInfoAsync.mockResolvedValue({ exists: true });

    await expect(prepareExpoFileUploadPayload({ uri: URI })).rejects.toMatchObject({
      code: 'file_size_unavailable',
    });
    expect(mockReadAsStringAsync).not.toHaveBeenCalled();
  });

  it.each([
    { base64: 'AQ==', expected: [1] },
    { base64: 'AQI=', expected: [1, 2] },
    { base64: 'AQID', expected: [1, 2, 3] },
  ])('decodes a verified canonical payload into a pre-sized ArrayBuffer', async ({
    base64,
    expected,
  }) => {
    mockGetInfoAsync.mockResolvedValue({ exists: true, size: expected.length });
    mockReadAsStringAsync.mockResolvedValue(base64);

    const result = await prepareExpoFileUploadPayload({ uri: URI });

    expect(result.sizeBytes).toBe(expected.length);
    expect([...new Uint8Array(result.data)]).toEqual(expected);
    expect(mockReadAsStringAsync).toHaveBeenCalledWith(URI, { encoding: 'base64' });
  });

  it('rejects a changed encoded length before decoding an ArrayBuffer', async () => {
    mockGetInfoAsync.mockResolvedValue({ exists: true, size: 3 });
    mockReadAsStringAsync.mockResolvedValue('AQIDBA==');

    await expect(prepareExpoFileUploadPayload({ uri: URI })).rejects.toMatchObject({
      code: 'file_changed',
    });
  });
});
