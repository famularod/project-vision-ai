import {act,render,waitFor} from '@testing-library/react-native';
import {Text} from 'react-native';
import {DesktopAuthProvider,useDesktopAuth} from '../../components/web-shell/desktop-auth-provider';
import {loadDAVEWebReadOnlySnapshot} from '../../services/DAVEWebReadOnlyRepository';
import {daveWebSupabaseGateway} from '../../services/DAVEWebSupabaseClient';
jest.mock('../../services/DAVEWebReadOnlyRepository',()=>({loadDAVEWebReadOnlySnapshot:jest.fn()}));
jest.mock('../../services/DAVEWebSupabaseClient',()=>{
 class DAVEWebAuthorizationError extends Error{};return {DAVEWebAuthorizationError,daveWebSupabaseGateway:{getSessionStatus:jest.fn(),subscribeToAuthStateChange:jest.fn(),subscribeToAuthorizedOperationalChanges:jest.fn(),runAuthorizedMaintenance:jest.fn(),setAuthorizedDocumentArchived:jest.fn(),storedSignInUserId:jest.fn()}};
});
const gateway=jest.mocked(daveWebSupabaseGateway);const load=jest.mocked(loadDAVEWebReadOnlySnapshot);
const project='11111111-1111-4111-8111-111111111111';const stamp='2026-10-17T12:00:00Z';
const document:any={id:'original-doc',projectId:project,projectName:'Alpha',projectNames:['Alpha'],name:'Permit',category:'Permit Card',cloudUpdatedAt:stamp,archivedAt:null};
const snapshot:any={projects:[{id:project,name:'Alpha'}],scheduleItems:[],projectUpdates:[],referenceDocuments:[document],archivedDocumentIds:[],refreshedAt:stamp};
let auth:ReturnType<typeof useDesktopAuth>;function Probe(){auth=useDesktopAuth();return <Text>{auth.phase}</Text>}
function deferred(){let resolve!:(x:string|null)=>void;const promise=new Promise<string|null>(r=>resolve=r);return {promise,resolve}}
beforeEach(()=>{jest.clearAllMocks();load.mockReset().mockResolvedValue(snapshot);gateway.getSessionStatus.mockResolvedValue({configured:true,session:{user:{id:'owner-A',email:'a@example.com'}}} as any);gateway.subscribeToAuthStateChange.mockReturnValue(()=>undefined);gateway.subscribeToAuthorizedOperationalChanges.mockResolvedValue(()=>undefined);gateway.runAuthorizedMaintenance.mockResolvedValue(undefined);gateway.setAuthorizedDocumentArchived.mockReset();});
async function mount(){const v=render(<DesktopAuthProvider><Probe/></DesktopAuthProvider>);await v.findByText('ready');return v;}
it('4.34 actual provider fences duplicate calls, preserves exact payload and acknowledges only returned mark',async()=>{
 const hold=deferred();gateway.setAuthorizedDocumentArchived.mockReturnValueOnce(hold.promise);const v=await mount();const before=JSON.stringify(snapshot);let run!:Promise<void>;
 act(()=>{run=auth.setDocumentArchived(document,true)});await expect(auth.setDocumentArchived(document,true)).rejects.toThrow(/still being checked/);
 expect(gateway.setAuthorizedDocumentArchived).toHaveBeenCalledWith(document,true,'owner-A');expect(auth.snapshot?.archivedDocumentIds).toEqual([]);expect(JSON.stringify(snapshot)).toBe(before);
 // Keep the immediate acknowledgement even if its later refresh cannot connect.
 load.mockRejectedValueOnce(new Error('offline after successful write'));
 await act(async()=>{hold.resolve('2026-10-17T13:00:00Z');await run});expect(auth.snapshot?.archivedDocumentIds).toEqual([document.id]);expect(auth.snapshot?.referenceDocuments[0]).toEqual({...document,archivedAt:'2026-10-17T13:00:00Z'});expect(JSON.stringify(snapshot)).toBe(before);v.unmount();
});
it('4.34 provider refuses stale or ambiguous project input before any gateway write',async()=>{
 const v=await mount();await expect(auth.setDocumentArchived({...document,cloudUpdatedAt:'obsolete'},true)).rejects.toThrow(/Documents changed/);expect(gateway.setAuthorizedDocumentArchived).not.toHaveBeenCalled();v.unmount();
});
it('4.34 unmounted provider cannot publish or refresh a late acknowledgement',async()=>{
 const hold=deferred();gateway.setAuthorizedDocumentArchived.mockReturnValueOnce(hold.promise);const v=await mount();let run!:Promise<void>;act(()=>{run=auth.setDocumentArchived(document,true)});v.unmount();const reads=load.mock.calls.length;await act(async()=>{hold.resolve('2026-10-17T13:00:00Z');await run});expect(load.mock.calls.length).toBe(reads);
});
it('4.34 actual account transition prevents late old acknowledgement from updating the new workspace',async()=>{
 const hold=deferred();gateway.setAuthorizedDocumentArchived.mockReturnValueOnce(hold.promise);const v=await mount();let run!:Promise<void>;act(()=>{run=auth.setDocumentArchived(document,true)});
 const next={...snapshot,referenceDocuments:[],archivedDocumentIds:[],refreshedAt:'2026-10-17T14:00:00Z'};load.mockResolvedValue(next);const callback=gateway.subscribeToAuthStateChange.mock.calls[0][0];
 await act(async()=>{callback('SIGNED_IN',{user:{id:'owner-B',email:'b@example.com'}} as any)});await waitFor(()=>expect(auth.userEmail).toBe('b@example.com'));
 await act(async()=>{hold.resolve('2026-10-17T13:00:00Z');await run});expect(auth.snapshot?.referenceDocuments).toEqual([]);expect(auth.snapshot?.archivedDocumentIds).toEqual([]);v.unmount();
});
