/** Actual desktop producer closure + actual web media resolver + actual DOCX renderer.
 * Only browser raster/file/sharing I/O is synthetic. Every photo has different bytes. */
import fs from 'fs';import path from 'path';import ts from 'typescript';import JSZip from 'jszip';
import {buildReportWordBlob,buildReportWordBase64,summarizeReportWordUnavailableMedia} from '../../services/ReportWordDocument';
import {resolveWebReportWordMedia} from '../../services/ReportWordMedia.web';
import {resolveNativeReportWordMedia} from '../../services/ReportWordMedia.native';
import {fieldUpdatesNewestFirst} from '../../services/PIEEvidenceFusion';
import {buildReportImageReferences} from '../../services/PIEReporter';
import {buildDAVEWebReportSource,buildDAVEWebReportTruths,buildDAVEWebReportDraft} from '../../services/DAVEWebOperations';
import {buildDAVEReportSnapshot,markReportSnapshotDelivered,reportSnapshotToSave,reportTextKey} from '../../services/DAVEReportSnapshot';
import {daveWebReportAlreadySentElsewhereAt} from '../../services/DAVEWebReportPeriod';
import {reportFileTitleWithDate} from '../../services/ReportCommunication';
import {fakeMedia,fakeImageBytes,installFakeBrowser} from '../fixtures/report-word-media-fakes';
import type {ProjectUpdate} from '../../types';
jest.mock('expo-file-system',()=>require('../fixtures/report-word-media-fakes').fakeFileSystem());
jest.mock('expo-file-system/legacy',()=>({documentDirectory:null}));
jest.mock('expo-image-manipulator',()=>require('../fixtures/report-word-media-fakes').fakeImageManipulator());
jest.mock('../../modules/dave-text-recognition',()=>({renderPdfExcerpt:jest.fn()}));
jest.mock('@react-native-async-storage/async-storage',()=>({getItem:jest.fn(),setItem:jest.fn(),removeItem:jest.fn()}));
function closure(file:string,name:string,deps:Record<string,unknown>){
 const text=fs.readFileSync(path.resolve(__dirname,'../..',file),'utf8'),tree=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let found:ts.Node|undefined;
 const visit=(n:ts.Node)=>{if((ts.isFunctionDeclaration(n)||ts.isVariableDeclaration(n))&&n.name?.getText(tree)===name)found=n;ts.forEachChild(n,visit)};visit(tree);if(!found)throw Error(name);const n=found as ts.FunctionDeclaration|ts.VariableDeclaration;
 const expr=ts.isVariableDeclaration(n)?n.initializer!.getText(tree):n.getText(tree);const code=ts.transpileModule(`const extracted=${expr};`,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;return new Function(...Object.keys(deps),code+';return extracted;')(...Object.values(deps));
}
const NOW='2026-10-17T12:00:00Z',PROJECT='11111111-1111-4111-8111-111111111111';
const body='CURRENT WORK\n- Tower — Frame walls (East): Framing started.\n- Tower — Pour slab (North): Pour started.\nMANUAL NOTE\n- Keep José’s $& punctuation exactly.';
function update(id:string,at:string,task:string,area:string,photos:string[]):ProjectUpdate{return {id,projectId:PROJECT,projectName:'Tower',scheduleProjectName:'Tower',scheduleItemId:task,scheduleTaskName:task==='frame'?'Frame walls':'Pour slab',selectedAreaName:area,date:at,notes:task==='frame'?'Framing started.':'Pour started.',status:'sent',recipients:{contactIds:[]},photos:photos.map(photo=>({id:photo,uri:`file:///photos/${photo}.png`,cloudStoragePath:`owner/${photo}.png`,caption:`Distinct ${photo}`,selectedAreaName:area,category:'Progress',actionRequired:'',actionOwner:'',actionDueDate:'',actionStatus:'Open'}))} as unknown as ProjectUpdate}
const A=()=>update('update-1','2026-10-15','frame','East',['photo-A']);const B=()=>update('update-2','2026-10-16','pour','North',['photo-Z','photo-B']);
const tasks=[['frame','Frame walls','East'],['pour','Pour slab','North']].map(([id,taskName,locationName])=>({id,taskName,locationName,projectId:PROJECT,projectName:'Tower',scheduleProjectName:'Tower',startDate:'2026-10-01',finishDate:'2026-11-01',owner:'Dana',contractor:'Acme',priority:'Medium',status:'In Progress',percentComplete:40,notes:'',createdAt:'2026-10-01T12:00:00Z',updatedAt:'2026-10-16T12:00:00Z',cloudUpdatedAt:'2026-10-16T12:00:00Z'}));
function web(updates:ProjectUpdate[]):any{return {projects:[{id:PROJECT,name:'Tower'}],scheduleItems:tasks,knownScheduleItems:tasks,referenceDocuments:[],projectUpdates:updates.map(u=>({id:'cloud-row-'+u.id,projectName:u.projectName,createdAt:'2026-10-15',updatedAt:NOW,ownerId:'owner',updateData:u})),refreshedAt:NOW,tasksPulledAt:NOW}}
let restore:()=>void;beforeEach(()=>{fakeMedia.reset();restore=installFakeBrowser();for(const id of ['photo-A','photo-Z','photo-B']){const bytes=fakeImageBytes('png',{width:8,height:8,labelAt:()=>id});fakeMedia.files.set(`file:///photos/${id}.png`,bytes);fakeMedia.remote.set(`https://synthetic.invalid/owner/${id}.png`,{bytes,contentType:'image/png'});}});afterEach(()=>restore());
async function unpack(blob:Blob){const zip=await JSZip.loadAsync(await blob.arrayBuffer());const xml=await zip.file('word/document.xml')!.async('string');const paragraphs=Array.from(xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)).map(m=>Array.from(m[0].matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)).map(t=>t[1]).join('').replace(/&amp;/g,'&').replace(/&apos;/g,"'").replace(/&quot;/g,'"'));const bytes=await Promise.all(Object.keys(zip.files).filter(p=>p.startsWith('word/media/')&&!zip.files[p].dir).map(p=>zip.file(p)!.async('uint8array')));return {paragraphs,bytes};}
async function desktop(updates:ProjectUpdate[],history=false,sourceIds=['update-1','update-2'],structured=false){
 let output:Blob|null=null;let resolved:any=null;const notices:any[]=[];const snapshot=web(updates);const before=JSON.stringify(snapshot);const briefing=structured?buildDAVEWebReportDraft(snapshot,null):{wordTaskLines:[]};const chosenBody=structured?['CURRENT WORK',...(briefing.wordTaskLines??[]).filter(line=>line.section==='CURRENT WORK').map(line=>'- '+line.line)].join('\n'):body;
 const fn=closure('components/web-shell/desktop-read-only-shell.tsx','downloadWordReport',{
 pending:false,REPORT_PERIOD_WAITING_LINE:'Not counted yet',setWordHeldBack:jest.fn(),setPending:jest.fn(),setNotice:(x:unknown)=>notices.push(x),
 snapshot,uniqueStrings:(values:string[])=>[...new Set(values)],fieldUpdatesNewestFirst,buildAutomaticReportDrawingReferences:()=>[],referenceDocumentsCitedAsListed:(v:unknown)=>v,selectedProjectNames:['Tower'],
 resolveWebReportWordMedia:async(args:Parameters<typeof resolveWebReportWordMedia>[0])=>{resolved=await resolveWebReportWordMedia(args);return resolved},auth:{getArtifactUrl:async(_bucket:string,p:string)=>`https://synthetic.invalid/${p}`},
 briefing,reportFileTitleWithDate,downloadBlob:(_name:string,blob:Blob)=>output=blob,
 require:()=>({buildReportWordBlob,summarizeReportWordUnavailableMedia}),
 });await fn({title:'Tower manual review',body:chosenBody,generatedAt:NOW,updateIds:sourceIds,...(history?{historyDocumentId:'saved-report'}:{})});
 expect(JSON.stringify(snapshot)).toBe(before);expect(output).not.toBeNull();return {...await unpack(output!),resolved,notices};
}
it.each([false,true])('7.58 actual %s-history Word output keeps exact numbered source mapping after cloud reordering under an already-sent fingerprint',async history=>{
 const first=[B(),A()],other=[A(),B()];const s1=buildDAVEWebReportSource(web(first),null),s2=buildDAVEWebReportSource(web(other),null);expect(s2.fingerprint).toBe(s1.fingerprint);
 const sent=markReportSnapshotDelivered(reportSnapshotToSave(buildDAVEReportSnapshot({truths:buildDAVEWebReportTruths(web(first),null),scopeKey:s1.scopeKey,sourceFingerprint:s1.fingerprint,capturedAt:NOW,reportFormat:'project_manager'}),null)!,NOW,'phone',null,null,reportTextKey({title:'Tower manual review',body}));expect(daveWebReportAlreadySentElsewhereAt(sent,s2.fingerprint,new Set(),{requiresTextKey:true,title:'Tower manual review',body})).toBe(NOW);
 const left=await desktop(first,history),right=await desktop(other,history);const mapping=(r:any)=>r.resolved.media.map((m:any)=>[m.displayNumber,m.id,m.linkedTaskId,m.projectId]);
 expect(mapping(right)).toEqual(mapping(left));expect(mapping(right)).toEqual([[1,'photo-Z','pour',PROJECT],[2,'photo-B','pour',PROJECT],[3,'photo-A','frame',PROJECT]]);
 expect(right.paragraphs).toEqual(left.paragraphs);expect(right.paragraphs.join('\n')).toContain('Photo 3 — Tower — East — Frame walls.');expect(right.paragraphs.join('\n')).toContain('Photos 1 and 2 — Tower — North — Pour slab.');expect(right.paragraphs.join('\n')).not.toContain('Framing started. Photo 3 shows this work.');expect(right.paragraphs.join('\n')).toContain('Keep José’s $& punctuation exactly.');expect(new Set(right.bytes.map(b=>Buffer.from(b).toString('base64'))).size).toBe(3);
});
it('7.58 unavailable first image retains its number and exact task/photo guide after reordering',async()=>{
 fakeMedia.remote.delete('https://synthetic.invalid/owner/photo-Z.png');const left=await desktop([B(),A()],true),right=await desktop([A(),B()],true);expect(right.resolved.unavailableMedia.map((m:any)=>m.label)).toEqual(left.resolved.unavailableMedia.map((m:any)=>m.label));expect(right.resolved.unavailableMedia[0].label).toMatch(/^Photo 1/);expect(right.resolved.media.map((m:any)=>[m.displayNumber,m.id])).toEqual([[2,'photo-B'],[3,'photo-A']]);expect(right.paragraphs).toEqual(left.paragraphs);expect(right.paragraphs.join('\n')).toContain('Media Requiring Review');
});
it.each(['2026-10-16','invalid',''])('7.58 source ID aliases and equal %p dates follow the report writer without adding unrelated photos',async date=>{
 const a={...A(),date},b={...B(),date};const foreign=update('foreign','2026-10-17','frame','East',['foreign-photo']);const result=await desktop([a,foreign,b],true,['cloud-row-update-2','cloud-row-update-1']);expect(result.resolved.media.map((m:any)=>m.id)).toEqual(['photo-Z','photo-B','photo-A']);
});
it('native report references and media retain the same canonical photo mapping across update list orders',async()=>{
 const references=buildReportImageReferences(fieldUpdatesNewestFirst([A(),B()]),['Tower']);const ids=references.map(r=>r.photoId);expect(ids).toEqual(['photo-Z','photo-B','photo-A']);const left=await resolveNativeReportWordMedia({updates:[A(),B()],reportPhotoIds:ids,drawingReferences:[]}),right=await resolveNativeReportWordMedia({updates:[B(),A()],reportPhotoIds:ids,drawingReferences:[]});expect(right.media.map(m=>[m.displayNumber,m.id,m.linkedTaskId])).toEqual(left.media.map(m=>[m.displayNumber,m.id,m.linkedTaskId]));
 const first=await buildReportWordBase64({title:'Tower',body,generatedAt:NOW,media:left.media}),second=await buildReportWordBase64({title:'Tower',body,generatedAt:NOW,media:right.media});const a=await JSZip.loadAsync(Buffer.from(first,'base64')),b=await JSZip.loadAsync(Buffer.from(second,'base64'));expect((await a.file('word/document.xml')!.async('string')).replace(/rId\d+/g,'rId')).toContain('Photo 3');expect((await b.file('word/document.xml')!.async('string'))).toContain('Photo 3');
});

it('7.58 authoritative current task paragraphs cite the same exact photo numbers after snapshot reordering',async()=>{
 const left=await desktop([B(),A()],false,undefined,true),right=await desktop([A(),B()],false,undefined,true);expect(right.paragraphs).toEqual(left.paragraphs);expect(right.paragraphs.some(p=>p.includes('Frame walls')&&p.endsWith('Photo 3 shows this work.'))).toBe(true);expect(right.paragraphs.some(p=>p.includes('Pour slab')&&p.endsWith('Photos 1 and 2 show this work.'))).toBe(true);
});
