import { sha256 } from '@noble/hashes/sha256';
import { utf8ToBytes } from '@noble/hashes/utils';
import type { ReferenceDocument } from '../types';

const HOSTED_EVIDENCE_VERSION = 'ecos-hosted-evidence/1.3';
const verifiedRuntimePageGraphs = new WeakMap<object, string>();

export function computeECOSPageGraphSha256(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const canonical = canonicalJSON(value);
  if (!canonical) return null;
  return [...sha256(utf8ToBytes(canonical))]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function hasECOSHostedCommitReceipt(document: ReferenceDocument) {
  const sourceSha256 = canonicalSha256(document.contentSha256);
  const indexedSha256 = canonicalSha256(document.indexedContentSha256);
  const committedSha256 = canonicalSha256(document.ecosVerifiedIndexCommittedSha256);
  return document.ecosVerifiedIndexCommitVersion === 'ecos-verified-index-commit/1.0' &&
    sourceSha256 != null &&
    sourceSha256 === indexedSha256 &&
    sourceSha256 === committedSha256 &&
    positiveInteger(document.ecosVerifiedIndexCommittedPageCount) != null &&
    canonicalSha256(document.ecosVerifiedIndexPageGraphSha256) != null;
}

export function hasAuthoritativeECOSPageGraph(document: ReferenceDocument) {
  const pages = document.extractedPages;
  if (!Array.isArray(pages) || pages.length === 0) return false;
  const currentDigest = computeECOSPageGraphSha256(pages);
  const runtimeDigest = verifiedRuntimePageGraphs.get(pages);
  if (runtimeDigest != null && runtimeDigest === currentDigest) return true;
  if (!hasECOSHostedCommitReceipt(document)) return false;
  return currentDigest ===
    canonicalSha256(document.ecosVerifiedIndexPageGraphSha256);
}

export function markECOSHostedSearchPageGraph(document: ReferenceDocument) {
  const pages = document.extractedPages;
  if (
    Array.isArray(pages) && pages.length > 0 &&
    pages.every(page =>
      page.assurance?.accepted === true &&
      page.assurance.evidenceVersion === HOSTED_EVIDENCE_VERSION,
    )
  ) rememberRuntimePageGraph(pages);
  return document;
}

/**
 * Carries a database-verified receipt across deterministic client
 * normalization. The receipt is checked against the exact persisted graph
 * before the normalized replacement receives a runtime-only digest binding.
 */
export function markNormalizedECOSHostedReceiptPageGraph(
  persisted: Partial<ReferenceDocument>,
  normalized: ReferenceDocument,
) {
  const persistedPages = persisted.extractedPages;
  if (
    Array.isArray(persistedPages) &&
    persistedPages.length > 0 &&
    hasECOSHostedCommitReceipt(persisted as ReferenceDocument) &&
    positiveInteger(persisted.ecosVerifiedIndexCommittedPageCount) === persistedPages.length &&
    computeECOSPageGraphSha256(persistedPages) ===
      canonicalSha256(persisted.ecosVerifiedIndexPageGraphSha256)
  ) rememberRuntimePageGraph(normalized.extractedPages);
  return normalized;
}

function rememberRuntimePageGraph(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) return;
  const digest = computeECOSPageGraphSha256(value);
  if (digest) verifiedRuntimePageGraphs.set(value, digest);
}

function canonicalJSON(value: unknown): string | null {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? JSON.stringify(Object.is(value, -0) ? 0 : value) : null;
  }
  if (Array.isArray(value)) {
    const items = value.map(item => canonicalJSON(item) ?? 'null');
    return `[${items.join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .flatMap(key => {
        const encoded = canonicalJSON((value as Record<string, unknown>)[key]);
        return encoded == null ? [] : [`${JSON.stringify(key)}:${encoded}`];
      });
    return `{${entries.join(',')}}`;
  }
  return null;
}

function positiveInteger(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function canonicalSha256(value: unknown) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}
