import { assertEquals } from "jsr:@std/assert@1";
import {
  ecosControlledConflictFixtureIds,
  ecosControlledConflictFixtureVersion,
  getECOSControlledConflictFixture,
} from "./ecos-agent-conflict-fixtures.ts";
import { buildECOSDeterministicConflictAnswer } from "./ecos-agent-conflict-answer.ts";

const QUESTIONS = Object.freeze({
  "conflict-01":
    "The drawing says six inches but a field note says four. What should the crew use?",
  "conflict-02":
    "The task is complete but the inspection failed. Is the work signed off?",
  "conflict-03":
    "An approved RFI changes the detail on the drawing. Which requirement controls?",
  "conflict-04":
    "Two documents are marked current and show different dimensions. What is required?",
  "conflict-05":
    "The schedule and a field update disagree about percent complete. What is the current status?",
});

Deno.test("controlled conflict fixtures are exact, bounded, and non-customer", () => {
  assertEquals(
    ecosControlledConflictFixtureVersion(),
    "ecos-controlled-conflict-fixture/1.0",
  );
  assertEquals(ecosControlledConflictFixtureIds(), Object.keys(QUESTIONS));
  for (const [fixtureId, question] of Object.entries(QUESTIONS)) {
    const fixture = getECOSControlledConflictFixture(fixtureId, question);
    if (!fixture) throw new Error(`fixture missing: ${fixtureId}`);
    assertEquals(fixture.sources.length, 2);
    assertEquals(
      fixture.sources.every((source) =>
        source.id.startsWith("private-conflict-fixture:") &&
        source.recordId === source.id && source.excerpt.length > 0
      ),
      true,
    );
  }
});

Deno.test("controlled conflict fixtures reject unknown ids and mismatched questions", () => {
  assertEquals(
    getECOSControlledConflictFixture("not-allowed", "question"),
    null,
  );
  assertEquals(
    getECOSControlledConflictFixture("conflict-01", QUESTIONS["conflict-02"]),
    null,
  );
});

Deno.test("deterministic conflict projection requires the exact two sealed sources", () => {
  for (const [fixtureId, question] of Object.entries(QUESTIONS)) {
    const fixture = getECOSControlledConflictFixture(fixtureId, question);
    if (!fixture) throw new Error(`fixture missing: ${fixtureId}`);
    const projection = buildECOSDeterministicConflictAnswer({
      fixtureId,
      sources: fixture.sources,
    });
    if (!projection) throw new Error(`projection missing: ${fixtureId}`);
    assertEquals(projection.selectedSources.length, 2);
    assertEquals(projection.proposed.facts.length, 2);
    assertEquals(
      projection.proposed.facts.every((fact) => fact.sourceIds.length === 2),
      true,
    );
    assertEquals(
      buildECOSDeterministicConflictAnswer({
        fixtureId,
        sources: fixture.sources.slice(0, 1),
      }),
      null,
    );
  }
});

Deno.test("deterministic conflict projection is stable across source order", () => {
  const fixture = getECOSControlledConflictFixture(
    "conflict-04",
    QUESTIONS["conflict-04"],
  );
  if (!fixture) throw new Error("fixture missing");
  const first = buildECOSDeterministicConflictAnswer({
    fixtureId: fixture.id,
    sources: fixture.sources,
  });
  const second = buildECOSDeterministicConflictAnswer({
    fixtureId: fixture.id,
    sources: [...fixture.sources].reverse(),
  });
  assertEquals(first, second);
});
