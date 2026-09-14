import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import type { DAVEWebReferenceDocument } from '../../services/DAVEWebReadOnlyRepository';
import {
  evaluateECOSDesktopDocumentProofBinding,
  resolveECOSDesktopDocumentProof,
  type ECOSDesktopDocumentProofFocus,
} from '../../services/ECOSDesktopProofNavigation';
import type { ECOSProjectIdentity } from '../../services/ECOSDocumentEvidenceBinding';
import type {
  ECOSAuthorizedDocumentProof,
  ECOSDocumentProofClaim,
  ECOSDocumentProofAuthorityErrorCode,
} from '../../services/ECOSDocumentProofAuthority';
import { ECOSDocumentProofAuthorityError } from '../../services/ECOSDocumentProofAuthority';
import {
  renderECOSWebDocumentProofPreview,
  renderECOSWebProtectedPageProofPreview,
} from '../../services/ECOSWebDocumentProofPreview';
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

type ProofAuthorityState = Readonly<{
  key: string;
  status: 'idle' | 'loading' | 'ready' | 'failed';
  proof: ECOSAuthorizedDocumentProof | null;
  message: string | null;
  errorCode: ECOSDocumentProofAuthorityErrorCode | null;
}>;

const EMPTY_AUTHORITY: ProofAuthorityState = Object.freeze({
  key: '',
  status: 'idle',
  proof: null,
  message: null,
  errorCode: null,
});

export function DesktopDocumentProofPreview({
  document,
  focus,
  projectIdentities,
  loadProofDocument,
  getArtifactUrl,
}: {
  document: DAVEWebReferenceDocument;
  focus: ECOSDesktopDocumentProofFocus | null;
  projectIdentities: readonly ECOSProjectIdentity[];
  loadProofDocument: (
    document: DAVEWebReferenceDocument,
    claim: ECOSDocumentProofClaim,
  ) => Promise<ECOSAuthorizedDocumentProof>;
  getArtifactUrl: (
    bucket: 'project-documents',
    path: string,
    options?: Readonly<{ preview?: boolean }>,
  ) => Promise<string>;
}) {
  const initialBinding = useMemo(
    () => focus
      ? evaluateECOSDesktopDocumentProofBinding(document, focus, projectIdentities)
      : null,
    [document, focus, projectIdentities],
  );
  const authorityKey = focus
    ? [
        document.id,
        focus.projectId,
        focus.sourceSha256,
        focus.evidenceVersion,
        focus.revision,
        focus.pageNumber,
        focus.sheetNumber || '',
        focus.regionId || '',
      ].join(':')
    : '';
  const [authority, setAuthority] = useState<ProofAuthorityState>(EMPTY_AUTHORITY);

  useEffect(() => {
    if (!focus) {
      setAuthority(EMPTY_AUTHORITY);
      return;
    }
    let active = true;
    setAuthority(Object.freeze({
      key: authorityKey,
      status: 'loading',
      proof: null,
      message: null,
      errorCode: null,
    }));
    void loadProofDocument(document, focus)
      .then(proof => {
        if (!active) return;
        setAuthority(Object.freeze({
          key: authorityKey,
          status: 'ready',
          proof,
          message: null,
          errorCode: null,
        }));
      })
      .catch(error => {
        if (!active) return;
        setAuthority(Object.freeze({
          key: authorityKey,
          status: 'failed',
          proof: null,
          message: error instanceof Error && error.message.trim()
            ? error.message.trim()
            : 'The exact cited proof could not be verified against the current project document.',
          errorCode: error instanceof ECOSDocumentProofAuthorityError
            ? error.code
            : 'proof_service_unavailable',
        }));
      });
    return () => {
      active = false;
    };
  }, [authorityKey, document, focus, loadProofDocument]);

  const currentAuthority = authority.key === authorityKey ? authority : EMPTY_AUTHORITY;
  const proofDocument = currentAuthority.status === 'ready'
    ? currentAuthority.proof?.document || null
    : null;
  const protectedPage = currentAuthority.status === 'ready'
    ? currentAuthority.proof?.protectedPage || null
    : null;
  const binding = useMemo(
    () => focus && proofDocument
      ? evaluateECOSDesktopDocumentProofBinding(proofDocument, focus, projectIdentities)
      : initialBinding,
    [focus, initialBinding, proofDocument, projectIdentities],
  );
  const resolved = useMemo(
    () => focus && proofDocument
      ? resolveECOSDesktopDocumentProof([proofDocument], focus, projectIdentities)
      : null,
    [focus, projectIdentities, proofDocument],
  );
  const storagePath = proofDocument?.storagePath?.trim() || document.storagePath?.trim() || '';
  const previewKey = resolved
    ? `${document.id}:${resolved.page?.pageNumber || focus?.pageNumber}:${resolved.region?.id || 'bounds'}:${protectedPage?.sha256 || document.cloudUpdatedAt || document.indexedAt || ''}`
    : '';
  const [preview, setPreview] = useState<PreviewState>(EMPTY_PREVIEW);
  const [fullPageKey, setFullPageKey] = useState<string | null>(null);
  const [originalResolution, setOriginalResolution] = useState(false);
  const viewport = useWindowDimensions();
  useEffect(() => {
    setFullPageKey(null);
    setOriginalResolution(false);
  }, [authorityKey]);

  useEffect(() => {
    if (!resolved || !focus) {
      setPreview(EMPTY_PREVIEW);
      return;
    }
    if (!resolved.bounds || (!protectedPage && !storagePath)) {
      setPreview(Object.freeze({
        key: previewKey,
        status: 'idle',
        dataUrl: null,
        width: 0,
        height: 0,
        signedUrl: null,
        message: !protectedPage && !storagePath
          ? 'The cited page is identified, but this record has no protected processing copy for an exact preview.'
          : 'The citation identifies the drawing page, but it does not include a bounded proof region.',
      }));
      return;
    }

    let active = true;
    setPreview(Object.freeze({
      key: previewKey,
      status: 'loading',
      dataUrl: null,
      width: 0,
      height: 0,
      signedUrl: null,
      message: null,
    }));
    void (protectedPage
      ? renderECOSWebProtectedPageProofPreview({
          dataUrl: protectedPage.dataUrl,
          bounds: resolved.bounds,
        }).then(rendered => ({ rendered, signedUrl: null as string | null }))
      : getArtifactUrl('project-documents', storagePath, { preview: true })
        .then(async signedUrl => ({
          rendered: await renderECOSWebDocumentProofPreview({
            url: signedUrl,
            mimeType: proofDocument?.mimeType || document.mimeType,
            fileName: proofDocument?.originalFileName || document.originalFileName || document.name,
            pageNumber: focus.pageNumber,
            bounds: resolved.bounds!,
          }),
          signedUrl,
        })))
      .then(({ rendered, signedUrl }) => {
        try {
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
    };
  }, [document.mimeType, document.name, document.originalFileName, focus, getArtifactUrl, previewKey, proofDocument, protectedPage, resolved, storagePath]);

  if (!focus) return null;
  if (
    currentAuthority.status === 'idle' || currentAuthority.status === 'loading'
  ) {
    return (
      <View style={styles.card} accessibilityRole="progressbar">
        <View style={styles.loading}>
          <ActivityIndicator color={desktopSurfaces.accent} />
          <Text style={styles.message}>Verifying the exact cited proof…</Text>
        </View>
      </View>
    );
  }
  if (!resolved) {
    return (
      <View style={[styles.card, styles.unavailableCard]} accessibilityRole="alert">
        <View style={styles.header}>
          <View style={styles.icon}>
            <Ionicons name="alert-circle-outline" size={22} color="#B42318" />
          </View>
          <View style={styles.main}>
            <Text style={[styles.eyebrow, styles.unavailableEyebrow]}>ASK ECOS PROOF UNAVAILABLE</Text>
            <Text style={styles.title}>{proofUnavailableTitle(currentAuthority.errorCode, binding?.reason)}</Text>
            <Text style={styles.limited}>
              {currentAuthority.message || binding?.message || 'Refresh project documents and ask ECOS again before relying on this proof.'}
            </Text>
          </View>
        </View>
      </View>
    );
  }
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
              : resolved.match === 'hosted_cited_bounds'
                ? 'Matched to the exact current source and showing the bounded region cited by the hosted ECOS evidence.'
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
      {protectedPage ? (
        <>
          <Pressable
            style={styles.openButton}
            accessibilityRole="button"
            onPress={() => { setOriginalResolution(false); setFullPageKey(previewKey); }}
          >
            <Text style={styles.openText}>View full cited page</Text>
          </Pressable>
          <Modal
            visible={fullPageKey === previewKey}
            transparent
            animationType="none"
            onRequestClose={() => setFullPageKey(null)}
          >
            <View style={styles.pageOverlay}>
              <View style={styles.pageDialog} accessibilityViewIsModal>
                <Text accessibilityRole="header" style={styles.title}>
                  {sheetNumber ? `Sheet ${sheetNumber} · ` : ''}Full cited PDF page {focus.pageNumber}
                </Text>
                <Text style={[styles.message, { flex: 0 }]}>
                  Same verified source page, without the preview crop. Check every dimension used in a calculation.
                </Text>
                <View style={styles.header}>
                  <Pressable style={styles.openButton} accessibilityRole="button" onPress={() => setOriginalResolution(value => !value)}>
                    <Text style={styles.openText}>{originalResolution ? 'Fit page' : 'Original resolution'}</Text>
                  </Pressable>
                  <Pressable style={styles.openButton} accessibilityRole="button" onPress={() => setFullPageKey(null)}>
                    <Text style={styles.openText}>Close full page</Text>
                  </Pressable>
                </View>
                <ScrollView style={styles.pageScroll}>
                  <ScrollView horizontal>
                    <Image
                      source={{ uri: protectedPage.dataUrl }}
                      accessibilityLabel={`Full verified drawing page ${focus.pageNumber}`}
                      resizeMode="contain"
                      style={{
                        width: originalResolution ? protectedPage.width : Math.min(protectedPage.width, Math.max(240, viewport.width - 80)),
                        aspectRatio: protectedPage.width / protectedPage.height,
                      }}
                    />
                  </ScrollView>
                </ScrollView>
              </View>
            </View>
          </Modal>
        </>
      ) : null}
    </View>
  );
}

function proofUnavailableTitle(
  errorCode: ECOSDocumentProofAuthorityErrorCode | null,
  reason: string | null | undefined,
) {
  if (errorCode === 'proof_service_unavailable') {
    return 'The protected proof service is unavailable.';
  }
  if (errorCode === 'permission_denied') {
    return 'This account cannot open the cited project source.';
  }
  if (errorCode === 'invalid_claim') {
    return 'This answer does not contain a complete proof reference.';
  }
  if (errorCode === 'proof_not_found') {
    return 'The exact cited page or region is unavailable.';
  }
  if (errorCode === 'proof_response_invalid') {
    return 'The protected proof response could not be verified.';
  }
  if (reason === 'visual_coverage_mismatch') {
    return 'This build cannot display the exact hosted drawing region.';
  }
  if (reason === 'document_unavailable') {
    return 'The cited current document is unavailable.';
  }
  return 'The cited source no longer matches this document.';
}

function openDrawingPage(url: string, pageNumber: number) {
  if (typeof window === 'undefined') return;
  const base = url.split('#')[0];
  window.open(`${base}#page=${pageNumber}`, '_blank', 'noopener,noreferrer');
}

const styles = StyleSheet.create({
  pageOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', padding: 24 },
  pageDialog: { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, gap: 12 },
  pageScroll: { flex: 1 },
  card: {
    borderWidth: 2,
    borderColor: desktopSurfaces.accent,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    padding: 16,
    gap: 12,
  },
  unavailableCard: { borderColor: '#F0B4AE', backgroundColor: '#FFF5F4' },
  unavailableEyebrow: { color: '#B42318' },
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
