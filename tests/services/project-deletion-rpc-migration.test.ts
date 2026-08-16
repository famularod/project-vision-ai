import fs from 'node:fs';
import path from 'node:path';

describe('exact project deletion RPC migration', () => {
  const migration = fs.readFileSync(path.join(
    process.cwd(),
    'supabase/migrations/20260811021601_exact_project_delete_rpc.sql',
  ), 'utf8');
  const rpc = migration.slice(
    migration.indexOf('create function public.dave_delete_project_atomically('),
    migration.indexOf('revoke all on function public.dave_delete_project_atomically(text, text)'),
  );
  const mutationTail = rpc.slice(rpc.indexOf('insert into public.dave_sync_tombstones'));

  it('removes the legacy one-argument route before publishing the exact pair', () => {
    const legacyRevoke = migration.indexOf(
      'revoke all on function public.dave_delete_project_atomically(text)',
    );
    const legacyDrop = migration.indexOf(
      'drop function if exists public.dave_delete_project_atomically(text)',
    );
    const exactCreate = migration.indexOf(
      'create function public.dave_delete_project_atomically(',
    );
    expect(legacyRevoke).toBeGreaterThan(0);
    expect(legacyDrop).toBeGreaterThan(legacyRevoke);
    expect(exactCreate).toBeGreaterThan(legacyDrop);
    expect(migration).toContain('p_project_id text,\n  p_project_name text');
    expect(migration).not.toContain('grant execute on function public.dave_delete_project_atomically(text)');
  });

  it('authorizes, validates, locks, and selects one owner-scoped UUID', () => {
    expect(rpc).toContain('auth_user uuid := auth.uid()');
    expect(rpc).toContain('not public.dave_is_app_owner()');
    expect(rpc).toContain('p_project_id <> lower(p_project_id)');
    expect(rpc).toContain("'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'");
    expect(rpc).toContain("':delete-project:' || target_project_id");
    expect(rpc).toContain('project_record.owner_id = auth_user');
    expect(rpc).toContain('project_record.id::text = target_project_id');
    expect(rpc).toContain('btrim(project_record_name) <> target_project_name');
    expect(rpc).not.toContain('order by project_record.created_at');
    expect(rpc).not.toContain('limit 1');
  });

  it('fails closed on target-looking children that lack exact project binding', () => {
    const firstTombstoneWrite = rpc.indexOf('insert into public.dave_sync_tombstones');
    for (const guard of [
      'project deletion blocked by name-only project update',
      'project deletion blocked by name-only schedule item',
      'project deletion blocked by name-only project area',
      'project deletion blocked by reference document without exact single-project binding',
    ]) {
      expect(rpc.indexOf(guard)).toBeGreaterThan(0);
      expect(rpc.indexOf(guard)).toBeLessThan(firstTombstoneWrite);
    }
    expect(rpc).toContain('bound_project.id::text = update_record.project_id');
    expect(rpc).toContain('bound_project.id::text = schedule_record.project_id');
    expect(rpc).toContain("area_record.area_data ->> 'projectId'");
    expect(rpc).toContain("document_record.document_data ->> 'projectId'");
    expect(rpc).toContain("then document_record.document_data -> 'projectNames'");
  });

  it('deletes A and its children only by immutable ID, preserving same-name B', () => {
    for (const exactPredicate of [
      'update_record.project_id = target_project_id',
      'schedule_record.project_id = target_project_id',
      "area_record.area_data ->> 'projectId' = target_project_id",
      'project_record.id::text = target_project_id',
    ]) expect(mutationTail).toContain(exactPredicate);
    expect(rpc).toContain("document_record.document_data ->> 'projectId' = target_project_id");
    expect(mutationTail).toContain('document_record.id::text = any(deleted_document_ids)');

    const deleteStatements = mutationTail.match(/delete from[\s\S]*?;/g) || [];
    expect(deleteStatements).toHaveLength(5);
    deleteStatements.forEach(statement => {
      expect(statement).not.toContain('lower(target_project_name)');
      expect(statement).not.toContain("->> 'projectName'");
    });
    expect(mutationTail).toContain("'project',\n    target_project_id");
  });

  it('allows only a tombstoned exact-ID retry when the project is already absent', () => {
    expect(rpc).toContain("existing_tombstone.entity_type = 'project'");
    expect(rpc).toContain('existing_tombstone.record_id = target_project_id');
    expect(rpc).toContain("message = 'exact project is unavailable'");
    expect(rpc).toContain("'already_absent', not project_was_present");
  });

  it('uses a hardened security-definer ACL for the only callable signature', () => {
    expect(rpc).toContain('security definer');
    expect(rpc).toContain("set search_path = ''");
    expect(migration).toContain(
      'revoke all on function public.dave_delete_project_atomically(text, text)\n  from public, anon;',
    );
    expect(migration).toContain(
      'grant execute on function public.dave_delete_project_atomically(text, text)\n  to authenticated;',
    );
  });
});
