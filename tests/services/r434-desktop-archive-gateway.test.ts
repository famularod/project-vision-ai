import {createDAVEWebSupabaseGateway} from '../../services/DAVEWebSupabaseClient';
jest.mock('@react-native-async-storage/async-storage',()=>({getItem:jest.fn(),setItem:jest.fn(),removeItem:jest.fn()}));
const stamp='2026-10-17T12:00:00Z';
const doc:any={id:'doc-original',name:'Permit',category:'Permit Card',projectId:'alpha',projectName:'Alpha',projectNames:['Alpha'],cloudUpdatedAt:stamp,archivedAt:null,isCurrent:false,linkedScheduleItems:[]};
function fixture(){
 let owner='owner-A';let read:any={id:doc.id,owner_id:owner,updated_at:stamp,archived_at:null,document_data:{...doc}};let response:any={data:[{id:doc.id,archived_at:'2026-10-17T13:00:00Z'}],error:null};
 const writes:any[]=[];const filters:any[]=[];const make=()=>{let writing=false;const q:any={};for(const key of ['select','eq','is','abortSignal'])q[key]=jest.fn((...args:any[])=>{filters.push([key,...args]);return q});q.update=jest.fn((patch:any)=>{writing=true;writes.push(patch);return q});q.maybeSingle=jest.fn(async()=>({data:read,error:null}));q.then=(resolve:any,reject:any)=>Promise.resolve(response).then(resolve,reject);return q;};
 const client:any={auth:{getUser:jest.fn(async()=>({data:{user:{id:owner}},error:null})),getSession:jest.fn(async()=>({data:{session:null},error:null})),onAuthStateChange:jest.fn(()=>({data:{subscription:{unsubscribe:jest.fn()}}}))},rpc:jest.fn(async()=>({data:true,error:null})),from:jest.fn(make)};
 const gateway=createDAVEWebSupabaseGateway(client) as any;
 return {gateway,client,writes,filters,setOwner:(x:string)=>owner=x,setRead:(x:any)=>read=x,setResponse:(x:any)=>response=x};
}
it('4.34 authorized archive writes only archived_at with exact owner, document, revision and seen mark conditions',async()=>{
 const f=fixture();await f.gateway.setAuthorizedDocumentArchived(doc,true,'owner-A');expect(f.writes).toHaveLength(1);expect(Object.keys(f.writes[0])).toEqual(['archived_at']);expect(f.filters).toEqual(expect.arrayContaining([['eq','owner_id','owner-A'],['eq','id',doc.id],['eq','updated_at',stamp],['is','archived_at',null]]));expect(f.client.from.mock.calls.every((c:any)=>c[0]==='reference_documents')).toBe(true);
});
it('4.34 restore condition names original archive mark and never writes document_data or files',async()=>{
 const f=fixture();const archived='2026-10-16T12:00:00Z';f.setRead({id:doc.id,updated_at:stamp,archived_at:archived,document_data:doc});f.setResponse({data:[{id:doc.id,archived_at:null}],error:null});await f.gateway.setAuthorizedDocumentArchived({...doc,archivedAt:archived},false,'owner-A');expect(f.writes).toEqual([{archived_at:null}]);expect(f.filters).toContainEqual(['eq','archived_at',archived]);
});
it.each(['other-owner','stale','schedule','missing','conflict','unsupported'])('4.34 %s cannot claim archive success',async kind=>{
 const f=fixture();if(kind==='other-owner')f.setOwner('owner-B');if(kind==='stale')f.setRead({id:doc.id,updated_at:'new',archived_at:null,document_data:doc});if(kind==='schedule')f.setRead({id:doc.id,updated_at:stamp,archived_at:null,document_data:{...doc,category:'Schedules',isCurrent:true}});if(kind==='missing')f.setRead(null);if(kind==='conflict')f.setResponse({data:[],error:null});if(kind==='unsupported')f.setResponse({data:null,error:{code:'42703',message:'archived_at does not exist'}});
 await expect(f.gateway.setAuthorizedDocumentArchived(doc,true,'owner-A')).rejects.toThrow();if(!['conflict','unsupported'].includes(kind))expect(f.writes).toHaveLength(0);
});
