export const ECOS_CURRENT_QUESTION_CONTRACT =
  "ecos-project-question/2.0" as const;
export const ECOS_LEGACY_QUESTION_CONTRACT =
  "ecos-project-question/1.0" as const;
export const ECOS_QUESTION_TRACE_CONTRACT = "ecos-question-trace/1.0" as const;
export const ECOS_EVIDENCE_SNAPSHOT_CONTRACT =
  "ecos-project-evidence-snapshot/1.0" as const;
export const ECOS_EVIDENCE_DOSSIER_CONTRACT =
  "ecos-evidence-dossier/1.0" as const;
export const ECOS_RETRIEVAL_CONTRACT = "ecos-evidence-retrieval/2.3" as const;

export type ECOSQuestionClientSurface =
  | "web"
  | "iphone"
  | "ipad"
  | "android"
  | "shadow"
  | "unknown";

export type ECOSQuestionTraceClock = {
  readonly traceId: string;
  readonly startedAt: string;
  currentStage: string;
  currentStageStartedAtMs: number;
  readonly stageDurationsMs: Record<string, number>;
};

export type ECOSReceiptSource = Readonly<{
  id: string;
  sourceType: string;
  updatedAt: string | null;
  excerpt?: string;
  citation?: unknown;
}>;

export type ECOSEvidenceInventory = Readonly<{
  consistency: "stable_read" | "best_effort_non_atomic";
  sourceCounts: Readonly<Record<string, number>>;
  sourceVersions: Readonly<Record<string, string | null>>;
  unavailableChannels: readonly string[];
  limitations: readonly string[];
  candidateCount: number;
}>;

export type ECOSEvidenceSnapshotReceipt = Readonly<{
  id: string;
  schemaVersion: typeof ECOS_EVIDENCE_SNAPSHOT_CONTRACT;
  snapshotSha256: string;
  inventory: ECOSEvidenceInventory;
}>;

export type ECOSEvidenceDossierReceipt = Readonly<{
  id: string;
  schemaVersion: typeof ECOS_EVIDENCE_DOSSIER_CONTRACT;
  questionSha256: string;
  dossierSha256: string;
  selectedSourceHashes: readonly string[];
  candidateCount: number;
  selectedCount: number;
}>;

export function createECOSQuestionTraceClock(
  nowMs = Date.now(),
): ECOSQuestionTraceClock {
  return {
    traceId: crypto.randomUUID(),
    startedAt: new Date(nowMs).toISOString(),
    currentStage: "request_received",
    currentStageStartedAtMs: nowMs,
    stageDurationsMs: {},
  };
}

export function enterECOSQuestionTraceStage(
  clock: ECOSQuestionTraceClock,
  nextStage: string,
  nowMs = Date.now(),
) {
  const elapsed = Math.max(
    0,
    Math.round(nowMs - clock.currentStageStartedAtMs),
  );
  clock.stageDurationsMs[clock.currentStage] =
    (clock.stageDurationsMs[clock.currentStage] || 0) + elapsed;
  clock.currentStage = boundedCode(nextStage) || "unknown";
  clock.currentStageStartedAtMs = nowMs;
}

export function finishECOSQuestionTraceClock(
  clock: ECOSQuestionTraceClock,
  nowMs = Date.now(),
) {
  enterECOSQuestionTraceStage(clock, "completed", nowMs);
  return Object.freeze({
    completedAt: new Date(nowMs).toISOString(),
    stageDurationsMs: Object.freeze({ ...clock.stageDurationsMs }),
  });
}

export function normalizeECOSClientSurface(
  value: unknown,
  validationMode: string,
): ECOSQuestionClientSurface {
  if (validationMode === "shadow") return "shadow";
  return value === "web" || value === "iphone" || value === "ipad" ||
      value === "android"
    ? value
    : "unknown";
}

export function normalizedRequestId(value: unknown) {
  const candidate = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      .test(candidate)
    ? candidate
    : null;
}

export async function buildECOSEvidenceSnapshotReceipt({
  sources,
  inventory,
}: {
  sources: readonly ECOSReceiptSource[];
  inventory: ECOSEvidenceInventory;
}): Promise<ECOSEvidenceSnapshotReceipt> {
  const sourceReceipts = await Promise.all(sources.map(async (source) => ({
    sourceType: boundedCode(source.sourceType),
    sourceIdSha256: await sha256Text(source.id),
    sourceContentSha256: await sha256Text(stableStringify({
      excerpt: source.excerpt || "",
      citation: source.citation || null,
      updatedAt: source.updatedAt,
    })),
    updatedAt: source.updatedAt,
  })));
  sourceReceipts.sort((left, right) =>
    stableStringify(left).localeCompare(stableStringify(right))
  );
  const snapshotSha256 = await sha256Text(stableStringify({
    schemaVersion: ECOS_EVIDENCE_SNAPSHOT_CONTRACT,
    inventory,
    sourceReceipts,
  }));
  return Object.freeze({
    id: crypto.randomUUID(),
    schemaVersion: ECOS_EVIDENCE_SNAPSHOT_CONTRACT,
    snapshotSha256,
    inventory,
  });
}

export async function buildECOSEvidenceDossierReceipt({
  question,
  snapshot,
  candidates,
  selected,
  assuranceContract,
}: {
  question: string;
  snapshot: ECOSEvidenceSnapshotReceipt;
  candidates: readonly ECOSReceiptSource[];
  selected: readonly ECOSReceiptSource[];
  assuranceContract: string;
}): Promise<ECOSEvidenceDossierReceipt> {
  const questionSha256 = await sha256Text(question);
  const selectedSourceHashes = await Promise.all(
    selected.map((source) =>
      sha256Text(stableStringify({
        id: source.id,
        sourceType: source.sourceType,
        updatedAt: source.updatedAt,
        excerpt: source.excerpt || "",
        citation: source.citation || null,
      }))
    ),
  );
  selectedSourceHashes.sort();
  const candidateCount = Math.max(candidates.length, selected.length);
  const dossierSha256 = await sha256Text(stableStringify({
    schemaVersion: ECOS_EVIDENCE_DOSSIER_CONTRACT,
    snapshotSha256: snapshot.snapshotSha256,
    questionSha256,
    retrievalContract: ECOS_RETRIEVAL_CONTRACT,
    assuranceContract,
    candidateCount,
    selectedSourceHashes,
  }));
  return Object.freeze({
    id: crypto.randomUUID(),
    schemaVersion: ECOS_EVIDENCE_DOSSIER_CONTRACT,
    questionSha256,
    dossierSha256,
    selectedSourceHashes: Object.freeze(selectedSourceHashes),
    candidateCount,
    selectedCount: selected.length,
  });
}

export function questionDiagnostics({
  clock,
  clientRequestId,
  clientSurface,
  snapshot,
  dossier,
  replayed,
  persisted,
}: {
  clock: ECOSQuestionTraceClock;
  clientRequestId: string;
  clientSurface: ECOSQuestionClientSurface;
  snapshot: ECOSEvidenceSnapshotReceipt | null;
  dossier: ECOSEvidenceDossierReceipt | null;
  replayed: boolean;
  persisted: boolean;
}) {
  return Object.freeze({
    schemaVersion: ECOS_QUESTION_TRACE_CONTRACT,
    traceId: clock.traceId,
    clientRequestId,
    clientSurface,
    evidenceSnapshotId: snapshot?.id || null,
    evidenceDossierId: dossier?.id || null,
    replayed,
    persisted,
  });
}

export async function sha256Text(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest)).map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${
      Object.keys(record).sort().map((key) =>
        `${JSON.stringify(key)}:${stableStringify(record[key])}`
      ).join(",")
    }}`;
  }
  return JSON.stringify(value) ?? "null";
}

function boundedCode(value: unknown) {
  return typeof value === "string"
    ? value.trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, "_").slice(0, 120)
    : "";
}
