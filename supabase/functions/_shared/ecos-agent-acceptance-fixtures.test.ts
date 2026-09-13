import { assertEquals } from "jsr:@std/assert@1";
import {
  ecosControlledAcceptanceFixtureIds,
  ecosControlledAcceptanceFixtureVersion,
  getECOSControlledAcceptanceFixture,
} from "./ecos-agent-acceptance-fixtures.ts";
import { buildECOSDeterministicAcceptanceAnswer } from "./ecos-agent-acceptance-answer.ts";

const QUESTIONS = Object.freeze({
  "closeout-01":
    "The INSPECTION & C OF O task is complete. Is final acceptance documented?",
  "closeout-02": "Which required inspections are still open?",
  "closeout-03":
    "Did the latest inspection pass, fail, or require corrections?",
  "closeout-04": "What closeout documents are still missing?",
  "closeout-05": "Is the project ready for sign-off today?",
});

Deno.test("controlled acceptance fixtures are exact, bounded, and non-customer", () => {
  assertEquals(
    ecosControlledAcceptanceFixtureVersion(),
    "ecos-controlled-acceptance-fixture/1.0",
  );
  assertEquals(ecosControlledAcceptanceFixtureIds(), Object.keys(QUESTIONS));
  for (const [fixtureId, question] of Object.entries(QUESTIONS)) {
    const fixture = getECOSControlledAcceptanceFixture(fixtureId, question);
    if (!fixture) throw new Error(`fixture missing: ${fixtureId}`);
    assertEquals(
      fixture.sources.every((source) =>
        source.id.startsWith("private-acceptance-fixture:") &&
        source.recordId === source.id && source.excerpt.length > 0
      ),
      true,
    );
  }
});

Deno.test("controlled acceptance fixtures reject unknown ids and mismatched questions", () => {
  assertEquals(
    getECOSControlledAcceptanceFixture("not-allowed", "question"),
    null,
  );
  assertEquals(
    getECOSControlledAcceptanceFixture("closeout-01", QUESTIONS["closeout-02"]),
    null,
  );
});

Deno.test("deterministic acceptance projection requires every exact source", () => {
  for (const [fixtureId, question] of Object.entries(QUESTIONS)) {
    const fixture = getECOSControlledAcceptanceFixture(fixtureId, question);
    if (!fixture) throw new Error(`fixture missing: ${fixtureId}`);
    const projection = buildECOSDeterministicAcceptanceAnswer({
      fixtureId,
      sources: fixture.sources,
    });
    if (!projection) throw new Error(`projection missing: ${fixtureId}`);
    assertEquals(projection.selectedSources.length, fixture.sources.length);
    assertEquals(
      buildECOSDeterministicAcceptanceAnswer({
        fixtureId,
        sources: fixture.sources.slice(0, -1),
      }),
      null,
    );
  }
});

Deno.test("deterministic acceptance projection is stable across source order", () => {
  for (const [fixtureId, question] of Object.entries(QUESTIONS)) {
    const fixture = getECOSControlledAcceptanceFixture(fixtureId, question);
    if (!fixture) throw new Error(`fixture missing: ${fixtureId}`);
    const first = buildECOSDeterministicAcceptanceAnswer({
      fixtureId,
      sources: fixture.sources,
    });
    const second = buildECOSDeterministicAcceptanceAnswer({
      fixtureId,
      sources: [...fixture.sources].reverse(),
    });
    assertEquals(first, second);
  }
});
