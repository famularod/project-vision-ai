import { useCallback, useEffect, useRef, useState } from 'react';
import { cloudPhotoPreviewIsFresh } from '../services/ProjectPhotoTransport';
import { signProjectPhotoPreview } from '../services/SyncService';
import type { UpdatePhoto } from '../types';

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

  useEffect(() => {
    if (needsSigning) void sign(false);
  }, [needsSigning, sign]);

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
