import type { PIELiveAuthorityInput } from '../providers/PIELiveAuthorityProvider';

export const PIE_LIVE_AUTHORITY_SIGNATURE_VERSION = 'pie-live-authority-input/2.2';

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
    updates: input.updates,
    scheduleItems: input.scheduleItems,
    currentUpdate: input.currentUpdate || null,
    projectAreas: input.projectAreas || [],
    contacts: input.contacts || { contacts: [] },
    referenceDocuments: input.referenceDocuments || [],
    projectDocuments: input.projectDocuments || [],
    captureMemories: input.captureMemories || [],
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

function safeProjectId(value: string) {
  return `project-${value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unassigned'}`;
}
