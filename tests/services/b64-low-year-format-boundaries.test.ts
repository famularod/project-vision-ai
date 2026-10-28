import {formatCalendarDate,parseFlexibleDate} from '../../utils/date';
import {nativeScheduleItemsAsBeforeLowYearFormatting} from '../../services/ReportScheduleProjection';
import type {ScheduleItem} from '../../types';
it.each(['0100','0202','0999','2000','2100'])('explicit %s dates round-trip the calendar day',year=>{
 const date=parseFlexibleDate(`${year}-05-01`);expect(date).not.toBeNull();expect(formatCalendarDate(date!)).toBe(`05/01/${year}`);
 expect(parseFlexibleDate(formatCalendarDate(date!))!.getTime()).toBe(date!.getTime());
});
it('two- and three-digit reader policy is retained',()=>{
 expect(formatCalendarDate(parseFlexibleDate('5/1/26')!)).toBe('05/01/2026');
 expect(parseFlexibleDate('5/1/202')).toBeNull();
});
it('native history projection preserves normal identity, arbitrary text, invalid days and source bytes',()=>{
 const row=(id:string,startDate:string)=>Object.freeze({id,startDate,finishDate:startDate}) as ScheduleItem;
 const normal=Object.freeze([row('normal','05/01/2026'),row('two','5/1/26'),row('three','05/01/202'),row('invalid','02/30/0202'),row('small','05/01/0099')]);
 expect(nativeScheduleItemsAsBeforeLowYearFormatting(normal)).toBe(normal);
 const source=Object.freeze([...normal,row('low','05/01/0202')]);const before=JSON.stringify(source);const history=nativeScheduleItemsAsBeforeLowYearFormatting(source);
 expect(history.at(-1)!.startDate).toBe('05/01/202');expect(history.slice(0,-1)).toEqual(normal);
 expect(history[0]).toBe(normal[0]);expect(JSON.stringify(source)).toBe(before);
});
