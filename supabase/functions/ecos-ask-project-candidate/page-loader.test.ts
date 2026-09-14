import { assertEquals } from "jsr:@std/assert@1";
import { loadShadowPageRows } from "./index.ts";

Deno.test("actual shadow page loader carries authorized document identity into calculations", async () => {
  const originalFetch = globalThis.fetch;
  const priorUrl = Deno.env.get("SUPABASE_URL");
  const priorKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  Deno.env.set("SUPABASE_URL", "https://example.invalid");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-only");
  try {
    for (const [asked, name, heading, accepted] of [
      ["canopy B", "CANOPY 'B'", "ANCHOR ROD PLAN", true],
      ["canopy A", "CANOPY 'B'", "ANCHOR ROD PLAN", false],
      ["canopy B", "CANOPY 'B'", "CANOPY A ANCHOR ROD PLAN", false],
      ["canopy B", "UNLABELED", "ANCHOR ROD PLAN", false],
      ["building 2", "BUILDING 2", "ANCHOR ROD PLAN", true],
      ["building 3", "BUILDING 2", "ANCHOR ROD PLAN", false],
    ] as const) {
      globalThis.fetch = async (_input, init) => {
        const request = JSON.parse(String(init?.body));
        assertEquals(request.p_project_id, "selected-project");
        assertEquals(request.p_document_ids, ["exact-document"]);
        assertEquals(request.p_page_numbers, [4]);
        return Response.json([{
          document_id: "exact-document", page_number: 4,
          assurance_result: { accepted: true, confidence: .99 },
          final_page_data: { title: heading, text: heading, regions: [
            { id: "heading", text: heading, x: .4, y: .8, width: .2, height: .02, source: "vision", confidence: .99, searchable: true },
            { id: "width", text: "OVERALL WIDTH: 82'-0\"", x: .49, y: .76, width: .02, height: .003, source: "vision", confidence: .99, searchable: true },
            { id: "length", text: "OVERALL LENGTH: 64'-0\"", x: .25, y: .5, width: .003, height: .02, source: "vision", confidence: .99, searchable: true },
          ] },
        }]);
      };
      const result = await loadShadowPageRows(null as never, "selected-project", ["exact-document:4"],
        `What is the square footage of ${asked}?`, new Map([["exact-document", { name }]]) as never);
      assertEquals(result.rows.some(row => String(row.chunk_text).includes("5,248 square feet")), accepted,
        `${asked}: ${name}: ${heading}`);
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (priorUrl === undefined) Deno.env.delete("SUPABASE_URL"); else Deno.env.set("SUPABASE_URL", priorUrl);
    if (priorKey === undefined) Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY"); else Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", priorKey);
  }
});
