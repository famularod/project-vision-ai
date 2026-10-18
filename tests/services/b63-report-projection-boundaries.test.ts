jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule:true,default:{getItem:jest.fn(async()=>null),setItem:jest.fn(),removeItem:jest.fn()} }));
import type { ScheduleItem } from '../../types';
import { projectScheduleItemsForReport } from '../../services/ReportScheduleProjection';
import { normalizeDAVECompletionVerification } from '../../services/DAVECompletionVerification';
import { buildDAVEReportProjectTruths } from '../../services/DAVEReportProjectTruths';
import { buildPIEReportDraft } from '../../services/PIEReporter';
import { buildPIECoreIntelligence } from '../../services/PIECoreIntelligence';
import { extractScheduleEvidence, buildFusedEvidence } from '../../services/PIEEvidenceFusion';
import { buildDAVEReportBriefing,enhanceDAVEReportDraft } from '../../services/DAVEReportIntelligence';
const NOW='2026-10-17T12:00:00.000Z';
function task(over:Partial<ScheduleItem>={}):ScheduleItem{return {id:'canopy',projectName:'Alpha',scheduleProjectName:'Alpha',locationName:'Court',taskName:'Install canopy',startDate:'10/01/2026',finishDate:'10/20/2026',milestone:'',owner:'Dana',contractor:'',notes:'',nextAction:'',priority:'Medium',status:'In Progress',percentComplete:40,createdAt:'2026-10-01T12:00:00.000Z',...over} as ScheduleItem;}
const valid=normalizeDAVECompletionVerification({status:'pm_verified',reportedAt:NOW,evidence:[{kind:'pm_confirmation',sourceName:'Dana',sourceRecordId:'canopy',summary:'Verified',recordedAt:NOW}]})!;
function truths(tasks:ScheduleItem[],names=['Alpha'],known=tasks,updates:any[]=[]){return buildDAVEReportProjectTruths({projects:names.map(name=>({name,projectId:'report:'+name})),projectRecords:names.map(name=>({name})),updates,scheduleItems:tasks,knownScheduleItems:known,now:NOW});}
it('ordinary and canonical verified rows preserve identity; no-parent and conflicting-parent values are not reassigned',()=>{
 const rows=[task(),task({id:'valid',completionVerification:valid}),task({id:'unassigned',projectName:'',scheduleProjectName:null}),task({id:'conflicting',projectName:'Building 7',scheduleProjectName:'Beta'})];
 expect(projectScheduleItemsForReport(rows)).toBe(rows);
 expect(projectScheduleItemsForReport(rows)[1].completionVerification).toBe(valid);
});
it('report projection leaves frozen raw metadata and hidden task authority intact',()=>{
 const shown=Object.freeze(task({projectName:'',scheduleProjectName:'Alpha'}));
 const hidden=Object.freeze(task({id:'old-canopy',projectName:'',scheduleProjectName:'Alpha',isHidden:true} as Partial<ScheduleItem>));
 const foreign=task({id:'foreign',projectName:'Building 7',scheduleProjectName:'Beta'});
 const updates=[{id:'own-note',projectName:'Older name',scheduleItemId:hidden.id,date:NOW,status:'sent',notes:'Own hidden work',photos:[],recipients:{contactIds:[]}},{id:'foreign-note',projectName:'Alpha',scheduleItemId:foreign.id,date:NOW,status:'sent',notes:'Foreign hidden work',photos:[],recipients:{contactIds:[]}}];
 const [truth]=truths([shown],['Alpha'],[shown,hidden,foreign],updates);
 expect(truth.evidence.records.some(r=>r.sourceRecordId==='own-note')).toBe(true);
 expect(truth.evidence.records.some(r=>r.sourceRecordId==='foreign-note')).toBe(false);
 expect(shown.projectName).toBe('');expect(hidden.projectName).toBe('');
});
it.each(['pm_verified','rejected','reported_complete','conflicting_evidence'])('incomplete %s cannot create completion authority',status=>{
 const [truth]=truths([task({completionVerification:{status,reportedAt:NOW} as any})]);
 expect(truth.schedule[0].completionState).toBe('scheduled');
 expect(truth.correlations.tasks[0].evidence.some(e=>e.id.includes('pm-decision'))).toBe(false);
});
it.each([['Alpha'],['Alpha','Beta']])('actual report writer and modern truth agree for selected scope %j',(...names)=>{
 const selected=names as string[];
 const rows=[task({projectName:'',scheduleProjectName:'Alpha'}),task({id:'foreign',projectName:'',scheduleProjectName:'Foreign',taskName:'Excluded foreign focus',finishDate:'10/18/2026'})];
 const scoped=rows.filter(t=>selected.includes(t.scheduleProjectName!));
 const originalFusion={userUpdateEvidence:[],photoEvidence:[],scheduleEvidence:extractScheduleEvidence({projectName:'Alpha',scheduleItems:scoped,now:new Date(NOW)})};
 const before=JSON.stringify(originalFusion);
 const draft=buildPIEReportDraft({reportType:selected.length>1?'combined_project_update':'daily_project_update',selectedProjectNames:selected,scheduleItems:scoped,savedUpdates:[],runtime:{fusedEvidence:originalFusion},generatedAt:new Date(NOW)});
 const facts=truths(scoped,selected);const briefing=buildDAVEReportBriefing({truths:facts});
 const pm=enhanceDAVEReportDraft(draft,briefing,'project_manager');
 const executive=enhanceDAVEReportDraft(draft,briefing,'executive');
 expect(pm.body).toContain(facts[0].writtenReportFacts!.scheduleFocus!);
 expect(pm.body).not.toContain('Excluded foreign focus');expect(executive.body).not.toContain('Schedule focus:');
 expect(JSON.stringify(originalFusion)).toBe(before);
});
it('a caller without a complete fusion recipe keeps its supplied runtime sentence',()=>{
 const draft=buildPIEReportDraft({selectedProjectNames:['Alpha'],scheduleItems:[task({projectName:''})],runtime:{intelligentSummary:{whatChanged:'Owner requested inspection.'}},generatedAt:new Date(NOW)});
 expect(JSON.stringify(draft.sourceEvidence)).toContain('Owner requested inspection.');
});

it.each([false,true])('actual core fusion keeps its parent scope beside an affected blank task (combined=%s)',combined=>{
 const parent=combined?'Beta':'Alpha';const selected=combined?['Alpha','Beta']:['Alpha'];
 const rows=[task({projectName:'',scheduleProjectName:parent}),task({id:'building',taskName:'Ordinary subproject task',projectName:'Building 7',scheduleProjectName:parent,finishDate:'10/10/2026'})];
 const core=buildPIECoreIntelligence({runtimeContext:{projectName:parent,projectNames:selected,reportType:combined?'combined_project_update':'daily_project_update',updates:[],scheduleItems:rows,knownScheduleItems:rows,currentUpdate:null,projectAreas:[],contacts:{contacts:[]},referenceDocuments:[],surface:'reports'},reportType:combined?'combined_project_update':'daily_project_update',reportProjectNames:selected,organizationId:'local-unverified-anonymous',projectId:'synthetic-project'} as never);
 const facts=truths(rows,selected);const focus=facts.find(t=>t.projectName===parent)!.writtenReportFacts!.scheduleFocus!;
 const body=enhanceDAVEReportDraft(core.reportDraft,buildDAVEReportBriefing({truths:facts}),'project_manager').body;
 expect(body).toContain(focus);expect(body).not.toContain('Schedule focus: Ordinary subproject task');
});
it('only a foreign row needing projection leaves the existing selected fusion recipe intact',()=>{
 const included=task();const ordinaryGlobal=task({id:'withheld',taskName:'Other globally saved task',finishDate:'10/10/2026'});
 const foreign=task({id:'foreign',projectName:'',scheduleProjectName:'Foreign',completionVerification:{status:'pm_verified'} as any});
 const fused=buildFusedEvidence({projectName:'Alpha',projectNames:['Alpha'],scheduleItems:[included],now:new Date(NOW)});
 const draft=buildPIEReportDraft({selectedProjectNames:['Alpha'],scheduleItems:[included,ordinaryGlobal,foreign],savedUpdates:[],runtime:{fusedEvidence:fused},generatedAt:new Date(NOW)});
 const changed=draft.sourceEvidence.find(e=>e.id==='runtime-what-changed')!;
 expect(changed.summary).toContain('Schedule focus: Install canopy');expect(changed.summary).not.toContain('Other globally saved task');
});
it('omitted report time is captured once before an advancing midnight clock changes the focus window',()=>{
 const ActualDate=Date;let reads=0;const before='2026-10-17T23:59:59-07:00',after='2026-10-18T00:00:01-07:00';
 class BoundaryDate extends ActualDate{constructor(...args:any[]){super(...((args.length?args:[reads++?after:before]) as [string]));}static now(){return new ActualDate(before).getTime();}}
 globalThis.Date=BoundaryDate as DateConstructor;
 try{
  const draft=buildPIEReportDraft({selectedProjectNames:['Alpha'],scheduleItems:[task({projectName:'',finishDate:'11/01/2026'})],runtime:{fusedEvidence:{userUpdateEvidence:[],photoEvidence:[],scheduleEvidence:[]}}});
  expect(draft.generatedAt).toBe(new ActualDate(before).toISOString());
  expect(draft.sourceEvidence.some(e=>e.summary.includes('Schedule focus:'))).toBe(false);
 }finally{globalThis.Date=ActualDate;}
});
