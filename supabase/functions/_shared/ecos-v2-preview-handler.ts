import {
  type ECOSQuestionEvidenceRPC,
  prepareECOSQuestionEvidence,
  revalidateECOSPreparedQuestionEvidence,
} from "./ecos-question-evidence-coordinator.ts";
import { createECOSV2LanguagePlanner } from "./ecos-v2-language-planner.ts";
import { composeECOSV2SourceAnswer } from "./ecos-v2-source-answer.ts";
import {
  copyECOSV2JSON,
  type ECOSV2JSONModel,
  readECOSV2BoundedBody,
} from "./ecos-v2-json-model.ts";
import { validateECOSQuestionText } from "./ecos-question-plan.ts";
import {
  answerECOSOwnerOperationalQuestion,
  answerECOSOwnerQuestion,
  assertECOSOwnerOperationalQuestionResult,
  assertECOSOwnerQuestionResult,
  type ECOSOwnerOperationalQuestionDependencies,
  type ECOSOwnerQuestionDependencies,
} from "./ecos-owner-question-coordinator.ts";

export interface ECOSV2PreviewScope {
  organizationId: string;
  projectId: string;
  ownerId: string;
}
/** Admission must be distributed and durable in a hosted adapter. A local mutex
 * is not a production rate limit. Its release finishes/cancels the exact attempt
 * without refunding provider calls which may already have happened. */
export interface ECOSV2PreviewAdmission {
  /** Resolves ONLY after a newly persisted charge. An existing charge is not
   * permission to send again after an interrupted/uncertain prior send. */
  charge(
    stage: Parameters<ECOSV2JSONModel>[0]["stage"],
    signal: AbortSignal,
  ): Promise<void>;
  finish(outcome: "completed" | "failed"): Promise<void>;
}
export interface ECOSV2PreviewDependencies {
  authorize(
    token: string,
    projectId: string,
    signal: AbortSignal,
  ): Promise<ECOSV2PreviewScope | null>;
  admit(
    scope: ECOSV2PreviewScope,
    requestId: string,
    signal: AbortSignal,
    requestSha256: string,
  ): Promise<ECOSV2PreviewAdmission | null>;
  rpc: ECOSQuestionEvidenceRPC;
  modelFactory: () => ECOSV2JSONModel;
  allowedOrigins: readonly string[];
  enabled: boolean;
  budgetMs?: number;
}
const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

function immutableScope(value: ECOSV2PreviewScope, projectId: string) {
  const scope = copyECOSV2JSON(value, 2048) as ECOSV2PreviewScope;
  if (
    !scope || Array.isArray(scope) || Object.keys(scope).sort().join(",") !==
      "organizationId,ownerId,projectId" ||
    scope.projectId !== projectId ||
    typeof scope.ownerId !== "string" || !UUID.test(scope.ownerId) ||
    typeof scope.organizationId !== "string" || !scope.organizationId ||
    scope.organizationId !== scope.organizationId.trim() ||
    new TextEncoder().encode(scope.organizationId).length > 500 ||
    // Reject control characters in the independently authorized scope.
    // deno-lint-ignore no-control-regex
    /[\u0000-\u001f\u007f-\u009f]/.test(scope.organizationId)
  ) {
    throw new Error("Invalid authorized scope");
  }
  return Object.freeze({
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    ownerId: scope.ownerId,
  });
}

/** Explicit parallel PREVIEW contract, never a drop-in legacy answer adapter.
 * Authentication and durable admission are REQUIRED before source/model work.
 * Browser origin is not authorization. Caller cannot supply owner/org/evidence.
 * No backend/database secrets, raw model drafts, writes or fallback answers. */
export function createECOSV2PreviewHandler(deps: ECOSV2PreviewDependencies) {
  if (typeof deps.rpc !== "function") {
    throw new Error("Invalid preview configuration");
  }
  return createPreviewHTTPHandler(deps, {
    schemaVersion: "ecos-question-preview/2.0",
    ownerOnly: false,
    execute: async (scope, question, model, signal, remaining) => {
      const language = createECOSV2LanguagePlanner(model);
      const evidence = await prepareECOSQuestionEvidence(
        { ...scope, question },
        deps.rpc,
        language.planner,
        {
          signal,
          budgetMs: remaining(),
          plannerTimeoutMs: 30000,
          interpreter: language.interpreter,
        },
      );
      const answer = await composeECOSV2SourceAnswer(evidence, model, {
        signal,
        budgetMs: Math.min(90000, remaining()),
        modelTimeoutMs: 30000,
      });
      remaining();
      await revalidateECOSPreparedQuestionEvidence(evidence, signal);
      remaining();
      return answer;
    },
  });
}

export interface ECOSOwnerPreviewDependencies
  extends Omit<ECOSV2PreviewDependencies, "rpc"> {
  evidenceFactory(
    scope: Readonly<ECOSV2PreviewScope>,
  ): Omit<ECOSOwnerQuestionDependencies, "model">;
}

/** Separate owner /2.1 entry point. The shared HTTP shell owns auth/admission;
 * the owner coordinator owns all provenance. Neither a request nor an injected
 * arbitrary answer callback can select a protocol or mint a valid owner answer.
 * Existing /2.0 behavior and its source adapter remain separate and unchanged.
 */
export function createECOSOwnerPreviewHandler(
  deps: ECOSOwnerPreviewDependencies,
) {
  if (typeof deps.evidenceFactory !== "function") {
    throw new Error("Invalid owner preview configuration");
  }
  return createPreviewHTTPHandler(deps, {
    schemaVersion: "ecos-question-preview/2.1",
    ownerOnly: true,
    execute: async (scope, question, model, signal, remaining) => {
      const result = await answerECOSOwnerQuestion(scope, question, {
        ...deps.evidenceFactory(scope),
        model,
      }, { signal, budgetMs: remaining() });
      assertECOSOwnerQuestionResult(result);
      if (
        result.owner_id !== scope.ownerId ||
        result.organization_id !== scope.organizationId ||
        result.project_id !== scope.projectId ||
        result.original_question !== question
      ) throw new Error("Owner result identity changed");
      return result;
    },
  });
}

interface PreviewProtocol {
  schemaVersion:
    | "ecos-question-preview/2.0"
    | "ecos-question-preview/2.1"
    | "ecos-question-preview/2.2";
  ownerOnly: boolean;
  execute(
    scope: Readonly<ECOSV2PreviewScope>,
    question: string,
    model: ECOSV2JSONModel,
    signal: AbortSignal,
    remaining: () => number,
  ): Promise<unknown>;
}
export interface ECOSOwnerOperationalPreviewDependencies
  extends Omit<ECOSOwnerPreviewDependencies, "evidenceFactory"> {
  evidenceFactory(
    scope: Readonly<ECOSV2PreviewScope>,
  ): Omit<ECOSOwnerOperationalQuestionDependencies, "model">;
}
/** Explicit /2.2 only; a /2.1 request is never silently reinterpreted. The exact
 * same auth, admission charges, final access check and deadline shell is used. */
export function createECOSOwnerOperationalPreviewHandler(
  deps: ECOSOwnerOperationalPreviewDependencies,
) {
  if (typeof deps.evidenceFactory !== "function") {
    throw new Error("Invalid owner preview configuration");
  }
  return createPreviewHTTPHandler(deps, {
    schemaVersion: "ecos-question-preview/2.2",
    ownerOnly: true,
    execute: async (scope, question, model, signal, remaining) => {
      const result = await answerECOSOwnerOperationalQuestion(scope, question, {
        ...deps.evidenceFactory(scope),
        model,
      }, { signal, budgetMs: remaining() });
      assertECOSOwnerOperationalQuestionResult(result);
      if (
        result.owner_id !== scope.ownerId ||
        result.organization_id !== scope.organizationId ||
        result.project_id !== scope.projectId ||
        result.original_question !== question
      ) throw new Error("Owner result identity changed");
      return result;
    },
  });
}
function createPreviewHTTPHandler(
  deps: Omit<ECOSV2PreviewDependencies, "rpc">,
  protocol: PreviewProtocol,
) {
  const budgetMs = deps.budgetMs ?? 120_000;
  if (
    !Number.isInteger(budgetMs) || budgetMs < 1 || budgetMs > 120_000 ||
    !Array.isArray(deps.allowedOrigins) ||
    deps.allowedOrigins.some((origin) => {
      try {
        const u = new URL(origin);
        return u.origin !== origin ||
          !["https:", "http:"].includes(u.protocol) ||
          (u.protocol === "http:" &&
            !["127.0.0.1", "localhost"].includes(u.hostname));
      } catch {
        return true;
      }
    }) || typeof deps.authorize !== "function" ||
    typeof deps.admit !== "function" || typeof deps.modelFactory !== "function"
  ) throw new Error("Invalid preview configuration");
  const origins = new Set(deps.allowedOrigins);
  return async (request: Request): Promise<Response> => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      Vary: "Origin",
      "X-Content-Type-Options": "nosniff",
    };
    const send = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), { status, headers });
    const origin = request.headers.get("origin");
    if (origin && !origins.has(origin)) {
      return send({ error: "origin_not_allowed" }, 403);
    }
    if (origin) headers["Access-Control-Allow-Origin"] = origin;
    if (!deps.enabled) return send({ error: "preview_not_enabled" }, 503);
    if (request.method === "OPTIONS") {
      headers["Access-Control-Allow-Methods"] = "POST";
      headers["Access-Control-Allow-Headers"] = "authorization,content-type";
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== "POST") {
      return send({ error: "method_not_allowed" }, 405);
    }
    if (
      !/^application\/json(?:\s*;|$)/i.test(
        request.headers.get("content-type") ?? "",
      )
    ) return send({ error: "json_required" }, 415);
    const auth = request.headers.get("authorization");
    if (!auth || !/^Bearer [^\s]{1,8192}$/.test(auth)) {
      return send({ error: "sign_in_required" }, 401);
    }
    const child = new AbortController();
    const deadline = performance.now() + budgetMs;
    let abort: () => void = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    let admission: ECOSV2PreviewAdmission | null = null;
    let finalized = false;
    let phase = "request";
    const finish = async (outcome: "completed" | "failed") => {
      if (admission && !finalized) {
        finalized = true;
        await admission.finish(outcome);
      }
    };
    const cleanup = async () => {
      let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          finish("failed"),
          new Promise<void>((resolve) => {
            cleanupTimer = setTimeout(resolve, 1000);
          }),
        ]);
      } catch {
        /* Exact server lease expiry remains interruption recovery. */
      } finally {
        if (cleanupTimer !== undefined) clearTimeout(cleanupTimer);
      }
    };
    const remaining = () => {
      const left = Math.floor(deadline - performance.now());
      if (request.signal.aborted || child.signal.aborted || left < 1) {
        throw new Error("Preview stopped");
      }
      return left;
    };
    const stop = new Promise<never>((_, reject) => {
      abort = () => {
        child.abort();
        reject(new Error("Preview stopped"));
      };
      request.signal.addEventListener("abort", abort, { once: true });
      timer = setTimeout(abort, budgetMs);
    });
    try {
      const run = async () => {
        remaining();
        const body = copyECOSV2JSON(
          JSON.parse(
            await readECOSV2BoundedBody(request.body, 20 * 1024, child.signal),
          ),
          20 * 1024,
        ) as Record<string, unknown>;
        if (
          !body || Array.isArray(body) ||
          Object.keys(body).sort().join(",") !==
            "projectId,question,schemaVersion" ||
          body.schemaVersion !== protocol.schemaVersion ||
          typeof body.projectId !== "string" || !UUID.test(body.projectId)
        ) return send({ error: "invalid_preview_request" }, 400);
        const question = validateECOSQuestionText(body.question);
        phase = "initial_authorization";
        const authorized = await deps.authorize(
          auth.slice(7),
          body.projectId,
          child.signal,
        );
        remaining();
        if (!authorized) return send({ error: "project_access_denied" }, 403);
        const scope = immutableScope(authorized, body.projectId);
        if (protocol.ownerOnly && scope.organizationId !== scope.ownerId) {
          return send({ error: "project_access_denied" }, 403);
        }
        // Bind the original request, not a model rewrite, transcript correction,
        // or a mutable caller object. The ledger retains only this fingerprint.
        const requestSha256 = Array.from(
          new Uint8Array(
            await crypto.subtle.digest(
              "SHA-256",
              new TextEncoder().encode(JSON.stringify({
                schemaVersion: protocol.schemaVersion,
                scope,
                projectId: scope.projectId,
                question,
              })),
            ),
          ),
        ).map((byte) => byte.toString(16).padStart(2, "0")).join("");
        remaining();
        phase = "admission";
        admission = await deps.admit(
          scope,
          crypto.randomUUID(),
          child.signal,
          requestSha256,
        );
        if (child.signal.aborted || request.signal.aborted) {
          await cleanup();
          throw new Error("Preview stopped");
        }
        remaining();
        if (!admission) {
          return send({ error: "preview_capacity_unavailable" }, 429);
        }
        if (
          typeof admission.charge !== "function" ||
          typeof admission.finish !== "function"
        ) throw new Error("Invalid preview admission");
        const activeAdmission = admission;
        const originalModel = deps.modelFactory();
        const model: ECOSV2JSONModel = async (modelRequest, signal) => {
          remaining();
          if (signal.aborted) throw new Error("Preview stopped");
          await activeAdmission.charge(modelRequest.stage, signal);
          remaining();
          if (signal.aborted) throw new Error("Preview stopped");
          return await originalModel(modelRequest, signal);
        };
        phase = "answer";
        const answer = await protocol.execute(
          scope,
          question,
          model,
          child.signal,
          remaining,
        );
        remaining();
        if (protocol.ownerOnly) {
          phase = "final_authorization";
          // Source freshness is not access authority. Recheck the actual bearer
          // and exact owner/project after the model, with no cached grant.
          const current = await deps.authorize(
            auth.slice(7),
            scope.projectId,
            child.signal,
          );
          remaining();
          if (
            !current ||
            JSON.stringify(immutableScope(current, scope.projectId)) !==
              JSON.stringify(scope)
          ) {
            await finish("failed");
            remaining();
            return send({ error: "project_access_denied", answer: null }, 403);
          }
        }
        phase = "response";
        const result = {
          schemaVersion: protocol.schemaVersion,
          projectId: scope.projectId,
          question,
          preview: true,
          result: answer,
        };
        if (
          new TextEncoder().encode(JSON.stringify(result)).length > 256 * 1024
        ) throw new Error("Preview response exceeds bounds");
        phase = "completion_receipt";
        await finish("completed");
        remaining();
        return send(result);
      };
      return await Promise.race([run(), stop]);
    } catch {
      if (protocol.ownerOnly) {
        console.warn(JSON.stringify({
          event: "ecos_owner_handler_failed",
          phase,
          elapsedMs: Math.round(budgetMs - (deadline - performance.now())),
        }));
      }
      // Capacity cleanup is attempted even after cancellation. The hosted lease
      // must also expire server-side if this process cannot finish cleanup.
      await cleanup();
      return send({
        error: request.signal.aborted
          ? "preview_cancelled"
          : "preview_unavailable",
        answer: null,
      }, 503);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      request.signal.removeEventListener("abort", abort);
      child.abort();
    }
  };
}
