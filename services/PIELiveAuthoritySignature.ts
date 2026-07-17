import type { UpdatePhoto } from '../types';
import type { PIELiveAuthorityInput } from '../providers/PIELiveAuthorityProvider';

export function authorityInputSignature(input: PIELiveAuthorityInput) {
  return JSON.stringify({
    organizationId: input.organizationId || null,
    projectId: input.projectId || safeProjectId(input.projectName),
    projectName: input.projectName,
    projectNames: input.projectNames,
    reportType: input.reportType || null,
    updates: input.updates.slice(0, 80).map(update => ({
      id: update.id,
      date: update.date,
      projectName: update.projectName,
      selectedAreaId: update.selectedAreaId || null,
      selectedAreaName: update.selectedAreaName || null,
      status: update.status,
      pieStatus: update.pieStatus,
      pieCompletedAt: update.pieCompletedAt || null,
      notes: update.notes,
      photos: update.photos.slice(0, 40).map(photo => photoSemanticRevision(update.id, photo)),
    })),
    scheduleIds: input.scheduleItems.map(item => `${item.id}:${item.createdAt}:${item.importedAt || ''}:${item.finishDate}:${item.status}:${item.percentComplete}`).slice(0, 120),
    currentUpdate: input.currentUpdate ? {
      id: input.currentUpdate.id,
      date: input.currentUpdate.date,
      selectedAreaId: input.currentUpdate.selectedAreaId || null,
      selectedAreaName: input.currentUpdate.selectedAreaName || null,
      status: input.currentUpdate.status,
      pieStatus: input.currentUpdate.pieStatus,
      pieCompletedAt: input.currentUpdate.pieCompletedAt || null,
      notes: input.currentUpdate.notes,
      photos: input.currentUpdate.photos.slice(0, 40).map(photo =>
        photoSemanticRevision(input.currentUpdate!.id, photo),
      ),
    } : null,
    documentIds: input.referenceDocuments?.map(document => `${document.id}:${document.importedAt || ''}:${document.isCurrent ? 'current' : 'archived'}:${document.projectId || ''}:${document.projectName || ''}`).slice(0, 80),
    projectDocumentIds: input.projectDocuments?.map(document => `${document.id}:${document.updatedAt || document.createdAt}:${document.status}:${document.projectId || ''}`).slice(0, 80),
    memoryIds: input.captureMemories?.map(memory => `${memory.id}:${memory.confirmedAt}:${memory.corrections.length}`).slice(0, 120),
  });
}

function photoSemanticRevision(updateId: string, photo: UpdatePhoto) {
  const intelligence = photo.photoIntelligence;
  return {
    updateId,
    photoId: photo.id,
    caption: photo.caption,
    category: photo.category,
    actionRequired: photo.actionRequired,
    actionOwner: photo.actionOwner,
    actionDueDate: photo.actionDueDate,
    actionStatus: photo.actionStatus,
    selectedAreaId: photo.selectedAreaId || null,
    selectedAreaName: photo.selectedAreaName || null,
    continuityAnchor: photo.continuityAnchor || null,
    intelligence: intelligence ? {
      status: intelligence.status,
      updatedAt: intelligence.updatedAt,
      title: intelligence.title,
      summary: intelligence.summary,
      visibleChange: intelligence.visibleChange,
      currentObservation: intelligence.currentObservation || null,
      changedFromPrior: intelligence.changedFromPrior || null,
      additions: intelligence.additions || [],
      removals: intelligence.removals || [],
      possibleProgress: intelligence.possibleProgress || null,
      possibleConcerns: intelligence.possibleConcerns || [],
      projectProgress: intelligence.projectProgress,
      repeatPhotoGuidance: intelligence.repeatPhotoGuidance,
      authorityMessage: intelligence.authorityMessage,
      comparisonConfidence: intelligence.comparisonConfidence,
      captureLimitations: intelligence.captureLimitations,
      priorUpdateUsed: intelligence.priorUpdateUsed || null,
      priorEvidenceId: intelligence.priorEvidenceId || null,
      provenance: intelligence.provenance || null,
      requestId: intelligence.requestId || null,
      comparisonId: intelligence.comparisonId || null,
      analysisRequestId: intelligence.analysisRequestId || null,
      currentPhotoAssetId: intelligence.currentPhotoAssetId || null,
      priorPhotoAssetId: intelligence.priorPhotoAssetId || null,
      currentEvidenceId: intelligence.currentEvidenceId || null,
      semanticComparisonResultId: intelligence.semanticComparisonResultId || null,
    } : null,
  };
}

function safeProjectId(value: string) {
  return `project-${value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unassigned'}`;
}
