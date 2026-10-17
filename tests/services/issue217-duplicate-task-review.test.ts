import { reconcileDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';
import type { ScheduleItem } from '../../types';
import { scheduleImportPairingQuestions, mergeApprovedScheduleImportItems, scheduleProgressCarriedToShownTasks } from '../../services/ScheduleImportMerge';
import { scheduleImportPairingGuess, scheduleImportPairingChosen, scheduleImportPairingRefusal, withScheduleImportPairingChoices } from '../../components/schedule-import-pairing-check';
jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');
jest.mock('@react-native-async-storage/async-storage', () => ({getItem:jest.fn(),setItem:jest.fn(),removeItem:jest.fn()}));
jest.mock('expo-file-system/legacy', () => ({documentDirectory:null}));
const item = (id: string, day: number, extra: Partial<ScheduleItem> = {}): ScheduleItem => ({
 id, taskName: 'Inspect junction', projectName: 'Synthetic', locationName: 'Zone Q',
 startDate: `11/${String(day).padStart(2,'0')}/2026`, finishDate: `11/${String(day+1).padStart(2,'0')}/2026`,
 percentComplete: 0, status: 'Not Started', priority: 'Medium', notes: '', owner: '', contractor: '', milestone: '', durationDays: 2,
 importedFrom: 'synthetic.csv', importedAt: '2026-10-01T12:00:00Z', createdAt: '2026-10-01T12:00:00Z', updatedAt: '2026-10-01T12:00:00Z', ...extra,
});
const saved = [item('A',2,{updatedAt:'2026-10-02T12:00:00Z',progressSource:'project_manager',progressConfirmedAt:'2026-10-02T12:00:00Z',percentComplete:17,notes:'A-only',owner:'A owner'}),item('B',10,{updatedAt:'2026-10-02T12:00:00Z',progressSource:'project_manager',progressConfirmedAt:'2026-10-02T12:00:00Z',percentComplete:43,notes:'B-only',owner:'B owner'}),item('C',23,{updatedAt:'2026-10-02T12:00:00Z',progressSource:'project_manager',progressConfirmedAt:'2026-10-02T12:00:00Z',percentComplete:71,notes:'C-only',owner:'C owner'})];
const rows = [item('row-B',6),item('row-C',17),item('row-D',29)];
const merge = (existing: ScheduleItem[], imported: ScheduleItem[], overlay=false, pairingChoices?: Record<string,string|null>) => {
 const result = mergeApprovedScheduleImportItems({existing,imported,overlay,pairingChoices,completionMatch:()=>null,mergeCompletion:x=>x,approvedAt:'2026-10-17T12:00:00Z'});
 return reconcileDAVEScheduleRecords([...result.next,...result.additions]);
};
test('equal count master drop, moves and addition must ask before annotations can follow',()=>{
 const questions=scheduleImportPairingQuestions({existing:saved,imported:rows});
 expect(questions).toHaveLength(1);
 const q=questions[0];
 let answer=scheduleImportPairingGuess(q);
 expect(scheduleImportPairingRefusal(questions,()=>answer)).toContain('Confirm');
 answer=scheduleImportPairingChosen(answer,'A',null);
 answer=scheduleImportPairingChosen(answer,'B','row-B');
 answer=scheduleImportPairingChosen(answer,'C','row-C');
 expect(scheduleImportPairingRefusal(questions,()=>answer)).toBeNull();
 const choices=withScheduleImportPairingChoices({pairingChoices:{unrelated:'prior'}},questions,()=>answer).pairingChoices;
 expect(choices).toEqual({unrelated:'prior','row-B':'B','row-C':'C','row-D':null});
 const merged=merge(saved,rows,false,choices);
 const current=merged.filter(x=>rows.some(row=>row.id===x.id));
 const carried=new Map(scheduleProgressCarriedToShownTasks({before:saved,after:current,known:merged,now:'2026-10-17T12:00:00Z'}).map(x=>[x.id,x]));
 const result=current.map(x=>carried.get(x.id)||x);
 expect(result.find(x=>x.id==='row-B')).toMatchObject({startDate:'11/06/2026',progressSource:'project_manager',progressConfirmedAt:'2026-10-02T12:00:00Z',percentComplete:43,notes:'B-only',owner:'B owner'});
 expect(result.find(x=>x.id==='row-C')).toMatchObject({startDate:'11/17/2026',progressSource:'project_manager',progressConfirmedAt:'2026-10-02T12:00:00Z',percentComplete:71,notes:'C-only'});
 expect(result.find(x=>x.id==='row-D')).toMatchObject({percentComplete:0,notes:''});
});
test.each([false,true])('crossing lookahead asks even with unrelated row-number IDs (%s)',identified=>{
 const existing=[item('A',2,{notes:'A-only',sourceUniqueId:identified?'1':undefined}),item('B',14,{notes:'B-only',sourceUniqueId:identified?'2':undefined})];
 const incoming=[item('lookahead-A',10,{sourceUniqueId:identified?'2':undefined})];
 const qs=scheduleImportPairingQuestions({existing,imported:incoming,overlay:true});
 expect(qs).toHaveLength(1);
 let answer=scheduleImportPairingChosen(scheduleImportPairingGuess(qs[0]),'A','lookahead-A');
 expect(answer.rowOfSaved.B).toBeNull();
 const choices=withScheduleImportPairingChoices({pairingChoices:null as Record<string,string|null>|null},qs,()=>answer).pairingChoices!;
 const result=merge(existing,incoming,true,choices);
 expect(result.find(x=>x.id==='A')?.startDate).toBe('11/10/2026');
 expect(result.find(x=>x.id==='B')?.startDate).toBe('11/14/2026');
});
test('ordinary duplicate slips ask; singleton and unchanged identical twins retain explicit existing policy',()=>{
 expect(scheduleImportPairingQuestions({existing:[item('A',2),item('B',14)],imported:[item('rA',3),item('rB',15)]})).toHaveLength(1);
 expect(scheduleImportPairingQuestions({existing:[item('A',2)],imported:[item('rA',20)]})).toHaveLength(0);
 expect(scheduleImportPairingQuestions({existing:[item('A',5),item('B',5)],imported:[item('rA',5),item('rB',5)]})).toHaveLength(0);
});
test('complete distinct master persistent IDs still settle changed twins',()=>{
 expect(scheduleImportPairingQuestions({existing:saved.map((x,i)=>({...x,sourceUniqueId:String(i+1)})),imported:rows.map((x,i)=>({...x,sourceUniqueId:String(i+2)}))})).toHaveLength(0);
});

test('partial and repeated master IDs cannot suppress changed twin review',()=>{
 for(const ids of [['1','1','1'],['1',undefined,'3']]) {
  expect(scheduleImportPairingQuestions({existing:saved.map((x,i)=>({...x,sourceUniqueId:ids[i]})),imported:rows.map((x,i)=>({...x,sourceUniqueId:ids[i]}))})).toHaveLength(1);
 }
});
test('UI reassignment remains one-to-one; explicit New refuses old annotations and stores nonrevision',()=>{
 const questions=scheduleImportPairingQuestions({existing:saved,imported:rows});
 let answer=scheduleImportPairingGuess(questions[0]);
 answer=scheduleImportPairingChosen(answer,'A','row-B');
 answer=scheduleImportPairingChosen(answer,'B','row-B');
 expect(answer.rowOfSaved.A).toBeNull();
 answer=scheduleImportPairingChosen(answer,'B',null);
 answer=scheduleImportPairingChosen(answer,'C',null);
 const choices=withScheduleImportPairingChoices({pairingChoices:null as Record<string,string|null>|null},questions,()=>answer).pairingChoices!;
 expect(Object.values(choices)).toEqual([null,null,null]);
 const result=merge(saved,rows,false,choices);
 for(const row of rows) expect(result.find(x=>x.id===row.id)).toMatchObject({notes:'',percentComplete:0,notRevisionOfTaskIds:expect.arrayContaining(['A','B','C'])});
});

test('a master does not treat lookahead-only source numbers as its persistent ID namespace',()=>{
 const lookaheadOnly=saved.map((x,i)=>({...x,importedAsLookahead:true,importBatchId:'lookahead-only',sourceUniqueId:String(i+1)}));
 const incoming=rows.map((x,i)=>({...x,sourceUniqueId:String(i+1)}));
 expect(scheduleImportPairingQuestions({existing:lookaheadOnly,imported:incoming})).toHaveLength(1);
});
