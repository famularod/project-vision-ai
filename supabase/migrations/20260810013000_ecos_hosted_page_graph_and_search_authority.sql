-- Bind every verified ECOS receipt to the exact server-owned page graph and
-- preserve one exact hosted job/organization identity through primary search.

begin;

create extension if not exists pgcrypto;

create or replace function public.ecos_canonical_json_text(p_value jsonb)
returns text
language plpgsql
immutable
strict
security invoker
set search_path = public, pg_catalog, pg_temp
as $$
declare
  value_type text := jsonb_typeof(p_value);
  result text;
  numeric_text text;
begin
  if value_type = 'object' then
    select '{' || coalesce(string_agg(
      to_json(member.key)::text || ':' ||
        public.ecos_canonical_json_text(member.value),
      ',' order by member.key
    ), '') || '}'
    into result
    from jsonb_each(p_value) member;
    return result;
  end if;
  if value_type = 'array' then
    select '[' || coalesce(string_agg(
      public.ecos_canonical_json_text(item.value),
      ',' order by item.ordinality
    ), '') || ']'
    into result
    from jsonb_array_elements(p_value) with ordinality item(value, ordinality);
    return result;
  end if;
  if value_type = 'number' then
    numeric_text := p_value::text;
    if position('.' in numeric_text) > 0 then
      numeric_text := regexp_replace(numeric_text, '0+$', '');
      numeric_text := regexp_replace(numeric_text, '\.$', '');
    end if;
    if numeric_text in ('-0', '') then numeric_text := '0'; end if;
    return numeric_text;
  end if;
  return p_value::text;
end;
$$;

revoke all on function public.ecos_canonical_json_text(jsonb)
  from public, anon, authenticated;
grant execute on function public.ecos_canonical_json_text(jsonb)
  to service_role;

create or replace function public.ecos_page_graph_sha256(p_pages jsonb)
returns text
language sql
immutable
strict
security invoker
set search_path = public, extensions, pg_temp
as $$
  select case when jsonb_typeof(p_pages) = 'array' then encode(
    digest(
      convert_to(public.ecos_canonical_json_text(p_pages), 'UTF8'),
      'sha256'
    ),
    'hex'
  ) else null end;
$$;

revoke all on function public.ecos_page_graph_sha256(jsonb)
  from public, anon, authenticated;
grant execute on function public.ecos_page_graph_sha256(jsonb)
  to service_role;

-- Shared canonicalization vector. The matching TypeScript regression uses the
-- same value so a formatting drift aborts migration before receipts can mint.
do $ecos_page_graph_golden$
declare
  golden_pages jsonb := '[{"pageNumber":1,"regions":[{"height":0.05,"id":"r-1","text":"Guardrail required","width":0.4,"x":0.1,"y":0.2}],"text":"Guardrail required"}]'::jsonb;
begin
  if public.ecos_page_graph_sha256(golden_pages) <>
      '545b03371fb739e594b59a5edeb006654b17e3897ef443cdf36063e6626f85e7' then
    raise exception 'ecos_page_graph_canonicalization_golden_mismatch';
  end if;
end;
$ecos_page_graph_golden$;

create or replace function public.ecos_build_hosted_page_graph(p_job_id uuid)
returns jsonb
language plpgsql
stable
strict
security definer
set search_path = public, pg_temp
as $$
declare
  selected_job public.ecos_hosted_index_jobs%rowtype;
  authoritative_pages jsonb;
begin
  select job.* into selected_job
  from public.ecos_hosted_index_jobs job
  where job.id = p_job_id;
  if not found
      or selected_job.state <> 'ready'
      or selected_job.committed_evidence_version <> 'ecos-hosted-evidence/1.3'
      or not public.ecos_hosted_job_matches_reference(selected_job.id, false) then
    return null;
  end if;

  if selected_job.mode = 'live' then
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'pageNumber', page.page_number,
      'sheetNumber', page.sheet_number,
      'sheetTitle', page.sheet_title,
      'sheetMappingStatus', page.sheet_mapping_status,
      'sheetMappingConfidence', checkpoint.final_page_data->'sheetMappingConfidence',
      'sheetMappingSource', page.sheet_mapping_source,
      'sheetMappingEvidence', page.sheet_mapping_evidence,
      'documentStructuralIdentity', page.document_structural_identity,
      'assurance', page.assurance_result,
      'sheetMappingCandidates', coalesce(
        checkpoint.final_page_data->'sheetMappingCandidates',
        '[]'::jsonb
      ),
      'visualCoverage', checkpoint.final_page_data->'visualCoverage',
      'title', coalesce(page.sheet_title, checkpoint.final_page_data->>'title'),
      'text', page.page_text,
      'regions', page.regions
    )) order by page.page_number)
    into authoritative_pages
    from public.ecos_hosted_document_pages page
    join public.ecos_hosted_index_pages checkpoint
      on checkpoint.job_id = selected_job.id
     and checkpoint.organization_id = selected_job.organization_id
     and checkpoint.project_id = selected_job.project_id
     and checkpoint.document_id = page.document_id
     and checkpoint.source_sha256 = selected_job.source_sha256
     and checkpoint.page_number = page.page_number
     and checkpoint.state = 'assured'
     and checkpoint.unresolved_region_count = 0
     and checkpoint.assurance_result->>'accepted' = 'true'
     and checkpoint.assurance_result->>'evidenceVersion' =
       selected_job.committed_evidence_version
    where page.organization_id = selected_job.organization_id
      and page.project_id = selected_job.project_id
      and page.document_id = selected_job.document_id
      and page.source_sha256 = selected_job.source_sha256
      and page.evidence_version = selected_job.committed_evidence_version
      and page.assurance_result->>'accepted' = 'true'
      and page.assurance_result->>'evidenceVersion' =
        selected_job.committed_evidence_version;
  else
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'pageNumber', page.page_number,
      'sheetNumber', nullif(provenance.value->>'sheetNumber', ''),
      'sheetTitle', coalesce(
        nullif(page.final_page_data->>'sheetTitle', ''),
        nullif(page.final_page_data->>'title', '')
      ),
      'sheetMappingStatus', coalesce(
        nullif(provenance.value->>'sheetMappingStatus', ''),
        'unverified'
      ),
      'sheetMappingConfidence', page.final_page_data->'sheetMappingConfidence',
      'sheetMappingSource', nullif(provenance.value->>'sheetMappingSource', ''),
      'sheetMappingEvidence', coalesce(
        provenance.value->'sheetMappingEvidence',
        '[]'::jsonb
      ),
      'documentStructuralIdentity', case
        when jsonb_typeof(provenance.value->'documentStructuralIdentity') = 'object'
          then provenance.value->'documentStructuralIdentity'
        else null
      end,
      'assurance', page.assurance_result,
      'sheetMappingCandidates', coalesce(
        page.final_page_data->'sheetMappingCandidates',
        '[]'::jsonb
      ),
      'visualCoverage', page.final_page_data->'visualCoverage',
      'title', coalesce(
        nullif(page.final_page_data->>'title', ''),
        nullif(page.final_page_data->>'sheetTitle', '')
      ),
      'text', coalesce(
        nullif(page.final_page_data->>'text', ''),
        nullif(page.final_page_data->>'pageText', '')
      ),
      'regions', case when jsonb_typeof(page.final_page_data->'regions') = 'array'
        then page.final_page_data->'regions' else '[]'::jsonb end
    )) order by page.page_number)
    into authoritative_pages
    from public.ecos_hosted_index_pages page
    cross join lateral (
      select public.ecos_sheet_provenance_payload(
        page.final_page_data,
        page.assurance_result,
        true
      ) as value
    ) provenance
    where page.job_id = selected_job.id
      and page.organization_id = selected_job.organization_id
      and page.project_id = selected_job.project_id
      and page.document_id = selected_job.document_id
      and page.source_sha256 = selected_job.source_sha256
      and page.state = 'assured'
      and page.unresolved_region_count = 0
      and page.assurance_result->>'accepted' = 'true'
      and page.assurance_result->>'evidenceVersion' =
        selected_job.committed_evidence_version
      and page.final_page_data->>'sourceSha256' = selected_job.source_sha256
      and provenance.value is not null;
  end if;

  if jsonb_typeof(authoritative_pages) <> 'array'
      or jsonb_array_length(authoritative_pages) <> selected_job.source_page_count
      or exists (
        select 1
        from jsonb_array_elements(authoritative_pages) page(value)
        where coalesce(page.value->>'pageNumber', '') !~ '^[1-9][0-9]*$'
      ) then
    return null;
  end if;
  return authoritative_pages;
end;
$$;

revoke all on function public.ecos_build_hosted_page_graph(uuid)
  from public, anon, authenticated;
grant execute on function public.ecos_build_hosted_page_graph(uuid)
  to service_role;

create or replace function public.ecos_reference_document_commit_identity(
  p_document_data jsonb
)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'name', coalesce(p_document_data, '{}'::jsonb)->'name',
    'originalFileName', coalesce(p_document_data, '{}'::jsonb)->'originalFileName',
    'category', coalesce(p_document_data, '{}'::jsonb)->'category',
    'projectId', coalesce(p_document_data, '{}'::jsonb)->'projectId',
    'organizationId', coalesce(p_document_data, '{}'::jsonb)->'organizationId',
    'contentSha256', coalesce(p_document_data, '{}'::jsonb)->'contentSha256',
    'webFileFingerprint', coalesce(p_document_data, '{}'::jsonb)->'webFileFingerprint',
    'indexedContentSha256', coalesce(p_document_data, '{}'::jsonb)->'indexedContentSha256',
    'drawingRevision', coalesce(p_document_data, '{}'::jsonb)->'drawingRevision',
    'drawingNumber', coalesce(p_document_data, '{}'::jsonb)->'drawingNumber',
    'drawingDiscipline', coalesce(p_document_data, '{}'::jsonb)->'drawingDiscipline',
    'drawingIssuedAt', coalesce(p_document_data, '{}'::jsonb)->'drawingIssuedAt',
    'webVersionGroupId', coalesce(p_document_data, '{}'::jsonb)->'webVersionGroupId',
    'sourcePageCount', coalesce(p_document_data, '{}'::jsonb)->'sourcePageCount',
    'isCurrent', coalesce(p_document_data, '{}'::jsonb)->'isCurrent',
    'drawingStatus', coalesce(p_document_data, '{}'::jsonb)->'drawingStatus',
    'sourceProvider', coalesce(p_document_data, '{}'::jsonb)->'sourceProvider',
    'storagePath', coalesce(p_document_data, '{}'::jsonb)->'storagePath',
    'externalSource', coalesce(p_document_data, '{}'::jsonb)->'externalSource',
    'extractedPages', coalesce(p_document_data, '{}'::jsonb)->'extractedPages'
  );
$$;

revoke all on function public.ecos_reference_document_commit_identity(jsonb)
  from public, anon, authenticated;
grant execute on function public.ecos_reference_document_commit_identity(jsonb)
  to service_role;

create or replace function public.ecos_guard_reference_document_authority_keys()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  commit_keys constant text[] := array[
    'ecosVerifiedIndexCommitVersion',
    'ecosVerifiedIndexCommittedAt',
    'ecosVerifiedIndexCommittedSha256',
    'ecosVerifiedIndexCommittedPageCount',
    'ecosVerifiedIndexPageGraphSha256'
  ];
  hosted_status_keys constant text[] := array[
    'ecosHostedIndexStatus',
    'ecosHostedIndexProgressPercent',
    'ecosHostedIndexCustomerMessage',
    'ecosHostedIndexLimitationCount',
    'ecosHostedIndexSupportReference',
    'ecosHostedIndexEvidenceVersion',
    'ecosHostedIndexUpdatedAt'
  ];
  identity_unchanged boolean := false;
  trusted_current_activation boolean := false;
begin
  new.document_data := coalesce(new.document_data, '{}'::jsonb) - hosted_status_keys;

  if current_setting('app.ecos_authority_purge', true) = 'allowed' then
    new.document_data := new.document_data - commit_keys;
    return new;
  end if;

  -- A custom transaction setting is not authority: authenticated database
  -- sessions can set custom GUCs. Only the server role may mint or replace a
  -- receipt; ordinary updates can preserve OLD only after exact revalidation.
  if public.ecos_request_jwt_role() = 'service_role' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    identity_unchanged :=
      old.owner_id is not distinct from new.owner_id
      and old.id is not distinct from new.id
      and old.name is not distinct from new.name
      and old.category is not distinct from new.category
      and public.ecos_reference_document_commit_identity(old.document_data)
        is not distinct from
          public.ecos_reference_document_commit_identity(new.document_data);
    trusted_current_activation :=
      not identity_unchanged
      and current_setting('app.ecos_current_activation', true) = 'allowed'
      and old.document_data->>'isCurrent' is distinct from
        new.document_data->>'isCurrent'
      and public.ecos_reference_document_commit_identity(old.document_data) - 'isCurrent'
        is not distinct from
          public.ecos_reference_document_commit_identity(new.document_data) - 'isCurrent'
      and old.document_data->>'ecosVerifiedIndexCommitVersion' =
        'ecos-verified-index-commit/1.0'
      and coalesce(old.document_data->>'ecosVerifiedIndexCommittedSha256', '') ~
        '^[a-f0-9]{64}$'
      and coalesce(old.document_data->>'ecosVerifiedIndexCommittedPageCount', '') ~
        '^[1-9][0-9]*$'
      and coalesce(old.document_data->>'ecosVerifiedIndexPageGraphSha256', '') ~
        '^[a-f0-9]{64}$'
      and public.ecos_page_graph_sha256(old.document_data->'extractedPages') =
        old.document_data->>'ecosVerifiedIndexPageGraphSha256'
      and exists (
        select 1
        from public.ecos_hosted_index_jobs ready_job
        where ready_job.document_id = new.id::text
          and ready_job.source_owner_id = new.owner_id
          and ready_job.project_id = new.document_data->>'projectId'
          and ready_job.source_sha256 =
            old.document_data->>'ecosVerifiedIndexCommittedSha256'
          and ready_job.source_page_count =
            (old.document_data->>'ecosVerifiedIndexCommittedPageCount')::integer
          and ready_job.completed_page_count = ready_job.source_page_count
          and ready_job.assured_page_count = ready_job.source_page_count
          and ready_job.unresolved_region_count = 0
          and ready_job.state = 'ready'
          and ready_job.committed_evidence_version = 'ecos-hosted-evidence/1.3'
          and public.ecos_hosted_job_matches_reference(ready_job.id, false)
          and public.ecos_page_graph_sha256(
            public.ecos_build_hosted_page_graph(ready_job.id)
          ) = old.document_data->>'ecosVerifiedIndexPageGraphSha256'
      );
    identity_unchanged := identity_unchanged or trusted_current_activation;
  end if;

  new.document_data := new.document_data - commit_keys;
  if tg_op = 'UPDATE' and identity_unchanged then
    new.document_data := new.document_data || jsonb_strip_nulls(jsonb_build_object(
      'ecosVerifiedIndexCommitVersion', old.document_data->'ecosVerifiedIndexCommitVersion',
      'ecosVerifiedIndexCommittedAt', old.document_data->'ecosVerifiedIndexCommittedAt',
      'ecosVerifiedIndexCommittedSha256', old.document_data->'ecosVerifiedIndexCommittedSha256',
      'ecosVerifiedIndexCommittedPageCount', old.document_data->'ecosVerifiedIndexCommittedPageCount',
      'ecosVerifiedIndexPageGraphSha256', old.document_data->'ecosVerifiedIndexPageGraphSha256'
    ));
  end if;
  return new;
end;
$$;

revoke all on function public.ecos_guard_reference_document_authority_keys()
  from public, anon, authenticated;
grant execute on function public.ecos_guard_reference_document_authority_keys()
  to service_role;

drop trigger if exists ecos_reference_document_authority_keys_guard
  on public.reference_documents;
create trigger ecos_reference_document_authority_keys_guard
before insert or update of document_data, id, name, category, owner_id
on public.reference_documents
for each row execute function public.ecos_guard_reference_document_authority_keys();

create or replace function public.ecos_mark_hosted_verified_index_commit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  authoritative_page_graph jsonb;
  page_graph_sha256 text;
  published_page_count integer := 0;
  published_min_page integer := 0;
  published_max_page integer := 0;
  updated_document_count integer := 0;
begin
  if new.state <> 'ready'
      or new.committed_evidence_version <> 'ecos-hosted-evidence/1.3' then
    return new;
  end if;
  if new.source_page_count is null
      or new.source_page_count < 1
      or new.completed_page_count <> new.source_page_count
      or new.assured_page_count <> new.source_page_count
      or new.unresolved_region_count <> 0
      or not public.ecos_hosted_job_matches_reference(new.id, false) then
    raise exception 'Hosted ECOS commit does not match the exact source receipt';
  end if;

  authoritative_page_graph := public.ecos_build_hosted_page_graph(new.id);
  if jsonb_typeof(authoritative_page_graph) <> 'array'
      or jsonb_array_length(authoritative_page_graph) <> new.source_page_count then
    raise exception 'Hosted ECOS commit does not have one exact authoritative page graph';
  end if;
  page_graph_sha256 := public.ecos_page_graph_sha256(authoritative_page_graph);
  if coalesce(page_graph_sha256, '') !~ '^[a-f0-9]{64}$' then
    raise exception 'Hosted ECOS page graph digest is unavailable';
  end if;

  select
    count(*)::integer,
    coalesce(min((page.value->>'pageNumber')::integer), 0)::integer,
    coalesce(max((page.value->>'pageNumber')::integer), 0)::integer
  into published_page_count, published_min_page, published_max_page
  from jsonb_array_elements(authoritative_page_graph) page(value);
  if published_page_count <> new.source_page_count
      or published_min_page <> 1
      or published_max_page <> new.source_page_count then
    raise exception 'Hosted ECOS commit does not have exact contiguous page evidence';
  end if;

  update public.reference_documents source
  set document_data = coalesce(source.document_data, '{}'::jsonb) || jsonb_build_object(
        'extractedPages', authoritative_page_graph,
        'extractedText', (
          select nullif(string_agg(page.value->>'text', E'\n\n'
            order by (page.value->>'pageNumber')::integer), '')
          from jsonb_array_elements(authoritative_page_graph) page(value)
        ),
        'extractionStatus', 'complete',
        'searchablePageCount', new.source_page_count,
        'indexedContentSha256', new.source_sha256,
        'sourcePageCount', new.source_page_count,
        'documentIntelligenceVersion', 'ecos-document-intelligence/2.0',
        'documentVisualIndexVersion', 'ecos-visual-index/3.0',
        'ecosVerifiedIndexCommitVersion', 'ecos-verified-index-commit/1.0',
        'ecosVerifiedIndexCommittedAt', coalesce(new.ready_at, new.updated_at),
        'ecosVerifiedIndexCommittedSha256', new.source_sha256,
        'ecosVerifiedIndexCommittedPageCount', new.source_page_count,
        'ecosVerifiedIndexPageGraphSha256', page_graph_sha256
      ),
      updated_at = greatest(source.updated_at, coalesce(new.ready_at, new.updated_at))
  where source.id::text = new.document_id
    and source.owner_id = new.source_owner_id
    and source.document_data->>'projectId' = new.project_id
    and lower(coalesce(
      nullif(source.document_data->>'contentSha256', ''),
      nullif(source.document_data->>'webFileFingerprint', ''),
      nullif(source.document_data->>'indexedContentSha256', '')
    )) = new.source_sha256;
  get diagnostics updated_document_count = row_count;
  if updated_document_count <> 1 then
    raise exception 'Hosted ECOS commit could not bind one durable source document';
  end if;
  return new;
end;
$$;

revoke all on function public.ecos_mark_hosted_verified_index_commit()
  from public, anon, authenticated;
grant execute on function public.ecos_mark_hosted_verified_index_commit()
  to service_role;

-- Rebind both triggers so an already-ready inserted job and every transition
-- into a complete ready receipt use the graph-bound implementation above.
drop trigger if exists ecos_mark_hosted_verified_index_commit_insert_trigger
  on public.ecos_hosted_index_jobs;
create trigger ecos_mark_hosted_verified_index_commit_insert_trigger
after insert on public.ecos_hosted_index_jobs
for each row
when (
  new.state = 'ready'
  and new.committed_evidence_version = 'ecos-hosted-evidence/1.3'
)
execute function public.ecos_mark_hosted_verified_index_commit();

drop trigger if exists ecos_mark_hosted_verified_index_commit_update_trigger
  on public.ecos_hosted_index_jobs;
create trigger ecos_mark_hosted_verified_index_commit_update_trigger
after update of state, committed_evidence_version, completed_page_count,
  assured_page_count, unresolved_region_count
on public.ecos_hosted_index_jobs
for each row
when (
  new.state = 'ready'
  and new.committed_evidence_version = 'ecos-hosted-evidence/1.3'
  and (
    old.state is distinct from new.state
    or old.committed_evidence_version is distinct from new.committed_evidence_version
    or old.completed_page_count is distinct from new.completed_page_count
    or old.assured_page_count is distinct from new.assured_page_count
    or old.unresolved_region_count is distinct from new.unresolved_region_count
  )
)
execute function public.ecos_mark_hosted_verified_index_commit();

-- Remove any pre-graph compact receipts. The rollout applies this migration
-- with hosted preparation disabled, then reindexes exact targets to mint fresh
-- graph-bound receipts. Avoid triggering paid work during this data rewrite.
do $$
begin
  if exists (
    select 1
    from public.ecos_hosted_index_configuration configuration
    where configuration.enabled = true
  ) then
    raise exception 'ecos_hosted_configuration_must_be_disabled_for_page_graph_reseal';
  end if;
end;
$$;

select set_config('app.ecos_authority_purge', 'allowed', true);
alter table public.reference_documents
  disable trigger ecos_reference_document_hosted_enqueue;

update public.reference_documents source
set document_data = coalesce(source.document_data, '{}'::jsonb) - array[
      'ecosVerifiedIndexCommitVersion',
      'ecosVerifiedIndexCommittedAt',
      'ecosVerifiedIndexCommittedSha256',
      'ecosVerifiedIndexCommittedPageCount',
      'ecosVerifiedIndexPageGraphSha256',
      'ecosHostedIndexStatus',
      'ecosHostedIndexProgressPercent',
      'ecosHostedIndexCustomerMessage',
      'ecosHostedIndexLimitationCount',
      'ecosHostedIndexSupportReference',
      'ecosHostedIndexEvidenceVersion',
      'ecosHostedIndexUpdatedAt'
    ]::text[],
    updated_at = now()
where coalesce(source.document_data, '{}'::jsonb) ?| array[
  'ecosVerifiedIndexCommitVersion',
  'ecosVerifiedIndexCommittedAt',
  'ecosVerifiedIndexCommittedSha256',
  'ecosVerifiedIndexCommittedPageCount',
  'ecosVerifiedIndexPageGraphSha256',
  'ecosHostedIndexStatus',
  'ecosHostedIndexProgressPercent',
  'ecosHostedIndexCustomerMessage',
  'ecosHostedIndexLimitationCount',
  'ecosHostedIndexSupportReference',
  'ecosHostedIndexEvidenceVersion',
  'ecosHostedIndexUpdatedAt'
];

alter table public.reference_documents
  enable trigger ecos_reference_document_hosted_enqueue;
select set_config('app.ecos_authority_purge', '', true);

-- Reassert the effective database boundary at the latest migration revision.
-- Historical permissive policies must never become authoritative because a
-- partial environment skipped or reordered an older single-owner migration.
do $$
declare
  policy_record record;
begin
  for policy_record in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'reference_documents'
  loop
    execute format(
      'drop policy %I on public.reference_documents',
      policy_record.policyname
    );
  end loop;
end;
$$;

alter table public.reference_documents enable row level security;
alter table public.reference_documents force row level security;
revoke all on table public.reference_documents from public, anon, authenticated;
grant select, insert, update, delete on table public.reference_documents
  to authenticated;

create policy reference_documents_owner_select
  on public.reference_documents
  for select
  to authenticated
  using (
    (select public.dave_is_app_owner())
    and owner_id = (select auth.uid())
  );

create policy reference_documents_owner_insert
  on public.reference_documents
  for insert
  to authenticated
  with check (
    (select public.dave_is_app_owner())
    and owner_id = (select auth.uid())
  );

create policy reference_documents_owner_update
  on public.reference_documents
  for update
  to authenticated
  using (
    (select public.dave_is_app_owner())
    and owner_id = (select auth.uid())
  )
  with check (
    (select public.dave_is_app_owner())
    and owner_id = (select auth.uid())
  );

create policy reference_documents_owner_delete
  on public.reference_documents
  for delete
  to authenticated
  using (
    (select public.dave_is_app_owner())
    and owner_id = (select auth.uid())
  );

-- PostgreSQL cannot change a RETURNS TABLE shape with CREATE OR REPLACE.
-- Drop the old eight-column contracts before adding exact authority columns.
drop function if exists public.ecos_search_hosted_shadow_chunks(text, text[], integer);

create function public.ecos_search_hosted_shadow_chunks(
  p_search_query text,
  p_document_ids text[] default null,
  p_result_limit integer default 24
)
returns table(
  job_id uuid,
  organization_id text,
  project_id text,
  source_sha256 text,
  evidence_version text,
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
security definer
set search_path = public, extensions, pg_temp
as $$
  with job_candidates as (
    select
      job.id as job_id,
      job.organization_id,
      job.project_id,
      job.source_sha256,
      job.committed_evidence_version as evidence_version,
      job.document_id
    from public.ecos_hosted_index_jobs job
    where coalesce(auth.jwt()->>'role', '') = 'service_role'
      and job.mode = 'shadow'
      and job.state = 'ready'
      and job.committed_evidence_version = 'ecos-hosted-evidence/1.3'
      and public.ecos_hosted_job_matches_reference(job.id, true)
      and (p_document_ids is null or job.document_id = any(p_document_ids))
  ), eligible_jobs as (
    select candidate.*
    from (
      select candidate.*,
        count(*) over (partition by candidate.document_id) as exact_job_count
      from job_candidates candidate
    ) candidate
    where candidate.exact_job_count = 1
  ), scored as (
    select
      job.job_id,
      job.organization_id,
      job.project_id,
      job.source_sha256,
      job.evidence_version,
      chunk.document_id,
      chunk.page_number,
      chunk.region_id,
      chunk.chunk_text,
      chunk.sheet_number,
      chunk.confidence,
      chunk.metadata,
      greatest(
        ts_rank_cd(
          chunk.search_vector,
          websearch_to_tsquery('simple', coalesce(p_search_query, ''))
        ),
        extensions.similarity(
          lower(chunk.chunk_text),
          lower(coalesce(p_search_query, ''))
        )
      )::real as rank
    from eligible_jobs job
    join public.ecos_hosted_shadow_chunks chunk
      on chunk.job_id = job.job_id
     and chunk.organization_id = job.organization_id
     and chunk.project_id = job.project_id
     and chunk.document_id = job.document_id
     and chunk.source_sha256 = job.source_sha256
    where length(trim(coalesce(p_search_query, ''))) > 0
      and (
        chunk.search_vector @@ websearch_to_tsquery('simple', p_search_query)
        or extensions.similarity(
          lower(chunk.chunk_text),
          lower(p_search_query)
        ) >= 0.18
      )
  )
  select
    scored.job_id,
    scored.organization_id,
    scored.project_id,
    scored.source_sha256,
    scored.evidence_version,
    scored.document_id,
    scored.page_number,
    scored.region_id,
    scored.chunk_text,
    scored.sheet_number,
    scored.confidence,
    scored.metadata,
    scored.rank
  from scored
  order by scored.rank desc, scored.document_id, scored.page_number, scored.region_id
  limit greatest(1, least(coalesce(p_result_limit, 24), 100));
$$;

revoke all on function public.ecos_search_hosted_shadow_chunks(text, text[], integer)
  from public, anon, authenticated;
grant execute on function public.ecos_search_hosted_shadow_chunks(text, text[], integer)
  to service_role;

drop function if exists public.ecos_search_hosted_document_chunks(text, text[], integer);

create function public.ecos_search_hosted_document_chunks(
  p_search_query text,
  p_document_ids text[] default null,
  p_result_limit integer default 12
)
returns table(
  job_id uuid,
  organization_id text,
  project_id text,
  source_sha256 text,
  evidence_version text,
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
security definer
set search_path = public, extensions, pg_temp
as $$
  with job_candidates as (
    select
      job.id as job_id,
      job.organization_id,
      job.project_id,
      job.source_sha256,
      job.committed_evidence_version as evidence_version,
      job.document_id,
      0 as source_priority,
      'live'::text as source_mode
    from public.ecos_hosted_index_jobs job
    where job.mode = 'live'
      and job.state = 'ready'
      and job.committed_evidence_version = 'ecos-hosted-evidence/1.3'
      and public.pie_layer4_has_active_membership(job.organization_id)
      and public.ecos_hosted_job_matches_reference(job.id, true)
      and (p_document_ids is null or job.document_id = any(p_document_ids))
      and exists (
        select 1
        from public.ecos_hosted_document_pages page
        where page.organization_id = job.organization_id
          and page.project_id = job.project_id
          and page.document_id = job.document_id
          and page.source_sha256 = job.source_sha256
          and page.evidence_version = job.committed_evidence_version
      )
    union all
    select
      job.id as job_id,
      job.organization_id,
      job.project_id,
      job.source_sha256,
      job.committed_evidence_version as evidence_version,
      job.document_id,
      1 as source_priority,
      'shadow'::text as source_mode
    from public.ecos_hosted_index_jobs job
    join public.ecos_hosted_index_configuration configuration
      on configuration.organization_id = job.organization_id
     and configuration.enabled = true
     and configuration.publication_mode = 'live'
    where job.mode = 'shadow'
      and job.state = 'ready'
      and job.committed_evidence_version = 'ecos-hosted-evidence/1.3'
      and public.pie_layer4_has_active_membership(job.organization_id)
      and public.ecos_hosted_job_matches_reference(job.id, true)
      and (p_document_ids is null or job.document_id = any(p_document_ids))
  ), preferred_jobs as (
    select candidate.*
    from (
      select candidate.*,
        min(candidate.source_priority) over (
          partition by candidate.document_id
        ) as preferred_priority
      from job_candidates candidate
    ) candidate
    where candidate.source_priority = candidate.preferred_priority
  ), eligible_jobs as (
    select candidate.*
    from (
      select candidate.*,
        count(*) over (partition by candidate.document_id) as exact_job_count
      from preferred_jobs candidate
    ) candidate
    where candidate.exact_job_count = 1
  ), live_candidates as (
    select
      job.job_id,
      job.organization_id,
      job.project_id,
      job.source_sha256,
      job.evidence_version,
      chunk.document_id,
      chunk.page_number,
      chunk.region_id,
      chunk.chunk_text,
      chunk.sheet_number,
      chunk.confidence,
      chunk.metadata,
      chunk.search_vector
    from eligible_jobs job
    join public.ecos_hosted_document_chunks chunk
      on job.source_mode = 'live'
     and chunk.organization_id = job.organization_id
     and chunk.project_id = job.project_id
     and chunk.document_id = job.document_id
    join public.ecos_hosted_document_pages page
      on page.organization_id = job.organization_id
     and page.project_id = job.project_id
     and page.document_id = job.document_id
     and page.page_number = chunk.page_number
     and page.source_sha256 = job.source_sha256
     and page.evidence_version = job.evidence_version
  ), shadow_candidates as (
    select
      job.job_id,
      job.organization_id,
      job.project_id,
      job.source_sha256,
      job.evidence_version,
      chunk.document_id,
      chunk.page_number,
      chunk.region_id,
      chunk.chunk_text,
      chunk.sheet_number,
      chunk.confidence,
      chunk.metadata,
      chunk.search_vector
    from eligible_jobs job
    join public.ecos_hosted_shadow_chunks chunk
      on job.source_mode = 'shadow'
     and chunk.job_id = job.job_id
     and chunk.organization_id = job.organization_id
     and chunk.project_id = job.project_id
     and chunk.document_id = job.document_id
     and chunk.source_sha256 = job.source_sha256
  ), candidates as (
    select * from live_candidates
    union all
    select * from shadow_candidates
  ), scored as (
    select
      candidate.job_id,
      candidate.organization_id,
      candidate.project_id,
      candidate.source_sha256,
      candidate.evidence_version,
      candidate.document_id,
      candidate.page_number,
      candidate.region_id,
      candidate.chunk_text,
      candidate.sheet_number,
      candidate.confidence,
      candidate.metadata,
      ts_rank_cd(
        candidate.search_vector,
        websearch_to_tsquery('simple', coalesce(p_search_query, ''))
      ) as lexical_rank,
      extensions.similarity(
        lower(candidate.chunk_text),
        lower(coalesce(p_search_query, ''))
      ) as fuzzy_rank
    from candidates candidate
    where length(trim(coalesce(p_search_query, ''))) > 0
      and (
        candidate.search_vector @@ websearch_to_tsquery('simple', p_search_query)
        or extensions.similarity(
          lower(candidate.chunk_text),
          lower(p_search_query)
        ) >= 0.18
      )
  )
  select
    scored.job_id,
    scored.organization_id,
    scored.project_id,
    scored.source_sha256,
    scored.evidence_version,
    scored.document_id,
    scored.page_number,
    scored.region_id,
    scored.chunk_text,
    scored.sheet_number,
    scored.confidence,
    scored.metadata,
    (scored.lexical_rank * 0.82 + scored.fuzzy_rank * 0.18)::real
  from scored
  order by 13 desc, scored.confidence desc nulls last, scored.page_number
  limit greatest(1, least(coalesce(p_result_limit, 12), 50));
$$;

revoke all on function public.ecos_search_hosted_document_chunks(text, text[], integer)
  from public, anon;
grant execute on function public.ecos_search_hosted_document_chunks(text, text[], integer)
  to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger_record
    where trigger_record.tgrelid = 'public.reference_documents'::regclass
      and trigger_record.tgname = 'ecos_reference_document_hosted_enqueue'
      and trigger_record.tgenabled = 'O'
      and not trigger_record.tgisinternal
  ) then
    raise exception 'ecos_reference_document_hosted_enqueue_not_enabled';
  end if;
end;
$$;

commit;
