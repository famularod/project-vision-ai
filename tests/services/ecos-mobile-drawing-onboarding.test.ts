import {
  createECOSMobileDrawingControls,
  mobileDrawingMetadataForUpload,
  validateECOSMobileDrawingControls,
} from '../../services/ECOSMobileDrawingOnboarding';
import { markAuthoritativeDocumentCurrent } from '../../services/AuthoritativeDocumentSystem';
import type { ReferenceDocument } from '../../types';

describe('ECOS mobile drawing onboarding', () => {
  it('requires sheet identity and rejects an invalid issue date', () => {
    expect(validateECOSMobileDrawingControls(
      createECOSMobileDrawingControls(),
    )).toMatchObject({
      valid: false,
      missingFields: ['drawing number', 'revision'],
    });

    expect(validateECOSMobileDrawingControls({
      ...createECOSMobileDrawingControls(),
      drawingNumber: 'A2.01',
      drawingRevision: '3',
      drawingIssuedAt: '2026-02-30',
    })).toMatchObject({ valid: false, invalidFields: ['issue date'] });
  });

  it('trims drawing controls and joins a replacement to its existing version family', () => {
    const metadata = mobileDrawingMetadataForUpload({
      ...createECOSMobileDrawingControls(),
      drawingNumber: ' A2.01 ',
      drawingRevision: ' 4 ',
      drawingDiscipline: ' Architectural ',
      drawingStatus: 'For Construction',
      drawingIssuedAt: '2026-08-09',
      replacementDocumentId: 'current-revision',
    }, {
      id: 'current-revision',
      webVersionGroupId: 'drawing-family-a2.01',
      drawingNumber: 'A2.01',
    });

    expect(metadata).toEqual({
      drawingNumber: 'A2.01',
      drawingRevision: '4',
      drawingDiscipline: 'Architectural',
      drawingStatus: 'For Construction',
      drawingIssuedAt: '2026-08-09',
      webVersionGroupId: 'drawing-family-a2.01',
    });
  });

  it('uses a legacy current drawing number as the shared version family', () => {
    expect(mobileDrawingMetadataForUpload({
      ...createECOSMobileDrawingControls(),
      drawingNumber: 'C6',
      drawingRevision: '2',
    }, {
      id: 'current-c6',
      webVersionGroupId: null,
      drawingNumber: 'C6',
    }).webVersionGroupId).toBe('c6');
  });

  it('lets Make Current replace the prior revision in the same drawing family only', () => {
    const base: Omit<ReferenceDocument, 'id' | 'name' | 'originalFileName' | 'isCurrent'> = {
      uri: '',
      category: 'Drawing',
      notes: '',
      importedAt: '2026-08-09T08:00:00.000Z',
      projectName: '2375 Compliance Project',
      drawingStatus: 'For Construction',
    };
    const prior: ReferenceDocument = {
      ...base,
      id: 'c6-r1',
      name: 'C6 Rev 1',
      originalFileName: 'C6-r1.pdf',
      isCurrent: true,
      drawingNumber: 'C6',
      drawingRevision: '1',
    };
    const next: ReferenceDocument = {
      ...base,
      id: 'c6-r2',
      name: 'C6 Rev 2',
      originalFileName: 'C6-r2.pdf',
      isCurrent: false,
      drawingNumber: 'C6',
      drawingRevision: '2',
      webVersionGroupId: mobileDrawingMetadataForUpload({
        ...createECOSMobileDrawingControls(),
        drawingNumber: 'C6',
        drawingRevision: '2',
      }, prior).webVersionGroupId,
    };

    const result = markAuthoritativeDocumentCurrent([prior, next], next.id);

    expect(result.documents.find(document => document.id === prior.id)?.isCurrent).toBe(false);
    expect(result.documents.find(document => document.id === next.id)?.isCurrent).toBe(true);
  });
});
