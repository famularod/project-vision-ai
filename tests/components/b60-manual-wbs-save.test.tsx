import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { DesktopSchedulePage } from '../../components/web-shell/desktop-schedule-page';
import { createDAVEWebSupabaseGateway, daveWebSupabaseGateway } from '../../services/DAVEWebSupabaseClient';
import { loadDAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import type { DAVEWebScheduleItem } from '../../services/DAVEWebTaskEditing';
jest.mock('../../services/DAVEWebSupabaseClient',()=>{const actual=jest.requireActual('../../services/DAVEWebSupabaseClient');return {...actual,daveWebSupabaseGateway:{...actual.daveWebSupabaseGateway,loadAuthorizedRows:jest.fn()}};});
jest.mock('@expo/vector-icons',()=>({Ionicons:()=>null}));
jest.mock('@react-native-async-storage/async-storage',()=>({getItem:jest.fn(),setItem:jest.fn(),removeItem:jest.fn()}));
const PROJECT='Synthetic Tower';const PROJECT_ID='607c7eed-5dea-4a5a-8b52-0f165c71c4b5';
const mockCreate=jest.fn(),mockUpdate=jest.fn();
let mockRows:DAVEWebScheduleItem[]=[];
jest.mock('../../components/web-shell/desktop-auth-provider',()=>({useDesktopAuth:()=>({userEmail:'synthetic@example.invalid',
 snapshot:{projects:[{id:PROJECT_ID,name:PROJECT}],scheduleItems:mockRows},createTask:mockCreate,updateTask:mockUpdate,refreshSnapshot:jest.fn()})}));
function task(id:string,wbsCode:string,extra:Partial<DAVEWebScheduleItem>={}):DAVEWebScheduleItem {return {
 id,wbsCode,projectId:PROJECT_ID,projectName:PROJECT,taskName:id,locationName:'Roof',startDate:'10/01/2026',finishDate:'10/02/2026',
 milestone:'',owner:'Dana',contractor:'',percentComplete:0,priority:'Medium',status:'Not Started',notes:'',createdAt:'2026-10-01T12:00:00Z',cloudUpdatedAt:'2026-10-01T12:00:00Z',...extra};}
let persisted:Record<string,unknown>[]=[];
beforeEach(()=>{
 persisted=[];mockRows=[];mockCreate.mockReset();mockUpdate.mockReset();
 const query:Record<string,any>={};for(const method of ['select','eq'])query[method]=()=>query;
 query.insert=(row:Record<string,unknown>)=>{persisted.push(JSON.parse(JSON.stringify(row)));return query;};
 query.single=async()=>({data:{updated_at:'2026-10-17T22:00:00Z'},error:null});
 const client={auth:{getUser:async()=>({data:{user:{id:'synthetic-owner'}},error:null}),getSession:async()=>({data:{session:null},error:null})},
 rpc:async()=>({data:true,error:null}),from:()=>query};
 const gateway=createDAVEWebSupabaseGateway(client as never);
 jest.mocked(daveWebSupabaseGateway.loadAuthorizedRows).mockImplementation(async()=>({projects:[{id:PROJECT_ID,name:PROJECT}],scheduleItems:persisted,projectUpdates:[],referenceDocuments:[],syncTombstones:[]} as never));
 mockCreate.mockImplementation((item:DAVEWebScheduleItem)=>gateway.createAuthorizedScheduleItem(item));
});
const page=()=> <DesktopSchedulePage tasks={mockRows} projects={[PROJECT]} selectedProject={PROJECT}/>;
function fill(screen:ReturnType<typeof render>,name='Hand made task') {fireEvent.press(screen.getByText('Add Task'));fireEvent.changeText(screen.getByLabelText('Name'),name);}
async function save(screen:ReturnType<typeof render>) {fireEvent.press(screen.getByText('Create Task'));await waitFor(()=>expect(persisted).toHaveLength(1));return persisted[0].item_data as DAVEWebScheduleItem;}
it('actual builder persists a fresh code after seven siblings already include WBS8',async()=>{
 mockRows=[...Array.from({length:6},(_,i)=>task(`row-${i}`,String(i+1))),task('existing-eight','8')];const before=JSON.stringify(mockRows);
 const screen=render(page());fill(screen);const written=await save(screen);
 expect(written.wbsCode).toBe('9');expect(written.projectId).toBe(PROJECT_ID);expect(written.parentItemId).toBeNull();
 expect(new Set([...mockRows.map(r=>r.wbsCode),written.wbsCode]).size).toBe(8);expect(JSON.stringify(mockRows)).toBe(before);
 expect(persisted[0]).toMatchObject({id:written.id,owner_id:'synthetic-owner',project_id:PROJECT_ID,item_data:{taskName:'Hand made task',wbsCode:'9'}});
 const reloaded=await loadDAVEWebReadOnlySnapshot();expect(reloaded.scheduleItems).toEqual([expect.objectContaining({id:written.id,projectId:PROJECT_ID,wbsCode:'9',taskName:'Hand made task'})]);
});
it('a received task while the form is open cannot reuse its generated WBS at durable save',async()=>{
 mockRows=[task('first','1')];const screen=render(page());fill(screen);expect(screen.getByLabelText('WBS').props.value).toBe('2');
 mockRows=[...mockRows,task('arrived','2')];screen.rerender(page());const written=await save(screen);expect(written.wbsCode).toBe('3');
});
it('an explicitly entered occupied WBS is refused before insert and remains available for correction',async()=>{
 mockRows=[task('first','8')];const screen=render(page());fill(screen);fireEvent.changeText(screen.getByLabelText('WBS'),'8');
 fireEvent.press(screen.getByText('Create Task'));await waitFor(()=>expect(screen.getByText(/WBS 8 is already used/)).toBeTruthy());
 expect(persisted).toHaveLength(0);expect(mockCreate).not.toHaveBeenCalled();expect(screen.getByLabelText('WBS').props.value).toBe('8');
 fireEvent.changeText(screen.getByLabelText('WBS'),'ROOF-A');const written=await save(screen);expect(written.wbsCode).toBe('ROOF-A');
});
it('unchanged existing duplicate/custom codes and task identity survive an ordinary edit',async()=>{
 mockRows=[task('first','8'),task('second','8')];const screen=render(page());fireEvent.press(screen.getByLabelText('Edit second'));
 fireEvent.changeText(screen.getByLabelText('Name'),'Revised second');fireEvent.press(screen.getByText('Save Changes'));
 await waitFor(()=>expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({id:'second',wbsCode:'8',projectId:PROJECT_ID,taskName:'Revised second'})));
 expect(mockCreate).not.toHaveBeenCalled();
});
it('child allocation stays under its actual parent and ignores another project codes',async()=>{
 mockRows=[task('phase','2',{isSummary:true}),task('child','2.2',{parentItemId:'phase'}),task('foreign','99',{projectName:'Other Tower'})];
 const screen=render(page());fireEvent.press(screen.getByText('Add Task'));fireEvent(screen.getByLabelText('Parent phase'),'change',{target:{value:'phase'}});fireEvent.changeText(screen.getByLabelText('Name'),'Second child');
 const written=await save(screen);expect(written).toMatchObject({wbsCode:'2.3',parentItemId:'phase',projectName:PROJECT,projectId:PROJECT_ID});
});
