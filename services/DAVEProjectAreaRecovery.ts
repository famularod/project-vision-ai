import type { ProjectArea } from '../types';

/**
 * Combines area records without allowing a default/placeholder coordinate to
 * replace a GPS position that a person actually captured. Metadata and GPS
 * are resolved separately so a later rename can still propagate safely.
 */
export function mergeDAVEProjectAreaRecord(
  current: ProjectArea,
  candidate: ProjectArea,
): ProjectArea {
  const metadataWinner = recordTimestamp(candidate) >= recordTimestamp(current)
    ? candidate
    : current;
  const gpsWinner = compareGpsAuthority(candidate, current) >= 0
    ? candidate
    : current;

  return {
    ...metadataWinner,
    id: current.id,
    projectName:
      normalizeOptionalName(metadataWinner.projectName) ||
      normalizeOptionalName(current.projectName) ||
      normalizeOptionalName(candidate.projectName) ||
      null,
    latitude: gpsWinner.latitude,
    longitude: gpsWinner.longitude,
    locationCapturedAt: gpsWinner.locationCapturedAt || null,
    updatedAt: latestTimestamp(current.updatedAt, candidate.updatedAt),
  };
}

export function mergeDAVEProjectAreaRecoveryRecords({
  local,
  cloud,
  deletedIds = [],
}: {
  local: readonly ProjectArea[];
  cloud: readonly ProjectArea[];
  deletedIds?: readonly string[];
}): ProjectArea[] {
  const deleted = new Set(deletedIds.map(normalizedId).filter(Boolean));
  const merged = new Map<string, ProjectArea>();

  cloud.forEach(record => {
    const id = normalizedId(record.id);
    if (id && !deleted.has(id)) merged.set(id, record);
  });

  local.forEach(record => {
    const id = normalizedId(record.id);
    if (!id || deleted.has(id)) return;
    const existing = merged.get(id);
    merged.set(id, existing ? mergeDAVEProjectAreaRecord(existing, record) : record);
  });

  return [...merged.values()];
}

function compareGpsAuthority(left: ProjectArea, right: ProjectArea) {
  const leftCaptured = Boolean(validTimestamp(left.locationCapturedAt));
  const rightCaptured = Boolean(validTimestamp(right.locationCapturedAt));
  if (leftCaptured !== rightCaptured) return leftCaptured ? 1 : -1;

  const captureDifference = timestamp(left.locationCapturedAt) - timestamp(right.locationCapturedAt);
  if (captureDifference !== 0) return captureDifference;
  return recordTimestamp(left) - recordTimestamp(right);
}

function recordTimestamp(area: ProjectArea) {
  return Math.max(timestamp(area.updatedAt), timestamp(area.locationCapturedAt));
}

function latestTimestamp(left: string | null | undefined, right: string | null | undefined) {
  if (!left) return right || null;
  if (!right) return left;
  return timestamp(right) >= timestamp(left) ? right : left;
}

function validTimestamp(value: string | null | undefined) {
  return timestamp(value) > 0 ? value : null;
}

function timestamp(value: string | null | undefined) {
  const parsed = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizedId(value: string) {
  return String(value || '').trim().toLowerCase();
}

function normalizeOptionalName(value: string | null | undefined) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
