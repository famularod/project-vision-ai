import {fireEvent,render} from '@testing-library/react-native';
import {StyleSheet} from 'react-native';
import {MobileSchedulePlanning} from '../../components/mobile-schedule-planning';
import {AppShellLayoutProvider,appShellLayoutForWidth} from '../../components/app-shell-layout';
import type {ScheduleItem} from '../../types';
jest.mock('@expo/vector-icons',()=>({Ionicons:()=>null}));
const task=(id:string,startDate:string,finishDate:string,extra:Partial<ScheduleItem>={})=>({id,projectName:'Alpha',scheduleProjectName:'Alpha',locationName:'Court',taskName:id,startDate,finishDate,owner:'Dana',contractor:'',milestone:'',notes:'',nextAction:'',status:'In Progress',percentComplete:40,priority:'Medium',createdAt:'2026-10-17T12:00:00.000Z',...extra}) as ScheduleItem;
const specs=[['normal','2026-10-17','2026-10-20',true],['start-only','2026-10-17','',true],['finish-only','','2026-10-20',true],['0202','0202-05-01','0202-05-04',false],['outside-start','0202-05-01','',false],['outside-finish','','0202-05-04',false],['9999','9999-05-01','9999-05-04',false],['missing','','',false],['milestone','2026-10-18','2026-10-18',true],['outside-milestone','0202-05-01','0202-05-01',false]] as const;
it.each([390,1024])('actual native Timeline at width%s never draws an unplaced bar and keeps task navigation',width=>{
 const items=Object.freeze(specs.map(([id,s,f])=>Object.freeze(task(id,s,f,id.includes('milestone')?{isMilestone:true}:{}))));const before=JSON.stringify(items);const open=jest.fn();
 const view=render(<AppShellLayoutProvider layout={appShellLayoutForWidth(width)}><MobileSchedulePlanning items={items} view="Timeline" onOpenTask={open}/></AppShellLayoutProvider>);
 const observations=specs.map(([id,,,placed])=>{const row=view.getByLabelText(`Open timeline task ${id}, 40% complete`);const bars=row.findAll(n=>{const s=StyleSheet.flatten(n.props.style);return typeof s?.left==='string'&&typeof s?.width==='string';});fireEvent.press(row);expect(open.mock.calls.at(-1)![0].id).toBe(id);return {id,placed,bars:bars.length};});
 console.log('B64_TIMELINE '+JSON.stringify({width,observations}));
 expect(observations.filter(o=>!o.placed).map(o=>({id:o.id,bars:o.bars}))).toEqual(observations.filter(o=>!o.placed).map(o=>({id:o.id,bars:0})));
 expect(observations.filter(o=>o.placed).every(o=>o.bars>0)).toBe(true);
 expect(view.getAllByText(/Check.*date/i).length).toBeGreaterThan(0);expect(view.getByText('Dates needed')).toBeTruthy();expect(JSON.stringify(items)).toBe(before);
});
