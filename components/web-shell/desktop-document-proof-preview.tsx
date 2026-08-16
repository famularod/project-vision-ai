import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { DAVEWebReferenceDocument } from '../../services/DAVEWebReadOnlyRepository';
import {
  resolveECOSDesktopDocumentProof,
  type ECOSDesktopDocumentProofFocus,
} from '../../services/ECOSDesktopProofNavigation';
import { renderECOSWebDocumentProofPreview } from '../../services/ECOSWebDocumentProofPreview';
import { desktopSurfaces } from './desktop-surface-palette';

type PreviewState = Readonly<{
  key: string;
  status: 'idle' | 'loading' | 'ready' | 'failed';
  dataUrl: string | null;
  width: number;
  height: number;
  signedUrl: string | null;
  message: string | null;
}>;

const EMPTY_PREVIEW: PreviewState = Object.freeze({
  key: '',
  status: 'idle',
  dataUrl: null,
  width: 0,
  height: 0,
  signedUrl: null,
  message: null,
});

export function DesktopDocumentProofPreview({
  document,
  focus,
  getArtifactUrl,
}: {
  document: DAVEWebReferenceDocument;
  focus: ECOSDesktopDocumentProofFocus | null;
  getArtifactUrl: (
    bucket: 'project-documents',
    path: string,
    options?: Readonly<{ preview?: boolean }>,
  ) => Promise<string>;
}) {
  const resolved = useMemo(
    () => focus ? resolveECOSDesktopDocumentProof([document], focus) : null,
    [document, focus],
  );
  const storagePath = document.storagePath?.trim() || '';
  const previewKey = resolved
    ? `${document.id}:${resolved.page?.pageNumber || focus?.pageNumber}:${resolved.region?.id || 'bounds'}:${document.cloudUpdatedAt || document.indexedAt || ''}`
    : '';
  const [preview, setPreview] = useState<PreviewState>(EMPTY_PREVIEW);

  useEffect(() => {
    if (!resolved || !focus) {
      setPreview(EMPTY_PREVIEW);
      return;
    }
    if (!resolved.bounds || !storagePath) {
      setPreview(Object.freeze({
        key: previewKey,
        status: 'idle',
        dataUrl: null,
        width: 0,
        height: 0,
        signedUrl: null,
        message: !storagePath
          ? 'The cited page is identified, but this record has no protected processing copy for an exact preview.'
          : 'The citation identifies the drawing page, but it does not include a bounded proof region.',
      }));
      return;
    }

    let active = true;
    const controller = new AbortController();
    setPreview(Object.freeze({
      key: previewKey,
      status: 'loading',
      dataUrl: null,
      width: 0,
      height: 0,
      signedUrl: null,
      message: null,
    }));
    void getArtifactUrl('project-documents', storagePath, { preview: true })
      .then(async signedUrl => {
        try {
          const rendered = await renderECOSWebDocumentProofPreview({
            url: signedUrl,
            mimeType: document.mimeType,
            fileName: document.originalFileName || document.name,
            pageNumber: focus.pageNumber,
            bounds: resolved.bounds!,
            signal: controller.signal,
          });
          if (!active) return;
          setPreview(Object.freeze({
            key: previewKey,
            status: 'ready',
            dataUrl: rendered.dataUrl,
            width: rendered.width,
            height: rendered.height,
            signedUrl,
            message: null,
          }));
        } catch (error) {
          if (!active) return;
          setPreview(Object.freeze({
            key: previewKey,
            status: 'failed',
            dataUrl: null,
            width: 0,
            height: 0,
            signedUrl,
            message: error instanceof Error && error.message.trim()
              ? `${error.message.trim()} You can still open the full cited page.`
              : 'The exact proof preview is temporarily unavailable. You can still open the full cited page.',
          }));
        }
      })
      .catch(error => {
        if (!active) return;
        setPreview(Object.freeze({
          key: previewKey,
          status: 'failed',
          dataUrl: null,
          width: 0,
          height: 0,
          signedUrl: null,
          message: error instanceof Error && error.message.trim()
            ? error.message.trim()
            : 'The exact proof preview is temporarily unavailable.',
        }));
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [document.mimeType, document.name, document.originalFileName, focus, getArtifactUrl, previewKey, resolved, storagePath]);

  if (!resolved || !focus) return null;
  const sheetNumber = resolved.page?.sheetNumber || focus.sheetNumber;
  const exactStoredRegion = resolved.match === 'stored_region';
  const regionText = resolved.region?.evidenceText?.trim()
    || resolved.region?.text?.trim()
    || resolved.region?.label?.trim()
    || null;
  const aspectRatio = preview.width > 0 && preview.height > 0
    ? preview.width / preview.height
    : 1.5;

  return (
    <View style={styles.card} accessibilityLabel="Ask ECOS cited drawing proof">
      <View style={styles.header}>
        <View style={styles.icon}>
          <Ionicons name="locate-outline" size={22} color={desktopSurfaces.accent} />
        </View>
        <View style={styles.main}>
          <Text style={styles.eyebrow}>ASK ECOS CITED PROOF</Text>
          <Text style={styles.title}>
            {sheetNumber ? `Sheet ${sheetNumber} · ` : ''}PDF page {focus.pageNumber}
          </Text>
          <Text style={exactStoredRegion ? styles.verified : styles.limited}>
            {exactStoredRegion
              ? 'Matched to the exact region in the current authorized index.'
              : resolved.match === 'cited_bounds'
                ? 'Showing the cited bounds; the stored region could not be re-matched, so this preview is not labeled verified.'
                : 'The citation identifies this page but does not contain exact region bounds.'}
          </Text>
        </View>
      </View>

      {regionText ? <Text style={styles.excerpt}>{regionText}</Text> : null}

      {preview.status === 'loading' ? (
        <View style={styles.loading} accessibilityRole="progressbar">
          <ActivityIndicator color={desktopSurfaces.accent} />
          <Text style={styles.message}>Opening the exact cited drawing region…</Text>
        </View>
      ) : null}
      {preview.status === 'ready' && preview.dataUrl ? (
        <Image
          source={{ uri: preview.dataUrl }}
          resizeMode="contain"
          style={[styles.image, { aspectRatio }]}
          accessibilityLabel={`Drawing proof from ${sheetNumber ? `sheet ${sheetNumber}, ` : ''}page ${focus.pageNumber}`}
        />
      ) : null}
      {preview.message ? (
        <View style={styles.messageRow} accessibilityRole="alert">
          <Ionicons name="information-circle-outline" size={18} color="#7A4E00" />
          <Text style={styles.message}>{preview.message}</Text>
        </View>
      ) : null}

      {preview.signedUrl ? (
        <Pressable
          style={({ pressed }) => [styles.openButton, pressed && styles.pressed]}
          onPress={() => openDrawingPage(preview.signedUrl!, focus.pageNumber)}
          accessibilityRole="link"
        >
          <Ionicons name="open-outline" size={18} color={desktopSurfaces.accent} />
          <Text style={styles.openText}>Open the full cited page</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function openDrawingPage(url: string, pageNumber: number) {
  if (typeof window === 'undefined') return;
  const base = url.split('#')[0];
  window.open(`${base}#page=${pageNumber}`, '_blank', 'noopener,noreferrer');
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 2,
    borderColor: desktopSurfaces.accent,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    padding: 16,
    gap: 12,
  },
  header: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  icon: { width: 42, height: 42, borderRadius: 12, backgroundColor: '#EAF4FF', alignItems: 'center', justifyContent: 'center' },
  main: { flex: 1, minWidth: 0 },
  eyebrow: { color: desktopSurfaces.accent, fontSize: 11, fontWeight: '900', letterSpacing: 0.8 },
  title: { color: desktopSurfaces.text, fontSize: 17, lineHeight: 23, fontWeight: '900', marginTop: 3 },
  verified: { color: '#18783B', fontSize: 12, lineHeight: 18, fontWeight: '800', marginTop: 3 },
  limited: { color: '#7A4E00', fontSize: 12, lineHeight: 18, fontWeight: '800', marginTop: 3 },
  excerpt: { color: desktopSurfaces.text, fontSize: 14, lineHeight: 21, fontWeight: '700', backgroundColor: '#F5F8FC', borderRadius: 10, padding: 12 },
  loading: { minHeight: 90, alignItems: 'center', justifyContent: 'center', gap: 8 },
  image: { width: '100%', maxHeight: 480, minHeight: 160, borderRadius: 12, backgroundColor: '#F5F8FC' },
  messageRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: '#FFF8E8', borderRadius: 10, padding: 10 },
  message: { flex: 1, color: '#65501D', fontSize: 12, lineHeight: 18 },
  openButton: { minHeight: 44, borderRadius: 11, borderWidth: 1, borderColor: '#B9D1EC', backgroundColor: '#F5F9FE', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 12 },
  openText: { color: desktopSurfaces.accent, fontSize: 13, fontWeight: '900' },
  pressed: { opacity: 0.72 },
});
