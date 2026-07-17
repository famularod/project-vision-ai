import type {
  PhotoContinuityAnchor,
  ProjectUpdate,
  UpdatePhoto,
} from '../types';
import type { PIERepeatPhotoGuidance } from './PIEPhotoProgressIntelligence';

const STOP_WORDS = new Set([
  'about', 'after', 'again', 'area', 'before', 'building', 'capture', 'current',
  'field', 'from', 'image', 'photo', 'project', 'same', 'show', 'shows', 'that',
  'this', 'update', 'view', 'visible', 'with', 'work',
]);

export type DAVEAreaIdentity = Readonly<{
  idKey: string;
  nameKey: string;
}>;

export function createDAVEAreaIdentity(
  areaId?: string | null,
  areaName?: string | null,
): DAVEAreaIdentity {
  return Object.freeze({
    idKey: normalized(areaId),
    nameKey: normalized(areaName),
  });
}

export function daveAreaIdentitiesMatch(
  left: DAVEAreaIdentity,
  right: DAVEAreaIdentity,
) {
  if (left.idKey && right.idKey) return left.idKey === right.idKey;
  if (left.nameKey && right.nameKey) return left.nameKey === right.nameKey;
  return false;
}

export function createDAVEPhotoContinuityAnchor({
  guidance,
  projectName,
  areaName,
  confirmedAt = new Date().toISOString(),
}: {
  guidance: PIERepeatPhotoGuidance;
  projectName: string;
  areaName?: string | null;
  confirmedAt?: string;
}): PhotoContinuityAnchor | null {
  const referencePhotoId = clean(guidance.referencePhotoId);
  const expectedProject = normalized(projectName);
  if (
    !referencePhotoId ||
    !expectedProject ||
    normalized(guidance.projectName) !== expectedProject ||
    (areaName && guidance.areaName && normalized(areaName) !== normalized(guidance.areaName))
  ) {
    return null;
  }

  return Object.freeze({
    referencePhotoId,
    referencePhotoUri: clean(guidance.referencePhotoUri),
    realityObjectId: clean(guidance.realityObjectId),
    projectName: projectName.trim(),
    areaName: clean(areaName) || clean(guidance.areaName),
    instruction: clean(guidance.instruction) || 'Match the prior reference photo.',
    alignmentGuide: clean(guidance.alignmentGuide) || 'Keep the same subject and framing.',
    confirmedAt: validTimestamp(confirmedAt) || new Date().toISOString(),
  });
}

export function scoreDAVEVisualContinuityCandidate({
  currentUpdate,
  currentPhoto,
  candidateUpdate,
  candidatePhoto,
}: {
  currentUpdate: ProjectUpdate;
  currentPhoto: UpdatePhoto;
  candidateUpdate: ProjectUpdate;
  candidatePhoto: UpdatePhoto;
}): number {
  if (normalized(currentUpdate.projectName) !== normalized(candidateUpdate.projectName)) {
    return -1;
  }

  const currentAreaId = normalized(currentPhoto.selectedAreaId || currentUpdate.selectedAreaId);
  const currentAreaName = normalized(currentPhoto.selectedAreaName || currentUpdate.selectedAreaName);
  const candidateAreaId = normalized(candidatePhoto.selectedAreaId || candidateUpdate.selectedAreaId);
  const candidateAreaName = normalized(candidatePhoto.selectedAreaName || candidateUpdate.selectedAreaName);

  const anchor = currentPhoto.continuityAnchor;
  if (anchor) {
    if (normalized(anchor.projectName) !== normalized(currentUpdate.projectName)) return -1;
    if (
      anchor.areaName &&
      candidateAreaName &&
      normalized(anchor.areaName) !== candidateAreaName
    ) return -1;
    if (anchor.referencePhotoId === candidatePhoto.id) return 10_000;
  }

  if (currentAreaId && candidateAreaId) {
    if (currentAreaId !== candidateAreaId) return -1;
  } else if (
    currentAreaName &&
    candidateAreaName &&
    currentAreaName !== candidateAreaName
  ) {
    return -1;
  }

  const currentTokens = continuityTokens(currentUpdate, currentPhoto);
  const candidateTokens = continuityTokens(candidateUpdate, candidatePhoto);
  const overlap = [...currentTokens].filter(token => candidateTokens.has(token));
  const unionSize = new Set([...currentTokens, ...candidateTokens]).size;
  const semanticScore = unionSize > 0
    ? Math.round((overlap.length / unionSize) * 500)
    : 0;
  const sameTask = Boolean(
    currentUpdate.scheduleItemId &&
    currentUpdate.scheduleItemId === candidateUpdate.scheduleItemId,
  );
  const sameArea = Boolean(
    (currentAreaId && candidateAreaId && currentAreaId === candidateAreaId) ||
    (!currentAreaId || !candidateAreaId) &&
      currentAreaName &&
      candidateAreaName &&
      currentAreaName === candidateAreaName,
  );
  return semanticScore + (sameTask ? 300 : 0) + (sameArea ? 100 : 0);
}

export function daveVisualContinuityReason(score: number) {
  if (score >= 10_000) return 'the project manager selected this reference photo';
  if (score >= 500) return 'matching task, subject, and area context';
  if (score >= 200) return 'matching subject or task context';
  if (score >= 100) return 'matching confirmed area';
  return 'most recent usable project photo';
}

function continuityTokens(update: ProjectUpdate, photo: UpdatePhoto) {
  const intelligence = photo.photoIntelligence;
  const text = [
    photo.caption,
    update.notes,
    update.scheduleTaskName,
    photo.actionRequired,
    intelligence?.currentObservation,
    intelligence?.changedFromPrior,
    intelligence?.visibleChange,
    intelligence?.location,
    photo.continuityAnchor?.realityObjectId,
  ].filter(Boolean).join(' ');
  return new Set(
    normalized(text)
      .split(' ')
      .filter(token => token.length >= 3 && !STOP_WORDS.has(token)),
  );
}

function normalized(value: unknown) {
  return clean(value)
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim() || '';
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function validTimestamp(value: unknown) {
  const text = clean(value);
  return text && Number.isFinite(new Date(text).getTime()) ? text : null;
}
