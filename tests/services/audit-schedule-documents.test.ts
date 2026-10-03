import { recoverDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';
import {
  currentScheduleDocumentWinners,
  scheduleDocumentIsScheduleLike,
  selectAuthoritativeScheduleItems,
} from '../../services/PIEScheduleReconciliation';
import { narrowScheduleDocumentLabels, scheduleDocumentsAfterApproval } from '../../services/ScheduleDocumentLabels';
import { mergeApprovedScheduleImportItems } from '../../services/ScheduleImportMerge';
import { scheduleItemsOnlyInImportBatch } from '../../services/ScheduleImportProvenance';
import type { ReferenceDocument, ScheduleItem } from '../../types';

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const read = (relative: string) => fs.readFileSync(path.resolve(__dirname, '../..', relative), 'utf8');
const app = read('App.tsx');

const task = (extra: Partial<ScheduleItem>): ScheduleItem => ({
  id: 't', projectName: '2321', taskName: 'Task', locationName: '', owner: '', startDate: '09/01/2026',
  finishDate: '09/30/2026', milestone: '', status: 'Not Started', percentComplete: 0, notes: '', createdAt: '2026-09-01T00:00:00.000Z',
  ...extra,
} as ScheduleItem);
const doc = (extra: Partial<ReferenceDocument>): ReferenceDocument => ({
  id: 'd', name: 'Schedule', originalFileName: 'schedule.pdf', uri: '', category: 'Schedules', notes: '', isCurrent: true,
  importedAt: '2026-09-01T00:00:00.000Z', ...extra,
} as ReferenceDocument);
const visibleIds = (items: ScheduleItem[], documents: ReferenceDocument[]) =>
  selectAuthoritativeScheduleItems({ scheduleItems: items, scheduleDocuments: documents }).map(item => item.id).sort();

// Whole-app audit, schedule documents (30 Sep 2026): A5 pass 2 H2 and M3, A7 pass 3 H1; verified F1-F3.
describe('each project picks its own current schedule', () => {
  const master = doc({ id: 'master', projectNames: ['2321', '2375'], importBatchId: 'bm', importedAt: '2026-09-01T00:00:00.000Z' });
  const single = doc({ id: 's2321', projectNames: ['2321'], importBatchId: 'bs', importedAt: '2026-09-20T00:00:00.000Z' });
  const items = [
    task({ id: 'm-2321', projectName: '2321', importBatchId: 'bm' }),
    task({ id: 'm-2375', projectName: '2375', importBatchId: 'bm' }),
    task({ id: 's-2321', projectName: '2321', importBatchId: 'bs' }),
  ];

  it('a newer single-project schedule leaves a combined master current for the other project', () => {
    expect(currentScheduleDocumentWinners([master, single]).map(document => document.id).sort()).toEqual(['master', 's2321']);
    expect(visibleIds(items, [master, single])).toEqual(['m-2375', 's-2321']);
  });

  it('a drawing named "...Schedule" is not a schedule; a message screenshot is not either; an uncategorised lookahead still is', () => {
    const drawing = doc({ id: 'e601', name: 'E-601 Panel Schedule', category: 'Electrical', projectNames: ['2321'], importedAt: '2026-09-25T00:00:00.000Z' });
    expect(scheduleDocumentIsScheduleLike(drawing)).toBe(false);
    expect(visibleIds(items, [master, single, drawing])).toEqual(['m-2375', 's-2321']);
    const screenshot = doc({ id: 'msg', name: 'Schedule message - IMG_1', category: 'Other', isCurrent: false, notes: '[Schedule communication screenshot] Imported for local text recognition and schedule review.' });
    expect(scheduleDocumentIsScheduleLike(screenshot)).toBe(false);
    const fromScreenshot = task({ id: 'msg-task', taskName: 'Deliver panels', importBatchId: 'bmsg', sourceDocumentId: 'msg', importedFrom: 'IMG_1.png' });
    expect(visibleIds([...items, fromScreenshot], [master, single, screenshot])).toContain('msg-task');
    expect(scheduleDocumentIsScheduleLike(doc({ category: 'Other', name: '2321 3 WEEK LOOKAHEAD' }))).toBe(true);
  });
});

describe('a revision never takes over the tasks it did not change', () => {
  const v1 = doc({ id: 'v1', projectNames: ['2321'], importBatchId: 'b1', importedAt: '2026-09-01T00:00:00.000Z' });
  const v2 = doc({ id: 'v2', projectNames: ['2321'], importBatchId: 'b2', importedAt: '2026-09-20T00:00:00.000Z' });
  const existing = [
    task({ id: 'a', taskName: 'Pour footings', importBatchId: 'b1', sourceDocumentId: 'v1', percentComplete: 40, status: 'In Progress', progressSource: 'project_manager' }),
    task({ id: 'b', taskName: 'Set steel', importBatchId: 'b1', sourceDocumentId: 'v1' }),
    task({ id: 'c', taskName: 'Roof', importBatchId: 'b1', sourceDocumentId: 'v1', finishDate: '09/30/2026' }),
  ];
  const revision = [
    task({ id: 'a2', taskName: 'Pour footings', importBatchId: 'b2', sourceDocumentId: 'v2' }),
    task({ id: 'b2x', taskName: 'Set steel', importBatchId: 'b2', sourceDocumentId: 'v2' }),
    task({ id: 'c2', taskName: 'Roof', importBatchId: 'b2', sourceDocumentId: 'v2', finishDate: '10/15/2026' }),
  ];
  const merged = mergeApprovedScheduleImportItems({ existing, imported: revision, completionMatch: () => null, mergeCompletion: item => item });
  const all = [...merged.additions, ...merged.next];

  it('unchanged tasks keep their own import and also belong to the revision', () => {
    expect(merged.next.find(item => item.id === 'a')).toMatchObject({ importBatchId: 'b1', sourceDocumentId: 'v1', alsoImportedInBatchIds: ['b2'], percentComplete: 40 });
    expect(merged.additions.map(item => item.id)).toEqual(['c2']);
  });

  it('with the revision current the list is A, B and the rescheduled C; Set Active on the first brings back its C', () => {
    expect(visibleIds(all, [{ ...v1, isCurrent: false }, v2])).toEqual(['a', 'b', 'c2']);
    expect(visibleIds(all, [v1, { ...v2, isCurrent: false }])).toEqual(['a', 'b', 'c']);
  });

  it('"Delete PDF + Items" takes only the tasks no other schedule contains', () => {
    expect(scheduleItemsOnlyInImportBatch(all, v2, [v1, v2]).map(item => item.id)).toEqual(['c2']);
    expect(scheduleItemsOnlyInImportBatch(all, v1, [v1, v2]).map(item => item.id)).toEqual(['c']);
    // With the other schedule gone, the shared tasks go with the last one.
    expect(scheduleItemsOnlyInImportBatch(all, v2, [v2]).map(item => item.id).sort()).toEqual(['a', 'b', 'c2']);
  });

  it('a cloud copy without the new import keeps it after the merge of the two copies', () => {
    const local = { ...merged.next.find(item => item.id === 'a')!, updatedAt: '2026-09-20T00:00:00.000Z' };
    const cloud = { ...existing[0], updatedAt: '2026-09-21T00:00:00.000Z', notes: 'cloud note' };
    const [recovered] = recoverDAVEScheduleRecords({ local: [local], cloud: [cloud], allowCloudOnly: true });
    expect(recovered.alsoImportedInBatchIds).toEqual(['b2']);
  });
});

describe('a schedule document speaks for the projects its rows belong to', () => {
  const now = '2026-09-30T12:00:00.000Z';
  it('an approval labels this import’s document by its rows, demotes no other schedule and names no project id', () => {
    const other = doc({ id: 'other', projectNames: ['2375'], importBatchId: 'bo' });
    const incoming = doc({ id: 'new', projectNames: ['2321', '2375'], importBatchId: 'bn', projectId: 'project-2321' });
    const result = scheduleDocumentsAfterApproval({
      documents: [other],
      approvedDocuments: [incoming],
      approvedItems: [task({ projectName: '2321', importBatchId: 'bn' })],
      updatedAt: now,
    });
    expect(result.find(document => document.id === 'new')).toMatchObject({ projectNames: ['2321'], projectName: '2321', projectId: null });
    expect(result.find(document => document.id === 'other')).toBe(other);
  });

  it('a later Accept Selected widens the saved document to its own rows', () => {
    const saved = doc({ id: 'new', projectNames: ['2321'], importBatchId: 'bn' });
    const result = scheduleDocumentsAfterApproval({
      documents: [saved],
      approvedDocuments: [],
      approvedItems: [task({ projectName: '2375', importBatchId: 'bn' })],
      updatedAt: now,
    });
    expect(result[0]).toMatchObject({ projectNames: ['2321', '2375'], projectName: null });
  });

  it('a document saved with every project is narrowed to its rows; covered or empty ones are left alone', () => {
    const wide = doc({ id: 'wide', projectNames: ['2321', '2375'], importBatchId: 'bw' });
    const combined = doc({ id: 'combined', projectNames: ['2321', '2375'], importBatchId: 'bc' });
    const empty = doc({ id: 'empty', projectNames: ['2321', '2375'], importBatchId: 'be' });
    const items = [
      task({ id: 'w1', projectName: '2321', importBatchId: 'bw' }),
      task({ id: 'c1', projectName: '2321', importBatchId: 'bc' }),
      task({ id: 'c2', projectName: '2375', importBatchId: 'bc' }),
    ];
    const repair = narrowScheduleDocumentLabels([wide, combined, empty], items, now);
    expect(repair.changed.map(document => document.id)).toEqual(['wide']);
    expect(repair.documents[0]).toMatchObject({ projectNames: ['2321'], projectName: '2321', updatedAt: now });
    expect(repair.documents[1]).toBe(combined);
    expect(repair.documents[2]).toBe(empty);
  });
});

describe('wiring', () => {
  it('the phone and the web delete only the tasks no other schedule contains, and the phone says how many stay', () => {
    expect(app).toContain('? scheduleItemsOnlyInImportBatch(scheduleItems, document, referenceDocuments.filter(scheduleDocumentIsScheduleLike))');
    expect(app).toMatch(/items another schedule also contains stay/);
    expect(read('services/DAVEWebReadOnlyRepository.ts')).toContain('scheduleItemsOnlyInImportBatch(reconciledScheduleItems, document, reconciledDocuments.filter(scheduleDocumentIsScheduleLike))');
  });

  it('the approval labels documents through the service and the label repair runs on the saved documents', () => {
    expect(app).toMatch(/const labelledDocuments = scheduleDocumentsAfterApproval\(\{/);
    expect(app).not.toContain('const currentScheduleScope = new Set(');
    expect(app).toContain('const repair = narrowScheduleDocumentLabels(referenceDocuments, scheduleItems, new Date().toISOString());');
  });

  it('a web edit keeps the imports a task belongs to', () => {
    expect(read('services/DAVEWebTaskEditing.ts')).toContain('...(current?.alsoImportedInBatchIds?.length ? { alsoImportedInBatchIds: current.alsoImportedInBatchIds } : {}),');
  });
});
