begin;

-- A page replacement retains its preparation job and visual resolutions under
-- their ORIGINAL job identity. The refresh record is the durable lineage link.
create table public.ecos_hosted_page_refresh_journal (
  refresh_id uuid primary key references public.ecos_hosted_page_refreshes(id) on delete cascade,
  previous_page jsonb not null,
  previous_job jsonb not null,
  previous_chunks jsonb not null,
  previous_embeddings jsonb not null,
  installed_page_sha256 text not null,
  installed_job_sha256 text not null,
  installed_chunks_sha256 text not null,
  installed_embeddings_sha256 text not null,
  created_at timestamptz not null default now()
);
alter table public.ecos_hosted_page_refresh_journal enable row level security;
alter table public.ecos_hosted_page_refresh_journal force row level security;
revoke all on public.ecos_hosted_page_refresh_journal from public,anon,authenticated;
grant select,insert on public.ecos_hosted_page_refresh_journal to service_role;

-- Publication identifiers must never silently retarget an old citation when
-- OCR ordinal positions change. Keep every original field and record the exact
-- prepared ID; refuse linked objects until their reference mapping is supported.
create function public.ecos_remap_isolated_coverage(p_value jsonb,p_ids jsonb)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare output jsonb; pair record;
begin
  if jsonb_typeof(p_value)='object' then
    output:='{}';
    for pair in select key,value from jsonb_each(p_value) loop
      if pair.key in ('analysisRegionIds','searchableRegionIds') then
        if jsonb_typeof(pair.value)<>'array' or exists(select 1 from jsonb_array_elements(pair.value) item where jsonb_typeof(item)<>'string') then
          raise exception 'coverage_region_references_invalid';
        end if;
        output:=output||jsonb_build_object(pair.key,(select coalesce(jsonb_agg(coalesce(p_ids->(item#>>'{}'),item) order by ordinal),'[]') from jsonb_array_elements(pair.value) with ordinality items(item,ordinal)));
      else
        output:=output||jsonb_build_object(pair.key,public.ecos_remap_isolated_coverage(pair.value,p_ids));
      end if;
    end loop;
    return output;
  elsif jsonb_typeof(p_value)='array' then
    return (select coalesce(jsonb_agg(public.ecos_remap_isolated_coverage(item,p_ids) order by ordinal),'[]') from jsonb_array_elements(p_value) with ordinality items(item,ordinal));
  end if;
  return p_value;
end;
$$;
revoke all on function public.ecos_remap_isolated_coverage(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.ecos_remap_isolated_coverage(jsonb,jsonb) to service_role;

create function public.ecos_isolated_region_projection(p_original jsonb,p_fresh jsonb,p_refresh_id uuid)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare region jsonb; prior jsonb; regions jsonb:='[]'; key text; revised text; mapping jsonb:='{}'; output jsonb;
begin
  if jsonb_typeof(p_original->'regions') is distinct from 'array'
    or jsonb_typeof(p_fresh->'regions') is distinct from 'array'
    or p_refresh_id is null then raise exception 'region_arrays_required'; end if;
  for region in select value from jsonb_array_elements(p_fresh->'regions') loop
    key:=region->>'id';
    select value into prior from jsonb_array_elements(p_original->'regions') where value->>'id'=key;
    if prior is not null and prior is distinct from region then
      if position(to_jsonb(key)::text in (p_fresh-'regions'-'visualCoverage')::text)>0
        or exists(select 1 from jsonb_array_elements(p_fresh->'regions') other
          where other->>'id'<>key and position(to_jsonb(key)::text in other::text)>0) then
        raise exception 'linked_changed_region_requires_explicit_mapping';
      end if;
      revised:=key||':refresh:'||p_refresh_id::text;
      if length(revised)>512 or exists(select 1 from jsonb_array_elements(p_fresh->'regions') other where other->>'id'=revised) then
        raise exception 'refreshed_region_id_invalid';
      end if;
      region:=region||jsonb_build_object('id',revised,'preparedRegionId',key);
      mapping:=mapping||jsonb_build_object(key,revised);
    end if;
    regions:=regions||jsonb_build_array(region);
  end loop;
  output:=jsonb_set(p_fresh,'{regions}',regions);
  if p_fresh ? 'visualCoverage' then
    output:=jsonb_set(output,'{visualCoverage}',public.ecos_remap_isolated_coverage(p_fresh->'visualCoverage',mapping));
  end if;
  if exists(select 1 from jsonb_object_keys(mapping) old_key where position(to_jsonb(old_key)::text in (output-'regions')::text)>0) then
    raise exception 'linked_changed_region_requires_explicit_mapping';
  end if;
  return output;
end;
$$;
revoke all on function public.ecos_isolated_region_projection(jsonb,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.ecos_isolated_region_projection(jsonb,jsonb,uuid) to service_role;

create function public.ecos_switch_isolated_page_refresh(p_refresh_id uuid,p_embeddings jsonb default null)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare
  r public.ecos_hosted_page_refreshes%rowtype;
  parent public.ecos_hosted_index_jobs%rowtype;
  candidate public.ecos_hosted_index_jobs%rowtype;
  original public.ecos_hosted_index_pages%rowtype;
  fresh public.ecos_hosted_index_pages%rowtype;
  source public.reference_documents%rowtype;
  inventory jsonb;
  old_chunks jsonb;
  old_embeddings jsonb;
  new_chunks jsonb;
  new_embeddings jsonb;
  output jsonb;
  selected_embedding_model text;
  chunk_count integer;
  projected_page jsonb;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then
    raise insufficient_privilege using message='worker_authorization_required';
  end if;
  if p_embeddings is not null and (jsonb_typeof(p_embeddings) is distinct from 'array'
    or jsonb_array_length(p_embeddings) not between 1 and 512
    or octet_length(p_embeddings::text)>16777216) then
    raise exception 'bounded_page_embeddings_required';
  end if;
  select * into r from public.ecos_hosted_page_refreshes where id=p_refresh_id for update;
  if not found or r.state<>'verified' then raise exception 'verified_refresh_required'; end if;
  select * into parent from public.ecos_hosted_index_jobs where id=r.parent_job_id for update;
  select * into candidate from public.ecos_hosted_index_jobs where id=r.candidate_job_id for update;
  select * into original from public.ecos_hosted_index_pages
    where job_id=parent.id and page_number=r.page_number for update;
  select * into fresh from public.ecos_hosted_index_pages
    where job_id=candidate.id and page_number=r.page_number for update;
  select * into source from public.reference_documents
    where id::text=parent.document_id and owner_id=parent.source_owner_id for update;
  if parent.mode is distinct from 'shadow' or parent.state is distinct from 'ready'
    or parent.claim_token is not null or parent.source_sha256 is distinct from r.source_sha256
    or parent.committed_evidence_version is distinct from 'ecos-hosted-evidence/1.3'
    or not public.ecos_hosted_job_matches_reference(parent.id,true)
    or encode(extensions.digest(to_jsonb(original)::text,'sha256'),'hex') is distinct from r.parent_page_sha256
    or encode(extensions.digest(to_jsonb(source)::text,'sha256'),'hex') is distinct from r.parent_reference_sha256 then
    raise exception 'current_parent_changed';
  end if;
  if not exists(select 1 from public.ecos_hosted_index_configuration
    where organization_id=parent.organization_id and enabled=false and publication_mode='shadow')
    or exists(select 1 from public.ecos_hosted_shadow_materialization_queue where job_id=parent.id) then
    raise exception 'quiescent_shadow_source_required';
  end if;
  if candidate.mode is distinct from 'shadow_refresh:'||candidate.id::text
    or candidate.state is distinct from 'needs_review' or candidate.claim_token is not null
    or candidate.source_sha256 is distinct from parent.source_sha256
    or candidate.organization_id is distinct from parent.organization_id
    or candidate.project_id is distinct from parent.project_id
    or candidate.document_id is distinct from parent.document_id
    or candidate.source_owner_id is distinct from parent.source_owner_id
    or candidate.source_revision is distinct from parent.source_revision
    or candidate.source_scan_status is distinct from 'clean'
    or fresh.state is distinct from 'assured' or fresh.unresolved_region_count is distinct from 0
    or fresh.source_sha256 is distinct from parent.source_sha256
    or fresh.assurance_result->>'accepted' is distinct from 'true'
    or fresh.assurance_result->>'evidenceVersion' is distinct from parent.committed_evidence_version
    or fresh.assurance_result->>'sourceSha256' is distinct from parent.source_sha256
    or fresh.assurance_result->>'projectId' is distinct from parent.project_id
    or fresh.assurance_result->>'pageNumber' is distinct from r.page_number::text
    or fresh.final_page_data->>'sourceSha256' is distinct from parent.source_sha256
    or fresh.final_page_data->>'pageNumber' is distinct from r.page_number::text then
    raise exception 'exact_fresh_page_assurance_required';
  end if;
  inventory:=fresh.final_page_data->'visualExceptionInventory';
  if inventory->>'schemaVersion' is distinct from 'ecos-visual-exception-inventory/1.0'
    or inventory->>'sourceSha256' is distinct from parent.source_sha256
    or inventory->>'pageNumber' is distinct from r.page_number::text
    or inventory->>'evidenceVersion' is distinct from parent.committed_evidence_version
    or jsonb_typeof(inventory->'items') is distinct from 'array'
    or jsonb_array_length(inventory->'items')>100 then
    raise exception 'fresh_visual_inventory_required';
  end if;
  if (select count(distinct item->>'regionKey') from jsonb_array_elements(inventory->'items') item)
      <>jsonb_array_length(inventory->'items')
    or exists(select 1 from jsonb_array_elements(inventory->'items') item where not exists(
      select 1 from public.ecos_hosted_visual_exceptions e
      where e.job_id=candidate.id and e.page_number=r.page_number
        and e.region_key=item->>'regionKey' and e.exception_fingerprint=item->>'exceptionFingerprint'
        and e.state='resolved' and e.evidence_version=parent.committed_evidence_version
        and e.assurance_result->>'accepted'='true'
        and e.assurance_result->>'exceptionFingerprint'=e.exception_fingerprint
        and e.assurance_result->>'evidenceVersion'=e.evidence_version
        and e.assurance_result->>'schemaVersion'='ecos-drawing-page-analysis/2.0'
        and length(trim(e.assurance_result->>'assuranceProvider'))>0))
    or exists(select 1 from public.ecos_hosted_visual_exceptions e where e.job_id=candidate.id
      and (e.page_number<>r.page_number or e.state<>'resolved' or not exists(
        select 1 from jsonb_array_elements(inventory->'items') item
        where item->>'regionKey'=e.region_key and item->>'exceptionFingerprint'=e.exception_fingerprint))) then
    raise exception 'fresh_visual_resolution_incomplete';
  end if;
  select coalesce(jsonb_agg(to_jsonb(c) order by region_id,chunk_index),'[]') into old_chunks
    from public.ecos_hosted_shadow_chunks c where job_id=parent.id and page_number=r.page_number;
  select coalesce(jsonb_agg(to_jsonb(e) order by region_id,chunk_index),'[]'),min(e.embedding_model)
    into old_embeddings,selected_embedding_model from public.ecos_hosted_chunk_embeddings e
    where job_id=parent.id and page_number=r.page_number;
  if jsonb_array_length(old_chunks)<1 or jsonb_array_length(old_embeddings)<>jsonb_array_length(old_chunks)
    or exists(select 1 from public.ecos_hosted_chunk_embeddings e
      where job_id=parent.id and page_number=r.page_number and e.embedding_model<>selected_embedding_model) then
    raise exception 'existing_semantic_page_required';
  end if;
  -- Preview executes the EXISTING materializers inside a rollback-only
  -- subtransaction. No tentative page/chunk/queue changes can become visible.
  begin
    projected_page:=public.ecos_isolated_region_projection(original.final_page_data,fresh.final_page_data,r.id);
    update public.ecos_hosted_index_pages set native_page_data=fresh.native_page_data,
      ocr_page_data=fresh.ocr_page_data,deterministic_page_data=fresh.deterministic_page_data,
      final_page_data=projected_page,assurance_result=fresh.assurance_result,
      state='assured',unresolved_region_count=0,updated_at=now()
      where job_id=parent.id and page_number=r.page_number;
    perform public.ecos_refresh_hosted_shadow_page(parent.id,r.page_number);
    perform public.ecos_append_hosted_shadow_region_text(parent.id,r.page_number);
    select jsonb_agg(to_jsonb(c) order by region_id,chunk_index),count(*)::integer
      into new_chunks,chunk_count from public.ecos_hosted_shadow_chunks c
      where job_id=parent.id and page_number=r.page_number;
    if chunk_count not between 1 and 512 then raise exception 'bounded_fresh_chunks_required'; end if;
    output:=jsonb_build_object('refreshId',r.id,'pageNumber',r.page_number,
      'embeddingModel',selected_embedding_model,'candidatePageSha256',encode(extensions.digest(to_jsonb(fresh)::text,'sha256'),'hex'),
      'chunks',new_chunks,'published',false);
    if p_embeddings is null then
      raise exception using errcode='ZP001',message='isolated_preview_rollback';
    end if;
    if jsonb_array_length(p_embeddings)<>chunk_count or
      (select count(distinct (item->>'pageNumber',item->>'regionId',item->>'chunkIndex'))
        from jsonb_array_elements(p_embeddings) item)<>chunk_count then
      raise exception 'exact_embedding_inventory_required';
    end if;
    if exists(select 1 from jsonb_array_elements(p_embeddings) item where
      jsonb_typeof(item) is distinct from 'object'
      or jsonb_typeof(item->'embedding') is distinct from 'array'
      or jsonb_array_length(item->'embedding')<>1536
      or not exists(select 1 from public.ecos_hosted_shadow_chunks c
        where c.job_id=parent.id and c.page_number=r.page_number
          and item->>'pageNumber'=r.page_number::text and item->>'regionId'=c.region_id
          and item->>'chunkIndex'=c.chunk_index::text
          and item->>'chunkSha256'=encode(extensions.digest(convert_to(
            left(btrim(concat_ws(' ',nullif(btrim(c.sheet_number),''),c.chunk_text)),6000),'UTF8'),'sha256'),'hex')))
      or exists(select 1 from jsonb_array_elements(p_embeddings) item,
        jsonb_array_elements(item->'embedding') v where jsonb_typeof(v) is distinct from 'number') then
      raise exception 'exact_page_embeddings_required';
    end if;
    delete from public.ecos_hosted_chunk_embeddings where job_id=parent.id and page_number=r.page_number;
    insert into public.ecos_hosted_chunk_embeddings(job_id,organization_id,project_id,document_id,
      source_sha256,evidence_version,source_kind,page_number,region_id,chunk_index,chunk_sha256,
      embedding_model,embedding_dimensions,embedding)
    select parent.id,parent.organization_id,parent.project_id,parent.document_id,parent.source_sha256,
      parent.committed_evidence_version,'shadow',r.page_number,item->>'regionId',(item->>'chunkIndex')::integer,
      item->>'chunkSha256',selected_embedding_model,1536,((item->'embedding')::text)::extensions.vector(1536)
      from jsonb_array_elements(p_embeddings) item;
    delete from public.ecos_hosted_shadow_materialization_queue where job_id=parent.id and page_number=r.page_number;
    -- The existing project manifest includes this timestamp. Advance it in the
    -- same transaction so concurrent research and cached answers see the change.
    update public.ecos_hosted_index_jobs set updated_at=clock_timestamp() where id=parent.id;
    select jsonb_agg(to_jsonb(e) order by region_id,chunk_index) into new_embeddings
      from public.ecos_hosted_chunk_embeddings e where job_id=parent.id and page_number=r.page_number;
    insert into public.ecos_hosted_page_refresh_journal(refresh_id,previous_page,previous_job,previous_chunks,
      previous_embeddings,installed_page_sha256,installed_job_sha256,installed_chunks_sha256,installed_embeddings_sha256)
    select r.id,to_jsonb(original),to_jsonb(parent),old_chunks,old_embeddings,
      encode(extensions.digest(to_jsonb(p)::text,'sha256'),'hex'),
      (select encode(extensions.digest(to_jsonb(j)::text,'sha256'),'hex') from public.ecos_hosted_index_jobs j where j.id=parent.id),
      encode(extensions.digest(new_chunks::text,'sha256'),'hex'),
      encode(extensions.digest(new_embeddings::text,'sha256'),'hex')
      from public.ecos_hosted_index_pages p where job_id=parent.id and page_number=r.page_number;
    update public.ecos_hosted_page_refreshes set state='promoted' where id=r.id;
    output:=jsonb_build_object('refreshId',r.id,'pageNumber',r.page_number,'chunkCount',chunk_count,
      'published',true,'scope','existing_shadow_page_only');
  exception when sqlstate 'ZP001' then null;
  end;
  return output;
end;
$$;
revoke all on function public.ecos_switch_isolated_page_refresh(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.ecos_switch_isolated_page_refresh(uuid,jsonb) to service_role;

create function public.ecos_rollback_isolated_page_refresh(p_refresh_id uuid)
returns boolean language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare r public.ecos_hosted_page_refreshes%rowtype;
  journal public.ecos_hosted_page_refresh_journal%rowtype;
  parent public.ecos_hosted_index_jobs%rowtype;
  current_page public.ecos_hosted_index_pages%rowtype;
  original public.ecos_hosted_index_pages%rowtype;
  chunks jsonb; embeddings jsonb;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then
    raise insufficient_privilege using message='worker_authorization_required';
  end if;
  select * into r from public.ecos_hosted_page_refreshes where id=p_refresh_id for update;
  if not found or r.state<>'promoted' then raise exception 'promoted_refresh_required'; end if;
  select * into journal from public.ecos_hosted_page_refresh_journal where refresh_id=r.id;
  if not found then raise exception 'refresh_journal_required'; end if;
  select * into parent from public.ecos_hosted_index_jobs where id=r.parent_job_id for update;
  select * into current_page from public.ecos_hosted_index_pages
    where job_id=parent.id and page_number=r.page_number for update;
  perform 1 from public.reference_documents where id::text=parent.document_id and owner_id=parent.source_owner_id for update;
  select jsonb_agg(to_jsonb(c) order by region_id,chunk_index) into chunks
    from public.ecos_hosted_shadow_chunks c where job_id=parent.id and page_number=r.page_number;
  select jsonb_agg(to_jsonb(e) order by region_id,chunk_index) into embeddings
    from public.ecos_hosted_chunk_embeddings e where job_id=parent.id and page_number=r.page_number;
  if parent.mode is distinct from 'shadow' or parent.state is distinct from 'ready'
    or parent.claim_token is not null or not public.ecos_hosted_job_matches_reference(parent.id,true)
    or not exists(select 1 from public.reference_documents d where id::text=parent.document_id
      and owner_id=parent.source_owner_id and encode(extensions.digest(to_jsonb(d)::text,'sha256'),'hex')=r.parent_reference_sha256)
    or encode(extensions.digest(to_jsonb(current_page)::text,'sha256'),'hex') is distinct from journal.installed_page_sha256
    or encode(extensions.digest(to_jsonb(parent)::text,'sha256'),'hex') is distinct from journal.installed_job_sha256
    or encode(extensions.digest(chunks::text,'sha256'),'hex') is distinct from journal.installed_chunks_sha256
    or encode(extensions.digest(embeddings::text,'sha256'),'hex') is distinct from journal.installed_embeddings_sha256
    or exists(select 1 from public.ecos_hosted_page_refreshes other where other.parent_job_id=parent.id
      and other.id<>r.id and other.state in ('preparing','verified'))
    or exists(select 1 from public.ecos_hosted_shadow_materialization_queue where job_id=parent.id)
    or not exists(select 1 from public.ecos_hosted_index_configuration
      where organization_id=parent.organization_id and enabled=false and publication_mode='shadow') then
    raise exception 'installed_refresh_changed';
  end if;
  select * into original from jsonb_populate_record(null::public.ecos_hosted_index_pages,journal.previous_page);
  update public.ecos_hosted_index_pages set native_page_data=original.native_page_data,
    ocr_page_data=original.ocr_page_data,deterministic_page_data=original.deterministic_page_data,
    final_page_data=original.final_page_data,assurance_result=original.assurance_result,
    state=original.state,unresolved_region_count=original.unresolved_region_count,updated_at=original.updated_at
    where job_id=parent.id and page_number=r.page_number;
  delete from public.ecos_hosted_shadow_chunks where job_id=parent.id and page_number=r.page_number;
  insert into public.ecos_hosted_shadow_chunks(job_id,organization_id,project_id,document_id,source_sha256,
    page_number,region_id,chunk_index,chunk_text,sheet_number,confidence,metadata,indexed_at)
    select job_id,organization_id,project_id,document_id,source_sha256,page_number,region_id,chunk_index,
      chunk_text,sheet_number,confidence,metadata,indexed_at
    from jsonb_populate_recordset(null::public.ecos_hosted_shadow_chunks,journal.previous_chunks);
  delete from public.ecos_hosted_chunk_embeddings where job_id=parent.id and page_number=r.page_number;
  insert into public.ecos_hosted_chunk_embeddings
    select * from jsonb_populate_recordset(null::public.ecos_hosted_chunk_embeddings,journal.previous_embeddings);
  delete from public.ecos_hosted_shadow_materialization_queue where job_id=parent.id and page_number=r.page_number;
  update public.ecos_hosted_index_jobs set updated_at=(journal.previous_job->>'updated_at')::timestamptz where id=parent.id;
  -- Re-running normal provenance triggers must reproduce the saved state,
  -- otherwise abort the entire rollback instead of claiming restoration.
  if (select to_jsonb(j) from public.ecos_hosted_index_jobs j where id=parent.id) is distinct from journal.previous_job
    or (select to_jsonb(p) from public.ecos_hosted_index_pages p where job_id=parent.id and page_number=r.page_number)
       is distinct from journal.previous_page
    or (select jsonb_agg(to_jsonb(c) order by region_id,chunk_index) from public.ecos_hosted_shadow_chunks c
        where job_id=parent.id and page_number=r.page_number) is distinct from journal.previous_chunks
    or (select jsonb_agg(to_jsonb(e) order by region_id,chunk_index) from public.ecos_hosted_chunk_embeddings e
        where job_id=parent.id and page_number=r.page_number) is distinct from journal.previous_embeddings then
    raise exception 'exact_refresh_restoration_failed';
  end if;
  update public.ecos_hosted_page_refreshes set state='cancelled' where id=r.id;
  return true;
end;
$$;
revoke all on function public.ecos_rollback_isolated_page_refresh(uuid) from public,anon,authenticated;
grant execute on function public.ecos_rollback_isolated_page_refresh(uuid) to service_role;

commit;
