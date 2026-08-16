#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const rootDir = path.resolve(__dirname, '..');
const migrationsDir = path.join(rootDir, 'supabase/migrations');
const correctiveMigrationName = '20260702020000_fix_photo_policy_parent_boundaries.sql';
const correctiveMigration = fs.readFileSync(
  path.join(migrationsDir, correctiveMigrationName),
  'utf8',
);

const migrations = fs
  .readdirSync(migrationsDir)
  .filter((file) => file.endsWith('.sql'))
  .map((file) => ({
    file,
    sql: fs.readFileSync(path.join(migrationsDir, file), 'utf8'),
  }));

const latestPolicyByName = new Map();
for (const { file, sql } of migrations) {
  const policyPattern =
    /create\s+policy\s+([a-z0-9_]+)\s+on\s+public\.([a-z0-9_]+)[\s\S]*?(?=\n\s*(?:drop\s+policy|create\s+policy|comment\s+on\s+policy|$))/gi;
  let match;
  while ((match = policyPattern.exec(sql)) !== null) {
    latestPolicyByName.set(`${match[2]}.${match[1]}`, {
      file,
      body: match[0],
    });
  }
}

const affectedPolicyNames = [
  'pie_photo_progress_events.pie_photo_progress_events_member_insert',
  'pie_photo_progress_events.pie_photo_progress_events_member_update',
  'pie_photo_progress_conflicts.pie_photo_progress_conflicts_member_insert',
  'pie_photo_progress_conflicts.pie_photo_progress_conflicts_member_update',
  'pie_decision_versions.pie_decision_versions_member_insert',
];

for (const policyName of affectedPolicyNames) {
  const policy = latestPolicyByName.get(policyName);
  assert(policy, `Missing latest policy ${policyName}`);
  assert.strictEqual(
    policy.file,
    correctiveMigrationName,
    `${policyName} must be recreated by ${correctiveMigrationName}`,
  );
}

const forbiddenSelfComparisons = [
  /\b([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\s*=\s*\1\.\2\b/i,
  /\borganization_id\s*=\s*organization_id\b/i,
  /\bproject_id\s*=\s*project_id\b/i,
  /\bevent\.organization_id\s*=\s*event\.organization_id\b/i,
  /\bevent\.project_id\s*=\s*event\.project_id\b/i,
  /\bsequence\.organization_id\s*=\s*sequence\.organization_id\b/i,
  /\bsequence\.project_id\s*=\s*sequence\.project_id\b/i,
];

for (const policyName of affectedPolicyNames) {
  const policy = latestPolicyByName.get(policyName);
  for (const pattern of forbiddenSelfComparisons) {
    assert(
      !pattern.test(policy.body),
      `${policyName} still contains a self-comparison matching ${pattern}`,
    );
  }
}

const requiredMarkers = [
  'parent_sequence.id = pie_photo_progress_events.photo_sequence_id',
  'parent_sequence.organization_id = pie_photo_progress_events.organization_id',
  'parent_sequence.project_id = pie_photo_progress_events.project_id',
  'parent_event.id = pie_photo_progress_conflicts.event_id',
  'parent_event.organization_id = pie_photo_progress_conflicts.organization_id',
  'parent_event.project_id = pie_photo_progress_conflicts.project_id',
  'parent_record.id = pie_decision_versions.decision_id',
  'parent_record.organization_id = pie_decision_versions.organization_id',
  'parent_record.project_id = pie_decision_versions.project_id',
  'public.pie_layer4_has_permission(',
  "'synchronize_decision_history'",
];

for (const marker of requiredMarkers) {
  assert(
    correctiveMigration.includes(marker),
    `Corrective migration missing marker: ${marker}`,
  );
}

const regressionScenarios = [
  'child organization differs from parent organization',
  'child project differs from parent project',
  'correct organization/project pair succeeds',
  'cross-organization insert fails',
  'cross-project insert fails',
  'cross-organization update fails',
  'cross-project update fails',
];

const policyCoverage = {
  'child organization differs from parent organization':
    'parent_sequence.organization_id = pie_photo_progress_events.organization_id',
  'child project differs from parent project':
    'parent_sequence.project_id = pie_photo_progress_events.project_id',
  'correct organization/project pair succeeds':
    'parent_event.project_id = pie_photo_progress_conflicts.project_id',
  'cross-organization insert fails':
    'parent_event.organization_id = pie_photo_progress_conflicts.organization_id',
  'cross-project insert fails':
    'parent_event.project_id = pie_photo_progress_conflicts.project_id',
  'cross-organization update fails':
    'for update',
  'cross-project update fails':
    'with check',
};

for (const scenario of regressionScenarios) {
  assert(
    correctiveMigration.includes(policyCoverage[scenario]),
    `Regression scenario not covered by corrective policy: ${scenario}`,
  );
}

const allPolicyBodies = [...latestPolicyByName.entries()]
  .filter(([name]) => name.startsWith('pie_photo_') || name.startsWith('pie_decision_'))
  .map(([name, policy]) => `${name}\n${policy.body}`)
  .join('\n\n');

assert(!/using\s*\(\s*true\s*\)/i.test(allPolicyBodies), 'Photo RLS must not use using (true).');
assert(!/with\s+check\s*\(\s*true\s*\)/i.test(allPolicyBodies), 'Photo RLS must not use with check (true).');

const ambiguousBoundaryComparison =
  /\b([a-z_][a-z0-9_]*)\.(organization_id|project_id|decision_id|photo_sequence_id|event_id)\s*=\s*(organization_id|project_id|decision_id|photo_sequence_id|event_id)\b/gi;
for (const [policyName, policy] of latestPolicyByName.entries()) {
  const matches = [...policy.body.matchAll(ambiguousBoundaryComparison)];
  assert(
    matches.length === 0,
    `${policyName} contains ambiguous boundary comparison(s): ${matches
      .map((match) => match[0])
      .join(', ')}`,
  );
}

console.log('Photo RLS policy regression tests passed.');
