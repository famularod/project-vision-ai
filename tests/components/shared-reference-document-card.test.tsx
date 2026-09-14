import { fireEvent, render } from '@testing-library/react-native';
import { SharedReferenceDocumentCard } from '../../components/shared-reference-document-card';
import type { ReferenceDocument } from '../../types';

const document: ReferenceDocument = {
  id: 'C', name: 'Canopy C', originalFileName: 'C.pdf', uri: '', category: 'Drawing', notes: '',
  isCurrent: false, importedAt: '2026-09-14', ecosHostedIndexStatus: 'Prepared',
  sourceProvider: 'google_drive', externalSource: { provider: 'google_drive', fileId: 'exact-canopy-C',
    name: 'C.pdf', mimeType: 'application/pdf', sizeBytes: 100, modifiedTime: null,
    revisionId: null, md5Checksum: null, resourceKey: null, webViewLink: null },
};
it('opens the exact shared record without offering attachment or activation mutations', () => {
  const open = jest.fn();
  const screen = render(<SharedReferenceDocumentCard document={document} onOpen={open} />);
  fireEvent.press(screen.getByRole('button', { name: 'Open original Canopy C' }));
  expect(open).toHaveBeenCalledWith(document);
  expect(screen.queryByText('Edit')).toBeNull();
  expect(screen.queryByText('Delete')).toBeNull();
  expect(screen.queryByText('Retry Upload')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Make Current for ECOS' })).toBeNull();
});
it('explains a missing original and does not expose an unusable open action', () => {
  const screen = render(<SharedReferenceDocumentCard document={{ ...document, sourceProvider: null, externalSource: null }} onOpen={jest.fn()} />);
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.getByText(/original file is unavailable/)).toBeTruthy();
});
