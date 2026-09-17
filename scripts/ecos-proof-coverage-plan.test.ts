import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  type CoverageSource,
  planECOSProofCoverage,
} from "./ecos-proof-coverage-plan.ts";
const id = "11111111-1111-4111-8111-111111111111";
const scope = { ownerId: id, projectId: id };
function source(document_id = "a"): CoverageSource {
  return {
    document_id,
    project_id: id,
    owner_id: id,
    source_sha256: "a".repeat(64),
    source_revision: "1",
    source_page_count: 6,
    source_byte_count: 1000,
    index_job_id: id,
    indexed_pages: [1, 2, 3, 4, 5, 6],
    executions: [{
      execution_id: id,
      binding_id: id,
      binding_version: 2,
      extraction_version: "ecos-owner-native-preview/2.0",
      source_page_count: 6,
      pages: [{
        page_number: 4,
        attempt_id: id,
        version: 3,
        upload_attempt_id: id,
        raster_version: 1,
      }],
    }],
  };
}
Deno.test("coverage plan retains existing proof and batches exact missing pages", () => {
  const s = source();
  const before = JSON.stringify(s);
  const p = planECOSProofCoverage([s], scope);
  assertEquals(p.executable, false);
  assertEquals(p.summary, {
    documents: 1,
    pages: 6,
    retainedHeadPages: 1,
    missingProofPages: 5,
    blockedPages: 0,
    plannedBatches: 2,
  });
  assertEquals(
    p.documents[0].batches.map((b) => b.pages.map((p) => p.page_number)),
    [[1, 2, 3, 5], [6]],
  );
  assertEquals(p.documents[0].expectedExecution?.bindingVersion, 2);
  assertEquals(p.documents[0].retainedHeads[0].version, 3);
  assertEquals(JSON.stringify(s), before);
});
Deno.test("coverage plan refuses cross-project, duplicate and drifting source identities", () => {
  for (
    const list of [
      [{ ...source(), project_id: "foreign" }],
      [source(), source()],
      [{ ...source(), source_page_count: 5 }],
      [{
        ...source(),
        executions: [source().executions[0], source().executions[0]],
      }],
    ]
  ) assertThrows(() => planECOSProofCoverage(list, scope));
});
Deno.test("oversized and unindexed sources are blocked instead of silently skipped", () => {
  const s = source();
  s.source_byte_count = 140164269;
  s.executions = [];
  const p = planECOSProofCoverage([s], scope);
  assertEquals(p.summary.blockedPages, 6);
  assertEquals(p.summary.plannedBatches, 0);
  assertEquals(p.documents[0].blockers, [
    "original_exceeds_verified_worker_64_mib_limit",
  ]);
  s.source_byte_count = 1000;
  s.indexed_pages = [1];
  assertEquals(planECOSProofCoverage([s], scope).documents[0].blockers, [
    "indexed_page_coverage_incomplete",
  ]);
});
Deno.test("enrollment and partial-raster recovery preserve distinct prerequisites", () => {
  const a = source("a");
  a.executions = [];
  const b = source("b");
  b.executions[0].pages[0].upload_attempt_id = null;
  b.executions[0].pages[0].raster_version = null;
  const p = planECOSProofCoverage([b, a], scope);
  assertEquals(p.documents[0].stage, "requires_source_enrollment");
  const page = p.documents[1].batches.flatMap((b) => b.pages).find((p) =>
    p.page_number === 4
  );
  assertEquals(page?.expected_previous_observation_attempt_id, id);
  assertEquals(page?.action, "replace_observation_for_missing_raster");
});
