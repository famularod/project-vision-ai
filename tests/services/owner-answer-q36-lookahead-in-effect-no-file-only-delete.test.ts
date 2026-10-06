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
import { currentScheduleDocumentWinners, scheduleDocumentIsScheduleLike, scheduleLookaheadInEffect } from '../../services/PIEScheduleReconciliation';
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
    ${between('\n  /** The PDF of a lookahead in effect, or of the master in effect, is never deleted on its own', '\n  function deleteReferenceDocument(')}
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
  it('what "in effect" is here is what it is everywhere: the newest lookahead of its project; not a lookahead a newer one replaced', () => {
    expect([MASTER, OLDER, NEWER].map(document => scheduleLookaheadInEffect(document, ALL))).toEqual([false, false, true]);
    // (The master here is the one in effect: refused too since owner answer Q38, with its own sentence; below.)
    expect([MASTER, OLDER, NEWER].map(document => scheduleFileOnlyDeleteRefusal(document, ALL))).toEqual([expect.stringContaining('MASTER is the active schedule'), null,
      'LOOKAHEAD 2 is the lookahead in effect, so its PDF cannot be deleted on its own. Use Delete PDF + Items: that also puts the master schedule\'s dates back.']);
    // The older one is in effect again once the newer one is gone.
    expect(scheduleFileOnlyDeleteRefusal(OLDER, [MASTER, OLDER])).toContain('LOOKAHEAD 1 is the lookahead in effect');
    expect(scheduleFileOnlyDeleteRefusal(undefined, ALL)).toBeNull();
  });

  it('(a) the dialog offers "Delete PDF Only" for a replaced lookahead, and not for the lookahead in effect; its words read true with one choice', () => {
    const app = phone(ALL);
    [MASTER, OLDER, NEWER].forEach(document => app.deleteScheduleDocument(document.id));
    expect(app.alerts.map(alert => alert.buttons.map(button => button.text))).toEqual([
      ['Cancel', 'Delete PDF + Items'], // the master in effect: owner answer Q38, below
      ['Cancel', 'Delete PDF Only', 'Delete PDF + Items'],
      ['Cancel', 'Delete PDF + Items'],
    ]);
    expect(app.alerts[1].message).toContain('LOOKAHEAD 1 will be removed. You can also remove the 1 schedule item only this PDF contains so outdated dates do not confuse Upcoming.');
    expect(app.alerts[2].message).toContain('LOOKAHEAD 2 will be removed, with the 1 schedule item only this PDF contains.');
    expect(app.alerts[2].message).not.toContain('You can also');
  });

  it('(b) the delete underneath the button refuses for the lookahead in effect: he is told why and nothing changes; a replaced lookahead\'s file goes as before', async () => {
    const app = phone(ALL);
    expect(await app.removeReferenceDocumentEverywhere(NEWER.id)).toBe(false);
    expect(app.alerts.map(alert => [alert.title, alert.message])).toEqual([['PDF not deleted', scheduleFileOnlyDeleteRefusal(NEWER, ALL)]]);
    expect([app.did.tombstones, app.referenceDocumentsCurrentRef.current.map(document => document.id)]).toEqual([[], ['MASTER', 'LOOKAHEAD 1', 'LOOKAHEAD 2']]);
    expect(await app.removeReferenceDocumentEverywhere(OLDER.id)).toBe(true);
    expect([app.did.tombstones, app.referenceDocumentsCurrentRef.current.map(document => document.id), app.alerts.length]).toEqual([['LOOKAHEAD 1'], ['MASTER', 'LOOKAHEAD 2'], 1]);
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
    expect(app.alerts.slice(1).map(alert => [alert.title, alert.message])).toEqual([['PDF not deleted', scheduleFileOnlyDeleteRefusal(OLDER, [MASTER, OLDER])]]);
    expect(app.did).toEqual({ tombstones: [], saved: [], filesDeleted: [] });
    expect(app.referenceDocumentsCurrentRef.current.map(document => document.id)).toEqual(['MASTER', 'LOOKAHEAD 1']);
  });

  it('every caller of that delete stops when it refuses: the stored file is left, and a project document is not taken off the device', () => {
    expect(APP.split('.then(removed => { if (removed !== false) deleteStoredReferenceDocument(document.uri).catch(() => undefined); })')).toHaveLength(3);
    expect(APP).toContain('void removeReferenceDocumentEverywhere(sharedRecord.id)\n        .then(removed => (removed === false ? undefined : removeFromDevice()))');
    expect(APP.split('removeReferenceDocumentEverywhere(')).toHaveLength(5); // the function and its three callers
  });
});

/*
 * Owner answer Q38 (6 Oct 2026; the schedule reviewer's P7-1, Medium, the same on Build 229): the same for the MASTER
 * schedule in effect. Its PDF deleted alone left no schedule in effect: the list was empty on every device, and Set
 * Active on the older master then showed a task the deleted master had moved twice (the older master's row at 0%,
 * blank, and the deleted master's row with his percent, note and owner) beside that master's own tasks.
 */
describe('Owner answer Q38: on the phone, the PDF of the master schedule in effect is not deleted on its own', () => {
  const F = { ...schedule('MASTER F', '2026-09-07T12:00:00.000Z'), isCurrent: false } as ReferenceDocument;
  const G = schedule('MASTER G', '2026-09-14T12:00:00.000Z');
  /** An older master, the master in effect, and a lookahead a newer one replaced. */
  const SAVED = [F, G, OLDER, NEWER];
  const REFUSED = 'MASTER G is the active schedule, so its PDF cannot be deleted on its own. Use Delete PDF + Items, or set another schedule active first.';

  it('the master in effect is the one the list shows: the app\'s own test, not a second one; an older master is not refused', () => {
    expect(currentScheduleDocumentWinners(SAVED).map(document => document.id)).toEqual(['MASTER G']);
    expect([F, G, OLDER].map(document => scheduleFileOnlyDeleteRefusal(document, SAVED))).toEqual([null, REFUSED, null]);
    // Two masters still marked current for one project (a device that has not reconciled them yet): only the one shown.
    const bothMarked = [{ ...F, isCurrent: true } as ReferenceDocument, G];
    expect(bothMarked.map(document => scheduleFileOnlyDeleteRefusal(document, bothMarked))).toEqual([null, REFUSED]);
    // A combined master a newer one replaced for Alpha is still the one in effect for Beta.
    const combined = { ...F, isCurrent: true, projectNames: ['Alpha', 'Beta'] } as ReferenceDocument;
    expect(scheduleFileOnlyDeleteRefusal(combined, [combined, G])).toContain('MASTER F is the active schedule');
    // After Set Active on the older master the newer one's PDF may go on its own.
    const afterSetActive = [{ ...F, isCurrent: true } as ReferenceDocument, { ...G, isCurrent: false } as ReferenceDocument];
    expect(afterSetActive.map(document => scheduleFileOnlyDeleteRefusal(document, afterSetActive))).toEqual([expect.stringContaining('MASTER F is the active schedule'), null]);
  });

  it('(a) the dialog offers "Delete PDF Only" for an older master and not for the master in effect; its words read true with one choice', () => {
    const app = phone(SAVED);
    [F, G].forEach(document => app.deleteScheduleDocument(document.id));
    expect(app.alerts.map(alert => alert.buttons.map(button => button.text))).toEqual([
      ['Cancel', 'Delete PDF Only', 'Delete PDF + Items'],
      ['Cancel', 'Delete PDF + Items'],
    ]);
    expect(app.alerts[1].message).not.toContain('You can also');
  });

  it('(b) the delete underneath the button refuses for the master in effect: he is told why and nothing changes; the older master\'s file goes as before', async () => {
    const app = phone(SAVED);
    expect(await app.removeReferenceDocumentEverywhere(G.id)).toBe(false);
    expect(app.alerts.map(alert => [alert.title, alert.message])).toEqual([['PDF not deleted', REFUSED]]);
    expect([app.did.tombstones, app.referenceDocumentsCurrentRef.current.map(document => document.id)]).toEqual([[], SAVED.map(document => document.id)]);
    expect(await app.removeReferenceDocumentEverywhere(F.id)).toBe(true);
    expect(app.did.tombstones).toEqual(['MASTER F']);
  });

  it('(c) a dialog opened on an older master checks again at the tap: set active meanwhile, nothing is saved and nothing is removed', async () => {
    const app = phone(SAVED, { scheduleItemsAfterScheduleDeleted: () => [TASKS[0]] });
    app.deleteScheduleDocument(F.id);
    const pdfOnly = app.alerts[0].buttons.find(button => button.text === 'Delete PDF Only')!;
    // Set Active on master F, on this device or another, while the dialog is open.
    app.referenceDocumentsCurrentRef.current = [{ ...F, isCurrent: true } as ReferenceDocument, { ...G, isCurrent: false } as ReferenceDocument, OLDER, NEWER];
    pdfOnly.onPress!();
    await settled();
    expect(app.alerts.slice(1).map(alert => alert.message)).toEqual(['MASTER F is the active schedule, so its PDF cannot be deleted on its own. Use Delete PDF + Items, or set another schedule active first.']);
    expect(app.did).toEqual({ tombstones: [], saved: [], filesDeleted: [] });
  });
});

/*
 * The delete question when the schedule has no task only it contains (Build 231, S1 item 4): it read "...will be
 * removed, with the 0 schedule items only this PDF contains." Said plainly, with no count.
 */
describe('the delete question for a schedule with no tasks of its own', () => {
  const BARE = schedule('LOOKAHEAD 3', '2026-09-11T12:00:00.000Z', 'lookahead'); // in effect; lists only the master's Framing
  const OLD_MASTER = { ...schedule('MASTER 0', '2026-09-01T12:00:00.000Z'), isCurrent: false } as ReferenceDocument; // no task is only its own
  const question = (document: ReferenceDocument, documents: ReferenceDocument[]) => {
    const app = phone(documents);
    app.deleteScheduleDocument(document.id);
    return [app.alerts[0].message, app.alerts[0].buttons.map(button => button.text)];
  };

  it('a lookahead in effect, or the master in effect, that added none: no count, one choice', () => {
    expect(question(BARE, [...ALL, BARE])).toEqual(['LOOKAHEAD 3 will be removed. It has no schedule items of its own.', ['Cancel', 'Delete PDF + Items']]);
    const lone = { ...MASTER, id: 'MASTER 9', name: 'MASTER 9', importBatchId: 'batch-MASTER 9', importedAt: '2026-09-12T12:00:00.000Z' } as ReferenceDocument;
    expect(question(lone, [...ALL, lone])).toEqual(['MASTER 9 will be removed. It has no schedule items of its own.', ['Cancel', 'Delete PDF + Items']]);
  });

  it('with both choices offered too (an older master none of whose tasks is only its own)', () => {
    expect(question(OLD_MASTER, [OLD_MASTER, ...ALL])).toEqual(['MASTER 0 will be removed. It has no schedule items of its own.', ['Cancel', 'Delete PDF Only', 'Delete PDF + Items']]);
  });

  it('one or more: counted as before', () => {
    expect(question(NEWER, ALL)[0]).toBe('LOOKAHEAD 2 will be removed, with the 1 schedule item only this PDF contains.');
    expect(question(OLDER, ALL)[0]).toBe('LOOKAHEAD 1 will be removed. You can also remove the 1 schedule item only this PDF contains so outdated dates do not confuse Upcoming.');
  });
});

/*
 * Build 231, S2 item 5 (small): the delete question did not say that the items a master's delete removes include the
 * earlier rows of tasks a newer schedule has moved, which he does not see in his list.
 */
describe('S2 item 5: the delete question says when the items removed include earlier rows of tasks a newer schedule moved', () => {
  const F = { ...schedule('MASTER F', '2026-09-01T12:00:00.000Z'), isCurrent: false } as ReferenceDocument;
  const G = schedule('MASTER G', '2026-09-14T12:00:00.000Z');
  const row = (id: string, name: string, document: ReferenceDocument, revisedFromTaskIds?: string[]) => ({ ...task(name, document), id, ...(revisedFromTaskIds ? { revisedFromTaskIds } : {}) }) as ScheduleItem;
  /** F listed Framing, Paint and Roofing; G moved Framing and Paint (new rows that answer to F's) and left Roofing out. */
  const SAVED = [row('F-1', 'Framing', F), row('F-2', 'Paint', F), row('F-3', 'Roofing', F), row('G-1', 'Framing', G, ['F-1']), row('G-2', 'Paint', G, ['F-2'])];
  const question = (document: ReferenceDocument, items: ScheduleItem[]) => {
    const app = phone([F, G], { scheduleItems: items, scheduleItemsCurrentRef: { current: items } });
    app.deleteScheduleDocument(document.id);
    return app.alerts[0].message;
  };

  it('the older master: two of its three items are earlier rows of tasks master G moved', () => {
    expect(question(F, SAVED)).toBe('MASTER F will be removed. You can also remove the 3 schedule items only this PDF contains so outdated dates do not confuse Upcoming. 2 of those items are earlier rows of tasks a newer schedule has moved; those tasks stay in your list.');
  });

  it('one such row; none; and a lookahead\'s question is unchanged', () => {
    const one = SAVED.filter(item => item.id !== 'G-2');
    expect(question(F, one)).toContain('contains so outdated dates do not confuse Upcoming. 1 of those items is the earlier row of a task a newer schedule has moved; that task stays in your list.');
    expect(question(G, SAVED)).toBe('MASTER G will be removed, with the 2 schedule items only this PDF contains.');
    expect(scheduleLookaheadDeleteNote(SAVED, G, SAVED.filter(item => item.id.startsWith('G-')), [F, G])).toBe('');
    // A row whose newer row is removed with it is not such a row: that task does not stay.
    expect(scheduleLookaheadDeleteNote(SAVED, F, SAVED.filter(item => ['F-1', 'G-1', 'F-3'].includes(item.id)), [F, G])).toBe('');
    expect(scheduleLookaheadDeleteNote(TASKS, NEWER, [TASKS[2]], ALL)).not.toContain('earlier row');
  });
});
