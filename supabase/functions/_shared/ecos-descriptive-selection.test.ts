import { assert, assertEquals } from "jsr:@std/assert@1";
import { selectECOSEvidenceSources } from "./ecos-evidence-selection.ts";

const question = "What is the planned occupant load of the new employee breakroom, and what cabinetry, appliances, and accessible features are shown?";
const source = (id: string, excerpt: string, page: number, score = 100) => ({
  id, excerpt, score, sourceType: "document", recordId: "drawing",
  title: "Architectural drawing", documentRegion: { id },
  documentCitation: { pageNumber: page, regionId: id, sheetNumber: `A-${page}` },
  documentPageSelectionRank: page,
});

Deno.test("source-pool selection retains requested details before tool ranking", () => {
  const repeated = Array.from({ length: 64 }, (_, i) =>
    source(`generic-${i}`, "ACCESSIBLE ACCESSIBILITY ADA CLEARANCE", i % 16 + 1));
  const cabinetry = source("cabinet", "NEW EMPLOYEE BREAK ROOM CABINET MICROWAVES", 43, 1);
  const occupancy = source("occupancy", "NEW EMPLOYEE BREAK ROOM OCCUPANT LOAD", 43, 1);
  const result = selectECOSEvidenceSources(question, [...repeated, cabinetry, occupancy], 36);
  assertEquals(result.length, 36);
  assert(result.includes(cabinetry));
  assert(result.includes(occupancy));
  assert(result.every((item) => [...repeated, cabinetry, occupancy].includes(item)));
});

Deno.test("descriptive source-pool ranking keeps explicit sheet and entity boundaries", () => {
  const wrong = source("wrong", "Canopy B cabinet microwave", 2);
  const correct = source("correct", "Canopy A cabinet microwave", 1);
  assertEquals(selectECOSEvidenceSources("What cabinetry is shown in Canopy A?", [wrong, correct], 12), [correct]);
  assertEquals(selectECOSEvidenceSources("What cabinetry is shown on Sheet A-1?", [wrong, correct], 12), [correct]);
  assertEquals(selectECOSEvidenceSources("What cabinetry is shown on Sheet A-3?", [wrong, correct], 12), []);
});

Deno.test("high-scoring context is not allowed to bypass descriptive coverage", () => {
  const generic = source("generic", "EMPLOYEE BREAK ROOM OCCUPANT LOAD ACCESSIBLE FEATURES SHOWN", 2, 1000);
  const cabinet = source("cabinet", "CABINET MICROWAVES", 17, 1);
  const count = source("count", "OCC. LOAD: 80 BREAK ROOM", 17, 1);
  const result = selectECOSEvidenceSources(question, [generic, cabinet, count], 3);
  assert(result.includes(cabinet));
  assert(result.includes(count));
});
