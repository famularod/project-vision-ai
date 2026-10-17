/** Issue 2.8: a master omits Roof, a lookahead adds it, and the next master lists it.
 * Synthetic CSV through production import/review/activation APIs and UI choice helpers.
 * The earlier identity is offered explicitly; no hidden facts are guessed or moved unasked.
 */
import { scheduleImportPairingGuess, scheduleImportPairingChosen, withScheduleImportPairingChoices } from '../../components/schedule-import-pairing-check';
import { reviseProjectControls } from '../../services/VitruviusProjectControls';
jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');
import { reconcileDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport, scheduleImportReviewPairingQuestions } from '../../services/ScheduleImportMerge';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';
import type { ReferenceDocument, ScheduleItem } from '../../types';
jest.mock('@react-native-async-storage/async-storage', () => ({getItem: jest.fn(async()=>null),setItem:jest.fn(async()=>undefined),removeItem:jest.fn(async()=>undefined),getAllKeys:jest.fn(async()=>[]),multiGet:jest.fn(async()=>[])}));
jest.mock('expo-file-system/legacy', () => ({documentDirectory:null}));
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


const FR='Framing,Alpha,Lot,10/01/2026,10/11/2026,';
const DR='Drywall,Alpha,Lot,10/23/2026,11/02/2026,';
const RO='Roof,Alpha,Lot,10/13/2026,10/21/2026,';
const M0=schedule('M0','2026-09-01T12:00:00.000Z');
const M1=schedule('M1','2026-09-08T12:00:00.000Z');
const L=schedule('L','2026-09-15T12:00:00.000Z','lookahead');
const M2=schedule('M2','2026-09-22T12:00:00.000Z');
const start=approve(EMPTY,M0,[FR,RO,DR]);
const old=one(start,'Roof');
const edited={...start,items:start.items.map(i=>i.id===old.id?{...i,percentComplete:40,notes:'Deck delivered',owner:'Lee',progressSource:'project_manager' as const,progressConfirmedAt:'2026-09-02T12:00:00.000Z',projectControls:reviseProjectControls({current:i.projectControls,patch:{priority:'High'},actor:'David',now:'2026-09-02T12:00:00.000Z'})}:i)};
const dropped=approve(edited,M1,[FR,DR]);
const relisted=approve(dropped,L,['Roof,Alpha,Lot,10/16/2026,10/24/2026,']);
const incoming=rows(M2,[FR,'Roof,Alpha,Lot,10/20/2026,10/28/2026,',DR]);
const questions=(state:State)=>scheduleImportReviewPairingQuestions({saved:state.items,documents:[...state.documents,M2],importBatchId:M2.importBatchId!,imported:incoming});
it('2.8 asks about hidden earlier task despite the lookahead row currently shown',()=>{
 expect(named(dropped,'Roof')).toHaveLength(0);
 expect(one(relisted,'Roof').percentComplete).toBe(0);
 const q=questions(relisted).find(q=>q.taskName==='Roof');
 expect(q).toBeDefined();
 expect(q!.saved.map(i=>i.id)).toContain(old.id);
 expect(q!.earlierIds).toContain(old.id);
 expect(q!.guess[incoming[1].id]).toBe(one(relisted,'Roof').id);
});
it('2.8 explicit same-task answer preserves percent and typed text in current task',()=>{
 const result=approve(relisted,M2,[FR,'Roof,Alpha,Lot,10/20/2026,10/28/2026,',DR],'Alpha',choicesForOld());
 expect(named(result,'Roof')).toHaveLength(1);
 expect(one(result,'Roof')).toMatchObject({percentComplete:40,notes:'Deck delivered',owner:'Lee'});
});

function choicesForOld() {
 const q=questions(relisted).find(q=>q.taskName==='Roof')!;
 let answer=scheduleImportPairingGuess(q);
 answer=scheduleImportPairingChosen(answer,old.id,incoming[1].id);
 return withScheduleImportPairingChoices({pairingChoices:null},[q],()=>({...answer,confirmed:true})).pairingChoices!;
}
it('review UI choices preserve priority and lineage as well as text',()=>{
 const result=approve(relisted,M2,[FR,'Roof,Alpha,Lot,10/20/2026,10/28/2026,',DR],'Alpha',choicesForOld());
 expect(one(result,'Roof').projectControls).toEqual(edited.items.find(i=>i.id===old.id)!.projectControls);
 expect(one(result,'Roof').revisedFromTaskIds).toContain(old.id);
});
it('unanswered import still carries no hidden facts',()=>{
 const result=approve(relisted,M2,[FR,'Roof,Alpha,Lot,10/20/2026,10/28/2026,',DR]);
 expect(one(result,'Roof').percentComplete).toBe(0);
 expect(one(result,'Roof').notes||'').toBe('');
});
it('choosing new work keeps earlier facts hidden and records refusal',()=>{
 const result=approve(relisted,M2,[FR,'Roof,Alpha,Lot,10/20/2026,10/28/2026,',DR],'Alpha',{[incoming[1].id]:null});
 expect(one(result,'Roof').percentComplete).toBe(0);
 expect(one(result,'Roof').notRevisionOfTaskIds).toContain(old.id);
});
it('master-only return remains an explicit earlier-task question',()=>{
 expect(questions(dropped).find(q=>q.taskName==='Roof')!.returning).toBe(true);
});
it('Unique IDs settle earlier identity without an extra question',()=>{
 const identified={...relisted,items:relisted.items.map(i=>i.id===old.id?{...i,sourceUniqueId:'roof-42'}:i)};
 const ids=incoming.map(i=>i.taskName==='Roof'?{...i,sourceUniqueId:'roof-42'}:i);
 expect(scheduleImportReviewPairingQuestions({saved:identified.items,documents:identified.documents,importBatchId:M2.importBatchId!,imported:ids})).toEqual([]);
});
it('a refused earlier identity is not offered again',()=>{
 const refused={...relisted,items:relisted.items.map(i=>i.id===one(relisted,'Roof').id?{...i,notRevisionOfTaskIds:[old.id]}:i)};
 expect(questions(refused)).toEqual([]);
});
