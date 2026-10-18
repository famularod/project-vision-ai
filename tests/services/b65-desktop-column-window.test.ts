import { buildVitruviusGanttModel, type VitruviusGanttZoom } from '../../services/VitruviusGanttModel';
import type { ScheduleItem } from '../../types';
export const task = (id: string, extra: Partial<ScheduleItem> = {}): ScheduleItem => ({ id, taskName:id, projectName:'Lot 9', scheduleProjectName:'Lot 9', locationName:'Pad', startDate:'2026-07-20',finishDate:'2026-07-24',milestone:'',owner:'PM',contractor:'',percentComplete:50,status:'In Progress',priority:'Medium',notes:'',createdAt:'2026-07-20T12:00:00Z',updatedAt:'2026-07-20T12:00:00Z',...extra });
const mixed=[task('ordinary',{baselineStartDate:'2026-07-19',baselineFinishDate:'2026-07-22'}),task('future',{startDate:'2062-07-20',finishDate:'2062-07-24'})];
const now=new Date('2026-07-21T12:00:00Z');
// Cast is deliberate: RED must exercise the real old model which ignores the proposed optional input.
const windowed=(items:readonly ScheduleItem[],zoom:VitruviusGanttZoom,left=0,width=900)=>buildVitruviusGanttModel({items,zoom,today:now,columnWindow:{left,width,overscan:256}} as Parameters<typeof buildVitruviusGanttModel>[0]);
export function steps<T>(limit:number, work:()=>T):T { let n=0;const real=Date.prototype.setUTCDate;const spy=jest.spyOn(Date.prototype,'setUTCDate').mockImplementation(function(this:Date,day:number){ if(++n>limit)throw new Error(`column materialization exceeded ${limit} calendar steps`);return real.call(this,day);});try{return work();}finally{spy.mockRestore();} }
for(const zoom of ['day','week','month'] as const)describe(zoom+' window',()=>{
 it('jumps directly to the viewport and preserves full row, baseline, progress, today and range geometry',()=>{
  const full=buildVitruviusGanttModel({items:mixed,zoom,today:now});
  const initial=steps(150,()=>windowed(mixed,zoom));expect(initial.columns.length).toBeLessThanOrEqual(40);expect(initial.columns.length).toBeGreaterThan(0);
  const {columns:ignored,...geometry}=full;expect(initial).toMatchObject(geometry);
  const futureLeft=full.rows.find(r=>r.item.id==='future')!.left!;
  const future=steps(150,()=>windowed(mixed,zoom,futureLeft,900));expect(future.columns.length).toBeLessThanOrEqual(40);expect(future.rows).toEqual(full.rows);
  expect(future.columns.some(c=>c.startDate.startsWith('2062'))).toBe(true);
  expect(future.columns).toEqual(full.columns.filter(c=>c.left+c.width>Math.max(0,futureLeft-256)&&c.left<futureLeft+900+256));
 });
 it('preserves 2000/2100 boundaries, summary children and milestone geometry without mutating saved items',()=>{
  const items=[task('phase',{isSummary:true,startDate:'',finishDate:''}),task('child',{parentItemId:'phase',startDate:'2000-01-01',finishDate:'2100-12-31'}),task('milestone',{startDate:'2100-12-31',finishDate:'2100-12-31',isMilestone:true,percentComplete:100})];
  const before=JSON.stringify(items);items.forEach(Object.freeze);Object.freeze(items);
  const full=buildVitruviusGanttModel({items,zoom,today:now});const view=steps(150,()=>windowed(items,zoom,full.timelineWidth-900));
  expect(view.rows).toEqual(full.rows);expect(view.rangeStart).toBe(full.rangeStart);expect(view.rangeFinish).toBe(full.rangeFinish);expect(view.timelineWidth).toBe(full.timelineWidth);expect(view.columns.length).toBeLessThanOrEqual(40);expect(view.rows.find(r=>r.item.id==='phase')?.datesDerivedFromChildren).toBe(true);expect(view.rows.find(r=>r.item.id==='milestone')?.width).toBeGreaterThan(0);expect(JSON.stringify(items)).toBe(before);
 });
});
it('handles zero-left and bad numeric window values without losing columns or exposing the full range',()=>{
 for(const [left,width] of [[0,900],[NaN,NaN],[Infinity,Infinity],[-100,-1],[1e20,900],[0,0]]){
  const m=steps(150,()=>windowed(mixed,'day',left,width));expect(m.columns.length).toBeGreaterThan(0);expect(m.columns.length).toBeLessThanOrEqual(50);expect(m.columns.every(c=>Number.isFinite(c.left)&&Number.isFinite(c.width)&&c.left>=0&&c.left+c.width<=m.timelineWidth)).toBe(true);
 }
});
