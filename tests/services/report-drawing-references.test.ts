import { buildAutomaticReportDrawingReferences } from '../../services/ReportDrawingReferences';
import type { ReferenceDocument, ScheduleItem } from '../../types';

function task(projectName: string, areaName: string): ScheduleItem {
  return {
    id: `${projectName}:${areaName}`,
    taskName: 'Install work',
    projectName,
    scheduleProjectName: projectName,
    locationName: areaName,
    status: 'In Progress',
    percentComplete: 20,
    priority: 'Medium',
    notes: '',
  } as ScheduleItem;
}

function drawing(current: boolean, confidence: number): ReferenceDocument {
  return {
    id: current ? 'current' : 'old',
    name: 'A-101 Floor Plan',
    originalFileName: 'A-101.pdf',
    uri: 'file:///drawing.pdf',
    category: 'Drawing',
    notes: '',
    isCurrent: current,
    importedAt: '2026-07-30T12:00:00.000Z',
    projectName: '2321 Compliance Project',
    drawingNumber: 'A-101',
    drawingRevision: current ? '2' : '1',
    drawingStatus: current ? 'For Construction' : 'Superseded',
    extractionStatus: 'complete',
    extractedPages: [{
      pageNumber: 1,
      sheetNumber: 'A-101',
      regions: [{
        id: 'north-lot',
        label: '2321 North Lot',
        areaNames: ['2321 North Lot'],
        x: 0.1,
        y: 0.2,
        width: 0.4,
        height: 0.3,
        confidence,
      }],
    }],
  };
}

describe('automatic report drawing references', () => {
  it('uses only a current, exact, high-confidence area match', () => {
    const result = buildAutomaticReportDrawingReferences({
      documents: [drawing(false, 0.99), drawing(true, 0.94)],
      scheduleItems: [task('2321 Compliance Project', '2321 North Lot')],
      selectedProjectNames: ['2321 Compliance Project'],
    });

    expect(result).toHaveLength(1);
    expect(result[0].citation.documentId).toBe('current');
    expect(result[0].citation.label).toBe('A-101 Floor Plan · Rev 2 · Sheet A-101');
  });

  it('omits an excerpt when confidence is too low or the area does not match', () => {
    expect(buildAutomaticReportDrawingReferences({
      documents: [drawing(true, 0.6)],
      scheduleItems: [
        task('2321 Compliance Project', '2321 North Lot'),
        task('2321 Compliance Project', 'South Lot'),
      ],
      selectedProjectNames: ['2321 Compliance Project'],
    })).toEqual([]);
  });
});
