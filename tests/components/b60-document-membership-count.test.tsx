import { act, fireEvent, render } from '@testing-library/react-native';

import { DesktopReadOnlyShell } from '../../components/web-shell/desktop-read-only-shell';
import type {
  DAVEWebReadOnlySnapshot,
  DAVEWebReferenceDocument,
} from '../../services/DAVEWebReadOnlyRepository';

// Open item 2.34 (review pass 6, O-8; 13 Oct 2026), on the page itself: Documents, an older schedule file, Edit
// Project Document Details. Its Category was offered for change, and filed as a Report its tasks were listed again
// on every device (each one a newer schedule moved, twice). The form now shows the Category as it is, says why it
// stays, and saves the rest as before; a document that is not a schedule with tasks keeps every category choice.
// Made-up projects; the shell harness of desktop-lookahead-document.test.tsx.

jest.mock('../../services/DAVEWebSupabaseClient',()=>{const actual=jest.requireActual('../../services/DAVEWebSupabaseClient');return {...actual,daveWebSupabaseGateway:{...actual.daveWebSupabaseGateway,loadAuthorizedRows:jest.fn()}};});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));
jest.mock('expo-linear-gradient', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    LinearGradient: ({ children }: { children: React.ReactNode }) => (
      React.createElement(View, null, children)
    ),
  };
});
let mockProjectScope:string|null=null;
jest.mock('expo-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
  useLocalSearchParams: () => mockProjectScope ? {project:mockProjectScope} : {},
  usePathname: () => '/documents',
  useRouter: () => ({ setParams: jest.fn() }),
}));
jest.mock('../../services/VitruviusDesktopPreferences', () => ({
  VITRUVIUS_DESKTOP_DISPLAY_NAME_KEY: 'vitruvius.display-name',
  formatVitruviusDesktopGreeting: () => 'Good morning, David',
  readVitruviusDesktopDisplayName: () => 'David',
  writeVitruviusDesktopDisplayName: (value: string) => value.trim(),
}));
jest.mock('../../services/FieldNoteDesktopDataSource', () => ({
  desktopFieldNoteDataSource: {
    list: jest.fn(async () => []),
    save: jest.fn(),
    update: jest.fn(),
  },
}));

function scheduleDocument(id: string, extra: Partial<DAVEWebReferenceDocument> = {}): DAVEWebReferenceDocument {
  return {
    id, name: id, originalFileName: `${id}.csv`, uri: '', mimeType: 'text/csv', category: 'Schedules', notes: '', isCurrent: false,
    importedAt: '2026-09-01T12:00:00.000Z', projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`,
    cloudUpdatedAt: '2026-09-30T12:00:00.000Z', linkedScheduleItems: [], importedScheduleItemCount: 3, ...extra,
  };
}

const master = scheduleDocument('Alpha master', { isCurrent: true, importedAt: '2026-09-20T12:00:00.000Z' });
// The older master: the newer one moved two of its tasks, and its own copies of them are its linked tasks.
const older = scheduleDocument('Alpha rev 1', { linkedScheduleItems: [{ id: 'rev1-paint', cloudUpdatedAt: '2026-09-30T12:00:00.000Z' }, { id: 'rev1-roof', cloudUpdatedAt: '2026-09-30T12:00:00.000Z' }] });
const memo = scheduleDocument('Site memo', { category: 'Report', originalFileName: 'Site memo.pdf', mimeType: 'application/pdf', importBatchId: null, importedScheduleItemCount: 0 });
// CHANGED by review pass H4, H4S-1 (14 Oct 2026): the words now speak of the category and the projects.
const STAYS = 'This schedule file has tasks, so its category and projects stay as they are. Changed, its tasks could show again on every device (some twice, or on old dates), and Make Current on it could hide another project\'s tasks. To file it differently, delete it with its tasks, then upload it again.';

const mockAuth = {
  phase: 'ready',
  userEmail: 'pm@example.com',
  sessionExpiresAt: null,
  snapshot: null as DAVEWebReadOnlySnapshot | null,
  freshness: {
    status: 'connected',
    lastSuccessfulRefreshAt: '2026-09-30T12:00:00.000Z',
    lastAttemptAt: '2026-09-30T12:00:00.000Z',
    consecutiveFailures: 0,
  },
  message: null,
  refreshSnapshot: jest.fn(async () => true),
  setCurrentSchedule: jest.fn(async () => 'project'),
  setCurrentDocument: jest.fn(async () => undefined),
  updateDocument: jest.fn(async (_document: DAVEWebReferenceDocument) => undefined),
  createTask: jest.fn(async (_item: unknown) => undefined),
  deleteDocument: jest.fn(),
  uploadDocument: jest.fn(),
  getArtifactUrl: jest.fn(),
  loadDocumentCoverageSummary: jest.fn(async () => { throw new Error('offline'); }),
  loadDocumentProof: jest.fn(),
  enqueueDocumentPreparation: jest.fn(async () => undefined),
};

jest.mock('../../components/web-shell/desktop-auth-provider', () => ({
  useDesktopAuth: () => mockAuth,
}));

beforeAll(() => {
  type TestWindow = { addEventListener?: jest.Mock; removeEventListener?: jest.Mock };
  const root = globalThis as unknown as { window?: unknown };
  const browserWindow = (root.window ?? {}) as TestWindow;
  root.window = browserWindow;
  browserWindow.addEventListener = jest.fn();
  browserWindow.removeEventListener = jest.fn();
});

beforeEach(() => {
  jest.clearAllMocks();
  mockProjectScope=null;
  mockAuth.snapshot = {
    projects: [{ id: 'alpha', name: 'Alpha' }, { id: 'beta', name: 'Beta' }] as DAVEWebReadOnlySnapshot['projects'],
    scheduleItems: [],
    projectUpdates: [],
    referenceDocuments: [master, older, memo],
    refreshedAt: '2026-09-30T12:00:00.000Z',
  };
});

async function openDetails(screen: ReturnType<typeof render>, name: string) {
  fireEvent.press(screen.getByLabelText(`View ${name}`));
  fireEvent.press(await screen.findByLabelText(`Edit project document details for ${name}`));
  expect(screen.getByText('ECOS document details')).toBeTruthy();
}

// The first render of the whole desktop shell in a file is slow on a busy machine.
jest.setTimeout(60_000);


import { loadDAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { createDAVEWebSupabaseGateway, daveWebSupabaseGateway } from '../../services/DAVEWebSupabaseClient';
import { within } from '@testing-library/react-native';
it.each(['line','panel','summary','delete'])('actual downloaded shared import membership is counted in file %s while deletion stays exclusive',async surface=>{
 const raw={projects:[{id:'alpha',name:'Alpha'}],projectUpdates:[],syncTombstones:[],referenceDocuments:[master,older].map(d=>({id:d.id,document_data:d,updated_at:d.cloudUpdatedAt})),
 scheduleItems:[{id:'shared',item_data:{id:'shared',taskName:'Shared roof task',projectName:'Alpha',scheduleProjectName:'Alpha',locationName:'Roof',status:'Not Started',percentComplete:0,
 startDate:'10/01/2026',finishDate:'10/02/2026',importBatchId:older.importBatchId,sourceDocumentId:older.id,alsoImportedInBatchIds:[master.importBatchId],
 owner:'Dana',notes:'',createdAt:'2026-10-01T12:00:00Z'}}]};
 const before=JSON.stringify(raw);jest.mocked(daveWebSupabaseGateway.loadAuthorizedRows).mockResolvedValue(raw as never);
 mockAuth.snapshot=await loadDAVEWebReadOnlySnapshot();
 expect(mockAuth.snapshot.referenceDocuments.map(d=>({id:d.id,count:d.importedScheduleItemCount,deleteCount:d.linkedScheduleItems.length})))
 .toEqual([{id:master.id,count:1,deleteCount:0},{id:older.id,count:1,deleteCount:0}]);
 const screen=render(<DesktopReadOnlyShell page="documents"/>);
 if(surface==='line') expect(within(screen.getByLabelText(`View ${older.name}`)).getByText(/1 linked task/)).toBeTruthy();
 else if(surface==='panel') {
  fireEvent.press(screen.getByLabelText(`View ${older.name}`));
  const fact=screen.UNSAFE_root.findAll(n=>typeof n.type==='function' && n.type.name==='TaskDetailFact' && n.props.label==='Linked Tasks')[0];
  expect(within(fact).getByText('1')).toBeTruthy();
  fireEvent.press(await screen.findByLabelText(`Edit project document details for ${older.name}`));expect(screen.getByText(STAYS)).toBeTruthy();
 } else if(surface==='summary') {
  const summary=screen.UNSAFE_root.findAll(n=>typeof n.type==='function' && n.type.name==='WorkspaceSummary')[0];
  expect(summary.props.metrics.find((m:{label:string})=>m.label==='Linked Tasks').value).toBe(1);
  expect(within(summary).getAllByText('1')).toHaveLength(3);
 } else {
  const markers:Record<string,unknown>[]=[];
  const queryFor=(table:string)=>{const q:Record<string,any>={};for(const method of ['select','eq','order'])q[method]=()=>q;
   q.maybeSingle=async()=>({data:table==='reference_documents'?{updated_at:older.cloudUpdatedAt}:null,error:null});
   q.upsert=async(rows:Record<string,unknown>[])=>{markers.push(...JSON.parse(JSON.stringify(rows)));return {error:null};};
   q.limit=async()=>({data:[],error:null});return q;};
  const gateway=createDAVEWebSupabaseGateway({auth:{getUser:async()=>({data:{user:{id:'synthetic-owner'}},error:null})},rpc:async()=>({data:true,error:null}),from:queryFor} as never);
  jest.mocked(daveWebSupabaseGateway.loadAuthorizedRows).mockImplementation(async()=>({...raw,syncTombstones:markers} as never));
  // Compile the unchanged actual auth-provider callback, rather than restating how it chooses deletion targets.
  const source=fs.readFileSync(path.resolve(__dirname,'../../components/web-shell/desktop-auth-provider.tsx'),'utf8');
  const tree=ts.createSourceFile('provider.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let arrow:ts.Node|undefined;
  function walk(n:ts.Node){if(ts.isVariableDeclaration(n)&&n.name.getText(tree)==='deleteDocument'&&n.initializer&&ts.isCallExpression(n.initializer))arrow=n.initializer.arguments[0];ts.forEachChild(n,walk);}walk(tree);
  if(!arrow)throw new Error('Missing actual provider delete consumer');
  const code=ts.transpileModule(`const extracted=${arrow.getText(tree)};`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
  const deps={snapshotRef:{current:mockAuth.snapshot},daveWebSupabaseGateway:gateway,
   scheduleDocumentAddsToMaster:jest.requireActual('../../services/PIEScheduleReconciliation').scheduleDocumentAddsToMaster,
   planDAVEWebScheduleDocumentDelete:jest.requireActual('../../services/DAVEWebOperations').planDAVEWebScheduleDocumentDelete,
   announceMutation:jest.fn(),refreshSnapshotInBackground:async()=>{mockAuth.snapshot=await loadDAVEWebReadOnlySnapshot();}};
  mockAuth.deleteDocument.mockImplementation(new Function(...Object.keys(deps),`${code};return extracted;`)(...Object.values(deps)));
  fireEvent.press(screen.getByLabelText(`Delete ${older.name}`));
  expect(screen.getByText(/linked tasks are also contained in another schedule/)).toBeTruthy();
  expect(screen.queryByText(/Delete Document \+ 1 Task/)).toBeNull();
  await act(async()=>fireEvent.press(screen.getByText('Delete Document')));
  expect(mockAuth.deleteDocument).toHaveBeenCalledWith(expect.objectContaining({id:older.id,linkedScheduleItems:[]}),false);
  expect(markers.map(m=>[m.entity_type,m.record_id])).toEqual([['reference_document',older.id]]);
  expect(mockAuth.snapshot!.scheduleItems.map(t=>t.id)).toEqual(['shared']);
  expect(mockAuth.snapshot!.referenceDocuments.map(d=>d.id)).toEqual([master.id]);
 }
 expect(JSON.stringify(raw)).toBe(before);if(surface==='delete') expect(mockAuth.snapshot!.referenceDocuments[0].linkedScheduleItems.map(t=>t.id)).toEqual(['shared']);
 else expect(mockAuth.snapshot!.referenceDocuments.every(d=>d.linkedScheduleItems.length===0)).toBe(true);
});

it('the desktop Tasks create consumer leaves manual WBS unassigned, preserving each new task id and project',async()=>{
 mockAuth.snapshot={...mockAuth.snapshot!,projects:[{id:'607c7eed-5dea-4a5a-8b52-0f165c71c4b5',name:'Alpha'}] as DAVEWebReadOnlySnapshot['projects'],referenceDocuments:[],scheduleItems:[]};
 const screen=render(<DesktopReadOnlyShell page="tasks"/>);
 for(const name of ['First hand task','Second hand task']) {
  fireEvent.press(screen.getByText('Add Task'));fireEvent.changeText(screen.getByLabelText('Task name'),name);
  await act(async()=>fireEvent.press(screen.getByText('Create Task')));
 }
 expect(mockAuth.createTask.mock.calls).toHaveLength(2);
 const rows=mockAuth.createTask.mock.calls.map(([r])=>r as {id:string;wbsCode?:string|null;projectId:string;taskName:string});
 expect(new Set(rows.map(r=>r.id)).size).toBe(2);
 expect(rows.map(r=>r.wbsCode??null)).toEqual([null,null]);
 expect(rows.every(r=>r.projectId==='607c7eed-5dea-4a5a-8b52-0f165c71c4b5')).toBe(true);
});

it('actual summary counts distinct task ids only in listed project file memberships, excluding archived/other project/unlinked/deleted rows',async()=>{
 const beta=scheduleDocument('Beta file',{projectName:'Beta',projectNames:['Beta'],importBatchId:'beta-batch'});
 const hidden=scheduleDocument('Archived file',{importBatchId:'archived-batch'});
 const sourceTask=(id:string,batch:string,extra:Record<string,unknown>={})=>({id,item_data:{id,taskName:id,projectName:'Alpha',scheduleProjectName:'Alpha',owner:'Dana',status:'Not Started',percentComplete:0,
 startDate:'10/01/2026',finishDate:'10/02/2026',createdAt:'2026-10-01T12:00:00Z',importBatchId:batch,...extra}});
 jest.mocked(daveWebSupabaseGateway.loadAuthorizedRows).mockResolvedValue({projects:[{id:'alpha',name:'Alpha'},{id:'beta',name:'Beta'}],projectUpdates:[],
 referenceDocuments:[{...master},{...older},beta,{...hidden,archivedAt:'2026-10-15T12:00:00Z'}].map(d=>({id:d.id,document_data:d,...(d.id===hidden.id?{archived_at:'2026-10-15T12:00:00Z'}:{})})),
 scheduleItems:[sourceTask('shared',String(older.importBatchId),{alsoImportedInBatchIds:[master.importBatchId]}),sourceTask('second',String(master.importBatchId)),sourceTask('other-project',String(master.importBatchId),{projectName:'Beta',scheduleProjectName:'Beta'}),sourceTask('second-other-project',String(master.importBatchId),{projectName:'Beta',scheduleProjectName:'Beta'}),
 sourceTask('hidden','archived-batch'),sourceTask('unlinked','no-listed-file'),sourceTask('deleted',String(master.importBatchId))],
 syncTombstones:[{entity_type:'schedule_item',record_id:'deleted',deleted_at:'2026-10-16T12:00:00Z'}]} as never);
 mockAuth.snapshot=await loadDAVEWebReadOnlySnapshot();mockProjectScope='Alpha';
 const screen=render(<DesktopReadOnlyShell page="documents"/>);
 expect(screen.queryByLabelText('View Beta file')).toBeNull();expect(screen.queryByLabelText('View Archived file')).toBeNull();
 const summary=screen.UNSAFE_root.findAll(n=>typeof n.type==='function' && n.type.name==='WorkspaceSummary')[0];
 expect(summary.props.metrics.find((m:{label:string})=>m.label==='Linked Tasks').value).toBe(2);
 expect(within(summary).getByText('2')).toBeTruthy();
 expect(mockAuth.snapshot.knownScheduleItems?.some(t=>t.id==='deleted')).toBe(false);
});
