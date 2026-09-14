-- Versioned canonical source authority: bookkeeping timestamps are not document identity.
-- Hosted migration version 20260914053252, returned by the deployment service.
-- Existing /2.1 receipts and generation counters are never rewritten or reset.
-- New decisions require normal CAS, managed-copy renewal, and new execution/page bindings.
begin;
do $precondition$
declare f record; expected jsonb;
begin
 for expected in select value from jsonb_array_elements('[{"schema":"ecos_private","name":"guard_document_binding_receipt","sha":"cc7f750a21a56bb740c8599332cfe0ebb509e11f0ed33d0d4c2d5dc84918cf25"},{"schema":"ecos_private","name":"guard_document_binding_head","sha":"69305231549e857aa2fddce9b1a0bc916085f7a1d2a4303586210061f282a2f2"},{"schema":"ecos_private","name":"observe_owner_authority_change","sha":"2f41c2d98b662b8d342416587a9a5e2086231e3d99975c1bed3a2155f624fda0"},{"schema":"ecos_private","name":"validate_owner_source_decision","sha":"a8bd3a8492725d571de0fa0ac1317836ad4eee082153555fa3c75b57515babf3"},{"schema":"ecos_private","name":"owner_source_receipt_shape","sha":"7ca813233ec4173e07f234a0d7e76ac91cd4aa0debbf4a871a347e00e5185899"},{"schema":"ecos_private","name":"validate_owner_source_receipt","sha":"143eb49f0fdac00fae2250ff993520bf270c28f3a2d23e1cdf61085f47f899f2"},{"schema":"ecos_private","name":"validate_owner_source_head","sha":"9480841b5a99ac046212724ad71936d8206d9a5debe6c5c436b74e207ab03714"},{"schema":"ecos_private","name":"commit_owner_source_authority","sha":"cc630369c9f805ff88208617703d6088c8abbf5d6f430f95973030822d2aedb5"},{"schema":"ecos_private","name":"owner_source_authority_read_control","sha":"16475cac435cc21e8b6df56074117e80a6160bb790d565ff6a25204343d859f9"},{"schema":"ecos_private","name":"linked_owner_project_inventory","sha":"ad397b6d0746c7cda7ee374e006b8a0934ffc26307886255d607401a8fbb0b02"},{"schema":"ecos_private","name":"owner_index_complete_inventory","sha":"712b1b597c57810dabedf3b5cb929460c80000954b492ac8f029882d90ef2d2a"}]'::jsonb) loop
  select p.oid,pg_get_functiondef(p.oid) as definition into strict f from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname=expected->>'schema' and p.proname=expected->>'name';
  if encode(sha256(convert_to(f.definition,'UTF8')),'hex')<>expected->>'sha' then
   raise exception 'Source authority migration predecessor drift: %',expected->>'name';
  end if;
 end loop;
end;$precondition$;


CREATE OR REPLACE FUNCTION ecos_private.owner_source_context_v22(p_owner uuid, p_review uuid, p_document text, p_projects uuid[], p_include_review boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET "TimeZone" TO 'UTC'
 SET "DateStyle" TO 'ISO, MDY'
AS $function$
declare actor jsonb;metadata jsonb;locator jsonb;project_metadata jsonb;project_pins jsonb:='[]'::jsonb;
  project_id uuid;primary_id text;state text;source_generation integer;context_body jsonb;context_sha text;previous uuid;
  old_epoch text;review_epoch text;source_count integer;
  uuid_pattern constant text:='^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$';
begin
  actor:=ecos_private.owner_authority_actor(p_owner);
  if p_review is null or p_review::text !~ uuid_pattern or not public.ecos_v2_inventory_exact_text(p_document,300)
      or p_projects is null or cardinality(p_projects) not between 1 and 20 or not p_review=any(p_projects)
      or exists(select 1 from unnest(p_projects)x where x is null or x::text !~ uuid_pattern)
      or p_projects is distinct from array(select distinct x from unnest(p_projects)x order by x) then
    raise exception using errcode='22023',message='Exact sorted owner source project selection required';end if;
  select ecos_private.owner_source_metadata(d.id,d.owner_id,d.name,d.category,d.document_data,d.updated_at) into metadata
    from public.reference_documents d where d.owner_id=p_owner and d.id=p_document;
  metadata := metadata - 'updated_at';
  if metadata is null or octet_length(metadata::text)>16384 or metadata->>'document_data_type' is distinct from 'object'
      or jsonb_typeof(metadata->'id') is distinct from 'string' or metadata->>'id' is distinct from p_document
      or metadata->'organizationId' is distinct from 'null'::jsonb
      or jsonb_typeof(metadata->'contentSha256') is distinct from 'string' or metadata->>'contentSha256' !~ '^[a-f0-9]{64}$'
      or metadata->'isCurrent' is distinct from 'true'::jsonb then
    raise exception using errcode='22023',message='Current exact missing-organization owner source required';end if;
  if jsonb_typeof(metadata->'sourcePageCount') is distinct from 'number' or metadata->>'sourcePageCount' !~ '^[1-9][0-9]{0,4}$'
      or (metadata->>'sourcePageCount')::integer>10000 then
    raise exception using errcode='22023',message='Exact expected source page count required';end if;
  source_count:=(metadata->>'sourcePageCount')::integer;
  if metadata->'drawingRevision'<>'null'::jsonb and(jsonb_typeof(metadata->'drawingRevision') is distinct from 'string'
      or not public.ecos_v2_inventory_exact_text(metadata->>'drawingRevision',300)) then
    raise exception using errcode='22023',message='Exact source revision required';end if;
  if metadata->'drawingStatus'<>'null'::jsonb and(jsonb_typeof(metadata->'drawingStatus') is distinct from 'string'
      or lower(btrim(metadata->>'drawingStatus',E' \t\n\r\f'||chr(11)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279)))='superseded') then
    raise exception using errcode='22023',message='Superseded or invalid owner source status';end if;
  primary_id:=metadata->>'projectId';
  if primary_id is not null and(jsonb_typeof(metadata->'projectId') is distinct from 'string' or primary_id !~ uuid_pattern
      or not primary_id=any(p_projects::text[])) then
    raise exception using errcode='22023',message='Existing canonical primary project must be preserved';end if;
  if exists(select 1 from public.dave_sync_tombstones t where t.owner_id=p_owner and
      ((t.entity_type='reference_document' and t.record_id=p_document)or(t.entity_type='project' and t.record_id=any(p_projects::text[])))) then
    raise exception using errcode='22023',message='Owner source or project has deletion marker';end if;
  foreach project_id in array p_projects loop
    select ecos_private.owner_project_metadata(p) into project_metadata from public.projects p where p.id=project_id and p.owner_id=p_owner and p.archived is false;
    if project_metadata is null or octet_length(project_metadata::text)>16384
      or(project_metadata->'organization_key_present'='true'::jsonb and(jsonb_typeof(project_metadata->'organization_id') is distinct from 'string'
        or project_metadata->>'organization_id' is distinct from p_owner::text))
      or(project_metadata->'embedded_organization_key_present'='true'::jsonb and(jsonb_typeof(project_metadata->'embedded_organization_id') is distinct from 'string'
        or project_metadata->>'embedded_organization_id' is distinct from p_owner::text)) then
      raise exception using errcode='22023',message='Exact active owned project without organization conflict required';end if;
    project_pins:=project_pins||jsonb_build_array(jsonb_build_object('project_id',project_id,
      'project_sha256',encode(sha256(convert_to(project_metadata::text,'UTF8')),'hex'),
      'generation',coalesce((select generation from ecos_private.owner_source_authority_generations where owner_id=p_owner and entity_kind='project' and entity_id=project_id::text),0)));
  end loop;
  locator:=jsonb_build_object('storagePath',metadata->'storagePath','sourceProvider',metadata->'sourceProvider','externalSource',metadata->'externalSource',
    'originalFileName',metadata->'originalFileName','mimeType',metadata->'mimeType','sizeBytes',metadata->'sizeBytes',
    'webFileFingerprint',metadata->'webFileFingerprint','indexedContentSha256',metadata->'indexedContentSha256');
  source_generation:=coalesce((select generation from ecos_private.owner_source_authority_generations where owner_id=p_owner and entity_kind='source' and entity_id=p_document),0);
  state:=case when metadata->'organization_key_present'='true'::jsonb then 'null'else'missing'end;
  context_body:=jsonb_build_object('authority_policy','configured_app_owner_workspace/1.0','organization_id',p_owner,'owner_id',p_owner,'document_id',p_document,
    'document_metadata_sha256',encode(sha256(convert_to(metadata::text,'UTF8')),'hex'),'original_organization_state',state,
    'source_sha256',metadata->>'contentSha256','source_revision',metadata->'drawingRevision','source_page_count',source_count,
    'source_locator_sha256',encode(sha256(convert_to(locator::text,'UTF8')),'hex'),'source_generation',source_generation,
    'project_ids',to_jsonb(p_projects),'selected_project_pins',project_pins,'actor',actor);
  context_sha:=encode(sha256(convert_to(context_body::text,'UTF8')),'hex');
  select decision_id into previous from ecos_private.document_project_binding_heads where owner_id=p_owner and organization_id=p_owner::text and document_id=p_document;
  if p_include_review then
    old_epoch:=public.ecos_list_document_association_review_inventory(p_owner::text,p_review,p_owner,null,null,1)->>'epoch_sha256';
    review_epoch:=encode(sha256(convert_to(jsonb_build_object('association_review_epoch_sha256',old_epoch,
      'binding_context_sha256',context_sha,'expected_previous_decision_id',previous)::text,'UTF8')),'hex');
  end if;
  return jsonb_build_object('schema_version','ecos-owner-source-authority-context/2.2','publication_mode','shadow',
    'authority_policy','configured_app_owner_workspace/1.0','organization_id',p_owner,'owner_id',p_owner,'review_project_id',p_review,'document_id',p_document,
    'document_metadata_json',metadata::text,'document_metadata_sha256',context_body->'document_metadata_sha256',
    'original_organization_state',state,'source_sha256',metadata->'contentSha256','source_revision',metadata->'drawingRevision',
    'source_page_count',source_count,'source_locator_sha256',context_body->'source_locator_sha256','binding_context_sha256',context_sha,
    'review_epoch_sha256',review_epoch,'project_ids',to_jsonb(p_projects),'selected_project_pins',project_pins,'source_generation',source_generation,
    'membership_sha256',actor->'membership_sha256','expected_previous_decision_id',previous,'retrieval_authorized',false);
end;$function$;

create function ecos_private.owner_source_context_versioned(p_owner uuid,p_review uuid,p_document text,p_projects uuid[],p_include_review boolean,p_version text)
returns jsonb language plpgsql stable set search_path='' as $$
begin
 if p_version = 'ecos-document-project-binding-decision/2.1' then
  return ecos_private.owner_source_context(p_owner,p_review,p_document,p_projects,p_include_review);
 elsif p_version = 'ecos-document-project-binding-decision/2.2' then
  return ecos_private.owner_source_context_v22(p_owner,p_review,p_document,p_projects,p_include_review);
 end if;
 raise exception using errcode='22023',message='Unsupported source authority decision version';
end; $$;
revoke all on function ecos_private.owner_source_context_v22(uuid,uuid,text,uuid[],boolean) from public,anon,authenticated;
revoke all on function ecos_private.owner_source_context_versioned(uuid,uuid,text,uuid[],boolean,text) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION ecos_private.guard_document_binding_receipt()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r jsonb; d jsonb; ctx jsonb; ids uuid[]; prior ecos_private.document_project_binding_heads%rowtype;
  expected text[]:=array['schema_version','publication_mode','decision_json','decision_sha256',
  'version','previous_decision_id','binding_context_sha256','committed_at','verification','retrieval_authorized'];
begin
  if tg_op='INSERT' and new.decision_json::jsonb->>'schema_version' in ('ecos-document-project-binding-decision/2.1','ecos-document-project-binding-decision/2.2') then
    perform ecos_private.validate_owner_source_receipt(new);return new;
  end if;
  if tg_op<>'INSERT' then raise exception using errcode='22023',message='Binding receipts are append-only'; end if;
  if current_setting('transaction_isolation')<>'read committed' then raise exception using errcode='22023',message='Binding commit requires READ COMMITTED'; end if;
  d:=new.decision_json::jsonb;r:=new.receipt_json::jsonb;perform public.ecos_v2_validate_document_binding_decision(d);
  if new.decision_json<>d::text or new.receipt_json<>r::text or
    (select array_agg(key order by key)from jsonb_object_keys(r)key) is distinct from
      (select array_agg(key order by key)from unnest(expected)key)
    or r->>'schema_version' is distinct from 'ecos-document-project-binding-receipt/2.0'
    or r->>'publication_mode' is distinct from 'shadow' or r->>'verification' is distinct from 'owner_reviewed_association_only'
    or r->'retrieval_authorized' is distinct from 'false'::jsonb
    or r->>'decision_json' is distinct from new.decision_json or r->>'decision_sha256' is distinct from new.decision_sha256
    or r->'version' is distinct from to_jsonb(new.version) or r->'previous_decision_id' is distinct from coalesce(to_jsonb(new.previous_decision_id),'null'::jsonb)
    or (new.decision_id::text,new.organization_id,new.owner_id::text,new.document_id,new.previous_decision_id::text) is distinct from
      (d->>'decision_id',d->>'organization_id',d->>'owner_id',d->>'document_id',d->>'expected_previous_decision_id')
    or jsonb_typeof(r->'committed_at') is distinct from 'string' then
    raise exception using errcode='22023',message='Binding receipt exact structure mismatch'; end if;
  perform (r->>'committed_at')::timestamptz;
  ids:=array(select jsonb_array_elements_text(d->'project_ids')::uuid);
  perform public.ecos_v2_document_binding_actor(new.organization_id,new.owner_id);
  if not pg_try_advisory_xact_lock(hashtextextended('ecos-binding:'||new.organization_id||':'||new.owner_id::text||':'||new.document_id,0)) then
    raise exception using errcode='22023',message='Document binding transaction is busy'; end if;
  perform 1 from public.organization_memberships m where m.user_id=new.owner_id and m.organization_id=new.organization_id for share;
  perform 1 from public.projects p where p.owner_id=new.owner_id and p.id=any(ids) order by p.id for share;
  perform 1 from public.reference_documents s where s.owner_id=new.owner_id and s.id=new.document_id for share;
  -- Exactly one whole-review check, shared by RPC and direct service INSERT.
  -- This statement starts after the ordered row locks under READ COMMITTED.
  perform public.ecos_list_document_association_review_inventory(new.organization_id,(d->>'review_project_id')::uuid,
    new.owner_id,d->>'review_epoch_sha256',null,1);
  select * into prior from ecos_private.document_project_binding_heads h where h.organization_id=new.organization_id
    and h.owner_id=new.owner_id and h.document_id=new.document_id for update;
  if prior.decision_id is distinct from new.previous_decision_id or new.version<>coalesce(prior.version,0)+1 then
    raise exception using errcode='22023',message='Binding receipt predecessor or version changed'; end if;
  ctx:=public.ecos_v2_document_binding_context(new.organization_id,new.owner_id,new.document_id,
    ids);
  if r->>'binding_context_sha256' is distinct from ctx->>'binding_context_sha256'
    or (d->>'document_metadata_sha256',d->>'content_sha256',d->>'source_revision') is distinct from
      (ctx->>'document_metadata_sha256',ctx->>'content_sha256',ctx->>'source_revision') then
    raise exception using errcode='22023',message='Binding receipt must match current exact context'; end if;
  return new;
end;$function$;

CREATE OR REPLACE FUNCTION ecos_private.guard_document_binding_head()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r ecos_private.document_project_binding_receipts%rowtype; d jsonb;ctx jsonb;
begin
  if tg_op in('INSERT','UPDATE') and exists(select 1 from ecos_private.document_project_binding_receipts x where x.decision_id=new.decision_id and x.decision_json::jsonb->>'schema_version' in ('ecos-document-project-binding-decision/2.1','ecos-document-project-binding-decision/2.2')) then
    perform ecos_private.validate_owner_source_head(new,old,tg_op='INSERT');return new;
  end if;
  if tg_op not in('INSERT','UPDATE') then raise exception using errcode='22023',message='Binding heads cannot be removed'; end if;
  select * into r from ecos_private.document_project_binding_receipts where decision_id=new.decision_id;
  if not found or (new.organization_id,new.owner_id,new.document_id,new.version) is distinct from
      (r.organization_id,r.owner_id,r.document_id,r.version) then
    raise exception using errcode='22023',message='Binding head receipt scope mismatch'; end if;
  if tg_op='INSERT' then
    if r.previous_decision_id is not null or r.version<>1 then raise exception using errcode='22023',message='First binding head must start at version one'; end if;
  elsif (new.organization_id,new.owner_id,new.document_id) is distinct from(old.organization_id,old.owner_id,old.document_id)
    or (new.decision_id<>old.decision_id and (r.previous_decision_id is distinct from old.decision_id or new.version<>old.version+1))
    or (new.decision_id=old.decision_id and new.version<>old.version) then
    raise exception using errcode='22023',message='Binding head must advance exact predecessor without rewind';
  end if;
  d:=r.decision_json::jsonb;
  ctx:=public.ecos_v2_document_binding_context(new.organization_id,new.owner_id,new.document_id,
    array(select jsonb_array_elements_text(d->'project_ids')::uuid));
  if ctx->>'binding_context_sha256' is distinct from r.receipt_json::jsonb->>'binding_context_sha256' then
    raise exception using errcode='22023',message='Binding head current context changed'; end if;
  return new;
end;$function$;

CREATE OR REPLACE FUNCTION ecos_private.observe_owner_authority_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET "TimeZone" TO 'UTC'
 SET "DateStyle" TO 'ISO, MDY'
AS $function$
declare kind text:=tg_argv[0];old_owner uuid;new_owner uuid;old_id text;new_id text;before_pin jsonb;after_pin jsonb;
begin
  if tg_op='TRUNCATE' then
    update ecos_private.owner_source_authority_generations set generation=generation+1 where entity_kind=kind;
    return null;
  end if;
  if kind='source' then
    if tg_op<>'INSERT' then old_owner:=old.owner_id;old_id:=old.id;end if;
    if tg_op<>'DELETE' then new_owner:=new.owner_id;new_id:=new.id;end if;
  elsif kind='project' then
    if tg_op<>'INSERT' then old_owner:=old.owner_id;old_id:=old.id::text;end if;
    if tg_op<>'DELETE' then new_owner:=new.owner_id;new_id:=new.id::text;end if;
  elsif kind='member' then
    if tg_op<>'INSERT' then old_owner:=old.user_id;old_id:=old.organization_id;end if;
    if tg_op<>'DELETE' then new_owner:=new.user_id;new_id:=new.organization_id;end if;
  else
    if tg_op<>'INSERT' then old_owner:=old.user_id;old_id:=old.user_id::text;end if;
    if tg_op<>'DELETE' then new_owner:=new.user_id;new_id:=new.user_id::text;end if;
  end if;
  if not exists(select 1 from ecos_private.owner_source_authority_generations g where g.entity_kind=kind and
      ((g.owner_id=old_owner and g.entity_id=old_id)or(g.owner_id=new_owner and g.entity_id=new_id))) then return null;end if;
  if kind='source' then
    if tg_op<>'INSERT' then before_pin:=ecos_private.owner_source_metadata(old.id,old.owner_id,old.name,old.category,old.document_data,old.updated_at);end if;
    if tg_op<>'DELETE' then after_pin:=ecos_private.owner_source_metadata(new.id,new.owner_id,new.name,new.category,new.document_data,new.updated_at);end if;
  elsif kind='project' then
    if tg_op<>'INSERT' then before_pin:=ecos_private.owner_project_metadata(old);end if;
    if tg_op<>'DELETE' then after_pin:=ecos_private.owner_project_metadata(new);end if;
  else
    if tg_op<>'INSERT' then before_pin:=to_jsonb(old);end if;
    if tg_op<>'DELETE' then after_pin:=to_jsonb(new);end if;
  end if;
  -- Only the new canonical protocol excludes bookkeeping timestamps.
  -- Legacy heads retain their original generation/ABA behavior.
  if kind='source' and tg_op='UPDATE' and old_owner=new_owner and old_id=new_id
    and exists(select 1 from ecos_private.document_project_binding_heads bh
      join ecos_private.document_project_binding_receipts br on br.decision_id=bh.decision_id
      where bh.owner_id=new_owner and bh.document_id=new_id
        and br.decision_json::jsonb->>'schema_version'='ecos-document-project-binding-decision/2.2') then
    before_pin:=before_pin-'updated_at'; after_pin:=after_pin-'updated_at';
  end if;
  if before_pin is distinct from after_pin then
    update ecos_private.owner_source_authority_generations g set generation=generation+1 where g.entity_kind=kind and
      ((g.owner_id=old_owner and g.entity_id=old_id)or(g.owner_id=new_owner and g.entity_id=new_id));
  end if;
  return null;
end;$function$;

CREATE OR REPLACE FUNCTION ecos_private.validate_owner_source_decision(p jsonb)
 RETURNS void
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare extras text[]:=array['authority_policy','original_organization_state','source_page_count','source_locator_sha256','source_generation'];
begin
  if jsonb_typeof(p) is distinct from 'object' or coalesce(p->>'schema_version','') not in ('ecos-document-project-binding-decision/2.1','ecos-document-project-binding-decision/2.2')
    or p->>'authority_policy' is distinct from 'configured_app_owner_workspace/1.0'
    or p->>'organization_id' is distinct from p->>'owner_id'
    or jsonb_typeof(p->'original_organization_state') is distinct from 'string'
    or p->>'original_organization_state' not in('missing','null')
    or jsonb_typeof(p->'source_page_count') is distinct from 'number' or p->>'source_page_count' !~ '^[1-9][0-9]{0,4}$'
    or (p->>'source_page_count')::integer>10000
    or jsonb_typeof(p->'source_generation') is distinct from 'number' or p->>'source_generation' !~ '^(0|[1-9][0-9]{0,9})$'
    or (p->>'source_generation')::numeric>2147483647
    or jsonb_typeof(p->'source_locator_sha256') is distinct from 'string' or p->>'source_locator_sha256' !~ '^[a-f0-9]{64}$' then
    raise exception using errcode='22023',message='Exact owner-source /2.1 decision required';end if;
  -- Reuse ONLY the existing pure bounded primitive/selection checks. No /2.0
  -- receipt, inventory brand, context or authority is manufactured or returned.
  perform public.ecos_v2_validate_document_binding_decision((p-extras)||jsonb_build_object('schema_version','ecos-document-project-binding-decision/2.0'));
end;$function$;

CREATE OR REPLACE FUNCTION ecos_private.owner_source_receipt_shape(p ecos_private.document_project_binding_receipts)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare d jsonb:=p.decision_json::jsonb;r jsonb:=p.receipt_json::jsonb;
  expected text[]:=array['schema_version','publication_mode','decision_json','decision_sha256','version','previous_decision_id','binding_context_sha256','committed_at','verification','retrieval_authorized'];
begin
  perform ecos_private.validate_owner_source_decision(d);
  if p.decision_json<>d::text or p.receipt_json<>r::text
    or octet_length(p.decision_json)>16384 or octet_length(p.receipt_json)>32768
    or p.decision_sha256<>encode(sha256(convert_to(p.decision_json,'UTF8')),'hex')
    or p.receipt_sha256<>encode(sha256(convert_to(p.receipt_json,'UTF8')),'hex')
    or(select array_agg(key order by key)from jsonb_object_keys(r)key) is distinct from(select array_agg(key order by key)from unnest(expected)key)
    or r->>'schema_version' is distinct from replace(d->>'schema_version','binding-decision/','binding-receipt/')
    or r->>'publication_mode' is distinct from 'shadow' or r->>'verification' is distinct from 'owner_reviewed_association_only'
    or r->'retrieval_authorized' is distinct from 'false'::jsonb
    or r->>'decision_json' is distinct from p.decision_json or r->>'decision_sha256' is distinct from p.decision_sha256
    or r->'version' is distinct from to_jsonb(p.version)
    or r->'previous_decision_id' is distinct from coalesce(to_jsonb(p.previous_decision_id),'null'::jsonb)
    or(p.decision_id::text,p.organization_id,p.owner_id::text,p.document_id,p.previous_decision_id::text) is distinct from
      (d->>'decision_id',d->>'organization_id',d->>'owner_id',d->>'document_id',d->>'expected_previous_decision_id')
    or jsonb_typeof(r->'binding_context_sha256') is distinct from 'string' or r->>'binding_context_sha256' !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(r->'committed_at') is distinct from 'string' or r->>'committed_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{6}Z$'
    or(p.version=1) is distinct from(p.previous_decision_id is null) then
    raise exception using errcode='22023',message='Owner immutable receipt exact shape mismatch';end if;
  return d;
end;$function$;

CREATE OR REPLACE FUNCTION ecos_private.validate_owner_source_receipt(p ecos_private.document_project_binding_receipts)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare d jsonb:=p.decision_json::jsonb;r jsonb:=p.receipt_json::jsonb;ctx jsonb;h ecos_private.document_project_binding_heads%rowtype;ids uuid[];
  expected text[]:=array['schema_version','publication_mode','decision_json','decision_sha256','version','previous_decision_id','binding_context_sha256','committed_at','verification','retrieval_authorized'];
begin
  perform ecos_private.owner_authority_service();perform ecos_private.validate_owner_source_decision(d);
  if current_setting('transaction_isolation')<>'read committed' then raise exception using errcode='22023',message='Owner binding requires READ COMMITTED';end if;
  if p.decision_json<>d::text or p.receipt_json<>r::text
    or p.decision_sha256<>encode(sha256(convert_to(p.decision_json,'UTF8')),'hex')
    or p.receipt_sha256<>encode(sha256(convert_to(p.receipt_json,'UTF8')),'hex')
    or(select array_agg(key order by key)from jsonb_object_keys(r)key) is distinct from(select array_agg(key order by key)from unnest(expected)key)
    or r->>'schema_version' is distinct from replace(d->>'schema_version','binding-decision/','binding-receipt/')
    or r->>'publication_mode' is distinct from 'shadow' or r->>'verification' is distinct from 'owner_reviewed_association_only'
    or r->'retrieval_authorized' is distinct from 'false'::jsonb
    or r->>'decision_json' is distinct from p.decision_json or r->>'decision_sha256' is distinct from p.decision_sha256
    or r->'version' is distinct from to_jsonb(p.version)
    or r->'previous_decision_id' is distinct from coalesce(to_jsonb(p.previous_decision_id),'null'::jsonb)
    or(p.decision_id::text,p.organization_id,p.owner_id::text,p.document_id,p.previous_decision_id::text) is distinct from
      (d->>'decision_id',d->>'organization_id',d->>'owner_id',d->>'document_id',d->>'expected_previous_decision_id')
    or jsonb_typeof(r->'committed_at') is distinct from 'string' then
    raise exception using errcode='22023',message='Owner receipt exact shape mismatch';end if;
  perform (r->>'committed_at')::timestamptz;
  ids:=array(select jsonb_array_elements_text(d->'project_ids')::uuid);
  if not pg_try_advisory_xact_lock(hashtextextended('ecos-binding:'||p.organization_id||':'||p.owner_id::text||':'||p.document_id,0)) then
    raise exception using errcode='22023',message='Owner binding transaction busy';end if;
  perform 1 from app_private.dave_app_owner a where a.singleton and a.user_id=p.owner_id for share;
  perform 1 from public.organization_memberships m where m.user_id=p.owner_id and m.organization_id=p.organization_id for share;
  perform 1 from public.projects x where x.owner_id=p.owner_id and x.id=any(ids) order by x.id for share;
  perform 1 from public.reference_documents x where x.owner_id=p.owner_id and x.id=p.document_id for share;
  ctx:=ecos_private.owner_source_context_versioned(p.owner_id,(d->>'review_project_id')::uuid,p.document_id,ids,true,d->>'schema_version');
  if(d->>'review_epoch_sha256',d->>'document_metadata_sha256',d->>'content_sha256',d->>'source_revision',d->>'source_page_count',
      d->>'source_locator_sha256',d->>'source_generation',d->>'original_organization_state',r->>'binding_context_sha256') is distinct from
    (ctx->>'review_epoch_sha256',ctx->>'document_metadata_sha256',ctx->>'source_sha256',ctx->>'source_revision',ctx->>'source_page_count',
      ctx->>'source_locator_sha256',ctx->>'source_generation',ctx->>'original_organization_state',ctx->>'binding_context_sha256') then
    raise exception using errcode='22023',message='Owner receipt reviewed source or context changed';end if;
  select * into h from ecos_private.document_project_binding_heads where organization_id=p.organization_id and owner_id=p.owner_id and document_id=p.document_id for update;
  if h.decision_id is distinct from p.previous_decision_id or p.version<>coalesce(h.version,0)+1 then
    raise exception using errcode='22023',message='Owner receipt predecessor changed';end if;
end;$function$;

CREATE OR REPLACE FUNCTION ecos_private.validate_owner_source_head(p ecos_private.document_project_binding_heads, prior ecos_private.document_project_binding_heads, p_insert boolean)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r ecos_private.document_project_binding_receipts%rowtype;d jsonb;ctx jsonb;
begin
  select * into r from ecos_private.document_project_binding_receipts where decision_id=p.decision_id;
  if not found or(r.organization_id,r.owner_id,r.document_id,r.version) is distinct from(p.organization_id,p.owner_id,p.document_id,p.version) then
    raise exception using errcode='22023',message='Owner head receipt scope mismatch';end if;
  if(p_insert and(r.version<>1 or r.previous_decision_id is not null))or(not p_insert and(
    (p.organization_id,p.owner_id,p.document_id) is distinct from(prior.organization_id,prior.owner_id,prior.document_id)
    or(p.decision_id<>prior.decision_id and(r.previous_decision_id is distinct from prior.decision_id or p.version<>prior.version+1))
    or(p.decision_id=prior.decision_id and p.version<>prior.version))) then
    raise exception using errcode='22023',message='Owner head cannot rewind or change scope';end if;
  d:=r.decision_json::jsonb;perform ecos_private.validate_owner_source_decision(d);
  ctx:=ecos_private.owner_source_context_versioned(p.owner_id,(d->>'review_project_id')::uuid,p.document_id,array(select jsonb_array_elements_text(d->'project_ids')::uuid),false,d->>'schema_version');
  if ctx->>'binding_context_sha256' is distinct from r.receipt_json::jsonb->>'binding_context_sha256' then
    raise exception using errcode='22023',message='Owner head context changed';end if;
end;$function$;

CREATE OR REPLACE FUNCTION ecos_private.commit_owner_source_authority(p_decision jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET "TimeZone" TO 'UTC'
 SET "DateStyle" TO 'ISO, MDY'
 SET statement_timeout TO '20s'
AS $function$
declare d jsonb:=p_decision;owner uuid;doc text;ids uuid[];selected_id uuid;ctx jsonb;r jsonb;stored ecos_private.document_project_binding_receipts%rowtype;
  h ecos_private.document_project_binding_heads%rowtype;dsha text;rtext text;rsha text;next_version integer;
begin
  perform ecos_private.owner_authority_service();perform ecos_private.validate_owner_source_decision(d);
  if current_setting('transaction_isolation')<>'read committed' then raise exception using errcode='22023',message='Owner binding requires READ COMMITTED';end if;
  owner:=(d->>'owner_id')::uuid;doc:=d->>'document_id';ids:=array(select jsonb_array_elements_text(d->'project_ids')::uuid);
  perform ecos_private.owner_authority_actor(owner);
  if not pg_try_advisory_xact_lock(hashtextextended('ecos-binding:'||owner::text||':'||owner::text||':'||doc,0)) then
    raise exception using errcode='22023',message='Owner binding transaction busy';end if;
  dsha:=encode(sha256(convert_to(d::text,'UTF8')),'hex');
  select * into stored from ecos_private.document_project_binding_receipts where decision_id=(d->>'decision_id')::uuid;
  if found then
    perform ecos_private.owner_source_receipt_shape(stored);
    if stored.decision_json<>d::text or stored.decision_sha256<>dsha or stored.receipt_sha256<>encode(sha256(convert_to(stored.receipt_json,'UTF8')),'hex') then
      raise exception using errcode='22023',message='Owner decision ID conflicts with immutable receipt';end if;
    select * into h from ecos_private.document_project_binding_heads where organization_id=owner::text and owner_id=owner and document_id=doc;
    if not found then raise exception using errcode='22023',message='Owner committed head missing';end if;
    return jsonb_build_object('schema_version','ecos-document-project-binding-result/2.1','publication_mode','shadow','outcome','already_committed',
      'receipt_json',stored.receipt_json,'receipt_sha256',stored.receipt_sha256,'current_head_decision_id',h.decision_id);
  end if;
  perform 1 from app_private.dave_app_owner a where a.singleton and a.user_id=owner for share;
  perform 1 from public.organization_memberships m where m.user_id=owner and m.organization_id=owner::text for share;
  perform 1 from public.projects p where p.owner_id=owner and p.id=any(ids) order by p.id for share;
  perform 1 from public.reference_documents s where s.owner_id=owner and s.id=doc for share;
  ctx:=ecos_private.owner_source_context_versioned(owner,(d->>'review_project_id')::uuid,doc,ids,true,d->>'schema_version');
  if ctx->>'review_epoch_sha256' is distinct from d->>'review_epoch_sha256' then raise exception using errcode='22023',message='Owner review epoch changed';end if;
  select * into h from ecos_private.document_project_binding_heads where organization_id=owner::text and owner_id=owner and document_id=doc for update;
  if h.decision_id is distinct from(d->>'expected_previous_decision_id')::uuid then raise exception using errcode='22023',message='Owner predecessor changed';end if;
  -- Enrollment is explicit, transactional and separate from reads. Existing
  -- generations are never reset. Physical legacy parents are not FK cascades.
  insert into ecos_private.owner_source_authority_generations values(owner,'source',doc,0),(owner,'actor',owner::text,0),(owner,'member',owner::text,0)
    on conflict do nothing;
  foreach selected_id in array ids loop
    insert into ecos_private.owner_source_authority_generations values(owner,'project',selected_id::text,0) on conflict do nothing;
  end loop;
  next_version:=coalesce(h.version,0)+1;
  r:=jsonb_build_object('schema_version',replace(d->>'schema_version','binding-decision/','binding-receipt/'),'publication_mode','shadow','decision_json',d::text,'decision_sha256',dsha,
    'version',next_version,'previous_decision_id',h.decision_id,'binding_context_sha256',ctx->>'binding_context_sha256',
    'committed_at',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'verification','owner_reviewed_association_only','retrieval_authorized',false);
  rtext:=r::text;rsha:=encode(sha256(convert_to(rtext,'UTF8')),'hex');
  insert into ecos_private.document_project_binding_receipts values((d->>'decision_id')::uuid,owner::text,owner,doc,d::text,dsha,rtext,rsha,next_version,h.decision_id);
  if h.decision_id is null then insert into ecos_private.document_project_binding_heads values(owner::text,owner,doc,(d->>'decision_id')::uuid,next_version);
  else update ecos_private.document_project_binding_heads set decision_id=(d->>'decision_id')::uuid,version=next_version
    where organization_id=owner::text and owner_id=owner and document_id=doc and decision_id=h.decision_id;end if;
  return jsonb_build_object('schema_version','ecos-document-project-binding-result/2.1','publication_mode','shadow','outcome','committed',
    'receipt_json',rtext,'receipt_sha256',rsha,'current_head_decision_id',(d->>'decision_id')::uuid);
end;$function$;

CREATE OR REPLACE FUNCTION ecos_private.owner_source_authority_read_control(p_action text, p_owner uuid, p_project uuid, p_document text, p_projects uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET "TimeZone" TO 'UTC'
 SET "DateStyle" TO 'ISO, MDY'
 SET statement_timeout TO '20s'
AS $function$
declare h ecos_private.document_project_binding_heads%rowtype;r ecos_private.document_project_binding_receipts%rowtype;d jsonb;ctx jsonb;
  answer_state text:='missing';result_id uuid;result_json text;result_sha text;
begin
  perform ecos_private.owner_authority_service();perform ecos_private.owner_authority_actor(p_owner);
  if p_action='prepare' then return ecos_private.owner_source_context(p_owner,p_project,p_document,p_projects,true);end if;
  if p_action is distinct from 'read' or p_project is null or p_project::text !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
      or not public.ecos_v2_inventory_exact_text(p_document,300) then
    raise exception using errcode='22023',message='Exact owner authority read required';end if;
  select * into h from ecos_private.document_project_binding_heads where organization_id=p_owner::text and owner_id=p_owner and document_id=p_document;
  if found then
    select * into r from ecos_private.document_project_binding_receipts where decision_id=h.decision_id;
    if not found then raise exception using errcode='22023',message='Owner receipt missing';end if;
    d:=r.decision_json::jsonb;
    if d->>'schema_version' in ('ecos-document-project-binding-decision/2.1','ecos-document-project-binding-decision/2.2') and d->'project_ids' @> jsonb_build_array(p_project::text) then
      result_id:=h.decision_id;answer_state:='stale';
      begin
        perform ecos_private.owner_source_receipt_shape(r);
        if(r.organization_id,r.owner_id,r.document_id,r.version) is distinct from(h.organization_id,h.owner_id,h.document_id,h.version)
          or r.decision_sha256<>encode(sha256(convert_to(r.decision_json,'UTF8')),'hex')
          or r.receipt_sha256<>encode(sha256(convert_to(r.receipt_json,'UTF8')),'hex')
          or r.receipt_json::jsonb->>'decision_json' is distinct from r.decision_json then
          raise exception using errcode='22023',message='Owner immutable receipt mismatch';end if;
        ctx:=ecos_private.owner_source_context_versioned(p_owner,(d->>'review_project_id')::uuid,p_document,array(select jsonb_array_elements_text(d->'project_ids')::uuid),false,d->>'schema_version');
        if ctx->>'binding_context_sha256' is distinct from r.receipt_json::jsonb->>'binding_context_sha256'
          or(d->>'document_metadata_sha256',d->>'content_sha256',d->>'source_revision',d->>'source_page_count',
            d->>'source_locator_sha256',d->>'source_generation',d->>'original_organization_state') is distinct from
            (ctx->>'document_metadata_sha256',ctx->>'source_sha256',ctx->>'source_revision',ctx->>'source_page_count',
            ctx->>'source_locator_sha256',ctx->>'source_generation',ctx->>'original_organization_state') then
          raise exception using errcode='22023',message='Owner source context changed';end if;
        answer_state:='current';result_json:=r.receipt_json;result_sha:=r.receipt_sha256;
      exception when sqlstate '22023' then null;
      end;
    end if;
  end if;
  return jsonb_build_object('schema_version','ecos-document-project-binding-read/2.1','publication_mode','shadow','organization_id',p_owner,'owner_id',p_owner,
    'project_id',p_project,'document_id',p_document,'state',answer_state,'decision_id',result_id,'receipt_json',result_json,'receipt_sha256',result_sha,'retrieval_authorized',false);
end;$function$;

CREATE OR REPLACE FUNCTION ecos_private.linked_owner_project_inventory(p_org text, p_project uuid, p_owner uuid, p_expected text, p_after text, p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET "TimeZone" TO 'UTC'
 SET "DateStyle" TO 'ISO, MDY'
 SET statement_timeout TO '20s'
AS $function$
declare actor jsonb;target jsonb;bound integer;source_ids text[];head_ids text[];union_ids text[];project_ids uuid[];selected_ids uuid[];
  source_id text;project_id uuid;metadata jsonb;sources jsonb:='{}'::jsonb;heads jsonb:='{}'::jsonb;project_pins jsonb:='[]'::jsonb;
  generation_pins jsonb:='[]'::jsonb;marker_pins jsonb:='[]'::jsonb;source_pins jsonb:='[]'::jsonb;head_pins jsonb:='[]'::jsonb;
  h record;r ecos_private.document_project_binding_receipts%rowtype;d jsonb;body jsonb;marker record;
  summary jsonb;old_read jsonb;owner_read jsonb;effective jsonb;exact_primary boolean;selected boolean;current_association boolean;deleted boolean;
  all_rows jsonb:='[]'::jsonb;page_rows jsonb;epoch text;epoch_input jsonb;out jsonb;last_id text;next_id text;fingerprint_bytes bigint:=0;
begin
  perform ecos_private.owner_authority_service();actor:=ecos_private.owner_authority_actor(p_owner);
  if p_org is distinct from p_owner::text or p_project is null or p_limit is null or p_limit not between 1 and 25
    or p_project::text !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
    or(p_expected is not null and p_expected !~ '^[a-f0-9]{64}$')
    or(p_after is not null and(p_expected is null or not public.ecos_v2_inventory_exact_text(p_after,300))) then
    raise exception using errcode='22023',message='Exact owner linked inventory scope and cursor required';end if;
  select ecos_private.owner_project_metadata(p) into target from public.projects p where p.id=p_project and p.owner_id=p_owner and p.archived is false;
  if target is null or octet_length(target::text)>16384
    or(target->'organization_key_present'='true'::jsonb and(jsonb_typeof(target->'organization_id') is distinct from 'string' or target->>'organization_id' is distinct from p_org))
    or(target->'embedded_organization_key_present'='true'::jsonb and(jsonb_typeof(target->'embedded_organization_id') is distinct from 'string' or target->>'embedded_organization_id' is distinct from p_org))
    or exists(select 1 from public.dave_sync_tombstones where owner_id=p_owner and entity_type='project' and record_id=p_project::text) then
    raise exception using errcode='22023',message='Active exact owner target without deletion or organization conflict required';end if;
  -- Physical sentinels precede source/receipt metadata expansion.
  select count(*) into bound from(select 1 from public.reference_documents where owner_id=p_owner limit 501)x;
  if bound>500 then raise exception using errcode='22023',message='Owner document bound exceeds 500';end if;
  select count(*) into bound from(select 1 from ecos_private.document_project_binding_heads where owner_id=p_owner and organization_id=p_org limit 101)x;
  if bound>100 then raise exception using errcode='22023',message='Owner current head bound exceeds 100';end if;
  select coalesce(array_agg(id order by id collate "C"),array[]::text[]) into source_ids from public.reference_documents where owner_id=p_owner;
  select coalesce(array_agg(document_id order by document_id collate "C"),array[]::text[]) into head_ids from ecos_private.document_project_binding_heads where owner_id=p_owner and organization_id=p_org;
  union_ids:=array(select x from(select distinct x from unnest(source_ids||head_ids)x)u order by x collate "C");
  if cardinality(union_ids)>600 then raise exception using errcode='22023',message='Owner union bound exceeds 600';end if;
  project_ids:=array[p_project];
  for h in select * from ecos_private.document_project_binding_heads where owner_id=p_owner and organization_id=p_org order by document_id collate "C" loop
    select * into r from ecos_private.document_project_binding_receipts where decision_id=h.decision_id;
    if not found or octet_length(r.decision_json)>16384 or octet_length(r.receipt_json)>32768
      or(r.organization_id,r.owner_id,r.document_id,r.version) is distinct from(h.organization_id,h.owner_id,h.document_id,h.version)
      or r.decision_sha256<>encode(sha256(convert_to(r.decision_json,'UTF8')),'hex')
      or r.receipt_sha256<>encode(sha256(convert_to(r.receipt_json,'UTF8')),'hex') then
      raise exception using errcode='22023',message='Owner linked receipt integrity mismatch';end if;
    d:=r.decision_json::jsonb;body:=r.receipt_json::jsonb;
    if d->>'schema_version' in ('ecos-document-project-binding-decision/2.1','ecos-document-project-binding-decision/2.2') then perform ecos_private.owner_source_receipt_shape(r);
    elsif d->>'schema_version'='ecos-document-project-binding-decision/2.0' then perform public.ecos_v2_validate_document_binding_decision(d);
    else raise exception using errcode='22023',message='Unsupported owner linked receipt version';end if;
    if body->>'decision_json' is distinct from r.decision_json or body->>'decision_sha256' is distinct from r.decision_sha256
      or body->>'schema_version' is distinct from replace(d->>'schema_version','decision','receipt')
      or body->>'verification' is distinct from 'owner_reviewed_association_only' or body->'retrieval_authorized' is distinct from 'false'::jsonb
      or(d->>'decision_id',d->>'organization_id',d->>'owner_id',d->>'document_id') is distinct from(h.decision_id::text,h.organization_id,h.owner_id::text,h.document_id) then
      raise exception using errcode='22023',message='Owner linked receipt shape mismatch';end if;
    selected_ids:=array(select jsonb_array_elements_text(d->'project_ids')::uuid);
    project_ids:=array(select distinct x from unnest(project_ids||selected_ids)x order by x);
    if cardinality(project_ids)>200 then raise exception using errcode='22023',message='Owner selected project bound exceeds 200';end if;
    heads:=heads||jsonb_build_object(h.document_id,jsonb_build_object('decision',d,'receipt_json',r.receipt_json,'receipt_sha256',r.receipt_sha256));
    head_pins:=head_pins||jsonb_build_array(jsonb_build_object('document_id',h.document_id,'decision_id',h.decision_id,'version',h.version,
      'decision_sha256',r.decision_sha256,'receipt_sha256',r.receipt_sha256));
    fingerprint_bytes:=fingerprint_bytes+octet_length(r.decision_json)+octet_length(r.receipt_json);
  end loop;
  foreach project_id in array project_ids loop
    select ecos_private.owner_project_metadata(p) into metadata from public.projects p where p.id=project_id and p.owner_id=p_owner;
    if metadata is not null and octet_length(metadata::text)>16384 then raise exception using errcode='22023',message='Owner project metadata exceeds bound';end if;
    project_pins:=project_pins||jsonb_build_array(jsonb_build_object('project_id',project_id,'metadata',metadata));
    fingerprint_bytes:=fingerprint_bytes+coalesce(octet_length(metadata::text),4);
  end loop;
  foreach source_id in array union_ids loop
    if not public.ecos_v2_inventory_exact_text(source_id,300) then raise exception using errcode='22023',message='Owner source identity exceeds bound';end if;
    select ecos_private.owner_source_metadata(s.id,s.owner_id,s.name,s.category,s.document_data,s.updated_at) into metadata from public.reference_documents s where s.owner_id=p_owner and s.id=source_id;
    if metadata is not null and octet_length(metadata::text)>16384 then raise exception using errcode='22023',message='Owner source metadata exceeds bound';end if;
    sources:=sources||jsonb_build_object(source_id,metadata);
    source_pins:=source_pins||jsonb_build_array(jsonb_build_object('source_id',source_id,'metadata_sha256',case when metadata is null then null else encode(sha256(convert_to(metadata::text,'UTF8')),'hex')end));
    fingerprint_bytes:=fingerprint_bytes+coalesce(octet_length(metadata::text),4);
  end loop;
  select coalesce(jsonb_agg(to_jsonb(g) order by entity_kind collate "C",entity_id collate "C"),'[]'::jsonb) into generation_pins
    from ecos_private.owner_source_authority_generations g where g.owner_id=p_owner and(
      (g.entity_kind='source' and g.entity_id=any(union_ids))or(g.entity_kind='project' and g.entity_id=any(project_ids::text[]))
      or(g.entity_kind in('member','actor') and g.entity_id=p_owner::text));
  select count(*) into bound from(select 1 from public.dave_sync_tombstones t where t.owner_id=p_owner and
    ((t.entity_type='reference_document' and t.record_id=any(union_ids))or(t.entity_type='project' and t.record_id=any(project_ids::text[]))) limit 801)x;
  if bound>800 then raise exception using errcode='22023',message='Owner relevant marker bound exceeds 800';end if;
  for marker in select * from public.dave_sync_tombstones t where t.owner_id=p_owner and
    ((t.entity_type='reference_document' and t.record_id=any(union_ids))or(t.entity_type='project' and t.record_id=any(project_ids::text[])))
    order by entity_type collate "C",record_id collate "C" loop
    metadata:=to_jsonb(marker);
    if octet_length(metadata::text)>65536 then raise exception using errcode='22023',message='Owner marker metadata exceeds bound';end if;
    fingerprint_bytes:=fingerprint_bytes+octet_length(metadata::text);
    marker_pins:=marker_pins||jsonb_build_array(jsonb_build_object('entity_type',marker.entity_type,'record_id',marker.record_id,'metadata_sha256',encode(sha256(convert_to(metadata::text,'UTF8')),'hex')));
  end loop;
  if fingerprint_bytes>16777216 then raise exception using errcode='22023',message='Owner fingerprint work exceeds 16 MiB';end if;
  foreach source_id in array union_ids loop
    metadata:=sources->source_id;d:=heads->source_id->'decision';
    exact_primary:=metadata->>'projectId'=p_project::text and jsonb_typeof(metadata->'projectId')='string';
    selected:=coalesce(d->'project_ids' @> jsonb_build_array(p_project::text),false);
    if not coalesce(exact_primary,false) and not selected then continue;end if;
    old_read:=null;owner_read:=null;effective:=null;summary:=null;
    deleted:=exists(select 1 from public.dave_sync_tombstones where owner_id=p_owner and entity_type='reference_document' and record_id=source_id);
    if metadata<>'null'::jsonb then summary:=ecos_private.linked_registry_summary(metadata-array['organization_key_present','projectIds'],p_org,deleted);end if;
    if selected then
      if d->>'schema_version' in ('ecos-document-project-binding-decision/2.1','ecos-document-project-binding-decision/2.2') then owner_read:=ecos_private.owner_source_authority_read_control('read',p_owner,p_project,source_id,null);
      else old_read:=public.ecos_read_document_project_binding(p_org,p_owner,p_project,source_id);end if;
    end if;
    current_association:=coalesce(exact_primary,false)or coalesce(owner_read->>'state'='current',false)or coalesce(old_read->>'state'='current',false);
    if current_association and summary->>'disposition'='current_candidate' then
      effective:=jsonb_build_object('source_id',source_id,'source_sha256',summary->'source_sha256','source_revision',summary->'source_revision',
        'source_page_count',summary->'source_page_count','authority_kind','declared_organization','authority_decision_id',null,
        'authority_receipt_sha256',null,'source_locator_sha256',null);
    elsif owner_read->>'state'='current' then
      effective:=jsonb_build_object('source_id',source_id,'source_sha256',d->'content_sha256','source_revision',d->'source_revision',
        'source_page_count',d->'source_page_count','authority_kind','owner_workspace_receipt','authority_decision_id',d->'decision_id',
        'authority_receipt_sha256',owner_read->'receipt_sha256','source_locator_sha256',d->'source_locator_sha256');
    end if;
    all_rows:=all_rows||jsonb_build_array(jsonb_build_object('source_id',source_id,'registry_row',summary,
      'association_kind',case when exact_primary then'exact_primary'else'reviewed_secondary'end,
      'association_state',case when current_association then'current'else'stale'end,'binding_read',old_read,'owner_authority_read',owner_read,'effective_source',effective));
  end loop;
  if octet_length(all_rows::text)>16777216 then raise exception using errcode='22023',message='Owner linked snapshot exceeds 16 MiB';end if;
  epoch_input:=jsonb_build_object('schema_version','ecos-linked-owner-project-document-inventory/2.1','owner_id',p_owner,'project_id',p_project,
    'actor',actor,'sources',source_pins,'heads',head_pins,'projects',project_pins,'generations',generation_pins,'markers',marker_pins,'rows',all_rows);
  if octet_length(epoch_input::text)>16777216 then raise exception using errcode='22023',message='Owner combined linked snapshot exceeds 16 MiB';end if;
  epoch:=encode(sha256(convert_to(epoch_input::text,'UTF8')),'hex');
  if p_expected is not null and p_expected<>epoch then raise exception using errcode='22023',message='Owner linked inventory epoch changed';end if;
  if p_after is not null and not exists(select 1 from jsonb_array_elements(all_rows)x where x->>'source_id'=p_after) then
    raise exception using errcode='22023',message='Owner linked cursor not in exact inventory';end if;
  select coalesce(jsonb_agg(x order by x->>'source_id' collate "C"),'[]'::jsonb) into page_rows from(
    select x from jsonb_array_elements(all_rows)x where p_after is null or x->>'source_id' collate "C">p_after collate "C"
    order by x->>'source_id' collate "C" limit p_limit)y;
  last_id:=page_rows->(jsonb_array_length(page_rows)-1)->>'source_id';
  if last_id is not null and exists(select 1 from jsonb_array_elements(all_rows)x where x->>'source_id' collate "C">last_id collate "C") then next_id:=last_id;end if;
  out:=jsonb_build_object('schema_version','ecos-linked-owner-project-document-inventory/2.1','publication_mode','shadow',
    'scope','owner_workspace_primary_and_reviewed_documents_only','organization_id',p_org,'project_id',p_project,'owner_id',p_owner,
    'epoch_sha256',epoch,'total_count',jsonb_array_length(all_rows),'after_source_id',p_after,'rows',page_rows,'next_source_id',next_id,
    'legacy_name_scope','not_assessed','operational_records','not_assessed','indexing_status','not_assessed','retrieval_authorized',false);
  if octet_length(out::text)>2097152 then raise exception using errcode='22023',message='Owner linked page exceeds 2 MiB';end if;
  return out;
end;$function$;

CREATE OR REPLACE FUNCTION ecos_private.owner_index_complete_inventory(p_org text, p_project uuid, p_owner uuid, p_expected text, p_after text, p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET "TimeZone" TO 'UTC'
 SET "DateStyle" TO 'ISO, MDY'
 SET statement_timeout TO '20s'
AS $function$
declare actor jsonb;target jsonb;bound integer;source_ids text[];head_ids text[];union_ids text[];project_ids uuid[];selected_ids uuid[];
  source_id text;project_id uuid;metadata jsonb;sources jsonb:='{}'::jsonb;heads jsonb:='{}'::jsonb;project_pins jsonb:='[]'::jsonb;
  generation_pins jsonb:='[]'::jsonb;marker_pins jsonb:='[]'::jsonb;source_pins jsonb:='[]'::jsonb;head_pins jsonb:='[]'::jsonb;
  h record;r ecos_private.document_project_binding_receipts%rowtype;d jsonb;body jsonb;marker record;
  summary jsonb;old_read jsonb;owner_read jsonb;effective jsonb;exact_primary boolean;selected boolean;current_association boolean;deleted boolean;
  all_rows jsonb:='[]'::jsonb;page_rows jsonb;epoch text;epoch_input jsonb;out jsonb;last_id text;next_id text;fingerprint_bytes bigint:=0;
begin
  perform ecos_private.owner_authority_service();actor:=ecos_private.owner_authority_actor(p_owner);
  if p_org is distinct from p_owner::text or p_project is null or p_limit is null or p_limit not between 1 and 600
    or p_project::text !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
    or(p_expected is not null and p_expected !~ '^[a-f0-9]{64}$')
    or(p_after is not null and(p_expected is null or not public.ecos_v2_inventory_exact_text(p_after,300))) then
    raise exception using errcode='22023',message='Exact owner linked inventory scope and cursor required';end if;
  select ecos_private.owner_project_metadata(p) into target from public.projects p where p.id=p_project and p.owner_id=p_owner and p.archived is false;
  if target is null or octet_length(target::text)>16384
    or(target->'organization_key_present'='true'::jsonb and(jsonb_typeof(target->'organization_id') is distinct from 'string' or target->>'organization_id' is distinct from p_org))
    or(target->'embedded_organization_key_present'='true'::jsonb and(jsonb_typeof(target->'embedded_organization_id') is distinct from 'string' or target->>'embedded_organization_id' is distinct from p_org))
    or exists(select 1 from public.dave_sync_tombstones where owner_id=p_owner and entity_type='project' and record_id=p_project::text) then
    raise exception using errcode='22023',message='Active exact owner target without deletion or organization conflict required';end if;
  -- Physical sentinels precede source/receipt metadata expansion.
  select count(*) into bound from(select 1 from public.reference_documents where owner_id=p_owner limit 501)x;
  if bound>500 then raise exception using errcode='22023',message='Owner document bound exceeds 500';end if;
  select count(*) into bound from(select 1 from ecos_private.document_project_binding_heads where owner_id=p_owner and organization_id=p_org limit 101)x;
  if bound>100 then raise exception using errcode='22023',message='Owner current head bound exceeds 100';end if;
  select coalesce(array_agg(id order by id collate "C"),array[]::text[]) into source_ids from public.reference_documents where owner_id=p_owner;
  select coalesce(array_agg(document_id order by document_id collate "C"),array[]::text[]) into head_ids from ecos_private.document_project_binding_heads where owner_id=p_owner and organization_id=p_org;
  union_ids:=array(select x from(select distinct x from unnest(source_ids||head_ids)x)u order by x collate "C");
  if cardinality(union_ids)>600 then raise exception using errcode='22023',message='Owner union bound exceeds 600';end if;
  project_ids:=array[p_project];
  for h in select * from ecos_private.document_project_binding_heads where owner_id=p_owner and organization_id=p_org order by document_id collate "C" loop
    select * into r from ecos_private.document_project_binding_receipts where decision_id=h.decision_id;
    if not found or octet_length(r.decision_json)>16384 or octet_length(r.receipt_json)>32768
      or(r.organization_id,r.owner_id,r.document_id,r.version) is distinct from(h.organization_id,h.owner_id,h.document_id,h.version)
      or r.decision_sha256<>encode(sha256(convert_to(r.decision_json,'UTF8')),'hex')
      or r.receipt_sha256<>encode(sha256(convert_to(r.receipt_json,'UTF8')),'hex') then
      raise exception using errcode='22023',message='Owner linked receipt integrity mismatch';end if;
    d:=r.decision_json::jsonb;body:=r.receipt_json::jsonb;
    if d->>'schema_version' in ('ecos-document-project-binding-decision/2.1','ecos-document-project-binding-decision/2.2') then perform ecos_private.owner_source_receipt_shape(r);
    elsif d->>'schema_version'='ecos-document-project-binding-decision/2.0' then perform public.ecos_v2_validate_document_binding_decision(d);
    else raise exception using errcode='22023',message='Unsupported owner linked receipt version';end if;
    if body->>'decision_json' is distinct from r.decision_json or body->>'decision_sha256' is distinct from r.decision_sha256
      or body->>'schema_version' is distinct from replace(d->>'schema_version','decision','receipt')
      or body->>'verification' is distinct from 'owner_reviewed_association_only' or body->'retrieval_authorized' is distinct from 'false'::jsonb
      or(d->>'decision_id',d->>'organization_id',d->>'owner_id',d->>'document_id') is distinct from(h.decision_id::text,h.organization_id,h.owner_id::text,h.document_id) then
      raise exception using errcode='22023',message='Owner linked receipt shape mismatch';end if;
    selected_ids:=array(select jsonb_array_elements_text(d->'project_ids')::uuid);
    project_ids:=array(select distinct x from unnest(project_ids||selected_ids)x order by x);
    if cardinality(project_ids)>200 then raise exception using errcode='22023',message='Owner selected project bound exceeds 200';end if;
    heads:=heads||jsonb_build_object(h.document_id,jsonb_build_object('decision',d,'receipt_json',r.receipt_json,'receipt_sha256',r.receipt_sha256));
    head_pins:=head_pins||jsonb_build_array(jsonb_build_object('document_id',h.document_id,'decision_id',h.decision_id,'version',h.version,
      'decision_sha256',r.decision_sha256,'receipt_sha256',r.receipt_sha256));
    fingerprint_bytes:=fingerprint_bytes+octet_length(r.decision_json)+octet_length(r.receipt_json);
  end loop;
  foreach project_id in array project_ids loop
    select ecos_private.owner_project_metadata(p) into metadata from public.projects p where p.id=project_id and p.owner_id=p_owner;
    if metadata is not null and octet_length(metadata::text)>16384 then raise exception using errcode='22023',message='Owner project metadata exceeds bound';end if;
    project_pins:=project_pins||jsonb_build_array(jsonb_build_object('project_id',project_id,'metadata',metadata));
    fingerprint_bytes:=fingerprint_bytes+coalesce(octet_length(metadata::text),4);
  end loop;
  foreach source_id in array union_ids loop
    if not public.ecos_v2_inventory_exact_text(source_id,300) then raise exception using errcode='22023',message='Owner source identity exceeds bound';end if;
    select ecos_private.owner_source_metadata(s.id,s.owner_id,s.name,s.category,s.document_data,s.updated_at) into metadata from public.reference_documents s where s.owner_id=p_owner and s.id=source_id;
    if metadata is not null and octet_length(metadata::text)>16384 then raise exception using errcode='22023',message='Owner source metadata exceeds bound';end if;
    sources:=sources||jsonb_build_object(source_id,metadata);
    source_pins:=source_pins||jsonb_build_array(jsonb_build_object('source_id',source_id,'metadata_sha256',case when metadata is null then null else encode(sha256(convert_to(metadata::text,'UTF8')),'hex')end));
    fingerprint_bytes:=fingerprint_bytes+coalesce(octet_length(metadata::text),4);
  end loop;
  select coalesce(jsonb_agg(to_jsonb(g) order by entity_kind collate "C",entity_id collate "C"),'[]'::jsonb) into generation_pins
    from ecos_private.owner_source_authority_generations g where g.owner_id=p_owner and(
      (g.entity_kind='source' and g.entity_id=any(union_ids))or(g.entity_kind='project' and g.entity_id=any(project_ids::text[]))
      or(g.entity_kind in('member','actor') and g.entity_id=p_owner::text));
  select count(*) into bound from(select 1 from public.dave_sync_tombstones t where t.owner_id=p_owner and
    ((t.entity_type='reference_document' and t.record_id=any(union_ids))or(t.entity_type='project' and t.record_id=any(project_ids::text[]))) limit 801)x;
  if bound>800 then raise exception using errcode='22023',message='Owner relevant marker bound exceeds 800';end if;
  for marker in select * from public.dave_sync_tombstones t where t.owner_id=p_owner and
    ((t.entity_type='reference_document' and t.record_id=any(union_ids))or(t.entity_type='project' and t.record_id=any(project_ids::text[])))
    order by entity_type collate "C",record_id collate "C" loop
    metadata:=to_jsonb(marker);
    if octet_length(metadata::text)>65536 then raise exception using errcode='22023',message='Owner marker metadata exceeds bound';end if;
    fingerprint_bytes:=fingerprint_bytes+octet_length(metadata::text);
    marker_pins:=marker_pins||jsonb_build_array(jsonb_build_object('entity_type',marker.entity_type,'record_id',marker.record_id,'metadata_sha256',encode(sha256(convert_to(metadata::text,'UTF8')),'hex')));
  end loop;
  if fingerprint_bytes>16777216 then raise exception using errcode='22023',message='Owner fingerprint work exceeds 16 MiB';end if;
  foreach source_id in array union_ids loop
    metadata:=sources->source_id;d:=heads->source_id->'decision';
    exact_primary:=metadata->>'projectId'=p_project::text and jsonb_typeof(metadata->'projectId')='string';
    selected:=coalesce(d->'project_ids' @> jsonb_build_array(p_project::text),false);
    if not coalesce(exact_primary,false) and not selected then continue;end if;
    old_read:=null;owner_read:=null;effective:=null;summary:=null;
    deleted:=exists(select 1 from public.dave_sync_tombstones where owner_id=p_owner and entity_type='reference_document' and record_id=source_id);
    if metadata<>'null'::jsonb then summary:=ecos_private.linked_registry_summary(metadata-array['organization_key_present','projectIds'],p_org,deleted);end if;
    if selected then
      if d->>'schema_version' in ('ecos-document-project-binding-decision/2.1','ecos-document-project-binding-decision/2.2') then owner_read:=ecos_private.owner_source_authority_read_control('read',p_owner,p_project,source_id,null);
      else old_read:=public.ecos_read_document_project_binding(p_org,p_owner,p_project,source_id);end if;
    end if;
    current_association:=coalesce(exact_primary,false)or coalesce(owner_read->>'state'='current',false)or coalesce(old_read->>'state'='current',false);
    if current_association and summary->>'disposition'='current_candidate' then
      effective:=jsonb_build_object('source_id',source_id,'source_sha256',summary->'source_sha256','source_revision',summary->'source_revision',
        'source_page_count',summary->'source_page_count','authority_kind','declared_organization','authority_decision_id',null,
        'authority_receipt_sha256',null,'source_locator_sha256',null);
    elsif owner_read->>'state'='current' then
      effective:=jsonb_build_object('source_id',source_id,'source_sha256',d->'content_sha256','source_revision',d->'source_revision',
        'source_page_count',d->'source_page_count','authority_kind','owner_workspace_receipt','authority_decision_id',d->'decision_id',
        'authority_receipt_sha256',owner_read->'receipt_sha256','source_locator_sha256',d->'source_locator_sha256');
    end if;
    all_rows:=all_rows||jsonb_build_array(jsonb_build_object('source_id',source_id,'registry_row',summary,
      'association_kind',case when exact_primary then'exact_primary'else'reviewed_secondary'end,
      'association_state',case when current_association then'current'else'stale'end,'binding_read',old_read,'owner_authority_read',owner_read,'effective_source',effective));
  end loop;
  if octet_length(all_rows::text)>16777216 then raise exception using errcode='22023',message='Owner linked snapshot exceeds 16 MiB';end if;
  epoch_input:=jsonb_build_object('schema_version','ecos-linked-owner-project-document-inventory/2.1','owner_id',p_owner,'project_id',p_project,
    'actor',actor,'sources',source_pins,'heads',head_pins,'projects',project_pins,'generations',generation_pins,'markers',marker_pins,'rows',all_rows);
  if octet_length(epoch_input::text)>16777216 then raise exception using errcode='22023',message='Owner combined linked snapshot exceeds 16 MiB';end if;
  epoch:=encode(sha256(convert_to(epoch_input::text,'UTF8')),'hex');
  if p_expected is not null and p_expected<>epoch then raise exception using errcode='22023',message='Owner linked inventory epoch changed';end if;
  if p_after is not null and not exists(select 1 from jsonb_array_elements(all_rows)x where x->>'source_id'=p_after) then
    raise exception using errcode='22023',message='Owner linked cursor not in exact inventory';end if;
  select coalesce(jsonb_agg(x order by x->>'source_id' collate "C"),'[]'::jsonb) into page_rows from(
    select x from jsonb_array_elements(all_rows)x where p_after is null or x->>'source_id' collate "C">p_after collate "C"
    order by x->>'source_id' collate "C" limit p_limit)y;
  last_id:=page_rows->(jsonb_array_length(page_rows)-1)->>'source_id';
  if last_id is not null and exists(select 1 from jsonb_array_elements(all_rows)x where x->>'source_id' collate "C">last_id collate "C") then next_id:=last_id;end if;
  out:=jsonb_build_object('schema_version','ecos-linked-owner-project-document-inventory/2.1','publication_mode','shadow',
    'scope','owner_workspace_primary_and_reviewed_documents_only','organization_id',p_org,'project_id',p_project,'owner_id',p_owner,
    'epoch_sha256',epoch,'total_count',jsonb_array_length(all_rows),'after_source_id',p_after,'rows',page_rows,'next_source_id',next_id,
    'legacy_name_scope','not_assessed','operational_records','not_assessed','indexing_status','not_assessed','retrieval_authorized',false);
  if octet_length(out::text)>16777216 then raise exception using errcode='22023',message='Owner index complete inventory exceeds 16 MiB';end if;
  return out;
end;$function$;

create function public.ecos_prepare_owner_source_authority_v22(p_owner_id uuid,p_review_project_id uuid,p_document_id text,p_project_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform ecos_private.owner_authority_service();
 perform ecos_private.owner_authority_actor(p_owner_id);
 return ecos_private.owner_source_context_v22(p_owner_id,p_review_project_id,p_document_id,p_project_ids,true);
end; $$;
revoke all on function public.ecos_prepare_owner_source_authority_v22(uuid,uuid,text,uuid[]) from public,anon,authenticated;
grant execute on function public.ecos_prepare_owner_source_authority_v22(uuid,uuid,text,uuid[]) to service_role;

commit;
