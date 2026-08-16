import { File as NodeFile } from 'node:buffer';
import {
  createGoogleDriveDownloadSession,
  disconnectGoogleDriveSession,
  downloadGoogleDriveBytes,
  fetchGoogleDriveMetadata,
  GoogleDriveDocumentError,
  isGoogleDriveLinkedSource,
} from '../../services/GoogleDriveWebProvider';

describe('Google Drive web document provider', () => {
  const originalFetch = global.fetch;
  const originalWindow = (global as any).window;
  const originalDocument = (global as any).document;
  const originalFile = (global as any).File;
  const originalClientId = process.env.EXPO_PUBLIC_GOOGLE_DRIVE_CLIENT_ID;
  const originalApiKey = process.env.EXPO_PUBLIC_GOOGLE_DRIVE_API_KEY;
  const originalAppId = process.env.EXPO_PUBLIC_GOOGLE_DRIVE_APP_ID;

  afterEach(() => {
    global.fetch = originalFetch;
    (global as any).window = originalWindow;
    (global as any).document = originalDocument;
    (global as any).File = originalFile;
    process.env.EXPO_PUBLIC_GOOGLE_DRIVE_CLIENT_ID = originalClientId;
    process.env.EXPO_PUBLIC_GOOGLE_DRIVE_API_KEY = originalApiKey;
    process.env.EXPO_PUBLIC_GOOGLE_DRIVE_APP_ID = originalAppId;
    jest.restoreAllMocks();
  });

  it('refreshes an expiring Drive token before each document in a long indexing session', async () => {
    const requestedTokens: string[] = [];
    const tokenClient: {
      callback: (response: Record<string, unknown>) => void;
      error_callback: (error: Record<string, unknown>) => void;
      requestAccessToken: jest.Mock<void, []>;
    } = {
      callback: (_response: Record<string, unknown>) => undefined,
      error_callback: (_error: Record<string, unknown>) => undefined,
      requestAccessToken: jest.fn(() => {
        const token = `drive-token-${requestedTokens.length + 1}`;
        requestedTokens.push(token);
        tokenClient.callback({ access_token: token, expires_in: 1 });
      }),
    };
    (global as any).window = {
      google: { accounts: { oauth2: { initTokenClient: () => tokenClient } } },
      gapi: { load: (_name: string, options: { callback: () => void }) => options.callback() },
    };
    (global as any).document = {};
    (global as any).File = NodeFile;
    process.env.EXPO_PUBLIC_GOOGLE_DRIVE_CLIENT_ID = 'client-id';
    process.env.EXPO_PUBLIC_GOOGLE_DRIVE_API_KEY = 'api-key';
    process.env.EXPO_PUBLIC_GOOGLE_DRIVE_APP_ID = 'app-id';

    const responseMetadata = (fileId: string) => ({
      id: fileId,
      name: `${fileId}.pdf`,
      mimeType: 'application/pdf',
      size: '4',
      modifiedTime: '2026-08-04T12:00:00.000Z',
      md5Checksum: `${fileId}-md5`,
      headRevisionId: `${fileId}-revision`,
      capabilities: { canDownload: true },
    });
    global.fetch = jest.fn(async (url: string | URL | Request) => {
      const requestUrl = String(url);
      const fileId = requestUrl.includes('drive-file-2') ? 'drive-file-2' : 'drive-file-1';
      return requestUrl.includes('alt=media')
        ? new Response(new Uint8Array([1, 2, 3, 4]), {
          status: 200,
          headers: { 'content-length': '4' },
        })
        : ({ ok: true, status: 200, json: async () => responseMetadata(fileId) });
    }) as jest.Mock;

    const session = await createGoogleDriveDownloadSession();
    const source = (fileId: string) => ({
      provider: 'google_drive' as const,
      fileId,
      name: `${fileId}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: 4,
      modifiedTime: null,
      revisionId: null,
      md5Checksum: null,
      resourceKey: null,
      webViewLink: null,
    });
    await session.download(source('drive-file-1'));
    await session.download(source('drive-file-2'));

    expect(requestedTokens).toEqual(['drive-token-1', 'drive-token-2', 'drive-token-3']);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('drive-file-1'),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer drive-token-2' }) }),
    );
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('drive-file-2'),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer drive-token-3' }) }),
    );
  });

  it('revokes the active Drive token and clears the browser session', async () => {
    const revoke = jest.fn((_token: string, callback: () => void) => callback());
    const tokenClient: {
      callback: (response: Record<string, unknown>) => void;
      error_callback: (error: Record<string, unknown>) => void;
      requestAccessToken: jest.Mock<void, []>;
    } = {
      callback: (_response: Record<string, unknown>) => undefined,
      error_callback: (_error: Record<string, unknown>) => undefined,
      requestAccessToken: jest.fn(() => {
        tokenClient.callback({ access_token: 'revocable-drive-token', expires_in: 3_600 });
      }),
    };
    (global as any).window = {
      google: {
        accounts: { oauth2: { initTokenClient: () => tokenClient, revoke } },
      },
      gapi: { load: (_name: string, options: { callback: () => void }) => options.callback() },
    };
    (global as any).document = {};
    process.env.EXPO_PUBLIC_GOOGLE_DRIVE_CLIENT_ID = 'client-id';
    process.env.EXPO_PUBLIC_GOOGLE_DRIVE_API_KEY = 'api-key';
    process.env.EXPO_PUBLIC_GOOGLE_DRIVE_APP_ID = 'app-id';

    await disconnectGoogleDriveSession();
    revoke.mockClear();
    await createGoogleDriveDownloadSession();
    const result = await disconnectGoogleDriveSession();

    expect(result.status).toBe('disconnected');
    expect(revoke).toHaveBeenCalledWith('revocable-drive-token', expect.any(Function));
    await expect(disconnectGoogleDriveSession()).resolves.toMatchObject({
      status: 'not_connected',
    });
  });

  it('verifies PDF metadata and download authority before returning a durable reference', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'drive-file-1',
        name: 'Architectural.pdf',
        mimeType: 'application/pdf',
        size: '4',
        modifiedTime: '2026-08-04T12:00:00.000Z',
        md5Checksum: 'drive-md5',
        headRevisionId: 'revision-4',
        resourceKey: 'resource-key',
        webViewLink: 'https://drive.google.com/file/d/drive-file-1/view',
        capabilities: { canDownload: true },
      }),
    })) as jest.Mock;

    const source = await fetchGoogleDriveMetadata('drive-file-1', 'short-lived-token');

    expect(source).toMatchObject({
      provider: 'google_drive',
      fileId: 'drive-file-1',
      sizeBytes: 4,
      revisionId: 'revision-4',
      resourceKey: 'resource-key',
    });
    expect(isGoogleDriveLinkedSource(source)).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/drive/v3/files/drive-file-1?'),
      expect.objectContaining({
        headers: { Authorization: 'Bearer short-lived-token' },
        signal: expect.anything(),
      }),
    );
  });

  it('downloads the selected bytes directly from Drive and includes the resource key', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
    global.fetch = jest.fn(async () => new Response(bytes, {
      status: 200,
      headers: { 'content-length': '4' },
    })) as jest.Mock;

    const downloaded = await downloadGoogleDriveBytes({
      provider: 'google_drive',
      fileId: 'drive-file-1',
      name: 'Architectural.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 4,
      modifiedTime: null,
      revisionId: null,
      md5Checksum: null,
      resourceKey: 'resource-key',
      webViewLink: null,
    }, 'short-lived-token');

    expect(downloaded.byteLength).toBe(4);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('alt=media'),
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Goog-Drive-Resource-Keys': 'drive-file-1/resource-key',
        }),
      }),
    );
  });

  it('reports moved or deleted Drive files without silently falling back', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 404 })) as jest.Mock;

    await expect(fetchGoogleDriveMetadata('missing-file', 'token')).rejects.toMatchObject<Partial<GoogleDriveDocumentError>>({
      code: 'not_found',
      message: expect.stringMatching(/moved, deleted, or is no longer shared/i),
    });
  });

  it('rejects files whose owner disabled downloading', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'protected-file',
        name: 'Protected.pdf',
        mimeType: 'application/pdf',
        size: '100',
        capabilities: { canDownload: false },
      }),
    })) as jest.Mock;

    await expect(fetchGoogleDriveMetadata('protected-file', 'token')).rejects.toMatchObject<Partial<GoogleDriveDocumentError>>({
      code: 'not_downloadable',
    });
  });
});
