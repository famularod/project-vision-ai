-- Private claimed-worker batching. Search continues to require job.state=ready.
-- Filename aligned to the version assigned by the hosted migration service.
-- The ready transition independently verifies the complete exact inventory.
create table public.ecos_claimed_shadow_embedding_runs (
  job_id uuid primary key references public.ecos_hosted_index_jobs(id) on delete cascade,
  claim_token uuid not null,
  source_sha256 text not null,
  inventory_sha256 text not null,
  expected_count integer not null check (expected_count between 1 and 25000),
  embedding_model text not null,
  complete boolean not null default false
);
alter table public.ecos_claimed_shadow_embedding_runs enable row level security;
revoke all on public.ecos_claimed_shadow_embedding_runs from public, anon, authenticated;
grant all on public.ecos_claimed_shadow_embedding_runs to service_role;

create function public.ecos_claimed_shadow_inventory(p_job_id uuid)
returns table(chunk_count integer, inventory_sha256 text)
language sql stable security definer set search_path=public,extensions,pg_temp
as $$
  select count(*)::integer, encode(digest(convert_to(coalesce(string_agg(
    jsonb_build_array(c.page_number,c.region_id,c.chunk_index,
      encode(digest(convert_to(left(btrim(concat_ws(' ',nullif(btrim(c.sheet_number),''),c.chunk_text)),6000),'UTF8'),'sha256'),'hex')
    )::text, E'\n' order by c.page_number,c.region_id,c.chunk_index),''),'UTF8'),'sha256'),'hex')
  from public.ecos_hosted_shadow_chunks c
  join public.ecos_hosted_index_jobs j on j.id=c.job_id
    and j.organization_id=c.organization_id and j.project_id=c.project_id
    and j.document_id=c.document_id and j.source_sha256=c.source_sha256
  where j.id=p_job_id and j.mode='shadow';
$$;
revoke all on function public.ecos_claimed_shadow_inventory(uuid) from public,anon,authenticated;
grant execute on function public.ecos_claimed_shadow_inventory(uuid) to service_role;

create function public.ecos_begin_claimed_shadow_embeddings(
  p_job_id uuid,p_claim_token uuid,p_embedding_model text,p_embedding_dimensions integer,p_expected_count integer
) returns integer language plpgsql security definer set search_path=public,extensions,pg_temp
as $$
declare j public.ecos_hosted_index_jobs%rowtype; n integer; fingerprint text;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then raise exception 'Worker authorization required'; end if;
  if p_embedding_dimensions is distinct from 1536 or length(btrim(coalesce(p_embedding_model,''))) not between 3 and 120
    then raise exception 'Embedding model identity invalid'; end if;
  select * into j from public.ecos_hosted_index_jobs where id=p_job_id and claim_token=p_claim_token
    and mode='shadow' and state='assuring' and committed_evidence_version is null and lease_expires_at>now() for update;
  if not found or not public.ecos_hosted_job_matches_reference(j.id,false) then raise exception 'Exact active shadow lease required'; end if;
  if j.assured_page_count is distinct from j.source_page_count or j.unresolved_region_count<>0
    or exists(select 1 from public.ecos_hosted_shadow_materialization_queue where job_id=j.id)
    then raise exception 'Document extraction or materialization incomplete'; end if;
  select chunk_count,inventory_sha256 into n,fingerprint from public.ecos_claimed_shadow_inventory(j.id);
  if n is distinct from p_expected_count or n not between 1 and 25000 then raise exception 'Exact inventory count mismatch'; end if;
  insert into public.ecos_claimed_shadow_embedding_runs values(j.id,p_claim_token,j.source_sha256,fingerprint,n,btrim(p_embedding_model),false)
  on conflict(job_id) do update set claim_token=excluded.claim_token,source_sha256=excluded.source_sha256,
    inventory_sha256=excluded.inventory_sha256,expected_count=excluded.expected_count,embedding_model=excluded.embedding_model,complete=false;
  return n;
end; $$;

create function public.ecos_upsert_claimed_shadow_embedding_batch(p_job_id uuid,p_claim_token uuid,p_rows jsonb)
returns integer language plpgsql security definer set search_path=public,extensions,pg_temp
as $$
declare j public.ecos_hosted_index_jobs%rowtype; r public.ecos_claimed_shadow_embedding_runs%rowtype; n integer;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then raise exception 'Worker authorization required'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Bounded embedding array required'; end if;
  n:=jsonb_array_length(p_rows);
  if n not between 1 and 16 then raise exception 'Embedding batch must contain 1 to 16 rows'; end if;
  select * into j from public.ecos_hosted_index_jobs where id=p_job_id and claim_token=p_claim_token
    and mode='shadow' and state='assuring' and committed_evidence_version is null and lease_expires_at>now() for update;
  if not found or not public.ecos_hosted_job_matches_reference(j.id,false) then raise exception 'Exact active shadow lease required'; end if;
  select * into r from public.ecos_claimed_shadow_embedding_runs where job_id=j.id and claim_token=p_claim_token and not complete for update;
  if not found or r.source_sha256<>j.source_sha256 then raise exception 'Exact semantic run required'; end if;
  if exists(select 1 from jsonb_array_elements(p_rows) s(v) where
      jsonb_typeof(v) is distinct from 'object' or jsonb_typeof(v->'embedding') is distinct from 'array'
      or jsonb_array_length(v->'embedding') is distinct from 1536
      or coalesce(v->>'pageNumber','') !~ '^[1-9][0-9]{0,3}$'
      or coalesce(v->>'chunkIndex','') !~ '^(0|[1-9][0-9]{0,8})$'
      or length(coalesce(v->>'regionId',''))>1000 or coalesce(v->>'chunkSha256','') !~ '^[a-f0-9]{64}$')
    then raise exception 'Embedding row format invalid'; end if;
  if (select count(distinct jsonb_build_array(v->>'pageNumber',coalesce(v->>'regionId',''),v->>'chunkIndex')) from jsonb_array_elements(p_rows) s(v))<>n
    then raise exception 'Duplicate embedding identities'; end if;
  if exists(select 1 from jsonb_array_elements(p_rows) s(v) where not exists(
      select 1 from public.ecos_hosted_shadow_chunks c where c.job_id=j.id
      and c.organization_id=j.organization_id and c.project_id=j.project_id and c.document_id=j.document_id and c.source_sha256=j.source_sha256
      and c.page_number=(v->>'pageNumber')::integer and c.region_id=coalesce(v->>'regionId','') and c.chunk_index=(v->>'chunkIndex')::integer
      and encode(digest(convert_to(left(btrim(concat_ws(' ',nullif(btrim(c.sheet_number),''),c.chunk_text)),6000),'UTF8'),'sha256'),'hex')=v->>'chunkSha256'))
    then raise exception 'Embedding row does not match exact current chunk'; end if;
  insert into public.ecos_hosted_chunk_embeddings as existing (
    job_id,organization_id,project_id,document_id,source_sha256,evidence_version,source_kind,
    page_number,region_id,chunk_index,chunk_sha256,embedding_model,embedding_dimensions,embedding,backfill_run_id
  ) select j.id,j.organization_id,j.project_id,j.document_id,j.source_sha256,'ecos-hosted-evidence/1.3','shadow',
    (v->>'pageNumber')::integer,coalesce(v->>'regionId',''),(v->>'chunkIndex')::integer,v->>'chunkSha256',r.embedding_model,1536,
    ((v->'embedding')::text)::extensions.vector(1536),null from jsonb_array_elements(p_rows) s(v)
  on conflict(job_id,page_number,region_id,chunk_index) do update set
    organization_id=excluded.organization_id,project_id=excluded.project_id,document_id=excluded.document_id,source_sha256=excluded.source_sha256,
    evidence_version=excluded.evidence_version,source_kind=excluded.source_kind,chunk_sha256=excluded.chunk_sha256,
    embedding_model=excluded.embedding_model,embedding_dimensions=excluded.embedding_dimensions,embedding=excluded.embedding,backfill_run_id=null
  where (existing.organization_id,existing.project_id,existing.document_id,existing.source_sha256,existing.evidence_version,existing.source_kind,
    existing.chunk_sha256,existing.embedding_model,existing.embedding_dimensions,existing.embedding,existing.backfill_run_id)
    is distinct from (excluded.organization_id,excluded.project_id,excluded.document_id,excluded.source_sha256,excluded.evidence_version,excluded.source_kind,
    excluded.chunk_sha256,excluded.embedding_model,excluded.embedding_dimensions,excluded.embedding,excluded.backfill_run_id);
  return n;
end; $$;

create function public.ecos_finish_claimed_shadow_embeddings(p_job_id uuid,p_claim_token uuid)
returns integer language plpgsql security definer set search_path=public,extensions,pg_temp
as $$
declare j public.ecos_hosted_index_jobs%rowtype; r public.ecos_claimed_shadow_embedding_runs%rowtype; n integer; fingerprint text;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then raise exception 'Worker authorization required'; end if;
  select * into j from public.ecos_hosted_index_jobs where id=p_job_id and claim_token=p_claim_token
    and mode='shadow' and state='assuring' and committed_evidence_version is null and lease_expires_at>now() for update;
  if not found or not public.ecos_hosted_job_matches_reference(j.id,false) then raise exception 'Exact active shadow lease required'; end if;
  select * into r from public.ecos_claimed_shadow_embedding_runs where job_id=j.id and claim_token=p_claim_token for update;
  if not found then raise exception 'Exact semantic run required'; end if;
  select chunk_count,inventory_sha256 into n,fingerprint from public.ecos_claimed_shadow_inventory(j.id);
  if n<>r.expected_count or fingerprint<>r.inventory_sha256 then raise exception 'Semantic inventory drifted'; end if;
  if exists(select 1 from public.ecos_hosted_shadow_chunks c where c.job_id=j.id and not exists(
      select 1 from public.ecos_hosted_chunk_embeddings e where e.job_id=c.job_id and e.organization_id=c.organization_id
      and e.project_id=c.project_id and e.document_id=c.document_id and e.source_sha256=c.source_sha256 and e.source_kind='shadow'
      and e.evidence_version='ecos-hosted-evidence/1.3' and e.page_number=c.page_number and e.region_id=c.region_id and e.chunk_index=c.chunk_index
      and e.embedding_model=r.embedding_model and e.embedding_dimensions=1536
      and e.chunk_sha256=encode(digest(convert_to(left(btrim(concat_ws(' ',nullif(btrim(c.sheet_number),''),c.chunk_text)),6000),'UTF8'),'sha256'),'hex')))
    then raise exception 'Semantic inventory incomplete'; end if;
  delete from public.ecos_hosted_chunk_embeddings e where e.job_id=j.id and not exists(
    select 1 from public.ecos_hosted_shadow_chunks c where c.job_id=e.job_id and c.page_number=e.page_number and c.region_id=e.region_id and c.chunk_index=e.chunk_index);
  update public.ecos_claimed_shadow_embedding_runs set complete=true where job_id=j.id;
  return n;
end; $$;

create function public.ecos_guard_claimed_shadow_semantic_ready()
returns trigger language plpgsql security definer set search_path=public,extensions,pg_temp
as $$
declare r public.ecos_claimed_shadow_embedding_runs%rowtype;
begin
  select * into r from public.ecos_claimed_shadow_embedding_runs where job_id=new.id;
  if not found then return new; end if;
  if new.mode<>'shadow' or r.claim_token is distinct from old.claim_token or not r.complete
    or new.committed_evidence_version is distinct from 'ecos-hosted-evidence/1.3'
    then raise exception 'Claimed semantic batches have not completed'; end if;
  -- Recheck hashes, exact coverage and the current lease in the same transaction
  -- as the ready transition. A stale completion marker cannot release a document.
  perform public.ecos_finish_claimed_shadow_embeddings(new.id,old.claim_token);
  delete from public.ecos_claimed_shadow_embedding_runs where job_id=new.id;
  return new;
end; $$;
create trigger ecos_claimed_shadow_semantic_ready_guard before update of state on public.ecos_hosted_index_jobs
  for each row when(old.state is distinct from 'ready' and new.state='ready') execute function public.ecos_guard_claimed_shadow_semantic_ready();

revoke all on function public.ecos_begin_claimed_shadow_embeddings(uuid,uuid,text,integer,integer) from public,anon,authenticated;
revoke all on function public.ecos_upsert_claimed_shadow_embedding_batch(uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.ecos_finish_claimed_shadow_embeddings(uuid,uuid) from public,anon,authenticated;
revoke all on function public.ecos_guard_claimed_shadow_semantic_ready() from public,anon,authenticated;
grant execute on function public.ecos_begin_claimed_shadow_embeddings(uuid,uuid,text,integer,integer) to service_role;
grant execute on function public.ecos_upsert_claimed_shadow_embedding_batch(uuid,uuid,jsonb) to service_role;
grant execute on function public.ecos_finish_claimed_shadow_embeddings(uuid,uuid) to service_role;
