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
  ecosQuestionRequestsFootprintDimensions,
} from "./ecos-question-language.ts";
import { ecosExplicitEntityIdentities, ecosEvidenceIdentityCompatible } from "./ecos-evidence-identity.ts";

export type ECOSShadowPageEvidenceRow = Readonly<{
  document_name?: unknown;
  sheet_number?: unknown;
  region_id?: unknown;
  chunk_text?: unknown;
  metadata?: unknown;
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
    documentCitation: value(row.sheet_number)
      ? { sheetNumber: value(row.sheet_number) }
      : undefined,
    documentRegion: hasBoundedRegion(row)
      ? { id: value(row.region_id) }
      : undefined,
  }));
  const footprintDimensions = ecosQuestionRequestsFootprintDimensions(question);
  if (explicitSheets.length > 0 && requirement.kind === "general" && !footprintDimensions) {
    return explicitSheets.every((reference) =>
      rows.some((row) =>
        ecosSheetReferenceMatches(value(row.sheet_number), reference) &&
        value(row.chunk_text).length > 0
      )
    );
  }
  if (requirement.kind === "measurement" || footprintDimensions) {
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
    const entities = ecosExplicitEntityIdentities(question);
    const kinds = new Set(entities.map((entity) => entity.kind));
    if ((requirement.attribute === "area" || footprintDimensions) && entities.length > kinds.size) {
      // Stop only after each named subject has its own unambiguous same-page
      // calculation. A single useful page is not a completed comparison.
      return kinds.size === 1 && entities.length <= 8 && entities.every((entity) => {
        const scopedQuestion = `What is the square footage of ${entity.kind} ${entity.id}?`;
        const scopedSources = measurementSources.filter((source) => {
          const labels = ecosExplicitEntityIdentities(source.title).filter((label) => label.kind === entity.kind);
          return labels.length === 1 && labels[0].id === entity.id &&
            ecosEvidenceIdentityCompatible(scopedQuestion, source.title, source.excerpt, true);
        });
        return Boolean(buildECOSDrawingAreaFallback(scopedQuestion, scopedSources));
      });
    }
    if (footprintDimensions) {
      // A verified same-page outside-dimension pair is also sufficient for
      // dimension research. This never promotes mere page context or mixed
      // component dimensions, and does not change the customer's question.
      return entities.length === 1 && Boolean(buildECOSDrawingAreaFallback(
        `What is the square footage of ${entities[0].kind} ${entities[0].id}?`, measurementSources));
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

function hasBoundedRegion(row: ECOSShadowPageEvidenceRow) {
  if (!value(row.region_id)) return false;
  const metadata = row.metadata && typeof row.metadata === "object"
    ? row.metadata as Record<string, unknown>
    : {};
  const coordinates = [metadata.x, metadata.y, metadata.width, metadata.height]
    .map((candidate) => typeof candidate === "number" ? candidate : NaN);
  return coordinates.every(Number.isFinite) && coordinates[2] > 0 &&
    coordinates[3] > 0;
}

function normalize(input: string) {
  return input.toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ")
    .trim();
}
