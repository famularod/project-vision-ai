import {
  analyzeECOSProjectQuestion,
  buildECOSDrawingAreaFallback,
  buildECOSDrawingMeasurementFallback,
  buildECOSDrawingPresenceFallback,
  buildECOSDrawingQuantityFallback,
  ecosEvidenceQuestionContextScore,
  ecosQuestionRequestsInstalledCondition,
} from "./ecos-project-answer-policy.ts";
import {
  ecosQuestionExplicitSheetReferences,
  ecosQuestionRequestsDrawingLocation,
  ecosSheetReferenceMatches,
} from "./ecos-question-language.ts";

export type ECOSEvidenceSelectionSource = Readonly<{
  id: string;
  sourceType: string;
  recordId: string;
  title: string;
  excerpt: string;
  score: number;
  documentCitation?: Readonly<{
    pageNumber: number;
    sheetNumber?: string | null;
  }>;
  documentRegion?: Readonly<{ id: string }>;
  documentPageSelectionRank?: number;
}>;

export type ECOSExactPagePair = Readonly<{
  documentId: string;
  pageNumber: number;
}>;

/**
 * Parses page identities that ECOS itself serialized as `<document id>:<page>`.
 * The page token is text at this boundary, so validate its canonical decimal
 * shape before converting it to a number. This intentionally does not relax
 * strict numeric validation for untrusted database provenance fields.
 */
export function parseECOSExactPagePairs(
  pageKeys: readonly string[],
): ECOSExactPagePair[] {
  const pairs = new Map<string, ECOSExactPagePair>();
  for (const key of pageKeys.slice(0, 200)) {
    const separator = key.lastIndexOf(":");
    const documentId = separator > 0 ? key.slice(0, separator) : "";
    const pageToken = separator > 0 ? key.slice(separator + 1) : "";
    if (
      documentId.length < 1 || documentId.length > 200 ||
      documentId !== documentId.trim() || !/^[1-9][0-9]{0,5}$/.test(pageToken)
    ) continue;
    const pageNumber = Number(pageToken);
    if (!Number.isSafeInteger(pageNumber) || pageNumber > 100_000) continue;
    pairs.set(`${documentId}:${pageNumber}`, { documentId, pageNumber });
  }
  return [...pairs.values()];
}

/**
 * Preserves exact, bounded deterministic proof before generic retrieval text.
 * Evidence is grouped by the fact it proves rather than by page so two
 * different facts on one drawing cannot evict each other before Assurance.
 */
export function selectECOSEvidenceSources<
  T extends ECOSEvidenceSelectionSource,
>(question: string, rankedSources: readonly T[], limit: number): T[] {
  const explicitSheetReferences = ecosQuestionExplicitSheetReferences(
    question,
  );
  const selectionPool = explicitSheetReferences.length > 0
    ? rankedSources.filter((source) =>
      source.sourceType === "document" &&
      explicitSheetReferences.some((reference) =>
        ecosSheetReferenceMatches(
          source.documentCitation?.sheetNumber || "",
          reference,
        )
      )
    )
    : rankedSources;
  if (
    explicitSheetReferences.length > 0 &&
    !ecosEvidenceCoversExplicitSheetReferences(question, selectionPool)
  ) return [];
  const selected: T[] = [];
  const selectedIds = new Set<string>();
  const selectedPageSources = new Map<string, T[]>();
  for (const source of selectionPool) {
    const pageNumber = source.documentCitation?.pageNumber;
    if (
      source.sourceType !== "document" || !pageNumber ||
      source.documentPageSelectionRank == null
    ) continue;
    const pageKey = `${source.recordId}:${pageNumber}`;
    selectedPageSources.set(pageKey, [
      ...(selectedPageSources.get(pageKey) || []),
      source,
    ]);
  }

  const deterministicCandidates = new Map<
    string,
    { source: T; score: number; boundedDrawingLocationProof: boolean }
  >();
  for (const source of selectionPool) {
    const candidate = deterministicSelectionCandidate(question, source);
    if (candidate.score < 100) continue;
    const existing = deterministicCandidates.get(candidate.key);
    const boundedDrawingLocationProof = Boolean(source.documentRegion) &&
      ecosQuestionRequestsDrawingLocation(question) &&
      ecosEvidenceQuestionContextScore(question, source.excerpt) > 0;
    if (
      !existing ||
      (boundedDrawingLocationProof &&
        !existing.boundedDrawingLocationProof) ||
      (boundedDrawingLocationProof ===
          existing.boundedDrawingLocationProof &&
        candidate.score > existing.score) ||
      (boundedDrawingLocationProof ===
          existing.boundedDrawingLocationProof &&
        candidate.score === existing.score &&
        source.score > existing.source.score)
    ) {
      deterministicCandidates.set(candidate.key, {
        source,
        score: candidate.score,
        boundedDrawingLocationProof,
      });
    }
  }
  for (
    const candidate of [...deterministicCandidates.values()].sort((
      left,
      right,
    ) => right.score - left.score || right.source.score - left.source.score)
      .slice(0, 16)
  ) {
    if (selectedIds.has(candidate.source.id)) continue;
    selectedIds.add(candidate.source.id);
    selected.push(candidate.source);
    if (selected.length >= limit) return selected;
  }

  const orderedPages = [...selectedPageSources.entries()].sort(
    (left, right) =>
      (left[1][0]?.documentPageSelectionRank || Number.MAX_SAFE_INTEGER) -
      (right[1][0]?.documentPageSelectionRank || Number.MAX_SAFE_INTEGER),
  );
  for (const [, pageSources] of orderedPages) {
    const source = [...pageSources].sort((left, right) =>
      Number(
          Boolean(right.documentRegion) &&
            ecosQuestionRequestsDrawingLocation(question) &&
            ecosEvidenceQuestionContextScore(question, right.excerpt) > 0,
        ) -
        Number(
          Boolean(left.documentRegion) &&
            ecosQuestionRequestsDrawingLocation(question) &&
            ecosEvidenceQuestionContextScore(question, left.excerpt) > 0,
        ) ||
      deterministicSelectionScore(question, right) -
        deterministicSelectionScore(question, left) ||
      right.score - left.score
    )[0];
    if (!source || selectedIds.has(source.id)) {
      continue;
    }
    selectedIds.add(source.id);
    selected.push(source);
    if (selected.length >= limit) {
      return selected;
    }
  }
  for (const source of selectionPool) {
    if (selectedIds.has(source.id)) continue;
    selectedIds.add(source.id);
    selected.push(source);
    if (selected.length >= limit) break;
  }
  return selected;
}

/**
 * Exact sheet references are an authority boundary, not a ranking hint. A
 * factual answer about Sheet E-2.1 must carry verified E-2.1 evidence; a
 * nearby E-2.2 page is not an acceptable substitute even when its text ranks
 * more highly.
 */
export function ecosEvidenceCoversExplicitSheetReferences(
  question: string,
  sources: readonly Pick<
    ECOSEvidenceSelectionSource,
    "sourceType" | "documentCitation"
  >[],
) {
  const references = ecosQuestionExplicitSheetReferences(question);
  if (references.length === 0) return true;
  return references.every((reference) =>
    sources.some((source) =>
      source.sourceType === "document" &&
      ecosSheetReferenceMatches(
        source.documentCitation?.sheetNumber || "",
        reference,
      )
    )
  );
}

/**
 * Scores same-page proof that adds exact numeric relationships or distinctive
 * question language. This is used only to expose supporting proof to the user;
 * it never creates a fact or changes Assurance's source validation.
 */
export function ecosSupportingEvidenceComplementScore(
  question: string,
  factualStatements: readonly string[],
  excerpt: string,
) {
  const normalizedExcerpt = normalize(excerpt);
  const questionNumbers = new Set(numericTokens(question));
  const factNumbers = new Set(
    factualStatements.flatMap(numericTokens).filter((token) =>
      !questionNumbers.has(token)
    ),
  );
  const numericMatches =
    [...factNumbers].filter((token) => normalizedExcerpt.includes(token))
      .length;
  const distinctiveQuestionTokens = meaningfulTokens(question).filter(
    (token) => token.length >= 5,
  );
  const questionMatches =
    distinctiveQuestionTokens.filter((token) =>
      normalizedExcerpt.includes(token)
    ).length;
  return numericMatches * 20 + questionMatches * 2;
}

export function deterministicSelectionScore(
  question: string,
  source: ECOSEvidenceSelectionSource,
) {
  return deterministicSelectionCandidate(question, source).score;
}

function deterministicSelectionCandidate(
  question: string,
  source: ECOSEvidenceSelectionSource,
) {
  const requirement = analyzeECOSProjectQuestion(question);
  const fallback = requirement.kind === "measurement"
    ? requirement.attribute === "area"
      ? buildECOSDrawingAreaFallback(question, [source])
      : buildECOSDrawingMeasurementFallback(question, [source])
    : requirement.kind === "quantity"
    ? buildECOSDrawingQuantityFallback(question, [source])
    : requirement.kind === "presence"
    ? buildECOSDrawingPresenceFallback(question, [source]) ||
      buildECOSDrawingQuantityFallback(question, [source])
    : null;
  const normalizedQuestion = normalize(question);
  const normalizedExcerpt = normalize(source.excerpt);
  const normalizedStatement = normalize(fallback?.statement || "");
  const boundedBonus = source.documentRegion ? 20 : 0;
  const installedProvidedBonus = ecosQuestionRequestsInstalledCondition(
      question,
    ) && /\b(?:trees?|plants?)\b[\s\S]{0,32}\bprovided\b[\s:=-]{0,8}\d+\b/i
      .test(source.excerpt)
    ? 20
    : 0;
  const civilPavingBonus = /\b(?:cement|concrete|pcc|slab)\b/.test(
      normalizedQuestion,
    ) &&
      !/\b(?:walkway|sidewalk|path)\b/.test(normalizedQuestion) &&
      /\bpcc\s+(?:paving|pavement)\b/.test(normalizedStatement)
    ? 60
    : 0;
  const lighting =
    /\b(?:light|lights|lighting|fixture|fixtures|luminaire|luminaires|photometric|photometrics)\b/
      .test(
        normalizedQuestion,
      );
  const architecturalCanopyLighting = lighting &&
      /\barchitectural\b/i.test(source.title) &&
      /\bcanop(?:y|ies)\b/.test(normalizedExcerpt) &&
      /\bnew\s+light\s+fixture\b/.test(normalizedExcerpt) &&
      /\bsee\s+electrical\b/.test(normalizedExcerpt)
    ? 240
    : 0;
  const electricalExteriorLighting = lighting &&
      /\belectrical\b/i.test(source.title) &&
      /\bexterior\s+storage\b/.test(normalizedExcerpt) &&
      /\blighting\s+plans?\b/.test(normalizedExcerpt)
    ? 240
    : 0;
  const civilLightingReferral = lighting && /\bcivil\b/i.test(source.title) &&
      /\barea\s+lighting\b[\s\S]{0,180}\barchitectural\s+and\s+electrical\s+drawings\b/
        .test(
          normalizedExcerpt,
        )
    ? 220
    : 0;
  const genericElectricalLighting = lighting &&
      /\belectrical\b/i.test(source.title) &&
      /\b(?:light|lighting|fixture|luminaire|photometric)s?\b/.test(
        normalizedExcerpt,
      )
    ? 110
    : 0;
  const specialLightingBonus = Math.max(
    architecturalCanopyLighting,
    electricalExteriorLighting,
    civilLightingReferral,
    genericElectricalLighting,
  );
  const score = (fallback ? 300 : 0) + specialLightingBonus +
    ecosEvidenceQuestionContextScore(question, source.excerpt) * 10 +
    civilPavingBonus + installedProvidedBonus + boundedBonus;
  const pageNumber = source.documentCitation?.pageNumber;
  const pageKey = pageNumber ? `${source.recordId}:${pageNumber}` : source.id;
  const key = architecturalCanopyLighting
    ? "lighting:architectural-canopy"
    : electricalExteriorLighting
    ? "lighting:electrical-exterior-storage"
    : civilLightingReferral
    ? "lighting:civil-referral"
    : fallback
    ? `fact:${normalizedStatement}`
    : `page:${pageKey}`;
  return { key, score };
}

function normalize(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function numericTokens(value: string) {
  return value.match(/\b\d+(?:,\d{3})*(?:\.\d+)?\b/g)?.map((token) =>
    token.replace(/,/g, "")
  ) || [];
}

function meaningfulTokens(value: string) {
  return [
    ...new Set(
      (normalize(value).match(/[a-z][a-z0-9-]*/g) || []).flatMap((token) =>
        token.split("-").filter(Boolean)
      ),
    ),
  ];
}
