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
import {fakeMedia,fakeImageBytes,fakePictureIn,fakeLabelsOf,installFakeBrowser} from '../fixtures/report-word-media-fakes';
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
const tasks=[['frame','Frame walls','East'],['pour','Pour slab','North']].map(([id,taskName,locationName])=>({id,taskName,locationName,projectId:PROJECT,projectName:'Tower',scheduleProjectName:'Tower',startDate:'10/01/2026',finishDate:'11/01/2026',owner:'Dana',contractor:'Acme',priority:'Medium',status:'In Progress',percentComplete:40,notes:'',milestone:'',nextAction:'',createdAt:'2026-10-01T12:00:00Z',updatedAt:'2026-10-16T12:00:00Z',cloudUpdatedAt:'2026-10-16T12:00:00Z'}));
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

import {buildDAVEReportProjectTruths} from '../../services/DAVEReportProjectTruths';
import {buildDAVEReportSourceOnPeriod,daveReportSourceParts} from '../../services/DAVEReportIntelligence';
import {sameReportSource} from '../../services/DAVEReportSnapshot';
function nativeTruths(updates:ProjectUpdate[]){return buildDAVEReportProjectTruths({projects:[{name:'Tower',projectId:PROJECT}],projectRecords:[{id:PROJECT,name:'Tower'}] as never,updates,scheduleItems:tasks as never,knownScheduleItems:tasks as never,referenceDocuments:[],now:NOW})}
function twins(caption:string){const one={...A(),date:'2026-10-16'},two={...B(),date:'2026-10-16',photos:B().photos.slice(0,1)};for(const u of [one,two])for(const p of u.photos)p.caption=caption;return [one,two]}
it.each(['','Same caption'])('7.33 same-day distinct photos with caption %p retain one report source and native/web already-sent recognition across device order',async caption=>{
 const rows=twins(caption),reverse=[...rows].reverse(),before=JSON.stringify(rows);
 const nativeA=nativeTruths(rows),nativeB=nativeTruths(reverse),webA=buildDAVEWebReportTruths(web(rows),null),webB=buildDAVEWebReportTruths(web(reverse),null);
 const source=(truths:Parameters<typeof buildDAVEReportSourceOnPeriod>[0])=>buildDAVEReportSourceOnPeriod(truths,null).fingerprint;
 fs.writeFileSync('../source-parts-'+(caption?'caption':'blank')+'.json',JSON.stringify({first:daveReportSourceParts(nativeA,null),second:daveReportSourceParts(nativeB,null),web:daveReportSourceParts(webB,null)},null,2));
 expect(source(nativeB)).toBe(source(nativeA));expect(source(webB)).toBe(source(webA));expect(source(webB)).toBe(source(nativeA));
 const sent=markReportSnapshotDelivered(buildDAVEReportSnapshot({truths:nativeA,scopeKey:'tower',sourceFingerprint:source(nativeA),capturedAt:NOW,reportFormat:'project_manager'}),NOW,'phone',null,null,reportTextKey({title:'Tower manual review',body}));expect(sameReportSource(sent.sourceFingerprint,source(nativeB))).toBe(true);expect(daveWebReportAlreadySentElsewhereAt(sent,source(webB),new Set(),{requiresTextKey:true,title:'Tower manual review',body})).toBe(NOW);
 const first=await desktop(rows),second=await desktop(reverse);expect(second.paragraphs).toEqual(first.paragraphs);expect(JSON.stringify(rows)).toBe(before);
});

it('7.33 preserves distinct attachments, authored photo order, task/area/words changes, and legacy as-built identity',async()=>{
 const rows=twins('Same caption');rows[1].photos.push({...B().photos[1],caption:'Same caption'});
 const source=(updates:ProjectUpdate[])=>buildDAVEReportSourceOnPeriod(nativeTruths(updates),null).fingerprint;
 const original=source(rows),before=JSON.stringify(rows);
 for(let n=0;n<16;n++)expect(source(n%2?[...rows].reverse():rows)).toBe(original);
 const word=await desktop(rows),reverse=await desktop([...rows].reverse(),true);
 expect(reverse.paragraphs).toEqual(word.paragraphs);expect(reverse.bytes.map(b=>fakeLabelsOf(fakePictureIn(b)!))).toEqual(word.bytes.map(b=>fakeLabelsOf(fakePictureIn(b)!)));expect(word.bytes).toHaveLength(3);
 expect(new Set(word.bytes.map(b=>Buffer.from(b).toString('base64'))).size).toBe(3);
 expect(word.resolved.media.map((p:any)=>p.id)).toEqual(['photo-Z','photo-B','photo-A']);
 const changed=(edit:(copy:ProjectUpdate[])=>void)=>{const copy=JSON.parse(before);edit(copy);expect(source(copy)).not.toBe(original);};
 changed(copy=>{copy[1].photos.reverse();});
 changed(copy=>{copy[0].photos[0].id='changed-attachment';});
 changed(copy=>{copy[0].scheduleItemId='pour';copy[0].scheduleTaskName='Pour slab';});
 changed(copy=>{copy[0].selectedAreaName='West';copy[0].photos[0].selectedAreaName='West';});
 changed(copy=>{copy[0].notes='An actual changed field observation.';});
 expect(JSON.stringify(rows)).toBe(before);
});

import {buildDAVEProjectTruth,daveProjectTruthAsBuilt} from '../../services/DAVEProjectTruth';
import {buildDAVELegacyReportSourceFingerprint} from '../../services/DAVEReportIntelligence';
it('7.33 preserves the original raw as-built fingerprint and latest-note date/ID tie order',()=>{
 const rows=twins('Same caption');
 for(const updates of [rows,[...rows].reverse()]) {
  const raw=buildDAVEProjectTruth({projectId:PROJECT,projectName:'Tower',updates,scheduleItems:tasks as never,knownScheduleItems:tasks as never,knownScheduleDocuments:[],reportLookaheadReplacement:true,projectAreas:[],referenceDocuments:[],now:NOW});
  const adapted=nativeTruths(updates);
  expect(daveProjectTruthAsBuilt(adapted[0]).evidence.records).toEqual(raw.evidence.records);
  expect(buildDAVELegacyReportSourceFingerprint(adapted)).toBe(buildDAVELegacyReportSourceFingerprint([raw]));
 }
 const ordered=fieldUpdatesNewestFirst(rows);expect(ordered.map(u=>u.id)).toEqual(['update-2','update-1']);
 expect(fieldUpdatesNewestFirst([...rows].reverse()).map(u=>u.id)).toEqual(ordered.map(u=>u.id));
});
