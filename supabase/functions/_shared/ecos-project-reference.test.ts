import { assertEquals } from "jsr:@std/assert@1";
import {
  ECOS_KNOWN_PROJECT_NAMES_LIMIT,
  ecosQuestionMayNameAProject,
  findECOSProjectReferenceMismatch,
  loadECOSKnownProjectNames,
} from "./ecos-project-reference.ts";
import { ECOS_PROJECT_REFERENCE_VECTORS } from "./ecos-project-reference-test-vectors.ts";

// Owner answer Q20 (30 Sep 2026; audit A9 pass 1 #2): the edge function runs the
// same vectors as the app's jest suite.
for (const vector of ECOS_PROJECT_REFERENCE_VECTORS) {
  Deno.test(`project reference guard: ${vector.name}`, () => {
    const mismatch = findECOSProjectReferenceMismatch(
      vector.projectName,
      vector.question,
      vector.knownProjectNames,
    );
    assertEquals(mismatch?.referencedProjectIdentifier ?? null, vector.refused);
    if (vector.refused) assertEquals(mismatch?.selectedProjectIdentifier, "2321");
    // Only a question with a 3-6 digit number is ever refused, so the edge
    // function can skip the project read for every other question.
    if (vector.refused) assertEquals(ecosQuestionMayNameAProject(vector.question), true);
  });
}

const selected = { id: "project-2321", name: "2321 Compliance Project" };
const other = { id: "project-2375", name: "2375 Compliance Project" };
const psiQuestion = "What strength is the 4000 psi concrete at the footings?";
const guard = (names: readonly string[] | null) =>
  findECOSProjectReferenceMismatch(selected.name, psiQuestion, names)?.referencedProjectIdentifier ?? null;

Deno.test("the unarchived project list reaches the guard and allows ordinary numbers", async () => {
  const limits: number[] = [];
  const names = await loadECOSKnownProjectNames({
    projectId: selected.id,
    readUnarchivedProjects: (limit) => {
      limits.push(limit);
      return Promise.resolve({ data: [selected, other], error: null, count: 2 });
    },
  });
  assertEquals(names, [selected.name, other.name]);
  assertEquals(limits, [ECOS_KNOWN_PROJECT_NAMES_LIMIT]);
  assertEquals(guard(names), null);
});

Deno.test("an unreadable or untrustworthy project list falls back to the stricter check", async () => {
  const cases: Array<[string, () => PromiseLike<{ data: unknown; error: unknown; count?: number | null }>]> = [
    ["read error", () => Promise.resolve({ data: null, error: { message: "permission denied" }, count: null })],
    ["read threw", () => { throw new Error("network"); }],
    ["read rejected", () => Promise.reject(new Error("timeout"))],
    ["not a list", () => Promise.resolve({ data: { rows: [] }, error: null })],
    ["count disagrees", () => Promise.resolve({ data: [selected, other], error: null, count: 3 })],
    ["limit reached", () => Promise.resolve({
      data: Array.from({ length: ECOS_KNOWN_PROJECT_NAMES_LIMIT }, (_, index) =>
        index === 0 ? selected : { id: `project-${index}`, name: `Project ${index}` }),
      error: null,
    })],
    ["selected project missing", () => Promise.resolve({ data: [other], error: null, count: 1 })],
    ["empty list", () => Promise.resolve({ data: [], error: null, count: 0 })],
    ["malformed row", () => Promise.resolve({ data: [selected, null], error: null, count: 2 })],
  ];
  for (const [label, readUnarchivedProjects] of cases) {
    const names = await loadECOSKnownProjectNames({ projectId: selected.id, readUnarchivedProjects });
    assertEquals(names, null, label);
    assertEquals(guard(names), "4000", label);
  }
});
