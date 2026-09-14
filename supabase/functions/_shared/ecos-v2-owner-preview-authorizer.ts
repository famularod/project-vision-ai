import { readECOSV2BoundedBody } from "./ecos-v2-json-model.ts";
import type { ECOSV2PreviewScope } from "./ecos-v2-preview-handler.ts";

const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const ECOS_V2_OWNER_PREVIEW_SUPABASE_URL =
  "https://xdytqlpsqsseoeuxgzre.supabase.co";

/** Authentication seam ONLY, not a deployed preview or evidence-readiness gate.
 * The verified app owner uses their existing owner-UUID DAVE Workspace. No
 * unordered membership choice, caller-supplied organization, service credential,
 * token decoding, saved session, auth mutation, or authorization cache.
 *
 * Existing caller-RLS project access and exact active organization-admin checks
 * are reused unchanged. V2 inventory must still check current project/source
 * lifecycle and bindings, and the hosted adapter must supply durable admission.
 * These sequential reads are not an atomic or indefinitely valid access grant.
 */
export function createECOSV2OwnerPreviewAuthorizer(options: {
  supabaseUrl: string;
  anonKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): (
  token: string,
  projectId: string,
  signal: AbortSignal,
) => Promise<ECOSV2PreviewScope | null> {
  const { supabaseUrl, anonKey } = options;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const fetchImpl = options.fetchImpl ?? fetch;
  // Server configuration, never a request-provided destination. This narrow
  // adapter intentionally supports only the established Supabase project host.
  if (
    supabaseUrl !== ECOS_V2_OWNER_PREVIEW_SUPABASE_URL ||
    typeof anonKey !== "string" || !/^[!-~]{1,8192}$/.test(anonKey) ||
    !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000 ||
    typeof fetchImpl !== "function"
  ) throw new Error("Invalid owner preview authorization configuration");

  return async (token, projectId, signal) => {
    if (
      typeof token !== "string" || !/^[!-~]{1,8192}$/.test(token) ||
      typeof projectId !== "string" || !UUID.test(projectId)
    ) return null;
    if (!(signal instanceof AbortSignal) || signal.aborted) {
      throw new Error("Owner preview authorization unavailable");
    }
    const child = new AbortController();
    const deadline = performance.now() + timeoutMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: () => void = () => {};
    const stopped = new Promise<never>((_, reject) => {
      abort = () => {
        child.abort();
        reject(new Error("Owner preview authorization unavailable"));
      };
      signal.addEventListener("abort", abort, { once: true });
      timer = setTimeout(abort, timeoutMs);
    });
    const check = () => {
      if (
        signal.aborted || child.signal.aborted || performance.now() >= deadline
      ) {
        throw new Error("Owner preview authorization unavailable");
      }
    };
    const request = async (
      path: string,
      body: Record<string, string> | null,
      maxBytes: number,
      authentication = false,
    ): Promise<unknown> => {
      check();
      const response = await fetchImpl(supabaseUrl + path, {
        method: body === null ? "GET" : "POST",
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(body === null ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === null ? {} : { body: JSON.stringify(body) }),
        redirect: "error",
        cache: "no-store",
        credentials: "omit",
        signal: child.signal,
      });
      if (
        signal.aborted || child.signal.aborted || performance.now() >= deadline
      ) {
        void response.body?.cancel().catch(() => {});
      }
      check();
      if (authentication && [401, 403].includes(response.status)) {
        void response.body?.cancel().catch(() => {});
        return null;
      }
      if (
        !response.ok || response.redirected ||
        !/^application\/json(?:\s*;|$)/i.test(
          response.headers.get("content-type") ?? "",
        )
      ) {
        void response.body?.cancel().catch(() => {});
        throw new Error("Owner preview authorization unavailable");
      }
      const text = await readECOSV2BoundedBody(
        response.body,
        maxBytes,
        child.signal,
      );
      check();
      const parsed: unknown = JSON.parse(text);
      check();
      return parsed;
    };
    try {
      return await Promise.race([
        stopped,
        (async () => {
          const user = await request("/auth/v1/user", null, 64 * 1024, true);
          if (
            !user || typeof user !== "object" || Array.isArray(user) ||
            !("id" in user) || typeof user.id !== "string" ||
            !UUID.test(user.id) ||
            ("is_anonymous" in user && user.is_anonymous !== false)
          ) return null;
          const ownerId = user.id;
          const appOwner = await request(
            "/rest/v1/rpc/dave_is_app_owner",
            {},
            64,
          );
          if (appOwner !== true) return null;
          const query = new URLSearchParams({
            select: "id,owner_id,archived",
            id: `eq.${projectId}`,
            owner_id: `eq.${ownerId}`,
            archived: "is.false",
            limit: "2",
          });
          const projects = await request(
            `/rest/v1/projects?${query}`,
            null,
            2048,
          );
          if (!Array.isArray(projects) || projects.length !== 1) return null;
          const project = projects[0];
          if (
            !project || typeof project !== "object" ||
            Object.keys(project).sort().join(",") !==
              "archived,id,owner_id" ||
            project.id !== projectId || project.owner_id !== ownerId ||
            project.archived !== false
          ) return null;
          const ownerWorkspaceAdmin = await request(
            "/rest/v1/rpc/vitruvius_is_active_organization_admin",
            { target_organization_id: ownerId },
            64,
          );
          if (ownerWorkspaceAdmin !== true) return null;
          check();
          return Object.freeze({
            organizationId: ownerId,
            projectId,
            ownerId,
          });
        })(),
      ]);
    } catch {
      // Never expose auth/provider responses, caller tokens, or project data.
      throw new Error("Owner preview authorization unavailable");
    } finally {
      child.abort();
      signal.removeEventListener("abort", abort);
      if (timer !== undefined) clearTimeout(timer);
    }
  };
}
