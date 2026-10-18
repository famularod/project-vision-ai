/** 3.30 (also 4.82) and 7.39: real reporter/Core/runtime, native cards, Word and desktop outputs. Synthetic records only. */
jest.mock('expo-file-system/legacy',()=>({documentDirectory:null}));
jest.mock('@react-native-async-storage/async-storage',()=>({__esModule:true,default:{getItem:jest.fn(async()=>null),setItem:jest.fn(async()=>{}),removeItem:jest.fn(async()=>{}),getAllKeys:jest.fn(async()=>[]),multiGet:jest.fn(async()=>[])}}));
jest.mock('../../services/SupabaseService',()=>({loadReportSnapshotCloud:jest.fn(async()=>({ok:true,configured:true,data:null,stubbed:true})),saveReportSnapshotCloud:jest.fn(async()=>({ok:true,configured:true,data:null,stubbed:true}))}));
let mockAuthority:any;
jest.mock('../../providers/PIELiveAuthorityProvider',()=>({usePIELiveAuthority:()=>mockAuthority,useOptionalPIELiveAuthority:()=>mockAuthority}));
jest.mock('react-native-reanimated',()=>({getUseOfValueInStyleWarning:()=>''}));
import React from 'react';
import {act,render,screen,waitFor} from '@testing-library/react-native';
import JSZip from 'jszip';
import {ReportsScreen} from '../../screens/ReportsScreen';
import {buildDailyProjectUpdate,cleanReportWorkAreaName,printedReportWorkAreaName} from '../../services/PIEReporter';
import {buildRuntime} from '../../services/PIERuntime';
import {buildPIECoreIntelligence} from '../../services/PIECoreIntelligence';
import {buildDAVEWebReportDraft,formatDAVEWebReport,buildDAVEWebReportSource} from '../../services/DAVEWebOperations';
import {buildReportWordBase64} from '../../services/ReportWordDocument';
import {forgetAllReportSessionState} from '../../services/ReportSessionState';
const NOW='2026-10-17T12:00:00Z',PROJECT='Birch Lane',ID='11111111-1111-4111-8111-111111111111';
function world(text='Lane closure moved to 10/20/2026.',area='',taskName='Inspect 2026',project=PROJECT){
 const tasks:any[]=taskName?[{id:'task-year',projectId:ID,projectName:project,scheduleProjectName:project,locationName:'Site',taskName,startDate:'10/01/2026',finishDate:'10/19/2026',milestone:'',owner:'Pat',contractor:'Crew',percentComplete:20,status:'In Progress',priority:'Medium',notes:'',createdAt:'2026-10-01T12:00:00Z'}]:[];
 const updates:any[]=[{id:'own-note',projectId:ID,projectName:project,scheduleProjectName:project,date:'2026-10-16T12:00:00Z',notes:text,selectedAreaName:area,photos:[],recipients:{contactIds:[]},status:'sent'}];
 const ctx:any={projectName:project,projectNames:[project],reportType:'daily_project_update',updates,scheduleItems:tasks,knownScheduleItems:tasks,currentUpdate:null,projectAreas:[],contacts:{contacts:[]},referenceDocuments:[],surface:'reports',now:new Date(NOW)};
 const runtime=buildRuntime(ctx),core=buildPIECoreIntelligence({runtimeContext:ctx,reportType:'daily_project_update',reportProjectNames:[project],organizationId:'local-unverified-anonymous',projectId:ID} as any);
 const input={selectedProjectNames:[project],savedUpdates:updates,scheduleItems:tasks,generatedAt:new Date(NOW)};
 const direct=buildDailyProjectUpdate(input),snapshot:any={projects:[{id:ID,name:project}],scheduleItems:tasks,knownScheduleItems:tasks,projectUpdates:updates.map(updateData=>({id:updateData.id,updateData})),referenceDocuments:[],projectAreas:[],refreshedAt:NOW,tasksPulledAt:NOW};
 return {tasks,updates,ctx,runtime,core,input,direct,snapshot};
}
const areas=(r:any):any[]=>r.locationGroups.flatMap((g:any)=>g.workAreas);
const noteAreas=(r:any,text:string)=>areas(r).filter(a=>a.bullets.some((b:any)=>b.text===text));
const bullets=(r:any)=>areas(r).flatMap(a=>a.bullets.map((b:any)=>({id:b.id,text:b.text,kind:b.kind,sources:b.sourceEvidenceIds})));
beforeEach(()=>{forgetAllReportSessionState();jest.useFakeTimers({now:new Date(NOW),doNotFake:['nextTick','setImmediate','setInterval','setTimeout','clearTimeout','clearInterval','queueMicrotask']})});
afterEach(()=>jest.useRealTimers());
jest.setTimeout(120000);
it.each(['Inspect 2026','2026 inspection','Unit 2026 punch list'])('3.30 actual runtime and Core do not let %s rename an unassigned dated note',taskName=>{
 const w=world(undefined,'',taskName),text=w.updates[0].notes,before=JSON.stringify({updates:w.updates,tasks:w.tasks});
 expect(noteAreas(w.direct,text).map(a=>a.title)).toEqual([PROJECT]);
 expect(noteAreas(w.runtime.response.reportDraft,text).map(a=>a.title)).toEqual([PROJECT]);
 expect(noteAreas(w.core.reportDraft,text).map(a=>a.title)).toEqual([PROJECT]);
 const web=formatDAVEWebReport(buildDAVEWebReportDraft(w.snapshot,PROJECT),'project_manager');
 expect(web).toContain(taskName);expect(web).not.toContain('2026 Birch Lane');
 expect(JSON.stringify({updates:w.updates,tasks:w.tasks})).toBe(before);
});
it('3.30 actual Core advice alone cannot rename the same saved note; all printed lines retain exact words/order',()=>{
 const w=world();const advised=buildDailyProjectUpdate({...w.input,runtime:{situationIntelligence:w.core.situationIntelligence}} as any);
 expect(advised.sourceEvidence.some(e=>e.id==='runtime-current-situation'&&e.summary.includes('Inspect 2026'))).toBe(true);
 expect(bullets(advised).map(({sources,...line})=>line)).toEqual(bullets(w.direct).map(({sources,...line})=>line));
 // Existing advice provenance remains attached; this repair only changes printed names.
 expect(bullets(advised)[0].sources).toContain('runtime-current-situation');
 expect(noteAreas(advised,w.updates[0].notes).map(a=>a.title)).toEqual(noteAreas(w.direct,w.updates[0].notes).map(a=>a.title));
});
it('3.30 literal generic project remains its actual Project heading, never fallback note prose/year',()=>{
 const w=world(undefined,'','Inspect 2026','Project');
 expect(noteAreas(w.direct,w.updates[0].notes).map(a=>a.title)).toEqual(['Project']);
 expect(noteAreas(w.core.reportDraft,w.updates[0].notes).map(a=>a.title)).toEqual(['Project']);
});
it.each([
 ['Slab poured on 10/20/2026. Mix is 4000 psi.','Warehouse floor'],
 ['Lane closure moved to 10-20-2026.','Site'],
 ['Lane closure moved to 20.10.2026.','Site'],
 ['Lane closure moved to 2026.10.20.','Site'],
 ['Slab placed on 2026-10-20 at 4000 psi.','Warehouse floor'],
])('7.39 actual native/Runtime/Core keep %s under recorded %s',(text,area)=>{
 const w=world(text,area,'');
 for(const report of [w.direct,w.runtime.response.reportDraft,w.core.reportDraft]){
  expect(noteAreas(report,text).map(a=>a.title)).toEqual([area]);
  expect(report.body).toContain(text);
 }
 expect(printedReportWorkAreaName(PROJECT,area,text)).toBe(area);
 // Filing/cap ownership remains the original recipe, even though a printed date is not an area number.
 expect(cleanReportWorkAreaName(PROJECT,area,text)).toBe(text.includes('2026')?'2026 '+area:'4000 '+area);
});
it.each([
 ['Building 2321 East Driveway','2321 East Driveway'],['Room 4000','4000 Room'],['Level 2026','2026 Level'],['Подвал 1','Подвал 1'],['Секция 1','Секция 1'],
])('real explicitly recorded area %s keeps its established name %s despite dates/measurements',(area,expected)=>{
 const w=world('Slab poured on 10-20-2026. Mix is 4000 psi.',area,'');
 expect(noteAreas(w.core.reportDraft,w.updates[0].notes).map(a=>a.title)).toEqual([expected]);
});
it('real named room/building numbers in a task or locative note remain, while unrelated measurement/date numbers do not',()=>{
 expect(printedReportWorkAreaName(PROJECT,'Site','Building 4000 slab, due 10-20-2026. Mix is 4000 psi.')).toBe('4000 Site');
 expect(printedReportWorkAreaName(PROJECT,'Site','Unit 2026 punch list, due 20.10.2026.')).toBe('2026 Site');
 expect(printedReportWorkAreaName(PROJECT,'','Racking at 2321 east driveway is complete.')).toBe('2321 Birch Lane');
});
it('3.30 actual mounted own report card and real Word output use the source project heading',async()=>{
 const w=world();mockAuthority={state:'ready',policy:{reportGenerationAllowed:true,layer4DecisionCreationAllowed:false},reportDraft:w.core.reportDraft,runtime:w.runtime,executiveJudgmentRecord:null};
 const v=render(<ReportsScreen projectName={PROJECT} reportType="daily_project_update" onReportTypeChange={()=>{}} availableProjectNames={[PROJECT]} selectedProjectNames={[PROJECT]} onToggleProject={()=>{}} reportFormat="project_manager" onReportFormatChange={()=>{}} updates={w.updates} scheduleItems={w.tasks} knownScheduleItems={w.tasks} onSavedUpdates={()=>{}} onCopyReport={jest.fn()} onEmailReport={jest.fn()} onTextReport={jest.fn()} onDownloadWordReport={jest.fn()} onOutlookReport={jest.fn()}/>);
 await act(async()=>{for(let i=0;i<15;i++)await Promise.resolve()});await waitFor(()=>expect(screen.queryByText('The reporting period is still loading.')).toBeNull());
 expect(screen.queryByRole('button',{name:'2026 Birch Lane work area'})).toBeNull();expect(screen.getByRole('button',{name:'Birch Lane work area'})).toBeTruthy();
 const zip=await JSZip.loadAsync(Buffer.from(await buildReportWordBase64({title:w.core.reportDraft.title,body:w.core.reportDraft.body,generatedAt:w.core.reportDraft.generatedAt}),'base64'));const xml=await zip.file('word/document.xml')!.async('string');expect(xml).not.toContain('2026 Birch Lane');expect(xml).toContain(w.updates[0].notes);v.unmount();
});
it('same saved facts keep a stable modern source across row order, clock-neutral cloning and runtime advice',()=>{
 const w=world();const a=buildDAVEWebReportSource(w.snapshot,PROJECT).fingerprint;const clone=JSON.parse(JSON.stringify(w.snapshot));clone.scheduleItems.reverse();clone.projectUpdates.reverse();expect(buildDAVEWebReportSource(clone,PROJECT).fingerprint).toBe(a);expect(buildDAVEWebReportSource(w.snapshot,PROJECT).fingerprint).toBe(a);
});
