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
import type { ECOSAuthorizedDocumentProof } from '../services/ECOSDocumentProofAuthority';
import type { ReferenceDocument } from '../types';

export type ECOSDocumentEvidenceImageBounds = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export type ECOSDocumentEvidenceState = Readonly<{
  evidence: DAVEAskEvidence;
  document: ReferenceDocument | null;
  imageUri: string | null;
  imageWidth: number;
  imageHeight: number;
  imageBounds: ECOSDocumentEvidenceImageBounds | null;
  binding: ECOSDocumentEvidenceBinding | null;
  loading: boolean;
  error: string | null;
}>;

export function useECOSDocumentEvidence({
  documents,
  projectIdentities,
  loadProofDocument,
  ensureDocument,
  openDocument,
}: {
  documents: readonly ReferenceDocument[];
  projectIdentities: readonly ECOSProjectIdentity[];
  loadProofDocument: (
    evidence: DAVEAskEvidence,
    document: ReferenceDocument,
  ) => Promise<ECOSAuthorizedDocumentProof>;
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
    const nextRequestId = ++requestId.current;
    setState({
      evidence,
      document: binding.exact ? candidateDocument : null,
      imageUri: null,
      imageWidth: 0,
      imageHeight: 0,
      imageBounds: null,
      binding,
      loading: Boolean(candidateDocument),
      error: candidateDocument ? null : binding.message,
    });
    if (!candidateDocument) return;
    try {
      const proof = await loadProofDocument(evidence, candidateDocument);
      const proofDocument = proof.document;
      const proofBinding = evaluateECOSDocumentEvidenceBinding(
        evidence,
        proofDocument,
        projectIdentities,
      );
      if (!proofBinding.exact) {
        throw new Error(proofBinding.message || 'The cited source could not be verified.');
      }
      const protectedPage = proof.protectedPage;
      if (protectedPage) {
        if (requestId.current !== nextRequestId) return;
        setState(current => current ? {
          ...current,
          document: proofDocument,
          imageUri: protectedPage.dataUrl,
          imageWidth: protectedPage.width,
          imageHeight: protectedPage.height,
          imageBounds: normalizedImageBounds(evidence.documentRegion),
          binding: proofBinding,
          loading: false,
          error: null,
        } : null);
        return;
      }
      const readable = await ensureDocument(proofDocument);
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
        imageWidth: 0,
        imageHeight: 0,
        imageBounds: null,
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
  }, [documents, ensureDocument, loadProofDocument, projectIdentities]);

  const close = useCallback(() => {
    requestId.current += 1;
    setState(null);
  }, []);

  const openFullDocument = useCallback(() => {
    if (state?.document) void openDocument(state.document);
  }, [openDocument, state?.document]);

  return { state, openEvidence, openFullDocument, close };
}

function normalizedImageBounds(value: unknown): ECOSDocumentEvidenceImageBounds | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const region = value as Record<string, unknown>;
  const x = finiteNumber(region.x);
  const y = finiteNumber(region.y);
  const width = finiteNumber(region.width);
  const height = finiteNumber(region.height);
  if (
    x == null || y == null || width == null || height == null ||
    x < 0 || y < 0 || width <= 0 || height <= 0 ||
    x + width > 1.000001 || y + height > 1.000001
  ) return null;
  return Object.freeze({ x, y, width, height });
}

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
