const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const GOOGLE_DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const GOOGLE_API_SCRIPT = 'https://apis.google.com/js/api.js';
const GOOGLE_IDENTITY_SCRIPT = 'https://accounts.google.com/gsi/client';
const TOKEN_EXPIRY_SAFETY_MS = 60_000;

export const GOOGLE_DRIVE_LINK_MAX_BYTES = 250 * 1024 * 1024;

export type GoogleDriveLinkedSource = Readonly<{
  provider: 'google_drive';
  fileId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  modifiedTime: string | null;
  revisionId: string | null;
  md5Checksum: string | null;
  resourceKey: string | null;
  webViewLink: string | null;
}>;

export type GoogleDrivePickedDocument = Readonly<{
  source: GoogleDriveLinkedSource;
  file: File;
  bytes: ArrayBuffer;
}>;

export type GoogleDriveDownloadSession = Readonly<{
  download: (source: GoogleDriveLinkedSource) => Promise<GoogleDrivePickedDocument>;
}>;

export type GoogleDriveDisconnectResult = Readonly<{
  status: 'disconnected' | 'not_connected' | 'local_disconnect';
  message: string;
}>;

export type GoogleDriveWebConfiguration = Readonly<{
  configured: boolean;
  clientId: string;
  apiKey: string;
  appId: string;
  missing: readonly string[];
}>;

export class GoogleDriveDocumentError extends Error {
  constructor(
    public readonly code:
      | 'not_configured'
      | 'cancelled'
      | 'permission_denied'
      | 'not_found'
      | 'not_downloadable'
      | 'too_large'
      | 'unsupported'
      | 'network'
      | 'provider_error',
    message: string,
  ) {
    super(message);
    this.name = 'GoogleDriveDocumentError';
  }
}

type GoogleToken = Readonly<{ value: string; expiresAt: number }>;
type GoogleTokenClient = {
  callback: (response: Record<string, unknown>) => void;
  error_callback?: (error: Record<string, unknown>) => void;
  requestAccessToken: (options?: Readonly<{ prompt?: string }>) => void;
};

let accessToken: GoogleToken | null = null;
let tokenClient: GoogleTokenClient | null = null;
let scriptsReady: Promise<void> | null = null;

export function googleDriveSessionIsAuthorized() {
  return Boolean(accessToken && accessToken.expiresAt > Date.now() + TOKEN_EXPIRY_SAFETY_MS);
}

/**
 * Removes the short-lived Drive credential held by this browser tab and asks
 * Google to revoke it when the Identity Services revocation API is available.
 * Vitruvius never persists this credential.
 */
export async function disconnectGoogleDriveSession(): Promise<GoogleDriveDisconnectResult> {
  const token = accessToken?.value ?? null;
  accessToken = null;
  tokenClient = null;

  if (!token) {
    return Object.freeze({
      status: 'not_connected',
      message: 'No active Google Drive connection was stored in this browser tab.',
    });
  }

  const browser = typeof window === 'undefined' ? null : window as any;
  const revoke = browser?.google?.accounts?.oauth2?.revoke;
  if (typeof revoke !== 'function') {
    return Object.freeze({
      status: 'local_disconnect',
      message: 'Google Drive was disconnected from this browser tab. Google could not confirm remote revocation, so review connected apps in your Google account if needed.',
    });
  }

  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Google Drive revocation timed out.')),
        10_000,
      );
      try {
        revoke(token, () => {
          clearTimeout(timeout);
          resolve();
        });
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    });
    return Object.freeze({
      status: 'disconnected',
      message: 'Google Drive was disconnected from Vitruvius on this browser.',
    });
  } catch {
    return Object.freeze({
      status: 'local_disconnect',
      message: 'Google Drive was disconnected from this browser tab. Google could not confirm remote revocation, so review connected apps in your Google account if needed.',
    });
  }
}

export function googleDriveWebConfiguration(): GoogleDriveWebConfiguration {
  const clientId = process.env.EXPO_PUBLIC_GOOGLE_DRIVE_CLIENT_ID?.trim() ?? '';
  const apiKey = process.env.EXPO_PUBLIC_GOOGLE_DRIVE_API_KEY?.trim() ?? '';
  const appId = process.env.EXPO_PUBLIC_GOOGLE_DRIVE_APP_ID?.trim() ?? '';
  const missing = [
    clientId ? null : 'Drive sign-in configuration',
    apiKey ? null : 'Drive file-picker configuration',
    appId ? null : 'Drive application configuration',
  ].filter((value): value is string => Boolean(value));
  return Object.freeze({
    configured: missing.length === 0,
    clientId,
    apiKey,
    appId,
    missing: Object.freeze(missing),
  });
}

export function isGoogleDriveLinkedSource(value: unknown): value is GoogleDriveLinkedSource {
  const source = record(value);
  return source.provider === 'google_drive' &&
    nonEmptyString(source.fileId) &&
    nonEmptyString(source.name) &&
    nonEmptyString(source.mimeType) &&
    finitePositiveNumber(source.sizeBytes);
}

export async function pickGoogleDrivePdf(): Promise<GoogleDrivePickedDocument> {
  const configuration = googleDriveWebConfiguration();
  if (!configuration.configured) throw configurationError(configuration);
  await loadGoogleLibraries();
  const token = await requestGoogleDriveToken(configuration.clientId);
  const selected = await showGoogleDrivePicker(configuration, token);
  return downloadGoogleDriveFile(selected.fileId, token, selected.resourceKey);
}

export async function downloadLinkedGoogleDriveDocument(
  source: GoogleDriveLinkedSource,
): Promise<GoogleDrivePickedDocument> {
  const session = await createGoogleDriveDownloadSession();
  return session.download(source);
}

/**
 * Opens one short-lived Drive authorization session that can download several
 * previously selected files. The access token remains in memory only.
 */
export async function createGoogleDriveDownloadSession(): Promise<GoogleDriveDownloadSession> {
  const configuration = googleDriveWebConfiguration();
  if (!configuration.configured) throw configurationError(configuration);
  await loadGoogleLibraries();
  // Establish authorization while the user is interacting with Vitruvius,
  // then refresh it before every document. A fixed one-hour token could expire
  // during a long assured drawing-index batch and fail every later download.
  await requestGoogleDriveToken(configuration.clientId);
  return Object.freeze({
    download: async (source: GoogleDriveLinkedSource) => {
      if (!isGoogleDriveLinkedSource(source)) {
        throw new GoogleDriveDocumentError('provider_error', 'This Google Drive reference is incomplete. Select the file again.');
      }
      const token = await requestGoogleDriveToken(configuration.clientId);
      return downloadGoogleDriveFile(source.fileId, token, source.resourceKey);
    },
  });
}

export async function fetchGoogleDriveMetadata(
  fileId: string,
  token: string,
  resourceKey?: string | null,
): Promise<GoogleDriveLinkedSource> {
  const fields = [
    'id',
    'name',
    'mimeType',
    'size',
    'modifiedTime',
    'md5Checksum',
    'version',
    'headRevisionId',
    'resourceKey',
    'webViewLink',
    'capabilities(canDownload)',
  ].join(',');
  const query = new URLSearchParams({ fields, supportsAllDrives: 'true' });
  const response = await googleDriveFetch(
    `${GOOGLE_DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?${query.toString()}`,
    token,
    resourceKey ? `${fileId}/${resourceKey}` : null,
  );
  const metadata = record(await response.json());
  const capabilities = record(metadata.capabilities);
  if (capabilities.canDownload !== true) {
    throw new GoogleDriveDocumentError(
      'not_downloadable',
      'Google Drive does not allow this file to be downloaded. Ask the owner to enable downloading or choose another PDF.',
    );
  }
  const mimeType = stringValue(metadata.mimeType);
  if (mimeType !== 'application/pdf') {
    throw new GoogleDriveDocumentError('unsupported', 'Choose a PDF from Google Drive for ECOS indexing.');
  }
  const sizeBytes = positiveNumber(metadata.size);
  if (!sizeBytes) {
    throw new GoogleDriveDocumentError('provider_error', 'Google Drive did not report a usable file size. Choose the file again.');
  }
  if (sizeBytes > GOOGLE_DRIVE_LINK_MAX_BYTES) {
    throw new GoogleDriveDocumentError(
      'too_large',
      'This PDF is larger than 250 MB. Optimize or split it before linking so the browser can index it safely.',
    );
  }
  return Object.freeze({
    provider: 'google_drive',
    fileId: stringValue(metadata.id) || fileId,
    name: stringValue(metadata.name) || 'Google Drive document.pdf',
    mimeType,
    sizeBytes,
    modifiedTime: nullableString(metadata.modifiedTime),
    revisionId: scalarString(metadata.headRevisionId) || scalarString(metadata.version) || null,
    md5Checksum: nullableString(metadata.md5Checksum),
    resourceKey: nullableString(metadata.resourceKey) || resourceKey || null,
    webViewLink: nullableString(metadata.webViewLink) || `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`,
  });
}

export async function downloadGoogleDriveBytes(
  source: GoogleDriveLinkedSource,
  token: string,
): Promise<ArrayBuffer> {
  const query = new URLSearchParams({ alt: 'media', supportsAllDrives: 'true' });
  const response = await googleDriveFetch(
    `${GOOGLE_DRIVE_API_BASE}/files/${encodeURIComponent(source.fileId)}?${query.toString()}`,
    token,
    source.resourceKey ? `${source.fileId}/${source.resourceKey}` : null,
  );
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength <= 0) {
    throw new GoogleDriveDocumentError('provider_error', 'Google Drive returned an empty file. Choose the PDF again.');
  }
  if (bytes.byteLength !== source.sizeBytes) {
    throw new GoogleDriveDocumentError(
      'provider_error',
      'The Google Drive file changed while Vitruvius was indexing it. Select the latest revision again.',
    );
  }
  return bytes;
}

async function downloadGoogleDriveFile(
  fileId: string,
  token: string,
  resourceKey?: string | null,
): Promise<GoogleDrivePickedDocument> {
  const source = await fetchGoogleDriveMetadata(fileId, token, resourceKey);
  const bytes = await downloadGoogleDriveBytes(source, token);
  const verifiedSource = await fetchGoogleDriveMetadata(fileId, token, source.resourceKey);
  if (
    source.revisionId !== verifiedSource.revisionId ||
    source.modifiedTime !== verifiedSource.modifiedTime ||
    source.md5Checksum !== verifiedSource.md5Checksum
  ) {
    throw new GoogleDriveDocumentError(
      'provider_error',
      'The Google Drive file changed while Vitruvius was indexing it. Select the latest revision again.',
    );
  }
  return Object.freeze({
    source: verifiedSource,
    bytes,
    file: new File([bytes], verifiedSource.name, { type: verifiedSource.mimeType }),
  });
}

async function googleDriveFetch(
  url: string,
  token: string,
  resourceKeyHeader: string | null = null,
): Promise<Response> {
  let response: Response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180_000);
  try {
    response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(resourceKeyHeader ? { 'X-Goog-Drive-Resource-Keys': resourceKeyHeader } : {}),
      },
      signal: controller.signal,
    });
  } catch (error) {
    throw new GoogleDriveDocumentError(
      'network',
      error instanceof Error && error.name === 'AbortError'
        ? 'Google Drive took too long to respond. Check the connection and try again.'
        : 'Google Drive could not be reached. Check the connection and try again.',
    );
  } finally {
    clearTimeout(timeout);
  }
  if (response.ok) return response;
  if (response.status === 401) {
    accessToken = null;
    throw new GoogleDriveDocumentError('permission_denied', 'The Google Drive connection expired. Connect Drive again, then retry.');
  }
  if (response.status === 403) {
    throw new GoogleDriveDocumentError('permission_denied', 'Google Drive denied access to this file. Select it again or ask the owner to share it with you.');
  }
  if (response.status === 404) {
    throw new GoogleDriveDocumentError('not_found', 'The linked Google Drive file was moved, deleted, or is no longer shared with this account.');
  }
  throw new GoogleDriveDocumentError('provider_error', `Google Drive returned HTTP ${response.status}. Try again shortly.`);
}

async function loadGoogleLibraries(): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new GoogleDriveDocumentError('unsupported', 'Google Drive linking is available in the Vitruvius web workspace.');
  }
  if (!scriptsReady) {
    const browser = window as any;
    scriptsReady = Promise.all([
      browser.gapi?.load
        ? Promise.resolve()
        : loadScript(GOOGLE_API_SCRIPT, 'vitruvius-google-api'),
      browser.google?.accounts?.oauth2
        ? Promise.resolve()
        : loadScript(GOOGLE_IDENTITY_SCRIPT, 'vitruvius-google-identity'),
    ]).then(async () => {
      if (!browser.gapi?.load || !browser.google?.accounts?.oauth2) {
        throw new GoogleDriveDocumentError('provider_error', 'Google Drive did not finish loading. Refresh the page and try again.');
      }
      await new Promise<void>((resolve, reject) => {
        browser.gapi.load('picker', {
          callback: resolve,
          onerror: () => reject(new GoogleDriveDocumentError('provider_error', 'Google Picker could not be loaded.')),
          timeout: 10_000,
          ontimeout: () => reject(new GoogleDriveDocumentError('network', 'Google Picker timed out while loading.')),
        });
      });
    }).catch(error => {
      scriptsReady = null;
      throw error;
    });
  }
  return scriptsReady;
}

function loadScript(source: string, id: string): Promise<void> {
  const existing = document.getElementById(id) as HTMLScriptElement | null;
  if (existing?.dataset.loaded === 'true') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = existing ?? document.createElement('script');
    const complete = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    const failed = () => reject(new GoogleDriveDocumentError('network', 'Google Drive sign-in could not be loaded. Check the connection and try again.'));
    script.addEventListener('load', complete, { once: true });
    script.addEventListener('error', failed, { once: true });
    if (!existing) {
      script.id = id;
      script.async = true;
      script.defer = true;
      script.src = source;
      document.head.appendChild(script);
    }
  });
}

function requestGoogleDriveToken(clientId: string): Promise<string> {
  if (accessToken && accessToken.expiresAt > Date.now() + TOKEN_EXPIRY_SAFETY_MS) {
    return Promise.resolve(accessToken.value);
  }
  const browser = window as any;
  if (!tokenClient) {
    tokenClient = browser.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: GOOGLE_DRIVE_SCOPE,
      callback: () => undefined,
    }) as GoogleTokenClient;
  }
  return new Promise((resolve, reject) => {
    tokenClient!.callback = response => {
      const error = stringValue(response.error);
      const token = stringValue(response.access_token);
      if (error || !token) {
        reject(new GoogleDriveDocumentError('permission_denied', 'Google Drive access was not granted. No file was linked.'));
        return;
      }
      const expiresInSeconds = positiveNumber(response.expires_in) || 3_600;
      accessToken = Object.freeze({
        value: token,
        expiresAt: Date.now() + expiresInSeconds * 1_000,
      });
      resolve(token);
    };
    tokenClient!.error_callback = () => {
      reject(new GoogleDriveDocumentError('permission_denied', 'Google Drive sign-in was closed or could not be completed.'));
    };
    tokenClient!.requestAccessToken({ prompt: accessToken ? '' : 'consent' });
  });
}

function showGoogleDrivePicker(
  configuration: GoogleDriveWebConfiguration,
  token: string,
): Promise<Readonly<{ fileId: string; resourceKey: string | null }>> {
  const browser = window as any;
  const pickerApi = browser.google?.picker;
  if (!pickerApi) {
    throw new GoogleDriveDocumentError('provider_error', 'Google Picker is unavailable. Refresh the page and try again.');
  }
  return new Promise((resolve, reject) => {
    const view = new pickerApi.DocsView(pickerApi.ViewId.DOCS)
      .setMimeTypes('application/pdf')
      .setIncludeFolders(false)
      .setSelectFolderEnabled(false);
    const builder = new pickerApi.PickerBuilder()
      .addView(view)
      .setOAuthToken(token)
      .setDeveloperKey(configuration.apiKey)
      .setAppId(configuration.appId)
      .setOrigin(window.location.origin)
      .setCallback((data: Record<string, unknown>) => {
        const action = data[pickerApi.Response.ACTION];
        if (action === pickerApi.Action.CANCEL) {
          reject(new GoogleDriveDocumentError('cancelled', 'No Google Drive file was selected.'));
          return;
        }
        if (action !== pickerApi.Action.PICKED) return;
        const documents = data[pickerApi.Response.DOCUMENTS];
        const selected = Array.isArray(documents) ? record(documents[0]) : {};
        const fileId = stringValue(selected[pickerApi.Document.ID] ?? selected.id);
        if (!fileId) {
          reject(new GoogleDriveDocumentError('provider_error', 'Google Picker did not return a usable file.'));
          return;
        }
        resolve({
          fileId,
          resourceKey: nullableString(selected[pickerApi.Document.RESOURCE_KEY] ?? selected.resourceKey),
        });
      });
    builder.build().setVisible(true);
  });
}

function configurationError(configuration: GoogleDriveWebConfiguration) {
  return new GoogleDriveDocumentError(
    'not_configured',
    'Google Drive is temporarily unavailable in Vitruvius. Upload a copy instead, or contact Vitruvius Support.',
  );
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function nullableString(value: unknown): string | null {
  return stringValue(value) || null;
}

function scalarString(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? String(value)
    : stringValue(value);
}

function positiveNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function finitePositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
