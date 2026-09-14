-- Run inside a caller-owned BEGIN/ROLLBACK, never COMMIT. Requires disposable
-- fixture membership identifiers in vitruvius.test_owner/org/project settings.
-- This exercises the database authorization predicate, not a real app login.
set local statement_timeout = '15s';
set local lock_timeout = '2s';
do $test$
declare
  actor uuid := current_setting('vitruvius.test_owner')::uuid;
  org text := current_setting('vitruvius.test_org');
  project text := current_setting('vitruvius.test_project');
  org_row public.organization_memberships%rowtype;
  project_row public.vitruvius_project_memberships%rowtype;
  rejected_status text;
begin
  select * into strict org_row from public.organization_memberships
    where user_id=actor and organization_id=org;
  select * into strict project_row from public.vitruvius_project_memberships
    where user_id=actor and organization_id=org and project_id=project;
  assert org_row.status='active' and org_row.role<>'organization_admin';
  assert project_row.status='active' and project_row.role='project_manager';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  assert public.vitruvius_has_project_permission(org,project,'ask_ecos'), 'active member denied';
  assert public.vitruvius_has_project_permission(org,project,'manage_documents'), 'legitimate role denied';
  assert not public.vitruvius_has_project_permission(org,project,'delete_project'), 'role escalation';
  assert not public.vitruvius_has_project_permission(org,project,'unknown_permission');
  assert not public.vitruvius_has_project_permission(org,gen_random_uuid()::text,'ask_ecos'), 'cross project';
  assert not public.vitruvius_has_project_permission(gen_random_uuid()::text,project,'ask_ecos'), 'cross organization';
  foreach rejected_status in array array['invited','suspended','removed'] loop
    update public.organization_memberships set status=rejected_status where id=org_row.id;
    assert not public.vitruvius_has_project_permission(org,project,'ask_ecos'), 'organization revocation failed';
    update public.organization_memberships set status='active' where id=org_row.id;
    update public.vitruvius_project_memberships set status=rejected_status where id=project_row.id;
    assert not public.vitruvius_has_project_permission(org,project,'ask_ecos'), 'project revocation failed';
    update public.vitruvius_project_memberships set status='active' where id=project_row.id;
  end loop;
  -- A subtransaction restores deleted fixture memberships immediately.
  begin
    delete from public.organization_memberships where id=org_row.id;
    assert not public.vitruvius_has_project_permission(org,project,'ask_ecos'), 'missing organization allowed';
    raise exception using errcode='U0001',message='restore fixture';
  exception when sqlstate 'U0001' then null;
  end;
  begin
    delete from public.vitruvius_project_memberships where id=project_row.id;
    assert not public.vitruvius_has_project_permission(org,project,'ask_ecos'), 'missing project allowed';
    update public.organization_memberships set role='organization_admin' where id=org_row.id;
    assert public.vitruvius_has_project_permission(org,project,'ask_ecos'), 'active admin without project denied';
    assert public.vitruvius_has_project_permission(org,project,'delete_project'), 'legitimate admin denied';
    update public.organization_memberships set status='suspended' where id=org_row.id;
    assert not public.vitruvius_has_project_permission(org,project,'ask_ecos'), 'suspended admin allowed';
    raise exception using errcode='U0001',message='restore fixture';
  exception when sqlstate 'U0001' then null;
  end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'role','authenticated')::text,true);
  assert not public.vitruvius_has_project_permission(org,project,'ask_ecos'), 'other user allowed';
  perform set_config('request.jwt.claims','{}',true);
  assert not public.vitruvius_has_project_permission(org,project,'ask_ecos'), 'missing caller allowed';
  -- Hosted legacy ACL grants anon EXECUTE; null auth.uid() must still deny.
  -- Preserve this API contract rather than silently changing grants here.
  assert has_function_privilege('authenticated','public.vitruvius_has_project_permission(text,text,text)','EXECUTE');
  assert has_function_privilege('service_role','public.vitruvius_has_project_permission(text,text,text)','EXECUTE');
  assert (select to_jsonb(m) - 'updated_at' from public.organization_memberships m where id=org_row.id) = to_jsonb(org_row) - 'updated_at';
  assert (select to_jsonb(m) - 'updated_at' from public.vitruvius_project_memberships m where id=project_row.id) = to_jsonb(project_row) - 'updated_at';
end;
$test$;
select 'beta_organization_permission_regression_pass' as result;
