jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///documents/',
  getInfoAsync: jest.fn(),
  makeDirectoryAsync: jest.fn(),
  deleteAsync: jest.fn(),
}));
jest.mock('../../services/SupabaseService', () => ({ uploadPhoto: jest.fn() }));

import {
  googleDriveReferenceDocumentUrl,
  referenceDocumentOpenMode,
} from '../../services/ReferenceDocumentOpenAccess';
import { normalizeReferenceDocument } from '../../services/ReferenceDocumentRepository';
import type { ReferenceDocument } from '../../types';

const baseDocument: ReferenceDocument = {
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

describe('reference document open access', () => {
  it('retains a valid Drive identity during mobile normalization and builds only the canonical Drive URL', () => {
    const normalized = normalizeReferenceDocument({
      ...baseDocument,
      sourceProvider: 'google_drive',
      externalSource: {
        provider: 'google_drive',
        fileId: '1Mv0xM7w2FR87nDvpLmaOSvIvag4csKQD',
        name: 'civil.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 4_576_508,
        modifiedTime: '2026-03-04T16:33:52.000Z',
        revisionId: 'revision-1',
        md5Checksum: null,
        resourceKey: null,
        webViewLink: 'https://attacker.invalid/not-trusted',
      },
    });

    expect(referenceDocumentOpenMode(normalized)).toBe('google_drive');
    expect(googleDriveReferenceDocumentUrl(normalized)).toBe(
      'https://drive.google.com/file/d/1Mv0xM7w2FR87nDvpLmaOSvIvag4csKQD/view',
    );
  });

  it('does not offer a full-document action for a protected crop without recoverable source bytes', () => {
    expect(referenceDocumentOpenMode(baseDocument)).toBe('unavailable');
  });

  it('rejects a malformed Drive identity instead of opening its persisted URL', () => {
    const document = {
      ...baseDocument,
      sourceProvider: 'google_drive' as const,
      externalSource: {
        provider: 'google_drive' as const,
        fileId: '../../escape',
        name: 'civil.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1,
        modifiedTime: null,
        revisionId: null,
        md5Checksum: null,
        resourceKey: null,
        webViewLink: 'https://attacker.invalid/not-trusted',
      },
    };
    expect(referenceDocumentOpenMode(document)).toBe('unavailable');
    expect(googleDriveReferenceDocumentUrl(document)).toBeNull();
  });
});
