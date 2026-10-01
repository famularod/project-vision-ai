/**
 * Owner answer Q22 (David, 30 Sep 2026): "a shorter schedule should be made to
 * compliment the master long term schedule", clarified "merge into master".
 * A lookahead and the combined master both stay in effect for Alpha. A task in
 * both files shows once, with the lookahead's newer dates and progress; tasks
 * only in the lookahead are added; the master's other tasks, and Beta's, stay.
 * The task keeps one record (the master's), restated in place when the
 * lookahead is approved, so its progress survives either file's re-import and
 * deleting the lookahead gives it back its master dates. Synthetic data.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReferenceDocument, ScheduleItem } from '../../types';
import {
  currentScheduleDocumentsByProject,
  reconcileCurrentScheduleDocuments,
  scheduleDocumentAddsToMaster,
  scheduleDocumentCurrentLabel,
  scheduleDocumentIsCurrentEverywhere,
  scheduleProjectScopeKey,
  selectAuthoritativeScheduleItems,
} from '../../services/PIEScheduleReconciliation';
import {
  mergeApprovedScheduleImportItems,
  scheduleItemsVisibleBeforeImport,
} from '../../services/ScheduleImportMerge';
import {
  scheduleImportAddsToMaster,
  scheduleItemsAfterLookaheadDeleted,
  scheduleLookaheadDeleteNote,
  suggestScheduleImportRole,
  withScheduleImportRole,
} from '../../services/ScheduleLookahead';
import {
  activateSharedReferenceDocument,
  phoneScheduleCardIsCurrent,
  scheduleActivationEffects,
  scheduleDocumentsAfterActivation,
  scheduleRetirementMessage,
  scheduleTasksHiddenByActivation,
} from '../../services/SharedDocumentActivation';
import { scheduleItemsOnlyInImportBatch } from '../../services/ScheduleImportProvenance';
import { normalizeReferenceDocument } from '../../services/ReferenceDocumentRepository';
import { mergeDAVEReferenceDocumentRecoveryRecords } from '../../services/DAVECloudRecovery';
import { buildDAVEProjectTruth } from '../../services/DAVEProjectTruth';
import { loadDAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import { daveWebSupabaseGateway } from '../../services/DAVEWebSupabaseClient';
import { daveWebDocumentDeletionIsProtected, groupDAVEWebDocuments } from '../../services/DAVEWebDocumentManagement';
import { buildDAVEWebReportSource, buildDAVEWebTruthDiagnostics } from '../../services/DAVEWebOperations';
import { buildDAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';
import { bindPIEScheduleImportBatchProvenance, scheduleItemsForExactImportBatch, scheduleItemsOfUnbatchedDocument } from '../../services/PIEScheduleImportBatch';
import { scheduleDocumentsAfterApproval } from '../../services/ScheduleDocumentLabels';
import { reconcileDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';
import { dependencyChangesForDeletedTask } from '../../services/VitruviusScheduleEngine';
import { scheduleDocumentIsScheduleLike } from '../../services/PIEScheduleReconciliation';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
  getAllKeys: jest.fn(async () => []),
  multiGet: jest.fn(async () => []),
}));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));
jest.mock('../../services/DAVEWebSupabaseClient', () => ({
  daveWebSupabaseGateway: { loadAuthorizedRows: jest.fn() },
}));

const schedule = (id: string, projectNames: string[], importedAt: string, extra: Partial<ReferenceDocument> = {}) => ({
  id, name: id, originalFileName: `${id}.pdf`, uri: '', category: 'Schedules', notes: '', isCurrent: true,
  importedAt, projectId: null, projectName: projectNames.length === 1 ? projectNames[0] : null, projectNames,
  importBatchId: `batch-${id}`, cloudUpdatedAt: `rev-${id}`, updatedAt: importedAt, ...extra,
}) as ReferenceDocument;
const task = (id: string, projectName: string, taskName: string, source: ReferenceDocument, startDate: string, finishDate: string, extra: Partial<ScheduleItem> = {}) => ({
  id, projectName, taskName, locationName: 'Lot', owner: '', contractor: '', startDate, finishDate, milestone: '',
  status: 'Not Started', percentComplete: 0, priority: 'Medium', notes: '', createdAt: source.importedAt,
  importedAt: source.importedAt, sourceDocumentId: source.id, importBatchId: source.importBatchId, ...extra,
}) as ScheduleItem;

const APPROVED = '2026-09-20T12:00:00.000Z';
const master = schedule('MASTER UPDATE 8312026', ['Alpha', 'Beta'], '2026-08-31T12:00:00.000Z');
const masterItems = () => [
  task('m-pour', 'Alpha', 'Pour slab', master, '10/01/2026', '10/03/2026'),
  task('m-roof', 'Alpha', 'Roofing', master, '12/01/2026', '12/15/2026'),
  task('m-beta', 'Beta', 'Beta sitework', master, '10/01/2026', '10/30/2026'),
];
const lookahead = schedule('Alpha 3 Week Lookahead', ['Alpha'], APPROVED, { scheduleRole: 'lookahead' });
const lookaheadRows = (source = lookahead, pour: [string, string, number] = ['09/28/2026', '09/30/2026', 40]) => [
  task(`${source.id}-pour`, 'Alpha', 'Pour slab', source, pour[0], pour[1], { percentComplete: pour[2], status: pour[2] > 0 ? 'In Progress' : 'Not Started' }),
  task(`${source.id}-rebar`, 'Alpha', 'Rebar inspection', source, '09/25/2026', '09/25/2026'),
];

/** Approving a schedule as the phone does: paired with the tasks shown before it. */
function approve(items: ScheduleItem[], documents: ReferenceDocument[], source: ReferenceDocument, rows: ScheduleItem[], approvedAt = source.importedAt) {
  const withDocument = documents.some(document => document.id === source.id) ? documents : [...documents, source];
  const merged = mergeApprovedScheduleImportItems({
    existing: items,
    imported: rows,
    completionMatch: () => null,
    mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(items, withDocument, source.importBatchId || ''),
    overlay: scheduleImportAddsToMaster({ id: source.importBatchId || '', documents: [source] }, documents),
    approvedAt,
  });
  return { items: [...merged.additions, ...merged.next], documents: withDocument, merged };
}
const shown = (items: ScheduleItem[], documents: ReferenceDocument[]) =>
  selectAuthoritativeScheduleItems({ scheduleItems: items, scheduleDocuments: documents });
const view = (items: ScheduleItem[], documents: ReferenceDocument[]) => shown(items, documents)
  .map(item => `${item.id} ${item.taskName} ${item.startDate}-${item.finishDate} ${item.percentComplete}%`).sort();
const withLookahead = () => approve(masterItems(), [master], lookahead, lookaheadRows());

describe('a lookahead adds to the combined master for its weeks (owner answer Q22)', () => {
  it('a task in both files shows once, with the lookahead dates and progress; lookahead-only tasks are added; the rest stay', () => {
    const { items, documents, merged } = withLookahead();
    expect(merged.overlaidIds).toEqual(['m-pour']);
    expect(view(items, documents)).toEqual([
      'Alpha 3 Week Lookahead-rebar Rebar inspection 09/25/2026-09/25/2026 0%',
      'm-beta Beta sitework 10/01/2026-10/30/2026 0%',
      'm-pour Pour slab 09/28/2026-09/30/2026 40%',
      'm-roof Roofing 12/01/2026-12/15/2026 0%',
    ]);
    // One record for the task: the master's, which belongs to the lookahead too.
    expect(items.filter(item => item.taskName === 'Pour slab')).toHaveLength(1);
    expect(items.find(item => item.id === 'm-pour')).toMatchObject({
      alsoImportedInBatchIds: [lookahead.importBatchId],
      lookaheadOverlay: { masterStartDate: '10/01/2026', masterFinishDate: '10/03/2026', masterPercentComplete: 0,
        lookaheads: [{ batchId: lookahead.importBatchId, startDate: '09/28/2026', finishDate: '09/30/2026' }] },
    });
    // The master is not retired and stays the base for both projects.
    const current = currentScheduleDocumentsByProject(documents);
    expect(current.get(scheduleProjectScopeKey('Alpha'))?.id).toBe(master.id);
    expect(current.get(scheduleProjectScopeKey('Beta'))?.id).toBe(master.id);
    expect(reconcileCurrentScheduleDocuments(documents).map(document => [document.id, document.isCurrent]))
      .toEqual([[master.id, true], [lookahead.id, true]]);
  });

  it('the lookahead never lowers the manager\'s progress; a file\'s it replaces either way (A5 pass 4 rule)', () => {
    const managers = masterItems().map(item => item.id === 'm-pour'
      ? { ...item, percentComplete: 60, status: 'In Progress', progressSource: 'project_manager', progressConfirmedAt: '2026-09-10T00:00:00.000Z' } as ScheduleItem
      : item);
    const { items, documents } = approve(managers, [master], lookahead, lookaheadRows());
    expect(shown(items, documents).find(item => item.id === 'm-pour')).toMatchObject({ percentComplete: 60, startDate: '09/28/2026' });
  });

  it('labels: the master is the active schedule everywhere; the lookahead says it adds to the master and has nothing to make current', () => {
    const { documents } = withLookahead();
    expect(scheduleDocumentIsCurrentEverywhere(master, documents)).toBe(true);
    expect(scheduleDocumentCurrentLabel(master, 'Active schedule', documents)).toBe('Active schedule');
    expect(scheduleDocumentIsCurrentEverywhere(lookahead, documents)).toBe(true);
    expect(scheduleDocumentCurrentLabel(lookahead, 'Active schedule', documents)).toBe('Lookahead: adds to the master schedule for Alpha');
    // Even with its flag cleared by a master's activation.
    expect(scheduleDocumentIsCurrentEverywhere({ ...lookahead, isCurrent: false }, documents)).toBe(true);
    expect(phoneScheduleCardIsCurrent({ id: 'card', referenceDocumentId: lookahead.id }, 'Alpha', documents)).toBe(true);
  });
});

describe('progress on an overlaid task is saved once and survives re-importing either file', () => {
  const managerEdit = (items: ScheduleItem[]) => items.map(item => item.id === 'm-pour'
    ? { ...item, percentComplete: 70, status: 'In Progress', progressSource: 'project_manager', progressConfirmedBy: 'David', progressConfirmedAt: '2026-09-22T00:00:00.000Z', updatedAt: '2026-09-22T00:00:00.000Z' } as ScheduleItem
    : item);

  it('a revised lookahead restates the same record: its dates, not below the manager\'s 70%', () => {
    const first = withLookahead();
    const lookahead2 = schedule('Alpha 3 Week Lookahead rev 2', ['Alpha'], '2026-09-27T12:00:00.000Z', { scheduleRole: 'lookahead' });
    const { items, documents } = approve(managerEdit(first.items), first.documents, lookahead2,
      lookaheadRows(lookahead2, ['09/29/2026', '10/01/2026', 50]));
    const pour = shown(items, documents).filter(item => item.taskName === 'Pour slab');
    expect(pour).toHaveLength(1);
    expect(pour[0]).toMatchObject({ id: 'm-pour', startDate: '09/29/2026', finishDate: '10/01/2026', percentComplete: 70 });
    // The lookahead-only task is restated in place too, not added twice.
    expect(shown(items, documents).filter(item => item.taskName === 'Rebar inspection').map(item => item.id))
      .toEqual(['Alpha 3 Week Lookahead-rebar']);
  });

  it('a new master that did not change the task keeps the lookahead dates and the manager\'s progress on the same record', () => {
    const first = withLookahead();
    const master2 = schedule('MASTER UPDATE 9302026', ['Alpha', 'Beta'], '2026-09-30T12:00:00.000Z');
    const { items, documents } = approve(managerEdit(first.items), first.documents, master2, masterItems().map(item =>
      ({ ...item, id: `v2-${item.id}`, sourceDocumentId: master2.id, importBatchId: master2.importBatchId, importedAt: master2.importedAt })));
    expect(currentScheduleDocumentsByProject(documents).get(scheduleProjectScopeKey('Alpha'))?.id).toBe(master2.id);
    expect(view(items, documents)).toEqual([
      'Alpha 3 Week Lookahead-rebar Rebar inspection 09/25/2026-09/25/2026 0%',
      'm-beta Beta sitework 10/01/2026-10/30/2026 0%',
      'm-pour Pour slab 09/28/2026-09/30/2026 70%',
      'm-roof Roofing 12/01/2026-12/15/2026 0%',
    ]);
  });

  it('a new master repeating its old 0% does not undo the lookahead\'s 40%; one that states a new percent does', () => {
    const first = withLookahead();
    const master2 = schedule('MASTER UPDATE 9302026', ['Alpha', 'Beta'], '2026-09-30T12:00:00.000Z');
    const rows = (pourPercent: number) => masterItems().map(item =>
      ({ ...item, id: `v2-${item.id}`, sourceDocumentId: master2.id, importBatchId: master2.importBatchId, importedAt: master2.importedAt,
        ...(item.id === 'm-pour' ? { percentComplete: pourPercent, status: pourPercent > 0 ? 'In Progress' : 'Not Started' } : {}) }) as ScheduleItem);
    const repeated = approve(first.items, first.documents, master2, rows(0));
    expect(shown(repeated.items, repeated.documents).find(item => item.taskName === 'Pour slab')).toMatchObject({ id: 'm-pour', percentComplete: 40, startDate: '09/28/2026' });
    const updated = approve(first.items, first.documents, master2, rows(25));
    expect(shown(updated.items, updated.documents).find(item => item.taskName === 'Pour slab')).toMatchObject({ id: 'm-pour', percentComplete: 25, startDate: '09/28/2026' });
    // The master's 25% is now what it says: a later lookahead's 50% survives the next master repeating 25%.
    const lookahead2 = schedule('Alpha lookahead week 41', ['Alpha'], '2026-10-02T12:00:00.000Z', { scheduleRole: 'lookahead' });
    const later = approve(updated.items, updated.documents, lookahead2, lookaheadRows(lookahead2, ['09/28/2026', '09/30/2026', 50]));
    const master3 = schedule('MASTER UPDATE 10052026', ['Alpha', 'Beta'], '2026-10-05T12:00:00.000Z');
    const repeatedAgain = approve(later.items, later.documents, master3, rows(25).map(item =>
      ({ ...item, id: item.id.replace('v2-', 'v3-'), sourceDocumentId: master3.id, importBatchId: master3.importBatchId, importedAt: master3.importedAt })));
    expect(shown(repeatedAgain.items, repeatedAgain.documents).find(item => item.taskName === 'Pour slab')).toMatchObject({ id: 'm-pour', percentComplete: 50 });
  });

  it('a new master that moved the task is the newer file: its dates, the manager\'s progress carried, shown once', () => {
    const first = withLookahead();
    const master2 = schedule('MASTER UPDATE 9302026', ['Alpha', 'Beta'], '2026-09-30T12:00:00.000Z');
    const { items, documents } = approve(managerEdit(first.items), first.documents, master2, masterItems().map(item =>
      ({ ...item, id: `v2-${item.id}`, sourceDocumentId: master2.id, importBatchId: master2.importBatchId, importedAt: master2.importedAt,
        ...(item.id === 'm-pour' ? { startDate: '10/12/2026', finishDate: '10/14/2026' } : {}) })));
    const pour = shown(items, documents).filter(item => item.taskName === 'Pour slab');
    expect(pour).toHaveLength(1);
    expect(pour[0]).toMatchObject({ id: 'v2-m-pour', startDate: '10/12/2026', percentComplete: 70 });
  });
});

describe('deleting a lookahead removes only its added tasks and its overlay', () => {
  function deleteLookahead(items: ScheduleItem[], documents: ReferenceDocument[], document: ReferenceDocument) {
    const removed = new Set(scheduleItemsOnlyInImportBatch(items, document, documents).map(item => item.id));
    const restored = new Map(scheduleItemsAfterLookaheadDeleted(items.filter(item => !removed.has(item.id)), document, '2026-09-25T00:00:00.000Z')
      .map(item => [item.id, item]));
    return {
      items: items.filter(item => !removed.has(item.id)).map(item => restored.get(item.id) || item),
      documents: documents.filter(candidate => candidate.id !== document.id),
      removed: [...removed], restored: [...restored.keys()],
    };
  }

  it('the master\'s task comes back on its own dates; the lookahead-only task goes; the delete question says so', () => {
    const { items, documents } = withLookahead();
    // Pin updated (whole-app audit A5 pass 5 L1 + H1, 30 Sep 2026): the question counts only tasks that go back,
    // never calls them master tasks, and says progress goes back too: the lookahead's 40% goes with it.
    expect(scheduleLookaheadDeleteNote(items, lookahead)).toBe(
      ' Delete PDF + Items also puts back the earlier dates and progress of 1 task this lookahead changed.');
    const after = deleteLookahead(items, documents, lookahead);
    expect(after.removed).toEqual(['Alpha 3 Week Lookahead-rebar']);
    expect(after.restored).toEqual(['m-pour']);
    expect(view(after.items, after.documents)).toEqual([
      'm-beta Beta sitework 10/01/2026-10/30/2026 0%',
      'm-pour Pour slab 10/01/2026-10/03/2026 0%',
      'm-roof Roofing 12/01/2026-12/15/2026 0%',
    ]);
    expect(after.items.find(item => item.id === 'm-pour')).not.toHaveProperty('lookaheadOverlay');
    expect(scheduleLookaheadDeleteNote(items, master)).toBe('');
  });

  it('dates the manager changed after the lookahead are kept', () => {
    const { items, documents } = withLookahead();
    const edited = items.map(item => item.id === 'm-pour' ? { ...item, finishDate: '10/02/2026' } : item);
    const after = deleteLookahead(edited, documents, lookahead);
    expect(after.items.find(item => item.id === 'm-pour')).toMatchObject({ startDate: '09/28/2026', finishDate: '10/02/2026' });
  });

  it('two lookaheads: the newer overlays the older; deleting either leaves the right dates', () => {
    const first = withLookahead();
    const lookahead2 = schedule('Alpha lookahead week 40', ['Alpha'], '2026-09-27T12:00:00.000Z', { scheduleRole: 'lookahead' });
    const both = approve(first.items, first.documents, lookahead2, lookaheadRows(lookahead2, ['09/29/2026', '10/01/2026', 50]));
    expect(view(both.items, both.documents).filter(line => line.includes('Pour slab'))).toEqual(['m-pour Pour slab 09/29/2026-10/01/2026 50%']);
    // Deleting the newer goes back to the older lookahead's dates, and (pin updated, audit A5 pass 5 H1) its 40%.
    const withoutNewer = deleteLookahead(both.items, both.documents, lookahead2);
    expect(view(withoutNewer.items, withoutNewer.documents).filter(line => line.includes('Pour slab'))).toEqual(['m-pour Pour slab 09/28/2026-09/30/2026 40%']);
    // Deleting the older keeps the newer's dates, then deleting the newer gives the master's.
    const withoutOlder = deleteLookahead(both.items, both.documents, lookahead);
    expect(view(withoutOlder.items, withoutOlder.documents).filter(line => /Pour|Rebar/.test(line))).toEqual([
      'Alpha 3 Week Lookahead-rebar Rebar inspection 09/25/2026-09/25/2026 0%',
      'm-pour Pour slab 09/29/2026-10/01/2026 50%',
    ]);
    // Pin updated (audit A5 pass 5 H1): with neither lookahead, the master's dates and its 0%.
    const neither = deleteLookahead(withoutOlder.items, withoutOlder.documents, lookahead2);
    expect(view(neither.items, neither.documents).filter(line => /Pour|Rebar/.test(line))).toEqual(['m-pour Pour slab 10/01/2026-10/03/2026 0%']);
  });
});

describe('a copy left behind by a later import shows once, from the newest file', () => {
  it('an older master made current again shows the lookahead record the newer master had', () => {
    // Master v2 moved the task (new record v2-m-pour); the lookahead then restated v2-m-pour in place.
    const master2 = schedule('MASTER v2', ['Alpha', 'Beta'], '2026-09-10T12:00:00.000Z');
    const v1 = { ...master, isCurrent: false };
    const items = [
      ...masterItems(),
      task('v2-m-pour', 'Alpha', 'Pour slab', master2, '09/28/2026', '09/30/2026', { alsoImportedInBatchIds: [lookahead.importBatchId as string] }),
    ];
    const documents = [{ ...v1, isCurrent: true }, { ...master2, isCurrent: false }, lookahead];
    const pour = shown(items, documents).filter(item => item.taskName === 'Pour slab');
    expect(pour.map(item => item.id)).toEqual(['v2-m-pour']);
  });

  it('two same-named tasks in one file are left as two tasks (when unsure, do not merge)', () => {
    const items = [
      ...masterItems(),
      task('m-pour-2', 'Alpha', 'Pour slab', master, '11/01/2026', '11/03/2026'),
      task('la-pour', 'Alpha', 'Pour slab', lookahead, '09/28/2026', '09/30/2026'),
    ];
    expect(shown(items, [master, lookahead]).filter(item => item.taskName === 'Pour slab').map(item => item.id).sort())
      .toEqual(['la-pour', 'm-pour', 'm-pour-2']);
    // The import leaves them unpaired too: the lookahead row is added, the master's untouched.
    const { merged } = approve([...masterItems(), task('m-pour-2', 'Alpha', 'Pour slab', master, '11/01/2026', '11/03/2026')],
      [master], lookahead, lookaheadRows());
    expect(merged.overlaidIds).toEqual([]);
    expect(merged.additions.map(item => item.id).sort()).toEqual(['Alpha 3 Week Lookahead-pour', 'Alpha 3 Week Lookahead-rebar']);
  });

  it('a schedule imported before today, with no role, is a full schedule as before (A5 pass 4)', () => {
    const legacy = { ...lookahead, scheduleRole: undefined };
    expect(scheduleDocumentAddsToMaster(legacy)).toBe(false);
    expect(currentScheduleDocumentsByProject([master, legacy]).get(scheduleProjectScopeKey('Alpha'))?.id).toBe(legacy.id);
    expect(scheduleDocumentCurrentLabel(master, 'Active schedule', [master, legacy])).toBe('Active schedule for Beta');
  });
});

describe('Set Active and Make Current with a lookahead in effect, before and after the Q15 migration', () => {
  const cloud = () => withLookahead();
  const database = (scope: string) => ({ rpc: jest.fn(async () => ({ data: scope, error: null })) }) as unknown as SupabaseClient;

  it.each(['schedule', 'project', null] as const)('making the master current (scope %s) keeps the overlay; nothing is asked; nothing reads hidden', scope => {
    const { items, documents } = cloud();
    const before = view(items, documents);
    const after = scheduleDocumentsAfterActivation({ ...master, isCurrent: false }, documents.map(document =>
      document.id === master.id ? { ...document, isCurrent: false } : document), scope);
    // Before and after the migration the cloud clears the lookahead's flag; it is in effect by its role.
    expect(after.find(document => document.id === lookahead.id)?.isCurrent).toBe(scope === null);
    expect(view(items, after)).toEqual(before);
    expect(scheduleActivationEffects(master, documents, scope ?? 'schedule')).toEqual([]);
    expect(scheduleTasksHiddenByActivation(master, documents, items, scope)).toBeNull();
  });

  it.each(['schedule', 'project'] as const)('a combined lookahead the cloud retired for Alpha (scope %s) still adds to Alpha', scope => {
    const combined = schedule('Alpha+Beta lookahead', ['Alpha', 'Beta'], APPROVED, { scheduleRole: 'lookahead' });
    const { items, documents } = approve(masterItems(), [master], combined, lookaheadRows(combined));
    const alphaOnly = schedule('Alpha master', ['Alpha'], '2026-09-25T12:00:00.000Z');
    const after = scheduleDocumentsAfterActivation(alphaOnly, documents, scope);
    const retiredLookahead = after.find(document => document.id === combined.id)!;
    expect(scope === 'project' ? retiredLookahead.retiredForProjectNames : retiredLookahead.isCurrent).toEqual(scope === 'project' ? ['Alpha'] : false);
    expect(shown(items, after).filter(item => item.taskName === 'Rebar inspection').map(item => item.id)).toEqual([`${combined.id}-rebar`]);
    expect(scheduleDocumentCurrentLabel(retiredLookahead, 'Current', after)).toBe('Lookahead: adds to the master schedule for Alpha, Beta');
    // Project Truth for Alpha still cites it.
    const truthDocuments = buildDAVEProjectTruth({
      projectId: 'alpha', projectName: 'Alpha', updates: [], scheduleItems: shown(items, after), referenceDocuments: after,
      now: '2026-09-30T12:00:00.000Z',
    }).evidence.records.map(record => record.id).filter(id => id.startsWith('document:'));
    expect(truthDocuments).toContain(`document:${combined.id}`);
  });

  it('a task-less schedule made current counts only the master tasks the lookahead does not carry', () => {
    const { items, documents } = cloud();
    const pdf = schedule('Alpha schedule scan', ['Alpha'], '2026-09-26T12:00:00.000Z', { isCurrent: false, importBatchId: null });
    const hidden = scheduleTasksHiddenByActivation(pdf, [...documents, pdf], items, 'project');
    // Roofing only: Pour slab stays through the lookahead, Rebar inspection is the lookahead's own.
    expect(hidden).toEqual({ count: 1, scheduleName: master.name });
  });

  it.each(['schedule', 'project'])('the phone never sends a lookahead to the cloud\'s activation (scope %s)', async scope => {
    const { documents } = cloud();
    const activate = jest.fn();
    const fs = jest.requireActual('fs') as typeof import('fs');
    const path = jest.requireActual('path') as typeof import('path');
    const ts = jest.requireActual('typescript') as typeof import('typescript');
    const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');
    const start = app.indexOf('\n  async function activateReferenceDocument(') + 1;
    const end = app.indexOf('\n  function markReferenceDocumentCurrent(', start);
    const deps: Record<string, unknown> = {
      referenceDocumentsCurrentRef: { current: documents.map(document => document.id === lookahead.id ? { ...document, isCurrent: false } : document) },
      currentReferenceActivationIdsRef: { current: new Set<string>() },
      scheduleDocumentIsCurrentEverywhere, getSupabaseClient: () => database(scope),
      activateSharedReferenceDocument: (input: Parameters<typeof activateSharedReferenceDocument>[0]) => activateSharedReferenceDocument({ ...input, activate }),
      buildECOSDocumentReadiness: () => ({ canMakeCurrent: true, detail: '' }), canonicalReferenceCategory: () => 'schedule',
      scheduleRetirementMessage, Alert: { alert: jest.fn() },
    };
    const js = ts.transpileModule(`module.exports = ${app.slice(start, end).trim()}`, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const mod = { exports: {} as unknown };
    new Function('module', 'exports', ...Object.keys(deps), js)(mod, mod.exports, ...Object.values(deps));
    await expect((mod.exports as (id: string) => Promise<boolean>)(lookahead.id)).resolves.toBe(true);
    expect(activate).not.toHaveBeenCalled();
  });
});

describe('the role is kept by every device', () => {
  it('the phone\'s normalizer and the recovery merge keep scheduleRole', () => {
    expect(normalizeReferenceDocument(lookahead).scheduleRole).toBe('lookahead');
    expect('scheduleRole' in normalizeReferenceDocument(master)).toBe(false);
    expect('scheduleRole' in normalizeReferenceDocument({ ...master, scheduleRole: 'bogus' as never })).toBe(false);
    const merged = mergeDAVEReferenceDocumentRecoveryRecords({
      local: [{ ...lookahead, isCurrent: true }],
      cloud: [{ ...lookahead, isCurrent: false, updatedAt: '2026-09-21T00:00:00.000Z' }],
    });
    expect(merged[0]).toMatchObject({ scheduleRole: 'lookahead', isCurrent: false });
    expect(scheduleDocumentAddsToMaster(merged[0])).toBe(true);
  });

  it('a web task edit keeps the task\'s lookahead note', () => {
    const { items } = withLookahead();
    const pour = { ...items.find(item => item.id === 'm-pour')!, projectId: 'alpha', cloudUpdatedAt: 'rev' };
    const edited = buildDAVEWebScheduleItem({
      id: pour.id, current: pour, actor: 'David', now: '2026-09-23T00:00:00.000Z',
      draft: {
        itemType: 'Task', taskName: pour.taskName, projectName: 'Alpha', locationName: pour.locationName,
        startDate: pour.startDate, finishDate: pour.finishDate, milestone: '', owner: '', contractor: '',
        percentComplete: '55', priority: 'Medium', status: 'In Progress', notes: '', nextAction: '', activityMessage: '',
      },
    });
    expect(edited.lookaheadOverlay).toEqual(pour.lookaheadOverlay);
  });
});

describe('the web and the phone show the same merged schedule, as do reports and Project Truth', () => {
  const rows = (items: ScheduleItem[], documents: ReferenceDocument[]) => ({
    projects: [{ id: 'alpha', name: 'Alpha', archived: false }, { id: 'beta', name: 'Beta', archived: false }],
    scheduleItems: items.map(item => ({ id: item.id, updated_at: '2026-09-30T12:00:00.000Z', item_data: { ...item, projectId: item.projectName.toLowerCase() } })),
    projectUpdates: [],
    referenceDocuments: documents.map(document => ({ id: document.id, name: document.name, category: 'Schedules',
      updated_at: '2026-09-30T12:00:00.000Z', document_data: document })),
    syncTombstones: [],
  });

  it('same tasks, dates and progress on both; the lookahead is current and protected on the web; no conflict reported', async () => {
    const { items, documents } = withLookahead();
    // The cloud cleared the lookahead's flag (a master's activation): the web still shows it in effect.
    const cloudDocuments = documents.map(document => document.id === lookahead.id ? { ...document, isCurrent: false } : document);
    jest.mocked(daveWebSupabaseGateway.loadAuthorizedRows).mockResolvedValue(rows(items, cloudDocuments) as never);
    const snapshot = await loadDAVEWebReadOnlySnapshot();
    const line = (item: ScheduleItem) => `${item.id} ${item.startDate}-${item.finishDate} ${item.percentComplete}%`;
    expect(snapshot.scheduleItems.map(line).sort()).toEqual(shown(items, cloudDocuments).map(line).sort());
    const webLookahead = snapshot.referenceDocuments.find(document => document.id === lookahead.id)!;
    expect(groupDAVEWebDocuments(snapshot.referenceDocuments).currentSchedule.map(document => document.id).sort())
      .toEqual([lookahead.id, master.id].sort());
    expect(daveWebDocumentDeletionIsProtected(webLookahead)).toBe(true);
    expect(scheduleDocumentIsCurrentEverywhere(webLookahead, snapshot.referenceDocuments)).toBe(true);
    expect(buildDAVEWebTruthDiagnostics(snapshot).conflicts).toEqual([]);
    // With the lookahead's flag set, as an approval leaves it, it is still not a second current schedule.
    jest.mocked(daveWebSupabaseGateway.loadAuthorizedRows).mockResolvedValueOnce(rows(items, documents) as never);
    expect(buildDAVEWebTruthDiagnostics(await loadDAVEWebReadOnlySnapshot()).conflicts).toEqual([]);

    // Reports and Project Truth read the merged view: Pour slab once, on the lookahead's dates.
    expect(buildDAVEWebReportSource(snapshot, 'Alpha').taskIds).toEqual(['Alpha 3 Week Lookahead-rebar', 'm-pour', 'm-roof']);
    const truth = buildDAVEProjectTruth({
      projectId: 'alpha', projectName: 'Alpha', updates: [], scheduleItems: shown(items, documents),
      referenceDocuments: cloudDocuments, now: '2026-09-30T12:00:00.000Z',
    });
    expect(truth.schedule.filter(entry => entry.taskName === 'Pour slab').map(entry => [entry.taskId, entry.startDate, entry.percentComplete]))
      .toEqual([['m-pour', expect.stringMatching(/2026-09-28|09\/28\/2026|Sep 28, 2026/), 40]]);
    expect(truth.evidence.records.map(record => record.id).filter(id => id.startsWith('document:')).sort())
      .toEqual([`document:${lookahead.id}`, `document:${master.id}`].sort());
  });

  it('the phone passes the merged view to its reports and Project Truth', () => {
    const app = (jest.requireActual('fs') as typeof import('fs')).readFileSync(
      (jest.requireActual('path') as typeof import('path')).resolve(__dirname, '../../App.tsx'), 'utf8');
    expect(app).toContain('scheduleItems: authoritativeScheduleItems, knownScheduleItems: scheduleItems');
    expect(app).toContain('scheduleItems={authoritativeScheduleItems}');
  });
});

describe('the import review default (owner answer Q22)', () => {
  const batch = (name: string, rows: ScheduleItem[]) => ({
    documents: [schedule(name, ['Alpha'], APPROVED)],
    items: rows,
  });
  const saved = { documents: [master], scheduleItems: masterItems() };

  it('a file named as a lookahead, for a project with a master, defaults to Lookahead', () => {
    expect(suggestScheduleImportRole({ batch: batch('Alpha 3 Week Lookahead', lookaheadRows()), ...saved }))
      .toEqual({ role: 'lookahead', reason: 'its name says “3 Week”' });
    expect(suggestScheduleImportRole({ batch: batch('Alpha Look-Ahead', lookaheadRows()), ...saved }).role).toBe('lookahead');
  });

  it('a file covering a few weeks where the master covers months defaults to Lookahead', () => {
    expect(suggestScheduleImportRole({ batch: batch('Alpha field plan', lookaheadRows()), ...saved })).toEqual({
      role: 'lookahead', reason: 'its dates cover 6 days and the master for Alpha covers 11 weeks',
    });
  });

  it('a file as long as the master, or a project with no master yet, defaults to Full schedule', () => {
    expect(suggestScheduleImportRole({ batch: batch('Alpha revised', masterItems().filter(item => item.projectName === 'Alpha')), ...saved }))
      .toEqual({ role: 'master', reason: 'its dates cover 11 weeks and the master for Alpha covers 11 weeks' });
    expect(suggestScheduleImportRole({ batch: batch('Alpha 3 Week Lookahead', lookaheadRows()), documents: [], scheduleItems: [] }))
      .toEqual({ role: 'master', reason: 'there is no master schedule for Alpha yet' });
  });

  it('David\'s choice is stored on the schedule file only, and an Accept Selected later reads it from the saved file', () => {
    const chosen = withScheduleImportRole({ id: 'b', documents: [lookahead, { ...master, id: 'shot', category: 'Other' }] }, 'master');
    expect(chosen.documents.map(document => document.scheduleRole)).toEqual(['master', undefined]);
    expect(scheduleImportAddsToMaster({ id: lookahead.importBatchId as string, documents: [] }, [lookahead])).toBe(true);
    expect(scheduleImportAddsToMaster({ id: master.importBatchId as string, documents: [] }, [lookahead, master])).toBe(false);
  });
});

describe('App.tsx, compiled: approving a lookahead and deleting it (owner answer Q22)', () => {
  const fs = jest.requireActual('fs') as typeof import('fs');
  const path = jest.requireActual('path') as typeof import('path');
  const ts = jest.requireActual('typescript') as typeof import('typescript');
  const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');
  /** A function of the App component (two-space indent), brace-matched. */
  function componentFunction(name: string): string {
    const match = new RegExp(`\\n  (?:async )?function ${name}\\(`).exec(app);
    if (!match) throw new Error(`App.tsx has no component function ${name}`);
    const open = app.indexOf(' {\n', match.index) + 1;
    let depth = 0;
    for (let index = open; index < app.length; index += 1) {
      if (app[index] === '{') depth += 1;
      if (app[index] === '}') {
        depth -= 1;
        if (depth === 0) return app.slice(match.index + 3, index + 1);
      }
    }
    throw new Error('unbalanced function');
  }
  function compile<T>(names: string[], deps: Record<string, unknown>): T {
    const js = ts.transpileModule([...names.map(componentFunction), `module.exports = { ${names.join(', ')} };`].join('\n'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const mod = { exports: {} as T };
    new Function('module', 'exports', ...Object.keys(deps), js)(mod, mod.exports, ...Object.values(deps));
    return mod.exports;
  }
  const noop = () => undefined;

  it('approving the reviewed lookahead restates the master task in place and syncs that one record with the role', async () => {
    const scheduleItemsCurrentRef = { current: masterItems() };
    const referenceDocumentsCurrentRef = { current: [master] };
    const cloudSync = jest.fn(async (_input: { scheduleItems: ScheduleItem[]; referenceDocuments: ReferenceDocument[] }) => ({
      durablyQueued: true, fullySynced: true, supersededScheduleItemIds: [], supersededReferenceDocumentIds: [], uploadedReferenceDocuments: [],
    }));
    const { approveScheduleImport } = compile<{ approveScheduleImport: (batch: unknown) => Promise<void> }>(['approveScheduleImport'], {
      archivedProjectsCurrentRef: { current: [] }, deletedProjectNamesRef: { current: [] },
      projectsCurrentRef: { current: ['Alpha', 'Beta'] }, projectRecordsCurrentRef: { current: [] },
      authorityProjectId: (name: string) => name.toLowerCase(),
      validateScheduleImportScope: ({ items }: { items: unknown[] }) => ({ items, warnings: [] }),
      projectAreasForProject: () => [], projectAreasCurrentRef: { current: [] }, savedUpdatesRef: { current: [] },
      scheduleImportApprovalBlocker: () => null, ScheduleImportReviewError: Error,
      bindPIEScheduleImportBatchProvenance, canonicalizeScheduleIdentityItems: (items: unknown[]) => items,
      normalizeScheduleItem: (item: unknown) => item, identityCorrections: [], daveRegisteredIdentityNames: () => [],
      ensureScheduleParentProjects: noop, mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport, scheduleImportAddsToMaster,
      findExactScheduleTaskForCompletionClaim: () => null, mergeReportedCompletionClaim: (item: unknown) => item,
      reconcileDAVEScheduleRecords, scheduleDocumentsAfterApproval, normalizeReferenceDocument: (value: unknown) => value,
      runScheduleImportCloudSync: cloudSync, markScheduleItemsAuthorityReady: noop, markReferenceDocumentsAuthorityReady: noop,
      setScheduleItems: noop, setReferenceDocuments: noop, scheduleItemsCurrentRef, referenceDocumentsCurrentRef,
      projectScheduleImportCardRef: { current: null }, markProjectScheduleCardCurrent: noop, Alert: { alert: jest.fn() },
    });
    const reviewed = withScheduleImportRole({
      id: lookahead.importBatchId, kind: 'schedule_file', sourceCount: 1, sourceLabel: lookahead.originalFileName, message: '',
      documents: [{ ...lookahead, scheduleRole: undefined }],
      items: lookaheadRows().map(row => ({ ...row, importBatchId: undefined, sourceDocumentId: undefined })),
    }, 'lookahead');
    await approveScheduleImport(reviewed);
    const documents = referenceDocumentsCurrentRef.current;
    expect(view(scheduleItemsCurrentRef.current, documents)).toEqual([
      'Alpha 3 Week Lookahead-rebar Rebar inspection 09/25/2026-09/25/2026 0%',
      'm-beta Beta sitework 10/01/2026-10/30/2026 0%',
      'm-pour Pour slab 09/28/2026-09/30/2026 40%',
      'm-roof Roofing 12/01/2026-12/15/2026 0%',
    ]);
    const synced = cloudSync.mock.calls[0][0];
    expect(synced.scheduleItems.map(item => item.id).sort()).toEqual(['Alpha 3 Week Lookahead-rebar', 'm-pour']);
    expect(synced.referenceDocuments.map(document => [document.id, document.scheduleRole])).toEqual([[lookahead.id, 'lookahead']]);
  });

  it('Delete PDF + Items on the lookahead puts the master task back on its dates, saved on every device', async () => {
    const { items, documents } = withLookahead();
    const scheduleItemsCurrentRef = { current: items };
    const synced: ScheduleItem[] = [];
    let alert: { message: string; buttons: Array<{ text: string; onPress?: () => void }> } = { message: '', buttons: [] };
    const { deleteScheduleDocument } = compile<{ deleteScheduleDocument: (id: string) => void }>(['dropDeletedPredecessors', 'deleteScheduleDocument'], {
      referenceDocuments: documents, scheduleItems: items, scheduleItemsCurrentRef, referenceDocumentsCurrentRef: { current: documents },
      scheduleItemsOnlyInImportBatch, scheduleItemsForExactImportBatch, scheduleItemsOfUnbatchedDocument, scheduleDocumentIsScheduleLike,
      dependencyChangesForDeletedTask, scheduleItemsAfterLookaheadDeleted, scheduleLookaheadDeleteNote,
      syncScheduleItemRevision: (item: ScheduleItem) => { synced.push(item); },
      Alert: { alert: (_title: string, message: string, buttons: typeof alert.buttons) => { alert = { message, buttons }; } },
      recordDAVESyncTombstones: async (list: unknown[]) => list, advanceScheduleItemSyncGeneration: () => 1,
      cancelScheduleItemTextSync: noop, rememberOperationalTombstones: noop, markReferenceDocumentsAuthorityReady: noop,
      markScheduleItemsAuthorityReady: noop, setReferenceDocuments: noop, setScheduleItems: noop,
      removeOperationalRecordFromSyncQueue: async () => undefined, clearScheduleItemSyncConflicts: async () => undefined,
      deleteStoredReferenceDocument: async () => undefined, removeReferenceDocumentEverywhere: async () => undefined,
      scheduleItemSyncWarningsRef: { current: new Set<string>() }, updateScheduleItem: noop,
    });
    deleteScheduleDocument(lookahead.id);
    // Pin updated (whole-app audit A5 pass 5 L1 + H1, 30 Sep 2026): the count and words of the question, and the 40% goes back to 0%.
    expect(alert.message).toContain('Delete PDF + Items also puts back the earlier dates and progress of 1 task this lookahead changed.');
    alert.buttons.find(button => button.text === 'Delete PDF + Items')?.onPress?.();
    await new Promise(resolve => setImmediate(resolve));
    expect(view(scheduleItemsCurrentRef.current, [master])).toEqual([
      'm-beta Beta sitework 10/01/2026-10/30/2026 0%',
      'm-pour Pour slab 10/01/2026-10/03/2026 0%',
      'm-roof Roofing 12/01/2026-12/15/2026 0%',
    ]);
    expect(synced.map(item => [item.id, item.startDate, item.finishDate, item.percentComplete])).toEqual([['m-pour', '10/01/2026', '10/03/2026', 0]]);
  });

  it('the delete question leaves out a task the delete removes (whole-app audit A5 pass 5 L1)', () => {
    // The master was deleted with "Delete PDF Only": Pour slab is now only in the lookahead, so Delete PDF + Items removes it.
    const { items, documents } = withLookahead();
    const withoutMaster = documents.filter(document => document.id !== master.id);
    const messages: string[] = [];
    const { deleteScheduleDocument } = compile<{ deleteScheduleDocument: (id: string) => void }>(['deleteScheduleDocument'], {
      referenceDocuments: withoutMaster, scheduleItems: items,
      scheduleItemsOnlyInImportBatch, scheduleItemsForExactImportBatch, scheduleItemsOfUnbatchedDocument, scheduleDocumentIsScheduleLike,
      scheduleLookaheadDeleteNote, Alert: { alert: (_title: string, message: string) => { messages.push(message); } },
    });
    deleteScheduleDocument(lookahead.id);
    expect(messages).toEqual(['Alpha 3 Week Lookahead will be removed. You can also remove the 2 schedule items only this PDF contains so outdated dates do not confuse Upcoming.']);
  });

  it('the phone labels a lookahead by its role in Schedule Sources', () => {
    expect(app).toContain("document.isCurrent || scheduleDocumentAddsToMaster(document) ? scheduleDocumentCurrentLabel(document, 'Active schedule', scheduleDocuments) : 'Inactive'");
  });
});
