import type {
  ReferenceDocument,
  ReferenceDocumentCitation,
  ScheduleItem,
} from '../types';
import {
  selectAutomaticDrawingExcerpt,
  type AutomaticDrawingExcerpt,
} from './AuthoritativeDocumentSystem';

export type ReportDrawingReference = Readonly<{
  id: string;
  projectName: string;
  areaName: string;
  citation: ReferenceDocumentCitation;
  excerpt: AutomaticDrawingExcerpt;
}>;

/**
 * Builds drawing references without asking a project manager to select or
 * place images. Only exact, high-confidence area matches from authoritative
 * current drawings are eligible. Areas without a trustworthy match are
 * deliberately omitted.
 */
export function buildAutomaticReportDrawingReferences({
  documents,
  scheduleItems,
  selectedProjectNames,
  minimumConfidence = 0.82,
}: {
  documents: ReferenceDocument[];
  scheduleItems: ScheduleItem[];
  selectedProjectNames: readonly string[];
  minimumConfidence?: number;
}) {
  const selectedProjects = new Set(selectedProjectNames.map(normalized).filter(Boolean));
  const areas = uniqueProjectAreas(scheduleItems)
    .filter(item => selectedProjects.has(normalized(item.projectName)));

  return areas.flatMap<ReportDrawingReference>(area => {
    const excerpt = selectAutomaticDrawingExcerpt({
      documents,
      projectName: area.projectName,
      areaName: area.areaName,
      minimumConfidence,
    });
    if (!excerpt) return [];
    return [{
      id: `${area.projectName}:${area.areaName}:${excerpt.citation.documentId}:${excerpt.citation.regionId || excerpt.pageNumber}`,
      projectName: area.projectName,
      areaName: area.areaName,
      citation: excerpt.citation,
      excerpt,
    }];
  });
}

function uniqueProjectAreas(scheduleItems: ScheduleItem[]) {
  const seen = new Set<string>();
  return scheduleItems.flatMap(item => {
    const projectName = clean(item.scheduleProjectName) || clean(item.projectName);
    const areaName = clean(item.locationName);
    const key = `${normalized(projectName)}|${normalized(areaName)}`;
    if (!projectName || !areaName || seen.has(key)) return [];
    seen.add(key);
    return [{ projectName, areaName }];
  });
}

function normalized(value: string | null | undefined) {
  return clean(value).toLowerCase().replace(/\s+/g, ' ');
}

function clean(value: string | null | undefined) {
  return (value || '').trim();
}
