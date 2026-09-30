/**
 * Whole-app audit A4 pass 6 (30 Sep 2026): a photo from another device shows
 * a signed preview that lapses about 9 minutes after signing, and nothing
 * signed it again, so the photo went blank. The image now signs its own
 * preview when shown. Runs the real SyncService signing cache, dedupe and
 * limit; only the Supabase signing call is mocked.
 */
import { act, render, renderHook, screen, waitFor } from '@testing-library/react-native';
import { ProjectPhotoImage } from '../../components/ProjectPhotoImage';
import {
  PHOTO_SIGNING_RETRY_FIRST_MS,
  useProjectPhotoDisplayUri,
} from '../../hooks/use-project-photo-display-uri';
import { AppState } from 'react-native';
import { createPhotoSignedUrl } from '../../services/SupabaseService';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));
/** Sign-in events the hook listens to (A4 pass 7 L1). */
const mockAuthListeners = new Set<(event: string) => void>();
jest.mock('../../services/SupabaseService', () => ({
  ...jest.requireActual('../../services/SupabaseService'),
  createPhotoSignedUrl: jest.fn(),
  subscribeToAuthStateChange: jest.fn((listener: (event: string) => void) => {
    mockAuthListeners.add(listener);
    return () => { mockAuthListeners.delete(listener); };
  }),
}));

const MINUTE = 60_000;
const LOCAL = 'file:///var/mobile/Containers/Data/Application/NEW/Documents/project-photos/a.jpg';
const signedUrl = createPhotoSignedUrl as jest.Mock;
const realNow = Date.now.bind(Date);
let clockOffsetMs = 0;
let signings = 0;

type Photo = NonNullable<Parameters<typeof useProjectPhotoDisplayUri>[0]>;
// Each test uses its own storage path: the signing cache lives for the module.
const photo = (cloudStoragePath: string, preview?: { uri: string; expiresInMs: number }): Photo => ({
  fileName: 'IMG.jpg',
  mimeType: 'image/jpeg',
  cloudStoragePath,
  ...(preview ? {
    cloudPreviewUri: preview.uri,
    cloudPreviewSignedUrlExpiresAt: new Date(Date.now() + preview.expiresInMs).toISOString(),
  } : {}),
});
const signedFor = (path: string, version: number) => `https://signed.example/${path}?v=${version}`;
function deferred() {
  let resolve: (value: unknown) => void = () => undefined;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
const flush = () => act(async () => { await Promise.resolve(); });

beforeEach(() => {
  clockOffsetMs = 0;
  signings = 0;
  jest.spyOn(Date, 'now').mockImplementation(() => realNow() + clockOffsetMs);
  signedUrl.mockReset().mockImplementation(async (path: string) => ({
    ok: true, stubbed: false, data: signedFor(path, ++signings),
  }));
});
afterEach(() => jest.restoreAllMocks());

describe('useProjectPhotoDisplayUri (whole-app audit A4 pass 6)', () => {
  it('shows a local file with no signing, even when the image reports an error', async () => {
    const { result } = await renderHook(() => useProjectPhotoDisplayUri(photo('p/h1/a.jpg'), LOCAL));
    expect(result.current.uri).toBe(LOCAL);
    await act(async () => { result.current.onError(); });
    await flush();
    expect(signedUrl).not.toHaveBeenCalled();
  });

  it('shows a stored preview that is still usable with no signing', async () => {
    const stored = photo('p/h2/a.jpg', { uri: 'https://signed.example/stored', expiresInMs: 5 * MINUTE });
    const { result } = await renderHook(() => useProjectPhotoDisplayUri(stored, ''));
    await flush();
    expect(result.current.uri).toBe('https://signed.example/stored');
    expect(signedUrl).not.toHaveBeenCalled();
  });

  it('ten minutes on, signs once, keeps the old URL up meanwhile, then shows the new one', async () => {
    const stored = photo('p/h3/a.jpg', { uri: 'https://signed.example/stored', expiresInMs: 9 * MINUTE });
    const pending = deferred();
    signedUrl.mockImplementationOnce(() => pending.promise);
    const { result, rerender } = await renderHook(
      (current: Photo) => useProjectPhotoDisplayUri(current, ''),
      { initialProps: stored },
    );
    expect(signedUrl).not.toHaveBeenCalled();

    clockOffsetMs = 10 * MINUTE;
    await rerender(stored);
    expect(signedUrl).toHaveBeenCalledTimes(1);
    expect(result.current.uri).toBe('https://signed.example/stored');

    await act(async () => { pending.resolve({ ok: true, stubbed: false, data: signedFor('p/h3/a.jpg', 1) }); });
    await waitFor(() => expect(result.current.uri).toBe(signedFor('p/h3/a.jpg', 1)));
    await rerender(stored);
    await flush();
    expect(signedUrl).toHaveBeenCalledTimes(1);
  });

  it('a failed load re-signs once past the cache, and never loops on the same or the re-signed URL', async () => {
    const current = photo('p/h4/a.jpg');
    const { result } = await renderHook(() => useProjectPhotoDisplayUri(current, ''));
    await waitFor(() => expect(result.current.uri).toBe(signedFor('p/h4/a.jpg', 1)));
    const failedOnError = result.current.onError;
    await act(async () => { failedOnError(); });
    await waitFor(() => expect(result.current.uri).toBe(signedFor('p/h4/a.jpg', 2)));
    expect(signedUrl).toHaveBeenCalledTimes(2);

    await act(async () => {
      failedOnError();
      result.current.onError();
    });
    await flush();
    expect(signedUrl).toHaveBeenCalledTimes(2);
    expect(result.current.uri).toBe(signedFor('p/h4/a.jpg', 2));
  });

  it('drops a result that arrives after unmount or after the path changed', async () => {
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const late = deferred();
    signedUrl.mockImplementationOnce(() => late.promise);
    const unmounted = await renderHook(() => useProjectPhotoDisplayUri(photo('p/h5/a.jpg'), ''));
    expect(signedUrl).toHaveBeenCalledTimes(1);
    unmounted.unmount();
    await act(async () => { late.resolve({ ok: true, stubbed: false, data: signedFor('p/h5/a.jpg', 9) }); });
    expect(unmounted.result.current.uri).toBe('');
    expect(errors).not.toHaveBeenCalled();

    const first = deferred();
    signedUrl.mockImplementationOnce(() => first.promise);
    const seen: string[] = [];
    const { result, rerender } = await renderHook(
      (current: Photo) => {
        const display = useProjectPhotoDisplayUri(current, '');
        seen.push(display.uri);
        return display;
      },
      { initialProps: photo('p/h6/a.jpg') },
    );
    await rerender(photo('p/h6/b.jpg'));
    await waitFor(() => expect(result.current.uri).toBe(signedFor('p/h6/b.jpg', 1)));
    seen.length = 0;
    await act(async () => { first.resolve({ ok: true, stubbed: false, data: signedFor('p/h6/a.jpg', 9) }); });
    await flush();
    expect(result.current.uri).toBe(signedFor('p/h6/b.jpg', 1));
    expect(seen.every(uri => uri === signedFor('p/h6/b.jpg', 1))).toBe(true);
    expect(signedUrl).toHaveBeenCalledTimes(3);

    // Another photo in the same image never shows the previous photo's URL.
    await rerender(photo('p/h6/c.jpg'));
    expect(result.current.uri).toBe('');
    await waitFor(() => expect(result.current.uri).toBe(signedFor('p/h6/c.jpg', 2)));
    expect(signedUrl).toHaveBeenCalledTimes(4);
  });

  it('two images of the same photo share a single signing call', async () => {
    const shared = photo('p/h7/a.jpg');
    await render(
      <>
        <ProjectPhotoImage testID="first" photo={shared} localUri="" />
        <ProjectPhotoImage testID="second" photo={{ ...shared }} localUri="" />
      </>,
    );
    await waitFor(() => expect(screen.getByTestId('second').props.source.uri).toBe(signedFor('p/h7/a.jpg', 1)));
    expect(screen.getByTestId('first').props.source.uri).toBe(signedFor('p/h7/a.jpg', 1));
    expect(signedUrl).toHaveBeenCalledTimes(1);
  });
});

/**
 * Whole-app audit A4 pass 7 L1 (30 Sep 2026): a photo whose signing failed
 * with no signal stayed blank after signal returned, until it was scrolled
 * away or reopened. It is now tried again on return to the app, when the
 * sign-in refreshes, and after a wait that doubles; never in a loop.
 */
describe('a signing that failed with no signal (A4 pass 7 L1)', () => {
  const noSignal = async () => ({ ok: false, stubbed: false, data: null, error: 'Network request failed' });
  const appStateListeners = () => (AppState.addEventListener as jest.Mock).mock.calls
    .filter(([type]) => type === 'change')
    .map(([, listener]) => listener as (state: string) => void);
  afterEach(() => jest.useRealTimers());

  it('signs again when the app comes back to the foreground, once, and stops listening when shown', async () => {
    signedUrl.mockImplementation(noSignal);
    const { result } = await renderHook(() => useProjectPhotoDisplayUri(photo('p/l1a/a.jpg'), ''));
    await flush();
    expect(signedUrl).toHaveBeenCalledTimes(1);
    expect(result.current.uri).toBe('');

    // Signal is back; nothing asks until the owner returns to the app.
    signedUrl.mockImplementation(async (path: string) => ({ ok: true, stubbed: false, data: signedFor(path, ++signings) }));
    await flush();
    expect(signedUrl).toHaveBeenCalledTimes(1);
    await act(async () => { appStateListeners().forEach(listener => listener('active')); });
    await waitFor(() => expect(result.current.uri).toBe(signedFor('p/l1a/a.jpg', 1)));
    expect(signedUrl).toHaveBeenCalledTimes(2);
    await act(async () => { appStateListeners().forEach(listener => listener('active')); });
    await flush();
    expect(signedUrl).toHaveBeenCalledTimes(2);
    expect(mockAuthListeners.size).toBe(0);
  });

  it('signs again when the sign-in refreshes (signal back after an offline start)', async () => {
    signedUrl.mockImplementation(noSignal);
    const { result } = await renderHook(() => useProjectPhotoDisplayUri(photo('p/l1b/a.jpg'), ''));
    await flush();
    expect(mockAuthListeners.size).toBe(1);
    signedUrl.mockImplementation(async (path: string) => ({ ok: true, stubbed: false, data: signedFor(path, ++signings) }));
    await act(async () => { [...mockAuthListeners].forEach(listener => listener('TOKEN_REFRESHED')); });
    await waitFor(() => expect(result.current.uri).toBe(signedFor('p/l1b/a.jpg', 1)));
    expect(mockAuthListeners.size).toBe(0);
  });

  it('otherwise tries again after 10 s, then 20 s, and never sooner', async () => {
    jest.useFakeTimers();
    signedUrl.mockImplementation(noSignal);
    const { result, unmount } = await renderHook(() => useProjectPhotoDisplayUri(photo('p/l1c/a.jpg'), ''));
    await act(async () => { await jest.advanceTimersByTimeAsync(0); });
    expect(signedUrl).toHaveBeenCalledTimes(1);
    await act(async () => { await jest.advanceTimersByTimeAsync(PHOTO_SIGNING_RETRY_FIRST_MS - 1); });
    expect(signedUrl).toHaveBeenCalledTimes(1);
    await act(async () => { await jest.advanceTimersByTimeAsync(1); });
    expect(signedUrl).toHaveBeenCalledTimes(2);
    await act(async () => { await jest.advanceTimersByTimeAsync(2 * PHOTO_SIGNING_RETRY_FIRST_MS - 1); });
    expect(signedUrl).toHaveBeenCalledTimes(2);
    signedUrl.mockImplementation(async (path: string) => ({ ok: true, stubbed: false, data: signedFor(path, ++signings) }));
    await act(async () => { await jest.advanceTimersByTimeAsync(1); });
    expect(signedUrl).toHaveBeenCalledTimes(3);
    expect(result.current.uri).toBe(signedFor('p/l1c/a.jpg', 1));
    // Shown: no timer or listener is left behind.
    await act(async () => { await jest.advanceTimersByTimeAsync(10 * 60_000); });
    expect(signedUrl).toHaveBeenCalledTimes(3);
    unmount();
    expect(jest.getTimerCount()).toBe(0);
  });
});
