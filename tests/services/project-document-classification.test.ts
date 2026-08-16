import {
  PROJECT_DOCUMENT_CATEGORIES,
  suggestProjectDocumentCategory,
} from '../../services/ProjectDocumentClassification';

describe('project document classification', () => {
  it('offers the complete PM-facing category list', () => {
    expect(PROJECT_DOCUMENT_CATEGORIES).toContain('Schedule');
    expect(PROJECT_DOCUMENT_CATEGORIES).toContain('Permit Card');
    expect(PROJECT_DOCUMENT_CATEGORIES).toContain('RFI / Field Decision');
    expect(PROJECT_DOCUMENT_CATEGORIES).toContain('Other');
  });

  it('preselects an obvious document type while preserving user choice', () => {
    expect(suggestProjectDocumentCategory({
      name: 'PLZ master schedule 3-week lookahead.pdf',
      mimeType: 'application/pdf',
    })).toBe('Schedule');
    expect(suggestProjectDocumentCategory({
      name: 'Canopy C site plan.pdf',
      mimeType: 'application/pdf',
    })).toBe('Drawing');
    expect(suggestProjectDocumentCategory({
      name: 'field-photo.jpg',
      mimeType: 'image/jpeg',
    })).toBe('Other');
  });
});
