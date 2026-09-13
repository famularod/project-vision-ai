import {
  bindECOSAnswerToAuthoritativeProof,
  ECOSAnswerProofAuthorityError,
} from "./ecos-answer-proof-authority.ts";

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, received ${
        JSON.stringify(actual)
      }`,
    );
  }
}

const claim = Object.freeze({
  documentId: "web-document-canopy",
  projectId: "9f6f040d-cf99-41ce-86e9-05eed4bdf45b",
  sourceSha256: "a".repeat(64),
  evidenceVersion: "ecos-hosted-evidence/1.3",
  documentName: "Architectural drawings",
  revision: "1",
  pageNumber: 4,
  sheetNumber: "WPA-4",
  regionId: "visual-low-confidence-ocr-2-1",
  label: "Architectural drawings, Sheet WPA-4, Rev 1",
});

function answer() {
  return {
    assurance: { status: "verified_with_limits" },
    supportingEvidence: [{
      sourceType: "document",
      recordId: claim.documentId,
      documentCitation: claim,
      documentRegion: {
        id: claim.regionId,
        label: "CANOPY A 19'-10 x 15'-4",
        x: 0.115,
        y: 0.190196,
        width: 0.864697,
        height: 0.607843,
        rawSource: "vision",
      },
    }],
  };
}

function authorityRow(
  sourceView: unknown = { locator: { source_id: claim.documentId } },
) {
  return {
    document_id: claim.documentId,
    project_id: claim.projectId,
    source_sha256: claim.sourceSha256,
    evidence_version: claim.evidenceVersion,
    source_revision: claim.revision,
    page_number: claim.pageNumber,
    sheet_number: claim.sheetNumber,
    region_id: claim.regionId,
    region_bounds: { x: 0.484, y: 0.714, width: 0.011, height: 0.002 },
    source_view_citation: sourceView,
  };
}

Deno.test("verified answers replace search-index geometry with authoritative proof bounds", async () => {
  const calls: unknown[] = [];
  const result = await bindECOSAnswerToAuthoritativeProof({
    rpc: async (name, parameters) => {
      calls.push({ name, parameters });
      return { data: [authorityRow()], error: null };
    },
  }, answer()) as ReturnType<typeof answer>;
  assertEquals(calls.length, 1);
  assertEquals(result.supportingEvidence[0].documentRegion, {
    id: claim.regionId,
    label: "CANOPY A 19'-10 x 15'-4",
    x: 0.484,
    y: 0.714,
    width: 0.011,
    height: 0.002,
    rawSource: "hosted_proof_authority",
  });
});

Deno.test("verified answers fail before completion when the protected page is absent", async () => {
  let error: unknown;
  try {
    await bindECOSAnswerToAuthoritativeProof({
      rpc: async () => ({ data: [authorityRow(null)], error: null }),
    }, answer());
  } catch (caught) {
    error = caught;
  }
  assertEquals(error instanceof ECOSAnswerProofAuthorityError, true);
  assertEquals(
    (error as ECOSAnswerProofAuthorityError).code,
    "proof_source_unavailable",
  );
});

Deno.test("verified answers fail closed on authority identity drift", async () => {
  let error: unknown;
  try {
    await bindECOSAnswerToAuthoritativeProof({
      rpc: async () => ({
        data: [{ ...authorityRow(), region_id: "different-region" }],
        error: null,
      }),
    }, answer());
  } catch (caught) {
    error = caught;
  }
  assertEquals(
    (error as ECOSAnswerProofAuthorityError).code,
    "proof_authority_identity_mismatch",
  );
});

Deno.test("insufficient-evidence responses do not require an openable proof", async () => {
  const value = {
    ...answer(),
    assurance: { status: "insufficient_evidence" },
  };
  let called = false;
  const result = await bindECOSAnswerToAuthoritativeProof({
    rpc: async () => {
      called = true;
      return { data: [], error: null };
    },
  }, value);
  assertEquals(result, value);
  assertEquals(called, false);
});
