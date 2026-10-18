import { createCompleteBackupParts, readCompleteBackupParts, type CompleteBackupPart } from '../../services/CompleteBackupArchiveParts';
import { openSelectedBackup, type BackupFileIO } from '../../services/DeviceBackupWorkflow';
const PASSPHRASE='synthetic backup passphrase only';
function random(seed:number){return async(length:number)=>Uint8Array.from({length},()=>++seed%251);}
const state=(label:string)=>({version:2,projects:['Synthetic Tower'],savedUpdates:[{id:'update',projectName:'Synthetic Tower',notes:label,photos:[{id:'a',uri:'',_backupAssetId:'photo-a'},{id:'b',uri:'',_backupAssetId:'photo-b'}]}]});
async function make(label:string,fill:number,seed:number){
 const parts:CompleteBackupPart[]=[];
 await createCompleteBackupParts({state:state(label),assets:['a','b'].map((id,index)=>({id:'photo-'+id,kind:'photo' as const,relativePath:id+'.jpg',sizeBytes:8,read:async()=>new Uint8Array(8).fill(fill+index)})),
 passphrase:PASSPHRASE,createdAt:'2026-10-17T12:00:00Z',backupId:label,partAssetBudgetBytes:8},{randomBytes:random(seed)},async p=>{parts.push(p);});
 return parts;
}
function memory(parts:readonly unknown[]){
 const files=new Map<string,string|Uint8Array>(parts.map((p,i)=>['file:///picked/'+i,JSON.stringify(p)]));
 const io:BackupFileIO={sizeOf:async u=>{const v=files.get(u);return v===undefined?null:typeof v==='string'?v.length:v.length;},
 readText:async u=>{const v=files.get(u);if(typeof v!=='string')throw Error('no synthetic text');return v;},
 readBytes:async u=>{const v=files.get(u);if(!(v instanceof Uint8Array))throw Error('no synthetic bytes');return v;},
 writeText:async(u,t)=>{files.set(u,t);},writeBytes:async(u,b)=>{files.set(u,new Uint8Array(b));},
 move:async(a,b)=>{const v=files.get(a);if(v===undefined)throw Error('missing');files.set(b,v);files.delete(a);},
 remove:async u=>{for(const k of files.keys())if(k===u||k.startsWith(u))files.delete(k);},makeDirectory:async()=>{}};
 return {io,files,uris:parts.map((_,i)=>'file:///picked/'+i)};
}
let old:CompleteBackupPart[],current:CompleteBackupPart[];
beforeAll(async()=>{old=await make('old synthetic',11,1);current=await make('new synthetic',21,103);},120_000);
jest.setTimeout(120_000);
it('legitimate current multipart read and streaming staging retain current records and exact bytes',async()=>{
 const direct=await readCompleteBackupParts([...current].reverse(),PASSPHRASE);expect(direct.state).toEqual(state('new synthetic'));expect([...direct.assets.get('photo-b')!]).toEqual(Array(8).fill(22));
 const fs=memory(current);const opened=await openSelectedBackup([...fs.uris].reverse(),PASSPHRASE,fs.io);if(opened.kind!=='parts')throw Error('expected parts');
 expect(opened.state).toEqual(state('new synthetic'));const staged=await opened.stageAssets('file:///stage/');
 expect([...fs.files.get(staged.assets.get('photo-b')!.uri) as Uint8Array]).toEqual(Array(8).fill(22));await staged.cleanup();expect([...fs.files.keys()].some(k=>k.startsWith('file:///stage/'))).toBe(false);
});
function splice(){return [current[0],{...old[1],backupId:current[1].backupId,partIndex:current[1].partIndex,partCount:current[1].partCount}];}
it('actual readCompleteBackupParts refuses old bytes relabeled into the current set',async()=>{
 await expect(readCompleteBackupParts(splice(),PASSPHRASE)).rejects.toThrow();
});
it('actual openSelectedBackup and stageAssets refuse the same relabeled old bytes',async()=>{
 const fs=memory(splice());await expect((async()=>{const opened=await openSelectedBackup(fs.uris,PASSPHRASE,fs.io);if(opened.kind!=='parts')throw Error('expected parts');return opened.stageAssets('file:///stage/');})()).rejects.toThrow();
 expect([...fs.files.keys()].some(k=>k.startsWith('file:///stage/'))).toBe(false);
});
it('actual preview-to-stage reread rejects replacement with unchanged wrapper headers',async()=>{
 const fs=memory(current);const opened=await openSelectedBackup(fs.uris,PASSPHRASE,fs.io);if(opened.kind!=='parts')throw Error('expected parts');expect(opened.state).toEqual(state('new synthetic'));
 fs.files.set(fs.uris[1],JSON.stringify(splice()[1]));await expect(opened.stageAssets('file:///stage/')).rejects.toMatchObject({code:'part_changed'});
 expect([...fs.files.keys()].some(k=>k.startsWith('file:///stage/'))).toBe(false);
});
