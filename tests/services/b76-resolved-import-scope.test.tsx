/** B76 desired RED contracts for4.63/4.64/4.65. Actual App import functions and actual ScheduleImportFlow; synthetic local boundaries only. Runtime is unchanged in this commit. */
/**
 * Build 232 round, item 10 (13 Oct 2026), AS ITEM 10c LEFT IT. Item 10 made
 * the review's "Full schedule or Lookahead" suggestion read the file's own
 * rows' projects in place of the file's label (every project the import
 * could have used: from the Tasks tab every active project, on the desktop
 * every project ticked), and item 10b part 1 narrowed that to the rows of
 * the projects the file is being saved for. Review pass 6 (findings R-1 and
 * R-2) found two files which that change filled in as "Full schedule" where
 * the previous build filled in Lookahead, and a wrong Full schedule made
 * current hides tasks, where a wrong Lookahead costs one tap. The
 * coordinator's decision: the change is taken back out, and
 * suggestScheduleImportRole (services/ScheduleLookahead.ts) is Build 231's
 * again, word for word.
 *
 * B76 TEST-ONLY CONTRACT UPDATE: original4.64/4.65 assertions below now demand resolved-file-scope duplicate/current-copy protection. The historical bug assertions are preserved in parent9403823 and the B76 packet; positive same-scope, root/building and role controls are retained. No product code changes in this RED commit.
 *
 * WHAT THIS FILE WAS BEFORE B76: the 11 of item 10's 23 tests that hold on Build
 * 231's function, kept as guards on what Build 231 does. The 12 that
 * asserted the removed behaviour are gone (they are whole in the commits
 * that added them). Open item 4.58 (a new project's first full schedule can
 * be suggested as a Lookahead when another active project has a long master)
 * is open again exactly as on Build 231: the test that states it, and the
 * tests for R-1 and R-2, are in
 * b232-10c-schedule-suggestion-is-the-previous-builds-again.test.tsx. This
 * file keeps its name so that the notes of items 10 and 10b still find it.
 *
 * The phone's road is App.tsx's own importScheduleFile and
 * prepareScheduleImportFromAsset, compiled from App.tsx with the real
 * services, into the real review (ScheduleImportFlow). Synthetic data only.
 */
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

import { createDAVEWebSupabaseGateway } from '../../services/DAVEWebSupabaseClient';
import { ScheduleImportFlow } from '../../components/ScheduleImportFlow';
import { deletedDAVERecordIds } from '../../services/DAVESyncTombstones';
import { daveWebScheduleUploadRoleSuggestion, prepareDAVEWebDocumentUpload, withDAVEWebScheduleUploadRole } from '../../services/DAVEWebOperations';
import { dedupeScheduleImportItems, type PIEScheduleImportBatch } from '../../services/PIEScheduleImportBatch';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { normalizeReferenceDocument } from '../../services/ReferenceDocumentRepository';
import { scheduleDocumentsAfterApproval } from '../../services/ScheduleDocumentLabels';
import { validateScheduleImportScope } from '../../services/ScheduleImportScopeGuard';
import { bindStableScheduleImportItemIds } from '../../services/ScheduleImportSourceIdentity';
import {
  scheduleImportRoleRefusal,
  suggestScheduleImportRole,
  withScheduleImportRole,
  type ScheduleImportRole,
} from '../../services/ScheduleLookahead';
import { scheduleImportOfFile } from '../../services/SharedDocumentActivation';
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

const P2321 = '2321 Compliance Project';
const P2375 = '2375 Compliance Project';
const TEST = 'Test project';
const ACTIVE = [P2321, P2375, TEST];

type Saved = Readonly<{ documents: ReferenceDocument[]; items: ScheduleItem[] }>;
type Picked = Readonly<{ name: string; contents: string }>;

const savedDocument = (id: string, projectNames: string[], importedAt: string, extra: Partial<ReferenceDocument> = {}) =>
  normalizeReferenceDocument({
    id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
    projectId: null, projectName: projectNames.length === 1 ? projectNames[0] : null, projectNames, importBatchId: `batch-${id}`,
    ...extra,
  });
const savedRow = (id: string, projectName: string, startDate: string, finishDate: string, batchId: string) => ({
  id, taskName: `Task ${id}`, projectName, locationName: 'Site', startDate, finishDate, milestone: '', owner: 'David',
  contractor: '', percentComplete: 0, priority: 'Medium', status: 'Not Started', notes: '',
  createdAt: '2026-03-01T12:00:00.000Z', importBatchId: batchId,
}) as ScheduleItem;

// 2321's master, 2 Mar 2026 to 1 Jul 2027 ("about 16 months"); 2375's, 1 Jun to 30 Oct 2026 ("about 5 months").
const master2321 = savedDocument('master-2321', [P2321], '2026-03-01T12:00:00.000Z');
const master2375 = savedDocument('master-2375', [P2375], '2026-05-30T12:00:00.000Z');
const ACCOUNT: Saved = {
  documents: [master2321, master2375],
  items: [
    savedRow('a1', P2321, '03/02/2026', '03/20/2026', 'batch-master-2321'),
    savedRow('a2', P2321, '06/01/2027', '07/01/2027', 'batch-master-2321'),
    savedRow('b1', P2375, '06/01/2026', '06/12/2026', 'batch-master-2375'),
    savedRow('b2', P2375, '10/19/2026', '10/30/2026', 'batch-master-2375'),
  ],
};

/** A schedule file as picked: one row per [task, project, start, finish]; no Project column when no row has one. */
function csv(name: string, rows: ReadonlyArray<readonly [string, string | null, string, string]>): Picked {
  const withProject = rows.some(row => row[1] !== null);
  return {
    name,
    contents: [
      withProject ? 'Task,Project,Start,Finish,Owner,Status' : 'Task,Start,Finish,Owner,Status',
      ...rows.map(([task, project, start, finish]) =>
        [task, ...(withProject ? [project || ''] : []), start, finish, 'David', 'Not Started'].join(',')),
    ].join('\n') + '\n',
  };
}

const threeWeeks = (project: string | null, name = 'Schedule A.csv') => csv(name, [
  ['Pour footings', project, '10/26/2026', '10/30/2026'],
  ['Set steel', project, '11/02/2026', '11/06/2026'],
  ['Deck and detail', project, '11/09/2026', '11/13/2026'],
]);

/** The phone with these saved schedules and tasks; App.tsx's own two functions of the Tasks tab's file import. */
function phone(saved: Saved, picked: Picked, active: readonly string[] = ACTIVE) {
  const alerts: Array<{ title: string; message: string }> = [];
  const bytes = utf8ToBytes(picked.contents);
  const deps: Record<string, unknown> = {
    screen: 'Schedule',
    activeProjects: [...active], projects: [...active],
    archivedProjectsCurrentRef: { current: [] }, deletedProjectNamesRef: { current: [] },
    projectsCurrentRef: { current: [...active] }, projectRecordsCurrentRef: { current: [] },
    authorityProjectId: (name: string) => `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-key`,
    projectAreasForProject: () => [], projectAreasCurrentRef: { current: [] }, savedUpdatesRef: { current: [] },
    referenceDocumentsCurrentRef: { current: saved.documents }, scheduleItemsCurrentRef: { current: saved.items },
    prepareExpoFileUploadPayload: async () => ({ data: bytes, sizeBytes: bytes.length }),
    scheduleImportOfFile, deletedDAVERecordIds, operationalSyncTombstonesRef: { current: [] },
    ensureReferenceDocumentsDirectory: async () => 'file:///reference-documents/',
    sanitizeFilename: (name: string) => name,
    FileSystem: { deleteAsync: async () => undefined, copyAsync: async () => undefined, readAsStringAsync: async () => picked.contents },
    normalizeReferenceDocument, normalizeScheduleImport, dedupeScheduleImportItems, bindStableScheduleImportItemIds,
    validateScheduleImportScope,
    deleteStoredReferenceDocument: async () => undefined,
    DocumentPicker: {
      getDocumentAsync: async () => ({
        canceled: false,
        assets: [{ uri: `file:///picked/${picked.name}`, name: picked.name, mimeType: 'text/csv', size: bytes.length }],
      }),
    },
    preflightExpoFileRead: async () => undefined,
    Alert: { alert: (title: string, message: string) => { alerts.push({ title, message }); } },
  };
  const fns = compile<{
    prepareScheduleImportFromAsset: (file: { uri: string; name?: string; mimeType?: string; size?: number }, projects?: string[]) =>
      Promise<PIEScheduleImportBatch | null>;
    importScheduleFile: (onProcessingStart?: () => void) => Promise<PIEScheduleImportBatch | null>;
  }>(['prepareScheduleImportFromAsset', 'importScheduleFile'], deps);
  return { ...fns, alerts, file: { uri: `file:///picked/${picked.name}`, name: picked.name, mimeType: 'text/csv', size: bytes.length } };
}

/** Every promise of the pick and of the save, however many, has run. */
async function settled() {
  for (let turn = 0; turn < 5; turn += 1) await new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Tasks tab > Add Schedule or Task > Schedule File > this file, with these schedules saved: the batch App.tsx
 * builds, the review's sentence under the choice, and the role Accept All saves (null where Accept All is not offered).
 */
async function fromTheTasksTab(saved: Saved, picked: Picked, active: readonly string[] = ACTIVE) {
  const h = phone(saved, picked, active);
  const got: { batch: PIEScheduleImportBatch | null } = { batch: null };
  const onApprove = jest.fn(async (_approved: PIEScheduleImportBatch) => undefined);
  const view = render(
    <ScheduleImportFlow
      screenshotImportAvailable={false}
      onImportFile={async onProcessingStart => (got.batch = await h.importScheduleFile(onProcessingStart))}
      onImportScreenshots={jest.fn(async () => null)}
      onAddManually={jest.fn()}
      onApprove={onApprove}
      onCancel={jest.fn()}
      roleContext={{ documents: saved.documents, items: saved.items }}
    />,
  );
  fireEvent.press(view.getByText('Add Schedule or Task'));
  fireEvent.press(view.getByText('Schedule File'));
  await act(async () => {
    view.UNSAFE_getAllByType(Modal)[0].props.onDismiss();
    await settled();
  });
  const sentence = String(view.getByText(/^Suggested: /).props.children);
  const acceptAll = view.queryByText(/^Accept All \(\d+\)$/);
  if (acceptAll) {
    await act(async () => {
      fireEvent.press(acceptAll);
      await settled();
    });
  }
  const savedAs = (onApprove.mock.calls[0]?.[0].documents[0]?.scheduleRole ?? null) as ScheduleImportRole | null;
  view.unmount();
  expect(h.alerts).toEqual([]);
  if (!got.batch) throw new Error('the pick returned no batch');
  return { batch: got.batch, sentence, savedAs };
}

/** What the phone has saved once this import is accepted as that role (the approval's own labelling). */
function afterApproval(saved: Saved, batch: PIEScheduleImportBatch, role: ScheduleImportRole): Saved {
  const approved = withScheduleImportRole(batch, role);
  return {
    documents: scheduleDocumentsAfterApproval({
      documents: saved.documents, approvedDocuments: approved.documents, approvedItems: approved.items, updatedAt: '2026-10-13T18:00:00.000Z',
    }),
    items: [...saved.items, ...approved.items],
  };
}

const LOOKAHEAD = 'Suggested: Lookahead / partial (adds to the master), because';
const CHANGE = 'You can change this before saving.';


const MASTER = 'Full schedule (replaces)';
const LOOK = 'Lookahead / partial (adds to the master)';
function batchFor(project: string|null = null) {
  const picked = threeWeeks(project);
  return phone(ACCOUNT,picked).importScheduleFile();
}
async function openBatch(batch: PIEScheduleImportBatch, saved: Saved=ACCOUNT) {
  const onApprove = jest.fn(async (_batch: PIEScheduleImportBatch) => undefined);
  const props = {screenshotImportAvailable:false,onImportFile:jest.fn(async()=>null),onImportScreenshots:jest.fn(async()=>null),onAddManually:jest.fn(),onApprove,onCancel:jest.fn(),roleContext:{documents:saved.documents,items:saved.items}};
  const view=render(<ScheduleImportFlow {...props} incomingBatch={batch}/>);
  await act(settled);
  return {view,props,onApprove};
}
function fillProjects(view: ReturnType<typeof render>, name: string) {
  // ReviewInput is the real row input, not a synthetic project resolver.
  for(const edit of view.queryAllByText('Review or edit'))fireEvent.press(edit);
  const inputs=view.UNSAFE_getAllByType(require('react-native').TextInput);
  const projects=inputs.filter(node=>node.props.value==='Needs Project');
  expect(projects.length).toBeGreaterThan(0);
  for(const node of projects)fireEvent.changeText(node,name);
}
const suggestion=(view:ReturnType<typeof render>)=>String(view.getByText(/^Suggested: /).props.children);

it('B76 4.63: assigning every unresolved row recomputes the automatic role using its project alone',async()=>{
 const batch=await batchFor();expect(batch).toBeTruthy();const frozen=JSON.stringify(batch);
 const {view,onApprove}=await openBatch(batch!);
 expect(suggestion(view)).toContain(LOOK); // inherited provisional choice, no silent full-schedule assumption
 fillProjects(view,TEST);await act(settled);
 expect(suggestion(view)).toContain(MASTER);
 expect(suggestion(view)).not.toContain(P2321);
 await act(async()=>{fireEvent.press(view.getByText(/^Accept All \(3\)$/));await settled();});
 expect(onApprove).toHaveBeenCalledTimes(1);const approved=onApprove.mock.calls[0][0];
 expect(approved.documents[0].scheduleRole).toBe('master');
 expect(approved.items.map(i=>i.projectName)).toEqual([TEST,TEST,TEST]);
 expect(approved.items.map(i=>i.id)).toEqual(batch!.items.map(i=>i.id));
 expect(approved.documents[0].id).toBe(batch!.documents[0].id);
 expect(approved.documents[0].contentSha256).toBe(batch!.documents[0].contentSha256);
 expect(JSON.stringify(batch)).toBe(frozen);view.unmount();
});
it('B76 4.63 control: an explicit Lookahead choice survives automatic suggestion recomputation',async()=>{
 const batch=await batchFor();const {view,onApprove}=await openBatch(batch!);
 fireEvent.press(view.getByText(LOOK));fillProjects(view,TEST);await act(settled);
 expect(suggestion(view)).toContain(MASTER);
 await act(async()=>{fireEvent.press(view.getByText(/^Accept All \(3\)$/));await settled();});
 expect(onApprove.mock.calls[0][0].documents[0].scheduleRole).toBe('lookahead');view.unmount();
});
it('B76 4.63 control: resolved rows for the long-master project keep a genuine Lookahead and exact source IDs',async()=>{
 const batch=await batchFor();const {view,onApprove}=await openBatch(batch!);
 fillProjects(view,P2321);await act(settled);expect(suggestion(view)).toContain(LOOK);
 await act(async()=>{fireEvent.press(view.getByText(/^Accept All \(3\)$/));await settled();});
 expect(onApprove.mock.calls[0][0].documents[0].scheduleRole).toBe('lookahead');
 expect(onApprove.mock.calls[0][0].items.map(i=>i.id)).toEqual(batch!.items.map(i=>i.id));view.unmount();
});
it('B76 4.65: a saved copy made current while the real review is open prevents approval under a wider label',async()=>{
 const picked=threeWeeks(TEST),batch=await phone(ACCOUNT,picked).importScheduleFile();expect(batch).toBeTruthy();
 const copy=savedDocument('saved-own-scope',[TEST],'2026-10-01T12:00:00.000Z',{contentSha256:batch!.documents[0].contentSha256,isCurrent:false});
 const newer=savedDocument('newer-own-scope',[TEST],'2026-10-14T12:00:00.000Z');
 const preset=withScheduleImportRole(batch!,'lookahead');
 const initial={documents:[...ACCOUNT.documents,copy,newer],items:ACCOUNT.items};const {view,props,onApprove}=await openBatch(preset,initial);
 const changed={documents:[...ACCOUNT.documents,{...copy,isCurrent:true},{...newer,isCurrent:false}],items:ACCOUNT.items};
 view.rerender(<ScheduleImportFlow {...props} incomingBatch={preset} roleContext={{documents:changed.documents,items:changed.items}}/>);await act(settled);
 await act(async()=>{fireEvent.press(view.getByText(/^Accept All \(3\)$/));await settled();});
 expect(onApprove).not.toHaveBeenCalled();expect(view.getByText(/This exact schedule is the full schedule shown now/)).toBeTruthy();view.unmount();
});
it('B76 intentional different-project import control: same projectless bytes remain importable into a different explicitly selected project',async()=>{
 const picked=threeWeeks(null);const a=phone(ACCOUNT,picked),one=await a.prepareScheduleImportFromAsset(a.file,[TEST]);expect(one).toBeTruthy();
 const saved=afterApproval(ACCOUNT,one!,'master');const b=phone(saved,picked,[P2375]),other=await b.prepareScheduleImportFromAsset(b.file,[P2375]);
 expect(other).toBeTruthy();expect(b.alerts).toEqual([]);expect(other!.documents[0].id).not.toBe(one!.documents[0].id);
 expect(other!.documents[0].contentSha256).toBe(one!.documents[0].contentSha256);
 expect(other!.items.every(i=>i.projectName===P2375)).toBe(true);
});

it('B76 gateway control: reviewed source identity and narrowed project metadata reach the actual document_data insertion unchanged',async()=>{
 const picked=threeWeeks(P2321),batch=await phone(ACCOUNT,picked,[P2321]).importScheduleFile();expect(batch).toBeTruthy();
 const approved=withScheduleImportRole(batch!,'lookahead'),saved=afterApproval({documents:[],items:[]},approved,'lookahead'),document=saved.documents[0];
 const frozen=JSON.stringify({approved,document}),insert=jest.fn(async(_row:unknown)=>({data:null,error:null})),upload=jest.fn(async()=>({data:{path:'synthetic'},error:null})),rpc=jest.fn(async(name:string)=>({data:name==='dave_is_app_owner'?true:null,error:null,status:200}));
 const client={auth:{getUser:jest.fn(async()=>({data:{user:{id:'b76-owner'}},error:null}))},rpc,from:jest.fn((table:string)=>{if(table!=='reference_documents')throw Error('Unexpected synthetic table '+table);return{insert};}),storage:{from:jest.fn(()=>({upload,remove:jest.fn(async()=>({data:[],error:null}))}))}};
 const gateway=createDAVEWebSupabaseGateway(client as never);
 await gateway.uploadAuthorizedReferenceDocument({document,bytes:utf8ToBytes(picked.contents).buffer as ArrayBuffer});
 expect(insert).toHaveBeenCalledTimes(1);const row=insert.mock.calls[0][0]as any;
 expect(row).toMatchObject({id:batch!.documents[0].id,owner_id:'b76-owner',category:'Schedules',document_data:{id:batch!.documents[0].id,projectName:P2321,projectNames:[P2321],importBatchId:batch!.documents[0].importBatchId,contentSha256:batch!.documents[0].contentSha256,scheduleRole:'lookahead'}});
 expect(row.document_data.storagePath).toContain(batch!.documents[0].id);
 expect(JSON.stringify({approved,document})).toBe(frozen);
});
