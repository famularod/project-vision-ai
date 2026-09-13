import fs from "node:fs";
import path from "node:path";

describe("Ask ECOS legacy drawing evidence boundary", () => {
  const edge = fs.readFileSync(
    path.join(
      process.cwd(),
      "supabase/functions/ecos-ask-project/index.ts",
    ),
    "utf8",
  );
  const shadowSelection = fs.readFileSync(
    path.join(
      process.cwd(),
      "supabase/functions/_shared/ecos-shadow-page-selection.ts",
    ),
    "utf8",
  );

  it("never treats an authenticated legacy drawing index as answer evidence", () => {
    const eligibility = edge.slice(
      edge.indexOf("function legacyDocumentEvidenceIsEligible("),
      edge.indexOf("function matchesProjectName("),
    );

    expect(eligibility).toContain("return !isECOSDrawingCategory(category);");
    expect(eligibility).not.toContain(
      "ecosVerifiedIndexCommitVersion) === 'ecos-verified-index-commit/1.0'",
    );
  });

  it("uses the same canonical Drawing/Plans helper at every Ask drawing gate", () => {
    expect(edge).toMatch(
      /from ["']\.\.\/_shared\/ecos-document-category\.ts["']/,
    );
    expect(edge.match(/isECOSDrawingCategory\(/g)).toHaveLength(4);
    expect(edge).not.toContain("normalize(document.category) === 'drawing'");
    expect(edge).not.toContain("normalize(text(data.category)) === 'drawing'");
  });

  it("does not hydrate hosted drawing matches from client-writable legacy page rows", () => {
    const identityLoader = edge.slice(
      edge.indexOf("async function loadPageIdentityContexts("),
      edge.indexOf("async function loadMatchedPageNeighborhoods("),
    );
    const neighborhoodLoader = edge.slice(
      edge.indexOf("async function loadMatchedPageNeighborhoods("),
      edge.indexOf("async function loadShadowPageRows("),
    );

    expect(identityLoader).toContain("drawingDocumentIds: ReadonlySet<string>");
    expect(identityLoader).toMatch(
      /eligibleECOSLegacyPageDocumentIds\(\s*documentIds,\s*drawingDocumentIds,?\s*\)/,
    );
    expect(identityLoader).toContain("filterECOSLegacyPageContextRows({");
    expect(neighborhoodLoader).toContain(
      "drawingDocumentIds: ReadonlySet<string>",
    );
    expect(neighborhoodLoader).toMatch(
      /eligibleECOSLegacyPageDocumentIds\(\s*documentIds,\s*drawingDocumentIds,?\s*\)/,
    );
    expect(neighborhoodLoader).toContain("filterECOSLegacyPageContextRows({");
  });

  it("expands bounded private page evidence for ordinary cross-discipline lighting wording", () => {
    const neighborhoodLoader = edge.slice(
      edge.indexOf("async function loadMatchedPageNeighborhoods("),
      edge.indexOf("async function loadShadowPageRows("),
    );
    expect(neighborhoodLoader).toContain(".slice(0, 16)");
    expect(neighborhoodLoader).toContain(
      "asksCrossDisciplineLightingQuestion(question)",
    );
    expect(
      shadowSelection.indexOf("asksCrossDisciplineLightingQuestion(question)"),
    ).toBeLessThan(
      shadowSelection.search(/requirement\.kind !== ["']presence["']/),
    );
  });

  it("does not stop on an unrelated area calculation and preserves design authority wording", () => {
    const fallbackValueGate = edge.slice(
      edge.indexOf("function deterministicFallbackAddsValue("),
      edge.indexOf("function isNegativePresenceStatement("),
    );

    expect(shadowSelection).toContain("hazardousCanopyAreaRequested");
    expect(shadowSelection).toMatch(
      /!\/ECOS VERIFIED PLAN-FOOTPRINT CALCULATION:\/i\.test/,
    );
    expect(shadowSelection).toContain("hasTargetIdentity");
    expect(fallbackValueGate).toMatch(/["']current drawing specifies["']/);
  });

  it("preserves all required deterministic citation authorities", () => {
    const assurance = edge.slice(
      edge.indexOf("function assureAnswer("),
      edge.indexOf("function isNegativePresenceStatement("),
    );

    expect(assurance).toContain("deterministicFallbackAddsAuthority(");
    expect(assurance).toMatch(
      /canopyLightingFallback\.sourceIds,[\s\S]{0,100}accepted/,
    );
    expect(assurance).toMatch(
      /crossDisciplineLightingFallback\.sourceIds,[\s\S]{0,100}accepted/,
    );
    expect(assurance).toMatch(
      /crossDisciplineCanopyFallback\.sourceIds,[\s\S]{0,100}accepted/,
    );
  });
});
