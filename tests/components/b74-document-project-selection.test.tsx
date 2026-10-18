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
jest.mock('expo-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
  useLocalSearchParams: () => ({}),
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

import { createDAVEWebSupabaseGateway } from '../../services/DAVEWebSupabaseClient';
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

function mutationQuery(result: { data: unknown; error: unknown }) {
  const query: Record<string, any> = { error: result.error };
  for (const method of ['select', 'eq', 'insert', 'update', 'upsert', 'delete']) {
    query[method] = jest.fn(() => query);
  }
  query.single = jest.fn(async () => result);
  query.maybeSingle = jest.fn(async () => result);
  query.in = jest.fn(async () => result);
  return query;
}

function mutationClient(queryForTable: (table: string) => Record<string, any>) {
  const from = jest.fn(queryForTable);
  const rpc: jest.Mock = jest.fn(async () => ({ data: true, error: null, status: 200 }));
  const auth = {
    getUser: jest.fn(async () => ({ data: { user: { id: 'owner-1' } }, error: null })),
    getSession: jest.fn(async () => ({ data: { session: null }, error: null })),
    onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
    signInWithPassword: jest.fn(),
    signOut: jest.fn(async () => ({ error: null })),
  };
  return { client: { auth, from, rpc } as any, auth, from, rpc };
}

const memo = scheduleDocument('Site memo', {category:'Drawing', drawingNumber:'A-1', drawingRevision:'1', drawingStatus:'For Review',importBatchId:null,importedScheduleItemCount:0});
function workspace(document = memo) {
 mockAuth.snapshot={projects:[{id:'alpha',name:'Alpha'},{id:'beta',name:'Beta'}] as DAVEWebReadOnlySnapshot['projects'],scheduleItems:[],projectUpdates:[],referenceDocuments:[document],refreshedAt:document.cloudUpdatedAt!};
}
beforeEach(()=>{jest.clearAllMocks();workspace();});
jest.setTimeout(60000);
async function open(screen:ReturnType<typeof render>){fireEvent.press(screen.getByLabelText('View Site memo'));fireEvent.press(await screen.findByLabelText('Edit project document details for Site memo'));}
async function save(screen:ReturnType<typeof render>){await act(async()=>{fireEvent.press(screen.getByText('Save Document Details'));});return mockAuth.updateDocument.mock.calls.slice(-1)[0][0];}
it('initial one-project details save keeps one project',async()=>{
 const original=JSON.stringify(memo);const screen=render(<DesktopReadOnlyShell page="documents"/>);await open(screen);const saved=await save(screen);expect(saved.projectNames).toEqual(['Alpha']);expect(saved.projectName).toBe('Alpha');expect(JSON.stringify(memo)).toBe(original);screen.unmount();
});
it('original tick Beta interaction reaches gateway document_data without duplicate Alpha',async()=>{
 const screen=render(<DesktopReadOnlyShell page="documents"/>);await open(screen);fireEvent.press(screen.getByRole('checkbox',{name:'Beta'}));const saved=await save(screen);
 const query=mutationQuery({data:{updated_at:'written'},error:null});const fixture=mutationClient(table=>{if(table==='reference_documents')return query;throw Error(table);});const gateway=createDAVEWebSupabaseGateway(fixture.client);await gateway.updateAuthorizedReferenceDocument(saved);
 const row=query.update.mock.calls[0][0];expect(row.document_data.projectNames).toEqual(['Alpha','Beta']);expect(row.document_data.projectName).toBe('Alpha');expect(query.eq).toHaveBeenCalledWith('owner_id','owner-1');expect(query.eq).toHaveBeenCalledWith('updated_at',memo.cloudUpdatedAt);screen.unmount();
});
it('cloud refresh reset and repeated save stay unique',async()=>{
 const screen=render(<DesktopReadOnlyShell page="documents"/>);await open(screen);
 workspace({...memo,cloudUpdatedAt:'2026-10-02T12:00:00.000Z',projectNames:['Alpha','Alpha','Beta']});screen.rerender(<DesktopReadOnlyShell page="documents"/>);fireEvent.press(await screen.findByLabelText('Edit project document details for Site memo'));const saved=await save(screen);expect(saved.projectNames).toEqual(['Alpha','Beta']);
 workspace({...saved,cloudUpdatedAt:'2026-10-03T12:00:00.000Z'});screen.rerender(<DesktopReadOnlyShell page="documents"/>);fireEvent.press(await screen.findByLabelText('Edit project document details for Site memo'));expect((await save(screen)).projectNames).toEqual(['Alpha','Beta']);screen.unmount();
});
