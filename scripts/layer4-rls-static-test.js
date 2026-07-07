#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const rootDir = path.resolve(__dirname, '..');
const migration = fs.readFileSync(
  path.join(rootDir, 'supabase/migrations/20260701020000_layer4_membership_rls_atomic_sync.sql'),
  'utf8',
);
const previousSecurityMigration = fs.readFileSync(
  path.join(rootDir, 'supabase/migrations/20260701010000_layer4_decision_ledger_security.sql'),
  'utf8',
);

function has(value) {
  assert(
    migration.includes(value) || previousSecurityMigration.includes(value),
    `Expected migration marker: ${value}`,
  );
}

has('create table if not exists public.organizations');
has('create table if not exists public.organization_memberships');
has("status text not null check (status in ('active', 'invited', 'suspended', 'removed'))");
has("'member'");
has("'project_manager'");
has("'decision_owner'");
has("'validation_authority'");
has("'organization_admin'");
has("'create_decision_candidate'");
has("'create_decision_snapshot'");
has("'record_outcome_plan'");
has("'record_implementation_assessment'");
has("'synchronize_decision_history'");
has('alter table public.pie_decision_records enable row level security');
has('alter table public.pie_decision_versions enable row level security');
has('alter table public.pie_decision_outcomes enable row level security');
has('alter table public.pie_decision_audit_events enable row level security');
has('public.pie_layer4_has_active_membership');
has('public.pie_layer4_has_permission');
has('create policy pie_decision_records_member_read');
has('create policy pie_decision_records_member_insert');
has('create policy pie_decision_records_member_update');
has('create policy pie_decision_versions_member_insert');
has('create policy pie_decision_outcomes_member_insert');
has('create policy pie_decision_audit_member_insert');
has('create or replace function public.save_pie_decision_record_atomic');
has('security definer');
has('Layer 4 immutable snapshot conflict');
has('Stale offline data cannot reopen a closed decision');
has('Layer 4 outcome validation requires validation authority');
has('Layer 4 decision version conflict');
has('Layer 4 outcome history conflict');
has('Layer 4 audit history conflict');
has('pie_decision_prevent_snapshot_replace');
has('pie_decision_prevent_history_update');
has('pie_decision_prevent_history_delete');
has('pie_decision_validate_version_insert');

assert(!/using\s*\(\s*true\s*\)/i.test(migration), 'RLS must not use using (true).');
assert(!/with check\s*\(\s*true\s*\)/i.test(migration), 'RLS must not use with check (true).');
assert(!migration.includes('atomic decision save is blocked'), 'Atomic RPC must not remain fail-closed stub in new migration.');

console.log('Layer 4 RLS static migration tests passed.');
