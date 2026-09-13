import fs from 'node:fs';
import path from 'node:path';

const migration = fs.readFileSync(
  path.resolve(
    __dirname,
    '../../supabase/migrations/20260913180500_ecos_project_question_scoped_records.sql',
  ),
  'utf8',
);

describe('Ask ECOS project-scoped record loader migration', () => {
  it('requires the signed-in owner and exact active project identity', () => {
    expect(migration).toContain('caller_id uuid := auth.uid()');
    expect(migration).toContain('project.owner_id = caller_id');
    expect(migration).toContain('project.id::text = target_project_id');
    expect(migration).toContain('lower(btrim(project.name)) = lower(target_project_name)');
    expect(migration).toContain('project.archived = false');
  });

  it('uses exact project ids before the bounded legacy-name fallback', () => {
    for (const tableAlias of ['item', 'update_record', 'note']) {
      expect(migration).toContain(
        `lower(btrim(coalesce(${tableAlias}.project_id, ''))) = lower(target_project_id)`,
      );
      expect(migration).toContain(`btrim(coalesce(${tableAlias}.project_id, '')) = ''`);
    }
    expect(migration).toContain('limit task_limit + 1');
    expect(migration).toContain('limit update_limit + 1');
    expect(migration).toContain('limit note_limit + 1');
    expect(migration).toContain('raise program_limit_exceeded');
  });

  it('does not expose the security-definer function to anonymous callers', () => {
    expect(migration).toContain('security definer');
    expect(migration).toMatch(/revoke all on function[\s\S]*from public, anon;/);
    expect(migration).toMatch(/grant execute on function[\s\S]*to authenticated, service_role;/);
  });
});
