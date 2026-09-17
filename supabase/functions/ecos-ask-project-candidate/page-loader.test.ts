import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { loadShadowPageRows, searchDocumentEvidence } from "./index.ts";

Deno.test('direct page mode reads one exact pair and performs no embedding or global search', async () => {
  const previousFetch = globalThis.fetch;
  const previousUrl = Deno.env.get('SUPABASE_URL');
  const previousKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  Deno.env.set('SUPABASE_URL', 'https://example.invalid');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-only');
  const document = {id: 'doc-a', projectId: 'project-a', sourceSha256: 'a'.repeat(64), evidenceVersion: 'ecos-hosted-evidence/1.3', name: 'Office Drawing', category: 'Drawing', revision: '1', drawingNumber: null, updatedAt: null, legacyEligible: false, limitations: []};
  const client = { rpc: () => {throw new Error('unexpected_global_search');} } as never;
  let reads = 0;
  try {
    globalThis.fetch = async (url, init) => {
      assertEquals(String(url).includes('/ecos_load_hosted_shadow_bounded_page_evidence_pairs_'), true);
      const body = JSON.parse(String(init?.body));
      assertEquals(body.p_project_id, 'project-a');
      assertEquals(body.p_document_ids, ['doc-a']);
      assertEquals(body.p_page_numbers, [3]);
      reads++;
      return Response.json([]);
    };
    const exact = {documentId: 'doc-a', pageNumber: 3, signal: new AbortController().signal};
    const result = await searchDocumentEvidence(client, 'project-a', [document], 'What cabinetry is shown?', ['cabinetry'], client, exact);
    assertEquals(reads, 1);
    assertEquals(result.sources, []);
    assertEquals(result.semanticCandidateCount, 0);
    await assertRejects(() => searchDocumentEvidence(client, 'wrong-project', [document], 'cabinetry', ['cabinetry'], client, exact), Error, 'exact_drawing_page_scope_invalid');
    await assertRejects(() => searchDocumentEvidence(client, 'project-a', [document], 'cabinetry', ['cabinetry'], client, {...exact, documentId: 'wrong-doc'}), Error, 'exact_drawing_page_scope_invalid');
    await assertRejects(() => searchDocumentEvidence(client, 'project-a', [document], 'cabinetry', ['cabinetry'], client, {...exact, signal: AbortSignal.abort()}));
    assertEquals(reads, 1);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) Deno.env.delete('SUPABASE_URL'); else Deno.env.set('SUPABASE_URL', previousUrl);
    if (previousKey === undefined) Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY'); else Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', previousKey);
  }
});

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
          source_sha256: "a".repeat(64), evidence_version: "ecos-hosted-evidence/1.3",
          assurance_result: { accepted: true, confidence: .99 },
          final_page_data: { title: heading, text: heading, regions: [
            { id: "heading", text: heading, x: .4, y: .8, width: .2, height: .02, source: "vision", confidence: .99, searchable: true },
            { id: "width", text: "OVERALL WIDTH: 82'-0\"", x: .49, y: .76, width: .02, height: .003, source: "vision", confidence: .99, searchable: true },
            { id: "length", text: "OVERALL LENGTH: 64'-0\"", x: .25, y: .5, width: .003, height: .02, source: "vision", confidence: .99, searchable: true },
          ] },
        }]);
      };
      const result = await loadShadowPageRows(null as never, "selected-project", ["exact-document:4"],
        `What is the square footage of ${asked}?`, new Map([["exact-document", { name, projectId: "selected-project", sourceSha256: "a".repeat(64), evidenceVersion: "ecos-hosted-evidence/1.3" }]]) as never);
      assertEquals(result.rows.some(row => String(row.chunk_text).includes("5,248 square feet")), accepted,
        `${asked}: ${name}: ${heading}`);
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (priorUrl === undefined) Deno.env.delete("SUPABASE_URL"); else Deno.env.set("SUPABASE_URL", priorUrl);
    if (priorKey === undefined) Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY"); else Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", priorKey);
  }
});
