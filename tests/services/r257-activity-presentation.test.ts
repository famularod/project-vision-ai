import {recentProjectItemActivity} from '../../services/ProjectItemActivityPresentation';
import type {ProjectItemActivity} from '../../types';
const note=(id:string,createdAt:string)=>Object.freeze({id,createdAt,message:`Authored ${id} $& Élodie`,author:'PM'}) as ProjectItemActivity;
it('stable equal timestamps and malformed dates retain source words and references without mutation',()=>{
 const a=note('a','2026-10-17T10:00:00Z'),b=note('b','2026-10-17T03:00:00-07:00'),c=note('c','invalid');const input=Object.freeze([c,a,b]);const result=recentProjectItemActivity(input);expect(result).toEqual([a,b,c]);expect(result[0]).toBe(a);expect(input).toEqual([c,a,b]);
});
it('all unknown dates stay in stored order, and null/empty activity is harmless',()=>{
 const input=[note('a',''),note('b','not a timestamp'),note('c','unknown'),note('d','bad')];expect(recentProjectItemActivity(input)).toEqual(input.slice(0,3));expect(recentProjectItemActivity(null)).toEqual([]);expect(recentProjectItemActivity([])).toEqual([]);
});
