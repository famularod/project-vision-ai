import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { DesktopSchedulePage } from '../../components/web-shell/desktop-schedule-page';
import { buildVitruviusGanttModel, type VitruviusGanttZoom } from '../../services/VitruviusGanttModel';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';
jest.mock('@expo/vector-icons',()=>({Ionicons:()=>null}));
jest.mock('@react-native-async-storage/async-storage',()=>({getItem:jest.fn(),setItem:jest.fn(),removeItem:jest.fn()}));
jest.mock('../../components/web-shell/desktop-auth-provider',()=>({useDesktopAuth:()=>({userEmail:'pm@example.com',snapshot:{projects:[{id:'project',name:'Lot 9'}]},createTask:jest.fn(),updateTask:jest.fn(),updateTasks:jest.fn(),refreshSnapshot:jest.fn()})}));
const task=(id:string,extra:Partial<DAVEWebScheduleItem>={}):DAVEWebScheduleItem=>({id,projectId:'project',taskName:id,projectName:'Lot 9',scheduleProjectName:'Lot 9',itemType:'Task',locationName:'Pad',startDate:'2026-07-20',finishDate:'2026-07-24',milestone:'',owner:'PM',contractor:'',percentComplete:50,status:'In Progress',priority:'Medium',notes:'',createdAt:'2026-07-20T12:00:00Z',updatedAt:'2026-07-20T12:00:00Z',cloudUpdatedAt:'2026-07-20T12:00:00Z',...extra});
const ordinary=task('ordinary'),future=task('future',{startDate:'2062-07-20',finishDate:'2062-07-24'});
function budget<T>(work:()=>T):T {let n=0;const real=Date.prototype.setUTCDate;const spy=jest.spyOn(Date.prototype,'setUTCDate').mockImplementation(function(this:Date,day:number){if(++n>400)throw new Error('mounted timeline exceeded 400 calendar operations');return real.call(this,day);});try{return work();}finally{spy.mockRestore();}}
function open(tasks:DAVEWebScheduleItem[]){const s=render(<DesktopSchedulePage tasks={tasks} projects={['Lot 9']} selectedProject="Lot 9"/>);budget(()=>fireEvent.press(s.getByText('Gantt')));return s;}
const headings=(s:ReturnType<typeof render>)=>s.getAllByTestId(/^gantt-column-header:/);
function bounded(s:ReturnType<typeof render>){expect(headings(s).length).toBeLessThanOrEqual(50);expect(s.getAllByTestId(/^gantt-grid-column:/)).toHaveLength(headings(s).length);}
for(const zoom of ['day','week','month'] as const)it('actual desktop '+zoom+' initially and after scrolling to 2062 has bounded nodes and correct future geometry/navigation',()=>{
 const tasks=[ordinary,future];const before=JSON.stringify(tasks);tasks.forEach(Object.freeze);Object.freeze(tasks);
 const s=open(tasks);budget(()=>fireEvent.press(s.getByText(zoom[0].toUpperCase()+zoom.slice(1))));bounded(s);
 const model=buildVitruviusGanttModel({items:tasks,zoom,columnWindow:{left:0,width:900}} as Parameters<typeof buildVitruviusGanttModel>[0]);const row=model.rows.find(r=>r.item.id==='future')!;
 const scroll=s.getByTestId('gantt-timeline-scroll');budget(()=>fireEvent(scroll,'layout',{nativeEvent:{layout:{width:900}}}));budget(()=>fireEvent.scroll(scroll,{nativeEvent:{contentOffset:{x:row.left}}}));bounded(s);
 expect(headings(s).some(n=>String(n.props.testID).includes('2062'))).toBe(true);expect(s.getByText(/Viewing .*2062/)).toBeTruthy();
 expect(StyleSheet.flatten(s.getByTestId('gantt-bar:future').props.style)).toMatchObject({left:row.left,width:row.width});
 fireEvent.press(s.getByLabelText('Open timeline item future'));expect(s.getByDisplayValue('future')).toBeTruthy();expect(s.getByDisplayValue('2062-07-20')).toBeTruthy();expect(JSON.stringify(tasks)).toBe(before);
});
it('zoom and resize retain the future calendar context and clamp end/invalid scroll or layout safely',()=>{
 const s=open([ordinary,future]);const scroll=s.getByTestId('gantt-timeline-scroll');
 budget(()=>fireEvent.scroll(scroll,{nativeEvent:{contentOffset:{x:1e20}}}));bounded(s);expect(s.getByText(/Viewing .*2062/)).toBeTruthy();
 for(const label of ['Day','Month','Week']){budget(()=>fireEvent.press(s.getByText(label)));bounded(s);expect(s.getByText(/Viewing .*2062/)).toBeTruthy();}
 for(const width of [400,1400,0,-1,NaN,Infinity]){budget(()=>fireEvent(scroll,'layout',{nativeEvent:{layout:{width}}}));bounded(s);expect(s.getByText(/Viewing .*2062/)).toBeTruthy();}
 for(const x of [NaN,Infinity,-1,0]){budget(()=>fireEvent.scroll(scroll,{nativeEvent:{contentOffset:{x}}}));bounded(s);}
 expect(headings(s)[0].props.testID).toContain('2026');
});
for(const year of ['0202','9999'])it('shows stored '+year+' dates with an explicit date check, no bar, and opens the same task',()=>{
 const stray=task('stray',{startDate:year+'-05-01',finishDate:year+'-05-04'});const s=open([ordinary,stray]);
 expect(s.queryByText('Set dates to place this item')).toBeNull();expect(s.getByText(new RegExp('Date check:.*'+year+'-05-01.*outside 2000 to 2100'))).toBeTruthy();expect(s.queryByTestId('gantt-bar:stray')).toBeNull();expect(s.queryByTestId('gantt-progress:stray')).toBeNull();expect(s.getByTestId('gantt-bar:ordinary')).toBeTruthy();
 fireEvent.press(s.getByLabelText('Open timeline item stray'));expect(s.getByDisplayValue('stray')).toBeTruthy();expect(s.getByDisplayValue(year+'-05-01')).toBeTruthy();expect(stray.startDate).toBe(year+'-05-01');
});
it('genuinely missing dates retain the missing-date instruction',()=>{const s=open([ordinary,task('missing',{startDate:'',finishDate:''})]);expect(s.getByText('Set dates to place this item')).toBeTruthy();});
