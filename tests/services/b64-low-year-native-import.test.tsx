/** B64 original4.13: actual App file-import/approval functions, real native normalizer and persistence hook. Synthetic data only. */
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
import { scheduleImportAddsToMaster } from '../../services/ScheduleLookahead';
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
function approval(active: readonly string[]) {
  const scheduleItemsCurrentRef = { current: [] as ScheduleItem[] };
  const referenceDocumentsCurrentRef = { current: [] as ReferenceDocument[] };
  const cloudSync = jest.fn(async (_input: { scheduleItems: ScheduleItem[]; referenceDocuments: ReferenceDocument[] }) => ({
    durablyQueued: true, fullySynced: true, supersededScheduleItemIds: [], supersededReferenceDocumentIds: [], uploadedReferenceDocuments: [],
  }));
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
  return { approveScheduleImport, cloudSync, scheduleItemsCurrentRef, referenceDocumentsCurrentRef };
}


import {normalizeScheduleItem as nativeNormalizeScheduleItem} from '../../App';
import {useJsonStoragePersistence,flushPendingStoragePersistence} from '../../hooks/use-async-storage-persistence';
import AsyncStorage from '@react-native-async-storage/async-storage';

function Persist({items}:{items:ScheduleItem[]}){useJsonStoragePersistence({enabled:true,storageKey:'projectPhotoUpdate.scheduleItems.v1',value:items,debounceMs:0});return null;}
const LOW=['0100','0202','0999'] as const;
it.each(LOW)('actual native file pick, review approval, App normalization and durable reload keep %s',async year=>{
 const picked=csv([['Install canopy',QUAY,`5/1/${year}`,`5/4/${year}`]],`year-${year}.csv`);const h=phone(picked,[QUAY]);const batch=await h.importScheduleFile();expect(batch).not.toBeNull();console.log('B64_PICK '+JSON.stringify({year,rows:batch!.items.map(i=>[i.startDate,i.finishDate])}));const saved=approval([QUAY]);
 const view=render(<ScheduleImportFlow screenshotImportAvailable={false} onImportFile={jest.fn(async()=>batch)} onImportScreenshots={jest.fn(async()=>null)} onAddManually={jest.fn()} onApprove={saved.approveScheduleImport} onCancel={jest.fn()} incomingBatch={batch} onIncomingBatchConsumed={jest.fn()}/>);
 await view.findByText('Review Imported Schedule');expect(view.getAllByText(new RegExp(`Check this date:.*05/0[14]/${year}.*outside 2000 to 2100`)).length).toBeGreaterThanOrEqual(2);fireEvent.press(view.getByText('Review or edit'));fireEvent.changeText(view.getByPlaceholderText('Task'),'Install canopy checked');const accept=view.queryByText(/^Accept All/)??view.queryByText(/^Accept \d+ Selected/);expect(accept).not.toBeNull();
 await act(async()=>{fireEvent.press(accept!);await settled();});
 const approved=saved.scheduleItemsCurrentRef.current;expect(approved.map(i=>i.taskName)).toEqual(['Install canopy checked']);console.log('B64_NATIVE_APPROVAL '+JSON.stringify({year,imported:batch!.items.map(i=>[i.startDate,i.finishDate]),approved:approved.map(i=>[i.startDate,i.finishDate]),queued:saved.cloudSync.mock.calls[0]?.[0].scheduleItems.map(i=>[i.startDate,i.finishDate])}));
 view.unmount();const store=render(<Persist items={approved}/>);await act(async()=>{await flushPendingStoragePersistence();});
 const raw=await AsyncStorage.getItem('projectPhotoUpdate.scheduleItems.v1');expect(raw).not.toBeNull();const reloaded=JSON.parse(raw!).map((t:ScheduleItem)=>nativeNormalizeScheduleItem(t));store.unmount();
 expect(batch!.items.map(i=>[i.startDate,i.finishDate])).toEqual([[`05/01/${year}`,`05/04/${year}`]]);expect(reloaded.map((i:ScheduleItem)=>[i.startDate,i.finishDate])).toEqual([[`05/01/${year}`,`05/04/${year}`]]);
});
it.each([...LOW,'2000','2100','2026'])('actual ISO CSV and MS Project file routes preserve %s',year=>{
 const iso=normalizeScheduleImport({contents:`Task,Project,Area,Start,Finish,Owner\nCanopy,${QUAY},Lot,${year}-05-01,${year}-05-04,Dana`,sourceName:'iso.csv',mimeType:'text/csv',now:new Date('2026-10-17T12:00:00Z')});
 const ms=normalizeMicrosoftProjectPdfRows({contents:['ID\tTask Name\tIndent\tDuration\tStart\tFinish\tPercent Complete\tWBS',`1\t${QUAY.toUpperCase()}\t0\t3 days\tMon 5/1/${year}\tThu 5/4/${year}\t0%\t1`,`2\tINSTALL CANOPY\t1\t3 days\tMon 5/1/${year}\tThu 5/4/${year}\t0%\t1.1`].join('\n'),sourceName:'schedule.pdf',now:new Date('2026-10-17T12:00:00Z')});
 console.log('B64_IMPORT '+JSON.stringify({year,iso:iso.items.map(i=>[i.startDate,i.finishDate]),ms:ms.map(i=>[i.startDate,i.finishDate])}));
 expect(iso.items.map(i=>[i.startDate,i.finishDate])).toEqual([[`05/01/${year}`,`05/04/${year}`]]);expect(ms.map(i=>[i.startDate,i.finishDate])).toEqual([[`05/01/${year}`,`05/04/${year}`]]);
});

it('existing two-digit import behavior and arbitrary three-digit date strings keep their reader policy',()=>{
 const result=normalizeScheduleImport({contents:`Task,Project,Area,Start,Finish,Owner\nCanopy,${QUAY},Lot,5/1/26,5/4/26,Dana`,sourceName:'two-digit.csv',mimeType:'text/csv',now:new Date('2026-10-17T12:00:00Z')});
 expect(result.items.map(i=>[i.startDate,i.finishDate])).toEqual([['05/01/2026','05/04/2026']]);
 expect(nativeNormalizeScheduleItem({id:'old-three',taskName:'Old date',projectName:QUAY,startDate:'05/01/202',finishDate:'05/04/202'}).startDate).toBe('05/01/202');
});
