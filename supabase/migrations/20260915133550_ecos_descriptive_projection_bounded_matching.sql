begin;

-- Pure, bounded research projection. It returns original objects only; it
-- grants no authority and does not alter stored text, geometry or assurance.
create or replace function public.ecos_descriptive_region_projection(
  p_regions jsonb, p_terms text[], p_limit integer
) returns jsonb language sql immutable security invoker set search_path = '' as $$
  with limits as (
    select greatest(1,least(coalesce(p_limit,64),240)) as n
  ), terms as materialized (
    select distinct btrim(regexp_replace(lower(term),'[^a-z0-9]+',' ','g')) as term
    from unnest(p_terms) term
    where length(term) between 2 and 100
    limit 100
  ), raw as materialized (
    select value as r, ordinality as pos
    from jsonb_array_elements(p_regions) with ordinality
  ), distinct_objects as materialized (
    select r,min(pos) as pos from raw group by r
  ), identities as materialized (
    select r,pos,count(*) over(partition by r->>'id') as variants from distinct_objects
  ), valid_types as materialized (
    select distinct on (r->>'id') r,pos,
      btrim(regexp_replace(lower(coalesce(r->>'text',r->>'label','')),'[^a-z0-9]+',' ','g')) as txt
    from identities
    where variants=1 and jsonb_typeof(r->'id')='string' and length(r->>'id') between 1 and 500
      and coalesce(r->>'searchable','true') <> 'false'
      and length(coalesce(r->>'text',r->>'label','')) between 2 and 1200
      and jsonb_typeof(r->'x')='number' and jsonb_typeof(r->'y')='number'
      and jsonb_typeof(r->'width')='number' and jsonb_typeof(r->'height')='number'
      and jsonb_typeof(r->'confidence')='number'
    order by r->>'id',pos
  ), geometry as materialized (
    select *, (r->>'x')::numeric x,(r->>'y')::numeric y,
      (r->>'width')::numeric w,(r->>'height')::numeric h
    from valid_types
    where (r->>'x')::numeric between 0 and 1 and (r->>'y')::numeric between 0 and 1
      and (r->>'width')::numeric > 0 and (r->>'width')::numeric <= .3
      and (r->>'height')::numeric > 0 and (r->>'height')::numeric <= .06
      and (r->>'x')::numeric+(r->>'width')::numeric <= 1
      and (r->>'y')::numeric+(r->>'height')::numeric <= 1
      and (r->>'confidence')::numeric between .5 and 1
  ), scored as materialized (
    select g.*, (select count(*) from terms t
      where t.term<>'' and (position(' '||t.term||' ' in ' '||g.txt||' ')>0
        or position(' '||t.term||'s ' in ' '||g.txt||' ')>0)) as hits
    from geometry g
  ), matching as materialized (
    select * from scored where hits>0
    order by hits desc,least(8,cardinality(string_to_array(txt,' '))) desc,
      (r->>'confidence')::numeric desc,pos
    limit (select n*4 from limits)
  ), nonredundant as materialized (
    select g.* from matching g where not exists (
      select 1 from matching other
      where other.r->>'source'=g.r->>'source' and length(other.txt)>length(g.txt)
        and position(' '||g.txt||' ' in ' '||other.txt||' ')>0
        and other.x<g.x+g.w and g.x<other.x+other.w
        and other.y<g.y+g.h and g.y<other.y+other.h
    )
  ), anchors as materialized (
    select * from nonredundant
    order by hits desc,least(8,cardinality(string_to_array(txt,' '))) desc,
      (r->>'confidence')::numeric desc,pos
    limit (select greatest(1,n/2) from limits)
  ), neighbors as (
    select g.r,g.pos,min(greatest(0,a.x-g.x-g.w,g.x-a.x-a.w)+
      greatest(0,a.y-g.y-g.h,g.y-a.y-a.h)*2) as distance
    from geometry g join anchors a
      on g.r->>'source'=a.r->>'source'
      and greatest(0,a.x-g.x-g.w,g.x-a.x-a.w)<=.025
      and greatest(0,a.y-g.y-g.h,g.y-a.y-a.h)<=.03
      and abs((g.y+g.h/2)-(a.y+a.h/2))<=.04
    where not exists(select 1 from anchors selected where selected.r=g.r)
    group by g.r,g.pos
    order by least(8,cardinality(string_to_array(btrim(coalesce(g.r->>'text',g.r->>'label','')),' '))) desc,
      distance,g.pos
    limit (select n-(select count(*) from anchors) from limits)
  ), combined as (
    select r,pos from anchors union all select r,pos from neighbors
  ) select coalesce(jsonb_agg(r order by pos),'[]'::jsonb) from combined;
$$;
revoke all on function public.ecos_descriptive_region_projection(jsonb,text[],integer) from public,anon,authenticated;
grant execute on function public.ecos_descriptive_region_projection(jsonb,text[],integer) to service_role;

commit;
