/** B78 TEST ONLY: canonical3.30 / duplicate4.82. Actual writers, synthetic records. Author did not execute. */
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
import {buildDailyProjectUpdate,buildPIEReportDraft,buildReportBullets,buildReportActionItems,buildConstructionUnderstanding,collectReportEvidence,cleanReportWorkAreaName,printedReportWorkAreaName,type PIEReportType,type PIEReportSourceEvidence} from '../../services/PIEReporter';
import {buildRuntime} from '../../services/PIERuntime';
import {buildPIECoreIntelligence} from '../../services/PIECoreIntelligence';
import {buildDAVEWebReportDraft,formatDAVEWebReport,buildDAVEWebReportSource} from '../../services/DAVEWebOperations';
import {buildReportWordBase64} from '../../services/ReportWordDocument';
import {forgetAllReportSessionState} from '../../services/ReportSessionState';
const NOW='2026-10-18T12:00:00Z',PROJECT='Birch Lane',ID='11111111-1111-4111-8111-111111111111';
function world(text='Lane closure moved to 10/20/2026.',area='',taskName='Inspect 2026',project=PROJECT){
 const tasks:any[]=taskName?[{id:'task-year',projectId:ID,projectName:project,scheduleProjectName:project,locationName:'',taskName,startDate:'10/01/2026',finishDate:'10/19/2026',milestone:'',owner:'Pat',contractor:'Crew',percentComplete:0,status:'Waiting',priority:'Medium',notes:'',createdAt:'2026-10-01T12:00:00Z'}]:[];
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
const NOTE='Lane closure moved to 10/20/2026.';
/** Existing public lower-level selector, preserving the legacy raw buckets and
 * each original cap before presentation. B78 must not change this selector.
 * This is a no-photo oracle; photo ownership has its own actual-path case below.
 */
function rawSelected(input:Parameters<typeof collectReportEvidence>[0]){
 const buckets=new Map<string,PIEReportSourceEvidence[]>();
 for(const evidence of collectReportEvidence(input)){
  const raw=cleanReportWorkAreaName(evidence.projectName,evidence.areaName,evidence.workAreaNameFrom??evidence.summary);
  const key=`${evidence.projectName}|${evidence.areaName}|${raw}`;
  buckets.set(key,[...(buckets.get(key)??[]),evidence]);
 }
 const understanding=buildConstructionUnderstanding(input,collectReportEvidence(input));
 return [...buckets.values()].flatMap(bucket=>{
  const area=understanding.workAreas.find(area=>area.sourceEvidenceIds.includes(bucket[0].id));
  if(!area)throw new Error('Missing original raw bucket');
  return buildReportBullets(bucket,buildReportActionItems(area));
 }).map(line=>({id:line.id,text:line.text,kind:line.kind,sources:line.sourceEvidenceIds}));
}

it.each(['Inspect 2026','2026 inspection','Unit 2026 punch list'])('3.30 recorded Waiting task %s cannot name an unassigned dated note on real fallback/Runtime/Core paths',taskName=>{
 const w=world(NOTE,'',taskName),before=JSON.stringify({tasks:w.tasks,updates:w.updates});
 for(const report of [w.direct,w.runtime.response.reportDraft,w.core.reportDraft]){
  expect(noteAreas(report,NOTE).map(a=>a.title)).toEqual([PROJECT]);
  // Keep the task's own numeric authority; do not guess year versus unit.
  expect(areas(report).some(a=>a.title===`2026 ${PROJECT}`&&a.bullets.some((b:any)=>b.text.includes(taskName)))).toBe(true);
  expect(bullets(report).filter(b=>b.text===NOTE)).toHaveLength(1);
 }
 expect(JSON.stringify({tasks:w.tasks,updates:w.updates})).toBe(before);
});
it('3.30 actual generic Project retains its own name despite the reported task number',()=>{
 const w=world(NOTE,'','Inspect 2026','Project');
 for(const report of [w.direct,w.runtime.response.reportDraft,w.core.reportDraft])expect(noteAreas(report,NOTE).map(a=>a.title)).toEqual(['Project']);
});
it.each(['daily_project_update','combined_project_update','executive_summary','customer_update','safety_update','inspection_readiness']as PIEReportType[])('3.30 %s draft keeps source headings and exact selected IDs/words/order',reportType=>{
 const w=world(NOTE,'','Unit 2026 punch list'),report=buildPIEReportDraft({...w.input,reportType});
 expect(noteAreas(report,NOTE).map(a=>a.title)).toEqual([PROJECT]);
 expect(bullets(report)).toEqual(rawSelected(w.input));
 expect(bullets(report).some(b=>b.text.includes('Unit 2026 punch list'))).toBe(true);
});
it('3.30 saturated raw bucket keeps exact selected line IDs/content/order and original cap membership',()=>{
 const w=world(NOTE,'','Unit 2026 punch list');
 w.updates.push(...['Conduit installed on 10/20/2026.','Forms placed on 10/20/2026.','Survey completed on 10/20/2026.','Anchor bolts set on 10/20/2026.'].map((notes,index)=>({...w.updates[0],id:`extra-${index}`,date:`2026-10-${15-index}T12:00:00Z`,notes})));
 w.tasks.push({...w.tasks[0],id:'second-task',taskName:'Unit 2026 doors',owner:'Dana'});
 const expected=rawSelected(w.input),report=buildDailyProjectUpdate(w.input);
 expect(expected.length).toBeGreaterThan(0);expect(bullets(report)).toEqual(expected);
 expect(new Set(bullets(report).map(b=>b.id)).size).toBe(expected.length);
 // A presentation split must never award each new group another cap allowance.
});
it('3.30 genuine explicitly scoped Unit 2026 remains authoritative',()=>{
 const w=world(NOTE,'Unit 2026','Unit 2026 punch list');w.tasks[0].locationName='Unit 2026';
 const report=buildDailyProjectUpdate(w.input);
 expect(noteAreas(report,NOTE).map(a=>a.title)).toEqual(['2026 Unit']);
 expect(report.sourceEvidence.find(e=>e.id==='note-own-note')?.areaName).toBe('Unit 2026');
 expect(bullets(report)).toEqual(rawSelected(w.input));
});
it('3.30 already-fixed silent ordinary task/advice variant preserves selected content',()=>{
 const w=world();w.tasks[0].status='In Progress';w.tasks[0].percentComplete=20;
 const direct=buildDailyProjectUpdate(w.input),advised=buildDailyProjectUpdate({...w.input,runtime:{situationIntelligence:w.core.situationIntelligence}}as any);
 expect(noteAreas(advised,NOTE).map(a=>a.title)).toEqual([PROJECT]);
 expect(bullets(advised).map(({sources,...line})=>line)).toEqual(bullets(direct).map(({sources,...line})=>line));
});
it('3.30 actual desktop formatter retains its note provenance and numeric task text',()=>{
 const w=world(NOTE,'','Unit 2026 punch list');
 const text=formatDAVEWebReport(buildDAVEWebReportDraft(w.snapshot,PROJECT),'project_manager');
 const own=text.split('\n').filter(line=>line.includes(NOTE)&&!line.includes('Latest update:'));
 expect(own.length).toBeGreaterThan(0);
 expect(own.some(line=>line.includes(`${PROJECT} — 2026 ${PROJECT}: ${NOTE}`))).toBe(false);
 expect(text).toContain('Unit 2026 punch list');
 expect(formatDAVEWebReport(buildDAVEWebReportDraft(w.snapshot,PROJECT),'executive')).toContain(PROJECT);
});
it('3.30 photo ownership/citation numbers survive a raw-bucket collision with Unit 2026',()=>{
 const w=world(NOTE,'','Unit 2026 punch list');
 w.updates[0].photos=[{id:'note-photo',uri:'file:///synthetic/note-photo.jpg',caption:'Conduit installed on 10/20/2026.',category:'Progress',actionRequired:'',actionOwner:'',actionDueDate:'',actionStatus:'Open',fileName:'note-photo.jpg',mimeType:'image/jpeg',selectedAreaName:''}];
 const report=buildDailyProjectUpdate(w.input),refs=areas(report).flatMap(a=>a.imageReferences);
 expect(noteAreas(report,NOTE).map(a=>a.title)).toEqual([PROJECT]);
 expect(refs.map((ref:any)=>[ref.photoId,ref.imageNumber,ref.sourceUpdateId])).toEqual([['note-photo',1,'own-note']]);
 expect(bullets(report).filter(b=>b.text.includes('See Image 1.'))).toHaveLength(1);
 expect(areas(report).filter(a=>a.imageReferences.some((r:any)=>r.photoId==='note-photo')).map(a=>a.title)).toEqual([PROJECT]);
 expect(bullets(report).some(b=>b.text.includes('Unit 2026 punch list'))).toBe(true);
});
it('3.30 mounted native card and real Word paragraphs retain the note beneath its own heading',async()=>{
 const w=world(NOTE,'','Unit 2026 punch list');mockAuthority={state:'ready',policy:{reportGenerationAllowed:true,layer4DecisionCreationAllowed:false},reportDraft:w.core.reportDraft,runtime:w.runtime,executiveJudgmentRecord:null};
 const v=render(<ReportsScreen projectName={PROJECT} reportType="daily_project_update" onReportTypeChange={()=>{}} availableProjectNames={[PROJECT]} selectedProjectNames={[PROJECT]} onToggleProject={()=>{}} reportFormat="project_manager" onReportFormatChange={()=>{}} updates={w.updates} scheduleItems={w.tasks} knownScheduleItems={w.tasks} onSavedUpdates={()=>{}} onCopyReport={jest.fn()} onEmailReport={jest.fn()} onTextReport={jest.fn()} onDownloadWordReport={jest.fn()} onOutlookReport={jest.fn()}/>);
 await act(async()=>{for(let i=0;i<15;i++)await Promise.resolve()});await waitFor(()=>expect(screen.queryByText('The reporting period is still loading.')).toBeNull());
 expect(screen.getByRole('button',{name:`${PROJECT} work area`})).toBeTruthy();expect(screen.getByRole('button',{name:`2026 ${PROJECT} work area`})).toBeTruthy();
 const zip=await JSZip.loadAsync(Buffer.from(await buildReportWordBase64({title:w.core.reportDraft.title,body:w.core.reportDraft.body,generatedAt:w.core.reportDraft.generatedAt}),'base64'));
 const xml=await zip.file('word/document.xml')!.async('string');
 const paragraphs=(xml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)??[]).map(p=>[...p.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(m=>m[1]).join(''));
 const noteIndex=paragraphs.findIndex(p=>p.includes(NOTE)&&!p.includes('Latest update:'));expect(noteIndex).toBeGreaterThan(0);
 const heading=paragraphs.slice(0,noteIndex).reverse().find(p=>/^\d+\. /.test(p));expect(heading).toMatch(/^\d+\. Birch Lane$/);
 expect(xml).toContain('Unit 2026 punch list');v.unmount();
});
