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
beforeEach(()=>{jest.clearAllMocks();mockAuth.userEmail='pm@example.com';mockAuth.setDocumentArchived.mockReset().mockResolvedValue(undefined);});
function pending(){let resolve!:()=>void;let reject!:(x:unknown)=>void;const promise=new Promise<void>((r,j)=>{resolve=r;reject=j});return {resolve,reject,promise};}
function handler(v:any,label:string){let n=v.getByText(label);while(n&&typeof n.props.onPress!=='function')n=n.parent;return n.props.onPress as ()=>void;}
it('4.34 actual desktop archive count/list, confirmation cancel, exact original document and truthful pending state',async()=>{
 workspace(['Grading permit']);const v=render(<DesktopReadOnlyShell page="documents"/>);
 expect(v.getByText('Archived (1)')).toBeTruthy();expect(v.queryByText('Grading permit')).toBeNull();
 fireEvent.press(v.getByText('Archived (1)'));expect(v.getByText('Grading permit')).toBeTruthy();
 fireEvent.press(v.getByLabelText('Restore Grading permit'));await waitFor(()=>expect(mockAuth.setDocumentArchived).toHaveBeenCalledTimes(1));
 expect(mockAuth.setDocumentArchived).toHaveBeenCalledWith(mockAuth.snapshot!.referenceDocuments[0],false);
 const hold=pending();mockAuth.setDocumentArchived.mockReturnValueOnce(hold.promise);
 fireEvent.press(v.getByLabelText('Archive Site contract'));expect(v.getByText('Archive “Site contract”?')).toBeTruthy();
 fireEvent.press(v.getByText('Cancel archive'));expect(mockAuth.setDocumentArchived).toHaveBeenCalledTimes(1);
 fireEvent.press(v.getByLabelText('Archive Site contract'));const press=handler(v,'Confirm archive');await act(async()=>{press();press();});
 expect(mockAuth.setDocumentArchived).toHaveBeenCalledTimes(2);expect(v.getByText('Archiving…')).toBeTruthy();
 expect(v.queryByText('“Site contract” is archived.')).toBeNull();expect(mockAuth.deleteDocument).not.toHaveBeenCalled();
 await act(async()=>hold.resolve());await v.findByText('“Site contract” is archived.');v.unmount();
});
it('4.34 refused/offline archive preserves document and exposes meaningful retry feedback',async()=>{
 workspace();mockAuth.setDocumentArchived.mockRejectedValueOnce(new Error('No connection. Archive was not confirmed. Refresh and try again.'));
 const v=render(<DesktopReadOnlyShell page="documents"/>);fireEvent.press(v.getByLabelText('Archive Grading permit'));fireEvent.press(v.getByText('Confirm archive'));
 await v.findByText('No connection. Archive was not confirmed. Refresh and try again.');expect(v.getByText('Grading permit')).toBeTruthy();expect(mockAuth.deleteDocument).not.toHaveBeenCalled();v.unmount();
});
it('4.34 account change discards old confirmation and late operation cannot claim success in new account',async()=>{
 workspace();const hold=pending();mockAuth.setDocumentArchived.mockReturnValueOnce(hold.promise);const v=render(<DesktopReadOnlyShell page="documents"/>);
 fireEvent.press(v.getByLabelText('Archive Grading permit'));const oldConfirm=handler(v,'Confirm archive');
 mockAuth.userEmail='other@example.com';v.rerender(<DesktopReadOnlyShell page="documents"/>);await act(async()=>oldConfirm());expect(mockAuth.setDocumentArchived).not.toHaveBeenCalled();
 fireEvent.press(v.getByLabelText('Archive Grading permit'));fireEvent.press(v.getByText('Confirm archive'));
 mockAuth.userEmail='third@example.com';v.rerender(<DesktopReadOnlyShell page="documents"/>);await act(async()=>hold.resolve());
 expect(v.queryByText('“Grading permit” is archived.')).toBeNull();v.unmount();
});
it('4.34 hidden archive list remains separate from active document count and sent update records',()=>{
 workspace(['Grading permit']);const before=JSON.stringify(mockAuth.snapshot);const v=render(<DesktopReadOnlyShell page="documents"/>);expect(v.getByText('Archived (1)')).toBeTruthy();expect(v.getByText('1 document')).toBeTruthy();expect(JSON.stringify(mockAuth.snapshot)).toBe(before);v.unmount();
});
it('4.34 same-render Restore double press calls once and rejects late unmounted feedback',async()=>{
 workspace(['Grading permit']);const hold=pending();mockAuth.setDocumentArchived.mockReturnValueOnce(hold.promise);const v=render(<DesktopReadOnlyShell page="documents"/>);fireEvent.press(v.getByText('Archived (1)'));const press=handler(v,'Restore');await act(async()=>{press();press()});expect(mockAuth.setDocumentArchived).toHaveBeenCalledTimes(1);expect(v.getByText('Restoring…')).toBeTruthy();v.unmount();await act(async()=>hold.resolve());
});
it('4.34 archive scope refuses an ambiguous project identity without a write',async()=>{
 workspace();mockAuth.snapshot={...mockAuth.snapshot!,projects:[{id:'11111111-1111-4111-8111-111111111111',name:'Alpha'},{id:'22222222-2222-4222-8222-222222222222',name:'alpha '}] as any};const v=render(<DesktopReadOnlyShell page="documents"/>);fireEvent.press(v.getByLabelText('Archive Grading permit'));expect(v.queryByText('Confirm archive')).toBeNull();expect(v.getByText('This document’s project identity needs review. Refresh Documents before trying again.')).toBeTruthy();expect(mockAuth.setDocumentArchived).not.toHaveBeenCalled();v.unmount();
});

it('inventory followup: exact accessible Archive/Delete labels match their real confirmation routes and reads never mutate',async()=>{
 workspace([]);mockAuth.snapshot={...mockAuth.snapshot!,referenceDocuments:[...mockAuth.snapshot!.referenceDocuments,sharedDocument('Site plan','Plans')]};const before=JSON.stringify(mockAuth.snapshot);
 const v=render(<DesktopReadOnlyShell page="documents"/>);expect(v.getByLabelText('Archive Grading permit')).toBeTruthy();expect(v.queryByLabelText('Delete Grading permit')).toBeNull();expect(v.getByLabelText('Delete Site plan')).toBeTruthy();expect(v.queryByLabelText('Archive Site plan')).toBeNull();
 expect(mockAuth.setDocumentArchived).not.toHaveBeenCalled();expect(mockAuth.deleteDocument).not.toHaveBeenCalled();
 fireEvent.press(v.getByLabelText('Archive Grading permit'));expect(v.getByText('Archive “Grading permit”?')).toBeTruthy();expect(mockAuth.setDocumentArchived).not.toHaveBeenCalled();fireEvent.press(v.getByText('Cancel archive'));
 fireEvent.press(v.getByLabelText('Delete Site plan'));expect(v.getByText('Delete “Site plan”?')).toBeTruthy();expect(mockAuth.deleteDocument).not.toHaveBeenCalled();fireEvent.press(v.getByText('Cancel'));
 expect(JSON.stringify(mockAuth.snapshot)).toBe(before);expect(mockAuth.setDocumentArchived).not.toHaveBeenCalled();expect(mockAuth.deleteDocument).not.toHaveBeenCalled();v.unmount();
});
