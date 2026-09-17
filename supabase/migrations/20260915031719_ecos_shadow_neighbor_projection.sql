begin;

-- Additive private projection. Reuse v28's exact source, state, role and input
-- checks; fill only UNUSED region slots with nearby original searchable text.
-- No stored source, assurance, coordinates or numeric value is rewritten.
create function public.ecos_load_hosted_shadow_bounded_page_evidence_pairs_v29(
  p_project_id text,
  p_document_ids text[],
  p_page_numbers integer[],
  p_query_terms text[],
  p_result_limit integer default 100,
  p_region_limit integer default 160
)
returns table(
  job_id uuid, document_id text, page_number integer, source_sha256 text,
  evidence_version text, final_page_data jsonb, assurance_result jsonb
)
language sql stable security invoker set search_path = ''
as $$
  select base.job_id, base.document_id, base.page_number, base.source_sha256,
    base.evidence_version,
    base.final_page_data || jsonb_build_object('regions', projected.regions),
    base.assurance_result
  from public.ecos_load_hosted_shadow_bounded_page_evidence_pairs_v28(
    p_project_id, p_document_ids, p_page_numbers, p_query_terms,
    p_result_limit, p_region_limit
  ) base
  join public.ecos_hosted_index_pages page
    on page.job_id = base.job_id and page.document_id = base.document_id
    and page.page_number = base.page_number and page.source_sha256 = base.source_sha256
    and page.state = 'assured' and page.unresolved_region_count = 0
    and page.assurance_result->>'accepted' = 'true'
  cross join lateral (
    with original as materialized (
      select value as region, ordinality as position
      from jsonb_array_elements(base.final_page_data->'regions') with ordinality
    ), all_regions as materialized (
      select value, ordinality
      from jsonb_array_elements(page.final_page_data->'regions') with ordinality
    ), identities as materialized (
      select value->>'id' as id, count(distinct value) as variants
      from all_regions group by value->>'id'
    ), raw_regions as materialized (
      select r.value as region, min(r.ordinality) as position
      from all_regions r join identities i on i.id = r.value->>'id' and i.variants = 1
      where jsonb_typeof(value->'id') = 'string'
        and length(value->>'id') between 1 and 500
        and coalesce(value->>'searchable', 'true') <> 'false'
        and jsonb_typeof(value->'x') = 'number'
        and jsonb_typeof(value->'y') = 'number'
        and jsonb_typeof(value->'width') = 'number'
        and jsonb_typeof(value->'height') = 'number'
        and jsonb_typeof(value->'confidence') = 'number'
        and length(coalesce(value->>'text', value->>'label', '')) between 2 and 1200
      group by r.value
    ), geometry as materialized (
      select region, position,
        (region->>'x')::numeric as x, (region->>'y')::numeric as y,
        (region->>'width')::numeric as w, (region->>'height')::numeric as h
      from raw_regions
      where (region->>'x')::numeric between 0 and 1
        and (region->>'y')::numeric between 0 and 1
        and (region->>'width')::numeric > 0 and (region->>'width')::numeric <= 0.25
        and (region->>'height')::numeric > 0 and (region->>'height')::numeric <= 0.05
        and (region->>'x')::numeric + (region->>'width')::numeric <= 1
        and (region->>'y')::numeric + (region->>'height')::numeric <= 1
        and (region->>'confidence')::numeric between 0.5 and 1
    ), anchors as materialized (
      select g.* from geometry g
      where exists (select 1 from original o where o.region = g.region)
        and exists (
          select 1 from unnest(p_query_terms) term
          where position(lower(term) in lower(coalesce(g.region->>'text', g.region->>'label', ''))) > 0
        )
    ), neighbors as (
      select g.region, g.position, min(
        greatest(0, a.x - g.x - g.w, g.x - a.x - a.w) +
        greatest(0, a.y - g.y - g.h, g.y - a.y - a.h) * 2
      ) as distance
      from geometry g join anchors a
        on g.region->>'source' = a.region->>'source'
        and greatest(0, a.x - g.x - g.w, g.x - a.x - a.w) <= 0.025
        and greatest(0, a.y - g.y - g.h, g.y - a.y - a.h) <= 0.012
        and abs((g.y + g.h/2) - (a.y + a.h/2)) <= 0.02
      where not exists (select 1 from original o where o.region = g.region)
        and not exists (
          select 1 from geometry included
          join original o on o.region = included.region
          where included.region->>'source' = g.region->>'source'
            and included.x < g.x + g.w and g.x < included.x + included.w
            and included.y < g.y + g.h and g.y < included.y + included.h
            and position(lower(coalesce(g.region->>'text', g.region->>'label', '')) in
              lower(coalesce(included.region->>'text', included.region->>'label', ''))) > 0
        )
      group by g.region, g.position
      order by distance, length(coalesce(g.region->>'text', g.region->>'label', '')) desc, g.position
      limit greatest(0, greatest(1, least(coalesce(p_region_limit,160),240)) - (select count(*) from original))
    ), combined as (
      select region, position, 0 as priority from original
      union all
      select region, position, 1 as priority from neighbors
    )
    select coalesce(jsonb_agg(region order by priority, position), '[]'::jsonb) as regions from combined
  ) projected;
$$;

revoke all on function public.ecos_load_hosted_shadow_bounded_page_evidence_pairs_v29(
  text, text[], integer[], text[], integer, integer
) from public, anon, authenticated;
grant execute on function public.ecos_load_hosted_shadow_bounded_page_evidence_pairs_v29(
  text, text[], integer[], text[], integer, integer
) to service_role;

commit;
