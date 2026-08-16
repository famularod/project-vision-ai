import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useECOSDocumentEvidence } from '../../hooks/use-ecos-document-evidence';
import type { DAVEAskEvidence } from '../../services/DAVEAsk';
import { computeECOSPageGraphSha256 } from '../../services/ECOSHostedPageGraphAuthority';
import type { ReferenceDocument } from '../../types';

const SHA = 'a'.repeat(64);
const evidence: DAVEAskEvidence = {
  sourceType: 'document',
  recordId: 'drawing-1',
  summary: 'A101 proof',
  timelineEventId: null,
  excerpt: 'Provide guardrails.',
  documentCitation: {
    documentId: 'drawing-1',
    projectId: 'project-1',
    sourceSha256: SHA,
    evidenceVersion: 'ecos-hosted-evidence/1.3',
    documentName: 'A101',
    revision: '4',
    pageNumber: 1,
    sheetNumber: 'A101',
    regionId: 'note-1',
    label: 'A101, Rev 4',
  },
  documentRegion: {
    id: 'note-1',
    text: 'Provide guardrails.',
    source: 'ocr',
    x: 0.1,
    y: 0.1,
    width: 0.3,
    height: 0.05,
  },
};
const document: ReferenceDocument = {
  id: 'drawing-1',
  projectId: 'project-1',
  name: 'A101',
  originalFileName: 'A101.pdf',
  uri: 'file:///A101.pdf',
  mimeType: 'application/pdf',
  category: 'Drawing',
  notes: '',
  isCurrent: true,
  importedAt: '2026-08-09T00:00:00.000Z',
  drawingRevision: '4',
  contentSha256: SHA,
  indexedContentSha256: SHA,
  ecosVerifiedIndexCommitVersion: 'ecos-verified-index-commit/1.0',
  ecosVerifiedIndexCommittedSha256: SHA,
  ecosVerifiedIndexCommittedPageCount: 1,
  extractedPages: [{
    pageNumber: 1,
    sheetNumber: 'A101',
    assurance: {
      accepted: true,
      evidenceVersion: 'ecos-hosted-evidence/1.3',
      checks: { sheetMappingUsable: true },
      failureCodes: [],
    },
    regions: [{
      id: 'note-1',
      text: 'Provide guardrails.',
      source: 'ocr',
      x: 0.1,
      y: 0.1,
      width: 0.3,
      height: 0.05,
    }],
  }],
};
document.ecosVerifiedIndexPageGraphSha256 = computeECOSPageGraphSha256(
  document.extractedPages,
);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

describe('useECOSDocumentEvidence', () => {
  it('fails closed for native PDF raster proof while retaining the current citation', async () => {
    const { result } = renderHook(() => useECOSDocumentEvidence({
      documents: [document],
      ensureDocument: jest.fn(async (item: ReferenceDocument) => item),
      openDocument: jest.fn(async () => undefined),
    }));

    await act(async () => {
      await result.current.openEvidence(evidence);
    });

    expect(result.current.state?.document?.id).toBe('drawing-1');
    expect(result.current.state?.imageUri).toBeNull();
    expect(result.current.state?.error).toMatch(/protected desktop renderer/i);
  });

  it('does not treat a PDF URI as image proof when record metadata claims PNG', async () => {
    const confusedDocument: ReferenceDocument = {
      ...document,
      originalFileName: 'A101.png',
      uri: 'file:///A101.pdf?download=1',
      mimeType: 'image/png',
    };
    const { result } = renderHook(() => useECOSDocumentEvidence({
      documents: [confusedDocument],
      ensureDocument: jest.fn(async (item: ReferenceDocument) => item),
      openDocument: jest.fn(async () => undefined),
    }));

    await act(async () => {
      await result.current.openEvidence(evidence);
    });

    expect(result.current.state?.document?.id).toBe('drawing-1');
    expect(result.current.state?.imageUri).toBeNull();
    expect(result.current.state?.error).toMatch(/protected desktop renderer/i);
  });

  it('preserves exact current image proof on native', async () => {
    const imageDocument: ReferenceDocument = {
      ...document,
      originalFileName: 'A101.png',
      uri: 'file:///A101.png',
      mimeType: 'image/png',
    };
    const { result } = renderHook(() => useECOSDocumentEvidence({
      documents: [imageDocument],
      ensureDocument: jest.fn(async (item: ReferenceDocument) => item),
      openDocument: jest.fn(async () => undefined),
    }));

    await act(async () => {
      await result.current.openEvidence(evidence);
    });

    expect(result.current.state?.document?.id).toBe('drawing-1');
    expect(result.current.state?.imageUri).toBe('file:///A101.png');
    expect(result.current.state?.error).toBeNull();
  });

  it('clears an open verified proof when the exact document becomes noncurrent', async () => {
    type Props = { documents: readonly ReferenceDocument[] };
    const ensureDocument = jest.fn(async (item: ReferenceDocument) => item);
    const { result, rerender } = renderHook(
      ({ documents }: Props) => useECOSDocumentEvidence({
        documents,
        ensureDocument,
        openDocument: jest.fn(async () => undefined),
      }),
      { initialProps: { documents: [document] as readonly ReferenceDocument[] } },
    );

    await act(async () => {
      await result.current.openEvidence(evidence);
    });
    expect(result.current.state?.document?.id).toBe('drawing-1');

    rerender({ documents: [{ ...document, isCurrent: false }] });
    await waitFor(() => expect(result.current.state?.document).toBeNull());
    expect(result.current.state?.imageUri).toBeNull();
    expect(result.current.state?.error).toMatch(/no longer available/i);
  });

  it('does not let a stale ensure completion restore proof after the document disappears', async () => {
    type Props = { documents: readonly ReferenceDocument[] };
    const pending = deferred<ReferenceDocument>();
    const ensureDocument = jest.fn(() => pending.promise);
    const { result, rerender } = renderHook(
      ({ documents }: Props) => useECOSDocumentEvidence({
        documents,
        ensureDocument,
        openDocument: jest.fn(async () => undefined),
      }),
      { initialProps: { documents: [document] as readonly ReferenceDocument[] } },
    );

    let openPromise!: Promise<void>;
    act(() => {
      openPromise = result.current.openEvidence(evidence);
    });
    expect(result.current.state?.loading).toBe(true);

    rerender({ documents: [] });
    await waitFor(() => expect(result.current.state?.document).toBeNull());
    await act(async () => {
      pending.resolve(document);
      await openPromise;
    });
    expect(result.current.state?.document).toBeNull();
    expect(result.current.state?.imageUri).toBeNull();
  });

  it('rejects a readable document whose immutable source changed during preparation', async () => {
    const ensureDocument = jest.fn(async () => ({
      ...document,
      contentSha256: 'b'.repeat(64),
      indexedContentSha256: 'b'.repeat(64),
    }));
    const { result } = renderHook(() => useECOSDocumentEvidence({
      documents: [document],
      ensureDocument,
      openDocument: jest.fn(async () => undefined),
    }));

    await act(async () => {
      await result.current.openEvidence(evidence);
    });
    expect(result.current.state?.document).toBeNull();
    expect(result.current.state?.error).toMatch(/no longer available/i);
  });

  it('blocks an in-flight full-document open after the exact source becomes noncurrent', async () => {
    type Props = { documents: readonly ReferenceDocument[] };
    type AuthorityCheck = (candidate: ReferenceDocument) => boolean;
    const pendingShareBoundary = deferred<void>();
    const externalShare = jest.fn();
    const openDocument = jest.fn(async (
      item: ReferenceDocument,
      isAuthorityCurrent?: AuthorityCheck,
    ) => {
      await pendingShareBoundary.promise;
      if (!isAuthorityCurrent || isAuthorityCurrent(item)) {
        externalShare(item.uri);
      }
    });
    const { result, rerender } = renderHook(
      ({ documents }: Props) => useECOSDocumentEvidence({
        documents,
        ensureDocument: jest.fn(async (item: ReferenceDocument) => item),
        openDocument,
      }),
      { initialProps: { documents: [document] as readonly ReferenceDocument[] } },
    );

    await act(async () => {
      await result.current.openEvidence(evidence);
    });
    act(() => {
      result.current.openFullDocument();
    });
    const openPromise = openDocument.mock.results[0].value;

    rerender({ documents: [{ ...document, isCurrent: false }] });
    await waitFor(() => expect(result.current.state?.document).toBeNull());
    await act(async () => {
      pendingShareBoundary.resolve(undefined);
      await openPromise;
    });

    expect(externalShare).not.toHaveBeenCalled();
  });

  it('allows an in-flight full-document open across a notes-only update', async () => {
    type Props = { documents: readonly ReferenceDocument[] };
    type AuthorityCheck = (candidate: ReferenceDocument) => boolean;
    const pendingShareBoundary = deferred<void>();
    const externalShare = jest.fn();
    const openDocument = jest.fn(async (
      item: ReferenceDocument,
      isAuthorityCurrent?: AuthorityCheck,
    ) => {
      await pendingShareBoundary.promise;
      if (!isAuthorityCurrent || isAuthorityCurrent(item)) {
        externalShare(item.uri);
      }
    });
    const { result, rerender } = renderHook(
      ({ documents }: Props) => useECOSDocumentEvidence({
        documents,
        ensureDocument: jest.fn(async (item: ReferenceDocument) => item),
        openDocument,
      }),
      { initialProps: { documents: [document] as readonly ReferenceDocument[] } },
    );

    await act(async () => {
      await result.current.openEvidence(evidence);
    });
    act(() => {
      result.current.openFullDocument();
    });
    const openPromise = openDocument.mock.results[0].value;

    rerender({ documents: [{ ...document, notes: 'Reviewed by the PM.' }] });
    await act(async () => {
      pendingShareBoundary.resolve(undefined);
      await openPromise;
    });

    expect(externalShare).toHaveBeenCalledTimes(1);
    expect(externalShare).toHaveBeenCalledWith(document.uri);
  });
});
