-- This rehearsal runs only after the frozen Build 160 five-migration chain is
-- applied and verified. The two post-frozen migrations are injected at the
-- markers below, exercised inside one outer transaction, and rolled back.

do $postfrozen_precondition$
declare
  actual_versions text[];
  expected_versions constant text[] := array[
    '20260809193726',
    '20260809195802',
    '20260809201435',
    '20260809222329',
    '20260810013000'
  ];
begin
  select coalesce(array_agg(version order by version), array[]::text[])
    into actual_versions
  from supabase_migrations.schema_migrations
  where version >= expected_versions[1];
  if actual_versions is distinct from expected_versions then
    raise exception 'post-frozen rehearsal requires the exact verified frozen-five database tip';
  end if;
  if to_regprocedure('public.dave_delete_project_atomically(text)') is null
      or to_regprocedure('public.dave_delete_project_atomically(text,text)') is not null
      or to_regprocedure(
        'public.dave_commit_project_cover_photo(text,text,jsonb,text,text,jsonb,text,text)'
      ) is not null then
    raise exception 'post-frozen rehearsal did not start from the sealed pre-transition function surface';
  end if;
end
$postfrozen_precondition$;

begin;
set local statement_timeout = '15min';
set local lock_timeout = '5s';

-- @apply-post-frozen-migration 20260811021601
-- @apply-post-frozen-migration 20260811151028

do $postfrozen_catalog$
declare
  storage_policy_catalog text[];
begin
  if to_regprocedure('public.dave_delete_project_atomically(text)') is not null
      or to_regprocedure('public.dave_delete_project_atomically(text,text)') is null
      or to_regprocedure(
        'public.dave_commit_project_cover_photo(text,text,jsonb,text,text,jsonb,text,text)'
      ) is null then
    raise exception 'post-frozen function transition is incomplete';
  end if;
  if has_function_privilege(
    'anon',
    'public.dave_delete_project_atomically(text,text)',
    'EXECUTE'
  ) or not has_function_privilege(
    'authenticated',
    'public.dave_delete_project_atomically(text,text)',
    'EXECUTE'
  ) then
    raise exception 'exact project-delete function ACL is unsafe';
  end if;
  if has_function_privilege(
    'anon',
    'public.dave_commit_project_cover_photo(text,text,jsonb,text,text,jsonb,text,text)',
    'EXECUTE'
  ) or not has_function_privilege(
    'authenticated',
    'public.dave_commit_project_cover_photo(text,text,jsonb,text,text,jsonb,text,text)',
    'EXECUTE'
  ) then
    raise exception 'project-cover commit function ACL is unsafe';
  end if;
  select coalesce(
    array_agg(
      policy_record.policyname || ':' || policy_record.cmd || ':' || policy_record.permissive
      order by policy_record.policyname
    ),
    array[]::text[]
  ) into storage_policy_catalog
  from pg_policies policy_record
  where policy_record.schemaname = 'storage'
    and policy_record.tablename = 'objects'
    and policy_record.policyname like 'project_photos_%'
    and policy_record.cmd in ('UPDATE', 'DELETE');
  if storage_policy_catalog is distinct from array[
    'project_photos_authenticated_delete:DELETE:PERMISSIVE',
    'project_photos_authenticated_update:UPDATE:PERMISSIVE'
  ]::text[] then
    raise exception 'project-cover storage policy catalog contains an unexpected authorizer';
  end if;
end
$postfrozen_catalog$;

do $postfrozen_fixture$
declare
  target_owner uuid;
  cover_result jsonb;
  cover_retry jsonb;
begin
  select owner.user_id into target_owner
  from app_private.dave_app_owner as owner
  where owner.singleton;
  if target_owner is null then
    raise exception 'post-frozen rehearsal could not resolve the sealed app owner';
  end if;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', target_owner::text, 'role', 'authenticated')::text,
    true
  );
  perform set_config('request.jwt.claim.sub', target_owner::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  insert into public.projects (id, owner_id, name, project_data) values
    (
      '91000000-0000-4000-8000-000000000001',
      target_owner,
      'Post-frozen Same Name Fixture',
      '{}'::jsonb
    ),
    (
      '91000000-0000-4000-8000-000000000002',
      target_owner,
      'Post-frozen Same Name Fixture',
      '{}'::jsonb
    ),
    (
      '91000000-0000-4000-8000-000000000003',
      target_owner,
      'Post-frozen Cover Fixture',
      '{"coverPhoto":null,"coverPhotoMode":"automatic","coverPhotoUpdatedAt":null}'::jsonb
    );

  insert into public.project_updates (
    id, owner_id, project_id, project_name, update_data
  ) values
    (
      'postfrozen-update-a', target_owner,
      '91000000-0000-4000-8000-000000000001',
      'Post-frozen Same Name Fixture',
      '{"id":"postfrozen-update-a","projectId":"91000000-0000-4000-8000-000000000001"}'::jsonb
    ),
    (
      'postfrozen-update-b', target_owner,
      '91000000-0000-4000-8000-000000000002',
      'Post-frozen Same Name Fixture',
      '{"id":"postfrozen-update-b","projectId":"91000000-0000-4000-8000-000000000002"}'::jsonb
    );

  insert into public.schedule_items (
    id, owner_id, project_id, project_name, task_name, item_data
  ) values
    (
      'postfrozen-task-a', target_owner,
      '91000000-0000-4000-8000-000000000001',
      'Post-frozen Same Name Fixture', 'Fixture A',
      '{"id":"postfrozen-task-a","projectId":"91000000-0000-4000-8000-000000000001"}'::jsonb
    ),
    (
      'postfrozen-task-b', target_owner,
      '91000000-0000-4000-8000-000000000002',
      'Post-frozen Same Name Fixture', 'Fixture B',
      '{"id":"postfrozen-task-b","projectId":"91000000-0000-4000-8000-000000000002"}'::jsonb
    );

  perform public.dave_delete_project_atomically(
    '91000000-0000-4000-8000-000000000001',
    'Post-frozen Same Name Fixture'
  );
  if exists (
    select 1 from public.projects
    where id = '91000000-0000-4000-8000-000000000001'
  ) or not exists (
    select 1 from public.projects
    where id = '91000000-0000-4000-8000-000000000002'
  ) then
    raise exception 'exact project delete did not preserve the same-name sibling';
  end if;
  if exists (
    select 1 from public.project_updates
    where project_id = '91000000-0000-4000-8000-000000000001'
  ) or not exists (
    select 1 from public.project_updates
    where project_id = '91000000-0000-4000-8000-000000000002'
  ) then
    raise exception 'exact project delete crossed the update identity boundary';
  end if;
  if exists (
    select 1 from public.schedule_items
    where project_id = '91000000-0000-4000-8000-000000000001'
  ) or not exists (
    select 1 from public.schedule_items
    where project_id = '91000000-0000-4000-8000-000000000002'
  ) then
    raise exception 'exact project delete crossed the task identity boundary';
  end if;

  insert into storage.objects (
    bucket_id, name, metadata, user_metadata
  ) values (
    'project-photos',
    'project-covers/91000000-0000-4000-8000-000000000003/revisions/92000000-0000-4000-8000-000000000001.jpg',
    '{"size":1234}'::jsonb,
    '{"vitruviusContentSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","vitruviusSizeBytes":"1234"}'::jsonb
  );

  cover_result := public.dave_commit_project_cover_photo(
    '91000000-0000-4000-8000-000000000003',
    'Post-frozen Cover Fixture',
    null,
    'automatic',
    null,
    '{"remotePath":"project-covers/91000000-0000-4000-8000-000000000003/revisions/92000000-0000-4000-8000-000000000001.jpg","mimeType":"image/jpeg","updatedAt":"2026-08-11T19:00:00.000Z","contentSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","sizeBytes":1234}'::jsonb,
    'manual',
    '2026-08-11T19:00:00.000Z'
  );
  if cover_result ->> 'status' <> 'committed' then
    raise exception 'exact immutable cover receipt did not commit';
  end if;
  cover_retry := public.dave_commit_project_cover_photo(
    '91000000-0000-4000-8000-000000000003',
    'Post-frozen Cover Fixture',
    null,
    'automatic',
    null,
    '{"remotePath":"project-covers/91000000-0000-4000-8000-000000000003/revisions/92000000-0000-4000-8000-000000000001.jpg","mimeType":"image/jpeg","updatedAt":"2026-08-11T19:00:00.000Z","contentSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","sizeBytes":1234}'::jsonb,
    'manual',
    '2026-08-11T19:00:00.000Z'
  );
  if cover_retry ->> 'status' <> 'already_committed' then
    raise exception 'project-cover lost-response retry was not idempotent';
  end if;
end
$postfrozen_fixture$;

set local role authenticated;
do $postfrozen_direct_cover_guard$
begin
  begin
    update public.projects
    set project_data = jsonb_set(
      project_data,
      '{coverPhotoUpdatedAt}',
      '"2026-08-11T19:01:00.000Z"'::jsonb
    )
    where id = '91000000-0000-4000-8000-000000000003';
    raise exception 'direct cover mutation bypassed atomic authority';
  exception when insufficient_privilege then
    null;
  end;
end
$postfrozen_direct_cover_guard$;
reset role;

rollback;

do $postfrozen_rollback_proof$
declare
  actual_versions text[];
  expected_versions constant text[] := array[
    '20260809193726',
    '20260809195802',
    '20260809201435',
    '20260809222329',
    '20260810013000'
  ];
begin
  select coalesce(array_agg(version order by version), array[]::text[])
    into actual_versions
  from supabase_migrations.schema_migrations
  where version >= expected_versions[1];
  if actual_versions is distinct from expected_versions
      or to_regprocedure('public.dave_delete_project_atomically(text)') is null
      or to_regprocedure('public.dave_delete_project_atomically(text,text)') is not null
      or to_regprocedure(
        'public.dave_commit_project_cover_photo(text,text,jsonb,text,text,jsonb,text,text)'
      ) is not null
      or exists (
        select 1 from public.projects
        where id::text like '91000000-0000-4000-8000-00000000000%'
      ) then
    raise exception 'post-frozen outer transaction did not restore the exact preapply state';
  end if;
end
$postfrozen_rollback_proof$;

select jsonb_build_object(
  'receipt', 'VITRUVIUS_POSTFROZEN_MIGRATION_REHEARSAL_OK',
  'migrationOrder', jsonb_build_array('20260811021601', '20260811151028'),
  'outerTransactionRolledBack', true,
  'exactProjectDeletion', true,
  'sameNameSiblingPreserved', true,
  'coverReceiptCommitted', true,
  'coverRetryIdempotent', true,
  'directCoverMutationDenied', true,
  'providerCallsMade', 0
)::text as vitruvius_postfrozen_migration_rehearsal_receipt;
