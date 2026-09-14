import { assertEquals } from "jsr:@std/assert@1";
import {
  ecosEvidenceIdentityCompatible,
  ecosExplicitEntityIdentities,
  ecosStatementIdentitySupported,
} from "./ecos-evidence-identity.ts";

Deno.test("explicit entity labels preserve identity across vocabulary and typography", () => {
  assertEquals(
    ecosExplicitEntityIdentities(
      "BLDG. B, room #101, RFI no. 028, Canopy ‘C’, rev. 2",
    ),
    [
      { kind: "building", id: "B" },
      { kind: "room", id: "101" },
      { kind: "rfi", id: "028" },
      { kind: "canopy", id: "C" },
      { kind: "revision", id: "2" },
    ],
  );
  assertEquals(ecosExplicitEntityIdentities("building a new shed"), []);
  assertEquals(ecosExplicitEntityIdentities("Compare canopies A, B and C"), [
    { kind: "canopy", id: "A" },
    { kind: "canopy", id: "B" },
    { kind: "canopy", id: "C" },
  ]);
  assertEquals(ecosExplicitEntityIdentities("area 20 SF"), []);
  assertEquals(ecosExplicitEntityIdentities("north lot 2375"), []);
  assertEquals(ecosExplicitEntityIdentities("north lot #2375"), [{
    kind: "lot",
    id: "2375",
  }]);
  assertEquals(ecosExplicitEntityIdentities("EF-1 compared with EF 2"), [
    { kind: "equipment:EF", id: "1" },
    { kind: "equipment:EF", id: "2" },
  ]);
  assertEquals(
    ecosEvidenceIdentityCompatible(
      "EF-2 airflow?",
      "Mechanical plan",
      "EF-1 250 CFM",
      true,
    ),
    false,
  );
});

for (
  const kind of [
    "canopy",
    "building",
    "room",
    "area",
    "zone",
    "phase",
    "unit",
    "lot",
    "level",
    "door",
    "RFI",
    "submittal",
    "revision",
  ]
) {
  Deno.test(`${kind}: wrong-label evidence cannot authorize matching values`, () => {
    assertEquals(
      ecosEvidenceIdentityCompatible(
        `How big is ${kind} B?`,
        `${kind} A`,
        "6,344 square feet",
        true,
      ),
      false,
    );
    assertEquals(
      ecosEvidenceIdentityCompatible(
        `How big is ${kind} B?`,
        `${kind} B`,
        `${kind} A: 6,344 square feet`,
        true,
      ),
      false,
    );
    assertEquals(
      ecosEvidenceIdentityCompatible(
        `How big is ${kind} B?`,
        `${kind} A`,
        `${kind} B: 6,344 square feet`,
        true,
      ),
      false,
    );
    assertEquals(
      ecosEvidenceIdentityCompatible(
        `How big is ${kind} B?`,
        `${kind} B`,
        "5,248 square feet",
        true,
      ),
      true,
    );
    assertEquals(
      ecosEvidenceIdentityCompatible(
        `How big is ${kind} B?`,
        "Drawing",
        "6,344 square feet",
        true,
      ),
      false,
    );
    assertEquals(
      ecosStatementIdentitySupported(
        `${kind} B is 6,344 square feet`,
        `${kind} A is 6,344 square feet`,
      ),
      false,
    );
  });
}

Deno.test("retrieval can retain generic context without using it as entity proof", () => {
  assertEquals(
    ecosEvidenceIdentityCompatible(
      "Canopy B area?",
      "Project schedule",
      "Inspection pending",
    ),
    true,
  );
  assertEquals(
    ecosEvidenceIdentityCompatible(
      "Canopy B area?",
      "Project schedule",
      "Inspection pending",
      true,
    ),
    false,
  );
  assertEquals(
    ecosEvidenceIdentityCompatible(
      "Compare room 101 and room 102",
      "Room 101",
      "Area 20 SF",
      true,
    ),
    true,
  );
  assertEquals(
    ecosEvidenceIdentityCompatible(
      "Compare room 101 and room 102",
      "Room 103",
      "Area 20 SF",
      true,
    ),
    false,
  );
});
