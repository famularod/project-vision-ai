import type { ReferenceDocument, ScheduleItem } from '../../types';
import {
  bindScheduleImportBatch,
  scheduleImportDocumentOwnsItem,
  scheduleItemsForExactImportBatch,
} from '../../services/ScheduleImportProvenance';

function scheduleItem(id: string, importedFrom = 'schedule.pdf'): ScheduleItem {
  return {
    id,
    projectName: 'Project A',
    locationName: 'Canopy A',
    taskName: `Task ${id}`,
    startDate: '07/01/2026',
    finishDate: '07/20/2026',
    milestone: '',
    owner: 'PM',
    contractor: '',
    percentComplete: 0,
    priority: 'Medium',
    status: 'Not Started',
    notes: '',
    importedFrom,
    createdAt: '2026-07-18T00:00:00.000Z',
  };
}

function document(id: string, originalFileName = 'schedule.pdf'): ReferenceDocument {
  return {
    id,
    name: originalFileName.replace(/\.pdf$/i, ''),
    originalFileName,
    uri: `file:///owned/${id}.pdf`,
    category: 'Schedules',
    notes: '',
    isCurrent: true,
    importedAt: '2026-07-18T00:00:00.000Z',
  };
}

describe('immutable schedule import provenance', () => {
  it('keeps same-named uploads in independent batches and deletes only the selected batch', () => {
    const first = bindScheduleImportBatch({
      importBatchId: 'batch-one',
      items: [scheduleItem('first')],
      documents: [document('document-one')],
    });
    const second = bindScheduleImportBatch({
      importBatchId: 'batch-two',
      items: [scheduleItem('second')],
      documents: [document('document-two')],
    });

    const allItems = [...first.items, ...second.items];
    expect(scheduleItemsForExactImportBatch(allItems, first.documents[0]).map(item => item.id))
      .toEqual(['first']);
    expect(scheduleImportDocumentOwnsItem(first.documents[0], second.items[0])).toBe(false);
  });

  it('fails closed for legacy documents instead of deleting by a reused filename', () => {
    const current = bindScheduleImportBatch({
      importBatchId: 'batch-current',
      items: [scheduleItem('current')],
      documents: [document('current-document')],
    });
    const legacySameName = document('legacy-document');
    expect(scheduleItemsForExactImportBatch(current.items, legacySameName)).toEqual([]);
  });

  it('records a unique source document when a multi-document batch can identify it', () => {
    const bound = bindScheduleImportBatch({
      importBatchId: 'screenshots-batch',
      items: [scheduleItem('message-item', 'message-2.png')],
      documents: [
        document('message-1', 'message-1.png'),
        document('message-2', 'message-2.png'),
      ],
    });
    expect(bound.items[0].sourceDocumentId).toBe('message-2');
  });

  it('rejects an empty batch identity', () => {
    expect(() => bindScheduleImportBatch({
      importBatchId: '  ',
      items: [scheduleItem('item')],
      documents: [],
    })).toThrow('immutable batch ID');
  });
});
