import { fireEvent, render } from '@testing-library/react-native';
import { ECOSDocumentEvidenceSheet } from '../../components/ECOSDocumentEvidenceSheet';
import type { ReferenceDocument } from '../../types';

const document: ReferenceDocument = {
  id: 'web-document-edb4a270-4a4e-463f-90fc-e378dd23dd3c',
  name: 'Civil drawing',
  originalFileName: 'civil.pdf',
  uri: '',
  mimeType: 'application/pdf',
  category: 'Drawing',
  notes: '',
  isCurrent: true,
  importedAt: '2026-08-01T00:00:00.000Z',
};

const common = {
  visible: true,
  evidence: null,
  imageUri: 'data:image/png;base64,protected',
  imageWidth: 100,
  imageHeight: 100,
  imageBounds: null,
  binding: {
    exact: true,
    reason: 'exact_hosted_region' as const,
    proofMode: 'hosted_cited_region' as const,
    message: 'Verified',
  },
  loading: false,
  error: null,
  onClose: jest.fn(),
};

describe('ECOS document evidence full-source action', () => {
  it('does not offer an action that cannot open a protected-crop-only source', () => {
    const onOpenDocument = jest.fn();
    const view = render(
      <ECOSDocumentEvidenceSheet
        {...common}
        document={document}
        onOpenDocument={onOpenDocument}
      />,
    );

    expect(view.queryByText('Open Full Document')).toBeNull();
    expect(view.getByText(/original full document is not available/i)).toBeTruthy();
    expect(onOpenDocument).not.toHaveBeenCalled();
  });

  it('offers the honest Google Drive action when the provider identity is available', () => {
    const onOpenDocument = jest.fn();
    const view = render(
      <ECOSDocumentEvidenceSheet
        {...common}
        document={{
          ...document,
          sourceProvider: 'google_drive',
          externalSource: {
            provider: 'google_drive',
            fileId: '1Mv0xM7w2FR87nDvpLmaOSvIvag4csKQD',
            name: 'civil.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 4_576_508,
            modifiedTime: null,
            revisionId: null,
            md5Checksum: null,
            resourceKey: null,
            webViewLink: null,
          },
        }}
        onOpenDocument={onOpenDocument}
      />,
    );

    fireEvent.press(view.getByText('Open in Google Drive'));
    expect(onOpenDocument).toHaveBeenCalledTimes(1);
  });
});
