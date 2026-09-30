import type { SupabaseClient } from '@supabase/supabase-js';
import {
  currentScheduleDocumentsByProject,
  scheduleDocumentCurrentLabel,
  scheduleDocumentIsCurrentEverywhere,
  scheduleProjectScopeKey,
  selectAuthoritativeScheduleItems,
} from '../../services/PIEScheduleReconciliation';
import {
  activateSharedReferenceDocument,
  scheduleActivationEffects,
  scheduleDocumentsAfterActivation,
  scheduleRetirementMessage,
  scheduleTasksHiddenByActivation,
} from '../../services/SharedDocumentActivation';
import type { ReferenceDocument, ScheduleItem } from '../../types';

// Whole-app audit A5 pass 4 (30 Sep 2026): which schedule is current when a
// combined master and a partial schedule (a lookahead) cover the same project.
// Synthetic data.

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

const schedule = (id: string, projectNames: string[], extra: Partial<ReferenceDocument> = {}) => ({
  id, name: id, originalFileName: `${id}.pdf`, uri: '', category: 'Schedules', notes: '', isCurrent: true,
  importedAt: '2026-08-31T12:00:00.000Z', projectId: null, projectName: projectNames.length === 1 ? projectNames[0] : null,
  projectNames, importBatchId: `batch-${id}`, cloudUpdatedAt: `rev-${id}`, ...extra,
}) as ReferenceDocument;
const task = (id: string, projectName: string, source: ReferenceDocument) => ({
  id, projectName, taskName: `Task ${id}`, locationName: 'Lot', owner: '', contractor: '', startDate: '09/21/2026',
  finishDate: '09/25/2026', milestone: '', status: 'Not Started', percentComplete: 0, priority: 'Medium', notes: '',
  createdAt: '2026-08-31T00:00:00.000Z', sourceDocumentId: source.id, importBatchId: source.importBatchId,
}) as ScheduleItem;
const shownIds = (items: ScheduleItem[], documents: ReferenceDocument[]) =>
  selectAuthoritativeScheduleItems({ scheduleItems: items, scheduleDocuments: documents }).map(item => item.id).sort();

describe('a newer lookahead no longer strands the combined master (A5 pass 4 #2)', () => {
  const master = schedule('MASTER UPDATE 8312026', ['Alpha', 'Beta']);
  const lookahead = schedule('Alpha 3-week lookahead', ['Alpha'], { importedAt: '2026-09-20T12:00:00.000Z' });
  const documents = [master, lookahead];
  const items = [
    task('master-alpha-in-window', 'Alpha', master),
    task('master-alpha-later', 'Alpha', master),
    task('master-beta', 'Beta', master),
    task('lookahead-alpha', 'Alpha', lookahead),
  ];

  it('the master is current for Beta only: labelled so, and Set Active / Make Current is offered', () => {
    expect(currentScheduleDocumentsByProject(documents).get(scheduleProjectScopeKey('Alpha'))?.id).toBe(lookahead.id);
    expect(shownIds(items, documents)).toEqual(['lookahead-alpha', 'master-beta']);
    // The master alone looks current everywhere; with the schedules it is not.
    expect(scheduleDocumentIsCurrentEverywhere(master)).toBe(true);
    expect(scheduleDocumentIsCurrentEverywhere(master, documents)).toBe(false);
    expect(scheduleDocumentCurrentLabel(master, 'Active schedule', documents)).toBe('Active schedule for Beta');
    // The lookahead is what Alpha shows.
    expect(scheduleDocumentIsCurrentEverywhere(lookahead, documents)).toBe(true);
    expect(scheduleDocumentCurrentLabel(lookahead, 'Current', documents)).toBe('Current');
    // A drawing is unaffected by schedules.
    expect(scheduleDocumentIsCurrentEverywhere({ ...lookahead, id: 'E-601', category: 'Drawing' }, documents)).toBe(true);
  });

  it('making the master current again, as the cloud does it, brings back every Alpha task and asks nothing', () => {
    // ecos_activate_current_reference_document on an already-current master retires the lookahead.
    const after = scheduleDocumentsAfterActivation(master, documents, 'project');
    expect(after.map(document => [document.id, document.isCurrent])).toEqual([[master.id, true], [lookahead.id, false]]);
    expect(shownIds(items, after)).toEqual(['master-alpha-in-window', 'master-alpha-later', 'master-beta']);
    expect(scheduleActivationEffects(master, documents, 'project')).toEqual([]);
    expect(scheduleTasksHiddenByActivation(master, documents, items, 'project')).toBeNull();
  });

  it('App.tsx activateReferenceDocument, compiled, goes to the cloud for the master', async () => {
    const fs = jest.requireActual('fs') as typeof import('fs');
    const path = jest.requireActual('path') as typeof import('path');
    const ts = jest.requireActual('typescript') as typeof import('typescript');
    const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');
    const start = app.indexOf('\n  async function activateReferenceDocument(') + 1;
    const end = app.indexOf('\n  function markReferenceDocumentCurrent(', start);
    const cloudAfter = scheduleDocumentsAfterActivation(master, documents, 'project');
    const activate = jest.fn(async () => ({ status: 'activated' as const, documentId: master.id, updatedAt: 'later', changedCount: 1, message: null }));
    const referenceDocumentsCurrentRef = { current: documents };
    const deps: Record<string, unknown> = {
      referenceDocumentsCurrentRef, currentReferenceActivationIdsRef: { current: new Set<string>() },
      buildECOSDocumentReadiness: () => ({ canMakeCurrent: true, detail: '' }), canonicalReferenceCategory: () => 'schedule',
      activateSharedReferenceDocument: (input: Parameters<typeof activateSharedReferenceDocument>[0]) => activateSharedReferenceDocument({ ...input, activate }),
      scheduleRetirementMessage, scheduleDocumentIsCurrentEverywhere,
      getSupabaseClient: () => ({ rpc: jest.fn(async () => ({ data: 'project', error: null })) }) as unknown as SupabaseClient,
      projectDocumentSharedRecordSync: { flush: () => false },
      listReferenceDocuments: jest.fn().mockResolvedValueOnce({ ok: true, stubbed: false, data: documents })
        .mockResolvedValue({ ok: true, stubbed: false, data: cloudAfter }),
      normalizeReferenceDocuments: (rows: unknown) => rows,
      deletedDAVERecordIds: () => [], operationalSyncTombstonesRef: { current: [] },
      mergeDAVEReferenceDocumentRecoveryRecords: ({ cloud }: { cloud: ReferenceDocument[] }) => cloud,
      reconcileCurrentScheduleDocuments: (next: ReferenceDocument[]) => next,
      markReferenceDocumentsAuthorityReady: jest.fn(), setReferenceDocuments: jest.fn(),
      scheduleProgressCarriedOnActivation: () => [], scheduleItemsCurrentRef: { current: items },
      Alert: { alert: jest.fn() },
    };
    const js = ts.transpileModule(`module.exports = ${app.slice(start, end).trim()}`, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const mod = { exports: {} as unknown };
    new Function('module', 'exports', ...Object.keys(deps), js)(mod, mod.exports, ...Object.values(deps));
    await expect((mod.exports as (documentId: string) => Promise<boolean>)(master.id)).resolves.toBe(true);
    expect(activate).toHaveBeenCalledWith({ client: expect.anything(), documentId: master.id, expectedUpdatedAt: master.cloudUpdatedAt });
    expect(shownIds(items, referenceDocumentsCurrentRef.current)).toEqual(['master-alpha-in-window', 'master-alpha-later', 'master-beta']);
  });

  it('the phone list passes every schedule to the label and the Set Active button', () => {
    const app = (jest.requireActual('fs') as typeof import('fs')).readFileSync(
      (jest.requireActual('path') as typeof import('path')).resolve(__dirname, '../../App.tsx'), 'utf8');
    expect(app).toContain("scheduleDocumentCurrentLabel(document, 'Active schedule', scheduleDocuments)");
    expect(app).toContain('!isScreenshot && !scheduleDocumentIsCurrentEverywhere(document, scheduleDocuments)');
    expect(app).toContain('scheduleDocumentIsCurrentEverywhere(target, referenceDocumentsCurrentRef.current)');
  });
});

describe('the Set Active question names a project that shows the combined schedule through the fallback (A5 pass 4 #4)', () => {
  // Alpha's own schedule was made current (Q15) and later deleted: Alpha shows the master's tasks again.
  const master = schedule('Master', ['Alpha', 'Beta'], { retiredForProjectNames: ['Alpha'] });
  const betaOwn = schedule('Beta rev 2', ['Beta'], { isCurrent: false, importedAt: '2026-09-25T12:00:00.000Z' });
  const items = [task('m-a', 'Alpha', master), task('m-b', 'Beta', master), task('b-2', 'Beta', betaOwn)];

  it.each(['project', 'schedule'] as const)('making Beta’s own schedule current asks about Alpha (%s)', scope => {
    expect(currentScheduleDocumentsByProject([master, betaOwn]).get(scheduleProjectScopeKey('Alpha'))).toBeUndefined();
    expect(shownIds(items, [master, betaOwn])).toEqual(['m-a', 'm-b']);
    const after = scheduleDocumentsAfterActivation(betaOwn, [master, betaOwn], scope);
    // The cloud retires the master for Beta too, so Alpha loses its tasks.
    expect(shownIds(items, after)).toEqual(['b-2']);
    expect(scheduleActivationEffects(betaOwn, [master, betaOwn], scope)).toEqual([{ projectName: 'Alpha', fallbackSchedule: null }]);
  });

  it('a project with its own current schedule is still left out', () => {
    const alphaOwn = schedule('Alpha rev 2', ['Alpha'], { importedAt: '2026-09-01T12:00:00.000Z' });
    expect(scheduleActivationEffects(betaOwn, [master, alphaOwn, betaOwn], 'project')).toEqual([]);
  });
});

describe('Make Current on a phone schedule not shared yet, with the cloud’s rule unknown (A5 pass 4 #5)', () => {
  const master = schedule('Master', ['Alpha', 'Beta']);
  const alphaOld = schedule('Alpha rev 1', ['Alpha'], { importedAt: '2026-08-01T12:00:00.000Z' });
  const pdf = schedule('Alpha rev 5', ['Alpha'], { importedAt: '2026-09-20T12:00:00.000Z', cloudUpdatedAt: null });
  const items = [task('m-a', 'Alpha', master), task('m-b', 'Beta', master)];

  it('changes no other schedule here, so Beta keeps the master, and asks only about what this phone hides', () => {
    const next = scheduleDocumentsAfterActivation(pdf, [master, alphaOld], null, 'T');
    expect(next.map(document => [document.id, document.isCurrent, document.retiredForProjectNames ?? null])).toEqual([
      ['Alpha rev 5', true, null], ['Master', true, null], ['Alpha rev 1', true, null],
    ]);
    expect(next[1]).toBe(master);
    expect(shownIds(items, next)).toEqual(['m-b']);
    // The newer task-less PDF does hide the master's Alpha task on this phone: that one question is still asked.
    expect(scheduleTasksHiddenByActivation(pdf, [master, alphaOld], items, null)).toEqual({ count: 1, scheduleName: 'Master' });
  });
});
