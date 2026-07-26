import type { PIELiveAuthorityInput } from '../providers/PIELiveAuthorityProvider';

export const PIE_LIVE_AUTHORITY_SIGNATURE_VERSION = 'pie-live-authority-input/2.4';

/**
 * Large evidence collections are immutable React state values. Cache their
 * canonical form by object identity so editing a small draft does not walk
 * every historical update, task, document, and memory on each keystroke.
 *
 * A new collection reference is still serialized in full, so any immutable
 * state change immediately produces a new authority signature.
 */
const authorityCollectionSignatureCache = new WeakMap<object, string>();

export function authorityInputSignature(input: PIELiveAuthorityInput) {
  return stableStringify({
    signatureVersion: PIE_LIVE_AUTHORITY_SIGNATURE_VERSION,
    organizationId: input.organizationId || null,
    projectId: input.projectId || safeProjectId(input.projectName),
    projectName: input.projectName,
    projectNames: input.projectNames,
    reportType: input.reportType || null,
    identityTrusted: input.identityTrusted !== false,
    cloudAvailable: input.cloudAvailable !== false,
    projectTruthPersistencePolicy:
      input.projectTruthPersistencePolicy || 'persist_project',
    updates: cachedStableStringify(input.updates),
    scheduleItems: cachedStableStringify(input.scheduleItems),
    currentUpdate: input.currentUpdate || null,
    projectAreas: cachedStableStringify(input.projectAreas || []),
    contacts: cachedStableStringify(input.contacts || EMPTY_CONTACTS),
    referenceDocuments: cachedStableStringify(input.referenceDocuments || []),
    projectDocuments: cachedStableStringify(input.projectDocuments || []),
    captureMemories: cachedStableStringify(input.captureMemories || []),
    verifiedLearningEvents: cachedStableStringify(input.verifiedLearningEvents || []),
    syncMetadata: input.syncMetadata || null,
  });
}

export function authorityInputScopeSignature(input: PIELiveAuthorityInput) {
  return stableStringify({
    signatureVersion: PIE_LIVE_AUTHORITY_SIGNATURE_VERSION,
    organizationId: input.organizationId || null,
    projectId: input.projectId || safeProjectId(input.projectName),
    projectName: input.projectName,
    projectNames: input.projectNames,
    reportType: input.reportType || null,
    identityTrusted: input.identityTrusted !== false,
    projectTruthPersistencePolicy:
      input.projectTruthPersistencePolicy || 'persist_project',
  });
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(item => item === undefined ? 'null' : stableStringify(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .filter(key => (value as Record<string, unknown>)[key] !== undefined)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

const EMPTY_CONTACTS = Object.freeze({ contacts: [] as never[] });

function cachedStableStringify(value: unknown): string {
  if (!value || typeof value !== 'object') return stableStringify(value);
  const cached = authorityCollectionSignatureCache.get(value);
  if (cached !== undefined) return cached;
  const signature = stableStringify(value);
  authorityCollectionSignatureCache.set(value, signature);
  return signature;
}

function safeProjectId(value: string) {
  return `project-${value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unassigned'}`;
}
