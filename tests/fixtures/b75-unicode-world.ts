import {buildPIEReportDraft} from '../../services/PIEReporter';
import {buildPIECoreIntelligence} from '../../services/PIECoreIntelligence';
import {enhanceDAVEReportDraft} from '../../services/DAVEReportIntelligence';
import {buildDAVEWebReportDraft,formatDAVEWebReport} from '../../services/DAVEWebOperations';
export const NOW='2026-10-18T12:00:00.000Z';
// Literal expected Unicode scalar order; no locale or transliteration inference.
export const PAIRS=[['Башня Восток','Башня Север'],['Αθήνα','Ωμέγα'],['ألف','باء'],['东楼','西楼'],['١','٢'],['🏗️','👷'],['豈','𠀀']]as const;
export function world(names:readonly string[],newest=1){
 const tasks=names.map((projectName,i)=>({id:'b75-task-'+i,projectId:'b75-project-'+i,projectName,scheduleProjectName:projectName,locationName:'Bay '+i,taskName:'Install panels '+i,startDate:'10/01/2026',finishDate:'11/01/2026',owner:'Dana',contractor:'Crew',percentComplete:25+i*25,status:'In Progress',priority:'Medium',notes:'',milestone:'',createdAt:'2026-10-01T12:00:00.000Z',updatedAt:'2026-10-17T12:00:00.000Z'}));
 const updates=names.flatMap((projectName,i)=>[0,1].map(area=>({id:`b75-note-${i}-${area}`,projectId:'b75-project-'+i,projectName,scheduleProjectName:projectName,date:`2026-10-${(i===newest?17:15)-area}T12:00:00.000Z`,notes:area?'Conduit was trenched along the yard fence.':'Temporary fencing was installed along the street frontage.',selectedAreaName:area?'Yard '+i:'Bay '+i,photos:area?[]:[{id:'b75-photo-'+i,uri:`file:///b75/photo-${i}.jpg`,caption:'Fence panel '+i,category:'Progress',selectedAreaName:'Bay '+i,actionRequired:'',actionOwner:'',actionDueDate:'',actionStatus:'Open',fileName:`photo-${i}.jpg`,mimeType:'image/jpeg'}],recipients:{contactIds:[]},status:'sent'})));
 const projects=names.map((name,i)=>({id:'b75-project-'+i,name}));
 const snapshot={projects,scheduleItems:tasks,knownScheduleItems:tasks,projectUpdates:updates.map(updateData=>({id:updateData.id,updateData})),referenceDocuments:[],refreshedAt:NOW};
 return{names:[...names],tasks,updates,projects,snapshot};
}
export function report(w:ReturnType<typeof world>,ticked:readonly string[]=w.names){return buildPIEReportDraft({reportType:'combined_project_update',audience:'internal_team',selectedProjectNames:[...ticked],savedUpdates:w.updates,scheduleItems:w.tasks,generatedAt:new Date(NOW)}as never);}
export function desktop(w:ReturnType<typeof world>,ticked:readonly string[]=w.names){return buildDAVEWebReportDraft({...w.snapshot,projects:ticked.map(name=>w.projects.find(p=>p.name===name)!)}as never,null);}
export function native(w:ReturnType<typeof world>,ticked:readonly string[],format:'project_manager'|'executive'){return enhanceDAVEReportDraft(report(w,ticked),desktop(w,ticked),format);}
export function core(w:ReturnType<typeof world>,ticked:readonly string[]){return buildPIECoreIntelligence({runtimeContext:{projectName:ticked[0],projectNames:[...ticked],reportType:'combined_project_update',updates:w.updates,scheduleItems:w.tasks,knownScheduleItems:w.tasks,currentUpdate:null,projectAreas:[],contacts:{contacts:[]},referenceDocuments:[],surface:'reports'},reportType:'combined_project_update',reportProjectNames:[...ticked],organizationId:'local-unverified-anonymous',projectId:'b75-synthetic'}as never).reportDraft;}
export function outputs(w:ReturnType<typeof world>,ticked:readonly string[]=w.names){const d=report(w,ticked),b=desktop(w,ticked);return{nativeDraft:d,nativePM:enhanceDAVEReportDraft(d,b,'project_manager').body,nativeExecutive:enhanceDAVEReportDraft(d,b,'executive').body,desktopPM:formatDAVEWebReport(b,'project_manager'),desktopExecutive:formatDAVEWebReport(b,'executive'),desktopConditions:b.projectConditions};}
