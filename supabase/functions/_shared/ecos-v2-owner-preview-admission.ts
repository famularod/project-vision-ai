import { copyECOSV2JSON } from "./ecos-v2-json-model.ts";
import type {
  ECOSV2PreviewAdmission,
  ECOSV2PreviewDependencies,
  ECOSV2PreviewScope,
} from "./ecos-v2-preview-handler.ts";

export type ECOSV2OwnerPreviewLedgerRPC = (
  name:
    | "ecos_admit_owner_preview"
    | "ecos_charge_owner_preview_stage"
    | "ecos_finish_owner_preview",
  parameters: Readonly<Record<string, string>>,
  signal: AbortSignal,
) => Promise<unknown>;
type Stage = Parameters<ECOSV2PreviewAdmission["charge"]>[0];
const stages: readonly Stage[] = ["interpret", "plan", "compose", "verify"];
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const sha = /^[a-f0-9]{64}$/;
const unavailable = () => new Error("Owner preview admission unavailable");
type Reply = {
  schema_version: "ecos-owner-preview-admission/2.0";
  publication_mode: "shadow";
  action: string;
  request_id: string;
  owner_id: string;
  organization_id: string;
  project_id: string;
  request_sha256: string;
  status: null | "admitted" | "completed" | "failed" | "expired" | "cancelled";
  expires_at: null | string;
  charged_attempt_count: number;
  remaining_attempts: number;
  stage: Stage | null;
  retrieval_authorized: false;
};

function bindReply(
  raw: unknown,
  params: Readonly<Record<string, string>>,
  kind: "admit" | "charge" | "finish",
): Reply {
  const r = copyECOSV2JSON(raw, 4096) as Reply;
  if (
    !r || Array.isArray(r) || Object.keys(r).sort().join(",") !==
      "action,charged_attempt_count,expires_at,organization_id,owner_id,project_id,publication_mode,remaining_attempts,request_id,request_sha256,retrieval_authorized,schema_version,stage,status" ||
    r.schema_version !== "ecos-owner-preview-admission/2.0" ||
    r.publication_mode !== "shadow" || r.retrieval_authorized !== false ||
    r.owner_id !== params.p_owner_id ||
    r.organization_id !== params.p_owner_id ||
    r.project_id !== params.p_project_id ||
    r.request_id !== params.p_request_id ||
    r.request_sha256 !== params.p_request_sha256 ||
    !Number.isInteger(r.charged_attempt_count) ||
    r.charged_attempt_count < 0 || r.charged_attempt_count > 4 ||
    r.remaining_attempts !== 4 - r.charged_attempt_count ||
    ![null, "admitted", "completed", "failed", "expired", "cancelled"].includes(
      r.status,
    ) || r.stage !== (kind === "charge" ? params.p_stage : null) ||
    (r.expires_at !== null && (
      typeof r.expires_at !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(
        r.expires_at,
      ) || !Number.isFinite(Date.parse(r.expires_at))
    ))
  ) throw unavailable();
  const actions = kind === "admit"
    ? ["admitted", "already_admitted", "terminal", "capacity_unavailable"]
    : kind === "charge"
    ? ["charged", "already_charged", "terminal", "capacity_unavailable"]
    : ["finished", "terminal"];
  if (!actions.includes(r.action)) throw unavailable();
  if (r.status === null) {
    if (
      kind !== "admit" || r.action !== "capacity_unavailable" ||
      r.expires_at !== null || r.charged_attempt_count !== 0
    ) throw unavailable();
  } else if (r.status === "cancelled") {
    if (
      r.expires_at !== null || r.charged_attempt_count !== 0 ||
      !["terminal", "finished"].includes(r.action)
    ) throw unavailable();
  } else if (r.expires_at === null) throw unavailable();
  if (
    (["admitted", "already_admitted", "charged", "already_charged"].includes(
      r.action,
    ) && r.status !== "admitted") ||
    (r.action === "terminal" &&
      (r.status === null || r.status === "admitted")) ||
    (r.action === "finished" &&
      !["completed", "failed", "cancelled"].includes(r.status ?? "")) ||
    (kind === "charge" && r.action === "capacity_unavailable" &&
      r.status !== "admitted")
  ) throw unavailable();
  return r;
}

/** Local adapter seam only. The injected RPC transport must use the separately
 * verified owner and the service-only ledger, never caller credentials/scope.
 * One bounded attempt per operation; committed or uncertain provider charges
 * are never refunded. This is the separate preview budget, not a global budget.
 * Database lease expiry is the final recovery if this process is interrupted.
 */
export function createECOSV2OwnerPreviewAdmission(options: {
  rpc: ECOSV2OwnerPreviewLedgerRPC;
  timeoutMs?: number;
  cleanupTimeoutMs?: number;
}): ECOSV2PreviewDependencies["admit"] {
  const rpc = options.rpc;
  const timeoutMs = options.timeoutMs ?? 5000;
  const cleanupTimeoutMs = options.cleanupTimeoutMs ?? 1000;
  if (
    typeof rpc !== "function" || !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 || timeoutMs > 10_000 ||
    !Number.isInteger(cleanupTimeoutMs) || cleanupTimeoutMs < 1 ||
    cleanupTimeoutMs > 1000
  ) throw unavailable();

  const call = async (
    name: Parameters<ECOSV2OwnerPreviewLedgerRPC>[0],
    params: Readonly<Record<string, string>>,
    signal: AbortSignal,
    bound: number,
  ): Promise<unknown> => {
    if (!(signal instanceof AbortSignal) || signal.aborted) throw unavailable();
    const child = new AbortController(), deadline = performance.now() + bound;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort = () => {};
    const check = () => {
      if (
        signal.aborted || child.signal.aborted || performance.now() >= deadline
      ) throw unavailable();
    };
    const stopped = new Promise<never>((_, reject) => {
      abort = () => {
        child.abort();
        reject(unavailable());
      };
      signal.addEventListener("abort", abort, { once: true });
      timer = setTimeout(abort, bound);
    });
    try {
      return await Promise.race([
        stopped,
        Promise.resolve().then(async () => {
          check();
          const result = await rpc(name, params, child.signal);
          check();
          return result;
        }),
      ]);
    } catch {
      throw unavailable();
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      child.abort();
    }
  };

  return async (inputScope, requestId, signal, requestSha256) => {
    const scope = copyECOSV2JSON(inputScope, 2048) as ECOSV2PreviewScope;
    if (
      !scope || Array.isArray(scope) || Object.keys(scope).sort().join(",") !==
        "organizationId,ownerId,projectId" ||
      typeof scope.ownerId !== "string" || !uuid.test(scope.ownerId) ||
      scope.organizationId !== scope.ownerId ||
      typeof scope.projectId !== "string" || !uuid.test(scope.projectId) ||
      typeof requestId !== "string" || !uuid.test(requestId) ||
      typeof requestSha256 !== "string" || !sha.test(requestSha256) ||
      !(signal instanceof AbortSignal) || signal.aborted
    ) throw unavailable();
    const params = Object.freeze({
      p_owner_id: scope.ownerId,
      p_project_id: scope.projectId,
      p_request_id: requestId,
      p_request_sha256: requestSha256,
    });
    const independentFinish = async (status: "completed" | "failed") => {
      const finishParams = Object.freeze({ ...params, p_status: status });
      const raw = await call(
        "ecos_finish_owner_preview",
        finishParams,
        // A normal completion is part of the live request, not emergency
        // cleanup. Give its receipt the same bounded RPC window as admission
        // and charge, while retaining parent cancellation and the outer total
        // deadline. Only failure cleanup survives cancellation for <=1 second.
        status === "completed" ? signal : new AbortController().signal,
        status === "completed" ? timeoutMs : cleanupTimeoutMs,
      );
      const reply = bindReply(raw, finishParams, "finish");
      if (
        reply.action === "finished" && reply.status !== status &&
        !(status === "failed" && reply.status === "cancelled")
      ) throw unavailable();
      return reply;
    };
    let first: Reply;
    try {
      first = bindReply(
        await call("ecos_admit_owner_preview", params, signal, timeoutMs),
        params,
        "admit",
      );
      if (signal.aborted) throw unavailable();
      if (["capacity_unavailable", "terminal"].includes(first.action)) {
        return null;
      }
      // A conservative client-side lease bound cannot extend the database lease.
      if (
        first.expires_at === null ||
        Date.parse(first.expires_at) <= Date.now() ||
        Date.parse(first.expires_at) > Date.now() + 125_000 ||
        (first.action === "admitted" && first.charged_attempt_count !== 0)
      ) throw unavailable();
    } catch {
      // This also creates a cancellation tombstone if an admission RPC is still
      // delayed. The owner-serialized ledger cannot activate that request later.
      try {
        await independentFinish("failed");
      } catch {
        /* Server expiry remains the interruption recovery boundary. */
      }
      throw unavailable();
    }
    const expires = first.expires_at!;
    const leaseDeadline = performance.now() +
      Math.max(0, Date.parse(expires) - Date.now());
    let count = first.charged_attempt_count, charging = false, blocked = false;
    let finishPromise: Promise<void> | undefined;
    return Object.freeze({
      charge: async (stage: Stage, stageSignal: AbortSignal) => {
        if (
          finishPromise || charging || blocked || stage !== stages[count] ||
          !(stageSignal instanceof AbortSignal) || stageSignal.aborted ||
          signal.aborted || performance.now() >= leaseDeadline
        ) throw unavailable();
        charging = true;
        try {
          const chargeParams = Object.freeze({ ...params, p_stage: stage });
          const reply = bindReply(
            await call(
              "ecos_charge_owner_preview_stage",
              chargeParams,
              stageSignal,
              Math.min(
                timeoutMs,
                Math.max(1, leaseDeadline - performance.now()),
              ),
            ),
            chargeParams,
            "charge",
          );
          if (
            finishPromise || signal.aborted || stageSignal.aborted ||
            performance.now() >= leaseDeadline || reply.action !== "charged" ||
            reply.expires_at !== expires ||
            reply.charged_attempt_count !== count + 1
          ) throw unavailable();
          count = reply.charged_attempt_count;
        } catch {
          // Even a failed/uncertain charge cannot be retried by this handle.
          // The caller must finish the request; durable charges are not refunded.
          blocked = true;
          throw unavailable();
        } finally {
          charging = false;
        }
      },
      finish: (outcome: "completed" | "failed") => {
        if (!finishPromise) {
          finishPromise = (async () => {
            if (!["completed", "failed"].includes(outcome)) throw unavailable();
            const reply = await independentFinish(outcome);
            if (
              reply.expires_at !== expires ||
              reply.charged_attempt_count < count ||
              (outcome === "completed" && reply.status !== "completed")
            ) throw unavailable();
          })();
        }
        return finishPromise;
      },
    });
  };
}
