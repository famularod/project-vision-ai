const fs = require("fs");
const path = require("path");

const migrationPath = path.join(
  __dirname,
  "..",
  "supabase",
  "migrations",
  "20260912155045_ecos_agent_usage_telemetry_and_limits.sql",
);
const sql = fs.readFileSync(migrationPath, "utf8");

const required = [
  "create table if not exists public.ecos_agent_usage_limits",
  "check ((owner_id is null) <> (organization_id is null))",
  "alter table public.ecos_agent_usage_limits force row level security",
  "revoke all on table public.ecos_agent_usage_limits from public, anon, authenticated",
  "create table if not exists public.ecos_agent_usage_receipts",
  "alter table public.ecos_agent_usage_receipts force row level security",
  "add column if not exists agent_metrics jsonb",
  "add column if not exists answer_sha256 text",
  "create or replace function public.ecos_begin_project_question",
  "'schemaVersion', 'ecos-agent-limits/1.0'",
  "create or replace function public.ecos_record_agent_usage_v1",
  "coalesce(auth.role(), '') <> 'service_role'",
  "grant execute on function public.ecos_record_agent_usage_v1",
];

for (const fragment of required) {
  if (!sql.includes(fragment)) {
    throw new Error(`missing migration contract: ${fragment}`);
  }
}

for (const prohibited of [
  "question_text",
  "answer_text",
  "source_excerpt",
  "provider_payload",
]) {
  if (new RegExp(`add column[^;]*${prohibited}`, "i").test(sql)) {
    throw new Error(`prohibited content column: ${prohibited}`);
  }
}

console.log("PASS ecos agent telemetry migration contract 13/13");
