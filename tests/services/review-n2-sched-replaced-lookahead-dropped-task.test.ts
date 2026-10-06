/**
 * Review N2 P-b (pass 2 of the next round, part 2, 5 Oct 2026; Medium, older
 * behaviour that owner answer Q25, ada8ef6, left in place for replaced
 * lookaheads). A master's task a lookahead restated also belongs to that
 * lookahead, and any saved lookahead, even one a newer lookahead had
 * replaced, held it in David's list. Master M0 lists Framing, Roof and
 * Drywall; lookahead L1 moves Roof; L2 (Framing only) replaces L1; master M1
 * lists Framing and Drywall only. Roof stayed listed for good, on M0's dates.
 * With no lookahead ever listing Roof, it left with M1.
 *
 * A replaced lookahead no longer holds a task the current master does not
 * list. A lookahead in effect that lists the task holds it, as before. His
 * own percent and note on such a task are treated exactly as on a task a
 * master drops when no lookahead ever listed it: each check below compares
 * the two histories. One device; real CSV normalizer, merge, shown-schedule
 * pick, delete helper and report. Synthetic data.
 */
import { buildDAVEProjectTruth } from '../../services/DAVEProjectTruth';
import { buildDAVEReportBriefing, buildDAVEReportSourceFingerprint } from '../../services/DAVEReportIntelligence';
import { buildDAVEReportSnapshot, daveReportSnapshotScopeKey, reportBaselineSnapshot, type DAVEReportSnapshot } from '../../services/DAVEReportSnapshot';
import { scheduleProgressCarriedOnActivation } from '../../services/ScheduleImportMerge';
import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { reconcileDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { scheduleDocumentIsScheduleLike, selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import { scheduleItemsOnlyInImportBatch } from '../../services/ScheduleImportProvenance';
import { scheduleItemsAfterScheduleDeleted } from '../../services/ScheduleLookahead';
import { reconcileScheduleProgressEdit } from '../../services/ScheduleProgressInvariant';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';
import { withProjectControlsEditMerged } from '../../services/VitruviusProjectControls';
import type { ReferenceDocument, ScheduleItem } from '../../types';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
  getAllKeys: jest.fn(async () => []),
  multiGet: jest.fn(async () => []),
}));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));

type State = { items: ScheduleItem[]; documents: ReferenceDocument[] };
const EMPTY: State = { items: [], documents: [] };
const shown = (state: State) => selectAuthoritativeScheduleItems({ scheduleItems: state.items, scheduleDocuments: state.documents }) as ScheduleItem[];
const named = (state: State, name: string) => shown(state).filter(item => item.taskName === name);
const one = (state: State, name: string) => {
  const found = named(state, name);
  expect(found).toHaveLength(1);
  return found[0];
};
const dates = (item: ScheduleItem) => `${item.startDate}-${item.finishDate}`;
const saved = (state: State, id: string) => state.items.find(item => item.id === id)!;

const schedule = (id: string, importedAt: string, role?: 'lookahead', project = 'Alpha'): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: project, projectNames: [project], importBatchId: `batch-${id}`, ...(role ? { scheduleRole: role } : {}),
}) as ReferenceDocument;

/** A CSV's rows through the real normalizer, with the import's provenance. */
function rows(source: ReferenceDocument, lines: string[], project = 'Alpha'): ScheduleItem[] {
  return (normalizeScheduleImport({
    contents: ['Task,Project,Area,Start,Finish,Percent Complete', ...lines].join('\n'), sourceName: source.originalFileName,
    mimeType: 'text/csv', projects: [project], projectAreas: [], now: new Date(source.importedAt),
  }).items as ScheduleItem[]).map((item, index) => ({
    ...item, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id,
  }));
}

/** Approving a schedule on the phone (App.tsx): the merge, then a master is made current, a lookahead added. */
function approve(state: State, source: ReferenceDocument, lines: string[], project = 'Alpha', pairingChoices?: Record<string, string | null>): State {
  const lookahead = source.scheduleRole === 'lookahead';
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items, imported: rows(source, lines, project), completionMatch: () => null, mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, [...state.documents, source], source.importBatchId || ''),
    approvedAt: source.importedAt, overlay: lookahead, pairingChoices, // (his answers at the review, owner answer Q30)
  });
  return {
    items: reconcileDAVEScheduleRecords([...merged.additions, ...merged.next]),
    documents: lookahead ? [...state.documents, source] : scheduleDocumentsAfterActivation(source, [...state.documents, source], 'project'),
  };
}

const APP_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');
/** App.tsx's own updateScheduleItem, compiled from its source, at the time given: the task as the phone saves it. */
function phoneSave(state: State, id: string, edit: Partial<ScheduleItem>, at: string): State {
  const from = APP_SOURCE.indexOf('\n  function updateScheduleItem(');
  const to = APP_SOURCE.indexOf('\n  async function saveScheduleItemChanges(', from);
  expect(from).toBeGreaterThan(0); expect(to).toBeGreaterThan(from);
  const js = ts.transpileModule(`module.exports = (() => { ${APP_SOURCE.slice(from, to)}\n return updateScheduleItem; })();`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const ref = { current: state.items };
  const deps: Record<string, unknown> = {
    scheduleItemsCurrentRef: ref, withProjectControlsEditMerged, reconcileScheduleProgressEdit,
    normalizeScheduleItem: (value: ScheduleItem) => ({ ...value }), displayName: 'David',
    resolveProjectItemWorkflowMutation: ({ candidate }: { candidate: ScheduleItem }) => ({ ok: true, item: candidate }),
    advanceScheduleItemSyncGeneration: () => 1, markScheduleItemsAuthorityReady: () => undefined,
    setScheduleItems: () => undefined, scheduleItemChangeUsesDebouncedSync: () => false, cancelScheduleItemTextSync: () => undefined,
    syncScheduleItemRevision: () => undefined, queueScheduleItemRecord: async () => undefined, Alert: { alert: () => undefined },
  };
  const mod = { exports: {} as unknown };
  new Function('module', 'exports', ...Object.keys(deps), js)(mod, mod.exports, ...Object.values(deps));
  jest.useFakeTimers({ now: new Date(at) });
  try { (mod.exports as (id: string, edit: Partial<ScheduleItem>) => void)(id, edit); } finally { jest.useRealTimers(); }
  return { ...state, items: ref.current };
}

/** The phone's handler for "Delete PDF Only", read from App.tsx: what it saves before it removes the file. */
const DELETE_PDF_ONLY = (() => {
  const from = APP_SOURCE.indexOf("text: 'Delete PDF Only'");
  return APP_SOURCE.slice(from, APP_SOURCE.indexOf("text: 'Delete PDF + Items'", from));
})();
/** "Delete PDF Only" as the phone does it: the helper's tasks, each saved with its two dates only, then the file goes. */
function deletePdfOnly(state: State, document: ReferenceDocument, at: string): State {
  expect(DELETE_PDF_ONLY).toContain('fileOnly: true }).forEach(item => updateScheduleItem(item.id, { startDate: item.startDate, finishDate: item.finishDate }))');
  let next = state;
  scheduleItemsAfterScheduleDeleted({ items: state.items, removed: [], document, documents: state.documents, fileOnly: true, updatedAt: at })
    .forEach(task => { next = phoneSave(next, task.id, { startDate: task.startDate, finishDate: task.finishDate }, at); });
  return { items: next.items, documents: next.documents.filter(other => other.id !== document.id) };
}

/** "Delete PDF + Items" as the phone does it (App.tsx), through the shared delete helper. */
function deleteWithItems(state: State, document: ReferenceDocument, at: string): State {
  const removed = scheduleItemsOnlyInImportBatch(state.items, document, state.documents.filter(scheduleDocumentIsScheduleLike));
  const removedIds = new Set(removed.map(item => item.id));
  const documents = state.documents.filter(other => other.id !== document.id);
  const kept = state.items.filter(item => !removedIds.has(item.id));
  const restored = new Map(scheduleItemsAfterScheduleDeleted({ items: kept, removed, document, documents, updatedAt: at }).map(item => [item.id, item]));
  return { items: kept.map(item => restored.get(item.id) || item), documents };
}

const M0 = schedule('MASTER M0', '2026-09-01T12:00:00.000Z');
const L1 = schedule('LOOKAHEAD L1', '2026-09-08T12:00:00.000Z', 'lookahead');
const L2 = schedule('LOOKAHEAD L2', '2026-09-15T12:00:00.000Z', 'lookahead');
const M1 = schedule('MASTER M1', '2026-09-22T12:00:00.000Z');
const L3 = schedule('LOOKAHEAD L3', '2026-09-29T12:00:00.000Z', 'lookahead');
const M2 = schedule('MASTER M2', '2026-10-06T12:00:00.000Z');
const FR = 'Framing,Alpha,Lot,10/01/2026,10/11/2026,';
const RO = 'Roof,Alpha,Lot,10/13/2026,10/21/2026,';
const DR = 'Drywall,Alpha,Lot,10/23/2026,11/02/2026,';
const ROOF_L1 = 'Roof,Alpha,Lot,10/15/2026,10/23/2026,';
const FRAMING_L2 = 'Framing,Alpha,Lot,10/02/2026,10/12/2026,';
const view = (state: State) => shown(state).map(item => `${item.taskName} ${dates(item)} ${item.percentComplete}% ${item.notes}`.trim()).sort();
const onM0 = approve(EMPTY, M0, [FR, RO, DR]);
const roofId = one(onM0, 'Roof').id;
/** His own 40% and a note on Roof, entered while M0 is the master. */
const withHis = phoneSave(phoneSave(onM0, roofId, { percentComplete: 40 }, '2026-09-02T09:00:00.000Z'), roofId, { notes: 'Deck delivered' }, '2026-09-02T09:05:00.000Z');
/** The reviewer's history: L1 moves Roof, L2 (Framing only) replaces L1. */
const replaced = (from: State) => approve(approve(from, L1, [ROOF_L1]), L2, [FRAMING_L2]);
/** Set Active on the phone (App.tsx activateReferenceDocument): the document is made current, the carried rows saved. */
function setActive(state: State, target: ReferenceDocument, at: string): State {
  const documents = scheduleDocumentsAfterActivation(target, state.documents, 'project', at);
  const carried = new Map(scheduleProgressCarriedOnActivation({ items: state.items, documentsBefore: state.documents, documentsAfter: documents, now: at }).map(item => [item.id, item]));
  return { items: state.items.map(item => carried.get(item.id) || item), documents };
}

describe('Review N2 P-b: a task the new master drops leaves the list, also when a replaced lookahead once listed it', () => {
  it('L1 moved Roof, L2 replaced L1, master M1 drops Roof: Roof leaves (it stayed, on M0\'s 10/13-10/21)', () => {
    const before = replaced(onM0);
    expect(dates(one(before, 'Roof'))).toBe('10/13/2026-10/21/2026');
    expect(view(approve(before, M1, [FR, DR]))).toEqual(['Drywall 10/23/2026-11/02/2026 0%', 'Framing 10/02/2026-10/12/2026 0%']);
  });

  it('and stays off the list through the next lookahead and the next master', () => {
    const onM1 = approve(replaced(onM0), M1, [FR, DR]);
    expect(named(approve(onM1, L3, ['Drywall,Alpha,Lot,10/24/2026,11/03/2026,']), 'Roof')).toEqual([]);
    expect(named(approve(onM1, M2, [FR, DR]), 'Roof')).toEqual([]);
  });

  it('as with no lookahead ever listing Roof', () => {
    expect(view(approve(onM0, M1, [FR, DR]))).toEqual(['Drywall 10/23/2026-11/02/2026 0%', 'Framing 10/01/2026-10/11/2026 0%']);
  });

  it('a renamed task: the old name leaves, the new one shows', () => {
    const onM1 = approve(replaced(onM0), M1, [FR, 'Roofing,Alpha,Lot,10/13/2026,10/21/2026,', DR]);
    expect(shown(onM1).map(item => item.taskName).sort()).toEqual(['Drywall', 'Framing', 'Roofing']);
  });

  it('same-named tasks: the one the master drops leaves and the ones it keeps stay, though all three share the name', () => {
    const POUR = ['Pour slab,Alpha,Lot,10/01/2026,10/05/2026,', 'Pour slab,Alpha,Lot,10/15/2026,10/19/2026,', 'Pour slab,Alpha,Lot,10/29/2026,11/02/2026,'];
    const three = approve(EMPTY, M0, [...POUR, FR]);
    // L1 moves the second two days; L2 (Framing only) replaces L1; master M1 lists the first and the third only.
    const before = approve(approve(three, L1, ['Pour slab,Alpha,Lot,10/17/2026,10/21/2026,']), L2, [FRAMING_L2]);
    expect(named(before, 'Pour slab').map(dates).sort()).toEqual(['10/01/2026-10/05/2026', '10/15/2026-10/19/2026', '10/29/2026-11/02/2026']);
    const onM1 = approve(before, M1, [POUR[0], POUR[2], FR]);
    expect(named(onM1, 'Pour slab').map(dates).sort()).toEqual(['10/01/2026-10/05/2026', '10/29/2026-11/02/2026']);
    // With no lookahead ever listing the second, the same.
    expect(named(approve(three, M1, [POUR[0], POUR[2], FR]), 'Pour slab').map(dates).sort()).toEqual(['10/01/2026-10/05/2026', '10/29/2026-11/02/2026']);
  });

  it('review N3 D: a same-named task a master dropped does not come back when a later master lists a row he called a new task', () => {
    // The reports reviewer's seed 241, in short. Two Pour slabs, A and B. A lookahead moves A (30%) and is replaced.
    // Master M1 lists only B, moved: A leaves. Master M2 lists two: he answers "10/25 is a new task; 11/01 is B".
    const two = approve(EMPTY, M0, ['Pour slab,Alpha,Lot,10/05/2026,10/09/2026,', 'Pour slab,Alpha,Lot,10/12/2026,10/16/2026,', FR]);
    const [a, b] = named(two, 'Pour slab').sort((left, right) => left.startDate.localeCompare(right.startDate));
    const onL2 = approve(approve(two, L1, ['Pour slab,Alpha,Lot,10/06/2026,10/10/2026,30'], 'Alpha', { [`${L1.id}-1`]: a.id }), L2, [FRAMING_L2]);
    expect(named(onL2, 'Pour slab').map(item => `${dates(item)} ${item.percentComplete}%`).sort()).toEqual(['10/05/2026-10/09/2026 30%', '10/12/2026-10/16/2026 0%']);
    const onM1 = approve(onL2, M1, ['Pour slab,Alpha,Lot,10/18/2026,10/22/2026,', FR], 'Alpha', { [`${M1.id}-1`]: b.id });
    expect(named(onM1, 'Pour slab').map(dates)).toEqual(['10/18/2026-10/22/2026']);
    const bNow = named(onM1, 'Pour slab')[0].id;
    const onM2 = approve(onM1, M2, ['Pour slab,Alpha,Lot,10/25/2026,10/29/2026,', 'Pour slab,Alpha,Lot,11/01/2026,11/05/2026,', FR], 'Alpha',
      { [`${M2.id}-1`]: null, [`${M2.id}-2`]: bNow });
    // (It was: A back on the list too, 10/05-10/09 at 30%, and the report said "Pour slab was reopened at 30% complete.")
    expect(named(onM2, 'Pour slab').map(item => `${dates(item)} ${item.percentComplete}%`).sort()).toEqual(['10/25/2026-10/29/2026 0%', '11/01/2026-11/05/2026 0%']);
    expect(onM2.items.find(item => item.id === a.id)).toMatchObject({ percentComplete: 30 });
  });

  it('the saved row is kept, hidden: nothing is deleted', () => {
    const onM1 = approve(replaced(withHis), M1, [FR, DR]);
    expect([saved(onM1, roofId).percentComplete, saved(onM1, roofId).notes]).toEqual([40, 'Deck delivered']);
  });
});

describe('Review N2 P-b: a lookahead still in effect that lists the task holds it, as before', () => {
  const held = approve(approve(onM0, L1, [ROOF_L1]), M1, [FR, DR]);

  it('L1 is the newest lookahead when M1 drops Roof: Roof stays, on L1\'s dates', () => {
    expect(view(held)).toEqual(['Drywall 10/23/2026-11/02/2026 0%', 'Framing 10/01/2026-10/11/2026 0%', 'Roof 10/15/2026-10/23/2026 0%']);
  });

  it('until a newer lookahead replaces L1: then Roof leaves', () => {
    expect(named(approve(held, L3, ['Drywall,Alpha,Lot,10/24/2026,11/03/2026,']), 'Roof')).toEqual([]);
  });

  it('deleting that newer lookahead with its items puts L1 back in effect, and Roof with it', () => {
    const back = deleteWithItems(approve(held, L3, ['Drywall,Alpha,Lot,10/24/2026,11/03/2026,']), L3, '2026-09-30T12:00:00.000Z');
    expect(named(back, 'Roof').map(dates)).toEqual(['10/15/2026-10/23/2026']);
  });

  it('a master task the current master still lists is untouched by its lookahead being replaced: the master\'s dates', () => {
    const onM1 = approve(replaced(onM0), M1, [FR, RO, DR]);
    expect(named(onM1, 'Roof').map(dates)).toEqual(['10/13/2026-10/21/2026']);
  });

  it('a detail task a lookahead added leaves when that lookahead is replaced, as before', () => {
    const added = approve(approve(onM0, L1, [ROOF_L1, 'Inspect rebar,Alpha,Lot,10/05/2026,10/07/2026,']), L2, [FRAMING_L2]);
    expect(named(added, 'Inspect rebar')).toEqual([]);
  });
});

describe('Review N2 P-b: his percent and note on such a task, exactly as when no lookahead ever listed it', () => {
  /** The same steps after two starts: Roof once listed by a lookahead since replaced, and never listed by one. */
  const both = (steps: (start: State) => State) => [steps(replaced(withHis)), steps(withHis)];
  const roofRows = (state: State) => named(state, 'Roof').map(item => `${dates(item)} ${item.percentComplete}% ${item.notes} ${item.owner}`.trim());

  it('dropped by M1: not listed in either', () => {
    const [once, never] = both(start => approve(start, M1, [FR, DR]));
    expect([roofRows(once), roofRows(never)]).toEqual([[], []]);
  });

  it('listed again by a later master: a new task at the file\'s percent in both (his 40% stays on the hidden row)', () => {
    const [once, never] = both(start => approve(approve(start, M1, [FR, DR]), M2, [FR, 'Roof,Alpha,Lot,10/20/2026,10/28/2026,', DR]));
    expect(roofRows(once)).toEqual(['10/20/2026-10/28/2026 0%']);
    expect(roofRows(never)).toEqual(roofRows(once));
    expect([saved(once, roofId).percentComplete, saved(never, roofId).percentComplete]).toEqual([40, 40]);
  });

  it('Set Active back to M0: Roof shows again with his 40% and note in both', () => {
    const [once, never] = both(start => setActive(approve(start, M1, [FR, DR]), M0, '2026-09-23T12:00:00.000Z'));
    expect(roofRows(once)).toEqual(['10/13/2026-10/21/2026 40% Deck delivered']);
    expect(roofRows(never)).toEqual(roofRows(once));
  });

  function report(state: State, known: DAVEReportSnapshot | null, now: string) {
    const truth = buildDAVEProjectTruth({
      projectId: 'report:alpha', projectName: 'Alpha', updates: [], scheduleItems: shown(state), projectAreas: [], referenceDocuments: state.documents, now,
      knownScheduleItems: state.items, knownScheduleDocuments: state.documents, reportLookaheadReplacement: true,
    });
    const fingerprint = buildDAVEReportSourceFingerprint([truth]);
    const briefing = buildDAVEReportBriefing({ truths: [truth], selectedProjectNames: ['Alpha'], previousSnapshot: reportBaselineSnapshot(known, fingerprint), scheduleItems: shown(state) });
    return {
      lines: briefing.reportingPeriod.changes.map(change => change.summary).sort(),
      snapshot: buildDAVEReportSnapshot({ truths: [truth], scopeKey: daveReportSnapshotScopeKey(['Alpha']), sourceFingerprint: fingerprint, capturedAt: now, reportFormat: 'project_manager' }),
    };
  }

  it('the report after M1 says the same of Roof in both: removed from the plan', () => {
    const lines = (start: State) => report(approve(start, M1, [FR, DR]), report(start, null, '2026-09-16T12:00:00.000Z').snapshot, '2026-09-23T12:00:00.000Z')
      .lines.filter(line => line.startsWith('Roof'));
    expect(lines(replaced(withHis))).toEqual(['Roof was removed from the current project plan.']);
    expect(lines(withHis)).toEqual(lines(replaced(withHis)));
  });

  it('held by the lookahead in effect when M1 dropped it, it leaves when that lookahead is replaced: the report says removed then', () => {
    const held = approve(approve(withHis, L1, [ROOF_L1]), M1, [FR, DR]);
    const whileHeld = report(held, null, '2026-09-23T12:00:00.000Z');
    const afterL3 = report(approve(held, L3, ['Drywall,Alpha,Lot,10/24/2026,11/03/2026,']), whileHeld.snapshot, '2026-09-30T12:00:00.000Z');
    expect(afterL3.lines.filter(line => line.startsWith('Roof'))).toEqual(['Roof was removed from the current project plan.']);
  });
});

describe('Review N2 P-b: what a replaced lookahead still holds, as before', () => {
  it('a row from a device that had not heard of the current master, which lists the task on its own row (Q25 with two devices)', () => {
    const G = schedule('MASTER G', '2026-09-05T12:00:00.000Z');
    const LA = schedule('LOOKAHEAD LA', '2026-09-08T12:00:00.000Z', 'lookahead');
    const LB = schedule('LOOKAHEAD LB', '2026-09-15T12:00:00.000Z', 'lookahead');
    // The phone approves G moving Roof; the iPad, not having heard, approves LA on M0's Roof. After Full Sync:
    const onG = approve(onM0, G, [FR, 'Roof,Alpha,Lot,10/16/2026,10/24/2026,', DR]);
    const ipad = approve(onM0, LA, ['Roof,Alpha,Lot,10/18/2026,10/26/2026,70']);
    const merged: State = { items: onG.items.map(item => (item.id === roofId ? ipad.items.find(other => other.id === roofId)! : item)), documents: [...onG.documents, LA] };
    const onLB = approve(merged, LB, ['Drywall,Alpha,Lot,10/24/2026,11/03/2026,']);
    expect(named(onLB, 'Roof').map(item => `${dates(item)} ${item.percentComplete}%`)).toEqual(['10/16/2026-10/24/2026 70%']);
  });

  it('a newer master\'s file that has arrived before any of its tasks: nothing is heard to be dropped, and a master approved then still carries his percent, note and owner', () => {
    // The iPad approved master M1 (Roof moved); the phone has M1's file, current, and none of M1's tasks yet. On the
    // phone Roof is the old row, which only the replaced L1 holds in the list.
    const before = replaced(phoneSave(withHis, roofId, { owner: 'Lee' }, '2026-09-02T09:10:00.000Z'));
    const fileOnly: State = { items: before.items, documents: scheduleDocumentsAfterActivation(M1, [...before.documents, M1], 'project') };
    expect(named(fileOnly, 'Roof').map(item => [item.id, item.percentComplete])).toEqual([[roofId, 40]]);
    // The phone approves the next master, which moves Roof: its new row is that task.
    const onM2 = approve(fileOnly, M2, [FR, 'Roof,Alpha,Lot,10/20/2026,10/28/2026,', DR]);
    expect(named(onM2, 'Roof').map(item => `${dates(item)} ${item.percentComplete}% ${item.notes} ${item.owner}`)).toEqual(['10/20/2026-10/28/2026 40% Deck delivered Lee']);
    // Once M1's tasks are here and M1 lists no Roof, Roof has been dropped: it leaves.
    const withRows: State = { items: approve(replaced(withHis), M1, [FR, DR]).items, documents: fileOnly.documents };
    expect(named(withRows, 'Roof')).toEqual([]);
  });

  it('one of the newer master\'s tasks has arrived and the rest not yet (Keep Cloud brings the one row its card is about): nothing is heard to be dropped', () => {
    // The iPad approved master M1, which moves all three tasks. The phone has M1's file, current, and of M1's tasks
    // only Framing's row. On the phone Roof is still the old row, which only the replaced L1 holds in the list.
    const before = replaced(phoneSave(withHis, roofId, { owner: 'Lee' }, '2026-09-02T09:10:00.000Z'));
    const onIpad = approve(before, M1, ['Framing,Alpha,Lot,10/03/2026,10/13/2026,', 'Roof,Alpha,Lot,10/16/2026,10/24/2026,', 'Drywall,Alpha,Lot,10/26/2026,11/05/2026,']);
    const m1Framing = onIpad.items.find(item => item.taskName === 'Framing' && item.importBatchId === M1.importBatchId)!;
    const oneRow: State = { items: [...before.items, m1Framing], documents: onIpad.documents };
    expect(named(oneRow, 'Roof').map(item => [item.id, item.percentComplete])).toEqual([[roofId, 40]]);
    // The phone approves the next master, which moves Roof: its new row is that task (it was saved new, at 0%, with no
    // note and no owner: the reviewer's generator, seeds 40225 and 40206 on 425390e).
    const onM2 = approve(oneRow, M2, [FR, 'Roof,Alpha,Lot,10/20/2026,10/28/2026,', DR]);
    expect(named(onM2, 'Roof').map(item => `${dates(item)} ${item.percentComplete}% ${item.notes} ${item.owner}`)).toEqual(['10/20/2026-10/28/2026 40% Deck delivered Lee']);
    // With all of M1's tasks here, Roof is M1's own row.
    expect(named(onIpad, 'Roof').map(item => `${dates(item)} ${item.percentComplete}%`)).toEqual(['10/16/2026-10/24/2026 40%']);
  });

  it('a replaced lookahead\'s own detail tasks are not tasks the master left out', () => {
    // L1 moved Roof and added two detail tasks; L2 replaced it; M1 lists Framing and Drywall and drops Roof. Two listed,
    // one left out: Roof leaves, and L1's detail tasks left when L1 was replaced.
    const withDetail = approve(approve(onM0, L1, [ROOF_L1, 'Inspect deck,Alpha,Lot,10/14/2026,10/15/2026,', 'Deliver trusses,Alpha,Lot,10/12/2026,10/13/2026,']), L2, [FRAMING_L2]);
    expect(view(approve(withDetail, M1, [FR, DR]))).toEqual(['Drywall 10/23/2026-11/02/2026 0%', 'Framing 10/02/2026-10/12/2026 0%']);
  });

  it('the limit of that: a master that lists fewer of the project\'s tasks than it leaves out is not heard to drop them', () => {
    // M1 lists Framing alone and leaves out Roof and Drywall. Drywall, which no lookahead listed, leaves as before;
    // Roof stays held by the replaced L1, as before this review.
    expect(view(approve(replaced(onM0), M1, [FR]))).toEqual(['Framing 10/02/2026-10/12/2026 0%', 'Roof 10/13/2026-10/21/2026 0%']);
  });

  it('a project with no master current: its tasks are held as before', () => {
    const before = replaced(onM0);
    const noMaster: State = { ...before, documents: before.documents.map(document => (document.id === M0.id ? { ...document, isCurrent: false } : document)) };
    expect(named(noMaster, 'Roof')).toHaveLength(1);
  });
});
