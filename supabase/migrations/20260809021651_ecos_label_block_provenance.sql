-- Preserve deterministic label-block provenance when an assured page region is
-- materialized as a searchable chunk. The indexed source remains raw; clients
-- normalize deterministic_label_block to OCR only when presenting evidence.

begin;

create or replace function public.ecos_enrich_shadow_chunk_provenance()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  source_region jsonb;
  source_region_id text := nullif(trim(new.metadata->>'sourceRegionId'), '');
begin
  if coalesce(
    nullif(trim(new.metadata->>'rawSource'), ''),
    nullif(trim(new.metadata->>'source'), ''),
    ''
  ) <> 'deterministic_label_block'
    and source_region_id is null then
    return new;
  end if;

  select region.value into source_region
  from public.ecos_hosted_index_pages page
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(page.final_page_data->'regions') = 'array'
      then page.final_page_data->'regions' else '[]'::jsonb end
  ) with ordinality region(value, ordinality)
  where page.job_id = new.job_id
    and page.page_number = new.page_number
    and (
      (source_region_id is not null and region.value->>'id' = source_region_id)
      or 'visual-' || region.ordinality::text = new.region_id
      or coalesce(nullif(trim(region.value->>'id'), ''), 'region-' || region.ordinality::text) = new.region_id
    )
  order by case when source_region_id is not null and region.value->>'id' = source_region_id
    then 0 else 1 end
  limit 1;

  if source_region is null then return new; end if;
  new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
    'rawSource', nullif(trim(source_region->>'source'), ''),
    'reconstructionMethod', source_region->'reconstructionMethod',
    'evidenceSources', source_region->'evidenceSources',
    'constituentEvidence', source_region->'constituentEvidence',
    'corroboratingEvidence', source_region->'corroboratingEvidence'
  ));
  return new;
end;
$$;

create or replace function public.ecos_enrich_hosted_chunk_provenance()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  source_region jsonb;
begin
  if coalesce(
    nullif(trim(new.metadata->>'rawSource'), ''),
    nullif(trim(new.metadata->>'source'), ''),
    ''
  ) <> 'deterministic_label_block'
    or nullif(trim(new.region_id), '') is null then
    return new;
  end if;

  select region.value into source_region
  from public.ecos_hosted_document_pages page
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(page.regions) = 'array' then page.regions else '[]'::jsonb end
  ) region(value)
  where page.organization_id = new.organization_id
    and page.document_id = new.document_id
    and page.page_number = new.page_number
    and region.value->>'id' = new.region_id
  limit 1;

  if source_region is null then return new; end if;
  new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
    'rawSource', nullif(trim(source_region->>'source'), ''),
    'reconstructionMethod', source_region->'reconstructionMethod',
    'evidenceSources', source_region->'evidenceSources',
    'constituentEvidence', source_region->'constituentEvidence',
    'corroboratingEvidence', source_region->'corroboratingEvidence'
  ));
  return new;
end;
$$;

create or replace function public.ecos_enrich_legacy_chunk_provenance()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  source_region jsonb;
begin
  if coalesce(
    nullif(trim(new.metadata->>'rawSource'), ''),
    nullif(trim(new.metadata->>'source'), ''),
    ''
  ) <> 'deterministic_label_block'
    or nullif(trim(new.region_id), '') is null then
    return new;
  end if;

  select region.value into source_region
  from public.ecos_document_pages page
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(page.regions) = 'array' then page.regions else '[]'::jsonb end
  ) region(value)
  where page.owner_id = new.owner_id
    and page.document_id = new.document_id
    and page.page_number = new.page_number
    and region.value->>'id' = new.region_id
  limit 1;

  if source_region is null then return new; end if;
  new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
    'rawSource', nullif(trim(source_region->>'source'), ''),
    'reconstructionMethod', source_region->'reconstructionMethod',
    'evidenceSources', source_region->'evidenceSources',
    'constituentEvidence', source_region->'constituentEvidence',
    'corroboratingEvidence', source_region->'corroboratingEvidence'
  ));
  return new;
end;
$$;

revoke all on function public.ecos_enrich_shadow_chunk_provenance() from public, anon, authenticated;
revoke all on function public.ecos_enrich_hosted_chunk_provenance() from public, anon, authenticated;
revoke all on function public.ecos_enrich_legacy_chunk_provenance() from public, anon, authenticated;

drop trigger if exists ecos_shadow_chunk_provenance on public.ecos_hosted_shadow_chunks;
create trigger ecos_shadow_chunk_provenance
before insert or update of metadata on public.ecos_hosted_shadow_chunks
for each row execute function public.ecos_enrich_shadow_chunk_provenance();

drop trigger if exists ecos_hosted_chunk_provenance on public.ecos_hosted_document_chunks;
create trigger ecos_hosted_chunk_provenance
before insert or update of metadata on public.ecos_hosted_document_chunks
for each row execute function public.ecos_enrich_hosted_chunk_provenance();

drop trigger if exists ecos_legacy_chunk_provenance on public.ecos_document_chunks;
create trigger ecos_legacy_chunk_provenance
before insert or update of metadata on public.ecos_document_chunks
for each row execute function public.ecos_enrich_legacy_chunk_provenance();

-- Backfill only affected deterministic chunks. Assigning metadata to itself is
-- intentional: it runs the exact same trigger used by all future writes.
update public.ecos_hosted_shadow_chunks
set metadata = metadata
where coalesce(nullif(trim(metadata->>'rawSource'), ''), metadata->>'source', '') = 'deterministic_label_block'
  and not (
    metadata ? 'rawSource' and metadata ? 'reconstructionMethod'
    and metadata ? 'evidenceSources' and metadata ? 'constituentEvidence'
    and metadata ? 'corroboratingEvidence'
  );

update public.ecos_hosted_document_chunks
set metadata = metadata
where coalesce(nullif(trim(metadata->>'rawSource'), ''), metadata->>'source', '') = 'deterministic_label_block'
  and not (
    metadata ? 'rawSource' and metadata ? 'reconstructionMethod'
    and metadata ? 'evidenceSources' and metadata ? 'constituentEvidence'
    and metadata ? 'corroboratingEvidence'
  );

update public.ecos_document_chunks
set metadata = metadata
where coalesce(nullif(trim(metadata->>'rawSource'), ''), metadata->>'source', '') = 'deterministic_label_block'
  and not (
    metadata ? 'rawSource' and metadata ? 'reconstructionMethod'
    and metadata ? 'evidenceSources' and metadata ? 'constituentEvidence'
    and metadata ? 'corroboratingEvidence'
  );

commit;
