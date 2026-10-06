/**
 * Review N2 P1, second part (5 Oct 2026): the owners and notes that imports
 * made before the fix (Build 229 and earlier) already left on hidden rows of
 * David's devices. The hidden row a task shown came from is known reliably
 * only by the ids its row answers to (revisedFromTaskIds), and a blank on
 * the task shown cannot be told from a note he cleared. So an owner, a
 * contractor or a note comes forward only where both can be told and no
 * device writes a row it would not write anyway: when a master next moves a
 * task that was never changed since its import, its new row reads them back
 * through rows never changed either. A task that stays on its row is left
 * as it is by the approval (filling it in place there made two devices write
 * the same change and meet in Review Conflicts); the sync's carry brings it
 * forward at the next refresh, sent as those fields alone
 * (review-n2-sched-typed-text-carried-between-devices). The real CSV
 * normalizer, the phone's merge, the shown-schedule pick, the web's plan and
 * the report. Synthetic data.
 */
import { buildDAVEProjectTruth } from '../../services/DAVEProjectTruth';
import { buildDAVEReportBriefing, buildDAVEReportSourceFingerprint } from '../../services/DAVEReportIntelligence';
import { buildDAVEReportSnapshot, daveReportSnapshotScopeKey, reportBaselineSnapshot, type DAVEReportSnapshot } from '../../services/DAVEReportSnapshot';
import { reconcileDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';
import { planDAVEWebScheduleImport } from '../../services/DAVEWebOperations';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { scheduleDocumentIsScheduleLike, selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import { scheduleItemsOnlyInImportBatch } from '../../services/ScheduleImportProvenance';
import { scheduleItemsAfterScheduleDeleted } from '../../services/ScheduleLookahead';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';
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
const typed = (item: ScheduleItem) => [item.owner, item.contractor, item.notes];
const saved = (state: State, id: string) => state.items.find(item => item.id === id)!;

const schedule = (id: string, importedAt: string, role?: 'lookahead'): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`, ...(role ? { scheduleRole: role } : {}),
}) as ReferenceDocument;
function rows(source: ReferenceDocument, lines: string[]): ScheduleItem[] {
  return (normalizeScheduleImport({
    contents: ['Task,Project,Area,Start,Finish,Percent Complete', ...lines].join('\n'), sourceName: source.originalFileName,
    mimeType: 'text/csv', projects: ['Alpha'], projectAreas: [], now: new Date(source.importedAt),
  }).items as ScheduleItem[]).map((item, index) => ({
    ...item, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id,
  }));
}
/** Approving a schedule on the phone (App.tsx): the merge, then a master is made current, a lookahead added. */
function approve(state: State, source: ReferenceDocument, lines: string[]): State {
  const lookahead = source.scheduleRole === 'lookahead';
  const merged = mergeApprovedScheduleImportItems({
    existing: state.items, imported: rows(source, lines), completionMatch: () => null, mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(state.items, [...state.documents, source], source.importBatchId || ''),
    approvedAt: source.importedAt, overlay: lookahead,
  });
  return {
    items: reconcileDAVEScheduleRecords([...merged.additions, ...merged.next]),
    documents: lookahead ? [...state.documents, source] : scheduleDocumentsAfterActivation(source, [...state.documents, source], 'project'),
  };
}
/** A task edit on the phone or the web: the fields given on the saved row, stamped. */
function patch(state: State, id: string, change: Partial<ScheduleItem>, at: string): State {
  return {
    ...state,
    items: state.items.map(item => item.id === id ? {
      ...item, ...change,
      ...(typeof change.percentComplete === 'number' ? {
        status: change.percentComplete >= 100 ? 'Complete' : 'In Progress', progressSource: 'project_manager',
        progressConfirmedAt: at, progressConfirmedBy: 'David',
      } : {}),
      updatedAt: at,
    } as ScheduleItem : item),
  };
}
/**
 * The same approval as Build 229 saved it: the row a master moved a task to came in with the file's blank owner,
 * contractor and note, unstamped, while the task's own stayed on the old row.
 */
function approveAsBuild229(state: State, source: ReferenceDocument, lines: string[]): State {
  const before = new Set(state.items.map(item => item.id));
  const after = approve(state, source, lines);
  return { ...after, items: after.items.map(item => (before.has(item.id) ? item : { ...item, owner: '', contractor: '', notes: '' })) };
}

const F = schedule('MASTER F', '2026-09-07T12:00:00.000Z');
const G = schedule('MASTER G', '2026-09-14T12:00:00.000Z');
const H = schedule('MASTER H', '2026-09-21T12:00:00.000Z');
const I = schedule('MASTER I', '2026-09-28T12:00:00.000Z');
const L = schedule('LOOKAHEAD L', '2026-09-22T12:00:00.000Z', 'lookahead');
const FRAMING_F = 'Framing,Alpha,Lot,10/01/2026,10/11/2026,';
const FRAMING_G = 'Framing,Alpha,Lot,10/05/2026,10/15/2026,';
const FRAMING_H = 'Framing,Alpha,Lot,10/07/2026,10/17/2026,';
const FRAMING_I = 'Framing,Alpha,Lot,10/09/2026,10/19/2026,';
const ROOF = 'Roof,Alpha,Lot,10/13/2026,10/21/2026,';
const MIKE = ['Mike', 'Acme Framing', 'Crew short Tuesday'];
const NONE = ['', '', ''];

const onF = approve(EMPTY, F, [FRAMING_F, ROOF]);
const framingF = one(onF, 'Framing').id;
const withNote = patch(onF, framingF, { notes: 'Crew short Tuesday', owner: 'Mike', contractor: 'Acme Framing' }, '2026-09-08T09:00:00.000Z');
/** On his devices today: master G moved Framing on Build 229, and his owner and note stayed on F's hidden row. */
const stranded = approveAsBuild229(withNote, G, [FRAMING_G, ROOF]);
const framingG = one(stranded, 'Framing').id;

describe('Review N2 P1, second part: an owner and a note stranded on a hidden row by an earlier import', () => {
  it('the state Build 229 left: the task shown has none, its hidden old row holds them, and the row answers to it', () => {
    expect(framingG).not.toBe(framingF);
    expect(typed(one(stranded, 'Framing'))).toEqual(NONE);
    expect(one(stranded, 'Framing').updatedAt ?? null).toBeNull();
    expect(one(stranded, 'Framing').revisedFromTaskIds).toEqual([framingF]);
    expect(typed(saved(stranded, framingF))).toEqual(MIKE);
  });

  it('the next master that moves the task: its new row has them', () => {
    const onH = approve(stranded, H, [FRAMING_H, ROOF]);
    const framing = one(onH, 'Framing');
    expect(framing.id).not.toBe(framingG);
    expect([dates(framing), ...typed(framing)]).toEqual(['10/07/2026-10/17/2026', ...MIKE]);
    // Roof, with nothing ever typed on it, gains nothing; and no other saved row is written.
    expect(typed(one(onH, 'Roof'))).toEqual(NONE);
    expect(onH.items.filter(item => item.id === framingG || item.id === framingF)).toEqual(stranded.items.filter(item => item.id === framingG || item.id === framingF));
  });

  it('two masters since he typed them, both on Build 229: the third master\'s row reads back through the row between', () => {
    const twice = approveAsBuild229(stranded, H, [FRAMING_H, ROOF]);
    expect(typed(one(twice, 'Framing'))).toEqual(NONE);
    expect(one(twice, 'Framing').revisedFromTaskIds).toEqual([framingF, framingG]);
    const onI = approve(twice, I, [FRAMING_I, ROOF]);
    expect([dates(one(onI, 'Framing')), ...typed(one(onI, 'Framing'))]).toEqual(['10/09/2026-10/19/2026', ...MIKE]);
  });

  it('only a blank is filled: what the task shown has stands, and the file\'s value over both', () => {
    // The web's upload on Build 229 saved the new row unstamped with the file's owner.
    const withOwner: State = { ...stranded, items: stranded.items.map(item => item.id === framingG ? { ...item, owner: 'Dana' } : item) };
    expect(typed(one(approve(withOwner, H, [FRAMING_H, ROOF]), 'Framing'))).toEqual(['Dana', 'Acme Framing', 'Crew short Tuesday']);
  });

  it('once it has gone with the task, a note he then clears stays cleared when the task moves again', () => {
    const onH = approve(stranded, H, [FRAMING_H, ROOF]);
    const cleared = patch(onH, one(onH, 'Framing').id, { notes: '' }, '2026-09-22T09:00:00.000Z');
    expect(typed(one(approve(cleared, I, [FRAMING_I, ROOF]), 'Framing'))).toEqual(['Mike', 'Acme Framing', '']);
  });

  it('left untouched, it keeps them when the task moves again (the rule for every moved task)', () => {
    const onI = approve(approve(stranded, H, [FRAMING_H, ROOF]), I, [FRAMING_I, ROOF]);
    expect(typed(one(onI, 'Framing'))).toEqual(MIKE);
  });
});

describe('Review N2 P1, second part: a task that stays on its row is left as it is by the approval', () => {
  // Filling it in place was tried and taken out: each device made the fill at its own next approval, and the two copies
  // of the same change met in Review Conflicts (the reviewer's generator, seed 20137). No row is written here that the
  // import would not write anyway; the sync's carry does it at the next refresh.
  it('a master that leaves the task on its dates writes nothing on it beyond its own import', () => {
    const onH = approve(stranded, H, [FRAMING_G, 'Roof,Alpha,Lot,10/15/2026,10/23/2026,']);
    const framing = one(onH, 'Framing');
    expect([framing.id, ...typed(framing), framing.updatedAt ?? null]).toEqual([framingG, ...NONE, null]);
    expect(typed(saved(onH, framingF))).toEqual(MIKE);
  });

  it('a lookahead that does not list the task changes no saved copy of it', () => {
    const onL = approve(stranded, L, ['Roof,Alpha,Lot,10/14/2026,10/22/2026,']);
    expect(saved(onL, framingG)).toEqual(saved(stranded, framingG));
  });
});

describe('Review N2 P1, second part: what is not brought forward, because it cannot be told from a blank he left', () => {
  it('a task he has changed since the master moved it (a percent): its blank stands when it moves', () => {
    const edited = patch(stranded, framingG, { percentComplete: 30 }, '2026-09-16T09:00:00.000Z');
    const onH = approve(edited, H, [FRAMING_H, ROOF]);
    expect([one(onH, 'Framing').percentComplete, ...typed(one(onH, 'Framing'))]).toEqual([30, ...NONE]);
    // The old row still holds them: nothing is lost that was there before.
    expect(typed(saved(onH, framingF))).toEqual(MIKE);
  });

  it('a note he cleared on the task after this fix carried it: not read back from the old row', () => {
    const onG = approve(withNote, G, [FRAMING_G, ROOF]);
    const cleared = patch(onG, one(onG, 'Framing').id, { notes: '', owner: '', contractor: '' }, '2026-09-16T09:00:00.000Z');
    expect(typed(one(approve(cleared, H, [FRAMING_H, ROOF]), 'Framing'))).toEqual(NONE);
  });

  it('a row between that he edited: its blank stands, and the walk back stops there', () => {
    // He cleared everything on G's row; master H then moved the task on Build 229 (H's row blank, unstamped).
    const onG = approve(withNote, G, [FRAMING_G, ROOF]);
    const cleared = patch(onG, one(onG, 'Framing').id, { notes: '', owner: '', contractor: '' }, '2026-09-16T09:00:00.000Z');
    const onH = approveAsBuild229(cleared, H, [FRAMING_H, ROOF]);
    expect(typed(one(approve(onH, I, [FRAMING_I, ROOF]), 'Framing'))).toEqual(NONE);
  });

  it('a row between that was deleted: what he did there is unknown, so nothing is read past it', () => {
    const twice = approveAsBuild229(stranded, H, [FRAMING_H, ROOF]);
    // Master G deleted with its items: G's row of Framing is gone.
    const removed = scheduleItemsOnlyInImportBatch(twice.items, G, twice.documents.filter(scheduleDocumentIsScheduleLike));
    expect(removed.map(item => item.id)).toContain(framingG);
    const removedIds = new Set(removed.map(item => item.id));
    const documents = twice.documents.filter(document => document.id !== G.id);
    const kept = twice.items.filter(item => !removedIds.has(item.id));
    const restored = new Map(scheduleItemsAfterScheduleDeleted({ items: kept, removed, document: G, documents, updatedAt: '2026-09-23T12:00:00.000Z' }).map(item => [item.id, item]));
    const withoutG: State = { items: kept.map(item => restored.get(item.id) || item), documents };
    expect(typed(saved(withoutG, framingF))).toEqual(MIKE);
    expect(typed(one(approve(withoutG, I, [FRAMING_I, ROOF]), 'Framing'))).toEqual(NONE);
  });

  it('two same-named tasks answering to one old row: neither takes its note', () => {
    const twins = approveAsBuild229(withNote, G, [FRAMING_G, 'Framing,Alpha,Lot,10/20/2026,10/30/2026,', ROOF]);
    const answering = twins.items.filter(item => item.taskName === 'Framing' && item.id !== framingF)
      .map(item => ({ ...item, revisedFromTaskIds: [framingF] }));
    const both: State = { ...twins, items: [...twins.items.filter(item => !(item.taskName === 'Framing' && item.id !== framingF)), ...answering] };
    expect(named(both, 'Framing')).toHaveLength(2);
    // Master H moves both a week.
    const onH = approve(both, H, ['Framing,Alpha,Lot,10/12/2026,10/22/2026,', 'Framing,Alpha,Lot,10/27/2026,11/06/2026,', ROOF]);
    expect(named(onH, 'Framing').map(item => [dates(item), ...typed(item)]).sort()).toEqual([['10/12/2026-10/22/2026', ...NONE], ['10/27/2026-11/06/2026', ...NONE]]);
  });

  it('a row saved before rows kept the ids they answer to: never guessed by name', () => {
    const unlinked: State = { ...stranded, items: stranded.items.map(item => { const { revisedFromTaskIds: _ids, ...rest } = item; return item.id === framingG ? rest as ScheduleItem : item; }) };
    expect(typed(one(approve(unlinked, H, [FRAMING_H, ROOF]), 'Framing'))).toEqual(NONE);
  });

  it('the web\'s upload is offered only the tasks the web shows, so its new row reads nothing back; a master approved on the phone does', () => {
    const webItems = shown(stranded).map(item => ({ ...item, cloudUpdatedAt: item.updatedAt ?? null })) as DAVEWebScheduleItem[];
    const W = { ...schedule('WEB W', H.importedAt), isCurrent: false, webFileFingerprint: 'w'.repeat(64) } as ReferenceDocument;
    const plan = planDAVEWebScheduleImport({ snapshot: { scheduleItems: webItems }, importedScheduleItems: rows(W, [FRAMING_H, ROOF]) });
    expect(plan.additions.map(item => [item.taskName, dates(item), ...typed(item)])).toEqual([['Framing', '10/07/2026-10/17/2026', ...NONE]]);
  });
});

describe('Review N2 P1, second part: what the next report says of an owner brought forward', () => {
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

  it('the last report showed the task unassigned, so this one says the owner changed to Mike, once, beside the date change', () => {
    const before = report(stranded, null, '2026-09-18T12:00:00.000Z');
    const onH = approve(stranded, H, [FRAMING_H, ROOF]);
    const after = report(onH, before.snapshot, '2026-09-22T12:00:00.000Z');
    expect(after.lines).toEqual(['Framing finish changed from 10/15/2026 to 10/17/2026.', 'Framing owner changed from unassigned to Mike.']);
    expect(report(approve(onH, I, [FRAMING_H, ROOF]), after.snapshot, '2026-09-29T12:00:00.000Z').lines).toEqual([]);
  });
});
