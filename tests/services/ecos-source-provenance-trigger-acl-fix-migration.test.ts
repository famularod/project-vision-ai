import fs from 'node:fs';
import path from 'node:path';

const migrationPath = path.resolve(
  __dirname,
  '../../supabase/migrations/20260812075338_ecos_source_provenance_trigger_acl_fix.sql',
);

describe('ECOS source-provenance trigger ACL forward fix', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');

  it('is a bounded forward transaction that requires the exact known grant', () => {
    expect(sql.trimStart().indexOf('begin;')).toBeGreaterThan(0);
    expect(sql.trimEnd().endsWith('commit;')).toBe(true);
    expect(sql).toContain(
      'lock table public.ecos_hosted_index_configuration in share row exclusive mode;',
    );
    expect(sql).toContain(
      'ecos_source_provenance_acl_requires_exact_ten_migration_tip',
    );
    expect(sql).toContain(
      'ecos_source_provenance_acl_requires_disabled_shadow_configuration',
    );
    expect(sql).toContain(
      "array['service_role:EXECUTE:false']::text[]",
    );
    expect(sql).toContain(
      'ecos_source_provenance_enqueue_trigger_acl_precondition_failed',
    );
    expect(sql).not.toContain('create or replace function');
    expect(sql).not.toContain('drop trigger');
    expect(sql).not.toContain('create trigger');
    expect(sql).toContain("procedure_record.proowner = 'postgres'::regrole");
    expect(sql).toContain(
      '043c4984955086c41ee6a343135752384447690e025b79d69b064cfb103dbc8c',
    );
  });

  it('revokes every non-owner application role from the trigger function', () => {
    expect(sql).toMatch(
      /revoke all on function\s+public\.ecos_enqueue_hosted_index_from_reference_document\(\)\s+from public, anon, authenticated, service_role;/,
    );
    expect(sql).toContain(
      'if function_acl is distinct from array[]::text[] then',
    );
    expect(sql).toContain(
      'ecos_source_provenance_enqueue_trigger_acl_postcondition_failed',
    );
    expect(sql).not.toMatch(/grant\s+execute/i);
  });

  it('proves the exact enabled document-data trigger before and after the revoke', () => {
    expect(
      sql.match(/trigger_record\.tgname = 'ecos_reference_document_hosted_enqueue'/g),
    ).toHaveLength(4);
    expect(sql.match(/trigger_record\.tgenabled = 'O'/g)).toHaveLength(2);
    expect(sql.match(/trigger_record\.tgtype = 21/g)).toHaveLength(2);
    expect(sql.match(/trigger_record\.tgqual is null/g)).toHaveLength(2);
    expect(sql.match(/array\['document_data'\]::name\[\]/g)).toHaveLength(2);
    expect(
      sql.match(/where trigger_record\.tgfoid = enqueue_oid\s+and not trigger_record\.tgisinternal;/g),
    ).toHaveLength(2);
    expect(sql).toContain(
      'ecos_source_provenance_enqueue_function_binding_precondition_failed',
    );
    expect(sql).toContain(
      'ecos_source_provenance_enqueue_function_binding_postcondition_failed',
    );
    expect(sql).toContain(
      'ecos_source_provenance_enqueue_catalog_integrity_postcondition_failed',
    );
    expect(sql).toContain(
      'ecos_source_provenance_enqueue_trigger_postcondition_failed',
    );
  });
});
