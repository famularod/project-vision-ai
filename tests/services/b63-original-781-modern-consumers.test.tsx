/** B63: original grouped 7.81, replayed against frozen B62. Synthetic rows only.
 * Actual native normalization, authorized desktop row projection, modern recipes,
 * runtime/Word and sent-receipt consumers; historical setup retained as test infrastructure.
 */
jest.mock('@react-native-async-storage/async-storage', () => {
  const values = new Map<string, string>();
  const api = {
    getItem: jest.fn(async (k: string) => values.get(k) ?? null), setItem: jest.fn(async (k: string, v: string) => { values.set(k, v); }),
    removeItem: jest.fn(async (k: string) => { values.delete(k); }), getAllKeys: jest.fn(async () => [...values.keys()]),
    multiGet: jest.fn(async (keys: string[]) => keys.map(k => [k, values.get(k) ?? null])), multiSet: jest.fn(async () => undefined), multiRemove: jest.fn(async () => undefined),
  };
  return { __esModule: true, default: api, ...api };
});
// App.tsx's own normalizers are imported: its native modules are stood in for (as tests/app-shell-smoke does).
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
const mockRows: { rows: unknown } = { rows: null };
jest.mock('../../services/DAVEWebSupabaseClient', () => ({ ...jest.requireActual('../../services/DAVEWebSupabaseClient'), daveWebSupabaseGateway: { ...jest.requireActual('../../services/DAVEWebSupabaseClient').daveWebSupabaseGateway, loadAuthorizedRows: async () => mockRows.rows } }));

import { normalizeScheduleItem, normalizeUpdate } from '../../App';
import { loadDAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import { buildDAVEWebReportDraft, buildDAVEWebReportTruths, daveWebScheduleItemAsThePhoneHoldsIt } from '../../services/DAVEWebOperations';
import { buildDAVEReportProjectTruths } from '../../services/DAVEReportProjectTruths';
import { buildCombinedReportAuthorityScope, buildDailyReportAuthorityScope } from '../../services/ReportAuthorityScope';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { isDAVESafeCloudScheduleRecord, reconcileDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';
import { normalizeReferenceDocuments } from '../../services/ReferenceDocumentRepository';
import { buildDAVEReportBriefing, buildDAVEReportSourceOnPeriod } from '../../services/DAVEReportIntelligence';
import { buildDAVEReportSnapshot, daveReportSnapshotScopeKey, markReportSnapshotDelivered, reportBaselineSnapshot, reportSnapshotToSave, type DAVEReportSnapshot } from '../../services/DAVEReportSnapshot';
import { referenceDocumentsCitedAsListed, withoutListedPageIndexes } from '../../services/ECOSDocumentIndexPersistence';
import { scheduleSavedTasksOfProjects } from '../../services/ScheduleTaskRevisions';
import { partitionProjectUpdatesByDeletedTask } from '../../services/DAVEDeletedTaskEvidence';
import type { ScheduleItem } from '../../types';

const P1 = { id: '3e9b5c1a-7d2f-4a60-8b14-6c0e2f9a1d57', name: 'Harbor Point' };
const P2 = { id: '6a1f0c2e-9b3d-4e75-a8c6-0d4b7e2f1a93', name: 'Maple Court' };
const DAY = 86_400_000;
/** 15 Oct 2026, 1:50 PM in New York: just before the phone's send. */
const T0 = Date.parse('2026-10-15T17:50:00.000Z');
const isoAt = (days: number) => new Date(T0 + days * DAY).toISOString();
const usDay = (days: number) => { const date = new Date(T0 + days * DAY); return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}/${date.getFullYear()}`; };
type Format = 'project_manager' | 'executive';

type World = {
  projects: { id: string; name: string }[];
  tasks: ScheduleItem[];
  updates: ReturnType<typeof normalizeUpdate>[];
  documents: ReturnType<typeof normalizeReferenceDocuments>;
  areas: Record<string, unknown>[];
  tombstones: { entity_type: string; record_id: string; deleted_at: string }[];
};

/** Records as the phone holds them: made with App.tsx's own normalizers, as the phone saves them. */
function onThePhone(input: { projects?: World['projects']; tasks?: unknown[]; updates?: unknown[]; documents?: unknown[]; areas?: World['areas']; tombstones?: World['tombstones'] }): World {
  return {
    projects: input.projects ?? [P1],
    tasks: (input.tasks ?? []).map(item => normalizeScheduleItem(item as Partial<ScheduleItem>)),
    updates: (input.updates ?? []).map(item => normalizeUpdate(item as never)),
    documents: normalizeReferenceDocuments(input.documents ?? []),
    areas: input.areas ?? [],
    tombstones: input.tombstones ?? [],
  };
}

/** The cloud rows of those records, as the phone uploads them (SupabaseService upsertScheduleItem, saveProjectUpdate, upsertReferenceDocument). */
function rowsOf(world: World, rowTime = isoAt(-0.05), rewrite: (row: { item_data?: any; update_data?: any; document_data?: any }) => void = () => undefined) {
  const json = (value: unknown) => JSON.parse(JSON.stringify(value));
  const rows = {
    projects: world.projects.map(project => ({ id: project.id, name: project.name, status: 'Active', archived: false, is_favorite: false, created_at: '2026-09-01T00:00:00.000Z', updated_at: rowTime, owner_id: 'owner-1', project_data: null })),
    scheduleItems: world.tasks.map(item => ({ id: item.id, owner_id: 'owner-1', project_id: (item as any).projectId, project_name: item.projectName, task_name: item.taskName, item_data: json(item), created_at: rowTime, updated_at: rowTime })),
    projectUpdates: world.updates.map(update => ({ id: update.id, project_id: (update as any).projectId, project_name: update.projectName || 'Unassigned Project', area_name: update.selectedAreaName || '', idempotency_key: update.id, update_data: json(update), created_at: update.date, updated_at: rowTime, owner_id: 'owner-1' })),
    referenceDocuments: world.documents.map(document => ({ id: document.id, updated_at: rowTime, document_data: json(document) })),
    syncTombstones: world.tombstones,
    projectAreas: world.areas,
  };
  [...rows.scheduleItems, ...rows.projectUpdates, ...rows.referenceDocuments].forEach(rewrite);
  return rows;
}
type Rows = ReturnType<typeof rowsOf>;

/** What the iPad holds once it has downloaded the rows (App.tsx's refresh: safe tasks only, its normalizers, deletions). */
function downloaded(rows: Rows) {
  const deleted = (type: string) => new Set(rows.syncTombstones.filter(row => row.entity_type === type).map(row => row.record_id));
  const deletedTasks = deleted('schedule_item');
  const deletedDocuments = deleted('reference_document');
  return {
    projects: rows.projects.map(project => ({ id: project.id, name: project.name })),
    tasks: reconcileDAVEScheduleRecords(rows.scheduleItems.map(row => ({ ...row.item_data, id: row.id })).filter(isDAVESafeCloudScheduleRecord)
      .map(item => normalizeScheduleItem(item)).filter(item => item.taskName.trim() && !deletedTasks.has(item.id))),
    updates: rows.projectUpdates.map(row => normalizeUpdate(row.update_data)),
    documents: normalizeReferenceDocuments(rows.referenceDocuments.map(row => ({ ...row.document_data, id: row.id, cloudUpdatedAt: row.updated_at })).filter(document => !deletedDocuments.has(document.id))),
    areas: rows.projectAreas,
    tombstones: rows.syncTombstones.map(row => ({ entityType: row.entity_type, recordId: row.record_id, deletedAt: row.deleted_at })),
  };
}

/** (a) The phone's Reports screen: App.tsx liveAuthorityInput (its scope for the report), then ReportsScreen.tsx reportTruths. */
function phoneTruths(records: ReturnType<typeof downloaded>, names: readonly string[] = [P1.name]) {
  const authoritative = selectAuthoritativeScheduleItems({ scheduleItems: records.tasks, scheduleDocuments: records.documents } as never) as unknown as ScheduleItem[];
  const active = partitionProjectUpdatesByDeletedTask(records.updates, records.tombstones as never, update => update, { scheduleItems: records.tasks } as never).active.filter(update => !update.isArchived);
  const input = { selectedProjectNames: names, projectRecords: records.projects, updates: active, scheduleItems: authoritative, currentUpdate: null, projectAreas: records.areas as never, knownScheduleItems: records.tasks, referenceDocuments: records.documents, projectDocuments: [], captureMemories: [], contacts: { contacts: [] } as never };
  const scope = names.length === 1 ? buildDailyReportAuthorityScope({ ...input, selectedProjectName: names[0] }) : buildCombinedReportAuthorityScope(input);
  return buildDAVEReportProjectTruths({
    projects: names.map(name => ({ name, projectId: `report:${name.toLowerCase()}` })),
    projectRecords: names.map(name => ({ name })),
    updates: scope.updates,
    scheduleItems: scope.scheduleItems,
    knownScheduleItems: scheduleSavedTasksOfProjects(records.tasks, scope.scheduleItems, scope.projectNames),
    knownScheduleDocuments: records.documents,
    projectAreas: scope.projectAreas,
    referenceDocuments: withoutListedPageIndexes([...scope.referenceDocuments]),
    drawingDocuments: referenceDocumentsCitedAsListed([...scope.referenceDocuments]),
  });
}

/** (b) The computer's Reports page: its own loader over the rows, then its truths. */
async function computerSnapshot(rows: Rows) {
  mockRows.rows = rows;
  return loadDAVEWebReadOnlySnapshot();
}

const useClock = (ms: number) => jest.useFakeTimers({ now: ms, doNotFake: ['nextTick', 'setImmediate', 'setInterval', 'setTimeout', 'clearTimeout', 'clearInterval', 'queueMicrotask'] });
afterEach(() => jest.useRealTimers());

function sendOf(truths: ReturnType<typeof phoneTruths>, previous: DAVEReportSnapshot | null, at: string, format: Format, names: readonly string[]) {
  const fingerprint = buildDAVEReportSourceOnPeriod(truths, previous, format).fingerprint;
  const current = buildDAVEReportSnapshot({ truths, scopeKey: daveReportSnapshotScopeKey(names), sourceFingerprint: fingerprint, capturedAt: truths.map(truth => truth.generatedAt).sort().at(-1), reportFormat: format });
  return { fingerprint, sent: markReportSnapshotDelivered(reportSnapshotToSave(current, previous) ?? previous!, at, 'phone-install') };
}

/**
 * Oct 14: the phone sends the report of `before`. Oct 15, 1:52 PM: the phone (as every device that downloaded the
 * rows) sends the report of `after`, counted from Oct 14. The computer reads `after`'s rows (or `computerRows`).
 */
async function theSend(before: Rows, after: Rows, format: Format = 'project_manager', all = false, computerRows: Rows = after) {
  const names = all ? after.projects.map(project => project.name) : [P1.name];
  useClock(T0 - DAY);
  const oct14 = sendOf(phoneTruths(downloaded(before), names), null, isoAt(-0.99), format, names).sent;
  useClock(T0);
  const phone = phoneTruths(downloaded(after), names);
  const { fingerprint, sent } = sendOf(phone, oct14, isoAt(0.0014), format, names);
  const snapshot = await computerSnapshot(computerRows);
  const computer = buildDAVEWebReportTruths(snapshot, all ? null : P1.name);
  const computerFingerprint = buildDAVEReportSourceOnPeriod(computer, sent, format).fingerprint;
  const countedFrom = reportBaselineSnapshot(sent, sent.sourceFingerprint);
  const result = {
    phoneSent: fingerprint,
    computer: computerFingerprint,
    /** The phone (or the iPad) holding the computer's rows, on the same period. */
    phoneOnTheComputersRows: buildDAVEReportSourceOnPeriod(phoneTruths(downloaded(computerRows), names), sent, format).fingerprint,
    phoneWhatChanged: buildDAVEReportBriefing({ truths: phone, previousSnapshot: countedFrom }).whatChanged,
    computerWhatChanged: buildDAVEWebReportDraft(snapshot, all ? null : P1.name, { previousSnapshot: countedFrom, waitingForOtherDevice: false }).whatChanged,
  };
  jest.useRealTimers();
  return result;
}

// ---------------------------------------------------------------------------------------------------------------
// The records: the live project's shapes (made-up names), and random ones.
// ---------------------------------------------------------------------------------------------------------------
const task = (over: Record<string, unknown>) => ({
  projectId: P1.id, projectName: P1.name, scheduleProjectName: P1.name, owner: '', contractor: '', milestone: '', notes: '', nextAction: '',
  priority: 'Medium', status: 'Not Started', percentComplete: 0, createdAt: isoAt(-14), ...over,
});
const photo = (id: string, caption: string, area: string | null, over: Record<string, unknown> = {}) => ({
  id, uri: `file:///docs/photos/${id}.jpg`, caption, category: 'Update', actionRequired: '', actionOwner: '', actionDueDate: '', actionStatus: 'Open',
  fileName: `${id}.jpg`, mimeType: 'image/jpeg', cloudStoragePath: `owner-1/${id}.jpg`, selectedAreaName: area, ...over,
});
const update = (over: Record<string, unknown>) => ({ projectId: P1.id, projectName: P1.name, scheduleProjectName: P1.name, status: 'sent', recipients: { contactIds: [] }, photos: [], ...over });
const document = (over: Record<string, unknown>) => ({ projectId: P1.id, projectName: P1.name, projectNames: [P1.name], mimeType: 'application/pdf', notes: '', isCurrent: false, ...over });


import { daveReportSourceParts, enhanceDAVEReportDraft, buildDAVELegacyReportSourceFingerprint } from '../../services/DAVEReportIntelligence';
import { buildPIECoreIntelligence } from '../../services/PIECoreIntelligence';
import { formatDAVEWebReport } from '../../services/DAVEWebOperations';
import { buildReportWordBase64 } from '../../services/ReportWordDocument';
import JSZip from 'jszip';
const legacyGoldens:Record<string,{phone:string;desktop:string}>=require('../fixtures/b63-raw-legacy-goldens.json');
import { reportWordPhotoDescription } from '../../services/ReportWordMediaDescription';
const rawTask = task({ id:'legacy-task',taskName:'Install canopy',locationName:'Canopy',startDate:'10/01/2026',finishDate:'10/20/2026',notes:'Confirm canopy bolts',createdAt:isoAt(-14),updatedAt:isoAt(-2),status:'In Progress',percentComplete:40 });
const validVerificationInput={status:'pm_verified',reportedAt:isoAt(-4),reportedBy:'Dana',priorScheduleStatus:'In Progress',priorPercentComplete:40,verifiedAt:isoAt(-3),verifiedBy:'Dana',verificationNote:'Canopy accepted',evidence:[{id:'inspection',kind:'pm_confirmation',sourceName:'Dana',sourceRecordId:'legacy-task',summary:'Canopy accepted',recordedAt:isoAt(-3)}]};
const validVerification=normalizeScheduleItem({...rawTask,completionVerification:validVerificationInput} as never).completionVerification;
const rowsFor=(over:Record<string,unknown>={})=>rowsOf(onThePhone({tasks:[rawTask]}),isoAt(-1),row=>{if(row.item_data)Object.assign(row.item_data,over);});
function differences(a:any,b:any,path='$'):any[]{
 if(JSON.stringify(a)===JSON.stringify(b))return [];
 if(a&&b&&typeof a==='object'&&typeof b==='object')return [...new Set([...Object.keys(a),...Object.keys(b)])].flatMap(k=>differences(a[k],b[k],path+'.'+k));
 return [{path,phone:a??null,desktop:b??null}];
}
async function word(body:string,taskLines:any[],updates:any[]=[]){
 const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlL6iQAAAAASUVORK5CYII=','base64'));
 const media=updates.flatMap(u=>(u.photos??[]).map((p:any)=>({...reportWordPhotoDescription(p,u),id:p.id,kind:'photo' as const,data:png,mimeType:'image/png',width:1,height:1})));
 const zip=await JSZip.loadAsync(Buffer.from(await buildReportWordBase64({title:'Synthetic report',body,generatedAt:isoAt(0),taskLines,media}),'base64'));
 return [...(await zip.file('word/document.xml')!.async('string')).matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map(m=>m[1]);
}
async function observe(rows:Rows,format:Format){
 useClock(T0);
 const held=downloaded(rows),phone=phoneTruths(held),snapshot=await computerSnapshot(rows),desktop=buildDAVEWebReportTruths(snapshot,P1.name);
 const sent=sendOf(phone,null,isoAt(0.0014),format,[P1.name]).sent;
 const p=buildDAVEReportSourceOnPeriod(phone,sent,format),d=buildDAVEReportSourceOnPeriod(desktop,sent,format);
 const pb=buildDAVEReportBriefing({truths:phone,previousSnapshot:p.countedFrom}),db=buildDAVEWebReportDraft(snapshot,P1.name,{previousSnapshot:d.countedFrom,waitingForOtherDevice:false});
 const core=buildPIECoreIntelligence({runtimeContext:{projectName:P1.name,projectNames:[P1.name],reportType:'daily_project_update',updates:held.updates,scheduleItems:held.tasks,knownScheduleItems:held.tasks,currentUpdate:null,projectAreas:[],contacts:{contacts:[]},referenceDocuments:[],surface:'reports'},reportType:'daily_project_update',reportProjectNames:[P1.name],organizationId:'local-unverified-anonymous',projectId:'synthetic-project'} as never);
 const written=enhanceDAVEReportDraft(core.reportDraft as never,pb,format);
 const webBody=formatDAVEWebReport(db,format);
 const pw=await word(written.body,[...pb.wordTaskLines],held.updates),dw=await word(webBody,[...db.wordTaskLines],held.updates);
 const nativeRows={...rows,scheduleItems:rows.scheduleItems.map(row=>({...row,item_data:normalizeScheduleItem(row.item_data)}))};
 const nativeSnapshot=await computerSnapshot(nativeRows);
 const nativeTruth=buildDAVEWebReportTruths(nativeSnapshot,P1.name);
 const nativePeriod=buildDAVEReportSourceOnPeriod(nativeTruth,sent,format);
 const nativeBriefing=buildDAVEWebReportDraft(nativeSnapshot,P1.name,{previousSnapshot:nativePeriod.countedFrom,waitingForOtherDevice:false});
 const nativeBody=formatDAVEWebReport(nativeBriefing,format);
 const nativeWord=await word(nativeBody,[...nativeBriefing.wordTaskLines],held.updates);
 const rawLegacy={phone:buildDAVELegacyReportSourceFingerprint(phone),desktop:buildDAVELegacyReportSourceFingerprint(desktop)};
 const goldenKey=JSON.stringify([format,rows.scheduleItems[0].item_data,rows.projectUpdates]);
 expect(rawLegacy).toEqual(legacyGoldens[goldenKey]);
 console.log('B63_RAW_LEGACY '+JSON.stringify({goldenKey,rawLegacy}));
 const result={rawLegacy,desktopRawVsNativeWordDiff:differences(nativeWord,dw),desktopRawVsNativeBodyDiff:differences(nativeBody,webBody),phoneWord:pw,desktopWord:dw,format,phoneFingerprint:p.fingerprint,desktopFingerprint:d.fingerprint,recognizesPhoneSend:p.fingerprint===d.fingerprint,held:held.tasks[0],loaded:snapshot.scheduleItems[0],recipeDiff:differences(daveReportSourceParts(phone,sent,format),daveReportSourceParts(desktop,sent,format)),briefingDiff:differences(pb,db),actualWordDiff:differences(pw,dw),phoneRuntimeBody:written.body,desktopBody:webBody};
 console.log('B63_DIAGNOSTIC '+JSON.stringify(result));
 return result;
}
describe('B63 original 7.81 same raw authorized row',()=>{
 for(const format of ['project_manager','executive'] as const){
  it(format+' incomplete verification must recognize the same sent report',async()=>{
   const r=await observe(rowsFor({completionVerification:{status:'pm_verified',reportedAt:isoAt(-4),verifiedBy:'Dana'}}),format);
   expect(r.held.completionVerification).toBeNull();
   expect(r.recognizesPhoneSend).toBe(true);
  });
  it(format+' blank project with real schedule parent must recognize the same sent report',async()=>{
   const r=await observe(rowsFor({projectName:'',scheduleProjectName:P1.name}),format);
   expect(r.held.projectName).toBe('');
   expect(r.recognizesPhoneSend).toBe(true);
  });
  it(format+' complete valid verification keeps parity and genuine task content invalidates',async()=>{
   const r=await observe(rowsFor({completionVerification:validVerification}),format);
   expect(r.held.completionVerification).not.toBeNull();
   const changed=await observe(rowsFor({completionVerification:validVerification,taskName:'Inspect changed canopy'}),format);
   expect(changed.phoneFingerprint).not.toBe(r.phoneFingerprint);
   expect(r.recognizesPhoneSend).toBe(true);
  });
 }
});

it.each(['project_manager','executive'] as const)('B63 %s genuine current photo description invalidates',async format=>{
 const base=rowsFor();const make=(caption:string)=>({...base,projectUpdates:rowsOf(onThePhone({updates:[update({id:'photo-update',date:isoAt(-1),notes:'Canopy inspected',scheduleItemId:'legacy-task',scheduleTaskName:'Install canopy',selectedAreaName:'Canopy',photos:[{id:'synthetic-photo',uri:'file:///synthetic/canopy.png',caption,category:'Progress',fileName:'canopy.png',mimeType:'image/png',cloudStoragePath:'synthetic/canopy.png'}]})]})).projectUpdates});
 const before=await observe(make('Bolts inspected'),format),after=await observe(make('Bolts require adjustment'),format);
 expect(after.phoneFingerprint).not.toBe(before.phoneFingerprint);
 expect(after.desktopFingerprint).not.toBe(before.desktopFingerprint);
});
