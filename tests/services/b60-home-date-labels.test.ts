import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { parsePlainDate } from '../../services/ProjectDateTime';
import * as chronology from '../../services/FieldUpdateChronology';
import { fieldUpdatesNewestFirst } from '../../services/PIEEvidenceFusion';
import type { ProjectUpdate } from '../../types';
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));

// Execute the committed App consumers; no app boot or transport is used.
function appFunction(name: string, dependencies: Record<string, unknown> = {}) {
 const source=fs.readFileSync(path.resolve(__dirname,'../../App.tsx'),'utf8');
 const tree=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const node=tree.statements.find((n): n is ts.FunctionDeclaration=>ts.isFunctionDeclaration(n)&&n.name?.text===name);
 if(!node) throw new Error(`Missing App consumer ${name}`);
 const code=ts.transpileModule(`const extracted = ${node.getText(tree)};`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
 return new Function(...Object.keys(dependencies),`${code}; return extracted;`)(...Object.values(dependencies));
}
const value=appFunction('updateDateValue',{parsePlainDate});
const display=appFunction('formatDisplayDate');
const label=appFunction('relativeUpdateDateLabel',{updateDateValue:value,formatDisplayDate:display});
const group=appFunction('updateTimelineGroup',{updateDateValue:value});
const card=appFunction('buildProjectCardPIEStatus',{...chronology,fieldUpdatesNewestFirst,relativeUpdateDateLabel:label,
 projectMatchesScope:(u:ProjectUpdate,p:string)=>u.projectName===p,findCurrentDAVEConfirmedBlocker:()=>null,updateHasSafetyConcern:()=>false,
 lifecycleStatusForUpdate:(u:ProjectUpdate)=>u.status,queuedStatusCopyForUpdate:()=>'',PIE_STATUS_COPY:{unavailableRetry:'Retry'}});
afterEach(()=>jest.useRealTimers());
it.each([
 ['2026-10-14T23:30:00-07:00','2026-10-14','today','Today'],
 ['2026-10-15T00:30:00-07:00','2026-10-14','yesterday','Yesterday'],
 ['2024-02-29T18:00:00-08:00','2024-02-29','today','Today'],
 ['2026-03-09T00:30:00-07:00','2026-03-08','yesterday','Yesterday'],
 ['2026-11-02T00:30:00-08:00','2026-11-01','yesterday','Yesterday'],
])('actual Home card/activity retain local calendar day at %s', (clock,day,expected,heading)=>{
 // Local calendar components make the committed suite portable; the evidence runner exercises Pacific and UTC.
 jest.useFakeTimers({now:new Date(clock.slice(0,19)).getTime()});
 const update={id:'evening',date:day,status:'sent',projectName:'Tower',photos:[],notes:'Evening work.'} as unknown as ProjectUpdate;
 expect(card(['Tower'],[update])).toBe(`Last update cloud synced ${expected}`);
 expect(group(day)).toBe(heading);
 expect(label(day)).toBe(expected);
});
it('Home keeps explicit timestamps on their actual local day around midnight',()=>{
 jest.useFakeTimers({now:new Date(2026,9,18,0,30).getTime()});
 const today=new Date(2026,9,18,0,1),yesterday=new Date(2026,9,17,23,59);
 expect(label(today.toISOString())).toBe('today');
 expect(label(yesterday.toISOString())).toBe('yesterday');
 const offset=-today.getTimezoneOffset(),sign=offset>=0?'+':'-',zone=`${sign}${String(Math.floor(Math.abs(offset)/60)).padStart(2,'0')}:${String(Math.abs(offset)%60).padStart(2,'0')}`;
 expect(label(`2026-10-18T00:01:00${zone}`)).toBe('today');
 expect(group(yesterday.toISOString())).toBe('Yesterday');
});
it.each(['2026-02-29','2026-02-30','2026-04-31'])('Home refuses normalized impossible calendar day %s',day=>{
 jest.useFakeTimers({now:Date.parse('2026-03-01T12:00:00-08:00')});
 expect(value(day)).toBeNull();expect(group(day)).toBe('Earlier');
});
