/** B77 desired duplicate-scope contracts (4.64/4.65 follow-up). Actual App preparation/approval and actual review UI.
 * PDF extraction, filesystem and cloud transport are synthetic boundaries; no PDF decoder/provider/backend is run.
 * This is a test-only RED stage: all runtime blobs remain byte-identical to B76 22ee.
 */
jest.mock('expo-audio', () => ({ RecordingPresets: { HIGH_QUALITY: {} }, requestRecordingPermissionsAsync: jest.fn(), setAudioModeAsync: jest.fn(), useAudioRecorder: () => ({}), useAudioRecorderState: () => ({}), useAudioPlayer: () => ({}), useAudioPlayerStatus: () => ({}), AudioModule: {} }));
jest.mock('expo-contacts', () => ({ Fields: {} }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-image-picker', () => ({ MediaTypeOptions: {} }));
jest.mock('expo-location', () => ({ Accuracy: { Balanced: 3, High: 4 } }));
jest.mock('expo-mail-composer', () => ({ MailComposerStatus: {} }));
jest.mock('expo-sharing', () => ({}));
jest.mock('expo-sms', () => ({}));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: () => null }));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: 'file:///docs/', cacheDirectory: 'file:///cache/', getInfoAsync: jest.fn(async () => ({ exists: true })), makeDirectoryAsync: jest.fn() }));

jest.mock('@react-native-async-storage/async-storage',()=>{const v=new Map<string,string>();const api={getItem:jest.fn(async(k:string)=>v.get(k)??null),setItem:jest.fn(async(k:string,x:string)=>{v.set(k,x)}),removeItem:jest.fn(async(k:string)=>{v.delete(k)}),getAllKeys:jest.fn(async()=>[...v.keys()]),multiGet:jest.fn(async(keys:string[])=>keys.map(k=>[k,v.get(k)??null]))};return {__esModule:true,default:api,...api};});
jest.mock('expo-crypto', () => ({ randomUUID: () => `uuid-${Math.random().toString(16).slice(2)}` }));
jest.mock('@expo/vector-icons/Ionicons', () => () => null);
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { utf8ToBytes } from '@noble/hashes/utils';
import { Modal } from 'react-native';

import { ScheduleImportFlow } from '../../components/ScheduleImportFlow';
import { findExactScheduleTaskForCompletionClaim, mergeReportedCompletionClaim } from '../../services/DAVECompletionVerification';
import { reconcileDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';
import { deletedDAVERecordIds } from '../../services/DAVESyncTombstones';
import { bindPIEScheduleImportBatchProvenance, dedupeScheduleImportItems, type PIEScheduleImportBatch } from '../../services/PIEScheduleImportBatch';
import { normalizeScheduleImport,normalizeMicrosoftProjectPdfRows } from '../../services/PIEScheduleIntelligence';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { normalizeReferenceDocument } from '../../services/ReferenceDocumentRepository';
import { scheduleDocumentsAfterApproval } from '../../services/ScheduleDocumentLabels';
import { mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import { ScheduleImportReviewError, scheduleImportApprovalBlocker, validateScheduleImportScope } from '../../services/ScheduleImportScopeGuard';
import { bindStableScheduleImportItemIds } from '../../services/ScheduleImportSourceIdentity';
import { scheduleImportAddsToMaster, withScheduleImportRole, type ScheduleImportRole } from '../../services/ScheduleLookahead';
import { createDAVEWebSupabaseGateway } from '../../services/DAVEWebSupabaseClient';
import { scheduleTurnedHighLineBetween } from '../../services/ScheduleTurnedHigh';
import { scheduleDocumentsAfterActivation, scheduleImportOfFile } from '../../services/SharedDocumentActivation';
import type { ReferenceDocument, ScheduleItem } from '../../types';

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const ts = jest.requireActual('typescript') as typeof import('typescript');
const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');

/** A function of the App component (two-space indent), brace-matched after its parameters. */
function componentFunction(name: string): string {
  const match = new RegExp(`\\n  (?:async )?function ${name}\\(`).exec(app);
  if (!match) throw new Error(`App.tsx has no component function ${name}`);
  let parameters = 0;
  let close = match.index + match[0].length - 1;
  for (; close < app.length; close += 1) {
    if (app[close] === '(') parameters += 1;
    if (app[close] === ')' && --parameters === 0) break;
  }
  const open = app.indexOf(' {\n', close) + 1;
  let depth = 0;
  for (let index = open; index < app.length; index += 1) {
    if (app[index] === '{') depth += 1;
    if (app[index] === '}') {
      depth -= 1;
      if (depth === 0) return app.slice(match.index + 3, index + 1);
    }
  }
  throw new Error('unbalanced function');
}

function compile<T>(names: string[], deps: Record<string, unknown>): T {
  const js = ts.transpileModule(
    [...names.map(componentFunction), `module.exports = { ${names.join(', ')} };`].join('\n'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React } },
  ).outputText;
  const mod = { exports: {} as T };
  new Function('module', 'exports', ...Object.keys(deps), js)(mod, mod.exports, ...Object.values(deps));
  return mod.exports;
}

const QUAY = '6101 Quay Works';
const MILL = '6102 Mill Yard';
const SHED = 'Garden shed';
const ALL = [QUAY, MILL, SHED];
const NEEDS = 'Needs Project';

type Row = readonly [task: string, project: string | null, start: string, finish: string];
type Picked = Readonly<{ name: string; contents: string; mimeType: string }>;
/** A schedule file as picked: Task, Project, Area, Start, Finish, Owner (the Project column only when asked for). */
const csv = (rows: readonly Row[], name = 'Field plan.csv', withProjectColumn = true): Picked => ({
  name,
  mimeType: 'text/csv',
  contents: [
    withProjectColumn ? 'Task,Project,Area,Start,Finish,Owner' : 'Task,Area,Start,Finish,Owner',
    ...rows.map(([task, project, start, finish]) =>
      [task, ...(withProjectColumn ? [project ?? ''] : []), 'Lot', start, finish, 'Sam'].join(',')),
  ].join('\n') + '\n',
});
/** The reviewer's file (H1S-1, probe 2z): two jobs by number, "Safety walk" on 10/30 for each, one other task each. */
const TWO_JOBS: readonly Row[] = [
  ['Safety walk', '6101', '10/26/2026', '10/30/2026'],
  ['Safety walk', '6102', '10/26/2026', '10/30/2026'],
  ['Pour footings', '6101', '10/26/2026', '10/30/2026'],
  ['Refit', '6102', '10/26/2026', '10/30/2026'],
];

type Overrides = Partial<Record<string, unknown>>;
/** The phone with these projects; App.tsx's own functions of a schedule file's import. */
function phone(picked: Picked, active: readonly string[] = ALL, overrides: Overrides = {}) {
  const alerts: Array<{ title: string; message: string }> = [];
  const bytes = utf8ToBytes(picked.contents);
  const asset = { uri: `file:///picked/${picked.name}`, name: picked.name, mimeType: picked.mimeType, size: bytes.length };
  const deps: Record<string, unknown> = {
    screen: 'Schedule',
    activeProjects: [...active], projects: [...active],
    archivedProjectsCurrentRef: { current: [] }, deletedProjectNamesRef: { current: [] },
    projectsCurrentRef: { current: [...active] }, projectRecordsCurrentRef: { current: [] },
    authorityProjectId: (name: string) => `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-key`,
    projectAreasForProject: () => [], projectAreasCurrentRef: { current: [] }, savedUpdatesRef: { current: [] },
    referenceDocumentsCurrentRef: { current: [] }, scheduleItemsCurrentRef: { current: [] },
    prepareExpoFileUploadPayload: async () => ({ data: bytes, sizeBytes: bytes.length }),
    scheduleImportOfFile, deletedDAVERecordIds, operationalSyncTombstonesRef: { current: [] },
    ensureReferenceDocumentsDirectory: async () => 'file:///reference-documents/',
    sanitizeFilename: (name: string) => name,
    FileSystem: { deleteAsync: async () => undefined, copyAsync: async () => undefined, readAsStringAsync: async () => picked.contents },
    normalizeReferenceDocument, normalizeScheduleImport, dedupeScheduleImportItems, bindStableScheduleImportItemIds,
    validateScheduleImportScope,
    deleteStoredReferenceDocument: async () => undefined,
    DocumentPicker: { getDocumentAsync: async () => ({ canceled: false, assets: [asset] }) },
    preflightExpoFileRead: async () => undefined,
    Alert: { alert: (title: string, message: string) => { alerts.push({ title, message }); } },
    ...overrides,
  };
  const fns = compile<{
    prepareScheduleImportFromAsset: (file: typeof asset, projects?: string[]) => Promise<PIEScheduleImportBatch | null>;
    importScheduleFile: (onProcessingStart?: () => void) => Promise<PIEScheduleImportBatch | null>;
  }>(['prepareScheduleImportFromAsset', 'importScheduleFile'], deps);
  return { ...fns, alerts, asset };
}

/** The same phone as Build 232 left it: the duplicate check and the ids without the file's project names. */
const asBuild232: Overrides = {
  dedupeScheduleImportItems: (items: ScheduleItem[]) => dedupeScheduleImportItems(items),
  bindStableScheduleImportItemIds: (items: ScheduleItem[], source: Parameters<typeof bindStableScheduleImportItemIds>[1]) =>
    bindStableScheduleImportItemIds(items, source),
};

/** Documents > Add Project Document > Schedule, these projects ticked (App.tsx 7462); a card's review passes its one. */
async function fromDocuments(picked: Picked, ticked: readonly string[], overrides: Overrides = {}) {
  const h = phone(picked, ALL, overrides);
  const batch = await h.prepareScheduleImportFromAsset(h.asset, [...ticked]);
  expect(h.alerts).toEqual([]);
  if (!batch) throw new Error('no batch');
  return batch;
}

const listed = (batch: PIEScheduleImportBatch) => batch.items.map(item => `${item.taskName} [${item.projectName}]`);
const fileOrder = ['Safety walk [Needs Project]', 'Safety walk [Needs Project]', 'Pour footings [Needs Project]', 'Refit [Needs Project]'];

/** Every promise of the pick and of the save, however many, has run. */
async function settled() {
  for (let turn = 0; turn < 5; turn += 1) await new Promise(resolve => setTimeout(resolve, 0));
}

/** App.tsx's own approveScheduleImport with the real services; what it keeps and what it sends to the cloud. */
type Saved = {documents: ReferenceDocument[]; items: ScheduleItem[]};
function approval(active: readonly string[], initial: Saved = {documents:[],items:[]}, picked?: Picked) {
  const scheduleItemsCurrentRef = { current: [...initial.items] };
  const referenceDocumentsCurrentRef = { current: [...initial.documents] };
  const gatewayRows: unknown[] = [];
  const client = {auth:{getUser:async()=>({data:{user:{id:'b77-owner'}},error:null})},rpc:async(name:string)=>({data:name==='dave_is_app_owner'?true:null,error:null,status:200}),from:(table:string)=>{if(table!=='reference_documents')throw Error(table);return{insert:async(row:unknown)=>{gatewayRows.push(row);return{data:null,error:null}}}},storage:{from:()=>({upload:async()=>({data:{path:'synthetic'},error:null}),remove:async()=>({data:[],error:null})})}};
  const gateway=createDAVEWebSupabaseGateway(client as never);
  const cloudSync = jest.fn(async (input: { scheduleItems: ScheduleItem[]; referenceDocuments: ReferenceDocument[] }) => {
    if(picked)for(const document of input.referenceDocuments){
      expect(document.webReport ?? null).toBeNull();
      const gatewayDocument: Parameters<typeof gateway.uploadAuthorizedReferenceDocument>[0]['document']={...document,webReport:null};
      await gateway.uploadAuthorizedReferenceDocument({document:gatewayDocument,bytes:utf8ToBytes(picked.contents).buffer as ArrayBuffer});
    }
    return {durablyQueued:true,fullySynced:true,supersededScheduleItemIds:[],supersededReferenceDocumentIds:[],uploadedReferenceDocuments:[]};
  });
  const noop = () => undefined;
  const { approveScheduleImport } = compile<{ approveScheduleImport: (batch: PIEScheduleImportBatch) => Promise<string | null> }>(['approveScheduleImport'], {
    archivedProjectsCurrentRef: { current: [] }, deletedProjectNamesRef: { current: [] },
    projectsCurrentRef: { current: [...active] }, projectRecordsCurrentRef: { current: [] },
    authorityProjectId: (name: string) => `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-key`,
    validateScheduleImportScope, scheduleImportApprovalBlocker, ScheduleImportReviewError,
    projectAreasForProject: () => [], projectAreasCurrentRef: { current: [] }, savedUpdatesRef: { current: [] },
    bindPIEScheduleImportBatchProvenance, canonicalizeScheduleIdentityItems: (items: unknown[]) => items,
    normalizeScheduleItem: nativeNormalizeScheduleItem, identityCorrections: [], daveRegisteredIdentityNames: () => [],
    ensureScheduleParentProjects: noop, mergeApprovedScheduleImportItems, scheduleItemsVisibleBeforeImport, scheduleImportAddsToMaster,
    findExactScheduleTaskForCompletionClaim, mergeReportedCompletionClaim,
    reconcileDAVEScheduleRecords, scheduleDocumentsAfterApproval, normalizeReferenceDocument,
    runScheduleImportCloudSync: cloudSync, markScheduleItemsAuthorityReady: noop, markReferenceDocumentsAuthorityReady: noop,
    setScheduleItems: noop, setReferenceDocuments: noop, scheduleItemsCurrentRef, referenceDocumentsCurrentRef,
    projectScheduleImportCardRef: { current: null }, markProjectScheduleCardCurrent: noop, Alert: { alert: jest.fn() },
    scheduleTurnedHighLineBetween,
  });
  return { approveScheduleImport, cloudSync, gatewayRows, scheduleItemsCurrentRef, referenceDocumentsCurrentRef };
}


import {normalizeScheduleItem as nativeNormalizeScheduleItem} from '../../App';

const A='Alpha Yard', B='Birch Lane';
const FULL='Full schedule (replaces)', LOOK='Lookahead / partial (adds to the master)';
const BODY='Task,Area,Start,Finish,Owner\nPour footings,Lot,10/26/2026,10/30/2026,Sam\nSet steel,Lot,11/02/2026,11/06/2026,Sam\n';
function pickedFile(format:'csv'|'pdf'):Picked{return{name:`Weekly plan.${format}`,mimeType:format==='pdf'?'application/pdf':'text/csv',contents:format==='pdf'?'%PDF-1.4\n% synthetic immutable extraction boundary\n%%EOF\n':BODY};}
async function prepare(picked:Picked, saved:Saved, selected:string[]){
 const overrides:Overrides={referenceDocumentsCurrentRef:{current:saved.documents},scheduleItemsCurrentRef:{current:saved.items}};
 if(picked.mimeType==='application/pdf')Object.assign(overrides,{isDavePdfTextExtractionAvailable:()=>false,extractSchedulePdfWithServer:async()=>({items:normalizeScheduleImport({contents:BODY,sourceName:'extracted.csv',mimeType:'text/csv',projects:selected}).items,warnings:[]})});
 const h=phone(picked,[A,B],overrides);
 const batch=await h.prepareScheduleImportFromAsset(h.asset,selected);
 expect(h.alerts).toEqual([]);expect(batch).toBeTruthy();if(!batch)throw Error('missing actual prepared batch');return batch;
}
async function previouslyImported(picked:Picked, role:ScheduleImportRole='lookahead'):Promise<Saved>{
 const batch=await prepare(picked,{documents:[],items:[]},[A]);
 // RED2 setup correction: projectless rows need actual review assignment even with one selected project.
 const before=JSON.stringify(batch);
 const {view,save,onApprove}=await openReview(batch,{documents:[],items:[]},picked);
 assign(view,batch.items.map(()=>A));await accept(view,role);
 expect(onApprove).toHaveBeenCalledTimes(1);expect(save.cloudSync).toHaveBeenCalledTimes(1);
 expect(save.gatewayRows).toHaveLength(1);
 const saved={documents:save.referenceDocumentsCurrentRef.current,items:save.scheduleItemsCurrentRef.current};
 expect(saved.documents.some(document=>document.importBatchId===batch.id)).toBe(true);
 expect(saved.items.map(item=>[item.id,item.projectName])).toEqual(batch.items.map(item=>[item.id,A]));
 expect(saved.documents[0]).toMatchObject({id:batch.documents[0].id,contentSha256:batch.documents[0].contentSha256,importBatchId:batch.id,projectNames:[A],scheduleRole:role});
 expect(save.gatewayRows[0]).toMatchObject({id:batch.documents[0].id,document_data:{id:batch.documents[0].id,contentSha256:batch.documents[0].contentSha256,importBatchId:batch.id,projectNames:[A],scheduleRole:role}});
 expect(JSON.stringify(batch)).toBe(before);view.unmount();return saved;
}
async function openReview(batch:PIEScheduleImportBatch,saved:Saved,picked:Picked){
 const save=approval([A,B],saved,picked);
 const onApprove=jest.fn(save.approveScheduleImport);
 const view=render(<ScheduleImportFlow screenshotImportAvailable={false} onImportFile={jest.fn(async()=>null)} onImportScreenshots={jest.fn(async()=>null)} onAddManually={jest.fn()} onApprove={onApprove} onCancel={jest.fn()} incomingBatch={batch} roleContext={{documents:saved.documents,items:saved.items}} onIncomingBatchConsumed={jest.fn()}/>);
 await act(settled);return{view,save,onApprove};
}
function assign(view:ReturnType<typeof render>,projects:string[]){
 for(const edit of view.queryAllByText('Review or edit'))fireEvent.press(edit);
 const inputs=view.getAllByPlaceholderText('Project');expect(inputs).toHaveLength(projects.length);
 inputs.forEach((input,index)=>fireEvent.changeText(input,projects[index]));
}
async function accept(view:ReturnType<typeof render>,role:ScheduleImportRole,partial=false){
 fireEvent.press(view.getByText(role==='master'?FULL:LOOK));
 await act(async()=>{fireEvent.press(view.getByText(partial?'Accept Selected (1)':'Accept All (2)'));await settled();});
}
function assertQueuedIdentity(save:ReturnType<typeof approval>,batch:PIEScheduleImportBatch,projects:string[],role:ScheduleImportRole,exactQueuedIdByIncomingId?:ReadonlyMap<string,string>){
 expect(save.cloudSync).toHaveBeenCalledTimes(1);
 const sent=save.cloudSync.mock.calls[0][0];
 expect(sent.referenceDocuments).toHaveLength(1);const document=sent.referenceDocuments[0];
 expect(document).toMatchObject({id:batch.documents[0].id,contentSha256:batch.documents[0].contentSha256,importBatchId:batch.id,scheduleRole:role,projectNames:projects});
 if(exactQueuedIdByIncomingId){
  const expected=batch.items.filter(item=>projects.includes(item.projectName)).map(item=>exactQueuedIdByIncomingId.get(item.id) ?? item.id);
  expect(sent.scheduleItems.map(item=>item.id).sort()).toEqual(expected.sort());
 }else expect(sent.scheduleItems.map(item=>item.id)).toEqual(batch.items.filter(item=>projects.includes(item.projectName)).map(item=>item.id));
 expect(save.gatewayRows).toHaveLength(1);
 expect(save.gatewayRows[0]).toMatchObject({id:document.id,owner_id:'b77-owner',document_data:{id:document.id,contentSha256:document.contentSha256,importBatchId:batch.id,projectNames:projects,scheduleRole:role,storagePath:expect.stringContaining(document.id)}});
}

for(const format of ['csv','pdf'] as const)for(const role of ['master','lookahead'] as const){
 it(`B77 actual ${format} review refuses previously imported lookahead A after widened selection and explicit ${role}`,async()=>{
  const picked=pickedFile(format),saved=await previouslyImported(picked),batch=await prepare(picked,saved,[A,B]);
  expect(batch.items.map(item=>item.projectName)).toEqual([NEEDS,NEEDS]);
  expect(batch.documents[0].contentSha256).toBe(saved.documents[0].contentSha256);
  expect(batch.documents[0].id).not.toBe(saved.documents[0].id);
  const before=JSON.stringify({batch,saved});const {view,save,onApprove}=await openReview(batch,saved,picked);assign(view,[A,A]);await accept(view,role);
  console.log('B77_DUPLICATE_TRACE',JSON.stringify({format,role,source:batch.documents[0],prior:saved.documents[0],approvals:onApprove.mock.calls.length,queued:save.cloudSync.mock.calls,gateway:save.gatewayRows}));
  expect(onApprove).not.toHaveBeenCalled();expect(save.cloudSync).not.toHaveBeenCalled();expect(save.gatewayRows).toEqual([]);
  expect(view.getByText('Review Imported Schedule')).toBeTruthy();expect(JSON.stringify({batch,saved})).toBe(before);view.unmount();
 });
 it(`B77 actual ${format} same bytes intentionally reviewed for different B remain importable as ${role}`,async()=>{
  const picked=pickedFile(format),saved=await previouslyImported(picked),batch=await prepare(picked,saved,[A,B]);
  const before=JSON.stringify({batch,saved});const {view,save}=await openReview(batch,saved,picked);assign(view,[B,B]);await accept(view,role);
  assertQueuedIdentity(save,{...batch,items:batch.items.map(item=>({...item,projectName:B}))},[B],role);
  expect(JSON.stringify({batch,saved})).toBe(before);view.unmount();
 });
}

it('B77 linked saved tasks independently establish prior import when the document has no importBatchId',async()=>{
 const picked=pickedFile('csv'),original=await previouslyImported(picked);
 const saved={documents:original.documents.map(document=>({...document,importBatchId:undefined})),items:original.items.map(item=>({...item,sourceDocumentId:original.documents[0].id}))};
 const batch=await prepare(picked,saved,[A,B]);const {view,save,onApprove}=await openReview(batch,saved,picked);assign(view,[A,A]);await accept(view,'lookahead');
 expect(onApprove).not.toHaveBeenCalled();expect(save.cloudSync).not.toHaveBeenCalled();expect(save.gatewayRows).toEqual([]);view.unmount();
});
for(const role of ['master','lookahead'] as const)it(`B77 document-only upload without an imported batch or linked tasks does not block ${role}`,async()=>{
 const picked=pickedFile('csv'),prior=await previouslyImported(picked);
 const saved:Saved={documents:prior.documents.map(document=>({...document,importBatchId:undefined})),items:[]};
 const batch=await prepare(picked,saved,[A,B]);const {view,save}=await openReview(batch,saved,picked);assign(view,[A,A]);await accept(view,role);
 assertQueuedIdentity(save,{...batch,items:batch.items.map(item=>({...item,projectName:A}))},[A],role);view.unmount();
});
for(const project of [A,B])it(`B77 partial ready ${project} uses the reviewed subset rather than the pending A+B label`,async()=>{
 const picked=pickedFile('csv'),saved=await previouslyImported(picked),batch=await prepare(picked,saved,[A,B]);
 const {view,save,onApprove}=await openReview(batch,saved,picked);assign(view,[project,NEEDS]);await accept(view,'lookahead',true);
 if(project===A){expect(onApprove).not.toHaveBeenCalled();expect(save.cloudSync).not.toHaveBeenCalled();expect(save.gatewayRows).toEqual([]);expect(view.getAllByPlaceholderText('Project')).toHaveLength(2);}
 else{assertQueuedIdentity(save,{...batch,items:[{...batch.items[0],projectName:B}]},[B],'lookahead');expect(view.getAllByPlaceholderText('Project')).toHaveLength(1);
  // The deliberate subset role is inherited by the pending row; it is not silently turned into a full schedule.
  expect(onApprove.mock.calls[0][0].documents[0].scheduleRole).toBe('lookahead');
  fireEvent.changeText(view.getByPlaceholderText('Project'),B);
  await act(async()=>{fireEvent.press(view.getByText('Accept All (1)'));await settled();});
  expect(onApprove).toHaveBeenCalledTimes(2);expect(save.cloudSync).toHaveBeenCalledTimes(2);
  const continuation=onApprove.mock.calls[1][0];
  expect(continuation.id).toBe(batch.id);expect(continuation.documents).toEqual([]);
  expect(scheduleImportAddsToMaster(continuation,save.referenceDocumentsCurrentRef.current)).toBe(true);
  expect(save.scheduleItemsCurrentRef.current.filter(item=>item.importBatchId===batch.id).map(item=>[item.id,item.projectName]).sort()).toEqual(batch.items.map(item=>[item.id,B]).sort());
 }
 view.unmount();
});
it('B77 an actually reviewed full A+B scope is distinct from the prior A-only import',async()=>{
 const picked=pickedFile('csv'),saved=await previouslyImported(picked),batch=await prepare(picked,saved,[A,B]);
 const {view,save}=await openReview(batch,saved,picked);assign(view,[A,B]);await accept(view,'master');
 // RED3 oracle correction: an unchanged task is rehomed under its existing ID, not duplicated with the incoming row ID.
 const reviewed=batch.items.map((item,index)=>({...item,projectName:[A,B][index]}));
 const tuple=(item:ScheduleItem)=>[item.projectName,item.taskName,item.locationName,item.startDate,item.finishDate,item.owner,item.contractor];
 const matches=saved.items.filter(item=>JSON.stringify(tuple(item))===JSON.stringify(tuple(reviewed[0])));
 expect(matches).toHaveLength(1);const priorA=matches[0];
 expect(priorA.id).not.toBe(reviewed[0].id);
 const exactIds=new Map([[reviewed[0].id,priorA.id],[reviewed[1].id,reviewed[1].id]]);
 assertQueuedIdentity(save,{...batch,items:reviewed},[A,B],'master',exactIds);
 const queued=save.cloudSync.mock.calls[0][0].scheduleItems;
 expect(queued).toHaveLength(2);
 const queuedA=queued.find(item=>item.id===priorA.id),queuedB=queued.find(item=>item.id===reviewed[1].id);
 expect(queuedA).toBeTruthy();expect(queuedB).toBeTruthy();
 expect(tuple(queuedA!)).toEqual(tuple(reviewed[0]));expect(tuple(queuedB!)).toEqual(tuple(reviewed[1]));
 expect(queuedA).toMatchObject({id:priorA.id,importBatchId:priorA.importBatchId,sourceDocumentId:priorA.sourceDocumentId,alsoImportedInBatchIds:expect.arrayContaining([batch.id])});
 expect(queuedB).toMatchObject({id:reviewed[1].id,importBatchId:batch.id,sourceDocumentId:batch.documents[0].id});
 view.unmount();
});
