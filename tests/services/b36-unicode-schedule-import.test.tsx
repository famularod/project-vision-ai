/** 2.51 synthetic real App import/review/approval and desktop preparation regression. Existing n236 harness reused; original fixture unchanged. */
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined) },
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => `uuid-${Math.random().toString(16).slice(2)}` }));
jest.mock('@expo/vector-icons/Ionicons', () => () => null);
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import { act, fireEvent, render } from '@testing-library/react-native';
import { utf8ToBytes } from '@noble/hashes/utils';
import { Modal } from 'react-native';

import { ScheduleImportFlow } from '../../components/ScheduleImportFlow';
import { findExactScheduleTaskForCompletionClaim, mergeReportedCompletionClaim } from '../../services/DAVECompletionVerification';
import { reconcileDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';
import { deletedDAVERecordIds } from '../../services/DAVESyncTombstones';
import { bindPIEScheduleImportBatchProvenance, dedupeScheduleImportItems, type PIEScheduleImportBatch } from '../../services/PIEScheduleImportBatch';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
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
    normalizeScheduleItem: (item: unknown) => item, identityCorrections: [], daveRegisteredIdentityNames: () => [],
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

/**
 * Tasks > Add Schedule or Task > Schedule File > this file, every project active: the review he sees; then he gives
 * each task the project named (by typing it in the task's Project box, in the order the cards show) and presses
 * Accept All; the phone saves it. What the review showed, what was saved, and what was sent to the cloud.
 */
async function fromTheTasksTab(picked: Picked, give: readonly string[]) {
  const h = phone(picked, ALL);
  const saved = approval(ALL);
  const got: { batch: PIEScheduleImportBatch | null } = { batch: null };
  const onApprove = jest.fn(async (approved: PIEScheduleImportBatch) => saved.approveScheduleImport(approved));
  const view = render(
    <ScheduleImportFlow
      screenshotImportAvailable={false}
      onImportFile={async onProcessingStart => (got.batch = await h.importScheduleFile(onProcessingStart))}
      onImportScreenshots={jest.fn(async () => null)}
      onAddManually={jest.fn()}
      onApprove={onApprove}
      onCancel={jest.fn()}
      roleContext={{ documents: [], items: [] }}
    />,
  );
  fireEvent.press(view.getByText('Add Schedule or Task'));
  fireEvent.press(view.getByText('Schedule File'));
  await act(async () => {
    view.UNSAFE_getAllByType(Modal)[0].props.onDismiss();
    await settled();
  });
  const cards = view.queryAllByText(/^Activity \d+$/).length;
  const subtitle = String(view.getByText(/sources? • \d+ ready • \d+ need review$/).props.children);
  // He opens every task ("Review or edit") and types its project.
  for (let guard = 0; guard < 10 && view.queryAllByText('Review or edit').length > 0; guard += 1) {
    fireEvent.press(view.queryAllByText('Review or edit')[0]);
  }
  view.getAllByPlaceholderText('Project').forEach((input, index) => {
    if (give[index]) fireEvent.changeText(input, give[index]);
  });
  const acceptAll = view.queryByText(/^Accept All \(\d+\)$/);
  const acceptLabel = acceptAll ? String(acceptAll.props.children) : null;
  if (acceptAll) {
    await act(async () => {
      fireEvent.press(acceptAll);
      await settled();
    });
  }
  view.unmount();
  expect(h.alerts).toEqual([]);
  if (!got.batch) throw new Error('the pick returned no batch');
  const shownBy = (documents: readonly ReferenceDocument[]) => {
    const shown = selectAuthoritativeScheduleItems({ scheduleItems: saved.scheduleItemsCurrentRef.current, scheduleDocuments: [...documents] }) as ScheduleItem[];
    return ALL.map(project => `${project}: ${shown.filter(item => item.projectName === project).map(item => item.taskName).sort().join(', ') || '-'}`);
  };
  const documents = saved.referenceDocumentsCurrentRef.current;
  return {
    batch: got.batch, cards, subtitle, acceptLabel,
    approvedRows: onApprove.mock.calls[0]?.[0].items.map(item => `${item.taskName} [${item.projectName}]`) ?? null,
    savedRows: saved.scheduleItemsCurrentRef.current.map(item => `${item.taskName} [${item.projectName}]`).sort(),
    shownByProject: shownBy(documents),
    // Make Current on the saved schedule, under either of the cloud's rules.
    shownAfterMakeCurrent: (['project', 'schedule'] as const).map(scope => shownBy(documents.length ? scheduleDocumentsAfterActivation(documents[0], documents, scope, '2026-10-14T12:00:00.000Z') : [])),
    sentToCloud: saved.cloudSync.mock.calls[0]?.[0].scheduleItems ?? [],
  };
}


import {prepareDAVEWebDocumentUpload,planDAVEWebScheduleImport,daveWebScheduleUploadProjectReview} from '../../services/DAVEWebOperations';
const UNICODE_ROWS: readonly Row[]=[['Safety walk','Северный','10/26/2026','10/30/2026'],['Safety walk','Южный','10/26/2026','10/30/2026']];
const unicodeFile=()=>csv(UNICODE_ROWS,'План работ.csv');
const web=(picked:Picked,projectNames:readonly string[]=[QUAY,MILL],openProjectNames:readonly string[]=projectNames)=>prepareDAVEWebDocumentUpload({fileName:picked.name,mimeType:picked.mimeType,sizeBytes:utf8ToBytes(picked.contents).length,category:'Schedules',fingerprint:'a'.repeat(64),projectNames,openProjectNames,projects:[...openProjectNames],readableContents:picked.contents,now:'2026-10-17T12:00:00Z'} as never);
it('2.51 real native Tasks CSV review explicitly maps both unknown Unicode jobs, saves/lists/clouds both',async()=>{
 const run=await fromTheTasksTab(unicodeFile(),[QUAY,MILL]);expect(run.cards).toBe(2);expect(run.subtitle).toBe('1 source • 0 ready • 2 need review');expect(run.batch.items.map(i=>i.projectName)).toEqual([NEEDS,NEEDS]);expect(run.batch.items.map(i=>run.batch.fileProjectNames?.[i.id])).toEqual(['Северный','Южный']);expect(new Set(run.batch.items.map(i=>i.id)).size).toBe(2);expect(run.savedRows).toEqual([`Safety walk [${QUAY}]`,`Safety walk [${MILL}]`]);expect(run.sentToCloud.map(i=>i.id).sort()).toEqual(run.batch.items.map(i=>i.id).sort());expect(run.shownByProject).toEqual([`${QUAY}: Safety walk`,`${MILL}: Safety walk`,`${SHED}: -`]);expect(run.shownAfterMakeCurrent).toEqual([run.shownByProject,run.shownByProject]);expect(run.batch.sourceLabel).toBe('План работ.csv');
});
it('2.51 native Documents/card share preparation and PDF local/service keep both original names and stable IDs',async()=>{
 for(const ticked of [[QUAY,MILL],[QUAY]]){const batch=await fromDocuments(unicodeFile(),ticked);expect(batch.items).toHaveLength(2);expect(batch.items.map(i=>batch.fileProjectNames?.[i.id])).toEqual(['Северный','Южный']);}
 const pdf:Picked={name:'План работ.pdf',mimeType:'application/pdf',contents:'%PDF-1.7 synthetic only'};const text=['Combined weekly plan','Prepared by the field office for two jobs','Safety walks listed with finish dates',unicodeFile().contents].join('\n');const rows=normalizeScheduleImport({contents:unicodeFile().contents,sourceName:unicodeFile().name,mimeType:'text/csv',projects:[QUAY,MILL],projectAreas:[]}).items;
 for(const override of [{isDavePdfTextExtractionAvailable:()=>true,withScheduleImportTimeout:(p:Promise<unknown>)=>p,extractTextFromPdf:async()=>({format:'plain_text',text})},{isDavePdfTextExtractionAvailable:()=>false,extractSchedulePdfWithServer:async()=>({items:rows,warnings:[]})}]){const batch=await fromDocuments(pdf,[QUAY,MILL],override);expect(batch.items).toHaveLength(2);expect(batch.items.map(i=>batch.fileProjectNames?.[i.id])).toEqual(['Северный','Южный']);expect(batch.sourceLabel).toBe(pdf.name);}
});
it('2.51 native retry preserves already-established Unicode ID protocol and exact map bindings',async()=>{const picked=unicodeFile();const before=JSON.stringify(picked);const expected=await fromDocuments(picked,[QUAY,MILL],{dedupeScheduleImportItems:(items:ScheduleItem[])=>items});const actual=await fromDocuments(picked,[QUAY,MILL]);const retry=await fromDocuments(picked,[QUAY,MILL]);expect(actual.items.map(i=>i.id)).toEqual(expected.items.map(i=>i.id));expect(retry.items.map(i=>i.id)).toEqual(actual.items.map(i=>i.id));expect(actual.fileProjectNames).toEqual(expected.fileProjectNames);expect(JSON.stringify(picked)).toBe(before);});
it('2.51 desktop real CSV import holds both jobs until explicit mapping; actual save plan keeps both',()=>{const picked=unicodeFile();const before=JSON.stringify(picked);const prepared=web(picked);expect(prepared.scheduleItems).toHaveLength(2);expect(prepared.scheduleItems.map(i=>i.projectName)).toEqual([NEEDS,NEEDS]);expect(prepared.scheduleItems.map(i=>prepared.fileProjectNames?.[i.id])).toEqual(['Северный','Южный']);expect(daveWebScheduleUploadProjectReview(prepared).heldLine).toContain('2 tasks need a project');expect(daveWebScheduleUploadProjectReview(prepared).useForAll).toBeNull();const snapshot={scheduleItems:[],knownScheduleItems:[],referenceDocuments:[]} as never;expect(()=>planDAVEWebScheduleImport({snapshot,importedScheduleItems:prepared.scheduleItems,document:prepared.document})).toThrow(/Every task needs one of your projects/);const reviewed=prepared.scheduleItems.map((i,n)=>({...i,projectName:[QUAY,MILL][n],scheduleProjectName:[QUAY,MILL][n]}));const plan=planDAVEWebScheduleImport({snapshot,importedScheduleItems:reviewed,document:prepared.document});expect(plan.additions.map(i=>i.projectName)).toEqual([QUAY,MILL]);expect(new Set(plan.additions.map(i=>i.id)).size).toBe(2);expect(plan.additions.map(i=>i.id)).toEqual(prepared.scheduleItems.map(i=>i.id));expect(JSON.stringify(picked)).toBe(before);});
it('2.51 desktop unknown name cannot become an unrelated known non-ASCII project through empty ASCII keys',()=>{const prepared=web(unicodeFile(),['東京'],['東京']);expect(prepared.scheduleItems).toHaveLength(2);expect(prepared.scheduleItems.map(i=>i.projectName)).toEqual([NEEDS,NEEDS]);expect(prepared.scheduleItems.map(i=>prepared.fileProjectNames?.[i.id])).toEqual(['Северный','Южный']);expect(daveWebScheduleUploadProjectReview(prepared).heldLine).toContain('2 tasks need a project');});
it.each([['same Unicode name/case',['Северный','СЕВЕРНЫЙ'],1],['distinct Unicode punctuation',['北苑','北-苑'],2],['distinct compatibility spelling',['豈','豈'],2],['ASCII punctuation aliases',['Shed Annex','Shed-Annex'],1],['different numeric names',['6101','6102'],2]] as const)('2.51 %s preserves conservative unknown-name comparison on native and desktop',async(_label,names,count)=>{const picked=csv(names.map(name=>['Safety walk',name,'10/26/2026','10/30/2026'] as const));const batch=await fromDocuments(picked,[QUAY,MILL]);const prepared=web(picked);expect(batch.items).toHaveLength(count);expect(prepared.scheduleItems).toHaveLength(count);expect(batch.items.every(i=>i.projectName===NEEDS)).toBe(true);expect(prepared.scheduleItems.every(i=>i.projectName===NEEDS)).toBe(true);expect(new Set(batch.items.map(i=>i.id)).size).toBe(count);});
