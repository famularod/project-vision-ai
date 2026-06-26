import type { ProjectArea } from '../types';

export function hasSavedAreaLocation(area: ProjectArea) {
  return Boolean(area.locationCapturedAt);
}

export function projectAreaSetupStats(projectAreas: ProjectArea[]) {
  const total = projectAreas.length;
  const saved = projectAreas.filter(hasSavedAreaLocation).length;
  const missing = Math.max(total - saved, 0);
  const percent = total > 0 ? Math.round((saved / total) * 100) : 0;

  return {
    total,
    saved,
    missing,
    percent,
  };
}

export function formatFeet(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'Unknown';
  }

  return `${Math.round(value).toLocaleString('en-US')} ft`;
}
