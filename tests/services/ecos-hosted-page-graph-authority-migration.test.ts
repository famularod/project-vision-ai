import fs from 'node:fs';
import path from 'node:path';
import { computeECOSPageGraphSha256 } from '../../services/ECOSHostedPageGraphAuthority';

describe('hosted page-graph and primary-search authority migration', () => {
  const migrationPath = path.join(
    process.cwd(),
    'supabase/migrations/20260810013000_ecos_hosted_page_graph_and_search_authority.sql',
  );
  const migration = fs.readFileSync(migrationPath, 'utf8');
  const rehearsal = fs.readFileSync(path.join(
    process.cwd(),
    'validation/ecos/ecos-migration-adversarial-rollback.sql',
  ), 'utf8');
  const postapply = fs.readFileSync(path.join(
    process.cwd(),
    'validation/ecos/ecos-pending-rollout-postapply-verify.sql',
  ), 'utf8');

  it('binds one exact server-owned page graph into every hosted receipt', () => {
    expect(migration).toContain('create or replace function public.ecos_canonical_json_text');
    expect(migration).toContain('create or replace function public.ecos_page_graph_sha256');
    expect(migration).toContain('create or replace function public.ecos_build_hosted_page_graph');
    expect(migration).toContain("'ecosVerifiedIndexPageGraphSha256'");
    expect(migration).toContain("'extractedPages', authoritative_page_graph");
    expect(migration).toContain("'extractedPages', coalesce(p_document_data");
  });

  it('matches the database canonicalization golden vector', () => {
    expect(computeECOSPageGraphSha256([{
      pageNumber: 1,
      regions: [{
        height: 0.05,
        id: 'r-1',
        text: 'Guardrail required',
        width: 0.4,
        x: 0.1,
        y: 0.2,
      }],
      text: 'Guardrail required',
    }])).toBe('545b03371fb739e594b59a5edeb006654b17e3897ef443cdf36063e6626f85e7');
  });

  it('restores explicit owner-only RLS for every authenticated operation', () => {
    expect(migration).toContain('alter table public.reference_documents force row level security');
    expect(migration).toContain(
      'revoke all on table public.reference_documents from public, anon, authenticated',
    );
    expect(migration).toContain('reference_documents_owner_select');
    expect(migration).toContain('reference_documents_owner_insert');
    expect(migration).toContain('reference_documents_owner_update');
    expect(migration).toContain('reference_documents_owner_delete');
    expect(migration).toContain('owner_id = (select auth.uid())');
  });

  it('does not let an authenticated session self-author a receipt with a custom transaction flag', () => {
    const guardStart = migration.indexOf(
      'create or replace function public.ecos_guard_reference_document_authority_keys()',
    );
    const guardEnd = migration.indexOf(
      'revoke all on function public.ecos_guard_reference_document_authority_keys()',
      guardStart,
    );
    const guard = migration.slice(guardStart, guardEnd);
    expect(guard).toContain("if public.ecos_request_jwt_role() = 'service_role' then");
    expect(guard).not.toContain('app.ecos_hosted_commit_hydration');
  });

  it('returns and uniquely selects exact job and organization authority in both primary searches', () => {
    for (const functionName of [
      'ecos_search_hosted_shadow_chunks',
      'ecos_search_hosted_document_chunks',
    ]) {
      expect(migration).toContain(`drop function if exists public.${functionName}`);
      expect(migration).toContain(`create function public.${functionName}`);
    }
    expect(migration).toContain('job_id uuid');
    expect(migration).toContain('organization_id text');
    expect(migration).toContain('count(*) over (partition by candidate.document_id) as exact_job_count');
    expect(migration).toContain('where candidate.exact_job_count = 1');
  });

  it('rehearses exact JSON JWT authorization and both live and shadow ambiguity', () => {
    expect(rehearsal).toContain('create or replace function pg_temp.ecos_set_request_jwt');
    expect(rehearsal).toContain("perform set_config('request.jwt.claim', claims_payload, true)");
    expect(rehearsal).toContain("perform set_config('request.jwt.claims', claims_payload, true)");
    expect(rehearsal).toContain('$ecos_stage_100130_shadow_graph$');
    expect(rehearsal).toContain('$ecos_assert_100130_shadow_search_identity$');
    expect(rehearsal).toContain('$ecos_stage_100130_ambiguous_shadow_job$');
    expect(rehearsal).toContain('$ecos_assert_100130_shadow_ambiguity$');
    expect(rehearsal).toContain('$ecos_stage_100130_ambiguous_live_job$');
    expect(rehearsal).toContain("current_setting('app.ecos_rehearsal_no_config_org')");
    expect(rehearsal).not.toContain("'app.ecos_rehearsal_fresh_sibling_job'\n  )::uuid;\n  expected_document");
  });

  it('postapply rejects extra or semantically different reference-document policies', () => {
    expect(postapply).toContain("select count(*) from pg_policies policy");
    expect(postapply).toContain("policy.roles::text is distinct from '{authenticated}'");
    expect(postapply).toContain("policy.permissive is distinct from 'PERMISSIVE'");
    expect(postapply).toContain('coalesce(policy.qual, \'\')');
    expect(postapply).toContain('coalesce(policy.with_check, \'\')');
    expect(postapply).toContain(
      '(( SELECT dave_is_app_owner() AS dave_is_app_owner) AND (owner_id = ( SELECT auth.uid() AS uid)))',
    );
    expect(postapply).toContain("privilege.privilege_type not in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')");
    expect(postapply).toContain('privilege.grantee = 0');
    expect(postapply).toContain("grantee_role.rolname = 'anon'");
    expect(postapply).toContain('or privilege.is_grantable');
    expect(postapply).toContain('where migration.version >= required_versions[1]');
    expect(rehearsal).toContain('where migration.version >= required_versions[1]');
  });
});
