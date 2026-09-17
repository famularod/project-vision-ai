import { assertEquals } from "jsr:@std/assert@1";
import { loadShadowPageRows } from "./index.ts";

const document = { id: "doc-1", projectId: "project-1", sourceSha256: "a".repeat(64), evidenceVersion: "ecos-hosted-evidence/1.3", name: "Architectural", category: "Drawing", revision: "1", drawingNumber: null, updatedAt: null, legacyEligible: false, limitations: [] };
const page = { document_id: document.id, page_number: 43, source_sha256: document.sourceSha256, evidence_version: document.evidenceVersion, assurance_result: { accepted: true }, final_page_data: { regions: [{ id: "original", text: "CABINET", x: .1, y: .1, width: .1, height: .01, searchable: true, source: "ocr" }] } };

Deno.test("page projection keeps exact source identity and rejects mismatched server rows", async () => {
  const oldFetch = globalThis.fetch;
  const oldUrl = Deno.env.get("SUPABASE_URL");
  const oldKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  Deno.env.set("SUPABASE_URL", "https://example.invalid");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-only");
  try {
    for (const mutation of [{}, { source_sha256: "b".repeat(64) }, { source_sha256: null }, { evidence_version: "wrong" }, { document_id: "foreign-doc" }, { page_number: 44 }, { assurance_result: { accepted: false } }]) {
      globalThis.fetch = ((url: unknown, init: RequestInit) => {
        assertEquals(String(url).endsWith("ecos_load_hosted_shadow_bounded_page_evidence_pairs_v29"), true);
        const request = JSON.parse(String(init.body));
        assertEquals(request.p_document_ids, [document.id]);
        assertEquals(request.p_page_numbers, [43]);
        assertEquals(request.p_region_limit, 64);
        return Promise.resolve(new Response(JSON.stringify([{ ...page, ...mutation }]), { headers: { "Content-Type": "application/json" } }));
      }) as typeof fetch;
      const result = await loadShadowPageRows({} as never, document.projectId, [document.id + ":43"], "Describe the cabinetry and appliances in the employee breakroom", new Map([[document.id, document]]));
      assertEquals(result.rows.length, Object.keys(mutation).length ? 0 : 1);
      assertEquals(result.rejectedPageContextCount, Object.keys(mutation).length ? 1 : 0);
    }
    globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify([page])))) as typeof fetch;
    for (const known of [new Map(), new Map([[document.id, { ...document, projectId: "foreign-project" }]])]) {
      const result = await loadShadowPageRows({} as never, document.projectId, [document.id + ":43"], "Describe the cabinetry", known);
      assertEquals(result.rows, []);
      assertEquals(result.rejectedPageContextCount, 1);
    }
  } finally {
    globalThis.fetch = oldFetch;
    if (oldUrl === undefined) Deno.env.delete("SUPABASE_URL"); else Deno.env.set("SUPABASE_URL", oldUrl);
    if (oldKey === undefined) Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY"); else Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", oldKey);
  }
});
