jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), getAllKeys: jest.fn(async () => []) } }));
import { buildDailyProjectUpdate, buildCombinedProjectUpdate, reportWordingRequiresAppTextKey } from '../../services/PIEReporter';
import { buildRuntime } from '../../services/PIERuntime';
import { buildFusedEvidence } from '../../services/PIEEvidenceFusion';
import { buildDAVEWebReportDraft } from '../../services/DAVEWebOperations';
import { buildDAVEReportProjectTruths } from '../../services/DAVEReportProjectTruths';
import { buildDAVEReportSourceFingerprint } from '../../services/DAVEReportIntelligence';
import * as fs from 'fs';
import type { ProjectUpdate } from '../../types';
const note = (id: string, notes: string, date='2026-10-14', projectName='Tower', selectedAreaName='Roof') => ({ id, projectName, scheduleProjectName: projectName, date, photos: [], recipients: { contactIds: [] }, notes, status: 'sent', selectedAreaName }) as unknown as ProjectUpdate;
const fused = (updates: ProjectUpdate[]) => buildFusedEvidence({ projectName: 'Tower', projectNames: ['Tower'], updates, scheduleItems: [], knownScheduleItems: [], now: new Date('2026-10-15T12:00:00Z') });
const report = (updates: ProjectUpdate[], fusion=fused(updates)) => buildDailyProjectUpdate({ selectedProjectNames:['Tower'], savedUpdates: updates, scheduleItems: [], runtime:{fusedEvidence:fusion, intelligentSummary:fusion.intelligentSummary} } as never);
const lines = (r: ReturnType<typeof report>) => r.locationGroups.flatMap(g=>g.workAreas.flatMap(a=>a.bullets.map(b=>b.text)));
const TEXT='Neighbor asked about weekend hours.';
it.each(['', 'Roof'])('production runtime/fusion to reporter prints the actual newest plain note, area %j', area => {
 const updates=[note('older','Conference table arrived.','2026-10-12','Tower',area),note('newest',TEXT,'2026-10-14','Tower',area)];
 const runtime=buildRuntime({projectName:'Tower',projectNames:['Tower'],surface:'reports',reportType:'daily_project_update',updates,scheduleItems:[],knownScheduleItems:[],currentUpdate:null,projectAreas:[],contacts:{contacts:[]},referenceDocuments:[]} as never);
 expect(runtime.fusedEvidence.intelligentSummary.whatChanged).toContain(`Latest update: ${TEXT}`);
 const r=runtime.response.reportDraft;
 expect(r.body).toContain(`Latest update: ${TEXT}`);
 expect(lines(r)).toContain(TEXT);
 expect(r.constructionUnderstanding.workAreas.every(a=>a.progress.length===0)).toBe(true);
 expect(reportWordingRequiresAppTextKey(r)).toBe(true);
});
it('selects by date, independent of array order, and never substitutes an older fused note',()=>{
 const old=note('old','Conference table arrived.','2026-10-12'), newest=note('new',TEXT);
 expect(report([old,newest]).body).toBe(report([newest,old]).body);
 expect(report([old,newest]).body).toContain(`Latest update: ${TEXT}`);
 expect(report([old,newest],fused([old])).body).not.toContain('Latest update: Conference table arrived.');
});
it('refuses accepted provider prose and arbitrary runtime/model prose',()=>{
 const accepted={...note('u1',TEXT),pieSuggestedNote:TEXT,pieSuggestedNoteAccepted:true};
 expect(report([accepted]).body).not.toContain(`Latest update: ${TEXT}`);
 const r=buildDailyProjectUpdate({selectedProjectNames:['Tower'],savedUpdates:[note('u1',TEXT)],scheduleItems:[],runtime:{fusedEvidence:{userUpdateEvidence:[note('u1',TEXT)]},intelligentSummary:{whatChanged:`Latest update: ${TEXT}`}}} as never);
 expect(r.body).not.toContain(`Latest update: ${TEXT}`);
});
it('refuses fused identity drift in project or area even when the id and text match',()=>{
 const saved=[note('u1',TEXT)];
 for(const change of [{projectName:'Other'},{areaName:'Lobby'}]) {
  const f=fused(saved); f.userUpdateEvidence=f.userUpdateEvidence.map(u=>({...u,...change}));
  expect(report(saved,f).body).not.toContain(`Latest update: ${TEXT}`);
 }
});
it('files the combined report Latest quote in its actual project and area',()=>{
 const updates=[note('u1',TEXT),note('other','Conference table arrived.','2026-10-13','Other')];
 const f=fused(updates);
 const r=buildCombinedProjectUpdate({selectedProjectNames:['Other','Tower'],savedUpdates:updates,scheduleItems:[],runtime:{fusedEvidence:f,intelligentSummary:f.intelligentSummary}} as never);
 const areas=r.locationGroups.flatMap(g=>g.workAreas);
 expect(areas.find(a=>a.projectName==='Tower'&&a.title==='Roof')?.bullets.some(b=>b.text.includes(`Latest update: ${TEXT}`))).toBe(true);
 expect(areas.filter(a=>a.projectName==='Other').flatMap(a=>a.bullets).some(b=>b.text.includes(`Latest update: ${TEXT}`))).toBe(false);
});
it('keeps existing full-capacity substantive notes and its three-line allowance',()=>{
 const updates=[note('new',TEXT), note('p1','Roof membrane was installed.','2026-10-13'),note('p2','Roof flashing was installed.','2026-10-12'),note('p3','Roof curb was installed.','2026-10-11')];
 const r=report(updates), all=lines(r);
 expect(all).toHaveLength(3);
 for(const u of updates.slice(1)) expect(all).toContain(u.notes);
 expect(all.some(s=>s.includes('Latest update:'))).toBe(false);
 expect(reportWordingRequiresAppTextKey(r)).toBe(false);
});

it('a photo suffix cannot turn the authored plain Latest quote into verified progress',()=>{
 const updates=[note('new',TEXT),{...note('old','','2026-10-12'),photos:[{id:'p1',uri:'file:///synthetic.jpg',caption:'Roof membrane was installed.',category:'Progress',selectedAreaName:'Roof',actionRequired:'',actionOwner:'',actionDueDate:'',actionStatus:'Open'}]}] as ProjectUpdate[];
 const r=report(updates);
 const latest=r.sourceEvidence.find(e=>e.id==='runtime-what-changed');
 expect(latest?.summary).toContain(`Latest update: ${TEXT}`);
 expect(r.constructionUnderstanding.workAreas.flatMap(a=>a.progress).some(p=>p.sourceEvidenceIds.includes('runtime-what-changed'))).toBe(false);
});
it('desktop has a separate DAVE writer and unchanged source facts',()=>{
 const updates=[note('new',TEXT)];
 const before=JSON.stringify(updates);
 const web={projects:[{id:'tower',name:'Tower'}],scheduleItems:[],knownScheduleItems:[],projectUpdates:updates.map(updateData=>({updateData})),referenceDocuments:[],projectAreas:[],refreshedAt:'2026-10-15T12:00:00Z',tasksPulledAt:'2026-10-15T12:00:00Z'};
 const desktop=buildDAVEWebReportDraft(web as never,null,{previousSnapshot:null,waitingForOtherDevice:false});
 const truths=buildDAVEReportProjectTruths({projects:[{name:'Tower',projectId:'report:tower'}],projectRecords:[{name:'Tower'}],updates,scheduleItems:[],knownScheduleItems:[],knownScheduleDocuments:[],projectAreas:[],referenceDocuments:[],now:'2026-10-15T12:00:00Z'} as never);
 const fingerprint=buildDAVEReportSourceFingerprint(truths);
 const native=report(updates);
 expect(JSON.stringify(updates)).toBe(before);
 expect(JSON.stringify(desktop)).not.toContain('Latest update:');
 if(process.env.R481_PROOF) fs.writeFileSync(process.env.R481_PROOF,JSON.stringify({facts:updates,fingerprint,desktop,nativeBody:native.body},null,2));
});
