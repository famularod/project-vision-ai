jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined) } }));
import JSZip from 'jszip';
import { buildReportWordBase64, type ReportWordMedia, type ReportWordTaskLine } from '../../services/ReportWordDocument';
import { reportWordPhotoDescription } from '../../services/ReportWordMediaDescription';
import { wordFileWords } from '../fixtures/report-every-output';
import type { ProjectUpdate } from '../../types';

const PNG=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlL6iQAAAAASUVORK5CYII=','base64'));
const LINE='Place forms (Court): 40% complete.';
const TASK:ReportWordTaskLine={section:'CURRENT WORK',line:LINE,taskId:'forms',taskName:'Place forms',projectName:'Cedar Court',projectId:'cedar',areaName:'Court'};
const UPDATE={id:'field',projectName:'Cedar Court',projectId:'cedar',date:'2026-10-17',status:'sent',notes:'Forms installed.',scheduleItemId:'forms',scheduleTaskName:'Place forms',selectedAreaName:'Court',recipients:{contactIds:[]},photos:[{id:'picture',uri:'file:///synthetic/p.png',caption:'Forms at Court',category:'Update',actionRequired:'',actionOwner:'',actionDueDate:'',actionStatus:'Open',fileName:'p.png',mimeType:'image/png'}]} as ProjectUpdate;
const EXECUTIVE='EXECUTIVE SUMMARY\nRecorded project conditions are unchanged.';
const CURRENT=`CURRENT WORK\n• ${LINE}`;
async function outputs(body:string,taskLines:readonly ReportWordTaskLine[],update:ProjectUpdate|null=UPDATE){
 const photos=update?[{photoId:'picture',number:7}]:[];
 const media:ReportWordMedia[]=update?[{...reportWordPhotoDescription(update.photos[0],update),id:'picture',kind:'photo',displayNumber:7,linkedTaskId:update.scheduleItemId,projectId:update.projectId,data:PNG,mimeType:'image/png',width:1,height:1}]:[];
 const zip=await JSZip.loadAsync(Buffer.from(await buildReportWordBase64({title:'Synthetic review',body,generatedAt:'2026-10-17T12:00:00Z',taskLines,media}),'base64'));
 const xml=await zip.file('word/document.xml')!.async('string');
 const words=[...xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map(m=>m[1]).join('\n');
 const model=wordFileWords({title:'Synthetic review',body,photos,drawings:[],taskLines},update?[update]:[]).join('\n');
 return {words,model};
}
it('unused Executive task authority changes neither actual DOCX words nor the model',async()=>{
 const before=await outputs(EXECUTIVE,[TASK],null);
 const after=await outputs(EXECUTIVE,[{...TASK,taskName:'A renamed hidden task',line:'A changed line not printed by this report.'}],null);
 expect(after.words).toBe(before.words);
 expect(after.model).toBe(before.model);
});
it('the model contains the actual authoritative photo sentence, including its original number',async()=>{
 const before=await outputs(CURRENT,[TASK]);
 expect(before.words).toContain(`${LINE} Photo 7 shows this work.`);
 expect(before.model).toContain(`${LINE} Photo 7 shows this work.`);
});
it.each(['scheduleItemId','projectId'] as const)('%s affects the model only when it affects the actual Word citation',async field=>{
 const mismatched={...UPDATE,[field]:'another-identity'};
 const silentBefore=await outputs(EXECUTIVE,[TASK]);
 const silentAfter=await outputs(EXECUTIVE,[TASK],mismatched);
 expect(silentAfter.words).toBe(silentBefore.words);
 expect(silentAfter.model).toBe(silentBefore.model);
 const citedBefore=await outputs(CURRENT,[TASK]);
 const citedAfter=await outputs(CURRENT,[TASK],mismatched);
 expect(citedAfter.words).not.toBe(citedBefore.words);
 expect(citedAfter.model).not.toBe(citedBefore.model);
 expect(citedAfter.model).not.toContain('Photo 7 shows this work.');
});
it('printed photo descriptions still move the model on an Executive report',async()=>{
 const before=await outputs(EXECUTIVE,[TASK]);
 const after=await outputs(EXECUTIVE,[TASK],{...UPDATE,scheduleTaskName:'Forms at entrance'});
 expect(after.words).not.toBe(before.words);
 expect(after.model).not.toBe(before.model);
});
