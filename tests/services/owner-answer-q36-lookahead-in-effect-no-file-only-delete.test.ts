/*
 * Owner answer Q36 (6 Oct 2026): on the phone and the iPad, "Delete PDF Only" is removed for a lookahead that is in
 * effect. "Delete PDF + Items" stays. "Delete PDF Only" stays for a master and for a lookahead newer ones have
 * replaced. The delete underneath the button refuses too, whoever asks (a dialog left open while the lookahead came
 * into effect, another screen), with a plain sentence and no change.
 *
 * The dialog and the delete underneath are App.tsx's own, compiled from its source.
 */
import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { scheduleDocumentIsScheduleLike, scheduleLookaheadInEffect } from '../../services/PIEScheduleReconciliation';
import { scheduleItemsForExactImportBatch, scheduleItemsOfUnbatchedDocument, scheduleItemsOnlyInImportBatch } from '../../services/ScheduleImportProvenance';
import { scheduleFileOnlyDeleteRefusal, scheduleItemsAfterScheduleDeleted, scheduleLookaheadDeleteNote } from '../../services/ScheduleLookahead';
import type { ReferenceDocument, ScheduleItem } from '../../types';

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined), getAllKeys: jest.fn(async () => []), multiGet: jest.fn(async () => []) }));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));

const schedule = (id: string, importedAt: string, role?: 'lookahead'): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.pdf`, uri: `file:///${id}.pdf`, category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`, ...(role ? { scheduleRole: role } : {}),
}) as ReferenceDocument;
const MASTER = schedule('MASTER', '2026-09-07T12:00:00.000Z');
const OLDER = schedule('LOOKAHEAD 1', '2026-09-09T12:00:00.000Z', 'lookahead');
const NEWER = schedule('LOOKAHEAD 2', '2026-09-10T12:00:00.000Z', 'lookahead');
/** The master, a lookahead, and a newer lookahead that replaced it. */
const ALL = [MASTER, OLDER, NEWER];
const task = (id: string, document: ReferenceDocument): ScheduleItem => ({
  id, taskName: id, projectName: 'Alpha', locationName: 'Lot', startDate: '10/15/2026', finishDate: '10/25/2026', status: 'Not Started', percentComplete: 0,
  priority: 'Medium', notes: '', owner: '', contractor: '', milestone: '', createdAt: document.importedAt, importedAt: document.importedAt, importBatchId: document.importBatchId, sourceDocumentId: document.id,
}) as ScheduleItem;
const TASKS = [task('Framing', MASTER), task('Detail 1', OLDER), task('Detail 2', NEWER)];

const APP = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');
const between = (from: string, to: string) => {
  const start = APP.indexOf(from);
  const end = APP.indexOf(to, start + from.length);
  if (start < 0 || end < 0) throw new Error(`App.tsx no longer has: ${start < 0 ? from : to}`);
  return APP.slice(start, end);
};
type Button = { text: string; onPress?: () => void };
/** The phone, with these schedules saved: App.tsx's delete dialog and the delete underneath it, and what they did. */
function phone(documents: ReferenceDocument[], overrides: Record<string, unknown> = {}) {
  const alerts: Array<{ title: string; message: string; buttons: Button[] }> = [];
  const referenceDocumentsCurrentRef = { current: documents };
  const did = { tombstones: [] as string[], saved: [] as string[], filesDeleted: [] as string[] };
  const deps: Record<string, unknown> = {
    referenceDocuments: documents, scheduleItems: TASKS, referenceDocumentsCurrentRef, scheduleItemsCurrentRef: { current: TASKS },
    Alert: { alert: (title: string, message: string, buttons: Button[] = []) => { alerts.push({ title, message, buttons }); } },
    scheduleFileOnlyDeleteRefusal, scheduleItemsOnlyInImportBatch, scheduleDocumentIsScheduleLike, scheduleItemsOfUnbatchedDocument, scheduleItemsForExactImportBatch,
    scheduleLookaheadDeleteNote, scheduleItemsAfterScheduleDeleted,
    updateScheduleItem: (id: string) => { did.saved.push(id); },
    deleteStoredReferenceDocument: async (uri: string) => { did.filesDeleted.push(uri); },
    recordDAVESyncTombstone: async (_entity: string, id: string) => { did.tombstones.push(id); return { entityType: 'reference_document', recordId: id }; },
    rememberOperationalTombstones: () => undefined, markReferenceDocumentsAuthorityReady: () => undefined,
    setReferenceDocuments: () => undefined, removeOperationalRecordFromSyncQueue: async () => undefined,
    ...overrides,
  };
  const source = `module.exports = (() => {
    ${between('\n  /** The PDF of a lookahead in effect is never deleted on its own', '\n  function deleteReferenceDocument(')}
    ${between('\n  function deleteScheduleDocument(', '\n  function addScheduleItem(')}
    return { deleteScheduleDocument, removeReferenceDocumentEverywhere };
  })();`;
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} as { deleteScheduleDocument: (id: string) => void; removeReferenceDocumentEverywhere: (id: string) => Promise<boolean> } };
  new Function('module', 'exports', ...Object.keys(deps), js)(mod, mod.exports, ...Object.values(deps));
  return { ...mod.exports, alerts, did, referenceDocumentsCurrentRef };
}
const settled = () => new Promise(resolve => setImmediate(resolve));

describe('Owner answer Q36: on the phone, the PDF of a lookahead in effect is not deleted on its own', () => {
  it('what "in effect" is here is what it is everywhere: the newest lookahead of its project; not a master, not a lookahead a newer one replaced', () => {
    expect([MASTER, OLDER, NEWER].map(document => scheduleLookaheadInEffect(document, ALL))).toEqual([false, false, true]);
    expect([MASTER, OLDER, NEWER].map(document => scheduleFileOnlyDeleteRefusal(document, ALL))).toEqual([null, null,
      'LOOKAHEAD 2 is the lookahead in effect, so its PDF cannot be deleted on its own. Use Delete PDF + Items: that also puts the master schedule\'s dates back.']);
    // The older one is in effect again once the newer one is gone.
    expect(scheduleFileOnlyDeleteRefusal(OLDER, [MASTER, OLDER])).toContain('LOOKAHEAD 1 is the lookahead in effect');
    expect(scheduleFileOnlyDeleteRefusal(undefined, ALL)).toBeNull();
  });

  it('(a) the dialog offers "Delete PDF Only" for a master and for a replaced lookahead, and not for the lookahead in effect; its words read true with one choice', () => {
    const app = phone(ALL);
    [MASTER, OLDER, NEWER].forEach(document => app.deleteScheduleDocument(document.id));
    expect(app.alerts.map(alert => alert.buttons.map(button => button.text))).toEqual([
      ['Cancel', 'Delete PDF Only', 'Delete PDF + Items'],
      ['Cancel', 'Delete PDF Only', 'Delete PDF + Items'],
      ['Cancel', 'Delete PDF + Items'],
    ]);
    expect(app.alerts[1].message).toContain('LOOKAHEAD 1 will be removed. You can also remove the 1 schedule item only this PDF contains so outdated dates do not confuse Upcoming.');
    expect(app.alerts[2].message).toContain('LOOKAHEAD 2 will be removed, with the 1 schedule item only this PDF contains.');
    expect(app.alerts[2].message).not.toContain('You can also');
  });

  it('(b) the delete underneath the button refuses for the lookahead in effect: he is told why and nothing changes; a master\'s file and a replaced lookahead\'s go as before', async () => {
    const app = phone(ALL);
    expect(await app.removeReferenceDocumentEverywhere(NEWER.id)).toBe(false);
    expect(app.alerts.map(alert => [alert.title, alert.message])).toEqual([['Lookahead in effect', scheduleFileOnlyDeleteRefusal(NEWER, ALL)]]);
    expect([app.did.tombstones, app.referenceDocumentsCurrentRef.current.map(document => document.id)]).toEqual([[], ['MASTER', 'LOOKAHEAD 1', 'LOOKAHEAD 2']]);
    expect(await app.removeReferenceDocumentEverywhere(OLDER.id)).toBe(true);
    expect([app.did.tombstones, app.referenceDocumentsCurrentRef.current.map(document => document.id), app.alerts.length]).toEqual([['LOOKAHEAD 1'], ['MASTER', 'LOOKAHEAD 2'], 1]);
    const other = phone(ALL);
    expect(await other.removeReferenceDocumentEverywhere(MASTER.id)).toBe(true);
    expect(other.did.tombstones).toEqual(['MASTER']);
  });

  it('"Delete PDF Only" on a replaced lookahead still saves its tasks first, removes the record and then the stored file', async () => {
    const app = phone(ALL, { scheduleItemsAfterScheduleDeleted: () => [TASKS[0]] });
    app.deleteScheduleDocument(OLDER.id);
    app.alerts[0].buttons.find(button => button.text === 'Delete PDF Only')!.onPress!();
    await settled();
    expect(app.did).toEqual({ tombstones: ['LOOKAHEAD 1'], saved: ['Framing'], filesDeleted: ['file:///LOOKAHEAD 1.pdf'] });
    expect(app.alerts).toHaveLength(1);
  });

  it('(c) a dialog opened while the lookahead was replaced checks again at the tap: in effect by then, nothing is saved and nothing is removed', async () => {
    // (The helper would have tasks to save; none may be.)
    const app = phone(ALL, { scheduleItemsAfterScheduleDeleted: () => [TASKS[0]] });
    app.deleteScheduleDocument(OLDER.id);
    const pdfOnly = app.alerts[0].buttons.find(button => button.text === 'Delete PDF Only')!;
    // The newer lookahead is deleted on another device meanwhile: the older one is in effect again.
    app.referenceDocumentsCurrentRef.current = [MASTER, OLDER];
    pdfOnly.onPress!();
    await settled();
    expect(app.alerts.slice(1).map(alert => [alert.title, alert.message])).toEqual([['Lookahead in effect', scheduleFileOnlyDeleteRefusal(OLDER, [MASTER, OLDER])]]);
    expect(app.did).toEqual({ tombstones: [], saved: [], filesDeleted: [] });
    expect(app.referenceDocumentsCurrentRef.current.map(document => document.id)).toEqual(['MASTER', 'LOOKAHEAD 1']);
  });

  it('every caller of that delete stops when it refuses: the stored file is left, and a project document is not taken off the device', () => {
    expect(APP.split('.then(removed => { if (removed !== false) deleteStoredReferenceDocument(document.uri).catch(() => undefined); })')).toHaveLength(3);
    expect(APP).toContain('void removeReferenceDocumentEverywhere(sharedRecord.id)\n        .then(removed => (removed === false ? undefined : removeFromDevice()))');
    expect(APP.split('removeReferenceDocumentEverywhere(')).toHaveLength(5); // the function and its three callers
  });
});
