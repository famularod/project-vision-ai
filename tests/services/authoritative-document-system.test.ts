import type { ReferenceDocument } from '../../types';
import {
  markAuthoritativeDocumentCurrent,
  selectAutomaticDrawingExcerpt,
} from '../../services/AuthoritativeDocumentSystem';

function document(
  id: string,
  partial: Partial<ReferenceDocument> = {},
): ReferenceDocument {
  return {
    id,
    name: id,
    originalFileName: `${id}.pdf`,
    uri: '',
    category: 'Drawing',
    notes: '',
    isCurrent: false,
    importedAt: '2026-07-30T00:00:00.000Z',
    ...partial,
  };
}

describe('authoritative document system', () => {
  it('supersedes only the same project, category, and revision family', () => {
    const result = markAuthoritativeDocumentCurrent([
      document('old-a', {
        isCurrent: true,
        projectName: 'Project A',
        drawingNumber: 'A-101',
      }),
      document('new-a', {
        projectName: 'Project A',
        drawingNumber: 'A-101',
      }),
      document('other-sheet', {
        isCurrent: true,
        projectName: 'Project A',
        drawingNumber: 'A-201',
      }),
      document('other-project', {
        isCurrent: true,
        projectName: 'Project B',
        drawingNumber: 'A-101',
      }),
    ], 'new-a', '2026-07-30T01:00:00.000Z');

    expect(result.documents.map(item => [item.id, item.isCurrent])).toEqual([
      ['old-a', false],
      ['new-a', true],
      ['other-sheet', true],
      ['other-project', true],
    ]);
    expect(result.changedDocumentIds.sort()).toEqual(['new-a', 'old-a']);
  });

  it('returns an exact current drawing excerpt and otherwise omits it', () => {
    const current = document('drawing', {
      isCurrent: true,
      projectName: 'Project A',
      drawingNumber: 'A-101',
      drawingRevision: '2',
      extractedPages: [{
        pageNumber: 3,
        sheetNumber: 'A-101',
        regions: [{
          id: 'north-lot',
          label: 'North Lot',
          areaNames: ['North Lot'],
          x: 0.1,
          y: 0.2,
          width: 0.4,
          height: 0.3,
          confidence: 0.94,
        }],
      }],
    });
    expect(selectAutomaticDrawingExcerpt({
      documents: [current],
      projectName: 'Project A',
      areaName: 'North Lot',
    })?.citation.label).toBe('drawing · Rev 2 · Sheet A-101');
    expect(selectAutomaticDrawingExcerpt({
      documents: [current],
      projectName: 'Project A',
      areaName: 'South Lot',
    })).toBeNull();
  });
});
