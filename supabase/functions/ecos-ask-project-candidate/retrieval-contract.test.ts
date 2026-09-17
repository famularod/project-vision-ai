import { assert, assertEquals } from "jsr:@std/assert@1";

const source = await Deno.readTextFile(
  new URL("./index.ts", import.meta.url),
);
const migration = await Deno.readTextFile(
  new URL(
    "../../migrations/20260913180500_ecos_project_question_scoped_records.sql",
    import.meta.url,
  ),
);

Deno.test("cached answers bind the complete manifest including refreshed pages outside the shortlist", () => {
  const fingerprint = source.slice(source.indexOf('const fingerprint = await sha256Hex('), source.indexOf('const providerInput = JSON.stringify('));
  assert(fingerprint.includes('evidenceManifestSha256: manifestAfter.snapshotSha256'));
  assert(fingerprint.includes('runtimeDeploymentIdentity'));
});

Deno.test("customer path loads structured evidence through the authorized project-scoped RPC", () => {
  assert(source.includes('client.rpc("ecos_load_project_question_records_v1"'));
  assert(
    source.includes(
      "loadProjectQuestionRecords(client, projectId, projectName)",
    ),
  );
  assert(
    !source.includes(
      'loadAllEvidenceRows(\n        client,\n        "schedule_items"',
    ),
  );
  assert(
    !source.includes(
      'loadAllEvidenceRows(\n        client,\n        "project_updates"',
    ),
  );
  assert(
    !source.includes(
      'loadAllEvidenceRows(\n        client,\n        "field_notes"',
    ),
  );
});

Deno.test("exact Canopy A wording uses bounded high-information retrieval", () => {
  assert(source.includes("ecosPrimaryLexicalQueries(question, 6)"));
  assert(source.includes("queries,\n    2,"));
  assert(source.includes("primaryLimit: 24,\n          retryLimit: 8"));
  assert(source.includes('client.rpc("ecos_search_hosted_document_chunks"'));
  assert(
    source.includes(
      'shadowClient.rpc(\n              "ecos_search_hosted_shadow_chunks"',
    ),
  );
});

Deno.test("project record loader fails closed instead of silently truncating or crossing projects", () => {
  assert(migration.includes("project.owner_id = caller_id"));
  assertEquals(
    migration.match(/raise program_limit_exceeded/g)?.length,
    3,
  );
  assertEquals(
    migration.match(/btrim\(coalesce\([^\n]*\.project_id, ''\)\) = ''/g)
      ?.length,
    3,
  );
  assert(migration.includes("from public, anon;"));
});
