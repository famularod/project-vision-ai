import type { ProjectUpdate, UpdatePhoto } from '../types';
import type { ReportDrawingReference } from './ReportDrawingReferences';

/**
 * What the Word report prints of a photo of a field update, besides the picture itself: its caption, where and when it
 * was recorded, the task it was recorded against, and why it is there. One description for the phone's and the
 * desktop's Word files (ReportWordMedia.native / .web), and what the report's fingerprint holds of the photo (HIGH item
 * 1f: ReportWrittenFacts `wordPhotos`), so the three cannot part.
 */
export function reportWordPhotoDescription(photo: UpdatePhoto, update: ProjectUpdate) {
  return {
    caption: photo.caption?.trim() || `Project photo from ${photo.selectedAreaName || update.selectedAreaName || update.projectName}`,
    projectName: update.projectName,
    areaName: photo.selectedAreaName || update.selectedAreaName,
    linkedTaskName: update.scheduleTaskName,
    recordedAt: update.date,
    reasonForInclusion: photoReasonForInclusion(update, photo),
  };
}

/**
 * What the Word report prints of a drawing excerpt besides the picture: its label where it cannot be shown, its caption,
 * where it is, why it is there, and its citation. One description for the phone's and the desktop's Word files; the
 * report's fingerprint holds the citation itself (DAVEProjectTruth `drawingCitations`).
 */
export function reportWordDrawingDescription(reference: ReportDrawingReference) {
  return {
    label: `${reference.projectName} · ${reference.areaName} · ${reference.citation.label}`,
    caption: `${reference.projectName} — ${reference.areaName}`,
    projectName: reference.projectName,
    areaName: reference.areaName,
    reasonForInclusion:
      `This excerpt comes from the current drawing reference mapped to ${reference.areaName} ` +
      'and is included so the reader can verify the reported work location.',
    citation: reference.citation.label,
  };
}

function photoReasonForInclusion(
  update: ProjectUpdate,
  photo: UpdatePhoto,
): string {
  const area = photo.selectedAreaName?.trim() || update.selectedAreaName?.trim();
  const task = update.scheduleTaskName?.trim();
  if (task) {
    return `This photo is attached to the field update for ${task}` +
      `${area ? ` in ${area}` : ''} and supports the recorded project condition.`;
  }
  return `This photo is attached to a field update for ${area || update.projectName} ` +
    'and supports the recorded project condition.';
}
