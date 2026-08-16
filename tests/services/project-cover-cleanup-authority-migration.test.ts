import fs from 'node:fs';
import path from 'node:path';

const migrationPath = path.resolve(
  __dirname,
  '../../supabase/migrations/20260811235642_dave_project_cover_cleanup_authority.sql',
);

describe('project cover cleanup authority migration', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');

  it('serializes Storage deletion with the exact cover commit lock and project row', () => {
    expect(sql).toContain(
      'create or replace function public.dave_guard_project_cover_storage_delete()',
    );
    expect(sql).toContain("auth_user::text || ':project-cover:' || project_id");
    expect(sql).toContain('pg_advisory_xact_lock(');
    expect(sql).toContain('project_record.owner_id = auth_user');
    expect(sql).toContain('project_record.id::text = project_id');
    expect(sql).toContain('for update');
  });

  it('rejects deletion of any exact object referenced by a committed cover receipt', () => {
    expect(sql).toContain(
      "referenced_project.project_data #>> '{coverPhoto,remotePath}' = old.name",
    );
    expect(sql).toContain("raise insufficient_privilege using message = 'committed project cover cannot be deleted'");
  });

  it('installs one before-delete trigger on the supported Storage API path', () => {
    expect(sql).toContain(
      'drop trigger if exists dave_project_cover_storage_delete_guard on storage.objects',
    );
    expect(sql).toContain('before delete on storage.objects');
    expect(sql).toContain(
      'for each row execute function public.dave_guard_project_cover_storage_delete()',
    );
    expect(sql).not.toContain('delete from storage.objects');
  });

  it('keeps direct function execution unavailable to app roles', () => {
    expect(sql).toContain('security definer');
    expect(sql).toContain(
      'revoke all on function public.dave_guard_project_cover_storage_delete()',
    );
    expect(sql).not.toContain('grant execute on function public.dave_guard_project_cover_storage_delete()');
  });
});
