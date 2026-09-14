import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { DesktopDocumentProofPreview } from '../../components/web-shell/desktop-document-proof-preview';
import type { ECOSDesktopDocumentProofFocus } from '../../services/ECOSDesktopProofNavigation';
import type { DAVEWebReferenceDocument } from '../../services/DAVEWebReadOnlyRepository';
import { renderECOSWebProtectedPageProofPreview } from '../../services/ECOSWebDocumentProofPreview';
import { ECOSDocumentProofAuthorityError } from '../../services/ECOSDocumentProofAuthority';

jest.mock('../../services/ECOSWebDocumentProofPreview', () => ({
  renderECOSWebDocumentProofPreview: jest.fn(async () => ({
    dataUrl: 'data:image/png;base64,proof',
    width: 600,
    height: 400,
  })),
  renderECOSWebProtectedPageProofPreview: jest.fn(async () => ({
    dataUrl: 'data:image/png;base64,cropped-proof',
    width: 600,
    height: 400,
  })),
}));

const DOCUMENT_ID = 'web-document-edb4a270-4a4e-463f-90fc-e378dd23dd3c';
const PROJECT_ID = '72e941d8-8114-4082-a976-ae5b2b5daba9';
const SOURCE_SHA = 'eef6c5b751dd6d235f174370c1ab34bdb4126a92378bdee16d69d19482b45a01';
const REGION_ID = 'structured-table-fact:relationship:24bf97ccee6a45baca12ec44';
const EVIDENCE_VERSION = 'ecos-hosted-evidence/1.3';
const BOUNDS = Object.freeze({ x: 0.608889, y: 0.172222, width: 0.085, height: 0.009167 });

const focus: ECOSDesktopDocumentProofFocus = Object.freeze({
  documentId: DOCUMENT_ID,
  projectId: PROJECT_ID,
  sourceSha256: SOURCE_SHA,
  evidenceVersion: EVIDENCE_VERSION,
  revision: '1',
  pageNumber: 6,
  sheetNumber: 'C6',
  regionId: REGION_ID,
  bounds: BOUNDS,
});

const compactDocument = {
  id: DOCUMENT_ID,
  name: '02A - PLZ CORP - 2375 THIRD STREET - CIVIL',
  originalFileName: '02A - PLZ CORP - 2375 THIRD STREET - CIVIL.pdf',
  uri: '',
  mimeType: 'application/pdf',
  category: 'Drawing' as const,
  notes: '',
  isCurrent: true,
  importedAt: '2026-08-01T00:00:00.000Z',
  projectId: PROJECT_ID,
  projectName: '2375 Compliance Project',
  contentSha256: SOURCE_SHA,
  webFileFingerprint: SOURCE_SHA,
  indexedContentSha256: SOURCE_SHA,
  drawingRevision: '1',
  ecosVerifiedIndexCommitVersion: 'ecos-verified-index-commit/1.0',
  ecosVerifiedIndexCommittedSha256: SOURCE_SHA,
  ecosVerifiedIndexCommittedPageCount: 8,
  sourcePageCount: 8,
  extractedPages: [],
  cloudUpdatedAt: null,
  linkedScheduleItems: [],
} as DAVEWebReferenceDocument;

const proofDocument = {
  ...compactDocument,
  ecosHostedIndexEvidenceVersion: EVIDENCE_VERSION,
  extractedPages: [{
    pageNumber: 6,
    sheetNumber: 'C6',
    sheetMappingStatus: 'verified' as const,
    assurance: { accepted: true, evidenceVersion: EVIDENCE_VERSION, failureCodes: [] },
    regions: [{ id: REGION_ID, ...BOUNDS, source: null }],
  }],
};

describe('DesktopDocumentProofPreview customer path', () => {
  it('loads bounded proof authority before declaring a compact current document unavailable', async () => {
    const loadProofDocument = jest.fn(async () => ({
      document: proofDocument,
      protectedPage: {
        dataUrl: 'data:image/png;base64,protected-page',
        width: 4898,
        height: 3265,
        sha256: 'f'.repeat(64),
      },
    }));
    const getArtifactUrl = jest.fn(async () => 'https://signed.example/civil.pdf');
    const view = render(
      <DesktopDocumentProofPreview
        document={compactDocument}
        focus={focus}
        projectIdentities={[{ id: PROJECT_ID, name: '2375 Compliance Project' }]}
        loadProofDocument={loadProofDocument}
        getArtifactUrl={getArtifactUrl}
      />,
    );

    expect(view.getByText('Verifying the exact cited proof…')).toBeTruthy();
    await waitFor(() => {
      expect(view.getByText('Matched to the exact region in the current authorized index.')).toBeTruthy();
    });
    expect(loadProofDocument).toHaveBeenCalledWith(compactDocument, focus);
    expect(getArtifactUrl).not.toHaveBeenCalled();
    expect(renderECOSWebProtectedPageProofPreview).toHaveBeenCalledWith({
      dataUrl: 'data:image/png;base64,protected-page',
      bounds: BOUNDS,
    });
    expect(view.queryByText('ASK ECOS PROOF UNAVAILABLE')).toBeNull();
    fireEvent.press(view.getByText('View full cited page'));
    expect(view.getByLabelText('Full verified drawing page 6').props.source.uri)
      .toBe('data:image/png;base64,protected-page');
    fireEvent.press(view.getByText('Original resolution'));
    expect(view.getByLabelText('Full verified drawing page 6').props.style.width).toBe(4898);
    expect(getArtifactUrl).not.toHaveBeenCalled();
    expect(loadProofDocument).toHaveBeenCalledTimes(1);
    fireEvent.press(view.getByText('Close full page'));
    expect(view.queryByLabelText('Full verified drawing page 6')).toBeNull();
    fireEvent.press(view.getByText('View full cited page'));
    view.rerender(
      <DesktopDocumentProofPreview
        document={compactDocument}
        focus={null}
        projectIdentities={[{ id: PROJECT_ID, name: '2375 Compliance Project' }]}
        loadProofDocument={loadProofDocument}
        getArtifactUrl={getArtifactUrl}
      />,
    );
    expect(view.queryByLabelText('Full verified drawing page 6')).toBeNull();
  });

  it('does not tell the user the document changed when the proof service is missing', async () => {
    const view = render(
      <DesktopDocumentProofPreview
        document={compactDocument}
        focus={focus}
        projectIdentities={[{ id: PROJECT_ID, name: '2375 Compliance Project' }]}
        loadProofDocument={jest.fn(async () => {
          throw new ECOSDocumentProofAuthorityError('proof_service_unavailable');
        })}
        getArtifactUrl={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(view.getByText('The protected proof service is unavailable.')).toBeTruthy();
    });
    expect(view.getByText(
      'The protected proof service is temporarily unavailable. The project document was not reported as changed.',
    )).toBeTruthy();
    expect(view.queryByText('The cited source no longer matches this document.')).toBeNull();
    expect(view.queryByText('View full cited page')).toBeNull();
  });
});
