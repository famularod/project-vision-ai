const mockValues = new Map<string,string>();
let mockOwner: string|null = 'a';
const mockListeners = new Set<()=>void>();
let mockDeferredRead: Promise<string|null>|null = null;
jest.mock('@react-native-async-storage/async-storage',()=>({__esModule:true,default:{
 getItem:jest.fn(async()=>null),setItem:jest.fn(async(k:string,v:string)=>{mockValues.set(k,v)}),removeItem:jest.fn()
}}));
jest.mock('../../services/OwnerStorageSandbox',()=>({ownerWhoseStorageIsInFront:async()=>mockOwner,subscribeToOwnerStorageSwitch:(f:()=>void)=>{mockListeners.add(f);return()=>mockListeners.delete(f)}}));
jest.mock('../../services/ReportRecipients',()=>({...jest.requireActual('../../services/ReportRecipients'),pickReportRecipient:jest.fn()}));
import AsyncStorage from '@react-native-async-storage/async-storage';
import {act,renderHook,waitFor} from '@testing-library/react-native';
import {useReportRecipients} from '../../hooks/useReportRecipients';
import {pickReportRecipient} from '../../services/ReportRecipients';
const P={key:'dummy',name:'Dummy',email:'dummy@example.test',phone:'+15550199'};
const key=(owner:string,scope:string)=>`@vitruvius/report-recipient-selection/v1/${encodeURIComponent(owner)}/${encodeURIComponent(scope)}`;
beforeEach(()=>{mockOwner='a';mockValues.clear();mockDeferredRead=null;jest.mocked(AsyncStorage.getItem).mockImplementation(async k=>mockDeferredRead??mockValues.get(k)??null);jest.mocked(pickReportRecipient).mockResolvedValue({status:'picked',recipient:P});});
async function add(r:{current:ReturnType<typeof useReportRecipients>}){await waitFor(()=>expect(r.current.loading).toBe(false));await act(async()=>r.current.add());await waitFor(()=>expect(r.current.recipients).toEqual([P]));}
it('persist add/remove, same scoped restart, report+project isolation and no restore write',async()=>{
 const h=renderHook(({scope})=>useReportRecipients(scope),{initialProps:{scope:'daily|pm|tower'}});await add(h.result);await waitFor(()=>expect(mockValues.get(key('a','daily|pm|tower'))).toContain('dummy'));h.unmount();
 const v=renderHook(({scope})=>useReportRecipients(scope),{initialProps:{scope:'daily|pm|tower'}});await waitFor(()=>expect(v.result.current.recipients).toEqual([P]));
 v.rerender({scope:'daily|exec|tower'});await waitFor(()=>expect(v.result.current.loading).toBe(false));expect(v.result.current.recipients).toEqual([]);v.rerender({scope:'daily|pm|other'});await waitFor(()=>expect(v.result.current.loading).toBe(false));expect(v.result.current.recipients).toEqual([]);
 v.rerender({scope:'daily|pm|tower'});await waitFor(()=>expect(v.result.current.recipients).toEqual([P]));act(()=>v.result.current.remove(P.key));await waitFor(()=>expect(mockValues.get(key('a','daily|pm|tower'))).toBe('[]'));v.unmount();
 const again=renderHook(()=>useReportRecipients('daily|pm|tower'));await waitFor(()=>expect(again.result.current.loading).toBe(false));expect(again.result.current.recipients).toEqual([]);
});
it('same mounted scope clears on account switch and restores original account only',async()=>{
 const h=renderHook(()=>useReportRecipients('same'));await add(h.result);await waitFor(()=>expect(mockValues.has(key('a','same'))).toBe(true));
 act(()=>{mockOwner='b';mockListeners.forEach(f=>f())});expect(h.result.current.recipients).toEqual([]);await waitFor(()=>expect(h.result.current.loading).toBe(false));expect(h.result.current.recipients).toEqual([]);
 act(()=>{mockOwner='a';mockListeners.forEach(f=>f())});await waitFor(()=>expect(h.result.current.recipients).toEqual([P]));
});
it('late contact picker cannot add to a different report or account',async()=>{
 let finish!:(v:Awaited<ReturnType<typeof pickReportRecipient>>)=>void;jest.mocked(pickReportRecipient).mockImplementation(()=>new Promise(r=>finish=r));
 const h=renderHook(({scope})=>useReportRecipients(scope),{initialProps:{scope:'old'}});await waitFor(()=>expect(h.result.current.loading).toBe(false));act(()=>h.result.current.add());h.rerender({scope:'new'});await waitFor(()=>expect(h.result.current.loading).toBe(false));await act(async()=>finish({status:'picked',recipient:P}));expect(h.result.current.recipients).toEqual([]);expect(mockValues.size).toBe(0);
 act(()=>h.result.current.add());act(()=>{mockOwner='b';mockListeners.forEach(f=>f())});await waitFor(()=>expect(h.result.current.loading).toBe(false));await act(async()=>finish({status:'picked',recipient:P}));expect(h.result.current.recipients).toEqual([]);
});
it('late read from old report cannot overwrite new selection',async()=>{
 let finish!:(v:string|null)=>void;mockDeferredRead=new Promise(r=>finish=r);const h=renderHook(({scope})=>useReportRecipients(scope),{initialProps:{scope:'old'}});await act(async()=>{await Promise.resolve()});mockDeferredRead=null;h.rerender({scope:'new'});await add(h.result);await act(async()=>finish(JSON.stringify([{...P,key:'old'}])));expect(h.result.current.recipients).toEqual([P]);
});
it('storage failure keeps selection in memory and explains restart boundary',async()=>{
 jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('disk'));const h=renderHook(()=>useReportRecipients('same'));await add(h.result);await waitFor(()=>expect(h.result.current.message).toContain('could not be kept'));expect(h.result.current.recipients).toEqual([P]);
});
