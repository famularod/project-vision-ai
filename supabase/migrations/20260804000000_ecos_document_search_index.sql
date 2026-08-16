-- Shared, owner-scoped ECOS page/chunk index. Source files remain in protected
-- Storage; these tables contain only bounded searchable text and coordinates.
-- They are intentionally excluded from Realtime to avoid broadcasting large
-- page indexes to every signed-in device.

begin;

create table if not exists public.ecos_document_pages (
  owner_id uuid not null default auth.uid()
    references auth.users(id) on delete restrict,
  document_id text not null check (length(trim(document_id)) between 1 and 200),
  page_number integer not null check (page_number > 0 and page_number <= 10000),
  sheet_number text,
  title text,
  page_text text,
  regions jsonb not null default '[]'::jsonb check (jsonb_typeof(regions) = 'array'),
  extraction_method text,
  confidence numeric(6,5),
  source_sha256 text,
  indexed_at timestamptz not null default now(),
  primary key (owner_id, document_id, page_number),
  constraint ecos_document_pages_confidence_range check (
    confidence is null or (confidence >= 0 and confidence <= 1)
  ),
  constraint ecos_document_pages_source_sha check (
    source_sha256 is null or source_sha256 ~ '^[a-f0-9]{64}$'
  )
);

create table if not exists public.ecos_document_chunks (
  owner_id uuid not null default auth.uid()
    references auth.users(id) on delete restrict,
  document_id text not null,
  page_number integer not null check (page_number > 0 and page_number <= 10000),
  region_id text not null default '',
  chunk_index integer not null default 0 check (chunk_index >= 0),
  chunk_text text not null check (length(trim(chunk_text)) between 1 and 4000),
  sheet_number text,
  confidence numeric(6,5),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  search_vector tsvector generated always as (
    to_tsvector('simple', coalesce(sheet_number, '') || ' ' || chunk_text)
  ) stored,
  indexed_at timestamptz not null default now(),
  primary key (owner_id, document_id, page_number, region_id, chunk_index),
  constraint ecos_document_chunks_confidence_range check (
    confidence is null or (confidence >= 0 and confidence <= 1)
  )
);

create index if not exists ecos_document_pages_owner_document_idx
  on public.ecos_document_pages (owner_id, document_id, page_number);

create index if not exists ecos_document_chunks_owner_document_idx
  on public.ecos_document_chunks (owner_id, document_id, page_number);

create index if not exists ecos_document_chunks_search_idx
  on public.ecos_document_chunks using gin (search_vector);

alter table public.ecos_document_pages enable row level security;
alter table public.ecos_document_pages force row level security;
alter table public.ecos_document_chunks enable row level security;
alter table public.ecos_document_chunks force row level security;

revoke all on table public.ecos_document_pages from public, anon;
revoke all on table public.ecos_document_chunks from public, anon;
grant select, insert, update, delete on table public.ecos_document_pages to authenticated;
grant select, insert, update, delete on table public.ecos_document_chunks to authenticated;

drop policy if exists ecos_document_pages_owner_all on public.ecos_document_pages;
create policy ecos_document_pages_owner_all
  on public.ecos_document_pages
  for all to authenticated
  using (
    (select public.dave_is_app_owner())
    and owner_id = (select auth.uid())
  )
  with check (
    (select public.dave_is_app_owner())
    and owner_id = (select auth.uid())
    and exists (
      select 1 from public.reference_documents source
      where source.owner_id = (select auth.uid())
        and source.id::text = document_id
    )
  );

drop policy if exists ecos_document_chunks_owner_all on public.ecos_document_chunks;
create policy ecos_document_chunks_owner_all
  on public.ecos_document_chunks
  for all to authenticated
  using (
    (select public.dave_is_app_owner())
    and owner_id = (select auth.uid())
  )
  with check (
    (select public.dave_is_app_owner())
    and owner_id = (select auth.uid())
    and exists (
      select 1 from public.reference_documents source
      where source.owner_id = (select auth.uid())
        and source.id::text = document_id
    )
  );

create or replace function public.ecos_replace_document_index(
  p_document_id text,
  p_source_sha256 text,
  p_extraction_method text,
  p_pages jsonb
)
returns table(indexed_pages integer, indexed_chunks integer)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  current_owner uuid := auth.uid();
begin
  if current_owner is null or not public.dave_is_app_owner() then
    raise exception 'ECOS document indexing requires the authorized app owner';
  end if;
  if p_document_id is null or length(trim(p_document_id)) = 0 then
    raise exception 'ECOS document id is required';
  end if;
  if jsonb_typeof(coalesce(p_pages, '[]'::jsonb)) <> 'array' then
    raise exception 'ECOS pages must be a JSON array';
  end if;
  if not exists (
    select 1 from public.reference_documents source
    where source.owner_id = current_owner
      and source.id::text = p_document_id
  ) then
    raise exception 'The indexed source document is not available to this owner';
  end if;

  delete from public.ecos_document_chunks
  where owner_id = current_owner and document_id = p_document_id;
  delete from public.ecos_document_pages
  where owner_id = current_owner and document_id = p_document_id;

  insert into public.ecos_document_pages (
    owner_id, document_id, page_number, sheet_number, title, page_text,
    regions, extraction_method, confidence, source_sha256, indexed_at
  )
  select
    current_owner,
    p_document_id,
    (page.value->>'pageNumber')::integer,
    nullif(trim(page.value->>'sheetNumber'), ''),
    nullif(left(trim(page.value->>'title'), 500), ''),
    nullif(left(trim(page.value->>'text'), 100000), ''),
    coalesce(page.value->'regions', '[]'::jsonb),
    nullif(trim(p_extraction_method), ''),
    confidence.average_confidence,
    case when lower(coalesce(p_source_sha256, '')) ~ '^[a-f0-9]{64}$'
      then lower(p_source_sha256) else null end,
    now()
  from jsonb_array_elements(coalesce(p_pages, '[]'::jsonb)) page(value)
  left join lateral (
    select avg((region.value->>'confidence')::numeric) as average_confidence
    from jsonb_array_elements(coalesce(page.value->'regions', '[]'::jsonb)) region(value)
    where (region.value->>'confidence') ~ '^[0-9]+(?:\.[0-9]+)?$'
  ) confidence on true
  where (page.value->>'pageNumber') ~ '^[1-9][0-9]*$';

  insert into public.ecos_document_chunks (
    owner_id, document_id, page_number, region_id, chunk_index,
    chunk_text, sheet_number, confidence, metadata, indexed_at
  )
  select
    current_owner,
    p_document_id,
    (page.value->>'pageNumber')::integer,
    coalesce(nullif(trim(region.value->>'id'), ''), ''),
    greatest(region.ordinality::integer - 1, 0),
    left(trim(coalesce(nullif(region.value->>'text', ''), region.value->>'label')), 4000),
    nullif(trim(page.value->>'sheetNumber'), ''),
    case when (region.value->>'confidence') ~ '^[0-9]+(?:\.[0-9]+)?$'
      then (region.value->>'confidence')::numeric else null end,
    jsonb_build_object(
      'x', region.value->'x',
      'y', region.value->'y',
      'width', region.value->'width',
      'height', region.value->'height',
      'source', region.value->'source',
      'areaNames', coalesce(region.value->'areaNames', '[]'::jsonb)
    ),
    now()
  from jsonb_array_elements(coalesce(p_pages, '[]'::jsonb)) page(value)
  cross join lateral jsonb_array_elements(coalesce(page.value->'regions', '[]'::jsonb))
    with ordinality region(value, ordinality)
  where (page.value->>'pageNumber') ~ '^[1-9][0-9]*$'
    and length(trim(coalesce(nullif(region.value->>'text', ''), region.value->>'label'))) > 0;

  insert into public.ecos_document_chunks (
    owner_id, document_id, page_number, region_id, chunk_index,
    chunk_text, sheet_number, confidence, metadata, indexed_at
  )
  select
    current_owner,
    p_document_id,
    (page.value->>'pageNumber')::integer,
    '',
    0,
    left(trim(page.value->>'text'), 4000),
    nullif(trim(page.value->>'sheetNumber'), ''),
    null,
    jsonb_build_object('fallback', true),
    now()
  from jsonb_array_elements(coalesce(p_pages, '[]'::jsonb)) page(value)
  where (page.value->>'pageNumber') ~ '^[1-9][0-9]*$'
    and jsonb_array_length(coalesce(page.value->'regions', '[]'::jsonb)) = 0
    and length(trim(page.value->>'text')) > 0;

  return query
    select
      (select count(*)::integer from public.ecos_document_pages
       where owner_id = current_owner and document_id = p_document_id),
      (select count(*)::integer from public.ecos_document_chunks
       where owner_id = current_owner and document_id = p_document_id);
end
$$;

create or replace function public.ecos_search_document_chunks(
  p_search_query text,
  p_document_ids text[] default null,
  p_result_limit integer default 12
)
returns table(
  document_id text,
  page_number integer,
  region_id text,
  chunk_text text,
  sheet_number text,
  confidence numeric,
  metadata jsonb,
  rank real
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    chunk.document_id,
    chunk.page_number,
    chunk.region_id,
    chunk.chunk_text,
    chunk.sheet_number,
    chunk.confidence,
    chunk.metadata,
    ts_rank_cd(
      chunk.search_vector,
      websearch_to_tsquery('simple', coalesce(p_search_query, ''))
    ) as rank
  from public.ecos_document_chunks chunk
  where chunk.owner_id = auth.uid()
    and public.dave_is_app_owner()
    and length(trim(coalesce(p_search_query, ''))) > 0
    and (p_document_ids is null or chunk.document_id = any(p_document_ids))
    and chunk.search_vector @@ websearch_to_tsquery('simple', p_search_query)
  order by rank desc, chunk.confidence desc nulls last, chunk.page_number
  limit greatest(1, least(coalesce(p_result_limit, 12), 50));
$$;

revoke all on function public.ecos_replace_document_index(text, text, text, jsonb) from public, anon;
revoke all on function public.ecos_search_document_chunks(text, text[], integer) from public, anon;
grant execute on function public.ecos_replace_document_index(text, text, text, jsonb) to authenticated;
grant execute on function public.ecos_search_document_chunks(text, text[], integer) to authenticated;

create or replace function public.ecos_delete_document_index()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.ecos_document_chunks
  where owner_id = old.owner_id and document_id = old.id::text;
  delete from public.ecos_document_pages
  where owner_id = old.owner_id and document_id = old.id::text;
  return old;
end
$$;

revoke all on function public.ecos_delete_document_index() from public, anon, authenticated;

drop trigger if exists ecos_reference_document_index_cleanup on public.reference_documents;
create trigger ecos_reference_document_index_cleanup
after delete on public.reference_documents
for each row execute function public.ecos_delete_document_index();

commit;
