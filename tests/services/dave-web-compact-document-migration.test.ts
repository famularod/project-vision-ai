import fs from 'node:fs';
import path from 'node:path';

const sql = fs.readFileSync(
  path.join(
    process.cwd(),
    'supabase/migrations/20260813212000_dave_compact_reference_document_list.sql',
  ),
  'utf8',
);

describe('DAVE compact reference-document listing migration', () => {
  test('retains the exact owner boundary and removes only redundant index payloads', () => {
    expect(sql).toContain('current_owner uuid := auth.uid()');
    expect(sql).toContain('not public.dave_is_app_owner()');
    expect(sql).toContain("set statement_timeout = '60s'");
    expect(sql).toContain("- 'extractedPages'");
    expect(sql).toContain("- 'extractedText'");
    expect(sql).toContain('where source.owner_id = current_owner');
    expect(sql).toContain('if document_count > 500 then');
  });

  test('exposes the function only to authenticated users', () => {
    expect(sql).toContain('security definer');
    expect(sql).toMatch(/revoke all on function public\.dave_list_reference_document_metadata\(\)[\s\S]*from public, anon/);
    expect(sql).toMatch(/grant execute on function public\.dave_list_reference_document_metadata\(\)[\s\S]*to authenticated/);
  });
});
