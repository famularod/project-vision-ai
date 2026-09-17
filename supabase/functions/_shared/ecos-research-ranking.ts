import { analyzeECOSProjectQuestion } from "./ecos-project-answer-policy.ts";
import { ecosEvidenceIdentityCompatible } from "./ecos-evidence-identity.ts";
import { ecosMeaningfulQuestionTokens, ecosQuestionTokenVariants } from "./ecos-question-language.ts";

type ResearchSource = Readonly<{
  id: string; sourceType: string; title: string; excerpt: string; score: number;
  documentCitation?: Readonly<Record<string, unknown>>;
}>;

const SCAFFOLD = new Set(["plann", "planned", "shown", "show", "specified", "specifi", "feature", "change", "existing", "exist", "proposed", "propos", "provide", "provid", "relative", "arranged", "arrang", "reconfigured", "reconfigur"]);
const words = (value: string) => ` ${value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;

/** Rank discovery only. No source text, identity, fact or proof is modified. */
export function rankECOSDescriptiveResearchSources<T extends ResearchSource>(question: string, sources: readonly T[], limit: number): T[] {
  const bound = Math.max(1, Math.min(36, Math.trunc(limit) || 1));
  if (analyzeECOSProjectQuestion(question).kind !== "general") return sources.slice(0, bound);
  const facets = ecosMeaningfulQuestionTokens(question).filter((term) => !SCAFFOLD.has(term)).slice(0, 12)
    .map((term) => ({ term, variants: ecosQuestionTokenVariants(term) }));
  if (facets.length < 2) return sources.slice(0, bound);
  const pool = sources.filter((source) => ecosEvidenceIdentityCompatible(question, source.title, source.excerpt));
  const entries = pool.map((source, index) => {
    const haystack = words(source.title + " " + source.excerpt);
    const hits = facets.map((facet) => facet.variants.some((variant) =>
      haystack.includes(words(variant)) || haystack.includes(words(variant + "s"))
    ));
    const boilerplate = new Set(words(source.title).trim().split(/\s+/).concat(["drawing", "page", "context", "sheet", "title"]));
    const terms = new Set(words(source.excerpt).trim().split(/\s+/).filter(term => !boilerplate.has(term)));
    const numbers = [...terms].filter(term => /^\d+$/.test(term)).sort().join(",");
    const citation = source.documentCitation;
    const pageKey = citation?.documentId && citation.pageNumber ? `${citation.documentId}:${citation.pageNumber}` : null;
    return { source, index, hits, terms, numbers, pageKey };
  });
  // A family of aliases is one requested facet, not several votes. Rare
  // requested details get more weight than ubiquitous code-sheet language.
  const weights = facets.map((_, i) => 1 + Math.log((entries.length + 1) /
    (entries.filter((entry) => entry.hits[i]).length + 1)));
  // A drawing often spreads its answer across a plan, elevation and notes.
  // Prefer coherent coverage on the same exact document/page over unrelated
  // code snippets. Count each facet once per page, never each duplicate chunk.
  const pageHits = new Map<string, Set<number>>();
  for (const entry of entries) {
    if (!entry.pageKey || !entry.source.documentCitation?.regionId) continue;
    const hits = pageHits.get(entry.pageKey) ?? new Set<number>();
    entry.hits.forEach((hit, i) => { if (hit) hits.add(i); });
    pageHits.set(entry.pageKey, hits);
  }
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const covered = new Set<number>();
  const selected: T[] = [];
  const chosen: typeof entries = [];
  const remaining = [...entries];
  while (remaining.length && selected.length < bound) {
    const score = (entry: typeof entries[number]) => {
      const repeated = entry.pageKey && chosen.some(previous => previous.pageKey === entry.pageKey && previous.numbers === entry.numbers &&
        [...entry.terms].filter(term => previous.terms.has(term)).length /
          Math.max(1, Math.max(entry.terms.size, previous.terms.size)) >= .8);
      const proofFactor = entry.source.sourceType === 'document' && !entry.source.documentCitation?.regionId ? .25 : 1;
      const pageCoverage = [...(pageHits.get(entry.pageKey ?? '') ?? [])]
        .reduce((sum, i) => sum + weights[i], 0) / totalWeight;
      return entry.hits.reduce((sum, hit, i) => sum + (hit ? weights[i] * (covered.has(i) ? .2 : 1) : 0), 0) *
        (1 + 3 * pageCoverage ** 2) * (repeated ? .05 : 1) * proofFactor;
    };
    remaining.sort((left, right) => score(right) - score(left) ||
      Number(Boolean(right.source.documentCitation?.regionId)) - Number(Boolean(left.source.documentCitation?.regionId)) ||
      left.index - right.index);
    const best = remaining.shift()!;
    chosen.push(best);
    selected.push(best.source);
    best.hits.forEach((hit, i) => { if (hit) covered.add(i); });
  }
  return selected;
}
