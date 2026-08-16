import fs from 'node:fs';
import path from 'node:path';

const migrationPath = path.resolve(
  __dirname,
  '../../supabase/migrations/20260811151028_dave_project_cover_commit_authority.sql',
);

describe('project cover photo compare-and-swap migration', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');

  it('locks one exact owner project and compares the previous cover revision', () => {
    expect(sql).toContain('create or replace function public.dave_commit_project_cover_photo(');
    expect(sql).toContain('pg_advisory_xact_lock(');
    expect(sql).toContain('for update');
    expect(sql).toContain('current_cover_photo_mode <> p_expected_cover_photo_mode');
    expect(sql).toContain('current_cover_updated_at is distinct from p_expected_cover_updated_at');
    expect(sql).toContain('current_cover_photo is distinct from p_expected_cover_photo');
    expect(sql).toContain('btrim(current_project_name) <> expected_project_name');
    expect(sql).toContain('project_record.owner_id = auth_user');
    expect(sql).toContain('coalesce(project_record.archived, false) = false');
  });

  it('requires immutable revision paths and preserves unrelated project metadata', () => {
    expect(sql).toContain("'^project-covers/' || project_id ||");
    expect(sql).toContain("'/revisions/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab]");
    expect(sql).toContain("current_data - 'coverPhoto' - 'coverPhotoMode' - 'coverPhotoUpdatedAt'");
    expect(sql).toContain("jsonb_build_object(");
    expect(sql).toContain("'coverPhoto', target_cover_photo");
    expect(sql).toContain("cover_object.bucket_id = 'project-photos'");
    expect(sql).toContain('cover_object.name = target_remote_path');
    expect(sql).toContain("cover_object.user_metadata ->> 'vitruviusContentSha256'");
    expect(sql).toContain("cover_object.user_metadata ->> 'vitruviusSizeBytes'");
    expect(sql).toContain("cover_object.metadata ->> 'size' = target_size_bytes::text");
  });

  it('makes committed revision objects immutable while allowing explicit orphan cleanup', () => {
    expect(sql).toContain('drop policy if exists project_photos_owner_update');
    expect(sql).toContain('drop policy if exists project_photos_owner_delete');
    expect(sql).toContain('drop policy if exists project_photos_authenticated_update');
    expect(sql).toContain('drop policy if exists project_photos_authenticated_delete');
    expect(sql).toContain("name !~");
    expect(sql).toContain("storage.objects.name");
    expect(sql).toContain("referenced_project.project_data #>> '{coverPhoto,remotePath}'");
  });

  it('is idempotent and restricts the public RPC surface', () => {
    expect(sql).toContain("'already_committed'");
    expect(sql).toContain("'conflict'");
    expect(sql).toContain('security definer');
    expect(sql).toContain('revoke all on function public.dave_commit_project_cover_photo(');
    expect(sql).toContain('grant execute on function public.dave_commit_project_cover_photo(');
    expect(sql).toContain("raise exception 'project cover authority requires atomic commit'");
  });

  it('queues cleanup only after a committed cover path is replaced', () => {
    expect(sql).toContain('create trigger dave_project_cover_storage_cleanup_update_trigger');
    expect(sql).toContain('after update of project_data on public.projects');
    expect(sql).toContain("old.project_data #>> '{coverPhoto,remotePath}'");
    expect(sql).toContain("new.project_data #>> '{coverPhoto,remotePath}'");
  });
});
