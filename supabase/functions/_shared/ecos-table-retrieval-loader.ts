import {
  bindECOSTableSourceManifest,
  projectECOSManifestTableRecords,
} from './ecos-table-source-manifest.ts';
import { buildECOSTableRetrievalBundle } from './ecos-table-retrieval-bundle.ts';

export interface ECOSTableRetrievalSourceRequest {
  jobId: string;
  claimToken: string;
  sourceId: string;
  sourceSha256: string;
  sourceRevision: string | null;
  sourcePageCount: number;
  pageNumbers: readonly number[];
}

export interface ECOSTableRetrievalRequest {
  organizationId: string;
  projectId: string;
  sources: readonly ECOSTableRetrievalSourceRequest[];
}

/** An internal service transport returning the RPC's JSON value, not an HTTP
 * wrapper. The adapter must propagate signal to the underlying request. It may
 * NOT resolve independent source scope from customer-supplied RPC results. */
export type ECOSTableSourceRPC = (
  name:
    | 'ecos_snapshot_hosted_table_source_accountability'
    | 'ecos_load_manifest_table_source',
  parameters: Readonly<Record<string, string | number>>,
  signal: AbortSignal,
) => Promise<unknown>;

function identity(
  value: unknown,
  field: string,
  pattern?: RegExp,
  maximumBytes = 300,
): string {
  if (
    typeof value !== 'string' || value !== value.trim() || !value ||
    new TextEncoder().encode(value).length > maximumBytes ||
    [...value].some((character) =>
      character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
    ) ||
    /^\u0085|\u0085$/.test(value) ||
    (pattern && !pattern.test(value))
  ) throw new Error(`Invalid retrieval ${field}`);
  return value;
}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;

function requestSnapshot(input: ECOSTableRetrievalRequest) {
  if (
    !input || typeof input !== 'object' || !Array.isArray(input.sources) ||
    input.sources.length < 1 || input.sources.length > 16
  ) {
    throw new Error('Retrieval requires one through sixteen scoped sources');
  }
  const organizationId = identity(
    input.organizationId,
    'organization',
    undefined,
    500,
  );
  const projectId = identity(input.projectId, 'project', undefined, 500);
  const jobs = new Set<string>();
  const sourceIds = new Set<string>();
  let pageCount = 0;
  // Copy every request field synchronously before the first network wait. No
  // caller mutation can retarget later calls or expose another project source.
  const sources = input.sources.map((source) => {
    if (!source || typeof source !== 'object') {
      throw new Error('Invalid retrieval source');
    }
    const jobId = identity(source.jobId, 'job', UUID);
    const sourceId = identity(source.sourceId, 'source');
    if (jobs.has(jobId) || sourceIds.has(sourceId)) {
      throw new Error('Duplicate retrieval source');
    }
    jobs.add(jobId);
    sourceIds.add(sourceId);
    const sourcePageCount = source.sourcePageCount;
    if (
      !Number.isSafeInteger(sourcePageCount) || sourcePageCount < 1 ||
      sourcePageCount > 10_000 ||
      !Array.isArray(source.pageNumbers) || source.pageNumbers.length > 32
    ) {
      throw new Error('Invalid retrieval page inventory');
    }
    const pageNumbers = source.pageNumbers.map((page: number) => {
      if (!Number.isSafeInteger(page) || page < 1 || page > sourcePageCount) {
        throw new Error('Retrieval page is outside its registered source');
      }
      return page;
    }).sort((left: number, right: number) => left - right);
    if (new Set(pageNumbers).size !== pageNumbers.length) {
      throw new Error('Duplicate retrieval page');
    }
    pageCount += pageNumbers.length;
    if (pageCount > 32) {
      throw new Error('Retrieval exceeds the total page budget');
    }
    return Object.freeze({
      jobId,
      sourceId,
      sourcePageCount,
      claimToken: identity(source.claimToken, 'claim', UUID),
      sourceSha256: identity(source.sourceSha256, 'source hash', SHA),
      sourceRevision: source.sourceRevision === null
        ? null
        : identity(source.sourceRevision, 'revision'),
      pageNumbers: Object.freeze(pageNumbers),
    });
  });
  return Object.freeze({
    organizationId,
    projectId,
    sources: Object.freeze(sources),
  });
}

function receiptPins(raw: unknown) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid source snapshot receipt');
  }
  const id = Object.getOwnPropertyDescriptor(raw, 'manifest_id');
  const hash = Object.getOwnPropertyDescriptor(raw, 'manifest_sha256');
  if (
    !id || !Object.hasOwn(id, 'value') || !hash || !Object.hasOwn(hash, 'value')
  ) {
    throw new Error('Invalid source snapshot receipt');
  }
  return {
    manifestId: identity(id.value, 'manifest', UUID),
    manifestSha256: identity(hash.value, 'manifest hash', SHA),
  };
}

/**
 * Internal shadow-source retrieval coordinator, NOT a customer endpoint. The
 * caller must already resolve authorized organization/project/source identities
 * and valid worker claims. This function creates no session, does not enumerate
 * the project library, and performs no answer generation or task mutation.
 *
 * Source inventories are snapshotted, exact selected pages are read one at a
 * time, and every inventory is checked again before returning any bundle. This
 * does not establish a simultaneous project-wide transaction or future freshness.
 * There is no prefix success, background retry or fallback to unbound evidence.
 */
export async function loadECOSTableRetrievalBundle(
  input: ECOSTableRetrievalRequest,
  rpc: ECOSTableSourceRPC,
  options: { signal?: AbortSignal; budgetMs?: number; rpcTimeoutMs?: number } =
    {},
) {
  const request = requestSnapshot(input);
  if (typeof rpc !== 'function') {
    throw new Error('Scoped source transport required');
  }
  const budgetMs = options.budgetMs ?? 120_000;
  const rpcTimeoutMs = options.rpcTimeoutMs ?? 25_000;
  if (
    !Number.isSafeInteger(budgetMs) || budgetMs < 1 || budgetMs > 120_000 ||
    !Number.isSafeInteger(rpcTimeoutMs) || rpcTimeoutMs < 1 ||
    rpcTimeoutMs > 25_000
  ) {
    throw new Error('Invalid bounded retrieval deadline');
  }
  const signal = options.signal;
  const deadline = performance.now() + budgetMs;
  function checkDeadline() {
    if (signal?.aborted) throw new Error('Source retrieval cancelled');
    if (performance.now() >= deadline) {
      throw new Error('Source retrieval deadline exceeded');
    }
  }
  async function call(
    name: Parameters<ECOSTableSourceRPC>[0],
    parameters: Parameters<ECOSTableSourceRPC>[1],
  ) {
    checkDeadline();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    const stopped = new Promise<never>((_resolve, reject) => {
      abort = () => {
        controller.abort();
        reject(new Error('Source retrieval cancelled'));
      };
      signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('Source retrieval deadline exceeded'));
      }, Math.max(1, Math.min(rpcTimeoutMs, deadline - performance.now())));
    });
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => {
          checkDeadline();
          if (controller.signal.aborted) {
            throw new Error('Source retrieval cancelled');
          }
          return rpc(name, Object.freeze({ ...parameters }), controller.signal);
        }),
        stopped,
      ]);
      checkDeadline();
      return result;
    } catch {
      // Do not propagate arbitrary RPC text which may contain source content,
      // tokens or server details. No later request runs after this failure.
      throw new Error(
        signal?.aborted
          ? 'Source retrieval cancelled'
          : 'Source retrieval unavailable or changed',
      );
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (abort) signal?.removeEventListener('abort', abort);
      controller.abort();
    }
  }
  const sources = [];
  let retainedBytes = 4096;
  let proposedRecords = 0;
  function retain(value: unknown) {
    retainedBytes += new TextEncoder().encode(JSON.stringify(value)).length;
    if (retainedBytes > 8 * 1024 * 1024) {
      throw new Error(
        'Source retrieval exceeds the retained evidence byte budget',
      );
    }
  }
  function expectedScope(source: typeof request.sources[number]) {
    return {
      organizationId: request.organizationId,
      projectId: request.projectId,
      jobId: source.jobId,
      sourceId: source.sourceId,
      sourceSha256: source.sourceSha256,
      sourceRevision: source.sourceRevision,
      sourcePageCount: source.sourcePageCount,
    };
  }
  for (const source of request.sources) {
    const parameters = {
      p_job_id: source.jobId,
      p_claim_token: source.claimToken,
    };
    const rawManifest = await call(
      'ecos_snapshot_hosted_table_source_accountability',
      parameters,
    );
    const manifest = bindECOSTableSourceManifest(rawManifest, {
      ...expectedScope(source),
      ...receiptPins(rawManifest),
    });
    retain(manifest);
    const pages = [];
    for (const pageNumber of source.pageNumbers) {
      checkDeadline();
      const pin = manifest.items[pageNumber - 1];
      // Pending pages remain in the manifest and retrieval coverage, not as
      // invented empty payloads. Unreadable/failed checkpoints are still read.
      if (pin.projectionId === null || pin.projectionSha256 === null) continue;
      const raw = await call('ecos_load_manifest_table_source', {
        ...parameters,
        p_manifest_id: manifest.manifestId,
        p_manifest_sha256: manifest.manifestSha256,
        p_page_number: pageNumber,
        p_expected_projection_id: pin.projectionId,
        p_expected_projection_sha256: pin.projectionSha256,
      });
      const page = await projectECOSManifestTableRecords(
        raw,
        manifest,
        pageNumber,
      );
      proposedRecords += page.projection.records.length;
      if (proposedRecords > 2_000) {
        throw new Error('Source retrieval exceeds the proposed record budget');
      }
      retain(page);
      pages.push(page);
    }
    sources.push({ manifest, pages });
  }
  // Catch a change to any source, including one loaded before a later source.
  for (let index = 0; index < request.sources.length; index++) {
    const source = request.sources[index];
    const manifest = sources[index].manifest;
    const raw = await call('ecos_snapshot_hosted_table_source_accountability', {
      p_job_id: source.jobId,
      p_claim_token: source.claimToken,
    });
    bindECOSTableSourceManifest(raw, {
      ...expectedScope(source),
      manifestId: manifest.manifestId,
      manifestSha256: manifest.manifestSha256,
    });
  }
  checkDeadline();
  const result = buildECOSTableRetrievalBundle({ ...request, sources });
  checkDeadline();
  return result;
}
