import { useCallback, useEffect, useRef, useState } from 'react';
import type { DAVEAskEvidence } from '../services/DAVEAsk';
import { findExactECOSDocumentEvidenceSource } from '../services/ECOSDocumentEvidenceBinding';
import type { ReferenceDocument } from '../types';

export type ECOSDocumentEvidenceState = Readonly<{
  evidence: DAVEAskEvidence;
  document: ReferenceDocument | null;
  imageUri: string | null;
  loading: boolean;
  error: string | null;
}>;

const SOURCE_UNAVAILABLE = 'The cited current document is no longer available on this device.';
const NATIVE_PDF_PROOF_UNAVAILABLE =
  'The cited text is verified, but PDF proof preview requires the protected desktop renderer. Open the current source document to inspect this page.';

export function useECOSDocumentEvidence({
  documents,
  ensureDocument,
  openDocument,
}: {
  documents: readonly ReferenceDocument[];
  ensureDocument: (document: ReferenceDocument) => Promise<ReferenceDocument>;
  openDocument: (
    document: ReferenceDocument,
    isAuthorityCurrent: (candidate: ReferenceDocument) => boolean,
  ) => Promise<void>;
}) {
  const [state, setState] = useState<ECOSDocumentEvidenceState | null>(null);
  const requestId = useRef(0);
  const documentsRef = useRef(documents);
  const activeEvidenceRef = useRef<DAVEAskEvidence | null>(null);
  documentsRef.current = documents;

  const markSourceUnavailable = useCallback((expectedRequestId: number) => {
    if (requestId.current !== expectedRequestId) return;
    activeEvidenceRef.current = null;
    setState(current => {
      if (!current || (
        current.document == null &&
        current.imageUri == null &&
        current.loading === false &&
        current.error === SOURCE_UNAVAILABLE
      )) return current;
      return {
        ...current,
        document: null,
        imageUri: null,
        loading: false,
        error: SOURCE_UNAVAILABLE,
      };
    });
  }, []);

  useEffect(() => {
    const evidence = activeEvidenceRef.current;
    if (!evidence || findExactECOSDocumentEvidenceSource(documents, evidence)) return;
    const nextRequestId = ++requestId.current;
    markSourceUnavailable(nextRequestId);
  }, [documents, markSourceUnavailable]);

  const openEvidence = useCallback(async (evidence: DAVEAskEvidence) => {
    const citation = evidence.documentCitation;
    if (!citation) return;
    activeEvidenceRef.current = evidence;
    const document = findExactECOSDocumentEvidenceSource(documentsRef.current, evidence);
    const nextRequestId = ++requestId.current;
    setState({
      evidence,
      document,
      imageUri: null,
      loading: Boolean(document),
      error: document ? null : SOURCE_UNAVAILABLE,
    });
    if (!document) return;
    try {
      const readable = await ensureDocument(document);
      if (requestId.current !== nextRequestId) return;
      if (
        !findExactECOSDocumentEvidenceSource(documentsRef.current, evidence) ||
        !findExactECOSDocumentEvidenceSource([readable], evidence)
      ) {
        markSourceUnavailable(nextRequestId);
        return;
      }
      const isPdf = isNativePDFArtifact(
        readable.mimeType,
        readable.originalFileName,
        readable.name,
        readable.uri,
      );
      let imageUri: string | null = null;
      if (!isPdf && readable.mimeType?.startsWith('image/')) {
        imageUri = readable.uri;
      }
      if (requestId.current !== nextRequestId) return;
      if (
        !findExactECOSDocumentEvidenceSource(documentsRef.current, evidence) ||
        !findExactECOSDocumentEvidenceSource([readable], evidence)
      ) {
        markSourceUnavailable(nextRequestId);
        return;
      }
      setState(current => current ? {
        ...current,
        document: readable,
        imageUri,
        loading: false,
        error: imageUri || !evidence.documentRegion
          ? null
          : isPdf
            ? NATIVE_PDF_PROOF_UNAVAILABLE
            : 'The cited text is verified, but this build could not render the drawing crop.',
      } : null);
    } catch (error) {
      if (requestId.current !== nextRequestId) return;
      if (
        !findExactECOSDocumentEvidenceSource(documentsRef.current, evidence) ||
        !findExactECOSDocumentEvidenceSource([document], evidence)
      ) {
        markSourceUnavailable(nextRequestId);
        return;
      }
      setState(current => current ? {
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : 'The cited source could not be prepared.',
      } : null);
    }
  }, [ensureDocument, markSourceUnavailable]);

  const close = useCallback(() => {
    requestId.current += 1;
    activeEvidenceRef.current = null;
    setState(null);
  }, []);

  const openFullDocument = useCallback(() => {
    if (!state?.document) return;
    const evidence = state.evidence;
    const document = state.document;
    if (
      !findExactECOSDocumentEvidenceSource(documentsRef.current, evidence) ||
      !findExactECOSDocumentEvidenceSource([document], evidence)
    ) {
      const nextRequestId = ++requestId.current;
      markSourceUnavailable(nextRequestId);
      return;
    }
    const openRequestId = requestId.current;
    void openDocument(document, candidate =>
      requestId.current === openRequestId &&
      activeEvidenceRef.current === evidence &&
      Boolean(findExactECOSDocumentEvidenceSource(
        documentsRef.current,
        evidence,
      )) &&
      Boolean(findExactECOSDocumentEvidenceSource([candidate], evidence))
    );
  }, [markSourceUnavailable, openDocument, state]);

  return { state, openEvidence, openFullDocument, close };
}

function isNativePDFArtifact(
  mimeType: string | null | undefined,
  ...locations: string[]
) {
  const normalizedMimeType = (mimeType || '').trim().toLowerCase();
  return normalizedMimeType.includes('pdf') || locations.some(value =>
    value.trim().toLowerCase().split(/[?#]/, 1)[0].endsWith('.pdf')
  );
}
