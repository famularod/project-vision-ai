import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { DesktopReadOnlyShell } from '../../components/web-shell/desktop-read-only-shell';
import type { DAVEWebPreparedUpload } from '../../services/DAVEWebOperations';
import type {
  DAVEWebReadOnlySnapshot,
  DAVEWebReferenceDocument,
} from '../../services/DAVEWebReadOnlyRepository';

// Owner answer Q44 (6 Oct 2026), on the web's Documents page itself: a
// compliance document the phone archived is hidden on every device and kept
// in the cloud, so the page does not list it and the side bar does not count
// it. With no archived mark (before the owner's database change) the page is
// what it was. Synthetic data; the shell harness of
// web-ws1-upload-review-returning-task.test.tsx.

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
  useLocalSearchParams: () => mockRoute,
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

const mockRoute = {project:'Alpha'};
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
  updateDocument: jest.fn(async () => undefined),
  deleteDocument: jest.fn(),
  setDocumentArchived: jest.fn(async (_document: DAVEWebReferenceDocument, _archived: boolean): Promise<void> => undefined),
  uploadDocument: jest.fn(async (_prepared: DAVEWebPreparedUpload) => undefined),
  getArtifactUrl: jest.fn(),
  loadDocumentCoverageSummary: jest.fn(async () => { throw new Error('offline'); }),
  loadDocumentProof: jest.fn(),
  enqueueDocumentPreparation: jest.fn(async () => undefined),
};

jest.mock('../../components/web-shell/desktop-auth-provider', () => ({
  useDesktopAuth: () => mockAuth,
}));

function sharedDocument(id: string, category: string): DAVEWebReferenceDocument {
  return {
    id, name: id, originalFileName: `${id}.pdf`, uri: '', mimeType: 'application/pdf', category, notes: '', isCurrent: false,
    importedAt: '2026-10-05T15:59:00.000Z', projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: null,
    cloudUpdatedAt: '2026-10-05T16:00:00.000Z', linkedScheduleItems: [], importedScheduleItemCount: 0,
  };
}

function workspace(archivedDocumentIds?: readonly string[]) {
  mockAuth.snapshot = {
    projects: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Alpha' } as DAVEWebReadOnlySnapshot['projects'][number]],
    scheduleItems: [], knownScheduleItems: [], projectUpdates: [],
    referenceDocuments: [sharedDocument('Grading permit', 'Permit Card'), sharedDocument('Site contract', 'Contract')],
    ...(archivedDocumentIds ? { archivedDocumentIds } : {}),
    refreshedAt: '2026-10-06T12:00:00.000Z',
  };
}


beforeAll(()=>{const w=globalThis as any;w.window=w.window??{};w.window.addEventListener=jest.fn();w.window.removeEventListener=jest.fn();});
beforeEach(()=>{mockRoute.project='Alpha';jest.clearAllMocks();mockAuth.userEmail='pm@example.com';mockAuth.setDocumentArchived.mockReset().mockResolvedValue(undefined);});
function pending(){let resolve!:()=>void;let reject!:(x:unknown)=>void;const promise=new Promise<void>((r,j)=>{resolve=r;reject=j});return {resolve,reject,promise};}
function handler(v:any,label:string){let n=v.getByText(label);while(n&&typeof n.props.onPress!=='function')n=n.parent;return n.props.onPress as ()=>void;}


const CHILD='22222222-2222-4222-8222-222222222222';
const SIBLING='33333333-3333-4333-8333-333333333333';
function childWorkspace(archived=false){
 workspace(archived?['Grading permit']:[]);
 mockAuth.snapshot={...mockAuth.snapshot!,projects:[...mockAuth.snapshot!.projects,{id:CHILD,name:'Alpha East'},{id:SIBLING,name:'Unrelated West'}] as any,
 scheduleItems:[{id:'task',projectName:'Alpha East',locationName:'Alpha East',scheduleProjectName:'Alpha',taskName:'Synthetic task',status:'Not Started',priority:'Medium',startDate:'2026-10-17',endDate:'2026-10-18'}] as any,
 referenceDocuments:mockAuth.snapshot!.referenceDocuments.map(d=>d.id==='Grading permit'?{...d,projectId:CHILD,projectName:'Alpha East',projectNames:['Alpha East'],archivedAt:archived?'2026-10-16T12:00:00Z':null}:d)};
 return mockAuth.snapshot.referenceDocuments[0];
}
it('4.34 parent scope restores its actually listed child document with exact identity',async()=>{
 const document=childWorkspace(true);const before=JSON.stringify(mockAuth.snapshot);const v=render(<DesktopReadOnlyShell page="documents"/>);
 expect(v.getByText('Archived (1)')).toBeTruthy();fireEvent.press(v.getByText('Archived (1)'));fireEvent.press(v.getByLabelText('Restore Grading permit'));
 await waitFor(()=>expect(mockAuth.setDocumentArchived).toHaveBeenCalledTimes(1));expect(mockAuth.setDocumentArchived).toHaveBeenCalledWith(document,false);expect(JSON.stringify(mockAuth.snapshot)).toBe(before);v.unmount();
});
it('4.34 parent scope archives its listed child document after explicit confirmation without deleting',async()=>{
 const document=childWorkspace();const before=JSON.stringify(mockAuth.snapshot);const v=render(<DesktopReadOnlyShell page="documents"/>);
 fireEvent.press(v.getByLabelText('Archive Grading permit'));expect(v.getByText('Archive “Grading permit”?')).toBeTruthy();expect(mockAuth.setDocumentArchived).not.toHaveBeenCalled();
 fireEvent.press(v.getByText('Confirm archive'));await waitFor(()=>expect(mockAuth.setDocumentArchived).toHaveBeenCalledWith(document,true));expect(mockAuth.deleteDocument).not.toHaveBeenCalled();expect(JSON.stringify(mockAuth.snapshot)).toBe(before);v.unmount();
});
it('4.34 unrelated sibling records are not offered in the parent active or archived lists',()=>{
 childWorkspace(true);const foreign={...sharedDocument('Foreign compliance','Compliance'),projectId:SIBLING,projectName:'Unrelated West',projectNames:['Unrelated West'],archivedAt:'2026-10-16T10:00:00Z'};
 mockAuth.snapshot={...mockAuth.snapshot!,referenceDocuments:[...mockAuth.snapshot!.referenceDocuments,foreign],archivedDocumentIds:['Grading permit',foreign.id]};
 const v=render(<DesktopReadOnlyShell page="documents"/>);expect(v.getByText('Archived (1)')).toBeTruthy();fireEvent.press(v.getByText('Archived (1)'));expect(v.queryByLabelText('Restore Foreign compliance')).toBeNull();expect(v.queryByLabelText('Archive Foreign compliance')).toBeNull();expect(mockAuth.setDocumentArchived).not.toHaveBeenCalled();v.unmount();
});
it('4.34 an ambiguous child identity is refused rather than widening parent authority',()=>{
 childWorkspace();mockAuth.snapshot={...mockAuth.snapshot!,projects:[...mockAuth.snapshot!.projects,{id:'44444444-4444-4444-8444-444444444444',name:'alpha east'}] as any};const v=render(<DesktopReadOnlyShell page="documents"/>);
 fireEvent.press(v.getByLabelText('Archive Grading permit'));expect(v.queryByText('Confirm archive')).toBeNull();expect(v.getByText('This document’s project identity needs review. Refresh Documents before trying again.')).toBeTruthy();expect(mockAuth.setDocumentArchived).not.toHaveBeenCalled();v.unmount();
});
it('4.34 removing a child from the same parent scope invalidates its open confirmation and old handler',async()=>{
 childWorkspace();const v=render(<DesktopReadOnlyShell page="documents"/>);fireEvent.press(v.getByLabelText('Archive Grading permit'));const press=handler(v,'Confirm archive');
 mockAuth.snapshot={...mockAuth.snapshot!,scheduleItems:[]};v.rerender(<DesktopReadOnlyShell page="documents"/>);await act(async()=>press());expect(mockAuth.setDocumentArchived).not.toHaveBeenCalled();expect(v.queryByText('Confirm archive')).toBeNull();v.unmount();
});
it.each(['project','account'])('4.34 old child confirmation cannot act after %s context changes',async kind=>{
 childWorkspace();const v=render(<DesktopReadOnlyShell page="documents"/>);fireEvent.press(v.getByLabelText('Archive Grading permit'));const press=handler(v,'Confirm archive');
 if(kind==='project')mockRoute.project='Unrelated West';else mockAuth.userEmail='other@example.com';v.rerender(<DesktopReadOnlyShell page="documents"/>);await act(async()=>press());expect(mockAuth.setDocumentArchived).not.toHaveBeenCalled();v.unmount();
});
it('4.34 a late child restore answer cannot report success after account changes',async()=>{
 childWorkspace(true);const hold=pending();mockAuth.setDocumentArchived.mockReturnValueOnce(hold.promise);const v=render(<DesktopReadOnlyShell page="documents"/>);fireEvent.press(v.getByText('Archived (1)'));fireEvent.press(v.getByLabelText('Restore Grading permit'));await waitFor(()=>expect(mockAuth.setDocumentArchived).toHaveBeenCalledTimes(1));
 mockAuth.userEmail='other@example.com';v.rerender(<DesktopReadOnlyShell page="documents"/>);await act(async()=>hold.resolve());expect(v.queryByText('“Grading permit” is restored.')).toBeNull();v.unmount();
});
