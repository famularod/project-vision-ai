/**
 * Open item 3.1 (13 Oct 2026; the A5 / A8 recorded Medium, "only just after an import"). On the phone and iPad:
 * - Make Current on a schedule card that was never shared made a shared record current on this phone only and marked
 *   the other schedules not current here alone (every merge takes the cloud's current flag, so the other devices
 *   never changed and the next refresh undid it here); on a card whose file was still uploading it did the same, and
 *   the card's own upload, finishing, then linked the card to a second copy that was not current ("shows the card as
 *   not current").
 * - Set Active (and Make Current on a card already shared) said "Refresh required ... Sign in and refresh the project
 *   documents" for a schedule this device had not finished uploading: not true, and no refresh helps.
 * Now a schedule is made current only by the cloud, so on every device or on none: a schedule the cloud does not have
 * yet is refused with a true line, an uploaded card never shared is shared first (made current by nobody here), and a
 * schedule the cloud has but this device never heard back about is made current by the cloud's own revision.
 * The App functions run compiled from App.tsx, with the real services. Synthetic data.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { markCurrentProjectScheduleDocument } from '../../services/DAVEDocumentWorkspace';
import { scheduleDocumentIsCurrentEverywhere } from '../../services/PIEScheduleReconciliation';
import {
  activateSharedReferenceDocument,
  importedScheduleOfPhoneSchedule,
  phoneScheduleActivationTarget,
  phoneScheduleCardNotSharedYet,
  scheduleDocumentsAfterActivation,
  scheduleRetirementMessage,
  scheduleTasksHiddenByActivation,
  scheduleTasksHiddenWarning,
  SCHEDULE_NOT_UPLOADED_YET,
} from '../../services/SharedDocumentActivation';
import type { ReferenceDocument, ScheduleItem } from '../../types';

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
    if (app[index] === '}') { depth -= 1; if (depth === 0) return app.slice(match.index + 3, index + 1); }
  }
  throw new Error('unbalanced function');
}
function compile<T>(names: string[], deps: Record<string, unknown>): T {
  const js = ts.transpileModule([...names.map(componentFunction), `module.exports = { ${names.join(', ')} };`].join('\n'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} as T };
  new Function('module', 'exports', ...Object.keys(deps), js)(mod, mod.exports, ...Object.values(deps));
  return mod.exports;
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

// The cloud before the Q15 migration (no retirement-scope call): it retires as 'schedule'.
const client = { rpc: jest.fn(async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } })) } as unknown as SupabaseClient;
const schedule = (id: string, extra: Partial<ReferenceDocument> = {}) => ({
  id, name: id, originalFileName: `${id}.pdf`, uri: '', category: 'Schedules', notes: '', isCurrent: false,
  importedAt: '2026-10-12T00:00:00.000Z', projectId: null, projectName: 'Alpha', projectNames: ['Alpha'],
  importBatchId: `batch-${id}`, cloudUpdatedAt: `rev-${id}`, ...extra,
}) as ReferenceDocument;
const master = schedule('Alpha master', { isCurrent: true, importedAt: '2026-09-01T00:00:00.000Z' });
// Imported on this phone a moment ago, with no signal: its record has not reached the cloud.
const justImported = schedule('Alpha rev 6', { cloudUpdatedAt: null });
const task = (id: string, batch: string, sourceDocumentId: string) => ({
  id, projectName: 'Alpha', taskName: `Task ${id}`, locationName: 'Lot', owner: '', startDate: '10/01/2026', finishDate: '10/20/2026',
  milestone: '', status: 'Not Started', percentComplete: 0, notes: '', createdAt: '2026-10-01T00:00:00.000Z', importBatchId: batch, sourceDocumentId,
}) as unknown as ScheduleItem;
const activated = (documentId: string) => ({ status: 'activated' as const, documentId, updatedAt: 'later', changedCount: 2, message: null });

describe('3.1: the cloud makes a schedule current, or nothing does', () => {
  it('a schedule this device has not finished uploading (the cloud never had it): refused with a true line, nothing activated', async () => {
    const activate = jest.fn(async () => activated(justImported.id));
    await expect(activateSharedReferenceDocument({
      documentId: justImported.id, documents: [master, justImported], client, activate,
      listDocuments: async () => [master], confirmRetiringProjects: async () => true,
    })).resolves.toEqual({ status: 'not_uploaded', message: SCHEDULE_NOT_UPLOADED_YET });
    expect(activate).not.toHaveBeenCalled();
    expect(SCHEDULE_NOT_UPLOADED_YET).toBe('This schedule has not finished uploading, so your other devices do not have it yet. Nothing was changed on any device. It uploads by itself when this device has signal (Sync Now sends it at once); then try again.');
  });

  it('a schedule uploaded since this device last heard (the cloud has it, this copy has no stamp): made current by the cloud\'s own revision', async () => {
    const inCloud = { ...justImported, cloudUpdatedAt: 'rev-cloud' };
    const after = [{ ...master, isCurrent: false }, { ...inCloud, isCurrent: true }];
    const activate = jest.fn(async () => activated(justImported.id));
    const listDocuments = jest.fn().mockResolvedValueOnce([master, inCloud]).mockResolvedValueOnce(after);
    await expect(activateSharedReferenceDocument({
      documentId: justImported.id, documents: [master, justImported], client, activate, listDocuments, confirmRetiringProjects: async () => true,
    })).resolves.toEqual({ status: 'activated', documents: after });
    expect(activate).toHaveBeenCalledWith({ client, documentId: justImported.id, expectedUpdatedAt: 'rev-cloud' });
  });

  it('as before: no sign-in, a schedule the cloud had and no longer has, and a drawing never uploaded ask for a refresh', async () => {
    const activate = jest.fn();
    const base = { activate, confirmRetiringProjects: async () => true };
    await expect(activateSharedReferenceDocument({ ...base, documentId: justImported.id, documents: [master, justImported], client: null, listDocuments: async () => [master] }))
      .resolves.toEqual({ status: 'refresh_required' });
    await expect(activateSharedReferenceDocument({ ...base, documentId: 'Alpha rev 5', documents: [master, schedule('Alpha rev 5')], client, listDocuments: async () => [master] }))
      .resolves.toEqual({ status: 'refresh_required' });
    const drawing = { ...schedule('A-101'), category: 'Drawing', cloudUpdatedAt: null } as ReferenceDocument;
    await expect(activateSharedReferenceDocument({ ...base, documentId: 'A-101', documents: [drawing], client, listDocuments: async () => [] }))
      .resolves.toEqual({ status: 'refresh_required' });
    expect(activate).not.toHaveBeenCalled();
  });
});

describe('3.1: Set Active on a schedule just imported with no signal (App.tsx, compiled)', () => {
  function phone() {
    const alerts: Array<{ title: string; message: string }> = [];
    const deps: Record<string, unknown> = {
      referenceDocumentsCurrentRef: { current: [master, justImported] }, scheduleItemsCurrentRef: { current: [task('t1', 'batch-Alpha rev 6', 'Alpha rev 6')] },
      scheduleDocumentIsCurrentEverywhere, currentReferenceActivationIdsRef: { current: new Set<string>() },
      buildECOSDocumentReadiness: () => ({ canMakeCurrent: true, detail: '' }), canonicalReferenceCategory: () => 'schedule',
      projectDocumentSharedRecordSync: { flush: jest.fn() }, activateSharedReferenceDocument, getSupabaseClient: () => client,
      listReferenceDocuments: jest.fn(async () => ({ ok: true, stubbed: false, data: [master] })), normalizeReferenceDocuments: (documents: unknown) => documents,
      scheduleRetirementMessage, deletedDAVERecordIds: () => [], operationalSyncTombstonesRef: { current: [] },
      requeueReferenceDocumentEditsOutlivingActivation: jest.fn(async () => []), reconcileCurrentScheduleDocuments: (documents: unknown) => documents,
      mergeDAVEReferenceDocumentRecoveryRecords: jest.fn(), scheduleProgressCarriedOnActivation: () => [],
      markReferenceDocumentsAuthorityReady: jest.fn(), setReferenceDocuments: jest.fn(), markScheduleItemsAuthorityReady: jest.fn(), setScheduleItems: jest.fn(),
      syncScheduleItemRevision: jest.fn(), advanceScheduleItemSyncGeneration: jest.fn(),
      loadECOSScheduleRetirementScope: async () => 'schedule', scheduleTasksHiddenWarning, scheduleTasksHiddenByActivation,
      Alert: { alert: (title: string, message: string) => { alerts.push({ title, message }); } },
    };
    const fns = compile<{ setActiveScheduleDocument: (id: string) => Promise<void>; activateReferenceDocument: (id: string) => Promise<boolean> }>(
      ['activateReferenceDocument', 'markReferenceDocumentCurrent', 'setActiveScheduleDocument'], deps);
    return { ...fns, alerts, deps };
  }

  it('says it has not finished uploading and that nothing changed on any device; nothing changes here either', async () => {
    const h = phone();
    await h.setActiveScheduleDocument(justImported.id);
    await settle();
    expect(h.alerts).toEqual([{ title: 'Current revision was not changed', message: SCHEDULE_NOT_UPLOADED_YET }]);
    expect(h.alerts.map(alert => alert.title)).not.toContain('Refresh required');
    expect(h.deps.setReferenceDocuments).not.toHaveBeenCalled();
    expect((h.deps.referenceDocumentsCurrentRef as { current: ReferenceDocument[] }).current.map(document => [document.id, document.isCurrent]))
      .toEqual([['Alpha master', true], ['Alpha rev 6', false]]);
  });
});

describe('3.1: Make Current on a phone schedule card (App.tsx, compiled)', () => {
  const card = (extra: Record<string, unknown>) => ({
    id: 'phone-pdf', projectId: 'alpha-key', name: 'Alpha rev 6.pdf', category: 'Schedule', mimeType: 'application/pdf', sizeBytes: 10,
    referenceDocumentId: null, importedAt: '2026-10-12T00:00:00.000Z', updatedAt: '2026-10-12T00:00:00.000Z', isCurrent: false, ...extra,
  });
  function phone(cardNow: ReturnType<typeof card>, documents: ReferenceDocument[], activates = true) {
    const alerts: Array<{ title: string; message: string }> = [];
    const queued: ReferenceDocument[] = [];
    const state = { cards: [cardNow] as Array<Record<string, unknown>>, documents };
    const apply = <T,>(value: T | ((prev: T) => T), prev: T) => (typeof value === 'function' ? (value as (prev: T) => T)(prev) : value);
    const deps: Record<string, unknown> = {
      projectDocuments: [cardNow], projects: ['Alpha'], authorityProjectId: () => 'alpha-key', referenceDocuments: documents,
      scheduleItems: [task('m1', 'batch-Alpha master', 'Alpha master')],
      loadECOSScheduleRetirementScope: async () => 'schedule', getSupabaseClient: () => client,
      importedScheduleOfPhoneSchedule, phoneScheduleActivationTarget, scheduleTasksHiddenWarning, scheduleTasksHiddenByActivation,
      phoneScheduleCardNotSharedYet, scheduleDocumentsAfterActivation, markCurrentProjectScheduleDocument,
      activateReferenceDocument: jest.fn(async () => activates),
      publishUploadedProjectDocument: jest.fn(async () => undefined), bindProjectDocumentUploadToAccount: () => () => true,
      // What Build 232 and earlier called on this path, so it runs here too (and shows what it did).
      ensureVerifiedProjectDocumentBytes: jest.fn(async (verified: object) => ({ ...verified, localUri: 'file:///verified.pdf' })),
      ensureReferenceDocumentsDirectory: jest.fn(async () => 'file:///docs/'), FileSystem: { copyAsync: jest.fn(async () => undefined) },
      uid: () => 'new-ref', sanitizeFilename: (name: string) => name, parseOwnedLocalFileManifest: () => ({ files: {} }),
      normalizeReferenceDocument: (value: ReferenceDocument) => value,
      referenceDocumentsCurrentRef: { current: documents },
      markReferenceDocumentsAuthorityReady: jest.fn(),
      setReferenceDocuments: jest.fn((value: ReferenceDocument[]) => { state.documents = value; }),
      queueReferenceDocumentRecord: jest.fn(async (document: ReferenceDocument) => { queued.push(document); }),
      setProjectDocuments: jest.fn((value: unknown) => { state.cards = apply(value as never, state.cards); }),
      setDraft: jest.fn(), setSavedUpdates: jest.fn(),
      Alert: { alert: (title: string, message: string) => { alerts.push({ title, message }); } },
    };
    const fns = compile<{ makeProjectScheduleDocumentCurrent: (id: string, confirmed?: boolean) => Promise<void> }>(
      ['makeProjectScheduleDocumentCurrent', 'reviewProjectScheduleDocumentImport'], deps);
    return { ...fns, alerts, queued, state, deps };
  }
  const nothingCurrentHere = (h: ReturnType<typeof phone>) => {
    expect(h.queued).toEqual([]);
    expect(h.deps.setReferenceDocuments).not.toHaveBeenCalled();
    expect(h.state.documents.filter(document => document.isCurrent).map(document => document.id)).toEqual(['Alpha master']);
    expect(h.state.cards.map(item => [item.id, item.isCurrent ?? false])).toEqual([['phone-pdf', false]]);
    expect(h.deps.activateReferenceDocument).not.toHaveBeenCalled();
  };

  it('a card whose file is still uploading: nothing is made current or copied anywhere, and the line says to wait for the upload', async () => {
    const h = phone(card({ status: 'uploading', storagePath: null }), [master]);
    await h.makeProjectScheduleDocumentCurrent('phone-pdf', true);
    nothingCurrentHere(h);
    expect(h.deps.publishUploadedProjectDocument).not.toHaveBeenCalled();
    expect(h.alerts).toEqual([{ title: 'Current schedule not changed', message: 'This schedule has not finished uploading from this device, so your other devices do not have it yet. Nothing was changed on any device. Once it has uploaded, use Make Current again.' }]);
  });

  it('a card whose upload failed: the same, and the line says Retry', async () => {
    const h = phone(card({ status: 'failed', storagePath: null }), [master]);
    await h.makeProjectScheduleDocumentCurrent('phone-pdf', true);
    nothingCurrentHere(h);
    expect(h.alerts[0].message).toBe('This schedule did not finish uploading from this device, so your other devices do not have it. Nothing was changed on any device. Tap Retry on its card; once it has uploaded, use Make Current again.');
  });

  it('an uploaded card never shared: it is shared (not current), nothing is made current here, and the line says so', async () => {
    const h = phone(card({ status: 'uploaded', storagePath: 'owner/alpha-rev-6.pdf' }), [master]);
    await h.makeProjectScheduleDocumentCurrent('phone-pdf', true);
    nothingCurrentHere(h);
    expect(h.deps.publishUploadedProjectDocument).toHaveBeenCalledTimes(1);
    expect((h.deps.publishUploadedProjectDocument as jest.Mock).mock.calls[0][0]).toMatchObject({ id: 'phone-pdf', referenceDocumentId: null });
    expect(h.alerts).toEqual([{ title: 'Current schedule not changed', message: 'This schedule was not yet shared with your other devices. It is being shared now; nothing was changed on any device. Once it has uploaded, use Make Current again (Sync Now sends it at once when you have signal).' }]);
  });

  it('a card whose shared copy is gone from this device: nothing made current, and the line says to add the file again', async () => {
    const h = phone(card({ status: 'uploaded', storagePath: 'owner/alpha-rev-6.pdf', referenceDocumentId: 'deleted-copy' }), [master]);
    await h.makeProjectScheduleDocumentCurrent('phone-pdf', true);
    nothingCurrentHere(h);
    expect(h.deps.publishUploadedProjectDocument).not.toHaveBeenCalled();
    expect(h.alerts[0].message).toBe('This schedule’s shared copy is no longer on this device, so it cannot be made current on your other devices. Nothing was changed on any device. Add the file again to share it.');
  });

  it('a card already shared: the cloud makes it current, then the card reads current (as before); refused by the cloud, nothing', async () => {
    const shared = schedule('phone-pdf-shared', { importBatchId: null });
    const yes = phone(card({ status: 'uploaded', storagePath: 'p', referenceDocumentId: shared.id }), [master, shared]);
    await yes.makeProjectScheduleDocumentCurrent('phone-pdf', true);
    expect(yes.deps.activateReferenceDocument).toHaveBeenCalledWith(shared.id);
    expect(yes.state.cards.map(item => [item.isCurrent, item.referenceDocumentId])).toEqual([[true, shared.id]]);
    expect(yes.queued).toEqual([]);
    const no = phone(card({ status: 'uploaded', storagePath: 'p', referenceDocumentId: shared.id }), [master, shared], false);
    await no.makeProjectScheduleDocumentCurrent('phone-pdf', true);
    expect(no.state.cards.map(item => item.isCurrent)).toEqual([false]);
    expect(no.alerts).toEqual([]);
  });
});
