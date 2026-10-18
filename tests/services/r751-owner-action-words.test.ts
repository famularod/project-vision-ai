jest.mock('expo-file-system/legacy',()=>({documentDirectory:null}));
jest.mock('@react-native-async-storage/async-storage',()=>({__esModule:true,default:{getItem:jest.fn(async()=>null),setItem:jest.fn(async()=>undefined),getAllKeys:jest.fn(async()=>[])}}));
import {buildDailyProjectUpdate,reportWordingRequiresAppTextKey} from '../../services/PIEReporter';
import {buildRuntime} from '../../services/PIERuntime';
import {scheduleLineAsWritten} from '../../services/ReportScheduleLine';
import {buildWrittenReportFacts} from '../../services/ReportWrittenFacts';
import {buildDAVEReportProjectTruths} from '../../services/DAVEReportProjectTruths';
import {buildDAVEReportSourceFingerprint} from '../../services/DAVEReportIntelligence';
import {buildDAVEWebReportDraft,formatDAVEWebReport} from '../../services/DAVEWebOperations';
import type {ProjectUpdate,ScheduleItem} from '../../types';
import * as fs from 'fs';
const NOW='2026-10-15T12:00:00Z';
const note=(text:string)=>({id:'u1',projectName:'Tower',scheduleProjectName:'Tower',selectedAreaName:'Roof',date:'2026-10-14',notes:text,status:'sent',photos:[],recipients:{contactIds:[]}}) as ProjectUpdate;
const task=(extra:Record<string,unknown>={})=>({id:'s1',projectName:'Tower',scheduleProjectName:'Tower',locationName:'Roof',taskName:'Confirm owner lunch arrangements',notes:'Please review the owner lounge.',startDate:'03/01/2027',finishDate:'04/30/2027',status:'Not Started',percentComplete:0,priority:'Medium',milestone:'',owner:'Alice Smith',contractor:'',...extra}) as ScheduleItem;
const draft=(updates:ProjectUpdate[],items:ScheduleItem[]=[])=>buildDailyProjectUpdate({selectedProjectNames:['Tower'],savedUpdates:updates,scheduleItems:items,generatedAt:new Date(NOW)});
const TEXT='Please book a table for the owner lunch on Thursday.';
it.each([TEXT,'Please confirm the Owner Lunch on Thursday.','Please confirm the owner Élodie lunch.','Please confirm the homeowner meeting.','Please confirm the Owner: 李明 assignment.','Please confirm the owner $& lunch.','Please confirm the owner \uE000 lunch.','Please iPhone delivery for the owner lunch.','Please eBay receipt for the owner lunch.'])('retains authored owner wording: %s',text=>{
 const expected=text.replace(/^Please /,'').replace(/^[a-z]+(?=\b)/,word=>word.charAt(0).toUpperCase()+word.slice(1));
 const runtime=buildRuntime({projectName:'Tower',projectNames:['Tower'],updates:[note(text)],scheduleItems:[],knownScheduleItems:[],currentUpdate:null,surface:'reports',reportType:'daily_project_update'} as never);
 expect(runtime.response.reportDraft.actionItems[0]?.action).toBe(expected);
 expect(runtime.response.reportDraft.body).toContain(expected);
});
it('keeps an explicit authored owner label and assigned photo owner without duplicating metadata',()=>{
 const u=note(''); u.photos=[{id:'p1',uri:'file:///synthetic.jpg',caption:'Please confirm the owner lunch.',category:'Progress',selectedAreaName:'Roof',actionRequired:'Please confirm the Owner: Alice Smith assignment.',actionOwner:'Dana',actionDueDate:'',actionStatus:'Open'}] as never;
 const r=draft([u]);expect(r.actionItems[0].action).toBe('Confirm the Owner: Alice Smith assignment.');expect(r.actionItems[0].owner).toBe('Dana');
});
it.each(['Alice Smith','Élodie Martin','李明','Dana / Sam'])('omits only the generated structured owner field from schedule action: %s',owner=>{
 const s=task({owner});const r=draft([],[s]);const action=r.actionItems.find(a=>a.sourceEvidenceIds.includes('schedule-s1'));
 expect(action?.action).toBe('Confirm owner lunch arrangements, due 04/30/2027, status Not Started, Please review the owner lounge.');
 expect(action?.owner).toBe(owner);
 expect(r.sourceEvidence.find(e=>e.id==='schedule-s1')?.summary).toContain(`owner ${owner}`);
 expect(scheduleLineAsWritten(s).nextStep).toEqual({action:action?.action,owner});
 expect(buildWrittenReportFacts({projectName:'Tower',updates:[],scheduleItems:[s],now:NOW}).tasks[0].line).toEqual(scheduleLineAsWritten(s));
});
it('preserves generated owner metadata in the problem evidence while action retains authored task and note words',()=>{
 const s=task({taskName:'Review owner lounge',notes:'Owner: Alice Smith must confirm the owner inspection; work is blocked.'});const r=draft([],[s]);
 expect(scheduleLineAsWritten(s).problem).toContain('owner Alice Smith');expect(scheduleLineAsWritten(s).nextStep?.action).toContain('Owner: Alice Smith must confirm the owner inspection');
 expect(r.actionItems.find(a=>a.sourceEvidenceIds.includes('schedule-s1'))?.action).toBe(scheduleLineAsWritten(s).nextStep?.action);
});
it('requires exact native words for changed owner actions without a leading Please',()=>{
 const r=draft([note('Confirm the owner lunch on Thursday.')]);expect(r.body).toContain('Confirm the owner lunch on Thursday.');expect(reportWordingRequiresAppTextKey(r)).toBe(true);
});
it('records separate native/desktop writer and fingerprint proof under unchanged facts',()=>{
 const updates=[note('Confirm the owner lunch on Thursday.')]; const before=JSON.stringify(updates);
 const truths=buildDAVEReportProjectTruths({projects:[{name:'Tower',projectId:'report:tower'}],projectRecords:[{name:'Tower'}],updates,scheduleItems:[],knownScheduleItems:[],knownScheduleDocuments:[],projectAreas:[],referenceDocuments:[],now:NOW} as never);
 const web={projects:[{id:'tower',name:'Tower'}],scheduleItems:[],knownScheduleItems:[],projectUpdates:updates.map(updateData=>({updateData})),referenceDocuments:[],projectAreas:[],refreshedAt:NOW,tasksPulledAt:NOW};
 const desktop=formatDAVEWebReport(buildDAVEWebReportDraft(web as never,null),'project_manager');const native=draft(updates);
 expect(JSON.stringify(updates)).toBe(before);
 if(process.env.R751_PROOF)fs.writeFileSync(process.env.R751_PROOF,JSON.stringify({facts:updates,fingerprint:buildDAVEReportSourceFingerprint(truths),desktop,native:native.body,scheduleMirror:scheduleLineAsWritten(task())},null,2));
});

it('keeps unchanged Unicode owner action words outside the legacy ASCII-removal guard',()=>{
 const r=draft([note('Confirm the owner Élodie lunch.')]);expect(reportWordingRequiresAppTextKey(r)).toBe(false);
});
