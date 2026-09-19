import { useCallback, useRef, useState } from 'react';
import {
  isDavePdfExcerptRenderingAvailable,
  renderPdfExcerpt,
} from '../modules/dave-text-recognition';
import type { DAVEAskEvidence } from '../services/DAVEAsk';
import {
  evaluateECOSDocumentEvidenceBinding,
  type ECOSDocumentEvidenceBinding,
  type ECOSProjectIdentity,
} from '../services/ECOSDocumentEvidenceBinding';
import type { ReferenceDocument } from '../types';

export type ECOSDocumentEvidenceState = Readonly<{
  evidence: DAVEAskEvidence;
  document: ReferenceDocument | null;
  imageUri: string | null;
  binding: ECOSDocumentEvidenceBinding | null;
  loading: boolean;
  error: string | null;
}>;

export function useECOSDocumentEvidence({
  documents,
  projectIdentities,
  ensureDocument,
  openDocument,
}: {
  documents: readonly ReferenceDocument[];
  projectIdentities: readonly ECOSProjectIdentity[];
  ensureDocument: (document: ReferenceDocument) => Promise<ReferenceDocument>;
  openDocument: (document: ReferenceDocument) => Promise<void>;
}) {
  const [state, setState] = useState<ECOSDocumentEvidenceState | null>(null);
  const requestId = useRef(0);

  const openEvidence = useCallback(async (evidence: DAVEAskEvidence) => {
    const citation = evidence.documentCitation;
    if (!citation) return;
    const candidateDocument = documents.find(item => item.id === citation.documentId) || null;
    const binding = evaluateECOSDocumentEvidenceBinding(
      evidence,
      candidateDocument,
      projectIdentities,
    );
    const document = binding.exact ? candidateDocument : null;
    const nextRequestId = ++requestId.current;
    setState({
      evidence,
      document,
      imageUri: null,
      binding,
      loading: Boolean(document),
      error: document ? null : binding.message,
    });
    if (!document) return;
    try {
      const readable = await ensureDocument(document);
      const readableBinding = evaluateECOSDocumentEvidenceBinding(
        evidence,
        readable,
        projectIdentities,
      );
      if (!readableBinding.exact) {
        throw new Error(readableBinding.message || 'The cited source could not be verified after download.');
      }
      const isPdf = readable.mimeType === 'application/pdf' || readable.originalFileName.toLowerCase().endsWith('.pdf');
      let imageUri: string | null = null;
      if (isPdf && evidence.documentRegion && citation.pageNumber && isDavePdfExcerptRenderingAvailable()) {
        imageUri = (await renderPdfExcerpt(
          readable.uri,
          citation.pageNumber,
          evidence.documentRegion,
        )).uri;
      } else if (readable.mimeType?.startsWith('image/')) {
        imageUri = readable.uri;
      }
      if (requestId.current !== nextRequestId) return;
      setState(current => current ? {
        ...current,
        document: readable,
        imageUri,
        binding: readableBinding,
        loading: false,
        error: imageUri || !evidence.documentRegion
          ? null
          : 'The cited text is verified, but this build could not render the drawing crop.',
      } : null);
    } catch (error) {
      if (requestId.current !== nextRequestId) return;
      setState(current => current ? {
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : 'The cited source could not be prepared.',
      } : null);
    }
  }, [documents, ensureDocument, projectIdentities]);

  const close = useCallback(() => {
    requestId.current += 1;
    setState(null);
  }, []);

  const openFullDocument = useCallback(() => {
    if (state?.document) void openDocument(state.document);
  }, [openDocument, state?.document]);

  return { state, openEvidence, openFullDocument, close };
}
