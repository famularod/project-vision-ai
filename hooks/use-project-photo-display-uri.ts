import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { cloudPhotoPreviewIsFresh } from '../services/ProjectPhotoTransport';
import { subscribeToAuthStateChange } from '../services/SupabaseService';
import { signProjectPhotoPreview } from '../services/SyncService';
import type { UpdatePhoto } from '../types';

/** A signing that failed (no signal) is tried again after this, doubling each time. */
export const PHOTO_SIGNING_RETRY_FIRST_MS = 10_000;
export const PHOTO_SIGNING_RETRY_MAX_MS = 5 * 60_000;

const waitingForSignal = new Set<() => void>();
let stopListening: (() => void) | null = null;

/**
 * Tells every image whose signing failed that it may be worth trying now: the
 * app came back to the foreground, or the sign-in refreshed, which is the
 * first thing that happens when signal returns (as the queued-update sync
 * reads it). One listener each, shared by all the waiting images.
 */
function onPhotoSigningChance(listener: () => void): () => void {
  waitingForSignal.add(listener);
  if (!stopListening) {
    const notify = () => [...waitingForSignal].forEach(wake => wake());
    const appState = AppState.addEventListener('change', state => {
      if (state === 'active') notify();
    });
    const stopAuth = subscribeToAuthStateChange(event => {
      if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') notify();
    });
    stopListening = () => {
      appState?.remove();
      stopAuth();
    };
  }
  return () => {
    waitingForSignal.delete(listener);
    if (waitingForSignal.size === 0 && stopListening) {
      stopListening();
      stopListening = null;
    }
  };
}

type DisplayPhoto = Pick<
  UpdatePhoto,
  'cloudStoragePath' | 'cloudPreviewUri' | 'cloudPreviewSignedUrlExpiresAt' | 'mimeType' | 'fileName'
>;
type SignedPreview = Readonly<{ path: string; uri: string; usableUntil: number }>;

/**
 * What a saved photo shows (whole-app audit A4 pass 6, 30 Sep 2026). A photo
 * from another device has no file here, only a signed preview that lapses
 * about 9 minutes after signing, and nothing signed it again, so the photo
 * went blank. A local file always wins. Otherwise the stored preview or this
 * image's own signed URL shows while usable; when neither is, one is signed
 * and the old URL stays up meanwhile. A failed load re-signs once per URL,
 * never in a loop. A result for an unmounted image or an earlier path is
 * dropped.
 */
export function useProjectPhotoDisplayUri(
  photo: Partial<DisplayPhoto> | undefined,
  localUri: string,
): Readonly<{ uri: string; onError: () => void }> {
  const path = photo?.cloudStoragePath?.trim() || '';
  const mimeType = photo?.mimeType ?? null;
  const fileName = photo?.fileName ?? null;
  const [signed, setSigned] = useState<SignedPreview | null>(null);
  const live = useRef({ mounted: true, path });
  live.current.path = path;
  const failedUris = useRef(new Set<string>());
  useEffect(() => {
    const current = live.current;
    current.mounted = true;
    return () => { current.mounted = false; };
  }, []);

  const now = Date.now();
  const own = signed?.path === path ? signed : null;
  const ownFresh = own && own.usableUntil > now ? own : null;
  const stored = photo && cloudPhotoPreviewIsFresh(photo, now) ? photo.cloudPreviewUri || '' : '';
  const storedUntil = stored ? Date.parse(photo?.cloudPreviewSignedUrlExpiresAt || '') : 0;
  const usable = ownFresh && ownFresh.usableUntil >= storedUntil ? ownFresh.uri : stored;
  const needsSigning = !localUri && Boolean(path) && !usable;
  const uri = localUri || usable || own?.uri || photo?.cloudPreviewUri || '';

  const sign = useCallback((force: boolean) =>
    signProjectPhotoPreview({ cloudStoragePath: path, mimeType, fileName }, { force })
      .then(result => {
        if (!result || !live.current.mounted || live.current.path !== path) return null;
        setSigned({ path, ...result });
        return result;
      })
      .catch(() => null), [path, mimeType, fileName]);

  // A signing that failed (no signal) is tried again on return to the app,
  // when the sign-in refreshes, and after a wait that doubles up to 5
  // minutes; it used to wait for the photo to be scrolled away or reopened
  // (whole-app audit A4 pass 7 L1, 30 Sep 2026).
  const [attempt, setAttempt] = useState(0);
  const failedSignings = useRef(0);
  useEffect(() => {
    if (!needsSigning) {
      failedSignings.current = 0;
      return undefined;
    }
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopWaiting: (() => void) | undefined;
    const tryAgain = (fresh: boolean) => {
      if (!current) return;
      current = false;
      if (fresh) failedSignings.current = 0;
      setAttempt(value => value + 1);
    };
    void sign(false).then(result => {
      if (!current || result) return;
      const wait = Math.min(PHOTO_SIGNING_RETRY_MAX_MS, PHOTO_SIGNING_RETRY_FIRST_MS * 2 ** failedSignings.current);
      failedSignings.current += 1;
      timer = setTimeout(() => tryAgain(false), wait);
      stopWaiting = onPhotoSigningChance(() => tryAgain(true));
    });
    return () => {
      current = false;
      if (timer) clearTimeout(timer);
      stopWaiting?.();
    };
  }, [needsSigning, sign, attempt]);

  const onError = useCallback(() => {
    if (localUri || !path || !uri || failedUris.current.has(uri)) return;
    failedUris.current.add(uri);
    void sign(true).then(result => {
      // A re-signed URL that fails too is left for the next expiry to replace.
      if (result) failedUris.current.add(result.uri);
    });
  }, [localUri, path, uri, sign]);

  return { uri, onError };
}
