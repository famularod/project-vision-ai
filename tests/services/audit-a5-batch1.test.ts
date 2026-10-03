import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { parseMonthNameDateParts, parsePlainDate, projectDateRelativeDays } from '../../services/ProjectDateTime';
import { formatAppDate, parseFlexibleDate } from '../../utils/date';
import { buildDAVEProjectScheduleRollup } from '../../services/dave-project-schedule-rollup';
import {
  currentScheduleDocumentWinners,
  reconcileCurrentScheduleDocuments,
  selectAuthoritativeScheduleItems,
} from '../../services/PIEScheduleReconciliation';
import { mergeApprovedScheduleImportItems } from '../../services/ScheduleImportMerge';
import type { ReferenceDocument, ScheduleItem } from '../../types';

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const read = (relative: string) => fs.readFileSync(path.resolve(__dirname, '../..', relative), 'utf8');
const app = read('App.tsx');

const task = (extra: Partial<ScheduleItem>): ScheduleItem => ({
  id: 't', projectName: 'Alpha', taskName: 'Pour footings', locationName: 'Lot', owner: '', startDate: '07/01/2026',
  finishDate: '07/10/2026', milestone: '', status: 'Not Started', percentComplete: 0, notes: '', createdAt: '2026-07-01T00:00:00.000Z',
  ...extra,
} as ScheduleItem);
const doc = (extra: Partial<ReferenceDocument>): ReferenceDocument => ({
  id: 'd', name: 'Schedule', originalFileName: 'schedule.pdf', uri: '', category: 'Schedules', notes: '', isCurrent: true,
  importedAt: '2026-07-10T12:00:00.000Z', ...extra,
} as ReferenceDocument);

// Whole-app audit A5 pass 1 (30 Sep 2026), highs 1 and 2.
describe('imported dates are stored in the form every reader parses, and rows stored the old way are read', () => {
  it('a CSV finish date is stored as MM/DD/YYYY and counts as overdue', () => {
    const result = normalizeScheduleImport({
      contents: 'Task,Project,Area,Start,Finish,Milestone,Owner,Status,Notes\r\nPour footings,Alpha,Lot,07/18/2026,07/24/2026,,,In Progress,',
      sourceName: 'schedule.csv', mimeType: 'text/csv', now: new Date('2026-07-18T12:00:00-07:00'),
    });
    expect(result.items[0]).toEqual(expect.objectContaining({ startDate: '07/18/2026', finishDate: '07/24/2026' }));
    expect(projectDateRelativeDays(result.items[0].finishDate, '2026-07-30T12:00:00-07:00')).toBe(-6);
  });

  it('"Jul 24, 2026" (how imports stored dates until now) is read by every parser and by the rollup', () => {
    expect(parseMonthNameDateParts('Jul 24, 2026')).toEqual({ year: 2026, month: 7, day: 24 });
    expect(parseMonthNameDateParts('July 24 2026')).toEqual({ year: 2026, month: 7, day: 24 });
    expect(parseMonthNameDateParts('24 Jul 2026')).toEqual({ year: 2026, month: 7, day: 24 });
    expect(parseMonthNameDateParts('Jul 32, 2026')).toBeNull();
    expect(parseMonthNameDateParts('Pour footings')).toBeNull();
    expect(parsePlainDate('Jul 24, 2026')).toBe('2026-07-24');
    expect(projectDateRelativeDays('Jul 24, 2026', '2026-07-30T12:00:00-07:00')).toBe(-6);
    expect(parseFlexibleDate('Jul 24, 2026')?.getDate()).toBe(24);
    expect(formatAppDate('Jul 24, 2026')).toBe('Jul 24, 2026');
    const rollup = buildDAVEProjectScheduleRollup({
      projectName: 'Alpha',
      items: [task({ finishDate: 'Jul 24, 2026', status: 'In Progress', percentComplete: 40 })],
      now: new Date('2026-07-30T12:00:00-07:00'),
    });
    expect(rollup.overdueCount).toBe(1);
    expect(rollup.undatedCount).toBe(0);
    // The App's own parser (used when a stored row is normalized) reads the form too.
    expect(app).toMatch(/const named = parseMonthNameDateParts\(trimmed\);\n\s+if \(named\) \{\n\s+const date = new Date\(named\.year, named\.month - 1, named\.day\);/);
  });
});

describe('one current schedule per project', () => {
  const alphaOld = doc({ id: 'alpha-old', projectNames: ['Alpha'], importedAt: '2026-07-01T12:00:00.000Z', importBatchId: 'b-alpha-old' });
  const alphaNew = doc({ id: 'alpha-new', projectNames: ['Alpha'], importedAt: '2026-07-10T12:00:00.000Z', importBatchId: 'b-alpha-new' });
  const beta = doc({ id: 'beta', projectNames: ['Beta'], importedAt: '2026-07-18T12:00:00.000Z', importBatchId: 'b-beta' });
  const combined = doc({ id: 'combined', projectNames: ['Alpha', 'Beta'], importedAt: '2026-07-20T12:00:00.000Z', importBatchId: 'b-combined' });

  it('a second project’s schedule does not hide the first project’s; the same project keeps its newest', () => {
    expect(currentScheduleDocumentWinners([alphaOld, alphaNew, beta]).map(document => document.id)).toEqual(['beta', 'alpha-new']);
    expect(reconcileCurrentScheduleDocuments([alphaOld, alphaNew, beta]).map(document => [document.id, document.isCurrent])).toEqual([
      ['alpha-old', false], ['alpha-new', true], ['beta', true],
    ]);
    const visible = selectAuthoritativeScheduleItems({
      scheduleItems: [
        task({ id: 'a-old', importBatchId: 'b-alpha-old', sourceDocumentId: 'alpha-old', importedFrom: 'schedule.pdf' }),
        task({ id: 'a-new', importBatchId: 'b-alpha-new', sourceDocumentId: 'alpha-new', importedFrom: 'schedule.pdf', taskName: 'Pour footings v2' }),
        task({ id: 'b-1', projectName: 'Beta', importBatchId: 'b-beta', sourceDocumentId: 'beta', importedFrom: 'schedule.pdf', taskName: 'Set steel' }),
      ],
      scheduleDocuments: [alphaOld, alphaNew, beta],
    }).map(item => item.id);
    expect(visible).toEqual(['a-new', 'b-1']);
    // A combined schedule for both projects supersedes each project's own.
    expect(currentScheduleDocumentWinners([alphaNew, beta, combined]).map(document => document.id)).toEqual(['combined']);
  });

  it('schedules with no project names still converge to one, as before', () => {
    const older = doc({ id: 'older', importedAt: '2026-07-10T12:00:00.000Z' });
    const newer = doc({ id: 'newer', importedAt: '2026-07-18T12:00:00.000Z' });
    expect(currentScheduleDocumentWinners([older, newer]).map(document => document.id)).toEqual(['newer']);
    expect(reconcileCurrentScheduleDocuments([older, newer, beta]).filter(document => document.isCurrent).map(document => document.id)).toEqual(['newer', 'beta']);
  });

  it('is what the App and the web view use', () => {
    // Set Active no longer flips flags on the phone: the cloud's activation
    // call chooses (audit A5 F4), and the refreshed list is reconciled per
    // project. The phone's own competing rule was removed with the flip.
    // Since audit A8 pass 2 #8 it asks first when the schedule has no imported
    // tasks; either way the cloud's activation, not a flag flip, decides.
    expect(app).toContain('async function setActiveScheduleDocument(documentId: string) {');
    expect(app).toContain('if (!warning) return markReferenceDocumentCurrent(documentId);');
    expect(app).toContain('const mergedDocuments = reconcileCurrentScheduleDocuments(');
    expect(read('services/DAVEWebOperations.ts')).toContain('currentSchedules.length > currentScheduleDocumentWinners(currentSchedules).length');
    expect(read('scripts/schedule-import-batch-test.js')).toContain("scheduleScreenSource.includes('sections={mobileTaskSections}')");
  });
});

describe('a revised import keeps the tasks and the manager’s progress', () => {
  const existing = [
    task({ id: 'pour', importBatchId: 'b1', sourceDocumentId: 'd1', importedFrom: 'v1.pdf', importedAt: '2026-07-01T00:00:00.000Z' }),
    task({
      id: 'bolts', taskName: 'Set anchor bolts', finishDate: '07/10/2026', importBatchId: 'b1', sourceDocumentId: 'd1', importedFrom: 'v1.pdf',
      status: 'In Progress', percentComplete: 60, progressSource: 'project_manager', progressConfirmedAt: '2026-07-05T00:00:00.000Z', progressConfirmedBy: 'PM',
    }),
    task({ id: 'manual', taskName: 'Order rebar', finishDate: '07/03/2026', importBatchId: null, sourceDocumentId: null }),
  ];
  const imported = [
    task({ id: 'pour-2', importBatchId: 'b2', sourceDocumentId: 'd2', importedFrom: 'v2.pdf', importedAt: '2026-07-08T00:00:00.000Z' }),
    task({ id: 'bolts-2', taskName: 'Set anchor bolts', finishDate: '07/17/2026', importBatchId: 'b2', sourceDocumentId: 'd2', importedFrom: 'v2.pdf' }),
    task({ id: 'manual-2', taskName: 'Order rebar', finishDate: '07/03/2026', importBatchId: 'b2', sourceDocumentId: 'd2', importedFrom: 'v2.pdf' }),
  ];
  const noClaims = { completionMatch: () => null, mergeCompletion: (item: ScheduleItem) => item };

  it('moves an unchanged task to the new import, carries confirmed progress onto a changed one, and leaves a manual task alone', () => {
    const merged = mergeApprovedScheduleImportItems({ existing, imported, ...noClaims });
    expect(merged.rehomedIds).toEqual(['pour']);
    // A5 pass 2: the unchanged task keeps its own import and also belongs to the revision.
    expect(merged.next.find(item => item.id === 'pour')).toEqual(expect.objectContaining({ importBatchId: 'b1', alsoImportedInBatchIds: ['b2'], percentComplete: 0 }));
    expect(merged.carriedProgressIds).toEqual(['bolts-2']);
    expect(merged.additions.map(item => item.id)).toEqual(['bolts-2']);
    expect(merged.additions[0]).toEqual(expect.objectContaining({
      finishDate: '07/17/2026', percentComplete: 60, status: 'In Progress', progressSource: 'project_manager', progressConfirmedBy: 'PM',
    }));
    // The manual duplicate is neither re-homed nor added again.
    expect(merged.next.find(item => item.id === 'manual')).toEqual(existing[2]);
    // With both documents current per project, the visible list is the re-homed task plus the carried one, none hidden.
    const d1 = doc({ id: 'd1', projectNames: ['Alpha'], importBatchId: 'b1', importedAt: '2026-07-01T00:00:00.000Z', isCurrent: false });
    const d2 = doc({ id: 'd2', projectNames: ['Alpha'], importBatchId: 'b2', importedAt: '2026-07-08T00:00:00.000Z' });
    const visible = selectAuthoritativeScheduleItems({ scheduleItems: [...merged.additions, ...merged.next], scheduleDocuments: [d1, d2] }).map(item => item.id).sort();
    expect(visible).toEqual(['bolts-2', 'manual', 'pour']);
  });

  it('a completion claim still merges into its task first; two candidate predecessors carry nothing', () => {
    const mergeCompletion = jest.fn((item: ScheduleItem) => ({ ...item, status: 'Complete' as const, percentComplete: 100 }));
    const merged = mergeApprovedScheduleImportItems({
      existing, imported: [imported[0]],
      completionMatch: (importedItem, items) => items.find(item => item.id === 'pour') ?? null,
      mergeCompletion,
    });
    expect(mergeCompletion).toHaveBeenCalledTimes(1);
    expect(merged.next.find(item => item.id === 'pour')?.status).toBe('Complete');
    expect(merged.additions).toEqual([]);
    const ambiguous = mergeApprovedScheduleImportItems({
      existing: [...existing, task({ ...existing[1], id: 'bolts-b', locationName: 'Lot', finishDate: '07/12/2026' })],
      imported: [imported[1]], ...noClaims,
    });
    expect(ambiguous.carriedProgressIds).toEqual([]);
    expect(ambiguous.additions[0].percentComplete).toBe(0);
  });

  it('is what the approval uses', () => {
    // A5 pass 3 F3: the approval also says which saved tasks the manager
    // sees, so a hidden older copy never makes a revised task ambiguous.
    expect(app).toMatch(/const merged = mergeApprovedScheduleImportItems\(\{\n\s+existing: scheduleItemsCurrentRef\.current as unknown as import\('\.\/types'\)\.ScheduleItem\[\],\n\s+imported: approvedItems as unknown as import\('\.\/types'\)\.ScheduleItem\[\],\n\s+completionMatch: findExactScheduleTaskForCompletionClaim,\n\s+isCurrent: scheduleItemsVisibleBeforeImport\(scheduleItemsCurrentRef\.current, referenceDocumentsCurrentRef\.current, approvedBatch\.id\),/);
    expect(app).toContain('synchronizedItems = reconcileDAVEScheduleRecords([...additions, ...next]);');
  });
});
