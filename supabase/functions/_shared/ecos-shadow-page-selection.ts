import {
  analyzeECOSProjectQuestion,
  buildECOSCanopyLightingFallback,
  buildECOSCrossDisciplineLightingFallback,
  buildECOSDrawingAreaFallback,
  buildECOSDrawingMeasurementFallback,
  buildECOSDrawingPresenceFallback,
  buildECOSDrawingQuantityFallback,
} from "./ecos-project-answer-policy.ts";
import {
  ecosQuestionExplicitSheetReferences,
  ecosQuestionRequiredDocumentDisciplines,
  ecosSheetReferenceMatches,
} from "./ecos-question-language.ts";

export type ECOSShadowPageEvidenceRow = Readonly<{
  document_name?: unknown;
  sheet_number?: unknown;
  chunk_text?: unknown;
}>;

/**
 * Decides when the page-expansion loop may stop. This is deliberately stricter
 * than source ranking: a compound question must have responsive proof for each
 * requested discipline, not merely one high-scoring page from each document.
 */
export function ecosHasDecisiveShadowPageEvidence(
  question: string,
  rows: readonly ECOSShadowPageEvidenceRow[],
) {
  const requiredDisciplines = ecosQuestionRequiredDocumentDisciplines(
    question,
  );
  const rowsByDiscipline = new Map(
    requiredDisciplines.map((discipline) => [
      discipline,
      rows.filter((row) =>
        normalize(value(row.document_name)).includes(discipline)
      ),
    ]),
  );
  if (
    requiredDisciplines.some((discipline) =>
      (rowsByDiscipline.get(discipline) || []).length === 0
    )
  ) return false;

  const explicitSheets = ecosQuestionExplicitSheetReferences(question);
  if (
    explicitSheets.some((reference) =>
      !rows.some((row) =>
        ecosSheetReferenceMatches(value(row.sheet_number), reference)
      )
    )
  ) return false;

  const normalizedQuestion = normalize(question);
  const hazardousCanopyAreaRequested =
    /\b(?:hazardous material|weather protected)\b/.test(normalizedQuestion) &&
    /\bcanop(?:y|ies)\b/.test(normalizedQuestion) &&
    /\b(?:area|footprint|square feet|plan area)\b/.test(normalizedQuestion);
  if (hazardousCanopyAreaRequested) {
    const architecturalRows = rowsByDiscipline.get("architectural") || [];
    const architecturalText = architecturalRows.map((row) =>
      value(row.chunk_text)
    ).join("\n");
    const hasTargetIdentity =
      /\b(?:hazardous material|containment area)\b/.test(
        normalize(architecturalText),
      ) && /\bcanop(?:y|ies)\b/.test(normalize(architecturalText));
    const hasPrintedArea = architecturalRows.some((row) => {
      const excerpt = value(row.chunk_text);
      return !/ECOS VERIFIED PLAN-FOOTPRINT CALCULATION:/i.test(excerpt) &&
        /\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*(?:square\s+(?:feet|foot)|sq\.?\s*ft\.?|s\.?f\.?|sf)\b/i
          .test(excerpt);
    });
    if (!hasTargetIdentity || !hasPrintedArea) return false;
  }

  const requirement = analyzeECOSProjectQuestion(question);
  const sources = rows.map((row, index) => ({
    id: `shadow-page-proof:${index}`,
    sourceType: "document",
    title: [
      value(row.document_name),
      value(row.sheet_number) ? `Sheet ${value(row.sheet_number)}` : "",
    ].filter(Boolean).join(" — "),
    excerpt: value(row.chunk_text),
  }));
  if (explicitSheets.length > 0 && requirement.kind === "general") {
    return explicitSheets.every((reference) =>
      rows.some((row) =>
        ecosSheetReferenceMatches(value(row.sheet_number), reference) &&
        value(row.chunk_text).length > 0
      )
    );
  }
  if (requirement.kind === "measurement") {
    const measurementSources = requirement.attribute === "area" &&
        requiredDisciplines.includes("architectural")
      ? sources.filter((source) =>
        normalize(source.title || "").includes("architectural")
      )
      : sources;
    if (hazardousCanopyAreaRequested) {
      return measurementSources.some((source) =>
        !/ECOS VERIFIED PLAN-FOOTPRINT CALCULATION:/i.test(source.excerpt) &&
        /\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*(?:square\s+(?:feet|foot)|sq\.?\s*ft\.?|s\.?f\.?|sf)\b/i
          .test(source.excerpt)
      );
    }
    return Boolean(
      requirement.attribute === "area"
        ? buildECOSDrawingAreaFallback(question, measurementSources)
        : buildECOSDrawingMeasurementFallback(question, measurementSources),
    );
  }
  if (requirement.kind === "quantity") {
    return Boolean(buildECOSDrawingQuantityFallback(question, sources));
  }
  if (asksCanopyLightingQuestion(question)) {
    return Boolean(buildECOSCanopyLightingFallback(question, sources));
  }
  if (asksCrossDisciplineLightingQuestion(question)) {
    return Boolean(buildECOSCrossDisciplineLightingFallback(question, sources));
  }
  if (requirement.kind !== "presence") return false;
  return Boolean(buildECOSDrawingPresenceFallback(question, sources));
}

function asksCanopyLightingQuestion(question: string) {
  const normalizedQuestion = normalize(question);
  return /\bcanop(?:y|ies)\b/.test(normalizedQuestion) &&
    /\b(?:light|lights|lighting|fixture|fixtures|luminaire|luminaires)\b/.test(
      normalizedQuestion,
    );
}

function asksCrossDisciplineLightingQuestion(question: string) {
  const normalizedQuestion = normalize(question);
  return /\b(?:light|lights|lighting|fixture|fixtures|luminaire|luminaires|photometric|photometrics)\b/
    .test(normalizedQuestion) &&
    /\b(?:civil|electrical|plans?|drawings?|where|which|control|confirm|elsewhere)\b/
      .test(normalizedQuestion);
}

function value(input: unknown) {
  return typeof input === "string" ? input.trim() : "";
}

function normalize(input: string) {
  return input.toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ")
    .trim();
}
